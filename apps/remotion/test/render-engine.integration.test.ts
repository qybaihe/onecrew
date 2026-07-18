import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createFixtureManifest } from '../src/fixtures.js';
import { resolveDesignPack } from '../src/server/design-resolver.js';
import { ServerRemotionEngine } from '../src/server/render-engine.js';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const designPacksRoot = path.join(workspaceRoot, 'design-packs');
const engine = new ServerRemotionEngine({ designPacksRoot, concurrency: 1 });

beforeAll(async () => {
  await engine.prepare();
});
afterAll(() => {
  // The engine owns no persistent browser or temporary directory after render().
});

describe('server Remotion renderer', () => {
  it('resolves the immutable Design Pack and renders a real watermarked H.264 preview', async () => {
    const manifest = createFixtureManifest('Bumper6');
    await expect(resolveDesignPack(designPacksRoot, manifest.designPack)).resolves.toMatchObject({
      contentHash: 'c590888620ae34c2d255004b6c1ba9ebdb329fbe9f0e8073aa53284120f65759',
      brandTokens: { brand: { nameZh: '山海星辰' } },
    });
    const media = await engine.render(manifest, 'preview');
    expect(media).toMatchObject({
      contentType: 'video/mp4',
      extension: 'mp4',
      width: 640,
      height: 640,
      durationInFrames: 180,
    });
    expect(media.bytes.byteLength).toBeGreaterThan(5_000);
    expect(Buffer.from(media.bytes.subarray(4, 8)).toString('ascii')).toBe('ftyp');
  });

  it('renders the isolated short PipelineSmoke composition without episode padding', async () => {
    const media = await engine.render(createFixtureManifest('PipelineSmoke'), 'preview');
    expect(media).toMatchObject({
      contentType: 'video/mp4',
      width: 640,
      height: 360,
      durationInFrames: 180,
    });
    expect(media.bytes.byteLength).toBeGreaterThan(5_000);
  });
});
