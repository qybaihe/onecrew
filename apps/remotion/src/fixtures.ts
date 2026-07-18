import type {
  CompositionId,
  DesignPackManifest,
  Locale,
  LocalePack,
  RenderManifest,
} from '@onecrew/contracts';

import type { RemotionInputProps, ResolvedDesignPack } from './types.js';

export const fixtureDesignManifest: DesignPackManifest = {
  designSystemId: 'design_shanhai_demo',
  version: '1.0.0',
  designMdUri: 'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/DESIGN.md',
  brandTokensUri:
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/brand.tokens.json',
  motionTokensUri:
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/motion.tokens.json',
  promoSpecUri:
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/promo.spec.json',
  assetUris: [
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/assets/LICENSES.md',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/assets/logo.svg',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/assets/star-texture.svg',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/templates/LICENSES.md',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/templates/end-card.svg',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/templates/lower-third.svg',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/templates/poster-frame.svg',
    'design-pack://design_shanhai_demo/versions/1.0.0_c590888620ae/templates/title-card.svg',
  ],
  source: 'open-design',
  sourceLicense: 'Original OneCrew shanhai-demo design system; repository project license applies.',
  createdAt: '2026-07-15T11:21:45.694Z',
};

export const fixtureResolvedDesign: ResolvedDesignPack = {
  contentHash: 'c590888620ae34c2d255004b6c1ba9ebdb329fbe9f0e8073aa53284120f65759',
  logoDataUri:
    'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjAgMTIwIj48cGF0aCBmaWxsPSIjMkVDNEI2IiBkPSJNMTAgOTUgNDMgMzhsMTcgMjkgMTctMjkgMzMgNTd6Ii8+PGNpcmNsZSBjeD0iNjAiIGN5PSIyNSIgcj0iOCIgZmlsbD0iI0ZGQjcwMyIvPjwvc3ZnPg==',
  brandTokens: {
    schemaVersion: 'onecrew-brand-tokens/v1',
    colors: {
      primary: '#2EC4B6',
      secondary: '#FFB703',
      background: '#07111F',
      text: '#F7F3E8',
      muted: '#A6B5C5',
      surface: '#11263A',
      success: '#38B000',
      warning: '#FFB703',
      danger: '#EF476F',
    },
    typography: {
      zhFamily: 'PingFang SC',
      enFamily: 'Inter',
      displayFamily: 'Songti SC',
      fallback: ['system-ui', 'sans-serif'],
      bodySizePx: 32,
      subtitleSizePx: 44,
      weights: [400, 600, 700],
      lineHeight: 1.35,
    },
    spacing: {
      unitPx: 8,
      scale: [0, 8, 16, 24, 32, 48, 64, 96],
      safeHorizontalPercent: 6,
      safeVerticalPercent: 8,
    },
    layout: {
      gridColumns: 12,
      maxWidthPx: 1920,
      portraitStrategy: 'keep hero in center 56 percent',
      squareStrategy: 'preserve hero and use a bottom CTA band',
    },
    components: {
      titleCard: 'warm serif title over deep blue',
      lowerThird: 'translucent navy with teal rule',
      subtitle: 'two lines on high contrast plate',
      cta: 'amber action line with logo',
      logo: 'mountain-star mark',
    },
    voice: {
      zh: '克制、辽阔、有人情味，短句优先',
      en: 'cinematic, concise, human, and locally idiomatic',
    },
    brand: {
      nameZh: '山海星辰',
      nameEn: 'Shanhai Stars',
      logoAsset: 'assets/logo.svg',
      logoClearspacePx: 32,
    },
    antiPatterns: ['牺牲字幕安全区换取画面冲击'],
  },
  motionTokens: {
    schemaVersion: 'onecrew-motion-tokens/v1',
    fps: 30,
    durationFrames: { fast: 6, normal: 12, slow: 24 },
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    defaultTransition: 'cross-dissolve',
    maxMotionDensity: 0.4,
    logoReveal: 'opacity and restrained scale settle',
    reducedMotionFallback: 'hard cut and two-frame opacity settle',
  },
  promoSpec: {
    schemaVersion: 'onecrew-promo-spec/v1',
    trailer30: [
      { startSec: 0, endSec: 3, purpose: 'strongest conflict hook' },
      { startSec: 3, endSec: 8, purpose: 'character and goal' },
      { startSec: 8, endSec: 18, purpose: 'escalation' },
      { startSec: 18, endSec: 25, purpose: 'twist or suspense' },
      { startSec: 25, endSec: 30, purpose: 'title, logo, CTA' },
    ],
    teaser15Vertical: [
      { startSec: 0, endSec: 2, purpose: 'conflict line' },
      { startSec: 2, endSec: 9, purpose: 'two high-information shots' },
      { startSec: 9, endSec: 12, purpose: 'suspense' },
      { startSec: 12, endSec: 15, purpose: 'title and CTA' },
    ],
    bumper6: [
      { startSec: 0, endSec: 1, purpose: 'visual impact' },
      { startSec: 1, endSec: 4, purpose: 'core promise or twist' },
      { startSec: 4, endSec: 6, purpose: 'logo and action' },
    ],
    motionPoster: { durationSec: 6, loop: true },
    requiredTemplates: [
      'templates/title-card.svg',
      'templates/lower-third.svg',
      'templates/end-card.svg',
      'templates/poster-frame.svg',
    ],
  },
};

