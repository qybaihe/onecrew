import { loadEnv } from '@onecrew/config';
import { projectSpecSchema, type ProviderRequest } from '@onecrew/contracts';
import { createDatabase, createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { ProviderGateway, createMockRegistry } from '@onecrew/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProviderOrchestrator } from '../src/provider-orchestrator.js';
import { ProviderCallbackProcessor } from '../src/provider-callback.js';
import { BullProviderQueue, createProviderWorker } from '../src/provider-queue.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const queue = new BullProviderQueue(env.REDIS_URL);
const gateway = new ProviderGateway(createMockRegistry(), {
  pollIntervalMs: 1,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
});
const orchestrator = new ProviderOrchestrator(repositories, gateway, queue, {
  softBudgetRatio: 0.8,
});
const worker = createProviderWorker(
  env.REDIS_URL,
  async (job) => orchestrator.execute(job.data.jobId),
  2,
);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function waitForStatus(jobId: string, status: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const current = await repositories.jobs.get(jobId);
    if (current.value.status === status) return;
    if (current.value.status === 'failed') throw new Error(current.value.errorMessage ?? 'Provider job failed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${jobId} to become ${status}`);
}

beforeAll(async () => {
  await worker.waitUntilReady();
});

afterAll(async () => {
  await worker.close();
  await queue.close();
  await database.close();
});

describe('Provider queue E2E with PostgreSQL, Redis and Mock providers', () => {
  it('queues, executes, replays idempotency and reuses the provider cache', async () => {
    const projectId = `prj_queue_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '队列闭环',
        nameEn: 'Queue Loop',
        synopsis: '真实 Redis 和 PostgreSQL，确定性 Mock Provider。',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_queue_test',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );
    const shotId = `shot_queue_${suffix}`;
    await repositories.shots.create({
      shotId,
      projectId,
      sequence: 1,
      durationSec: 5,
      characters: [],
      sceneId: 'scene_queue',
      action: 'Cross the ridge',
      camera: 'slow push',
      prompt: 'A slow push over the mountain ridge',
      referenceAssetIds: [],
      importance: 'normal',
      closeupDialogue: false,
      status: 'planned',
    });
    const request: ProviderRequest = {
      capability: 'video',
      projectId,
      route: 'primary',
      shotId,
      prompt: 'A slow push over the mountain ridge',
      durationSec: 5,
      aspectRatio: '16:9',
    };
    const first = await orchestrator.submit(request, `idem_queue_first_${suffix}`);
    expect(first).toMatchObject({ status: 'queued', mode: 'mock', replayed: false });
    await waitForStatus(first.jobId, 'succeeded');
    const firstState = await orchestrator.get(first.jobId);
    expect(firstState.run.externalJobId).toMatch(/^mock_video_/);
    expect(firstState.run.completedAt).toBeTruthy();
    expect(firstState.job.value.outputAssetIds).toHaveLength(1);
    const firstAsset = await repositories.assets.get(firstState.job.value.outputAssetIds[0]!);
    expect(firstAsset.value).toMatchObject({
      projectId,
      shotId,
      type: 'video',
      version: 1,
      provider: 'mock-video-primary',
      status: 'draft',
    });

    const replay = await orchestrator.submit(request, `idem_queue_first_${suffix}`);
    expect(replay).toMatchObject({ jobId: first.jobId, replayed: true });

    await new Promise((resolve) => setTimeout(resolve, 2));
    const cached = await orchestrator.submit(request, `idem_queue_cached_${suffix}`);
    await waitForStatus(cached.jobId, 'succeeded');
    const cachedState = await orchestrator.get(cached.jobId);
    expect(cachedState.job.value.actualCostCny).toBe(0);
    expect(cachedState.run.externalJobId).toBeUndefined();
    expect(cachedState.job.value.outputAssetIds).toEqual(firstState.job.value.outputAssetIds);

    const regenerated = await orchestrator.regenerate(
      first.jobId,
      'fallback',
      `idem_queue_regenerate_${suffix}`,
    );
    await waitForStatus(regenerated.jobId, 'succeeded');
    const regeneratedState = await orchestrator.get(regenerated.jobId);
    const regeneratedAsset = await repositories.assets.get(regeneratedState.job.value.outputAssetIds[0]!);
    expect(regeneratedAsset.value).toMatchObject({
      version: 2,
      parentAssetId: firstAsset.value.assetId,
      provider: 'mock-video-fallback',
    });
  });

  it('persists a hard-budget human gate and only queues after approval', async () => {
    const projectId = `prj_budget_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '预算闸门',
        nameEn: 'Budget Gate',
        synopsis: '硬预算需要人工批准。',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_budget_test',
        locales: ['zh-CN'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 0.001,
        status: 'draft',
      }),
    );
    const shotId = `shot_budget_${suffix}`;
    await repositories.shots.create({
      shotId,
      projectId,
      sequence: 1,
      durationSec: 5,
      characters: [],
      sceneId: 'scene_budget',
      action: 'Hero looks up',
      camera: 'close push',
      prompt: 'Hero shot',
      referenceAssetIds: [],
      importance: 'hero',
      closeupDialogue: false,
      status: 'planned',
    });
    const request: ProviderRequest = {
      capability: 'video',
      projectId,
      route: 'primary',
      shotId,
      prompt: 'Hero shot',
      durationSec: 5,
      aspectRatio: '16:9',
    };
    const waiting = await orchestrator.submit(request, `idem_budget_${suffix}`);
    expect(waiting.status).toBe('waiting_human');
    await expect(repositories.humanGates.findWaiting(projectId, 'job', waiting.jobId)).resolves.toMatchObject({
      node: 'provider_budget_approval',
      status: 'waiting',
    });

    await orchestrator.enqueueApprovedBudgetJob(waiting.jobId);
    await waitForStatus(waiting.jobId, 'succeeded');
  });

  it('applies signed-provider callback state idempotently to a persisted running job', async () => {
    const projectId = `prj_callback_${suffix}`;
    const jobId = `job_callback_${suffix}`;
    const externalJobId = `external_callback_${suffix}`;
    const now = new Date().toISOString();
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '回调闭环',
        nameEn: 'Callback Loop',
        synopsis: '回调更新持久化任务。',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_callback_test',
        locales: ['zh-CN'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );
    const request: ProviderRequest = {
      capability: 'llm',
      projectId,
      route: 'primary',
      operation: 'script',
      prompt: 'callback fixture',
      locale: 'zh-CN',
      imageUris: [],
      maxOutputTokens: 100,
    };
    await repositories.jobs.create(
      {
        jobId,
        projectId,
        capability: 'plan',
        provider: 'mock-llm-primary',
        model: 'deterministic-llm-v1',
        mode: 'mock',
        status: 'queued',
        attempt: 1,
        estimatedCostCny: 0.01,
        inputHash: createInputHash(request),
        outputAssetIds: [],
        createdAt: now,
        updatedAt: now,
      },
      `idem_callback_${suffix}`,
    );
    await repositories.providerJobRuns.create({ jobId, route: 'primary', request });
    await repositories.providerJobRuns.markSubmitted(jobId, externalJobId);
    await repositories.jobs.transition(jobId, 1, 'running');
    const processor = new ProviderCallbackProcessor(repositories);
    const callback = {
      eventId: `evt_callback_${suffix}`,
      provider: 'mock-llm-primary',
      externalJobId,
      state: { status: 'succeeded' as const, output: { text: 'done' }, actualCostCny: 0.008 },
    };

    await expect(processor.handle(callback)).resolves.toEqual({ accepted: true, replayed: false, jobId });
    await expect(processor.handle(callback)).resolves.toEqual({ accepted: true, replayed: true, jobId });
    await expect(repositories.jobs.get(jobId)).resolves.toMatchObject({
      value: { status: 'succeeded', actualCostCny: 0.008 },
    });
  });
});
