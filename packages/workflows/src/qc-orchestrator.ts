import {
  asyncQcAcceptedSchema,
  qcRunRequestSchema,
  vlmProviderOutputSchema,
  type AsyncQcAccepted,
  type FeishuCardActionName,
  type HumanGate,
  type QcRunRecord,
  type QcRunRequest,
  type TechnicalQcReport,
  type VlmProviderOutput,
} from '@onecrew/contracts';
import {
  IdempotencyConflictError,
  RecordNotFoundError,
  type createRepositories,
} from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { buildApprovalCard } from '@onecrew/feishu';
import { evaluateQcPolicy } from '@onecrew/qc';

import type { ProviderOrchestrator } from './provider-orchestrator.js';
import type { QcJobQueue } from './qc-queue.js';
import type { RenderOrchestrator } from './render-orchestrator.js';

type Repositories = ReturnType<typeof createRepositories>;

export interface QcMediaMaterialization {
  filePath: string;
  providerUri: string;
  providerMediaType?: 'image' | 'video';
  cleanup(): Promise<void>;
}

export interface QcMediaResolver {
  materialize(uri: string): Promise<QcMediaMaterialization>;
}

export interface QcTechnicalAnalyzer {
  analyze(input: {
    filePath: string;
    mediaType: 'image' | 'video';
    expected: QcRunRequest['technical'];
    signal?: AbortSignal;
  }): Promise<TechnicalQcReport>;
}

export interface QcReviewPublisher {
  publish(input: {
    projectId: string;
    qcRunId: string;
    card: Record<string, unknown>;
  }): Promise<'sent' | 'mock_outbox' | 'unconfigured'>;
}

export interface QcOrchestratorOptions {
  providerPollMs: number;
  providerTimeoutMs: number;
  providerFailureGraceMs: number;
  cancelPollMs: number;
}

export class QcSubmissionInProgressError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`QC submission is already in progress: ${idempotencyKey}`);
    this.name = 'QcSubmissionInProgressError';
  }
}

export class QcCancelledError extends Error {
  constructor(readonly qcRunId: string) {
    super(`QC run was cancelled: ${qcRunId}`);
    this.name = 'QcCancelledError';
  }
}

function createQcRunId(requestHash: string): string {
  return `qc_${Date.now().toString(36)}_${requestHash.slice(0, 20)}`;
}

function terminal(status: QcRunRecord['status']): boolean {
  return status === 'succeeded' || status === 'cancelled';
}

function accepted(record: QcRunRecord, replayed: boolean): AsyncQcAccepted {
  return asyncQcAcceptedSchema.parse({
    qcRunId: record.qcRunId,
    status: record.status,
    statusUrl: `/v1/qc/runs/${record.qcRunId}`,
    replayed,
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    timer.unref();
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true },
    );
  });
}

