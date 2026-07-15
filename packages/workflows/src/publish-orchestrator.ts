import {
  publishRequestSchema,
  type ExperimentRecord,
  type PublishRecord,
  type PublishRequest,
} from '@onecrew/contracts';
import { IdempotencyConflictError, type createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { buildPublishPackage, type PublishMediaReader } from '@onecrew/publishing';

type Repositories = ReturnType<typeof createRepositories>;

export interface PublishObjectStore extends PublishMediaReader {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ uri: string }>;
}

export interface ExperimentWriteback {
  write(records: ExperimentRecord[]): Promise<'sent' | 'mock_outbox' | 'unconfigured'>;
}

export class PublishOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly objectStore: PublishObjectStore,
    private readonly writeback?: ExperimentWriteback,
  ) {}

  async submit(input: PublishRequest, idempotencyKey: string): Promise<PublishRecord> {
    const request = publishRequestSchema.parse(input);
    if (!idempotencyKey.trim()) throw new Error('Idempotency-Key header is required');
    const scope = `publish-submit:${request.projectId}`;
    const requestHash = createInputHash(request);
    const existing = await this.repositories.publishes.getByIdempotency(request.projectId, idempotencyKey);
    if (existing) {
      if (createInputHash(existing.value.request) !== requestHash) {
        throw new IdempotencyConflictError(scope, idempotencyKey);
      }
      return existing.value;
    }
    const reservation = await this.repositories.idempotency.reserve(scope, idempotencyKey, requestHash);
    if (reservation.state === 'replayed') return reservation.response as PublishRecord;
    if (reservation.state === 'in_progress') throw new Error(`Publish submission is in progress: ${idempotencyKey}`);
    const now = new Date().toISOString();
    let current = await this.repositories.publishes.create(
      {
        publishId: request.publishId,
        request,
        status: 'building',
        experimentIds: [],
        createdAt: now,
        updatedAt: now,
      },
      idempotencyKey,
    );
    try {
      const built = await buildPublishPackage(request, this.objectStore);
      const stored = await this.objectStore.put({
        key: `publishes/${request.projectId}/${request.publishId}/${built.packageHash}.zip`,
        bytes: built.bytes,
        contentType: 'application/zip',
      });
      const experiments = await Promise.all(
        built.experiments.map((experiment) => this.repositories.experiments.upsert(experiment)),
      );
      const feishuWriteback = this.writeback
        ? await this.writeback.write(experiments)
        : 'mock_outbox';
      current = await this.repositories.publishes.patch(request.publishId, current.version, {
        status: 'succeeded',
        packageUri: stored.uri,
        packageHash: built.packageHash,
        packageBytes: built.bytes.byteLength,
        experimentIds: experiments.map((experiment) => experiment.experimentId),
        feishuWriteback,
        errorCode: undefined,
        errorMessage: undefined,
      });
      const response = current.value;
      await this.repositories.idempotency.complete(scope, idempotencyKey, requestHash, {
        response,
        resourceType: 'publish',
        resourceId: request.publishId,
      });
      await this.repositories.audit.record({
        auditId: `audit_${createInputHash({ publishId: request.publishId, packageHash: built.packageHash }).slice(0, 32)}`,
        source: 'workflow',
        eventId: `publish_${createInputHash({ publishId: request.publishId }).slice(0, 32)}`,
        projectId: request.projectId,
        action: 'publish_package_exported',
        outcome: 'accepted',
        targetType: 'release',
        targetId: request.publishId,
        details: {
          delivery: 'package_export',
          packageHash: built.packageHash,
          packageBytes: built.bytes.byteLength,
          creativeCount: request.creatives.length,
          experimentCount: experiments.length,
          feishuWriteback,
        },
      });
      return response;
    } catch (error) {
      await this.repositories.publishes.patch(request.publishId, current.version, {
        status: 'failed',
        errorCode: 'PUBLISH_PACKAGE_FAILED',
        errorMessage: error instanceof Error ? error.message : 'Unknown publish package error',
      });
      throw error;
    }
  }

  async get(publishId: string) {
    return this.repositories.publishes.get(publishId);
  }

  async listExperiments(projectId: string): Promise<ExperimentRecord[]> {
    return this.repositories.experiments.listByProject(projectId);
  }
}
