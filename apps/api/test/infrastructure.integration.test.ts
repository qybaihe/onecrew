import { loadEnv } from '@onecrew/config';
import { afterAll, describe, expect, it } from 'vitest';

import { createInfrastructureProbes, runProbe } from '../src/readiness.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const probes = createInfrastructureProbes(env);

afterAll(async () => {
  await Promise.all(probes.map(async (probe) => probe.close?.()));
});

describe('local infrastructure', () => {
  it.each(probes)('$name is reachable and ready', async (probe) => {
    const result = await runProbe(probe);
    expect(result).toMatchObject({ status: 'up' });
  });
});
