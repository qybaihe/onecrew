import type { ProviderRequest } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors.js';
import { ProviderGateway } from './gateway.js';
import { createMockRegistry } from './mock.js';
import { evaluateBudget } from './policy.js';

const requests: ProviderRequest[] = [
  {
    capability: 'llm',
    projectId: 'prj_test',
    route: 'primary',
    operation: 'script',
    prompt: 'Write a short scene',
    locale: 'zh-CN',
    imageUris: [],
    maxOutputTokens: 400,
  },
  {
    capability: 'image',
    projectId: 'prj_test',
    route: 'primary',
    prompt: 'Mountain at night',
    referenceUris: [],
    width: 1024,
    height: 1024,
    count: 1,
  },
  {
    capability: 'video',
    projectId: 'prj_test',
    route: 'primary',
    shotId: 'shot_1',
    prompt: 'Slow push through the mountains',
    durationSec: 5,
    aspectRatio: '16:9',
  },
  {
    capability: 'tts',
    projectId: 'prj_test',
    route: 'primary',
    lineId: 'line_1',
    text: '山海相逢。',
    locale: 'zh-CN',
    voiceId: 'voice_1',
    outputFormat: 'mp3_44100_128',
  },
  {
    capability: 'vlm',
    projectId: 'prj_test',
    route: 'primary',
    mediaUri: 'mock://onecrew/video/test.mp4',
    mediaType: 'video',
    criteria: ['character continuity'],
    expectedDescription: 'Two travelers cross a mountain pass',
  },
];

describe('Provider Gateway', () => {
  it('executes all five deterministic Mock capabilities with explicit labels', async () => {
    const registry = createMockRegistry();
    const events: string[] = [];
    const gateway = new ProviderGateway(registry, {
      pollIntervalMs: 1,
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
      onAudit: (event) => {
        events.push(`${event.action}:${event.provider}`);
      },
    });

    const results = await Promise.all(
      requests.map((request, index) =>
        gateway.execute(request, { idempotencyKey: `mock_e2e_${index}` }),
      ),
    );

    expect(results.every((result) => result.descriptor.mode === 'mock')).toBe(true);
    expect(results.every((result) => result.descriptor.verification === 'mock_verified')).toBe(true);
    expect(results.every((result) => result.state.status === 'succeeded')).toBe(true);
    expect(events.filter((event) => event.startsWith('complete:'))).toHaveLength(5);
  });

  it('keeps exactly one primary and one fallback route per capability', () => {
    const registry = createMockRegistry();
    const descriptions = registry.describe();

    expect(descriptions).toHaveLength(10);
    for (const capability of ['llm', 'image', 'video', 'tts', 'vlm']) {
      expect(descriptions.filter((item) => item.capability === capability).map((item) => item.route).sort()).toEqual([
        'fallback',
        'primary',
      ]);
    }
  });

  it('retries transient failures with exponential policy and stops permanent failures', async () => {
    const gateway = new ProviderGateway(createMockRegistry(), {
      retryBaseDelayMs: 1,
      retryMaxDelayMs: 2,
    });
    const transient = { ...requests[0]!, prompt: '[MOCK_FAIL_TRANSIENT] recover' } as ProviderRequest;
    const permanent = { ...requests[0]!, prompt: '[MOCK_FAIL_PERMANENT]' } as ProviderRequest;

    await expect(gateway.execute(transient, { idempotencyKey: 'transient' })).resolves.toMatchObject({
      state: { status: 'succeeded' },
    });
    try {
      await gateway.execute(permanent, { idempotencyKey: 'permanent' });
      throw new Error('Expected permanent Mock failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderError);
      expect(error).toMatchObject({ code: 'MOCK_PERMANENT', retryable: false });
    }
  });

  it('classifies soft and hard budget thresholds before submission', () => {
    expect(evaluateBudget(5, 1, 8, 10).status).toBe('within_budget');
    expect(evaluateBudget(8, 1, 8, 10).status).toBe('soft_warning');
    expect(evaluateBudget(9, 2, 8, 10).status).toBe('hard_approval');
  });
});
