import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { allFixtureInputs } from '../src/fixtures.js';
import { ServerRemotionEngine } from '../src/server/render-engine.js';

const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputDirectory = path.resolve(
  process.argv[2] ?? path.join(workspaceRoot, 'outputs', 'remotion-stage5'),
);
const engine = new ServerRemotionEngine({
  designPacksRoot: path.join(workspaceRoot, 'design-packs'),
  concurrency: '75%',
});

await mkdir(outputDirectory, { recursive: true });
await engine.prepare();

const report: Array<Record<string, unknown>> = [];
for (const input of allFixtureInputs) {
  const startedAt = Date.now();
  const media = await engine.render(input.manifest, 'preview');
  const filename = `${input.manifest.compositionId}.preview.mp4`;
  await writeFile(path.join(outputDirectory, filename), media.bytes);
  report.push({
    compositionId: input.manifest.compositionId,
    filename,
    width: media.width,
    height: media.height,
    durationInFrames: media.durationInFrames,
    bytes: media.bytes.byteLength,
    elapsedMs: Date.now() - startedAt,
  });
  process.stdout.write(`${JSON.stringify(report.at(-1))}\n`);
}
await writeFile(path.join(outputDirectory, 'render-report.json'), `${JSON.stringify(report, null, 2)}\n`);
