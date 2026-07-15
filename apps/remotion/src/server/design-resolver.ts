import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { designPackManifestSchema, type DesignPackManifest } from '@onecrew/contracts';
import { loadCompiledDesignPack } from '@onecrew/design-adapter';
import { createInputHash } from '@onecrew/domain';

import type { ResolvedDesignPack } from '../types.js';

function versionDirectoryName(manifest: DesignPackManifest): string {
  const parsed = new URL(manifest.brandTokensUri);
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (parsed.protocol !== 'design-pack:' || segments[0] !== 'versions' || !segments[1]) {
    throw new Error(`Invalid Design Pack URI: ${manifest.brandTokensUri}`);
  }
  return decodeURIComponent(segments[1]);
}
function assertInside(parent: string, candidate: string): string {
  const relative = path.relative(parent, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Design Pack asset is outside version directory: ${candidate}`);
  }
  return candidate;
}

export async function resolveDesignPack(
  designPacksRoot: string,
  expectedInput: DesignPackManifest,
): Promise<ResolvedDesignPack> {
  const expected = designPackManifestSchema.parse(expectedInput);
  const directoryName = versionDirectoryName(expected);
  const packs = await readdir(designPacksRoot, { withFileTypes: true });
  const matches: string[] = [];
  for (const pack of packs) {
    if (!pack.isDirectory()) continue;
    const candidate = path.join(designPacksRoot, pack.name, 'versions', directoryName);
    try {
      const loaded = await loadCompiledDesignPack(candidate);
      const publicManifest = designPackManifestSchema.parse(loaded.manifest);
      if (createInputHash(publicManifest) === createInputHash(expected)) matches.push(candidate);
    } catch {
      // A non-matching or incomplete pack is not a valid candidate.
    }
  }
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one matching Design Pack, found ${matches.length}`);
  }
  const versionDirectory = matches[0];
  if (!versionDirectory) throw new Error('Matching Design Pack disappeared');
  const loaded = await loadCompiledDesignPack(versionDirectory);
  const logoPath = assertInside(
    versionDirectory,
    path.resolve(versionDirectory, loaded.brandTokens.brand.logoAsset),
  );
  const logo = await readFile(logoPath);
  return {
    brandTokens: loaded.brandTokens,
    motionTokens: loaded.motionTokens,
    promoSpec: loaded.promoSpec,
    logoDataUri: `data:image/svg+xml;base64,${logo.toString('base64')}`,
    contentHash: loaded.manifest.contentHash,
  };
}
