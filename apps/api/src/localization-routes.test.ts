import { loadEnv } from '@onecrew/config';
import type { LocalizationRequest, LocalizationRunRecord } from '@onecrew/contracts';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const now = new Date().toISOString();
const request: LocalizationRequest = {
  projectId: 'prj_localization_api',
  sourceLocalePack: {
    projectId: 'prj_localization_api',
    locale: 'zh-CN',
    title: '山海星辰',
    lines: [
      {
        lineId: 'line_localization_api',
        shotId: 'shot_localization_api',
        speaker: '阿澜',
        text: '让星光带我们穿过山海。',
        startMs: 0,
        endMs: 2_000,
        voiceId: 'voice_zh_alan',
      },
    ],
    cta: '启程',
    marketingCopy: ['穿过山海，奔向星辰。'],
  },
  sharedShots: [
    {
      shotId: 'shot_localization_api',
      videoUri: 'https://media.example.com/shot-localization-api.mp4',
      inFrame: 0,
      outFrame: 180,
    },
  ],
  targetLocale: 'en-US',
  targetVoiceBySourceVoice: { voice_zh_alan: 'voice_en_alan' },
  route: 'primary',
  fps: 30,
  lineGapMs: 250,
  leadInMs: 350,
  tailMs: 350,
};
const record: LocalizationRunRecord = {
  localizationRunId: 'loc_api_fixture',
  request,
  status: 'queued',
  ttsJobIds: [],
  createdAt: now,
  updatedAt: now,
};
const app = createApp({
  env: loadEnv({ NODE_ENV: 'test' }),
  probes: [],
  localizations: {
    orchestrator: {
      async submit() {
        return {
          localizationRunId: record.localizationRunId,
          status: record.status,
          statusUrl: `/v1/localizations/${record.localizationRunId}`,
          replayed: false,
        };
      },
      async get() {
        return { value: record, version: 1 };
      },
      async cancel() {
        return { status: 'cancelled' };
      },
    },
  },
});

afterAll(async () => app.close());

describe('localization API routes', () => {
  it('requires idempotency and accepts a validated localization request', async () => {
    const missing = await app.inject({ method: 'POST', url: '/v1/localizations', payload: request });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: 'MissingLocalizationIdempotencyKeyError' });

    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/localizations',
      headers: { 'idempotency-key': 'idem_localization_api' },
      payload: request,
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json()).toEqual({
      localization_run_id: record.localizationRunId,
      status: 'queued',
      status_url: `/v1/localizations/${record.localizationRunId}`,
      replayed: false,
    });
  });

  it('returns durable state and supports cancellation', async () => {
    const status = await app.inject({ method: 'GET', url: `/v1/localizations/${record.localizationRunId}` });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ localization_run: { localizationRunId: record.localizationRunId }, version: 1 });

    const cancel = await app.inject({ method: 'POST', url: `/v1/localizations/${record.localizationRunId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({ status: 'cancelled' });
  });
});
