import { loadEnv } from '@onecrew/config';
import type { RenderManifest, RenderRecord } from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const env = loadEnv({ NODE_ENV: 'test' });
const now = new Date().toISOString();
const manifest: RenderManifest = {
  renderId: 'render_api_fixture',
  projectId: 'prj_api_fixture',
  compositionId: 'Bumper6',
  locale: 'zh-CN',
  aspectRatio: '1:1',
  fps: 30,
  designPack: {
    designSystemId: 'design_api_fixture',
    version: '1.0.0',
    designMdUri: 'design-pack://design_api_fixture/versions/1.0.0_hash/DESIGN.md',
    brandTokensUri: 'design-pack://design_api_fixture/versions/1.0.0_hash/brand.tokens.json',
    motionTokensUri: 'design-pack://design_api_fixture/versions/1.0.0_hash/motion.tokens.json',
    promoSpecUri: 'design-pack://design_api_fixture/versions/1.0.0_hash/promo.spec.json',
    assetUris: ['design-pack://design_api_fixture/versions/1.0.0_hash/assets/logo.svg'],
    source: 'manual',
    sourceLicense: 'test fixture',
    createdAt: now,
  },
  localePack: {
    projectId: 'prj_api_fixture',
    locale: 'zh-CN',
    title: 'API 渲染',
    lines: [
      {
        lineId: 'line_api_fixture',
        shotId: 'shot_api_fixture',
        speaker: '测试者',
        text: '开始渲染。',
        startMs: 0,
        endMs: 1_000,
        voiceId: 'voice_api_fixture',
      },
    ],
    cta: '立即观看',
    marketingCopy: ['六秒看见山海。'],
  },
  shots: [
    {
      shotId: 'shot_api_fixture',
      videoUri: 'mock://onecrew/video/api-fixture.mp4',
      inFrame: 0,
      outFrame: 180,
    },
  ],
  output: { codec: 'h264', width: 1080, height: 1080 },
};
const record: RenderRecord = {
  renderId: manifest.renderId,
  projectId: manifest.projectId,
  manifest,
  renderMode: 'preview',
  status: 'queued',
  manifestHash: createInputHash(manifest),
  designPackVersion: manifest.designPack.version,
  codeVersion: 'test',
  createdAt: now,
  updatedAt: now,
};
const app = createApp({
  env,
  probes: [],
  renders: {
    orchestrator: {
      async submit() {
        return {
          renderId: record.renderId,
          status: 'queued',
          mode: record.renderMode,
          statusUrl: `/v1/renders/${record.renderId}`,
          replayed: false,
          cached: false,
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

describe('Remotion Render API routes', () => {
  it('requires idempotency and submits validated manifests asynchronously', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/renders',
      payload: { manifest, mode: 'preview' },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'MissingRenderIdempotencyKeyError' });

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/renders',
      headers: { 'idempotency-key': 'idem_render_api_fixture' },
      payload: { manifest, mode: 'preview' },
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({
      render_id: record.renderId,
      status: 'queued',
      mode: 'preview',
      status_url: `/v1/renders/${record.renderId}`,
      replayed: false,
      cached: false,
    });
  });

  it('returns persistent RenderRecord state and supports cancellation', async () => {
    const status = await app.inject({ method: 'GET', url: `/v1/renders/${record.renderId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ render: { renderId: record.renderId }, version: 1 });

    const cancel = await app.inject({ method: 'POST', url: `/v1/renders/${record.renderId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({ status: 'cancelled' });
  });

  it('rejects a repeated single-asset episode before it enters the render queue', async () => {
    const paddedEpisode = {
      ...manifest,
      renderId: 'render_api_repeated_episode',
      compositionId: 'EpisodeMaster',
      aspectRatio: '16:9',
      output: { codec: 'h264', width: 1920, height: 1080 },
      shots: Array.from({ length: 10 }, (_, index) => ({
        shotId: `shot_repeated_${index + 1}`,
        videoUri: 'https://media.test/one-source.mp4',
        inFrame: index * 180,
        outFrame: (index + 1) * 180,
      })),
      localePack: {
        ...manifest.localePack,
        lines: Array.from({ length: 10 }, (_, index) => ({
          ...manifest.localePack.lines[0]!,
          lineId: `line_repeated_${index + 1}`,
          shotId: `shot_repeated_${index + 1}`,
          startMs: index * 6_000 + 500,
          endMs: index * 6_000 + 2_500,
        })),
      },
    };
    const response = await app.inject({
      method: 'POST',
      url: '/v1/renders',
      headers: { 'idempotency-key': 'idem_repeated_episode' },
      payload: { manifest: paddedEpisode, mode: 'preview' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: 'ZodError',
      details: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringMatching(/distinct video assets/) }),
      ]),
    });
  });
});
