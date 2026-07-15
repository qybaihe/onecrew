import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const files = {
  zh: await readFile(new URL('../README.md', import.meta.url), 'utf8'),
  en: await readFile(new URL('../README.en.md', import.meta.url), 'utf8'),
};

const errors = [];
const requiredScripts = [
  'readme:check',
  'infra:up',
  'infra:down',
  'start:api',
  'start:worker',
  'preview:dev',
  'demo:mock-e2e',
  'providers:check',
  'lint',
  'typecheck',
  'test:unit',
  'test:integration',
  'build',
];

for (const script of requiredScripts) {
  if (!packageJson.scripts?.[script]) {
    errors.push(`package.json is missing the required script: ${script}`);
  }

  const command = `pnpm ${script}`;
  for (const [language, content] of Object.entries(files)) {
    if (!content.includes(command)) {
      errors.push(`${language} README is missing command: ${command}`);
    }
  }
}

const marker = /<!-- README_SYNC:([^ ]+) -->/;
const zhVersion = files.zh.match(marker)?.[1];
const enVersion = files.en.match(marker)?.[1];

if (!zhVersion || !enVersion) {
  errors.push('Both READMEs must contain a README_SYNC marker.');
} else {
  if (zhVersion !== enVersion) {
    errors.push(`README_SYNC markers differ: zh=${zhVersion}, en=${enVersion}`);
  }
  if (zhVersion !== packageJson.version) {
    errors.push(`README_SYNC must match package.json version ${packageJson.version}.`);
  }
}

if (!files.zh.includes('[English](./README.en.md)')) {
  errors.push('Chinese README is missing the English language link.');
}
if (!files.en.includes('[简体中文](./README.md)')) {
  errors.push('English README is missing the Chinese language link.');
}

const requiredDocs = [
  './docs/api.md',
  './docs/operations.md',
  './docs/demo.md',
  './docs/feishu-setup.md',
  './docs/provider-setup.md',
  './docs/remotion.md',
  './docs/qc.md',
  './docs/localization-publishing.md',
];

for (const doc of requiredDocs) {
  for (const [language, content] of Object.entries(files)) {
    if (!content.includes(doc)) {
      errors.push(`${language} README is missing documentation link: ${doc}`);
    }
  }
}

for (const [language, content] of Object.entries(files)) {
  if (content.length < 10_000) {
    errors.push(`${language} README is unexpectedly short (${content.length} characters).`);
  }
  if (content.includes('/Users/')) {
    errors.push(`${language} README contains a machine-local absolute path.`);
  }
}

if (errors.length > 0) {
  console.error('README consistency check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`README consistency check passed for OneCrew ${packageJson.version}.`);
}
