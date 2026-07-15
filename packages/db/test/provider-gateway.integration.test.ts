import { loadEnv } from '@onecrew/config';
import { projectSpecSchema, type ProviderCallback, type ProviderRequest } from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { afterAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/client.js';
import { createRepositories, IdempotencyConflictError } from '../src/repositories.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const client = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(client.db);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await client.close();
});

describe('Provider Gateway PostgreSQL repositories', () => {
  it('persists queue state, external IDs, cache, cost patches and idempotent callbacks', async () => {
    const now = new Date().toISOString();
    const projectId = `prj_provider_${suffix}`;
    const jobId = `job_provider_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: 'Provider 仓储测试',
        nameEn: 'Provider Repository Test',
        synopsis: '验证 Provider Job 可跨进程恢复。',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_provider_test',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );
    const request: ProviderRequest = {
      capability: 'image',
      projectId,
      route: 'primary',
      prompt: '山海夜色',
      referenceUris: [],
      width: 1024,
      height: 1024,
      count: 1,
    };
    const inputHash = createInputHash(request);
    await repositories.jobs.create(
      {
        jobId,
        projectId,
        capability: 'image',
        provider: 'mock-image-primary',
        model: 'deterministic-image-v1',
        mode: 'mock',
        status: 'queued',
        attempt: 1,
        estimatedCostCny: 0.1,
        inputHash,
        outputAssetIds: [],
        createdAt: now,
        updatedAt: now,
      },
      `provider:${inputHash}`,
    );
    await repositories.providerJobRuns.create({ jobId, route: 'primary', request });
    await repositories.providerJobRuns.markQueued(jobId, `queue_${jobId}`);
    await repositories.providerJobRuns.markSubmitted(jobId, `external_${jobId}`);

    const running = await repositories.jobs.transition(jobId, 1, 'running');
    const succeeded = await repositories.jobs.transition(jobId, running.version, 'succeeded', {
      actualCostCny: 0.08,
      latencyMs: 120,
    });
    await repositories.providerJobRuns.markCompleted(jobId);
    const output = [{ uri: 'mock://onecrew/image/result.png' }];
    await repositories.providerCache.put({
      inputHash,
      provider: succeeded.value.provider,
      model: succeeded.value.model,
      mode: succeeded.value.mode,
      output,
      actualCostCny: 0.08,
      sourceJobId: jobId,
    });

    await expect(repositories.providerJobRuns.get(jobId)).resolves.toMatchObject({
      queueJobId: `queue_${jobId}`,
      externalJobId: `external_${jobId}`,
    });
    await expect(
      repositories.providerJobRuns.findByExternal('mock-image-primary', `external_${jobId}`),
    ).resolves.toMatchObject({ jobId });
    await expect(
      repositories.providerCache.get(inputHash, succeeded.value.provider, succeeded.value.model, 'mock'),
    ).resolves.toMatchObject({ output, sourceJobId: jobId, actualCostCny: 0.08 });
    await expect(repositories.jobs.committedCostCny(projectId)).resolves.toBeCloseTo(0.08);

    const callback: ProviderCallback = {
      eventId: `evt_provider_${suffix}`,
      provider: 'mock-image-primary',
      externalJobId: `external_${jobId}`,
      state: { status: 'succeeded', output, actualCostCny: 0.08 },
    };
    await expect(repositories.providerCallbacks.reserve(callback)).resolves.toEqual({ created: true });
    await expect(repositories.providerCallbacks.reserve(callback)).resolves.toEqual({ created: false });
    await expect(
      repositories.providerCallbacks.reserve({ ...callback, state: { status: 'cancelled' } }),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });
});
