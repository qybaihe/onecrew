import type { AppEnv } from '@onecrew/config';
import type { ProviderCapability } from '@onecrew/contracts';

import { AgnesImageProvider, AgnesVideoProvider } from './agnes.js';
import { ElevenLabsTtsProvider, type ProviderMediaSink } from './elevenlabs.js';
import { createMockRegistry } from './mock.js';
import { MimoTtsProvider } from './mimo-tts.js';
import { OpenAILlmProvider, OpenAIVlmProvider } from './openai-responses.js';
import { OpenCodeGoLlmProvider, OpenCodeGoVlmProvider } from './opencode-go.js';
import { ProviderRegistry } from './registry.js';
import { VolcengineSeedanceProvider, VolcengineSeedreamProvider } from './volcengine.js';

export interface ProviderConfigurationEntry {
  capability: ProviderCapability;
  primary: string;
  primaryStatus: 'mock_verified' | 'config_ready_unverified' | 'real_smoke_verified';
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
  const realRoutes: ReadonlyArray<readonly [ProviderCapability, string]> =
    env.PROVIDER_PROFILE === 'opencode-agnes-mimo'
      ? [
          ['llm', 'opencode-go-chat-llm'],
          ['image', 'agnes-image-2.1-flash'],
          ['video', 'agnes-video-v2.0'],
          ['tts', 'xiaomi-mimo-v2.5-tts'],
          ['vlm', 'opencode-go-messages-vlm'],
        ]
      : [
          ['llm', 'openai-responses-llm'],
          ['image', 'volcengine-seedream'],
          ['video', 'volcengine-seedance'],
          ['tts', 'elevenlabs-tts'],
          ['vlm', 'openai-responses-vlm'],
        ];
  return realRoutes.map(([capability, primary]) => ({
    capability,
    primary,
    primaryStatus:
      env.PROVIDER_PROFILE === 'opencode-agnes-mimo'
        ? ('real_smoke_verified' as const)
        : ('config_ready_unverified' as const),
    fallback: `mock-${capability}-fallback`,
    fallbackStatus: 'mock_verified' as const,
  }));
}

export function createProviderRegistry(env: AppEnv, mediaSink?: ProviderMediaSink): ProviderRegistry {
  if (env.PROVIDER_MODE === 'mock') return createMockRegistry(mediaSink);
  if (!mediaSink) throw new Error('A controlled ProviderMediaSink is required in real provider mode');

  const registry = new ProviderRegistry();
  if (env.PROVIDER_PROFILE === 'opencode-agnes-mimo') {
    registry.register(
      new OpenCodeGoLlmProvider({
        apiKey: required(env.OPENCODE_GO_API_KEY, 'OPENCODE_GO_API_KEY'),
        model: env.OPENCODE_GO_LLM_MODEL,
        route: 'primary',
        baseUrl: env.OPENCODE_GO_BASE_URL,
        inputCnyPerMillionTokens: env.OPENCODE_GO_LLM_INPUT_CNY_PER_MILLION_TOKENS,
        outputCnyPerMillionTokens: env.OPENCODE_GO_LLM_OUTPUT_CNY_PER_MILLION_TOKENS,
        verification: 'real_smoke_verified',
      }),
    );
    registry.register(
      new OpenCodeGoVlmProvider({
        apiKey: required(env.OPENCODE_GO_API_KEY, 'OPENCODE_GO_API_KEY'),
        model: env.OPENCODE_GO_VLM_MODEL,
        route: 'primary',
        baseUrl: env.OPENCODE_GO_BASE_URL,
        inputCnyPerMillionTokens: env.OPENCODE_GO_VLM_INPUT_CNY_PER_MILLION_TOKENS,
        outputCnyPerMillionTokens: env.OPENCODE_GO_VLM_OUTPUT_CNY_PER_MILLION_TOKENS,
        verification: 'real_smoke_verified',
      }),
    );
    registry.register(
      new AgnesImageProvider({
        apiKey: required(env.AGNES_API_KEY, 'AGNES_API_KEY'),
        model: env.AGNES_IMAGE_MODEL,
        route: 'primary',
        baseUrl: env.AGNES_BASE_URL,
        costCnyPerImage: env.AGNES_IMAGE_COST_CNY_PER_IMAGE,
        mediaSink,
        verification: 'real_smoke_verified',
      }),
    );
    registry.register(
      new AgnesVideoProvider({
        apiKey: required(env.AGNES_API_KEY, 'AGNES_API_KEY'),
        model: env.AGNES_VIDEO_MODEL,
        route: 'primary',
        baseUrl: env.AGNES_BASE_URL,
        costCnyPerSecond: env.AGNES_VIDEO_COST_CNY_PER_SECOND,
        mediaSink,
        verification: 'real_smoke_verified',
      }),
    );
    registry.register(
      new MimoTtsProvider({
        apiKey: required(env.MIMO_API_KEY, 'MIMO_API_KEY'),
        model: env.MIMO_TTS_MODEL,
        route: 'primary',
        baseUrl: env.MIMO_BASE_URL,
        zhVoices: env.MIMO_TTS_ZH_VOICES.split(',').map((voice) => voice.trim()).filter(Boolean),
        enVoices: env.MIMO_TTS_EN_VOICES.split(',').map((voice) => voice.trim()).filter(Boolean),
        costCnyPerThousandCharacters: env.MIMO_TTS_COST_CNY_PER_THOUSAND_CHARACTERS,
        mediaSink,
        verification: 'real_smoke_verified',
      }),
    );
  } else {
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
  }

  const mock = createMockRegistry(mediaSink);
  for (const capability of ['llm', 'image', 'video', 'tts', 'vlm'] as const) {
    registry.register(mock.get(capability, 'fallback'));
  }
  registry.assertComplete();
  return registry;
}
