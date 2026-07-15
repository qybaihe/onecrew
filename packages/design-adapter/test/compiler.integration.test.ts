import { appendFile, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileDesignPack } from '../src/compiler.js';
import { loadCompiledDesignPack } from '../src/loader.js';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourcePack = path.join(workspaceRoot, 'design-packs', 'shanhai-demo');
const compileOptions = {
  designSystemId: 'design_shanhai_test',
  version: '1.0.0',
  sourceLicense: 'OneCrew test fixture',
};

let temporaryRoot: string;
let packRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'onecrew-design-'));
  packRoot = path.join(temporaryRoot, 'pack');
  await cp(sourcePack, packRoot, { recursive: true });
  await rm(path.join(packRoot, 'versions'), { recursive: true, force: true });
  await Promise.all(
    ['brand.tokens.json', 'motion.tokens.json', 'promo.spec.json', 'compile-report.json', 'manifest.json'].map(
      (file) => rm(path.join(packRoot, file), { force: true }),
    ),
  );
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe('Design Pack compiler', () => {
  it('creates a complete immutable snapshot and is idempotent', async () => {
    const first = await compileDesignPack(packRoot, compileOptions);
    const second = await compileDesignPack(packRoot, compileOptions);

    expect(first.report.warnings).toEqual([]);
    expect(Object.values(first.report.sections)).toEqual(Array(9).fill('parsed'));
    expect(second.manifest).toEqual(first.manifest);
    expect(second.versionDirectory).toBe(first.versionDirectory);
    const loaded = await loadCompiledDesignPack(first.versionDirectory);
    expect(loaded.manifest).toEqual(first.manifest);
    expect(loaded.brandTokens.brand.nameZh).toBe('山海星辰');

    const versionFiles = await Promise.all(
      [
        'DESIGN.md',
        'brand.tokens.json',
        'motion.tokens.json',
        'promo.spec.json',
        'compile-report.json',
        'manifest.json',
        'assets/logo.svg',
        'assets/LICENSES.md',
        'templates/title-card.svg',
        'templates/LICENSES.md',
        'templates/lower-third.svg',
        'templates/end-card.svg',
        'templates/poster-frame.svg',
      ].map((file) => readFile(path.join(first.versionDirectory, file))),
    );
    expect(versionFiles.every((file) => file.byteLength > 0)).toBe(true);
  });

  it('includes asset bytes in the version hash', async () => {
    const first = await compileDesignPack(packRoot, compileOptions);
    await appendFile(path.join(packRoot, 'assets', 'star-texture.svg'), '\n<!-- revision -->\n');
    const second = await compileDesignPack(packRoot, compileOptions);

    expect(second.manifest.contentHash).not.toBe(first.manifest.contentHash);
    expect(second.versionDirectory).not.toBe(first.versionDirectory);
  });

  it('rejects unsafe SVGs and remote DESIGN resources', async () => {
    await appendFile(path.join(packRoot, 'assets', 'logo.svg'), '<script>alert(1)</script>');
    await expect(compileDesignPack(packRoot, compileOptions)).rejects.toThrow('Unsafe SVG');

    await writeFile(path.join(packRoot, 'assets', 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    await appendFile(path.join(packRoot, 'DESIGN.md'), '\nRemote: https://invalid.example/asset.svg\n');
    await expect(compileDesignPack(packRoot, compileOptions)).rejects.toThrow('Remote resources');
  });

  it('rejects text and background colors below the accessibility threshold', async () => {
    const designPath = path.join(packRoot, 'DESIGN.md');
    const design = await readFile(designPath, 'utf8');
    await writeFile(
      designPath,
      design.replace('`#F7F3E8`', '`#071120`'),
      'utf8',
    );

    await expect(compileDesignPack(packRoot, compileOptions)).rejects.toThrow('below 4.5:1');
  });
});
