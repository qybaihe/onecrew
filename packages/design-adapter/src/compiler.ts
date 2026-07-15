import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { designPackManifestSchema, type DesignPackManifest } from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';

import { parseDesignMarkdown, parseLabeledValues, parseList, type DesignSection } from './parser.js';
import {
  brandTokensSchema,
  compileReportSchema,
  motionTokensSchema,
  promoSpecSchema,
  type BrandTokens,
  type CompileReport,
  type MotionTokens,
  type PromoSpec,
} from './schemas.js';

const requiredSections: DesignSection[] = [
  'color',
  'typography',
  'spacing',
  'layout',
  'components',
  'motion',
  'voice',
  'brand',
  'antiPatterns',
];

const defaults: { brand: BrandTokens; motion: MotionTokens; promo: PromoSpec } = {
  brand: {
    schemaVersion: 'onecrew-brand-tokens/v1',
    colors: {
      primary: '#2F6FEB',
      secondary: '#F0B429',
      background: '#0B1020',
      text: '#F7F8FC',
      muted: '#AAB2C8',
      surface: '#151D33',
      success: '#2FBF71',
      warning: '#F0B429',
      danger: '#E5484D',
    },
    typography: {
      zhFamily: 'PingFang SC',
      enFamily: 'Inter',
      displayFamily: 'Songti SC',
      fallback: ['system-ui', 'sans-serif'],
      bodySizePx: 32,
      subtitleSizePx: 42,
      weights: [400, 600, 700],
      lineHeight: 1.35,
    },
    spacing: {
      unitPx: 8,
      scale: [0, 8, 16, 24, 32, 48, 64, 96],
      safeHorizontalPercent: 5,
      safeVerticalPercent: 8,
    },
    layout: {
      gridColumns: 12,
      maxWidthPx: 1920,
      portraitStrategy: 'center-crop hero subject and reflow titles into the upper safe area',
      squareStrategy: 'preserve the subject and move CTA into a bottom safe-area band',
    },
    components: {
      titleCard: 'high-contrast title over a restrained surface panel',
      lowerThird: 'compact nameplate with a single primary-color rule',
      subtitle: 'two lines maximum with a translucent background plate',
      cta: 'single primary action with logo lockup',
      logo: 'static safe fallback with optional restrained reveal',
    },
    voice: {
      zh: '克制、有画面感、句子短',
      en: 'cinematic, concise, and natural rather than literal',
    },
    brand: {
      nameZh: 'OneCrew',
      nameEn: 'OneCrew',
      logoAsset: 'assets/logo.svg',
      logoClearspacePx: 32,
    },
    antiPatterns: ['unlicensed assets', 'unsafe subtitle placement', 'decorative effects without narrative purpose'],
  },
  motion: {
    schemaVersion: 'onecrew-motion-tokens/v1',
    fps: 30,
    durationFrames: { fast: 6, normal: 12, slow: 24 },
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    defaultTransition: 'cross-dissolve',
    maxMotionDensity: 0.45,
    logoReveal: 'opacity and 1.02-to-1 scale, no bloom by default',
    reducedMotionFallback: 'cut with a 2-frame opacity settle',
  },
  promo: {
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

export interface CompileDesignPackOptions {
  designSystemId: string;
  version: string;
  sourceLicense: string;
  now?: Date;
}

export interface CompiledDesignPack {
  manifest: DesignPackManifest & { contentHash: string; compileReportUri: string };
  brandTokens: BrandTokens;
  motionTokens: MotionTokens;
  promoSpec: PromoSpec;
  report: CompileReport;
  versionDirectory: string;
}

function numberValue(values: Record<string, string>, key: string, fallback: number): number {
  const parsed = Number(values[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberList(values: Record<string, string>, key: string, fallback: number[]): number[] {
  const parsed = values[key]
    ?.split(/[,·\s]+/)
    .map(Number)
    .filter(Number.isFinite);
  return parsed && parsed.length > 0 ? parsed : fallback;
}

function textValue(values: Record<string, string>, key: string, fallback: string): string {
  return values[key]?.trim() || fallback;
}

function relativeUri(designSystemId: string, versionKey: string, filename: string): string {
  return `design-pack://${designSystemId}/versions/${versionKey}/${filename}`;
}

function luminance(hex: string): number {
  const channels = hex
    .slice(1, 7)
    .match(/.{2}/g)
    ?.map((value) => Number.parseInt(value, 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  if (!channels || channels.length !== 3) throw new Error(`Invalid color ${hex}`);
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(left: string, right: string): number {
  const [bright, dark] = [luminance(left), luminance(right)].sort((a, b) => b - a);
  return (bright! + 0.05) / (dark! + 0.05);
}

async function listFiles(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          throw new Error(`Symbolic links are not allowed in Design Packs: ${fullPath}`);
        }
        return entry.isDirectory()
          ? (await listFiles(fullPath)).map((item) => path.join(entry.name, item))
          : [entry.name];
      }),
    );
    return nested.flat().sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function validateAssets(packRoot: string): Promise<string[]> {
  const assetFiles = await listFiles(path.join(packRoot, 'assets'));
  const templateFiles = await listFiles(path.join(packRoot, 'templates'));
  const fontFiles = (await listFiles(path.join(packRoot, 'fonts'))).filter((file) =>
    /\.(?:woff2?|ttf|otf)$/i.test(file),
  );
  const provenanceGroups: Array<[string, string[]]> = [
    ['assets/LICENSES.md', assetFiles.filter((file) => file !== 'LICENSES.md')],
    ['templates/LICENSES.md', templateFiles.filter((file) => file !== 'LICENSES.md')],
    ['fonts/LICENSE.md', fontFiles.filter((file) => file !== 'LICENSE.md')],
  ];
  for (const [licenseFile, coveredFiles] of provenanceGroups) {
    if (coveredFiles.length === 0) continue;
    const licenseText = await readFile(path.join(packRoot, licenseFile), 'utf8');
    for (const file of coveredFiles) {
      if (!licenseText.includes(file)) {
        throw new Error(`Missing provenance entry for ${file} in ${licenseFile}`);
      }
    }
  }

  const validated: string[] = [];
  for (const relative of [
    ...assetFiles.map((file) => path.join('assets', file)),
    ...templateFiles.map((file) => path.join('templates', file)),
    ...fontFiles.map((file) => path.join('fonts', file)),
  ]) {
    if (!relative.toLowerCase().endsWith('.svg')) {
      validated.push(relative);
      continue;
    }
    const svg = await readFile(path.join(packRoot, relative), 'utf8');
    if (/<script\b|<foreignObject\b|\son\w+\s*=|javascript:|(?:href|xlink:href)\s*=\s*["']https?:/i.test(svg)) {
      throw new Error(`Unsafe SVG content in ${relative}`);
    }
    validated.push(relative);
  }
  return validated;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function hashFiles(packRoot: string, files: string[]): Promise<Array<[string, string]>> {
  return Promise.all(
    files.map(async (file): Promise<[string, string]> => [
      file,
      createHash('sha256').update(await readFile(path.join(packRoot, file))).digest('hex'),
    ]),
  );
}

async function copyImmutableFile(source: string, destination: string): Promise<void> {
  const content = await readFile(source);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    const existing = await readFile(destination);
    if (!existing.equals(content)) {
      throw new Error(`Immutable Design Pack version conflict at ${destination}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeFile(destination, content);
  }
}

async function existingCreatedAt(versionDirectory: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(path.join(versionDirectory, 'manifest.json'), 'utf8')) as {
      createdAt?: unknown;
    };
    if (typeof manifest.createdAt !== 'string') {
      throw new Error(`Existing Design Pack manifest has no createdAt: ${versionDirectory}`);
    }
    return manifest.createdAt;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function compileDesignPack(
  packRootInput: string,
  options: CompileDesignPackOptions,
): Promise<CompiledDesignPack> {
  if (!options.sourceLicense.trim()) throw new Error('Design Pack sourceLicense must not be empty');
  const packRoot = await realpath(packRootInput);
  const designMdPath = path.join(packRoot, 'DESIGN.md');
  const markdown = await readFile(designMdPath, 'utf8');
  if (/https?:\/\//i.test(markdown)) {
    throw new Error('Remote resources are not allowed in DESIGN.md; import them into controlled assets first');
  }
  const parsed = parseDesignMarkdown(markdown);
  const values = Object.fromEntries(
    requiredSections.map((section) => [section, parseLabeledValues(parsed.sections[section])]),
  ) as Record<DesignSection, Record<string, string>>;
  const sectionStatus = Object.fromEntries(
    requiredSections.map((section) => [section, parsed.sections[section] ? 'parsed' : 'defaulted']),
  );
  const warnings = requiredSections
    .filter((section) => !parsed.sections[section])
    .map((section) => `Missing ${section} section; system defaults were applied.`);

  const brandTokens = brandTokensSchema.parse({
    ...defaults.brand,
    colors: {
      primary: textValue(values.color, 'primary', defaults.brand.colors.primary),
      secondary: textValue(values.color, 'secondary', defaults.brand.colors.secondary),
      background: textValue(values.color, 'background', defaults.brand.colors.background),
      text: textValue(values.color, 'text', defaults.brand.colors.text),
      muted: textValue(values.color, 'muted', defaults.brand.colors.muted),
      surface: textValue(values.color, 'surface', defaults.brand.colors.surface),
      success: textValue(values.color, 'success', defaults.brand.colors.success),
      warning: textValue(values.color, 'warning', defaults.brand.colors.warning),
      danger: textValue(values.color, 'danger', defaults.brand.colors.danger),
    },
    typography: {
      zhFamily: textValue(values.typography, 'chinese font', defaults.brand.typography.zhFamily),
      enFamily: textValue(values.typography, 'english font', defaults.brand.typography.enFamily),
      displayFamily: textValue(values.typography, 'display font', defaults.brand.typography.displayFamily),
      fallback: textValue(values.typography, 'fallback', defaults.brand.typography.fallback.join(', '))
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
      bodySizePx: numberValue(values.typography, 'body size', defaults.brand.typography.bodySizePx),
      subtitleSizePx: numberValue(
        values.typography,
        'subtitle size',
        defaults.brand.typography.subtitleSizePx,
      ),
      weights: numberList(values.typography, 'weights', defaults.brand.typography.weights),
      lineHeight: numberValue(values.typography, 'line height', defaults.brand.typography.lineHeight),
    },
    spacing: {
      unitPx: numberValue(values.spacing, 'unit', defaults.brand.spacing.unitPx),
      scale: numberList(values.spacing, 'scale', defaults.brand.spacing.scale),
      safeHorizontalPercent: numberValue(
        values.spacing,
        'safe horizontal',
        defaults.brand.spacing.safeHorizontalPercent,
      ),
      safeVerticalPercent: numberValue(
        values.spacing,
        'safe vertical',
        defaults.brand.spacing.safeVerticalPercent,
      ),
    },
    layout: {
      gridColumns: numberValue(values.layout, 'grid columns', defaults.brand.layout.gridColumns),
      maxWidthPx: numberValue(values.layout, 'max width', defaults.brand.layout.maxWidthPx),
      portraitStrategy: textValue(
        values.layout,
        'portrait strategy',
        defaults.brand.layout.portraitStrategy,
      ),
      squareStrategy: textValue(values.layout, 'square strategy', defaults.brand.layout.squareStrategy),
    },
    components: {
      titleCard: textValue(values.components, 'title card', defaults.brand.components.titleCard),
      lowerThird: textValue(values.components, 'lower third', defaults.brand.components.lowerThird),
      subtitle: textValue(values.components, 'subtitle', defaults.brand.components.subtitle),
      cta: textValue(values.components, 'cta', defaults.brand.components.cta),
      logo: textValue(values.components, 'logo', defaults.brand.components.logo),
    },
    voice: {
      zh: textValue(values.voice, 'chinese tone', defaults.brand.voice.zh),
      en: textValue(values.voice, 'english tone', defaults.brand.voice.en),
    },
    brand: {
      nameZh: textValue(values.brand, 'name zh', defaults.brand.brand.nameZh),
      nameEn: textValue(values.brand, 'name en', defaults.brand.brand.nameEn),
      logoAsset: textValue(values.brand, 'logo asset', defaults.brand.brand.logoAsset),
      logoClearspacePx: numberValue(
        values.brand,
        'logo clearspace',
        defaults.brand.brand.logoClearspacePx,
      ),
    },
    antiPatterns:
      parseList(parsed.sections.antiPatterns).length > 0
        ? parseList(parsed.sections.antiPatterns)
        : defaults.brand.antiPatterns,
  });
  if (contrast(brandTokens.colors.text, brandTokens.colors.background) < 4.5) {
    throw new Error('Design Pack text/background contrast is below 4.5:1');
  }

  const motionTokens = motionTokensSchema.parse({
    ...defaults.motion,
    durationFrames: {
      fast: numberValue(values.motion, 'fast frames', defaults.motion.durationFrames.fast),
      normal: numberValue(values.motion, 'normal frames', defaults.motion.durationFrames.normal),
      slow: numberValue(values.motion, 'slow frames', defaults.motion.durationFrames.slow),
    },
    easing: textValue(values.motion, 'easing', defaults.motion.easing),
    defaultTransition: textValue(
      values.motion,
      'default transition',
      defaults.motion.defaultTransition,
    ),
    maxMotionDensity: numberValue(
      values.motion,
      'max motion density',
      defaults.motion.maxMotionDensity,
    ),
    logoReveal: textValue(values.motion, 'logo reveal', defaults.motion.logoReveal),
    reducedMotionFallback: textValue(
      values.motion,
      'reduced motion fallback',
      defaults.motion.reducedMotionFallback,
    ),
  });
  const promoSpec = promoSpecSchema.parse(defaults.promo);
  const validatedAssets = await validateAssets(packRoot);
  await access(path.join(packRoot, brandTokens.brand.logoAsset));
  const assetHashes = await hashFiles(packRoot, validatedAssets);

  const contentHash = createInputHash({
    markdown,
    brandTokens,
    motionTokens,
    promoSpec,
    assetHashes,
    designSystemId: options.designSystemId,
    version: options.version,
    sourceLicense: options.sourceLicense,
  });
  const versionKey = `${options.version}_${contentHash.slice(0, 12)}`;
  const versionDirectory = path.join(packRoot, 'versions', versionKey);
  await mkdir(versionDirectory, { recursive: true });
  const createdAt = (await existingCreatedAt(versionDirectory)) ?? (options.now ?? new Date()).toISOString();
  const report = compileReportSchema.parse({
    designSystemId: options.designSystemId,
    version: options.version,
    contentHash,
    source: 'open-design',
    sections: sectionStatus,
    warnings,
    validatedAssets,
    createdAt,
  });
  const manifest = {
    ...designPackManifestSchema.parse({
      designSystemId: options.designSystemId,
      version: options.version,
      designMdUri: relativeUri(options.designSystemId, versionKey, 'DESIGN.md'),
      brandTokensUri: relativeUri(options.designSystemId, versionKey, 'brand.tokens.json'),
      motionTokensUri: relativeUri(options.designSystemId, versionKey, 'motion.tokens.json'),
      promoSpecUri: relativeUri(options.designSystemId, versionKey, 'promo.spec.json'),
      assetUris: validatedAssets.map((asset) => relativeUri(options.designSystemId, versionKey, asset)),
      source: 'open-design',
      sourceLicense: options.sourceLicense,
      createdAt,
    }),
    contentHash,
    compileReportUri: relativeUri(options.designSystemId, versionKey, 'compile-report.json'),
  };

  const snapshots: Array<[string, string | object]> = [
    ['DESIGN.md', markdown],
    ['brand.tokens.json', brandTokens],
    ['motion.tokens.json', motionTokens],
    ['promo.spec.json', promoSpec],
    ['compile-report.json', report],
    ['manifest.json', manifest],
  ];
  for (const [filename, value] of snapshots) {
    const content = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
    const versionPath = path.join(versionDirectory, filename);
    try {
      const existing = await readFile(versionPath, 'utf8');
      if (existing !== content) throw new Error(`Immutable Design Pack version conflict at ${versionPath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await writeFile(versionPath, content, 'utf8');
    }
  }
  for (const asset of validatedAssets) {
    await copyImmutableFile(path.join(packRoot, asset), path.join(versionDirectory, asset));
  }

  await writeJson(path.join(packRoot, 'brand.tokens.json'), brandTokens);
  await writeJson(path.join(packRoot, 'motion.tokens.json'), motionTokens);
  await writeJson(path.join(packRoot, 'promo.spec.json'), promoSpec);
  await writeJson(path.join(packRoot, 'compile-report.json'), report);
  await writeJson(path.join(packRoot, 'manifest.json'), manifest);

  return { manifest, brandTokens, motionTokens, promoSpec, report, versionDirectory };
}
