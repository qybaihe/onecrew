import { loadEnv } from '@onecrew/config';

import { inspectProviderConfiguration } from '../src/factory.js';

const env = loadEnv();
process.stdout.write(
  `${JSON.stringify(
    {
      providerMode: env.PROVIDER_MODE,
      routes: inspectProviderConfiguration(env),
      realSmokeTest: env.PROVIDER_MODE === 'real' ? 'not_run_by_config_check' : 'not_applicable',
    },
    null,
    2,
  )}\n`,
);
