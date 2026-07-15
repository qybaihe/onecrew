import { createHmac, timingSafeEqual } from 'node:crypto';

import { providerCallbackSchema, type ProviderCallback } from '@onecrew/contracts';
import type { createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';

import { persistProviderAssets } from './provider-assets.js';

type Repositories = ReturnType<typeof createRepositories>;

export class ProviderCallbackSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderCallbackSecurityError';
  }
}

export function signProviderCallback(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export function verifyProviderCallback(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): void {
  if (!secret) throw new ProviderCallbackSecurityError('Provider callback secret is not configured');
  if (!timestamp || !signature) throw new ProviderCallbackSecurityError('Missing callback signature headers');
  const timestampMs = Number(timestamp) * 1_000;
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1_000) {
    throw new ProviderCallbackSecurityError('Provider callback timestamp is outside the replay window');
  }
  const expected = Buffer.from(signProviderCallback(rawBody, timestamp, secret), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(signature, 'hex');
  } catch {
    throw new ProviderCallbackSecurityError('Invalid callback signature encoding');
  }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ProviderCallbackSecurityError('Invalid provider callback signature');
  }
}

export class ProviderCallbackProcessor {
  constructor(private readonly repositories: Repositories) {}

  async handle(input: ProviderCallback): Promise<{ accepted: boolean; replayed: boolean; jobId: string }> {
    const callback = providerCallbackSchema.parse(input);
    const reservation = await this.repositories.providerCallbacks.reserve(callback);
    const run = await this.repositories.providerJobRuns.findByExternal(
      callback.provider,
      callback.externalJobId,
    );
    if (!reservation.created) return { accepted: true, replayed: true, jobId: run.jobId };

    let current = await this.repositories.jobs.get(run.jobId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { accepted: true, replayed: false, jobId: run.jobId };
    }
    if (
      current.value.status === 'failed' &&
      (callback.state.status === 'running' || callback.state.status === 'succeeded')
    ) {
      current = await this.repositories.jobs.transition(run.jobId, current.version, 'queued', {
        attempt: current.value.attempt + 1,
        errorCode: undefined,
        errorMessage: undefined,
      });
    }
    if (
      (callback.state.status === 'running' || callback.state.status === 'succeeded' || callback.state.status === 'failed') &&
      current.value.status === 'queued'
    ) {
      current = await this.repositories.jobs.transition(run.jobId, current.version, 'running');
    }

    if (callback.state.status === 'succeeded') {
      if (callback.state.output === undefined) throw new Error('Succeeded callback has no output');
      const actualCostCny = callback.state.actualCostCny ?? current.value.estimatedCostCny ?? 0;
      const outputAssetIds = await persistProviderAssets(
        this.repositories,
        current.value,
        run.request,
        callback.state.output,
      );
      await this.repositories.providerCache.put({
        inputHash: current.value.inputHash,
        provider: current.value.provider,
        model: current.value.model,
        mode: current.value.mode,
        output: callback.state.output,
        actualCostCny,
        sourceJobId: run.jobId,
      });
      await this.repositories.jobs.transition(run.jobId, current.version, 'succeeded', {
        actualCostCny,
        outputAssetIds,
      });
      await this.repositories.providerJobRuns.markCompleted(run.jobId);
    } else if (callback.state.status === 'failed' && current.value.status !== 'failed') {
      await this.repositories.jobs.transition(run.jobId, current.version, 'failed', {
        errorCode: callback.state.errorCode ?? 'PROVIDER_CALLBACK_FAILED',
        errorMessage: callback.state.errorMessage ?? 'Provider callback reported failure',
      });
    } else if (callback.state.status === 'cancelled') {
      await this.repositories.jobs.transition(run.jobId, current.version, 'cancelled');
    }

    await this.repositories.audit.record({
      auditId: `audit_${createInputHash({ eventId: callback.eventId, action: callback.state.status }).slice(0, 32)}`,
      source: 'provider_callback',
      eventId: callback.eventId,
      projectId: current.value.projectId,
      action: callback.state.status,
      targetType: 'job',
      targetId: run.jobId,
      outcome: 'accepted',
      details: {
        provider: callback.provider,
        externalJobIdHash: createInputHash(callback.externalJobId),
        ...(callback.state.output === undefined
          ? {}
          : { outputHash: createInputHash(callback.state.output) }),
      },
    });
    return { accepted: true, replayed: false, jobId: run.jobId };
  }
}
