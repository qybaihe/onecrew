import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createFixtureManifest } from '../src/fixtures.js';
import { ServerRemotionEngine } from '../src/server/render-engine.js';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputDirectory = path.resolve(
  process.argv[2] ?? path.join(workspaceRoot, 'outputs', 'remotion-stage5'),
);
const manifest = {
  ...createFixtureManifest('Bumper6'),
  renderId: 'render_demo_Bumper6_final',
};
const engine = new ServerRemotionEngine({
  designPacksRoot: path.join(workspaceRoot, 'design-packs'),
  concurrency: '75%',
});

await mkdir(outputDirectory, { recursive: true });
await engine.prepare();
const startedAt = Date.now();
const media = await engine.render(manifest, 'final');
const filename = 'Bumper6.final.mp4';
await writeFile(path.join(outputDirectory, filename), media.bytes);
const report = {
  compositionId: manifest.compositionId,
  renderMode: 'final',
  filename,
  width: media.width,
  height: media.height,
  durationInFrames: media.durationInFrames,
  bytes: media.bytes.byteLength,
  elapsedMs: Date.now() - startedAt,
};
await writeFile(
  path.join(outputDirectory, 'final-smoke-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report)}\n`);
