import { loadEnv } from '@onecrew/config';
import { projectSpecSchema, type RenderManifest } from '@onecrew/contracts';
import { createDatabase, createRepositories } from '@onecrew/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RenderOrchestrator } from '../src/render-orchestrator.js';
import { BullRenderQueue, createRenderWorker } from '../src/render-queue.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const queue = new BullRenderQueue(env.REDIS_URL);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const storedKeys: string[] = [];
let engineCalls = 0;
let cancelAborted = false;
const orchestrator = new RenderOrchestrator(
  repositories,
  queue,
  {
    async render(manifest, mode, options) {
      engineCalls += 1;
      if (manifest.renderId.startsWith('render_cancel_')) {
        await new Promise<never>((_resolve, reject) => {
          const abort = () => {
            cancelAborted = true;
            reject(new Error('fixture render aborted'));
          };
          if (options?.signal?.aborted) abort();
          else options?.signal?.addEventListener('abort', abort, { once: true });
        });
      }
      return {
        bytes: new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, ...new Uint8Array(256)]),
        contentType: 'video/mp4',
        extension: 'mp4',
        width: mode === 'preview' ? 640 : manifest.output.width,
        height: mode === 'preview' ? 640 : manifest.output.height,
        durationInFrames: 180,
      };
    },
  },
  {
    async put(input) {
      storedKeys.push(input.key);
      return { uri: `s3://onecrew/${input.key}` };
    },
  },
  { codeVersion: 'render-integration-v1', cancelPollMs: 100 },
);
const worker = createRenderWorker(
  env.REDIS_URL,
  async (job) => orchestrator.execute(job.data.renderId),
  1,
);

function manifest(projectId: string, renderId: string): RenderManifest {
  const now = new Date().toISOString();
  return {
    renderId,
    projectId,
    compositionId: 'Bumper6',
    locale: 'zh-CN',
    aspectRatio: '1:1',
    fps: 30,
    designPack: {
      designSystemId: 'design_render_test',
      version: '1.0.0',
      designMdUri: 'design-pack://design_render_test/versions/v1/DESIGN.md',
      brandTokensUri: 'design-pack://design_render_test/versions/v1/brand.tokens.json',
      motionTokensUri: 'design-pack://design_render_test/versions/v1/motion.tokens.json',
      promoSpecUri: 'design-pack://design_render_test/versions/v1/promo.spec.json',
      assetUris: ['design-pack://design_render_test/versions/v1/assets/logo.svg'],
      source: 'manual',
      sourceLicense: 'integration fixture',
      createdAt: now,
    },
    localePack: {
      projectId,
      locale: 'zh-CN',
      title: '渲染队列',
      lines: [
        {
          lineId: `line_${suffix}`,
          shotId: `shot_${suffix}`,
          speaker: '测试者',
          text: '渲染开始。',
          startMs: 0,
          endMs: 1_000,
          voiceId: 'voice_test',
        },
      ],
      cta: '立即观看',
      marketingCopy: ['六秒看见山海。'],
    },
    shots: [
      {
        shotId: `shot_${suffix}`,
        videoUri: 'mock://onecrew/video/render-integration.mp4',
        inFrame: 0,
        outFrame: 180,
      },
    ],
    output: { codec: 'h264', width: 1080, height: 1080 },
  };
}

async function waitForStatus(renderId: string, status: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const current = await repositories.renders.get(renderId);
    if (current.value.status === status) return;
    if (current.value.status === 'failed') throw new Error(current.value.errorMessage ?? 'Render failed');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${renderId} to become ${status}`);
}

beforeAll(async () => {
  await worker.waitUntilReady();
});

afterAll(async () => {
  await worker.close();
  await queue.close();
  await database.close();
});

describe('Remotion render queue with PostgreSQL and Redis', () => {
  it('renders, stores, replays and reuses semantic render cache', async () => {
    const projectId = `prj_render_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '渲染队列',
        nameEn: 'Render Queue',
        synopsis: 'Render queue integration fixture.',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_render_test',
        locales: ['zh-CN'],
        aspectRatios: ['1:1'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );
    const firstManifest = manifest(projectId, `render_first_${suffix}`);
    const first = await orchestrator.submit(
      { manifest: firstManifest, mode: 'preview' },
      `idem_render_first_${suffix}`,
    );
    expect(first).toMatchObject({ status: 'queued', cached: false, replayed: false });
    await waitForStatus(first.renderId, 'succeeded');
    await expect(repositories.renders.get(first.renderId)).resolves.toMatchObject({
      value: {
        status: 'succeeded',
        renderMode: 'preview',
        outputUri: `s3://onecrew/renders/${projectId}/${first.renderId}/preview.mp4`,
      },
    });

    const replay = await orchestrator.submit(
      { manifest: firstManifest, mode: 'preview' },
      `idem_render_first_${suffix}`,
    );
    expect(replay).toMatchObject({ renderId: first.renderId, status: 'succeeded', replayed: true });

    const cachedManifest: RenderManifest = {
      ...firstManifest,
      renderId: `render_cached_${suffix}`,
    };
    const cached = await orchestrator.submit(
      { manifest: cachedManifest, mode: 'preview' },
      `idem_render_cached_${suffix}`,
    );
    expect(cached).toMatchObject({ status: 'succeeded', cached: true, replayed: false });
    expect(engineCalls).toBe(1);
    expect(storedKeys).toEqual([`renders/${projectId}/${first.renderId}/preview.mp4`]);
  });

  it('cancels an active render through the persisted abort poll', async () => {
    const projectId = `prj_render_cancel_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '取消渲染',
        nameEn: 'Cancel Render',
        synopsis: 'Active render cancellation fixture.',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_render_test',
        locales: ['zh-CN'],
        aspectRatios: ['1:1'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );
    const renderId = `render_cancel_${suffix}`;
    await orchestrator.submit(
      { manifest: manifest(projectId, renderId), mode: 'preview' },
      `idem_render_cancel_${suffix}`,
    );
    await waitForStatus(renderId, 'running');
    await expect(orchestrator.cancel(renderId)).resolves.toEqual({ status: 'cancelled' });
    await waitForStatus(renderId, 'cancelled');

    const deadline = Date.now() + 2_000;
    while (!cancelAborted && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(cancelAborted).toBe(true);
    const cancelled = await repositories.renders.get(renderId);
    expect(cancelled.value.status).toBe('cancelled');
    expect(cancelled.value.outputUri).toBeUndefined();
  });
});
