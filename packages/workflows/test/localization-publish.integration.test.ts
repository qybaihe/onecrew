import { loadEnv } from '@onecrew/config';
import { localizationRequestSchema, projectSpecSchema, type LocalePack } from '@onecrew/contracts';
import { createDatabase, createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { buildCampaignPlan } from '@onecrew/localization';
import { S3MediaStore } from '@onecrew/media';
import { ProviderGateway, createProviderRegistry } from '@onecrew/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalizationOrchestrator } from '../src/localization-orchestrator.js';
import { BullLocalizationQueue, createLocalizationWorker } from '../src/localization-queue.js';
import { ProviderOrchestrator } from '../src/provider-orchestrator.js';
import { BullProviderQueue, createProviderWorker } from '../src/provider-queue.js';
import { PublishOrchestrator } from '../src/publish-orchestrator.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test', PROVIDER_MODE: 'mock' });
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const mediaStore = S3MediaStore.fromEnv(env);
const providerQueue = new BullProviderQueue(env.REDIS_URL);
const provider = new ProviderOrchestrator(
  repositories,
  new ProviderGateway(createProviderRegistry(env, mediaStore), { pollIntervalMs: 1 }),
  providerQueue,
  { softBudgetRatio: 0.8 },
);
const providerWorker = createProviderWorker(env.REDIS_URL, async (job) => provider.execute(job.data.jobId), 4);
const localizationQueue = new BullLocalizationQueue(env.REDIS_URL);
const localization = new LocalizationOrchestrator(
  repositories,
  localizationQueue,
  provider,
  { providerPollMs: 20, providerTimeoutMs: 10_000, cancelPollMs: 20 },
);
const localizationWorker = createLocalizationWorker(
  env.REDIS_URL,
  async (job) => localization.execute(job.data.localizationRunId),
  1,
);
const publish = new PublishOrchestrator(repositories, mediaStore);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function waitForLocalization(localizationRunId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const current = await localization.get(localizationRunId);
    if (current.value.status === 'succeeded') return current;
    if (current.value.status === 'failed') throw new Error(current.value.errorMessage ?? 'Localization failed');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for localization ${localizationRunId}`);
}

beforeAll(async () => {
  await mediaStore.ensureBucket();
  await Promise.all([providerWorker.waitUntilReady(), localizationWorker.waitUntilReady()]);
});

afterAll(async () => {
  await localizationWorker.close();
  await providerWorker.close();
  await localizationQueue.close();
  await providerQueue.close();
  mediaStore.destroy();
  await database.close();
});

describe('bilingual localization, shared-shot campaign and package export', () => {
  it('uses Mock LLM/TTS through the Provider queue, stores real WAVs, then writes package experiments', async () => {
    const projectId = `prj_locale_${suffix}`;
    await repositories.projects.create(projectSpecSchema.parse({
      projectId,
      nameZh: '山海星辰本地化',
      nameEn: 'Localized Shanhai Stars',
      synopsis: 'Bilingual package fixture.',
      audience: 'test',
      genres: ['fantasy'],
      ownerOpenId: 'ou_locale_test',
      locales: ['zh-CN', 'en-US'],
      aspectRatios: ['16:9', '9:16', '1:1'],
      budgetLimitCny: 100,
      status: 'draft',
    }));
    const sourcePack: LocalePack = {
      projectId,
      locale: 'zh-CN',
      version: 1,
      translationMode: 'source',
      title: '山海星辰',
      lines: Array.from({ length: 10 }, (_, index) => ({
        lineId: `line_zh_${index + 1}`,
        shotId: `shot_locale_${index + 1}`,
        speaker: index % 2 === 0 ? '林遥' : '岳岚',
        text: index === 0 ? '星图没有消失，它在等我们。' : `越过第 ${index + 1} 道星门。`,
        startMs: index * 6_000 + 500,
        endMs: index * 6_000 + 3_500,
        voiceId: index % 2 === 0 ? 'voice_lin' : 'voice_yue',
      })),
      cta: '立即启程',
      marketingCopy: ['最后一角星图，藏在山海尽头。'],
    };
    const sharedShots = Array.from({ length: 10 }, (_, index) => ({
      shotId: `shot_locale_${index + 1}`,
      videoUri: `mock://onecrew/video/shared-${index + 1}.mp4`,
      inFrame: index * 180,
      outFrame: (index + 1) * 180,
    }));
    const request = localizationRequestSchema.parse({
      projectId,
      sourceLocalePack: sourcePack,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice: { voice_lin: 'voice_lin_en', voice_yue: 'voice_yue_en' },
    });
    const submitted = await localization.submit(request, `idem_locale_${suffix}`);
    const localized = await waitForLocalization(submitted.localizationRunId);
    expect(localized.value).toMatchObject({ status: 'succeeded', mode: 'mock' });
    expect(localized.value.localePack?.locale).toBe('en-US');
    expect(localized.value.localePack?.lines).toHaveLength(10);
    expect(localized.value.localizedShots?.map((shot) => shot.videoUri)).toEqual(sharedShots.map((shot) => shot.videoUri));
    expect(localized.value.localizedShots!.at(-1)!.outFrame).toBeGreaterThanOrEqual(1_800);
    const firstAudio = await mediaStore.get(localized.value.localePack!.lines[0]!.audioUri!);
    expect(Buffer.from(firstAudio.bytes.subarray(0, 4)).toString('ascii')).toBe('RIFF');
    expect(localized.value.localePack!.lines[0]!.audioDurationMs).toBeGreaterThan(500);
    await expect(localization.submit(request, `idem_locale_${suffix}`)).resolves.toMatchObject({
      localizationRunId: submitted.localizationRunId,
      replayed: true,
    });

    const designPack = {
      designSystemId: 'design_shanhai_demo',
      version: '1.0.0',
      designMdUri: 'design-pack://design_shanhai_demo/versions/1/DESIGN.md',
      brandTokensUri: 'design-pack://design_shanhai_demo/versions/1/brand.tokens.json',
      motionTokensUri: 'design-pack://design_shanhai_demo/versions/1/motion.tokens.json',
      promoSpecUri: 'design-pack://design_shanhai_demo/versions/1/promo.spec.json',
      assetUris: [],
      source: 'manual' as const,
      sourceLicense: 'Original OneCrew fixture',
      createdAt: new Date().toISOString(),
    };
    const campaign = buildCampaignPlan({
      campaignId: `campaign_${suffix}`,
      projectId,
      designPack,
      zhLocalePack: sourcePack,
      enLocalePack: localized.value.localePack!,
      zhShots: sharedShots,
      enShots: localized.value.localizedShots!,
    });
    expect(campaign.variants).toHaveLength(8);
    expect(new Set(campaign.variants.flatMap((manifest) => manifest.shots.map((shot) => shot.videoUri)))).toEqual(
      new Set(sharedShots.map((shot) => shot.videoUri)),
    );

    const creatives = await Promise.all(campaign.variants.map(async (manifest) => {
      const media = await mediaStore.put({
        key: `stage7/${projectId}/${manifest.renderId}.mp4`,
        bytes: new TextEncoder().encode(`mock-render:${manifest.renderId}`),
        contentType: 'video/mp4',
      });
      return {
        creativeId: `creative_${createInputHash(manifest).slice(0, 24)}`,
        projectId,
        locale: manifest.locale,
        compositionId: manifest.compositionId as 'Trailer30' | 'Teaser15Vertical' | 'Bumper6' | 'MotionPoster',
        aspectRatio: manifest.aspectRatio,
        renderId: manifest.renderId,
        mediaUri: media.uri,
        hook: manifest.localePack.marketingCopy[0]!,
        cta: manifest.localePack.cta,
        platforms: manifest.locale === 'zh-CN' ? ['抖音' as const] : ['TikTok' as const, 'YouTube' as const],
      };
    }));
    const published = await publish.submit({
      publishId: `publish_${suffix}`,
      projectId,
      episode: 'EP01',
      designPack,
      localePacks: [sourcePack, localized.value.localePack!],
      creatives,
      delivery: 'package_export',
    }, `idem_publish_${suffix}`);
    expect(published).toMatchObject({ status: 'succeeded', feishuWriteback: 'mock_outbox' });
    expect(published.packageHash).toMatch(/^[a-f0-9]{64}$/);
    expect(published.packageBytes).toBeGreaterThan(1_000);
    const archive = await mediaStore.get(published.packageUri!);
    expect(Buffer.from(archive.bytes.subarray(0, 2)).toString('ascii')).toBe('PK');
    const experiments = await publish.listExperiments(projectId);
    expect(experiments).toHaveLength(12);
    expect(new Set(experiments.map((record) => record.language))).toEqual(new Set(['zh-CN', 'en-US']));
  });
});
