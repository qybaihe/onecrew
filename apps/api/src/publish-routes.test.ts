import { loadEnv } from '@onecrew/config';
import type {
  CampaignCreative,
  DesignPackManifest,
  ExperimentRecord,
  LocalePack,
  PublishRecord,
  PublishRequest,
} from '@onecrew/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const now = new Date().toISOString();
const projectId = 'prj_publish_api';
const designPack: DesignPackManifest = {
  designSystemId: 'design_publish_api',
  version: '1.0.0',
  designMdUri: 'https://design.example.com/DESIGN.md',
  brandTokensUri: 'https://design.example.com/brand.tokens.json',
  motionTokensUri: 'https://design.example.com/motion.tokens.json',
  promoSpecUri: 'https://design.example.com/promo.spec.json',
  assetUris: ['https://design.example.com/logo.svg'],
  source: 'manual',
  sourceLicense: 'test fixture',
  createdAt: now,
};
function pack(locale: 'zh-CN' | 'en-US'): LocalePack {
  return {
    projectId,
    locale,
    title: locale === 'zh-CN' ? '山海星辰' : 'Beyond Mountains and Seas',
    lines: [],
    cta: locale === 'zh-CN' ? '立即观看' : 'Watch now',
    marketingCopy: [locale === 'zh-CN' ? '向星辰启程。' : 'Set course for the stars.'],
  };
}
const compositions = ['Trailer30', 'Teaser15Vertical', 'Bumper6', 'MotionPoster'] as const;
const creatives: CampaignCreative[] = (['zh-CN', 'en-US'] as const).flatMap((locale) =>
  compositions.map((compositionId, index) => ({
    creativeId: `creative_${locale.replace('-', '_')}_${index}`,
    projectId,
    locale,
    compositionId,
    aspectRatio: compositionId === 'Teaser15Vertical' ? ('9:16' as const) : ('16:9' as const),
    renderId: `render_${locale.replace('-', '_')}_${index}`,
    mediaUri: `https://media.example.com/${locale}/${compositionId}.mp4`,
    hook: locale === 'zh-CN' ? '山海尽头有什么？' : 'What waits beyond the mountains and seas?',
    cta: locale === 'zh-CN' ? '立即观看' : 'Watch now',
    platforms: compositionId === 'Teaser15Vertical' ? ['抖音', 'TikTok'] : ['其他'],
  })),
);
const request: PublishRequest = {
  publishId: 'publish_api_fixture',
  projectId,
  episode: 'EP01',
  designPack,
  localePacks: [pack('zh-CN'), pack('en-US')],
  creatives,
  delivery: 'package_export',
};
const record: PublishRecord = {
  publishId: request.publishId,
  request,
  status: 'succeeded',
  packageUri: 'https://media.example.com/packages/publish-api-fixture.zip',
  packageHash: 'a'.repeat(64),
  packageBytes: 4_096,
  experimentIds: ['experiment_api_fixture'],
  feishuWriteback: 'mock_outbox',
  createdAt: now,
  updatedAt: now,
};
const experiment: ExperimentRecord = {
  experimentId: 'experiment_api_fixture',
  projectId,
  creativeId: creatives[0]!.creativeId,
  episode: 'EP01',
  language: 'zh-CN',
  platform: '其他',
  hook: creatives[0]!.hook,
  spend: 0,
  retention3s: 0,
  retention15s: 0,
  ctr: 0,
  conversion: 0,
  roas: 0,
  recommendation: '先用小流量验证前三秒留存。',
  createdAt: now,
  updatedAt: now,
};
const app = createApp({
  env: loadEnv({ NODE_ENV: 'test' }),
  probes: [],
  publishes: {
    orchestrator: {
      async submit() {
        return record;
      },
      async get() {
        return { value: record, version: 1 };
      },
      async listExperiments() {
        return [experiment];
      },
    },
  },
});

afterAll(async () => app.close());

describe('publish API routes', () => {
  it('requires idempotency and returns a completed package export', async () => {
    const missing = await app.inject({ method: 'POST', url: '/v1/publishes', payload: request });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'MissingPublishIdempotencyKeyError' });

    const created = await app.inject({
      method: 'POST',
      url: '/v1/publishes',
      headers: { 'idempotency-key': 'idem_publish_api' },
      payload: request,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ publish: { publishId: request.publishId, status: 'succeeded' } });
  });

  it('returns package state and the experiment ledger', async () => {
    const status = await app.inject({ method: 'GET', url: `/v1/publishes/${request.publishId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ publish: { packageHash: 'a'.repeat(64) }, version: 1 });

    const experiments = await app.inject({ method: 'GET', url: `/v1/projects/${projectId}/experiments` });
    expect(experiments.statusCode).toBe(200);
    expect(experiments.json()).toMatchObject({ experiments: [{ experimentId: experiment.experimentId }] });
  });
});
