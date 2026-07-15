import { loadEnv } from '@onecrew/config';

import { FeishuClient } from '../src/client.js';
import { buildBaseDryRunReport, reconcileOneCrewBase } from '../src/reconcile.js';

const env = loadEnv();
const hasRealConfiguration = Boolean(
  env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BASE_APP_TOKEN,
);

if (!hasRealConfiguration) {
  process.stdout.write(`${JSON.stringify(buildBaseDryRunReport(), null, 2)}\n`);
  process.stderr.write(
    'Feishu credentials or Base app token are missing; emitted a dry-run schema report and made no network calls.\n',
  );
} else {
  const client = new FeishuClient({ appId: env.FEISHU_APP_ID!, appSecret: env.FEISHU_APP_SECRET! });
  const report = await reconcileOneCrewBase(client, env.FEISHU_BASE_APP_TOKEN!);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
