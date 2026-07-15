import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.js';
import type { ReadinessProbe } from './readiness.js';

const passingProbes: ReadinessProbe[] = [
  { name: 'postgres', check: async () => undefined },
  { name: 'redis', check: async () => undefined },
  { name: 'objectStorage', check: async () => undefined },
];

describe('Feishu API routes', () => {
  it('answers a token-validated URL verification challenge', async () => {
    const app = createApp({
      probes: passingProbes,
      logger: false,
      feishu: {
        security: { verificationToken: 'verification_test' },
        cardActionService: { handle: vi.fn() },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feishu/events',
      payload: {
        type: 'url_verification',
        challenge: 'challenge_test',
        token: 'verification_test',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ challenge: 'challenge_test' });
    await app.close();
  });

  it('rejects an invalid verification token', async () => {
    const app = createApp({
      probes: passingProbes,
      logger: false,
      feishu: {
        security: { verificationToken: 'verification_test' },
        cardActionService: { handle: vi.fn() },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feishu/events',
      payload: { type: 'url_verification', challenge: 'x', token: 'wrong' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ ok: false, error: 'FeishuWebhookSecurityError' });
    await app.close();
  });

  it('normalizes and delegates card callbacks', async () => {
    const handle = vi.fn(async () => ({ outcome: 'workflow_resumable' }));
    const app = createApp({
      probes: passingProbes,
      logger: false,
      feishu: {
        security: { verificationToken: 'verification_test' },
        cardActionService: { handle },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feishu/card-actions',
      payload: {
        header: { token: 'verification_test', event_id: 'evt_api_card' },
        event: {
          operator: { operator_id: { open_id: 'ou_api_actor' } },
          action: {
            value: {
              action: 'approve',
              project_id: 'prj_api',
              target_type: 'story',
              target_id: 'story_api',
              expected_version: 1,
            },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(handle).toHaveBeenCalledWith({
      action: 'approve',
      projectId: 'prj_api',
      targetType: 'story',
      targetId: 'story_api',
      expectedVersion: 1,
      actorOpenId: 'ou_api_actor',
      eventId: 'evt_api_card',
    });
    await app.close();
  });

  it('fails closed when no verification token is configured', async () => {
    const app = createApp({ probes: passingProbes, logger: false });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/feishu/events',
      payload: { type: 'url_verification', challenge: 'x', token: 'anything' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ ok: false, error: 'FeishuRouteNotConfiguredError' });
    await app.close();
  });
});