export class QcOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: QcJobQueue,
    private readonly provider: Pick<ProviderOrchestrator, 'submit' | 'get' | 'regenerate' | 'cancel'>,
    private readonly render: Pick<RenderOrchestrator, 'get' | 'submit'> | undefined,
    private readonly technical: QcTechnicalAnalyzer | undefined,
    private readonly mediaResolver: QcMediaResolver | undefined,
    private readonly reviewPublisher: QcReviewPublisher | undefined,
    private readonly options: QcOrchestratorOptions,
  ) {}

  async submit(input: QcRunRequest, idempotencyKey: string): Promise<AsyncQcAccepted> {
    const request = qcRunRequestSchema.parse(input);
    if (!idempotencyKey.trim()) throw new Error('Idempotency-Key header is required');
    const requestHash = createInputHash(request);
    const scope = `qc-submit:${request.projectId}`;
    const existing = await this.repositories.qcRuns.getByIdempotency(request.projectId, idempotencyKey);
    if (existing) {
      if (createInputHash(existing.value.request) !== requestHash) {
        throw new IdempotencyConflictError(scope, idempotencyKey);
      }
      if (existing.value.status === 'queued') await this.queue.enqueue(existing.value.qcRunId);
      return accepted(existing.value, true);
    }

    const reservation = await this.repositories.idempotency.reserve(scope, idempotencyKey, requestHash);
    if (reservation.state === 'replayed') return asyncQcAcceptedSchema.parse(reservation.response);
    if (reservation.state === 'in_progress') throw new QcSubmissionInProgressError(idempotencyKey);

    let persisted = false;
    try {
      const now = new Date().toISOString();
      const record: QcRunRecord = {
        qcRunId: createQcRunId(requestHash),
        request,
        status: 'queued',
        createdAt: now,
        updatedAt: now,
      };
      await this.repositories.qcRuns.create(record, idempotencyKey);
      persisted = true;
      await this.queue.enqueue(record.qcRunId);
      const response = accepted(record, false);
      await this.repositories.idempotency.complete(scope, idempotencyKey, requestHash, {
        response,
        resourceType: 'qc_run',
        resourceId: record.qcRunId,
      });
      return response;
    } catch (error) {
      if (!persisted) await this.repositories.idempotency.release(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  async get(qcRunId: string) {
    return this.repositories.qcRuns.get(qcRunId);
  }

  async cancel(qcRunId: string): Promise<{ status: 'cancelled' | 'already_terminal' }> {
    const current = await this.repositories.qcRuns.get(qcRunId);
    if (terminal(current.value.status)) return { status: 'already_terminal' };
    await this.queue.cancel(qcRunId);
    if (current.value.vlmJobId) await this.provider.cancel(current.value.vlmJobId).catch(() => undefined);
    await this.repositories.qcRuns.transition(qcRunId, current.version, 'cancelled', {
      errorCode: 'QC_CANCELLED',
      errorMessage: 'QC run cancelled by request',
    });
    return { status: 'cancelled' };
  }

  async execute(qcRunId: string): Promise<{ qcRunId: string; status: QcRunRecord['status'] }> {
    if (!this.technical || !this.mediaResolver) {
      throw new Error('QC execution dependencies are not configured');
    }
    let current = await this.repositories.qcRuns.get(qcRunId);
    if (terminal(current.value.status) || current.value.status === 'waiting_human') {
      return { qcRunId, status: current.value.status };
    }
    if (current.value.status === 'failed') {
      current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'queued', {
        errorCode: undefined,
        errorMessage: undefined,
      });
    }
    if (current.value.status !== 'queued') {
      throw new Error(`QC run ${qcRunId} cannot execute from ${current.value.status}`);
    }
    current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'running');

    const controller = new AbortController();
    let activeProviderJobId: string | undefined;
    let cancellationCheckRunning = false;
    const cancellationTimer = setInterval(() => {
      if (cancellationCheckRunning) return;
      cancellationCheckRunning = true;
      void this.repositories.qcRuns
        .get(qcRunId)
        .then(async (latest) => {
          if (latest.value.status !== 'cancelled') return;
          controller.abort(new QcCancelledError(qcRunId));
          if (activeProviderJobId) await this.provider.cancel(activeProviderJobId).catch(() => undefined);
        })
        .catch(() => undefined)
        .finally(() => {
          cancellationCheckRunning = false;
        });
    }, this.options.cancelPollMs);
    cancellationTimer.unref();

    let materialized: QcMediaMaterialization | undefined;
    try {
      materialized = await this.mediaResolver.materialize(current.value.request.mediaUri);
      const technicalReport = await this.technical.analyze({
        filePath: materialized.filePath,
        mediaType: current.value.request.mediaType,
        expected: current.value.request.technical,
        signal: controller.signal,
      });
      current = await this.repositories.qcRuns.patch(qcRunId, current.version, { technicalReport });
      const semanticSubmission = await this.provider.submit(
        {
          capability: 'vlm',
          projectId: current.value.request.projectId,
          ...(current.value.request.shotId ? { shotId: current.value.request.shotId } : {}),
          mediaUri: materialized.providerUri,
          mediaType: materialized.providerMediaType ?? current.value.request.mediaType,
          criteria: current.value.request.criteria,
          expectedDescription: current.value.request.expectedDescription,
          route: current.value.request.route,
        },
        `qc-vlm-${qcRunId}-${current.value.request.route}`,
      );
      activeProviderJobId = semanticSubmission.jobId;
      current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'waiting_provider', {
        vlmJobId: activeProviderJobId,
      });

      let semantic = await this.waitForProvider(activeProviderJobId, controller.signal);
      if (semantic.kind === 'failed' && current.value.request.route === 'primary') {
        const fallback = await this.provider.regenerate(
          activeProviderJobId,
          'fallback',
          `qc-vlm-fallback-${qcRunId}`,
        );
        activeProviderJobId = fallback.jobId;
        current = await this.repositories.qcRuns.patch(qcRunId, current.version, {
          vlmJobId: activeProviderJobId,
        });
        semantic = await this.waitForProvider(activeProviderJobId, controller.signal);
      }

      const semanticOutput: VlmProviderOutput =
        semantic.kind === 'succeeded'
          ? vlmProviderOutputSchema.parse(semantic.output)
          : vlmProviderOutputSchema.parse({
              scores: {
                character: 0,
                clothing: 0,
                background: 0,
                action: 0,
                flicker: 0,
                lipsync: 0,
                subtitle: 0,
                brand: 0,
                safeArea: 0,
                audio: 0,
                compliance: 0,
              },
              decision: 'manual',
              reason: `Both QC providers were unavailable: ${semantic.reason}`,
              retryPatch: { provider_unavailable: true },
            });
      const policy = evaluateQcPolicy(current.value.request, technicalReport, semanticOutput);
      const qcRecordId = `qcr_${createInputHash({ qcRunId, policy }).slice(0, 32)}`;
      await this.repositories.qc.create({
        qcId: qcRecordId,
        qcRunId,
        projectId: current.value.request.projectId,
        ...(current.value.request.shotId ? { shotId: current.value.request.shotId } : {}),
        scores: semanticOutput.scores,
        decision: policy.decision,
        reason: policy.reason,
        ...(policy.retryPatch ? { retryPatch: policy.retryPatch } : {}),
        technicalReport,
        semanticProviderJobId: activeProviderJobId,
        createdAt: new Date().toISOString(),
      });
      current = await this.repositories.qcRuns.patch(qcRunId, current.version, {
        semanticReport: semanticOutput,
        decision: policy.decision,
        reason: policy.reason,
        ...(policy.retryPatch ? { retryPatch: policy.retryPatch } : {}),
        qcRecordId,
      });

      if (!policy.needsHuman && policy.decision === 'pass') {
        current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'succeeded');
      } else if (!policy.needsHuman && current.value.request.autoRemediate) {
        const route = policy.decision === 'switch_model' ? 'fallback' : current.value.request.route;
        const remediation = await this.remediate(current.value, route, `qc-auto-${qcRunId}`);
        if (remediation?.kind === 'job') {
          current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'succeeded', {
            remediationJobId: remediation.id,
          });
        } else if (remediation?.kind === 'render') {
          current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'succeeded', {
            remediationRenderId: remediation.id,
          });
        } else {
          current = await this.openHumanGate(current, 'Automatic remediation needs a source job or render');
        }
      } else {
        current = await this.openHumanGate(current);
      }

      await this.auditResult(current.value);
      return { qcRunId, status: current.value.status };
    } catch (error) {
      const latest = await this.repositories.qcRuns.get(qcRunId);
      if (latest.value.status === 'cancelled') return { qcRunId, status: 'cancelled' };
      if (latest.value.status === 'running' || latest.value.status === 'waiting_provider') {
        const failed = await this.repositories.qcRuns.transition(qcRunId, latest.version, 'failed', {
          errorCode: error instanceof QcCancelledError ? 'QC_CANCELLED' : 'QC_EXECUTION_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown QC execution error',
        });
        return { qcRunId, status: failed.value.status };
      }
      throw error;
    } finally {
      clearInterval(cancellationTimer);
      await materialized?.cleanup().catch(() => undefined);
    }
  }

  async resolveHuman(
    qcRunId: string,
    action: FeishuCardActionName,
    eventId: string,
  ): Promise<Record<string, unknown>> {
    let current = await this.repositories.qcRuns.get(qcRunId);
    if (current.value.status !== 'waiting_human') {
      throw new Error(`QC run ${qcRunId} is not waiting for a human decision`);
    }
    if (action === 'approve') {
      current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'succeeded');
      return { outcome: 'qc_override_approved', qcRunId, status: current.value.status };
    }
    if (action === 'manual') {
      current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'cancelled', {
        errorCode: 'QC_MANUAL_HANDOFF',
        errorMessage: 'QC issue transferred to manual handling',
      });
      return { outcome: 'qc_manual_handoff', qcRunId, status: current.value.status };
    }

    const route = action === 'switch_provider' ? 'fallback' : current.value.request.route;
    const remediation = await this.remediate(current.value, route, eventId);
    if (!remediation) throw new Error('QC remediation requires a source generation job or Remotion render');
    current = await this.repositories.qcRuns.transition(qcRunId, current.version, 'succeeded', {
      ...(remediation.kind === 'job'
        ? { remediationJobId: remediation.id }
        : { remediationRenderId: remediation.id }),
    });
    return {
      outcome: remediation.kind === 'job' ? 'qc_regeneration_queued' : 'qc_rerender_queued',
      qcRunId,
      route,
      replacementId: remediation.id,
      status: current.value.status,
    };
  }

  private async waitForProvider(
    jobId: string,
    signal: AbortSignal,
  ): Promise<{ kind: 'succeeded'; output: unknown } | { kind: 'failed'; reason: string }> {
    const startedAt = Date.now();
    let failedAt: number | undefined;
    while (Date.now() - startedAt < this.options.providerTimeoutMs) {
      if (signal.aborted) throw new QcCancelledError(jobId);
      const result = await this.provider.get(jobId);
      if (result.job.value.status === 'succeeded') {
        if (!('output' in result)) return { kind: 'failed', reason: 'Provider output is missing from cache' };
        return { kind: 'succeeded', output: result.output };
      }
      if (result.job.value.status === 'cancelled') return { kind: 'failed', reason: 'Provider job was cancelled' };
      if (result.job.value.status === 'failed') {
        failedAt ??= Date.now();
        if (Date.now() - failedAt >= this.options.providerFailureGraceMs) {
          return {
            kind: 'failed',
            reason: result.job.value.errorMessage ?? result.job.value.errorCode ?? 'Provider job failed',
          };
        }
      } else {
        failedAt = undefined;
      }
      await delay(this.options.providerPollMs, signal);
    }
    return { kind: 'failed', reason: `Provider job timed out after ${this.options.providerTimeoutMs}ms` };
  }

  private async remediate(
    record: QcRunRecord,
    route: 'primary' | 'fallback',
    idempotencyKey: string,
  ): Promise<{ kind: 'job' | 'render'; id: string } | undefined> {
    if (record.request.remediation === 'remotion' && record.request.sourceRenderId && this.render) {
      const source = await this.render.get(record.request.sourceRenderId);
      const renderId = `render_qc_${createInputHash({ qcRunId: record.qcRunId, idempotencyKey }).slice(0, 24)}`;
      const response = await this.render.submit(
        {
          manifest: {
            ...source.value.manifest,
            renderId,
            renderRevision: (source.value.manifest.renderRevision ?? 0) + 1,
          },
          mode: source.value.renderMode,
        },
        idempotencyKey,
      );
      return { kind: 'render', id: response.renderId };
    }
    if (record.request.sourceJobId) {
      const response = await this.provider.regenerate(record.request.sourceJobId, route, idempotencyKey);
      return { kind: 'job', id: response.jobId };
    }
    return undefined;
  }

  private async openHumanGate(
    current: Awaited<ReturnType<Repositories['qcRuns']['get']>>,
    extraReason?: string,
  ): Promise<Awaited<ReturnType<Repositories['qcRuns']['get']>>> {
    const target = await this.reviewTarget(current.value);
    const gateId = `gate_qc_${createInputHash({ qcRunId: current.value.qcRunId, target }).slice(0, 28)}`;
    const gate: HumanGate = await this.repositories.humanGates.open({
      gateId,
      workflowId: current.value.qcRunId,
      projectId: current.value.request.projectId,
      node: 'qc_manual_review',
      targetType: target.type,
      targetId: target.id,
      expectedTargetVersion: target.version,
    });
    const failureCodes = current.value.technicalReport?.checks
      .filter((check) => !check.passed)
      .map((check) => check.code)
      .join(', ');
    const summary = [
      `**QC 结论**：${current.value.decision ?? 'manual'}`,
      `**可执行原因**：${current.value.reason ?? '需要人工检查'}`,
      failureCodes ? `**失败项**：${failureCodes}` : undefined,
      current.value.retryPatch
        ? `**修复建议**：${JSON.stringify(current.value.retryPatch)}`
        : undefined,
      extraReason ? `**自动化说明**：${extraReason}` : undefined,
      `**QC Run**：${current.value.qcRunId}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const card = buildApprovalCard({
      title: '星轨 OneCrew · QC 人工复核',
      summary,
      projectId: current.value.request.projectId,
      targetType: target.type,
      targetId: target.id,
      expectedVersion: target.version,
    });
    const reviewDelivery = this.reviewPublisher
      ? await this.reviewPublisher.publish({
          projectId: current.value.request.projectId,
          qcRunId: current.value.qcRunId,
          card,
        })
      : 'mock_outbox';
    return this.repositories.qcRuns.transition(current.value.qcRunId, current.version, 'waiting_human', {
      gateId: gate.gateId,
      reviewCard: card,
      reviewDelivery,
    });
  }

  private async reviewTarget(record: QcRunRecord): Promise<{
    type: HumanGate['targetType'];
    id: string;
    version: number;
  }> {
    if (record.request.sourceJobId) {
      const source = await this.repositories.jobs.get(record.request.sourceJobId);
      return { type: 'job', id: record.request.sourceJobId, version: source.version };
    }
    if (record.request.sourceRenderId) {
      const source = await this.repositories.renders.get(record.request.sourceRenderId);
      return { type: 'render', id: record.request.sourceRenderId, version: source.version };
    }
    if (record.request.sourceAssetId) {
      const source = await this.repositories.assets.get(record.request.sourceAssetId);
      return { type: 'asset', id: record.request.sourceAssetId, version: source.version };
    }
    if (record.request.shotId) {
      const source = await this.repositories.shots.get(record.request.shotId);
      return { type: 'shot', id: record.request.shotId, version: source.version };
    }
    if (record.vlmJobId) {
      const source = await this.repositories.jobs.get(record.vlmJobId);
      return { type: 'job', id: record.vlmJobId, version: source.version };
    }
    throw new RecordNotFoundError('qc_review_target', record.qcRunId);
  }

  private async auditResult(record: QcRunRecord): Promise<void> {
    const eventId = `qc_${createInputHash({ qcRunId: record.qcRunId, status: record.status }).slice(0, 32)}`;
    await this.repositories.audit.record({
      auditId: `audit_${createInputHash({ eventId, action: 'qc_completed' }).slice(0, 32)}`,
      source: 'workflow',
      eventId,
      projectId: record.request.projectId,
      action: 'qc_completed',
      outcome: record.status === 'failed' ? 'failed' : 'accepted',
      targetType: record.request.sourceRenderId ? 'render' : record.request.sourceJobId ? 'job' : 'qc_run',
      targetId: record.request.sourceRenderId ?? record.request.sourceJobId ?? record.qcRunId,
      details: {
        qcRunId: record.qcRunId,
        status: record.status,
        decision: record.decision,
        technicalPassed: record.technicalReport?.passed,
        vlmJobId: record.vlmJobId,
        remediationJobId: record.remediationJobId,
        remediationRenderId: record.remediationRenderId,
        reviewDelivery: record.reviewDelivery,
      },
    });
  }
}
