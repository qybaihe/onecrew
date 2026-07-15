import {
  creativeGenerationBatchRequestSchema,
  creativeGenerationBatchSchema,
  type AssetRecord,
  type CreativeGenerationBatch,
  type CreativeGenerationBatchItem,
  type CreativeGenerationBatchRequest,
  type CreativeProjectBundle,
  type ProviderRoute,
} from '@onecrew/contracts';
import { buildCreativeShotGenerationRequest } from '@onecrew/creative';
import {
  IdempotencyConflictError,
  RecordNotFoundError,
  type CreativeGenerationBatchRepository,
  type CreativeRepository,
  type JobRepository,
  type Versioned,
} from '@onecrew/db';
import { createInputHash, VersionConflictError } from '@onecrew/domain';

import type { ProviderOrchestrator } from './provider-orchestrator.js';

interface Repositories {
  creative: Pick<CreativeRepository, 'getBundle' | 'listAssets' | 'getRecordVersions'>;
  creativeGenerationBatches: Pick<
    CreativeGenerationBatchRepository,
    'create' | 'get' | 'getByIdempotency' | 'latestForProject' | 'replace'
  >;
  jobs: Pick<JobRepository, 'get'>;
}
type Provider = Pick<ProviderOrchestrator, 'submit' | 'cancel' | 'regenerate'>;

export class CreativeGenerationBatchValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeGenerationBatchValidationError';
  }
}

function deriveBatchStatus(items: CreativeGenerationBatchItem[]): CreativeGenerationBatch['status'] {
  const actionable = items.filter((item) => item.status !== 'skipped');
  if (actionable.length === 0) return 'succeeded';
  if (actionable.some((item) => item.status === 'pending')) return 'submitting';
  if (actionable.some((item) => item.status === 'queued' || item.status === 'running')) return 'running';
  if (actionable.some((item) => item.status === 'waiting_human')) return 'waiting_human';
  if (actionable.every((item) => item.status === 'succeeded')) return 'succeeded';
  const succeeded = actionable.some((item) => item.status === 'succeeded');
  const cancelled = actionable.some((item) => item.status === 'cancelled');
  const failed = actionable.some(
    (item) => item.status === 'failed' || item.status === 'submission_failed',
  );
  if (succeeded && (cancelled || failed)) return 'partial';
  if (cancelled && !failed) return 'cancelled';
  return 'failed';
}

async function mapConcurrent<Input, Output>(
  inputs: Input[],
  concurrency: number,
  task: (input: Input) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(inputs.length, 1)) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      outputs[index] = await task(inputs[index]!);
    }
  });
  await Promise.all(workers);
  return outputs;
}

function batchId(projectId: string, idempotencyKey: string): string {
  return `batch_${createInputHash({ projectId, idempotencyKey }).slice(0, 32)}`;
}

function submissionItem(
  item: CreativeGenerationBatchItem,
  accepted: Awaited<ReturnType<ProviderOrchestrator['submit']>>,
): CreativeGenerationBatchItem {
  return {
    ...item,
    status: accepted.status,
    jobId: accepted.jobId,
    mode: accepted.mode,
    provider: accepted.provider,
    estimatedCostCny: accepted.estimatedCostCny,
    outputAssetIds: [],
    reason: accepted.warning,
  };
}

