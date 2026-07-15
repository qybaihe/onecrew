import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { contractSchemas } from '../src/index.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(packageRoot, 'schemas');

await mkdir(outputDirectory, { recursive: true });

for (const [name, schema] of Object.entries(contractSchemas)) {
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  const output = {
    $id: `https://onecrew.local/schemas/${name}.schema.json`,
    title: name,
    ...jsonSchema,
  };

  await writeFile(
    path.join(outputDirectory, `${name}.schema.json`),
    `${JSON.stringify(output, null, 2)}\n`,
    'utf8',
  );
}
