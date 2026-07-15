import { localizationRequestSchema, type GeneratedAudio, type LocalePack } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { buildCampaignPlan, buildLocalizedTimeline, createMockEnglishDraft } from './index.js';

const source: LocalePack = {
  projectId: 'prj_localization_test',
  locale: 'zh-CN',
  title: '山海星辰',
  lines: [
    { lineId: 'line_zh_1', shotId: 'shot_1', speaker: '林遥', text: '星图没有消失，它在等我们。', startMs: 500, endMs: 2_500, voiceId: 'voice_lin' },
    { lineId: 'line_zh_2', shotId: 'shot_2', speaker: '岳岚', text: '那就把最后一角找回来。', startMs: 6_500, endMs: 8_500, voiceId: 'voice_yue' },
  ],
  cta: '立即启程',
  marketingCopy: ['最后一角星图，藏在山海尽头。'],
};
const sharedShots = [
  { shotId: 'shot_1', videoUri: 'mock://onecrew/video/shared-1.mp4', inFrame: 0, outFrame: 180 },
  { shotId: 'shot_2', videoUri: 'mock://onecrew/video/shared-2.mp4', inFrame: 180, outFrame: 360 },
];

describe('TTS-duration-driven localization', () => {
  it('keeps shot assets and expands only localized timing', () => {
    const request = localizationRequestSchema.parse({
      projectId: source.projectId,
      sourceLocalePack: source,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice: { voice_lin: 'voice_lin_en', voice_yue: 'voice_yue_en' },
    });
    const audio = source.lines.map((line, index) => ({
      sourceLineId: line.lineId,
      output: {
        uri: `s3://onecrew/tts/${line.lineId}.wav`,
        mimeType: 'audio/wav',
        durationMs: index === 0 ? 7_000 : 3_000,
      } satisfies GeneratedAudio & { durationMs: number },
    }));
    const localized = buildLocalizedTimeline(request, createMockEnglishDraft(source), audio, 'mock');
    expect(localized.localizedShots.map((shot) => [shot.shotId, shot.videoUri])).toEqual(
      sharedShots.map((shot) => [shot.shotId, shot.videoUri]),
    );
    expect(localized.localizedShots[0]!.outFrame - localized.localizedShots[0]!.inFrame).toBeGreaterThan(180);
    expect(localized.localePack.lines[0]).toMatchObject({
      sourceLineId: 'line_zh_1',
      voiceId: 'voice_lin_en',
      audioDurationMs: 7_000,
      audioUri: 's3://onecrew/tts/line_zh_1.wav',
    });
  });

  it('builds eight bilingual campaign manifests with identical shot/video identities', () => {
    const request = localizationRequestSchema.parse({
      projectId: source.projectId,
      sourceLocalePack: source,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice: { voice_lin: 'voice_lin_en', voice_yue: 'voice_yue_en' },
    });
    const localized = buildLocalizedTimeline(
      request,
      createMockEnglishDraft(source),
      source.lines.map((line) => ({
        sourceLineId: line.lineId,
        output: { uri: `s3://onecrew/tts/${line.lineId}.wav`, mimeType: 'audio/wav', durationMs: 2_000 },
      })),
      'mock',
    );
    const designPack = {
      designSystemId: 'design_localization_test',
      version: '1.0.0',
      designMdUri: 'design-pack://design_localization_test/versions/1/DESIGN.md',
      brandTokensUri: 'design-pack://design_localization_test/versions/1/brand.tokens.json',
      motionTokensUri: 'design-pack://design_localization_test/versions/1/motion.tokens.json',
      promoSpecUri: 'design-pack://design_localization_test/versions/1/promo.spec.json',
      assetUris: [],
      source: 'manual' as const,
      createdAt: new Date().toISOString(),
    };
    const campaign = buildCampaignPlan({
      campaignId: 'campaign_localization_test',
      projectId: source.projectId,
      designPack,
      zhLocalePack: source,
      enLocalePack: localized.localePack,
      zhShots: sharedShots,
      enShots: localized.localizedShots,
    });
    expect(campaign.variants).toHaveLength(8);
    expect(new Set(campaign.variants.map((manifest) => manifest.locale))).toEqual(new Set(['zh-CN', 'en-US']));
    for (const manifest of campaign.variants) {
      expect(manifest.shots.map((shot) => shot.videoUri)).toEqual(sharedShots.map((shot) => shot.videoUri));
    }
  });
});
