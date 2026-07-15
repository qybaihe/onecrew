import { z } from 'zod';

const hex = z.string().regex(/^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/);

export const brandTokensSchema = z.object({
  schemaVersion: z.literal('onecrew-brand-tokens/v1'),
  colors: z.object({
    primary: hex,
    secondary: hex,
    background: hex,
    text: hex,
    muted: hex,
    surface: hex,
    success: hex,
    warning: hex,
    danger: hex,
  }),
  typography: z.object({
    zhFamily: z.string().min(1),
    enFamily: z.string().min(1),
    displayFamily: z.string().min(1),
    fallback: z.array(z.string().min(1)).min(1),
    bodySizePx: z.number().int().positive(),
    subtitleSizePx: z.number().int().positive(),
    weights: z.array(z.number().int().min(100).max(900)).min(1),
    lineHeight: z.number().positive(),
  }),
  spacing: z.object({
    unitPx: z.number().positive(),
    scale: z.array(z.number().nonnegative()).min(2),
    safeHorizontalPercent: z.number().min(0).max(30),
    safeVerticalPercent: z.number().min(0).max(30),
  }),
  layout: z.object({
    gridColumns: z.number().int().positive(),
    maxWidthPx: z.number().int().positive(),
    portraitStrategy: z.string().min(1),
    squareStrategy: z.string().min(1),
  }),
  components: z.object({
    titleCard: z.string().min(1),
    lowerThird: z.string().min(1),
    subtitle: z.string().min(1),
    cta: z.string().min(1),
    logo: z.string().min(1),
  }),
  voice: z.object({
    zh: z.string().min(1),
    en: z.string().min(1),
  }),
  brand: z.object({
    nameZh: z.string().min(1),
    nameEn: z.string().min(1),
    logoAsset: z.string().min(1),
    logoClearspacePx: z.number().nonnegative(),
  }),
  antiPatterns: z.array(z.string().min(1)).min(1),
});

export const motionTokensSchema = z.object({
  schemaVersion: z.literal('onecrew-motion-tokens/v1'),
  fps: z.literal(30),
  durationFrames: z.object({
    fast: z.number().int().positive(),
    normal: z.number().int().positive(),
    slow: z.number().int().positive(),
  }),
  easing: z.string().min(1),
  defaultTransition: z.string().min(1),
  maxMotionDensity: z.number().min(0).max(1),
  logoReveal: z.string().min(1),
  reducedMotionFallback: z.string().min(1),
});

const promoBeatSchema = z.object({
  startSec: z.number().nonnegative(),
  endSec: z.number().positive(),
  purpose: z.string().min(1),
});

export const promoSpecSchema = z.object({
  schemaVersion: z.literal('onecrew-promo-spec/v1'),
  trailer30: z.array(promoBeatSchema).min(1),
  teaser15Vertical: z.array(promoBeatSchema).min(1),
  bumper6: z.array(promoBeatSchema).min(1),
  motionPoster: z.object({ durationSec: z.number().min(5).max(8), loop: z.boolean() }),
  requiredTemplates: z.array(z.string().min(1)).min(4),
});

export const compileReportSchema = z.object({
  designSystemId: z.string().min(1),
  version: z.string().min(1),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.literal('open-design'),
  sections: z.record(z.string(), z.enum(['parsed', 'defaulted'])),
  warnings: z.array(z.string()),
  validatedAssets: z.array(z.string()),
  createdAt: z.iso.datetime({ offset: true }),
});

export type BrandTokens = z.infer<typeof brandTokensSchema>;
export type MotionTokens = z.infer<typeof motionTokensSchema>;
export type PromoSpec = z.infer<typeof promoSpecSchema>;
export type CompileReport = z.infer<typeof compileReportSchema>;
