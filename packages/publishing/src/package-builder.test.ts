import { publishRequestSchema } from '@onecrew/contracts';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { buildPublishPackage } from './package-builder.js';

describe('deterministic package-only publishing', () => {
  it('exports media, bilingual packs, license/readme and experiment seeds in a valid ZIP', async () => {
    const now = new Date('2026-07-15T14:00:00.000Z');
    const basePack = {
      projectId: 'prj_publish_test',
      title: '山海星辰',
      lines: [{ lineId: 'line_1', shotId: 'shot_1', speaker: '林遥', text: '出发。', startMs: 0, endMs: 500, voiceId: 'voice_1' }],
      cta: '立即启程',
      marketingCopy: ['最后一角星图。'],
    };
    const creatives = ['zh-CN', 'en-US'].flatMap((locale) =>
      ['Trailer30', 'Teaser15Vertical', 'Bumper6', 'MotionPoster'].map((compositionId, index) => ({
        creativeId: `creative_${locale.replace('-', '_')}_${index}`,
        projectId: 'prj_publish_test',
        locale,
        compositionId,
        aspectRatio: compositionId === 'Trailer30' ? '16:9' : compositionId === 'Bumper6' ? '1:1' : '9:16',
        renderId: `render_${locale.replace('-', '_')}_${index}`,
        mediaUri: `s3://onecrew/renders/${locale}/${index}.mp4`,
        hook: locale === 'zh-CN' ? '星图在等我们。' : 'The star map is waiting.',
        cta: locale === 'zh-CN' ? '立即启程' : 'Begin the journey',
        platforms: locale === 'zh-CN' ? ['抖音'] : ['TikTok', 'YouTube'],
      })),
    );
    const request = publishRequestSchema.parse({
      publishId: 'publish_test',
      projectId: 'prj_publish_test',
      episode: 'EP01',
      designPack: {
        designSystemId: 'design_publish_test',
        version: '1.0.0',
        designMdUri: 'design-pack://design_publish_test/versions/1/DESIGN.md',
        brandTokensUri: 'design-pack://design_publish_test/versions/1/brand.tokens.json',
        motionTokensUri: 'design-pack://design_publish_test/versions/1/motion.tokens.json',
        promoSpecUri: 'design-pack://design_publish_test/versions/1/promo.spec.json',
        assetUris: [],
        source: 'manual',
        sourceLicense: 'Original test assets',
        createdAt: now.toISOString(),
      },
      localePacks: [
        { ...basePack, locale: 'zh-CN' },
        { ...basePack, locale: 'en-US', title: 'Shanhai Stars', cta: 'Begin the journey' },
      ],
      creatives,
    });
    const built = await buildPublishPackage(
      request,
      { async get(uri) { return { bytes: strToBytes(uri), contentType: 'video/mp4' }; } },
      now,
    );
    const files = unzipSync(built.bytes);
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      'manifest.json',
      'locales/zh-CN.json',
      'locales/en-US.json',
      'experiments/seed.json',
      'README.md',
      'LICENSES.md',
    ]));
    expect(Object.keys(files).filter((name) => name.startsWith('media/'))).toHaveLength(8);
    expect(JSON.parse(strFromU8(files['manifest.json']!))).toMatchObject({ delivery: 'package_export' });
    expect(built.experiments).toHaveLength(12);
    expect(built.packageHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

function strToBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}