export class CreativeGenerationBatchOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly provider: Provider,
  ) {}

  async submit(
    projectId: string,
    requestInput: CreativeGenerationBatchRequest,
    idempotencyKey: string,
  ): Promise<Versioned<CreativeGenerationBatch>> {
    if (!idempotencyKey.trim()) throw new CreativeGenerationBatchValidationError('Idempotency-Key is required');
    const request = creativeGenerationBatchRequestSchema.parse(requestInput);
    const inputHash = createInputHash({ projectId, request });
    const existing = await this.repositories.creativeGenerationBatches.getByIdempotency(
      projectId,
      idempotencyKey,
    );
    if (existing) {
      if (existing.value.inputHash !== inputHash) {
        throw new IdempotencyConflictError(`creative-generation-batch:${projectId}`, idempotencyKey);
      }
      if (existing.value.items.some((item) => item.status === 'pending')) {
        const [bundle, assets] = await Promise.all([
          this.repositories.creative.getBundle(projectId),
          this.repositories.creative.listAssets(projectId),
        ]);
        return this.submitPending(existing, bundle, assets, idempotencyKey);
      }
      return this.sync(existing.value.batchId);
    }

    const [bundle, assets, versions] = await Promise.all([
      this.repositories.creative.getBundle(projectId),
      this.repositories.creative.listAssets(projectId),
      this.repositories.creative.getRecordVersions(projectId),
    ]);
    const shotsById = new Map(bundle.shots.map((shot) => [shot.shotId, shot] as const));
    const requestedShotIds = request.shotIds ?? bundle.shots.map((shot) => shot.shotId);
    const unknownShotId = requestedShotIds.find((shotId) => !shotsById.has(shotId));
    if (unknownShotId) {
      throw new CreativeGenerationBatchValidationError(
        `Shot ${unknownShotId} does not belong to project ${projectId}`,
      );
    }
    const items = requestedShotIds.map((shotId): CreativeGenerationBatchItem => {
      const expectedVersion = request.expectedVersions[shotId];
      if (!expectedVersion) {
        throw new CreativeGenerationBatchValidationError(`expectedVersions is missing ${shotId}`);
      }
      const actualVersion = versions.shots[shotId];
      if (!actualVersion) throw new CreativeGenerationBatchValidationError(`Shot version not found: ${shotId}`);
      if (actualVersion !== expectedVersion) throw new VersionConflictError(expectedVersion, actualVersion);
      const alreadyGenerated = assets.some(
        (asset) => asset.shotId === shotId && asset.type === request.kind,
      );
      return {
        shotId,
        expectedVersion,
        status: request.missingOnly && alreadyGenerated ? 'skipped' : 'pending',
        outputAssetIds: [],
        retryCount: 0,
        ...(request.missingOnly && alreadyGenerated ? { reason: `Existing ${request.kind} asset` } : {}),
      };
    });
    const now = new Date().toISOString();
    const record = creativeGenerationBatchSchema.parse({
      batchId: batchId(projectId, idempotencyKey),
      projectId,
      kind: request.kind,
      status: deriveBatchStatus(items),
      missingOnly: request.missingOnly,
      route: request.route,
      generationNonce: request.generationNonce,
      concurrency: request.concurrency,
      items,
      inputHash,
      createdAt: now,
      updatedAt: now,
    });
    const created = await this.repositories.creativeGenerationBatches.create(record, idempotencyKey);
    return this.submitPending(created, bundle, assets, idempotencyKey);
  }

  async get(batchIdValue: string): Promise<Versioned<CreativeGenerationBatch>> {
    return this.sync(batchIdValue);
  }

  async latest(projectId: string): Promise<Versioned<CreativeGenerationBatch> | undefined> {
    const latest = await this.repositories.creativeGenerationBatches.latestForProject(projectId);
    return latest ? this.sync(latest.value.batchId) : undefined;
  }

  async cancel(batchIdValue: string): Promise<Versioned<CreativeGenerationBatch>> {
    const current = await this.sync(batchIdValue);
    const active = current.value.items.filter(
      (item) => item.jobId && ['queued', 'running', 'waiting_human'].includes(item.status),
    );
    await Promise.allSettled(active.map((item) => this.provider.cancel(item.jobId!)));
    return this.sync(batchIdValue);
  }

  async retry(
    batchIdValue: string,
    route: ProviderRoute,
    idempotencyKey: string,
  ): Promise<Versioned<CreativeGenerationBatch>> {
    if (!idempotencyKey.trim()) throw new CreativeGenerationBatchValidationError('Idempotency-Key is required');
    const current = await this.sync(batchIdValue);
    const retryable = current.value.items.filter((item) =>
      ['submission_failed', 'failed', 'cancelled'].includes(item.status),
    );
    if (retryable.length === 0) return current;
    const [bundle, assets, versions] = await Promise.all([
      this.repositories.creative.getBundle(current.value.projectId),
      this.repositories.creative.listAssets(current.value.projectId),
      this.repositories.creative.getRecordVersions(current.value.projectId),
    ]);
    const replacements = await mapConcurrent(retryable, current.value.concurrency, async (item) => {
      const retryCount = item.retryCount + 1;
      try {
        const accepted = item.jobId
          ? await this.provider.regenerate(
              item.jobId,
              route,
              `${idempotencyKey}:${item.shotId}:${retryCount}`,
            )
          : await this.retrySubmission(
              current.value,
              item,
              bundle,
              assets,
              versions.shots[item.shotId],
              route,
              `${idempotencyKey}:${item.shotId}:${retryCount}`,
            );
        return submissionItem({ ...item, retryCount, reason: undefined }, accepted);
      } catch (error) {
        return {
          ...item,
          status: 'submission_failed' as const,
          retryCount,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
    const byShot = new Map(replacements.map((item) => [item.shotId, item] as const));
    const items = current.value.items.map((item) => byShot.get(item.shotId) ?? item);
    const updated = creativeGenerationBatchSchema.parse({
      ...current.value,
      route,
      status: deriveBatchStatus(items),
      items,
      updatedAt: new Date().toISOString(),
    });
    const replaced = await this.repositories.creativeGenerationBatches.replace(
      batchIdValue,
      current.version,
      updated,
    );
    return this.sync(replaced.value.batchId);
  }

  private async retrySubmission(
    batch: CreativeGenerationBatch,
    item: CreativeGenerationBatchItem,
    bundle: CreativeProjectBundle,
    assets: AssetRecord[],
    actualVersion: number | undefined,
    route: ProviderRoute,
    idempotencyKey: string,
  ) {
    if (actualVersion !== item.expectedVersion) {
      throw new VersionConflictError(item.expectedVersion, actualVersion ?? 0);
    }
    return this.provider.submit(
      buildCreativeShotGenerationRequest({
        bundle,
        assets,
        shotId: item.shotId,
        kind: batch.kind,
        route,
        generationNonce: batch.generationNonce + item.retryCount + 1,
      }),
      idempotencyKey,
    );
  }

  private async submitPending(
    current: Versioned<CreativeGenerationBatch>,
    bundle: CreativeProjectBundle,
    assets: AssetRecord[],
    idempotencyKey: string,
  ): Promise<Versioned<CreativeGenerationBatch>> {
    const pending = current.value.items.filter((item) => item.status === 'pending');
    if (pending.length === 0) return current;
    const submitted = await mapConcurrent(pending, current.value.concurrency, async (item) => {
      try {
        const accepted = await this.provider.submit(
          buildCreativeShotGenerationRequest({
            bundle,
            assets,
            shotId: item.shotId,
            kind: current.value.kind,
            route: current.value.route,
            generationNonce: current.value.generationNonce,
          }),
          `${idempotencyKey}:${current.value.kind}:${item.shotId}`,
        );
        return submissionItem(item, accepted);
      } catch (error) {
        return {
          ...item,
          status: 'submission_failed' as const,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    });
    const byShot = new Map(submitted.map((item) => [item.shotId, item] as const));
    const items = current.value.items.map((item) => byShot.get(item.shotId) ?? item);
    const updated = creativeGenerationBatchSchema.parse({
      ...current.value,
      status: deriveBatchStatus(items),
      items,
      updatedAt: new Date().toISOString(),
    });
    const replaced = await this.repositories.creativeGenerationBatches.replace(
      current.value.batchId,
      current.version,
      updated,
    );
    return this.sync(replaced.value.batchId);
  }

  private async sync(batchIdValue: string): Promise<Versioned<CreativeGenerationBatch>> {
    const current = await this.repositories.creativeGenerationBatches.get(batchIdValue);
    const items = await Promise.all(
      current.value.items.map(async (item): Promise<CreativeGenerationBatchItem> => {
        if (!item.jobId || item.status === 'skipped' || item.status === 'submission_failed') return item;
        try {
          const job = await this.repositories.jobs.get(item.jobId);
          return {
            ...item,
            status: job.value.status,
            mode: job.value.mode,
            provider: job.value.provider,
            estimatedCostCny: job.value.estimatedCostCny,
            outputAssetIds: job.value.outputAssetIds,
            ...(job.value.errorMessage ? { reason: job.value.errorMessage } : { reason: undefined }),
          };
        } catch (error) {
          if (!(error instanceof RecordNotFoundError)) throw error;
          return {
            ...item,
            status: 'submission_failed',
            reason: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );
    const status = deriveBatchStatus(items);
    const unchanged = status === current.value.status && createInputHash(items) === createInputHash(current.value.items);
    if (unchanged) return current;
    return this.repositories.creativeGenerationBatches.replace(
      batchIdValue,
      current.version,
      creativeGenerationBatchSchema.parse({
        ...current.value,
        status,
        items,
        updatedAt: new Date().toISOString(),
      }),
    );
  }
}
