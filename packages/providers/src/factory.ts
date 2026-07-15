import type { AppEnv } from '@onecrew/config';
import type { ProviderCapability } from '@onecrew/contracts';

import { ElevenLabsTtsProvider, type ProviderMediaSink } from './elevenlabs.js';
import { createMockRegistry } from './mock.js';
import { OpenAILlmProvider, OpenAIVlmProvider } from './openai-responses.js';
import { ProviderRegistry } from './registry.js';
import { VolcengineSeedanceProvider, VolcengineSeedreamProvider } from './volcengine.js';

export interface ProviderConfigurationEntry {
  capability: ProviderCapability;
  primary: string;
  primaryStatus: 'mock_verified' | 'config_ready_unverified';
  fallback: string;
  fallbackStatus: 'mock_verified';
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required to construct the real Provider Registry`);
  return value;
}

export function inspectProviderConfiguration(env: AppEnv): ProviderConfigurationEntry[] {
  if (env.PROVIDER_MODE === 'mock') {
    return (['llm', 'image', 'video', 'tts', 'vlm'] as const).map((capability) => ({
      capability,
      primary: `mock-${capability}-primary`,
      primaryStatus: 'mock_verified',
      fallback: `mock-${capability}-fallback`,
      fallbackStatus: 'mock_verified',
    }));
  }
  const realRoutes: ReadonlyArray<readonly [ProviderCapability, string]> = [
    ['llm', 'openai-responses-llm'],
    ['image', 'volcengine-seedream'],
    ['video', 'volcengine-seedance'],
    ['tts', 'elevenlabs-tts'],
    ['vlm', 'openai-responses-vlm'],
  ];
  return realRoutes.map(([capability, primary]) => ({
    capability,
    primary,
    primaryStatus: 'config_ready_unverified' as const,
    fallback: `mock-${capability}-fallback`,
    fallbackStatus: 'mock_verified' as const,
  }));
}

export function createProviderRegistry(env: AppEnv, mediaSink?: ProviderMediaSink): ProviderRegistry {
  if (env.PROVIDER_MODE === 'mock') return createMockRegistry(mediaSink);
  if (!mediaSink) throw new Error('A controlled ProviderMediaSink is required in real provider mode');

  const registry = new ProviderRegistry();
  registry.register(
    new OpenAILlmProvider({
      apiKey: required(env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
      model: required(env.OPENAI_MODEL, 'OPENAI_MODEL'),
      route: 'primary',
      capability: 'llm',
      baseUrl: env.OPENAI_BASE_URL,
      inputCnyPerMillionTokens: env.OPENAI_INPUT_CNY_PER_MILLION_TOKENS,
      outputCnyPerMillionTokens: env.OPENAI_OUTPUT_CNY_PER_MILLION_TOKENS,
    }),
  );
  registry.register(
    new OpenAIVlmProvider({
      apiKey: required(env.OPENAI_API_KEY, 'OPENAI_API_KEY'),
      model: required(env.OPENAI_VLM_MODEL, 'OPENAI_VLM_MODEL'),
      route: 'primary',
      capability: 'vlm',
      baseUrl: env.OPENAI_BASE_URL,
      inputCnyPerMillionTokens: env.OPENAI_INPUT_CNY_PER_MILLION_TOKENS,
      outputCnyPerMillionTokens: env.OPENAI_OUTPUT_CNY_PER_MILLION_TOKENS,
    }),
  );
  registry.register(
    new VolcengineSeedreamProvider({
      apiKey: required(env.VOLCENGINE_ARK_API_KEY, 'VOLCENGINE_ARK_API_KEY'),
      model: required(env.SEEDREAM_MODEL, 'SEEDREAM_MODEL'),
      route: 'primary',
      baseUrl: env.VOLCENGINE_ARK_BASE_URL,
      costCnyPerImage: env.SEEDREAM_COST_CNY_PER_IMAGE,
    }),
  );
  registry.register(
    new VolcengineSeedanceProvider({
      apiKey: required(env.VOLCENGINE_ARK_API_KEY, 'VOLCENGINE_ARK_API_KEY'),
      model: required(env.SEEDANCE_MODEL, 'SEEDANCE_MODEL'),
      route: 'primary',
      baseUrl: env.VOLCENGINE_ARK_BASE_URL,
      costCnyPerSecond: env.SEEDANCE_COST_CNY_PER_SECOND,
    }),
  );
  registry.register(
    new ElevenLabsTtsProvider({
      apiKey: required(env.ELEVENLABS_API_KEY, 'ELEVENLABS_API_KEY'),
      model: required(env.ELEVENLABS_MODEL, 'ELEVENLABS_MODEL'),
      route: 'primary',
      baseUrl: env.ELEVENLABS_BASE_URL,
      costCnyPerThousandCharacters: env.ELEVENLABS_COST_CNY_PER_THOUSAND_CHARACTERS,
      mediaSink,
    }),
  );

  const mock = createMockRegistry(mediaSink);
  for (const capability of ['llm', 'image', 'video', 'tts', 'vlm'] as const) {
    registry.register(mock.get(capability, 'fallback'));
  }
  registry.assertComplete();
  return registry;
}
