import {
  asyncJobAcceptedSchema,
  providerRequestSchema,
  type AsyncJobAccepted,
  type Capability,
  type JobRecord,
  type ProviderRequest,
} from '@onecrew/contracts';
import {
  IdempotencyConflictError,
  RecordNotFoundError,
  type createRepositories,
} from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import {
  BudgetApprovalRequiredError,
  ProviderError,
  evaluateBudget,
} from '@onecrew/providers';
import type { ProviderGateway } from '@onecrew/providers';

import type { ProviderJobQueue } from './provider-queue.js';
import { persistProviderAssets } from './provider-assets.js';

type Repositories = ReturnType<typeof createRepositories>;

function jobCapability(capability: ProviderRequest['capability']): Capability {
  if (capability === 'llm') return 'plan';
  if (capability === 'vlm') return 'qc';
  return capability;
}

function createJobId(inputHash: string): string {
  return `job_${Date.now().toString(36)}_${inputHash.slice(0, 16)}`;
}

export class ProviderSubmissionInProgressError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`Provider submission is already in progress: ${idempotencyKey}`);
    this.name = 'ProviderSubmissionInProgressError';
  }
}

export interface ProviderOrchestratorOptions {
  softBudgetRatio: number;
  cacheTtlMs?: number;
}

export class ProviderOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly gateway: ProviderGateway,
    private readonly queue: ProviderJobQueue,
    private readonly options: ProviderOrchestratorOptions,
  ) {}

  async submit(requestInput: ProviderRequest, idempotencyKey: string): Promise<AsyncJobAccepted> {
    const request = providerRequestSchema.parse(requestInput);
    if (!idempotencyKey.trim()) throw new Error('Idempotency-Key header is required');
    const requestHash = createInputHash(request);
    const scope = `provider-submit:${request.projectId}`;
    const existingJob = await this.repositories.jobs.getByIdempotency(request.projectId, idempotencyKey);
    if (existingJob) {
      if (existingJob.value.inputHash !== requestHash) {
        throw new IdempotencyConflictError(scope, idempotencyKey);
      }
      const run = await this.repositories.providerJobRuns.get(existingJob.value.jobId);
      if (existingJob.value.status === 'queued' && !run.queueJobId) {
        const queued = await this.queue.enqueue(existingJob.value.jobId);
        await this.repositories.providerJobRuns.markQueued(existingJob.value.jobId, queued.queueJobId);
      }
      return this.accepted(existingJob.value, run.route, true);
    }

    const reservation = await this.repositories.idempotency.reserve(scope, idempotencyKey, requestHash);
    if (reservation.state === 'replayed') return asyncJobAcceptedSchema.parse(reservation.response);
    if (reservation.state === 'in_progress') throw new ProviderSubmissionInProgressError(idempotencyKey);

    let persisted = false;
    try {
      const estimate = await this.gateway.estimate(request);
      const project = await this.repositories.projects.get(request.projectId);
      const spentCny = await this.repositories.jobs.committedCostCny(request.projectId);
      const budget = evaluateBudget(
        spentCny,
        estimate.amountCny,
        project.value.budgetLimitCny * this.options.softBudgetRatio,
        project.value.budgetLimitCny,
      );
      const jobId = createJobId(estimate.inputHash);
      const now = new Date().toISOString();
      const job: JobRecord = {
        jobId,
        projectId: request.projectId,
        ...('shotId' in request && request.shotId ? { shotId: request.shotId } : {}),
        capability: jobCapability(request.capability),
        provider: estimate.descriptor.name,
        model: estimate.descriptor.model,
        mode: estimate.descriptor.mode,
        status: budget.status === 'hard_approval' ? 'waiting_human' : 'queued',
        attempt: 1,
        estimatedCostCny: estimate.amountCny,
        inputHash: estimate.inputHash,
        outputAssetIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.repositories.jobs.create(job, idempotencyKey);
      persisted = true;
      await this.repositories.providerJobRuns.create({ jobId, route: request.route, request });
      if (budget.status === 'hard_approval') {
        await this.repositories.humanGates.open({
          gateId: `gate_budget_${jobId}`,
          workflowId: `workflow_${request.projectId}`,
          projectId: request.projectId,
          node: 'provider_budget_approval',
          targetType: 'job',
          targetId: jobId,
          expectedTargetVersion: 1,
        });
      } else {
        const queued = await this.queue.enqueue(jobId);
        await this.repositories.providerJobRuns.markQueued(jobId, queued.queueJobId);
      }
      const response = this.accepted(job, request.route, false, budget.warning);
      await this.repositories.idempotency.complete(scope, idempotencyKey, requestHash, {
        response,
        resourceType: 'job',
        resourceId: jobId,
      });
      return response;
    } catch (error) {
      if (!persisted) await this.repositories.idempotency.release(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  async execute(jobId: string): Promise<{ jobId: string; cached: boolean }> {
    let current = await this.repositories.jobs.get(jobId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { jobId, cached: current.value.status === 'succeeded' };
    }
    if (current.value.status === 'waiting_human') {
      throw new BudgetApprovalRequiredError(0, current.value.estimatedCostCny ?? 0, 0);
    }
    if (current.value.status === 'failed') {
      current = await this.repositories.jobs.transition(jobId, current.version, 'queued', {
        attempt: current.value.attempt + 1,
        errorCode: undefined,
        errorMessage: undefined,
      });
    }
    if (current.value.status !== 'queued') {
      throw new Error(`Provider job ${jobId} cannot execute from ${current.value.status}`);
    }
    const running = await this.repositories.jobs.transition(jobId, current.version, 'running');
    const run = await this.repositories.providerJobRuns.get(jobId);
    try {
      const cached = await this.repositories.providerCache.get(
        running.value.inputHash,
        running.value.provider,
        running.value.model,
        running.value.mode,
      );
      if (cached) {
        const sourceJob = await this.repositories.jobs.get(cached.sourceJobId).catch(() => undefined);
        const outputAssetIds =
          sourceJob?.value.outputAssetIds.length
            ? sourceJob.value.outputAssetIds
            : await persistProviderAssets(
                this.repositories,
                running.value,
                run.request,
                cached.output,
              );
        await this.repositories.jobs.transition(jobId, running.version, 'succeeded', {
          actualCostCny: 0,
          latencyMs: 0,
          outputAssetIds,
        });
        await this.repositories.providerJobRuns.markCompleted(jobId);
        return { jobId, cached: true };
      }

      const result = await this.gateway.execute(
        run.request,
        {
          idempotencyKey: `provider-execute:${jobId}:attempt:${running.value.attempt}`,
          ...(run.callbackUrl ? { callbackUrl: run.callbackUrl } : {}),
        },
        { onSubmitted: (externalJobId) => this.repositories.providerJobRuns.markSubmitted(jobId, externalJobId) },
      );
      if (result.state.status !== 'succeeded' || result.state.output === undefined) {
        throw new ProviderError('PROVIDER_NOT_SUCCEEDED', `Provider ended as ${result.state.status}`, false);
      }
      const actualCostCny = result.state.actualCostCny ?? result.estimatedCostCny;
      const outputAssetIds = await persistProviderAssets(
        this.repositories,
        running.value,
        run.request,
        result.state.output,
      );
      await this.repositories.providerCache.put(
        {
          inputHash: result.inputHash,
          provider: result.descriptor.name,
          model: result.descriptor.model,
          mode: result.descriptor.mode,
          output: result.state.output,
          actualCostCny,
          sourceJobId: jobId,
        },
        new Date(Date.now() + (this.options.cacheTtlMs ?? 30 * 24 * 60 * 60 * 1_000)),
      );
      await this.repositories.jobs.transition(jobId, running.version, 'succeeded', {
        actualCostCny,
        latencyMs: result.latencyMs,
        outputAssetIds,
      });
      await this.repositories.providerJobRuns.markCompleted(jobId);
      return { jobId, cached: false };
    } catch (error) {
      const latest = await this.repositories.jobs.get(jobId);
      if (latest.value.status === 'running') {
        await this.repositories.jobs.transition(jobId, latest.version, 'failed', {
          errorCode: error instanceof ProviderError ? error.code : 'PROVIDER_EXECUTION_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown provider execution error',
        });
      }
      throw error;
    }
  }

  async get(jobId: string) {
    const job = await this.repositories.jobs.get(jobId);
    const run = await this.repositories.providerJobRuns.get(jobId);
    const cached =
      job.value.status === 'succeeded'
        ? await this.repositories.providerCache.get(
            job.value.inputHash,
            job.value.provider,
            job.value.model,
            job.value.mode,
          )
        : undefined;
    return { job, run, ...(cached ? { output: cached.output } : {}) };
  }

  async cancel(jobId: string): Promise<{ status: 'cancelled' | 'already_terminal' }> {
    const current = await this.repositories.jobs.get(jobId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { status: 'already_terminal' };
    }
    const run = await this.repositories.providerJobRuns.get(jobId);
    if (current.value.status === 'running' && run.externalJobId) {
      await this.gateway.cancel(run.request, run.externalJobId, {
        idempotencyKey: `provider-cancel:${jobId}`,
      });
    } else {
      await this.queue.cancel(jobId);
    }
    await this.repositories.jobs.transition(jobId, current.version, 'cancelled');
    return { status: 'cancelled' };
  }

  async enqueueApprovedBudgetJob(jobId: string): Promise<void> {
    const current = await this.repositories.jobs.get(jobId);
    if (current.value.status !== 'waiting_human') {
      throw new Error(`Budget job ${jobId} is not waiting for approval`);
    }
    const queuedJob = await this.repositories.jobs.transition(jobId, current.version, 'queued');
    const queued = await this.queue.enqueue(jobId);
    await this.repositories.providerJobRuns.markQueued(queuedJob.value.jobId, queued.queueJobId);
  }

  async regenerate(
    jobId: string,
    route: 'primary' | 'fallback',
    idempotencyKey: string,
  ): Promise<AsyncJobAccepted> {
    const run = await this.repositories.providerJobRuns.get(jobId);
    return this.submit(
      providerRequestSchema.parse({
        ...run.request,
        route,
        generationNonce: (run.request.generationNonce ?? 0) + 1,
      }),
      idempotencyKey,
    );
  }

  private accepted(
    job: JobRecord,
    route: 'primary' | 'fallback',
    replayed: boolean,
    warning?: string,
  ): AsyncJobAccepted {
    return asyncJobAcceptedSchema.parse({
      jobId: job.jobId,
      status: job.status === 'waiting_human' ? 'waiting_human' : 'queued',
      mode: job.mode,
      provider: job.provider,
      route,
      estimatedCostCny: job.estimatedCostCny ?? 0,
      statusUrl: `/v1/jobs/${job.jobId}`,
      ...(warning ? { warning } : {}),
      replayed,
    });
  }
}

export { RecordNotFoundError };
