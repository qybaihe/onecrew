import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileDesignPack } from '../src/compiler.js';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packRoot = path.join(workspaceRoot, 'design-packs', 'shanhai-demo');
const result = await compileDesignPack(packRoot, {
  designSystemId: 'design_shanhai_demo',
  version: '1.0.0',
  sourceLicense: 'Original OneCrew shanhai-demo design system; repository project license applies.',
});

process.stdout.write(
  `${JSON.stringify(
    {
      designSystemId: result.manifest.designSystemId,
      version: result.manifest.version,
      contentHash: result.manifest.contentHash,
      versionDirectory: result.versionDirectory,
      warnings: result.report.warnings,
    },
    null,
    2,
  )}\n`,
);
