import { loadEnv } from '@onecrew/config';
import type { ProviderRequest } from '@onecrew/contracts';

import type { ProviderMediaSink } from '../src/elevenlabs.js';
import { createProviderRegistry } from '../src/factory.js';
import { ProviderGateway } from '../src/gateway.js';

const env = loadEnv();
if (env.PROVIDER_MODE !== 'real') throw new Error('Real provider smoke test requires PROVIDER_MODE=real');

const stored = new Map<string, { bytes: Uint8Array; contentType: string }>();
const mediaSink: ProviderMediaSink = {
  async put(input) {
    stored.set(input.key, { bytes: input.bytes, contentType: input.contentType });
    return { uri: `s3://onecrew-smoke/${input.key}` };
  },
  async get(uri) {
    const key = new URL(uri).pathname.replace(/^\//, '');
    const item = stored.get(key);
    if (!item) throw new Error(`Smoke media not found: ${key}`);
    return { ...item, key };
  },
};
const gateway = new ProviderGateway(createProviderRegistry(env, mediaSink), {
  pollIntervalMs: 2_000,
  maxPolls: 240,
});
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

const requests: Array<{ label: string; request: ProviderRequest }> = [
  {
    label: 'llm',
    request: {
      capability: 'llm',
      projectId: 'prj_provider_smoke',
      route: 'primary',
      operation: 'script',
      prompt: 'Return an object whose ok field is true.',
      locale: 'zh-CN',
      imageUris: [],
      outputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok'],
        properties: { ok: { type: 'boolean' } },
      },
      maxOutputTokens: 256,
    },
  },
  {
    label: 'vlm',
    request: {
      capability: 'vlm',
      projectId: 'prj_provider_smoke',
      route: 'primary',
      mediaUri: `data:image/png;base64,${png}`,
      mediaType: 'image',
      criteria: ['image is readable', 'no unsafe content'],
      expectedDescription: 'A one-pixel smoke-test image.',
    },
  },
  {
    label: 'image',
    request: {
      capability: 'image',
      projectId: 'prj_provider_smoke',
      route: 'primary',
      shotId: 'shot_provider_smoke',
      prompt: 'A single white star on a deep blue background, minimalist, no text.',
      referenceUris: [],
      width: 1_024,
      height: 1_024,
      count: 1,
    },
  },
  {
    label: 'tts',
    request: {
      capability: 'tts',
      projectId: 'prj_provider_smoke',
      route: 'primary',
      lineId: 'line_provider_smoke',
      text: '山海相逢。',
      locale: 'zh-CN',
      voiceId: 'voice_provider_smoke',
      outputFormat: 'wav_44100',
    },
  },
  {
    label: 'video',
    request: {
      capability: 'video',
      projectId: 'prj_provider_smoke',
      route: 'primary',
      shotId: 'shot_provider_smoke',
      prompt: 'A white star gently pulses on a deep blue background, static camera, no text.',
      durationSec: 1,
      aspectRatio: '16:9',
    },
  },
];

const results: Array<Record<string, unknown>> = [];
for (const [index, item] of requests.entries()) {
  const result = await gateway.execute(item.request, {
    idempotencyKey: `onecrew-real-smoke-${item.label}-${Date.now()}-${index}`,
  });
  const summary = {
    capability: item.label,
    provider: result.descriptor.name,
    model: result.descriptor.model,
    status: result.state.status,
    mode: result.descriptor.mode,
    verification: result.descriptor.verification,
    storedObjects: stored.size,
  };
  results.push(summary);
  process.stdout.write(`${JSON.stringify({ event: 'provider_smoke_completed', ...summary })}\n`);
}

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      providerProfile: env.PROVIDER_PROFILE,
      results,
      storedMedia: [...stored.values()].map((item) => ({
        contentType: item.contentType,
        bytes: item.bytes.byteLength,
      })),
    },
    null,
    2,
  )}\n`,
);
