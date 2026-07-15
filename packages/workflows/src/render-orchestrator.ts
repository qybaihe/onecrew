import {
  asyncRenderAcceptedSchema,
  renderSubmissionSchema,
  type AsyncRenderAccepted,
  type RenderManifest,
  type RenderMode,
  type RenderRecord,
} from '@onecrew/contracts';
import {
  IdempotencyConflictError,
  RecordNotFoundError,
  type createRepositories,
} from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';

import type { RenderJobQueue } from './render-queue.js';

type Repositories = ReturnType<typeof createRepositories>;

export interface RenderMediaResult {
  bytes: Uint8Array;
  contentType: 'video/mp4';
  extension: 'mp4';
  width: number;
  height: number;
  durationInFrames: number;
}

export interface RenderEngine {
  render(
    manifest: RenderManifest,
    mode: RenderMode,
    options?: { signal?: AbortSignal; onProgress?: (progress: number) => void },
  ): Promise<RenderMediaResult>;
}

export interface RenderMediaStore {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ uri: string }>;
}

export interface RenderOrchestratorOptions {
  codeVersion: string;
  cancelPollMs: number;
}

function semanticManifestHash(manifest: RenderManifest): string {
  const { renderId, ...semantic } = manifest;
  void renderId;
  return createInputHash(semantic);
}

function accepted(record: RenderRecord, replayed: boolean, cached: boolean): AsyncRenderAccepted {
  return asyncRenderAcceptedSchema.parse({
    renderId: record.renderId,
    status: record.status === 'succeeded' ? 'succeeded' : 'queued',
    mode: record.renderMode,
    statusUrl: `/v1/renders/${record.renderId}`,
    replayed,
    cached,
  });
}

