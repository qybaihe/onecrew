import { loadEnv } from '@onecrew/config';
import { qcRunRequestSchema, type QcRunRecord } from '@onecrew/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const env = loadEnv({ NODE_ENV: 'test' });
const request = qcRunRequestSchema.parse({
  projectId: 'prj_qc_api',
  sourceJobId: 'job_qc_source',
  mediaUri: 's3://onecrew/qc/fixture.mp4',
  mediaType: 'video',
  expectedDescription: 'ShotSpec and immutable Design Pack fixture',
  criteria: ['character consistency', 'brand and subtitle safe area'],
});
const now = new Date().toISOString();
const record: QcRunRecord = {
  qcRunId: 'qc_api_fixture',
  request,
  status: 'queued',
  createdAt: now,
  updatedAt: now,
};
const app = createApp({
  env,
  probes: [],
  qc: {
    orchestrator: {
      async submit() {
        return {
          qcRunId: record.qcRunId,
          status: 'queued',
          statusUrl: `/v1/qc/runs/${record.qcRunId}` as `/v1/qc/runs/${string}`,
          replayed: false,
        };
      },
      async get() {
        return { value: record, version: 1 };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    },
  },
});

afterAll(async () => {
  await app.close();
});

describe('QC API routes', () => {
  it('requires idempotency and accepts the structured QC request', async () => {
    const missing = await app.inject({ method: 'POST', url: '/v1/qc/run', payload: request });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'MissingQcIdempotencyKeyError' });

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/qc/run',
      headers: { 'idempotency-key': 'idem_qc_api' },
      payload: request,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({
      qc_run_id: record.qcRunId,
      status: 'queued',
      status_url: `/v1/qc/runs/${record.qcRunId}`,
      replayed: false,
    });
  });

  it('returns the durable run and supports cancellation', async () => {
    const status = await app.inject({ method: 'GET', url: `/v1/qc/runs/${record.qcRunId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ qc_run: { qcRunId: record.qcRunId }, version: 1 });

    const cancel = await app.inject({ method: 'POST', url: `/v1/qc/runs/${record.qcRunId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({ status: 'cancelled' });
  });
});
