import { describe, expect, it } from 'vitest';

import { EnvironmentValidationError, loadEnv } from './index.js';

describe('loadEnv', () => {
  it('provides deterministic local defaults', () => {
    const env = loadEnv({});

    expect(env.PORT).toBe(3_000);
    expect(env.DATABASE_URL).toContain('127.0.0.1:55432');
    expect(env.REDIS_URL).toContain('127.0.0.1:56379');
    expect(env.S3_ENDPOINT).toBe('http://127.0.0.1:59000');
    expect(env.PROVIDER_MODE).toBe('mock');
    expect(env.PROVIDER_PROFILE).toBe('opencode-agnes-mimo');
  });

  it('rejects invalid ports without echoing environment values', () => {
    expect(() => loadEnv({ PORT: '70000' })).toThrow(EnvironmentValidationError);

    try {
      loadEnv({ PORT: '70000' });
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).toContain('PORT');
      expect((error as Error).message).not.toContain('70000');
    }
  });

  it('rejects non-Redis protocols', () => {
    expect(() => loadEnv({ REDIS_URL: 'https://example.com' })).toThrow(
      /redis or rediss protocol/,
    );
  });

  it('fails closed when real provider mode has no credentials or cost configuration', () => {
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/OPENCODE_GO_API_KEY/);
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/AGNES_API_KEY/);
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/MIMO_API_KEY/);
  });

  it('accepts the subscription and limited-free profile with explicit credentials and zero marginal cost', () => {
    const env = loadEnv({
      PROVIDER_MODE: 'real',
      PROVIDER_PROFILE: 'opencode-agnes-mimo',
      PROVIDER_CALLBACK_SECRET: 'fixture-callback-secret',
      OPENCODE_GO_API_KEY: 'fixture-opencode',
      AGNES_API_KEY: 'fixture-agnes',
      MIMO_API_KEY: 'fixture-mimo',
    });

    expect(env.OPENCODE_GO_LLM_INPUT_CNY_PER_MILLION_TOKENS).toBe(0);
    expect(env.AGNES_IMAGE_COST_CNY_PER_IMAGE).toBe(0);
    expect(env.MIMO_TTS_COST_CNY_PER_THOUSAND_CHARACTERS).toBe(0);
  });

  it('keeps the legacy real profile strict about credentials and positive unit prices', () => {
    expect(() =>
      loadEnv({ PROVIDER_MODE: 'real', PROVIDER_PROFILE: 'openai-volcengine-elevenlabs' }),
    ).toThrow(/OPENAI_API_KEY/);
    expect(() =>
      loadEnv({ PROVIDER_MODE: 'real', PROVIDER_PROFILE: 'openai-volcengine-elevenlabs' }),
    ).toThrow(/positive in real provider mode/);
  });
});