export class RenderOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: RenderJobQueue,
    private readonly engine: RenderEngine | undefined,
    private readonly mediaStore: RenderMediaStore | undefined,
    private readonly options: RenderOrchestratorOptions,
  ) {}

  async submit(
    input: { manifest: RenderManifest; mode: RenderMode },
    idempotencyKey: string,
  ): Promise<AsyncRenderAccepted> {
    const submission = renderSubmissionSchema.parse(input);
    if (!idempotencyKey.trim()) throw new Error('Idempotency-Key header is required');
    const scope = `render-submit:${submission.manifest.projectId}`;
    const requestHash = createInputHash(submission);
    try {
      const existing = await this.repositories.renders.get(submission.manifest.renderId);
      const existingHash = createInputHash({
        manifest: existing.value.manifest,
        mode: existing.value.renderMode,
      });
      if (existingHash !== requestHash) {
        throw new IdempotencyConflictError(scope, submission.manifest.renderId);
      }
      if (existing.value.status === 'queued') await this.queue.enqueue(existing.value.renderId);
      return accepted(
        existing.value,
        true,
        existing.value.status === 'succeeded' && Boolean(existing.value.outputUri),
      );
    } catch (error) {
      if (!(error instanceof RecordNotFoundError)) throw error;
    }
    const reservation = await this.repositories.idempotency.reserve(scope, idempotencyKey, requestHash);
    if (reservation.state === 'replayed') return asyncRenderAcceptedSchema.parse(reservation.response);
    if (reservation.state === 'in_progress') throw new Error(`Render submission is in progress: ${idempotencyKey}`);

    let persisted = false;
    try {
      const manifestHash = semanticManifestHash(submission.manifest);
      const cached = await this.repositories.renders.findSucceeded(
        manifestHash,
        submission.mode,
        this.options.codeVersion,
      );
      const now = new Date().toISOString();
      const record: RenderRecord = {
        renderId: submission.manifest.renderId,
        projectId: submission.manifest.projectId,
        manifest: submission.manifest,
        renderMode: submission.mode,
        status: cached ? 'succeeded' : 'queued',
        manifestHash,
        designPackVersion: submission.manifest.designPack.version,
        codeVersion: this.options.codeVersion,
        ...(cached?.value.outputUri ? { outputUri: cached.value.outputUri } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await this.repositories.renders.create(record);
      persisted = true;
      if (!cached) await this.queue.enqueue(record.renderId);
      const response = accepted(record, false, Boolean(cached));
      await this.repositories.idempotency.complete(scope, idempotencyKey, requestHash, {
        response,
        resourceType: 'render',
        resourceId: record.renderId,
      });
      return response;
    } catch (error) {
      if (!persisted) await this.repositories.idempotency.release(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  async get(renderId: string) {
    return this.repositories.renders.get(renderId);
  }

  async cancel(renderId: string): Promise<{ status: 'cancelled' | 'already_terminal' }> {
    const current = await this.repositories.renders.get(renderId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { status: 'already_terminal' };
    }
    await this.queue.cancel(renderId);
    await this.repositories.renders.transition(renderId, current.version, 'cancelled');
    return { status: 'cancelled' };
  }

  async execute(renderId: string): Promise<{ renderId: string; outputUri?: string }> {
    if (!this.engine || !this.mediaStore) throw new Error('Render execution dependencies are not configured');
    let current = await this.repositories.renders.get(renderId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return {
        renderId,
        ...(current.value.outputUri ? { outputUri: current.value.outputUri } : {}),
      };
    }
    if (current.value.status === 'failed') {
      current = await this.repositories.renders.transition(renderId, current.version, 'queued', {
        errorCode: undefined,
        errorMessage: undefined,
      });
    }
    if (current.value.status !== 'queued') {
      throw new Error(`Render ${renderId} cannot execute from ${current.value.status}`);
    }
    const running = await this.repositories.renders.transition(renderId, current.version, 'running');
    const controller = new AbortController();
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void this.repositories.renders
        .get(renderId)
        .then((latest) => {
          if (latest.value.status === 'cancelled') controller.abort();
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, this.options.cancelPollMs);
    timer.unref();
    try {
      const media = await this.engine.render(running.value.manifest, running.value.renderMode, {
        signal: controller.signal,
      });
      const stored = await this.mediaStore.put({
        key: `renders/${running.value.projectId}/${renderId}/${running.value.renderMode}.${media.extension}`,
        bytes: media.bytes,
        contentType: media.contentType,
      });
      const latest = await this.repositories.renders.get(renderId);
      if (latest.value.status === 'cancelled') return { renderId };
      await this.repositories.renders.transition(renderId, latest.version, 'succeeded', {
        outputUri: stored.uri,
      });
      await this.repositories.audit.record({
        auditId: `audit_${createInputHash({ renderId, action: 'render_succeeded' }).slice(0, 32)}`,
        source: 'workflow',
        eventId: `render_${createInputHash({ renderId }).slice(0, 32)}`,
        projectId: running.value.projectId,
        action: 'remotion_render',
        targetType: 'render',
        targetId: renderId,
        outcome: 'accepted',
        details: {
          mode: running.value.renderMode,
          compositionId: running.value.manifest.compositionId,
          manifestHash: running.value.manifestHash,
          designPackVersion: running.value.designPackVersion,
          codeVersion: running.value.codeVersion,
          width: media.width,
          height: media.height,
          durationInFrames: media.durationInFrames,
        },
      });
      return { renderId, outputUri: stored.uri };
    } catch (error) {
      const latest = await this.repositories.renders.get(renderId);
      if (latest.value.status === 'running') {
        await this.repositories.renders.transition(renderId, latest.version, 'failed', {
          errorCode: controller.signal.aborted ? 'RENDER_CANCELLED' : 'REMOTION_RENDER_FAILED',
          errorMessage: error instanceof Error ? error.message : 'Unknown Remotion error',
        });
      }
      throw error;
    } finally {
      clearInterval(timer);
    }
  }
}

export { IdempotencyConflictError };