function localePack(locale: Locale): LocalePack {
  return {
    projectId: 'prj_shanhai_demo',
    locale,
    title: locale === 'zh-CN' ? '山海星辰' : 'Shanhai Stars',
    lines: Array.from({ length: 10 }, (_, index) => ({
      lineId: `line_${locale === 'zh-CN' ? 'zh' : 'en'}_${index + 1}`,
      shotId: `shot_demo_${String(index + 1).padStart(3, '0')}`,
      speaker: index % 2 === 0 ? (locale === 'zh-CN' ? '林遥' : 'Lin Yao') : locale === 'zh-CN' ? '岳岚' : 'Yue Lan',
      text:
        locale === 'zh-CN'
          ? index === 0
            ? '星图没有消失，它在等我们。'
            : `越过第 ${index + 1} 道星门。`
          : index === 0
            ? 'The star map is waiting for us.'
            : `Beyond stargate ${index + 1}.`,
      startMs: index * 6_000 + 500,
      endMs: index * 6_000 + 4_500,
      voiceId: index % 2 === 0 ? 'voice_lin' : 'voice_yue',
    })),
    cta: locale === 'zh-CN' ? '立即启程' : 'Begin the journey',
    marketingCopy:
      locale === 'zh-CN'
        ? ['最后一角星图，藏在山海尽头。']
        : ['The final star-map shard lies beyond the known world.'],
  };
}

const formats: Record<CompositionId, { locale: Locale; aspectRatio: '16:9' | '9:16' | '1:1'; width: number; height: number }> = {
  EpisodeMaster: { locale: 'zh-CN', aspectRatio: '16:9', width: 1920, height: 1080 },
  EpisodeLocalized: { locale: 'en-US', aspectRatio: '16:9', width: 1920, height: 1080 },
  Trailer30: { locale: 'zh-CN', aspectRatio: '16:9', width: 1920, height: 1080 },
  Teaser15Vertical: { locale: 'zh-CN', aspectRatio: '9:16', width: 1080, height: 1920 },
  Bumper6: { locale: 'zh-CN', aspectRatio: '1:1', width: 1080, height: 1080 },
  MotionPoster: { locale: 'zh-CN', aspectRatio: '9:16', width: 1080, height: 1920 },
  PipelineSmoke: { locale: 'zh-CN', aspectRatio: '16:9', width: 1920, height: 1080 },
};

export function createFixtureManifest(compositionId: CompositionId): RenderManifest {
  const format = formats[compositionId];
  const pack = localePack(format.locale);
  const allShots: RenderManifest['shots'] = Array.from({ length: 10 }, (_, index) => ({
    shotId: `shot_demo_${String(index + 1).padStart(3, '0')}`,
    videoUri: `mock://onecrew/video/shot-${index + 1}.mp4`,
    inFrame: index * 180,
    outFrame: (index + 1) * 180,
    sourceStartFrame: 0,
    sourceEndFrame: 180,
    crop: { x: 0.5, y: 0.5, scale: index % 2 === 0 ? 1.04 : 1.1 },
  }));
  const smoke = compositionId === 'PipelineSmoke';
  return {
    renderId: `render_demo_${compositionId}`,
    projectId: 'prj_shanhai_demo',
    compositionId,
    locale: format.locale,
    aspectRatio: format.aspectRatio,
    fps: 30,
    designPack: fixtureDesignManifest,
    localePack: smoke ? { ...pack, lines: pack.lines.slice(0, 1) } : pack,
    shots: smoke ? allShots.slice(0, 1) : allShots,
    output: { codec: 'h264', width: format.width, height: format.height },
  };
}

export function createFixtureInput(compositionId: CompositionId): RemotionInputProps {
  return {
    manifest: createFixtureManifest(compositionId),
    design: fixtureResolvedDesign,
    renderMode: 'preview',
  };
}

export const allFixtureInputs = (Object.keys(formats) as CompositionId[]).map(createFixtureInput);
