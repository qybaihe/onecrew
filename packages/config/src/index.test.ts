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
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/OPENAI_API_KEY/);
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/SEEDANCE_MODEL/);
    expect(() => loadEnv({ PROVIDER_MODE: 'real' })).toThrow(/positive in real provider mode/);
  });
});
