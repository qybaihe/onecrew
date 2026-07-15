import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import type { ReadinessProbe } from './readiness.js';

const passingProbes: ReadinessProbe[] = [
  { name: 'postgres', check: async () => undefined },
  { name: 'redis', check: async () => undefined },
  { name: 'objectStorage', check: async () => undefined },
];

describe('health routes', () => {
  it('reports liveness without checking dependencies', async () => {
    const app = createApp({ probes: passingProbes, logger: false });
    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      service: 'onecrew-api',
    });
    await app.close();
  });

  it('reports ready only when every required dependency is up', async () => {
    const app = createApp({ probes: passingProbes, logger: false });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      components: {
        postgres: { status: 'up' },
        redis: { status: 'up' },
        objectStorage: { status: 'up' },
      },
    });
    await app.close();
  });

  it('returns 503 and a sanitized error type for a failed dependency', async () => {
    const probes: ReadinessProbe[] = [
      ...passingProbes.slice(0, 2),
      {
        name: 'objectStorage',
        check: async () => {
          throw new Error('contains-sensitive-upstream-detail');
        },
      },
    ];
    const app = createApp({ probes, logger: false });
    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('contains-sensitive-upstream-detail');
    expect(response.json()).toMatchObject({
      status: 'degraded',
      components: {
        objectStorage: { status: 'down', errorType: 'Error' },
      },
    });
    await app.close();
  });
});
