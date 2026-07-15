import { access, readFile } from 'node:fs/promises';
import path from 'node:path';

import { designPackManifestSchema } from '@onecrew/contracts';
import { z } from 'zod';

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

const compiledManifestSchema = designPackManifestSchema.extend({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  compileReportUri: z.url(),
});

export interface LoadedDesignPack {
  manifest: z.infer<typeof compiledManifestSchema>;
  designMarkdown: string;
  brandTokens: BrandTokens;
  motionTokens: MotionTokens;
  promoSpec: PromoSpec;
  report: CompileReport;
}

function resolvePackUri(versionDirectory: string, designSystemId: string, uri: string): string {
  const parsed = new URL(uri);
  if (parsed.protocol !== 'design-pack:' || parsed.hostname.toLowerCase() !== designSystemId.toLowerCase()) {
    throw new Error(`Design Pack URI is outside ${designSystemId}: ${uri}`);
  }
  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.length < 3 ||
    segments[0] !== 'versions' ||
    segments[1] !== path.basename(versionDirectory) ||
    segments.slice(2).some((segment) => segment === '.' || segment === '..' || segment.includes('/'))
  ) {
    throw new Error(`Invalid Design Pack version URI: ${uri}`);
  }
  return path.join(versionDirectory, ...segments.slice(2));
}

async function readJson(uri: string, versionDirectory: string, designSystemId: string): Promise<unknown> {
  return JSON.parse(await readFile(resolvePackUri(versionDirectory, designSystemId, uri), 'utf8'));
}

export async function loadCompiledDesignPack(versionDirectory: string): Promise<LoadedDesignPack> {
  const manifest = compiledManifestSchema.parse(
    JSON.parse(await readFile(path.join(versionDirectory, 'manifest.json'), 'utf8')),
  );
  const designMarkdown = await readFile(
    resolvePackUri(versionDirectory, manifest.designSystemId, manifest.designMdUri),
    'utf8',
  );
  const brandTokens = brandTokensSchema.parse(
    await readJson(manifest.brandTokensUri, versionDirectory, manifest.designSystemId),
  );
  const motionTokens = motionTokensSchema.parse(
    await readJson(manifest.motionTokensUri, versionDirectory, manifest.designSystemId),
  );
  const promoSpec = promoSpecSchema.parse(
    await readJson(manifest.promoSpecUri, versionDirectory, manifest.designSystemId),
  );
  const report = compileReportSchema.parse(
    await readJson(manifest.compileReportUri, versionDirectory, manifest.designSystemId),
  );
  if (
    report.designSystemId !== manifest.designSystemId ||
    report.version !== manifest.version ||
    report.contentHash !== manifest.contentHash
  ) {
    throw new Error('Design Pack manifest and compile report do not match');
  }
  await Promise.all(
    manifest.assetUris.map((uri) => access(resolvePackUri(versionDirectory, manifest.designSystemId, uri))),
  );
  return { manifest, designMarkdown, brandTokens, motionTokens, promoSpec, report };
}
