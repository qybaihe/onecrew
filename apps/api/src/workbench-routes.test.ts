import type { JobRecord } from '@onecrew/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';

function source<T>(items: T[] = []) {
  return { list: vi.fn(async () => items) };
}

describe('workbench routes', () => {
  it('returns a project-scoped production snapshot', async () => {
    const jobs = source([{ value: { jobId: 'job_1' } as JobRecord, version: 2 }]);
    const batches = { listForProject: vi.fn(async () => []) };
    const app = createApp({
      logger: false,
      probes: [],
      workbench: {
        jobs,
        batches,
        qcRuns: source(),
        renders: source(),
        localizations: source(),
        publishes: source(),
        humanGates: source(),
        audit: source(),
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/workbench/snapshot?projectId=prj_f0x&limit=25',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      scope: { projectId: 'prj_f0x' },
      jobs: [{ value: { jobId: 'job_1' }, version: 2 }],
      batches: [],
    });
    expect(jobs.list).toHaveBeenCalledWith('prj_f0x', 25);
    expect(batches.listForProject).toHaveBeenCalledWith('prj_f0x', 25);
    await app.close();
  });

  it('fails closed when the workbench data source is not configured', async () => {
    const app = createApp({ logger: false, probes: [] });
    const response = await app.inject({ method: 'GET', url: '/v1/workbench/snapshot' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'WorkbenchRoutesNotConfiguredError' });
    await app.close();
  });

  it('isolates an incompatible historical source without hiding healthy production data', async () => {
    const app = createApp({
      logger: false,
      probes: [],
      workbench: {
        jobs: source([{ value: { jobId: 'job_healthy' } as JobRecord, version: 1 }]),
        batches: { listForProject: vi.fn(async () => []) },
        qcRuns: source(),
        renders: { list: vi.fn(async () => { throw new TypeError('legacy render record'); }) },
        localizations: source(),
        publishes: source(),
        humanGates: source(),
        audit: source(),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/v1/workbench/snapshot?projectId=prj_f0x' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      jobs: [{ value: { jobId: 'job_healthy' }, version: 1 }],
      renders: [],
      warnings: [{ source: 'renders', error: 'TypeError' }],
    });
    await app.close();
  });
});
