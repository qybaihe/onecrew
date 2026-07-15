import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { ProviderRequest } from '@onecrew/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ElevenLabsTtsProvider, type ProviderMediaSink } from '../src/elevenlabs.js';
import { ProviderGateway } from '../src/gateway.js';
import { OpenAILlmProvider, OpenAIVlmProvider } from '../src/openai-responses.js';
import { ProviderRegistry } from '../src/registry.js';
import { VolcengineSeedanceProvider, VolcengineSeedreamProvider } from '../src/volcengine.js';

const requestBodies = new Map<string, unknown>();
const storedMedia: Array<{ key: string; bytes: number; contentType: string }> = [];

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

let baseUrl: string;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture');
  if (request.method === 'POST' && url.pathname === '/v1/responses') {
    requestBodies.set('openai', await body(request));
    return json(response, { id: 'resp_fixture', status: 'queued' });
  }
  if (request.method === 'GET' && url.pathname === '/v1/responses/resp_fixture') {
    const openaiBody = requestBodies.get('openai') as { text?: { format?: { name?: string } } };
    const outputText =
      openaiBody.text?.format?.name === 'onecrew_vlm_qc'
        ? JSON.stringify({
            scores: Object.fromEntries(
              [
                'character',
                'clothing',
                'background',
                'action',
                'flicker',
                'lipsync',
                'subtitle',
                'brand',
                'safeArea',
                'audio',
                'compliance',
              ].map((key) => [key, 0.95]),
            ),
            decision: 'pass',
            reason: 'fixture pass',
          })
        : JSON.stringify({ title: 'Fixture scene' });
    return json(response, {
      id: 'resp_fixture',
      status: 'completed',
      output: [{ content: [{ type: 'output_text', text: outputText }] }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/v3/images/generations') {
    requestBodies.set('image', await body(request));
    return json(response, { request_id: 'img_fixture', data: [{ url: 'https://fixture.invalid/image.png' }] });
  }
  if (request.method === 'POST' && url.pathname === '/api/v3/contents/generations/tasks') {
    requestBodies.set('video', await body(request));
    return json(response, { id: 'video_fixture' });
  }
  if (request.method === 'GET' && url.pathname === '/api/v3/contents/generations/tasks/video_fixture') {
    return json(response, {
      id: 'video_fixture',
      status: 'succeeded',
      content: { video_url: 'https://fixture.invalid/video.mp4' },
    });
  }
  if (request.method === 'POST' && url.pathname === '/v1/text-to-speech/voice_fixture') {
    await body(request);
    response.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'character-cost': '12',
      'request-id': 'tts_fixture',
    });
    return response.end(Buffer.from('fixture-audio'));
  }
  response.writeHead(404);
  response.end();
});

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture HTTP server did not bind');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe('real HTTP adapter contracts against a local fixture', () => {
  it('normalizes LLM, VLM, Seedream, Seedance and ElevenLabs responses', async () => {
    const sink: ProviderMediaSink = {
      async put(input) {
        storedMedia.push({ key: input.key, bytes: input.bytes.byteLength, contentType: input.contentType });
        return { uri: `s3://onecrew/${input.key}` };
      },
    };
    const registry = new ProviderRegistry();
    registry.register(
      new OpenAILlmProvider({
        apiKey: 'fixture',
        model: 'fixture-llm',
        route: 'primary',
        capability: 'llm',
        baseUrl: `${baseUrl}/v1`,
        inputCnyPerMillionTokens: 1,
        outputCnyPerMillionTokens: 2,
      }),
    );
    registry.register(
      new OpenAIVlmProvider({
        apiKey: 'fixture',
        model: 'fixture-vlm',
        route: 'primary',
        capability: 'vlm',
        baseUrl: `${baseUrl}/v1`,
        inputCnyPerMillionTokens: 1,
        outputCnyPerMillionTokens: 2,
      }),
    );
    registry.register(
      new VolcengineSeedreamProvider({
        apiKey: 'fixture',
        model: 'fixture-image',
        route: 'primary',
        baseUrl: `${baseUrl}/api/v3`,
        costCnyPerImage: 0.2,
      }),
    );
    registry.register(
      new VolcengineSeedanceProvider({
        apiKey: 'fixture',
        model: 'fixture-video',
        route: 'primary',
        baseUrl: `${baseUrl}/api/v3`,
        costCnyPerSecond: 0.4,
      }),
    );
    registry.register(
      new ElevenLabsTtsProvider({
        apiKey: 'fixture',
        model: 'fixture-tts',
        route: 'primary',
        baseUrl: `${baseUrl}/v1`,
        costCnyPerThousandCharacters: 1,
        mediaSink: sink,
      }),
    );
    const gateway = new ProviderGateway(registry, { pollIntervalMs: 1, maxPolls: 3 });
    const requests: ProviderRequest[] = [
      {
        capability: 'llm',
        projectId: 'prj_fixture',
        route: 'primary',
        operation: 'script',
        prompt: 'Fixture prompt',
        locale: 'zh-CN',
        imageUris: [],
        outputSchema: { type: 'object' },
        maxOutputTokens: 100,
      },
      {
        capability: 'vlm',
        projectId: 'prj_fixture',
        route: 'primary',
        mediaUri: 'https://fixture.invalid/frame.png',
        mediaType: 'image',
        criteria: ['continuity'],
        expectedDescription: 'mountain scene',
      },
      {
        capability: 'image',
        projectId: 'prj_fixture',
        route: 'primary',
        prompt: 'mountain',
        referenceUris: [],
        width: 1024,
        height: 1024,
        count: 1,
      },
      {
        capability: 'video',
        projectId: 'prj_fixture',
        route: 'primary',
        shotId: 'shot_fixture',
        prompt: 'move forward',
        durationSec: 5,
        aspectRatio: '16:9',
      },
      {
        capability: 'tts',
        projectId: 'prj_fixture',
        route: 'primary',
        lineId: 'line_fixture',
        text: '山海相逢',
        locale: 'zh-CN',
        voiceId: 'voice_fixture',
        outputFormat: 'mp3_44100_128',
      },
    ];
    const results = [];
    for (const [index, request] of requests.entries()) {
      results.push(await gateway.execute(request, { idempotencyKey: `fixture_${index}` }));
    }

    expect(results.map((result) => result.state.status)).toEqual(Array(5).fill('succeeded'));
    expect(storedMedia).toEqual([
      expect.objectContaining({ bytes: 13, contentType: 'audio/mpeg' }),
    ]);
    expect(requestBodies.has('image')).toBe(true);
    expect(requestBodies.has('video')).toBe(true);
  });
});
