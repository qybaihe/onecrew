import { loadEnv } from '@onecrew/config';
import type { JobRecord } from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { signProviderCallback } from '@onecrew/workflows';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const env = loadEnv({ NODE_ENV: 'test' });
const now = new Date().toISOString();
const job: JobRecord = {
  jobId: 'job_api_fixture',
  projectId: 'prj_api_fixture',
  capability: 'plan',
  provider: 'mock-llm-primary',
  model: 'deterministic-llm-v1',
  mode: 'mock',
  status: 'queued',
  attempt: 1,
  estimatedCostCny: 0.01,
  inputHash: createInputHash({ fixture: true }),
  outputAssetIds: [],
  createdAt: now,
  updatedAt: now,
};
const callbackSecret = 'fixture-callback-secret';
const app = createApp({
  env,
  probes: [],
  providers: {
    orchestrator: {
      async submit() {
        return {
          jobId: job.jobId,
          status: 'queued',
          mode: 'mock',
          provider: job.provider,
          route: 'primary',
          estimatedCostCny: 0.01,
          statusUrl: `/v1/jobs/${job.jobId}` as `/v1/jobs/${string}`,
          replayed: false,
        };
      },
      async get() {
        return {
          job: { value: job, version: 1 },
          run: {
            jobId: job.jobId,
            route: 'primary',
            request: {
              capability: 'llm',
              projectId: job.projectId,
              route: 'primary',
              operation: 'script',
              prompt: 'fixture',
              locale: 'zh-CN',
              imageUris: [],
              maxOutputTokens: 100,
            },
            queueJobId: job.jobId,
          },
        };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    },
    callbackProcessor: {
      async handle(input) {
        return { accepted: true, replayed: false, jobId: input.externalJobId };
      },
    },
    callbackSecret,
  },
});

afterAll(async () => {
  await app.close();
});

describe('Provider API routes', () => {
  it('requires idempotency and returns the documented asynchronous wire shape', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/projects/prj_api_fixture/plan',
      payload: { operation: 'script', prompt: 'fixture', locale: 'zh-CN' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'MissingIdempotencyKeyError' });

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/projects/prj_api_fixture/plan',
      headers: { 'idempotency-key': 'idem_api_fixture' },
      payload: { operation: 'script', prompt: 'fixture', locale: 'zh-CN' },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({
      job_id: job.jobId,
      status: 'queued',
      mode: 'mock',
      provider: job.provider,
      route: 'primary',
      estimated_cost_cny: 0.01,
      status_url: `/v1/jobs/${job.jobId}`,
      replayed: false,
    });
  });

  it('returns persisted status and cancellation state', async () => {
    const status = await app.inject({ method: 'GET', url: `/v1/jobs/${job.jobId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ job: { jobId: job.jobId }, provider_run: { route: 'primary' } });

    const cancel = await app.inject({ method: 'POST', url: `/v1/jobs/${job.jobId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({ status: 'cancelled' });
  });

  it('verifies callback HMAC and replay-window headers', async () => {
    const payload = JSON.stringify({
      eventId: 'evt_api_callback',
      provider: 'mock-video-primary',
      externalJobId: 'job_callback_fixture',
      state: { status: 'succeeded', output: { ok: true } },
    });
    const timestamp = Math.floor(Date.now() / 1_000).toString();
    const signature = signProviderCallback(payload, timestamp, callbackSecret);
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/providers/callback',
      headers: {
        'content-type': 'application/json',
        'x-onecrew-timestamp': timestamp,
        'x-onecrew-signature': signature,
      },
      payload,
    });
    expect(accepted.statusCode).toBe(202);

    const rejected = await app.inject({
      method: 'POST',
      url: '/v1/providers/callback',
      headers: {
        'content-type': 'application/json',
        'x-onecrew-timestamp': timestamp,
        'x-onecrew-signature': '00',
      },
      payload,
    });
    expect(rejected.statusCode).toBe(401);
  });
});
