import { describe, expect, it } from 'vitest';

import { signProviderCallback, verifyProviderCallback } from './provider-callback.js';
import { assertProviderExecutionMatchesJob } from './provider-orchestrator.js';
import { providerQueuePayloadSchema } from './provider-queue.js';

describe('Provider queue contract', () => {
  it('accepts only a bounded persisted job ID', () => {
    expect(providerQueuePayloadSchema.parse({ jobId: 'job_123' })).toEqual({ jobId: 'job_123' });
    expect(() => providerQueuePayloadSchema.parse({ jobId: '' })).toThrow();
  });
});

describe('Provider callback security', () => {
  it('accepts a current HMAC and rejects tampering or stale timestamps', () => {
    const now = Date.now();
    const timestamp = Math.floor(now / 1_000).toString();
    const raw = '{"eventId":"evt_1"}';
    const signature = signProviderCallback(raw, timestamp, 'secret');

    expect(() => verifyProviderCallback(raw, timestamp, signature, 'secret', now)).not.toThrow();
    expect(() => verifyProviderCallback(`${raw} `, timestamp, signature, 'secret', now)).toThrow(
      'Invalid provider callback signature',
    );
    expect(() => verifyProviderCallback(raw, '1', signature, 'secret', now)).toThrow('replay window');
  });
});

describe('Provider execution routing', () => {
  it('rejects a Worker whose runtime mode does not match the persisted Job route', () => {
    expect(() => assertProviderExecutionMatchesJob(
      { provider: 'opencode-go-chat-llm', model: 'glm-5.2', mode: 'real' },
      { name: 'mock-llm-primary', model: 'deterministic-llm-v1', mode: 'mock' },
    )).toThrow(/PROVIDER_ROUTE_MISMATCH|Job expects/);
  });

  it('accepts an exact provider, model, and mode match', () => {
    expect(() => assertProviderExecutionMatchesJob(
      { provider: 'opencode-go-chat-llm', model: 'glm-5.2', mode: 'real' },
      { name: 'opencode-go-chat-llm', model: 'glm-5.2', mode: 'real' },
    )).not.toThrow();
  });
});
