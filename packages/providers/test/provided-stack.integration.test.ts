import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import type { ProviderRequest } from '@onecrew/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgnesImageProvider, AgnesVideoProvider } from '../src/agnes.js';
import type { ProviderMediaSink } from '../src/elevenlabs.js';
import { ProviderGateway } from '../src/gateway.js';
import { MimoTtsProvider } from '../src/mimo-tts.js';
import { OpenCodeGoLlmProvider, OpenCodeGoVlmProvider } from '../src/opencode-go.js';
import { ProviderRegistry } from '../src/registry.js';

const requestBodies = new Map<string, unknown>();
const storedMedia: Array<{ key: string; bytes: number; contentType: string }> = [];
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const wavBytes = (() => {
  const sampleRate = 44_100;
  const durationSec = 1;
  const channels = 1;
  const bitsPerSample = 16;
  const dataBytes = sampleRate * durationSec * channels * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0);
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channels, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  bytes.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
})();

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function json(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

function qcOutput(): Record<string, unknown> {
  return {
    ...Object.fromEntries(
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
  };
}

let baseUrl: string;
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixture');
  if (request.method === 'POST' && url.pathname === '/go/chat/completions') {
    requestBodies.set('llm', await body(request));
    return json(response, {
      id: 'chat_fixture',
      choices: [{ message: { content: JSON.stringify({ title: 'Fixture story' }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    });
  }
  if (request.method === 'POST' && url.pathname === '/go/messages') {
    requestBodies.set('vlm', await body(request));
    return json(response, {
      id: 'message_fixture',
      content: [{ type: 'text', text: JSON.stringify(qcOutput()) }],
      usage: { input_tokens: 120, output_tokens: 40 },
    });
  }
  if (request.method === 'POST' && url.pathname === '/agnes/v1/images/generations') {
    requestBodies.set('image', await body(request));
    return json(response, { request_id: 'image_fixture', data: [{ url: `${baseUrl}/media/image.png` }] });
  }
  if (request.method === 'GET' && url.pathname === '/media/image.png') {
    response.writeHead(200, { 'Content-Type': 'image/png' });
    return response.end(pngBytes);
  }
  if (request.method === 'POST' && url.pathname === '/agnes/v1/videos') {
    requestBodies.set('video', await body(request));
    return json(response, {
      id: 'task_fixture',
      task_id: 'task_fixture',
      video_id: 'video_fixture',
      status: 'queued',
    });
  }
  if (request.method === 'GET' && url.pathname === '/agnes/agnesapi') {
    return json(response, {
      id: 'task_fixture',
      video_id: 'video_fixture',
      status: 'completed',
      progress: 100,
      seconds: '5',
      size: '1280x720',
      url: `${baseUrl}/media/video.mp4`,
      error: null,
    });
  }
  if (request.method === 'GET' && url.pathname === '/media/video.mp4') {
    response.writeHead(200, { 'Content-Type': 'video/mp4' });
    return response.end(Buffer.from('fixture-video'));
  }
  if (request.method === 'POST' && url.pathname === '/mimo/chat/completions') {
    requestBodies.set('tts', await body(request));
    return json(response, {
      id: 'tts_fixture',
      choices: [{ message: { audio: { data: wavBytes.toString('base64') } } }],
    });
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

describe('OpenCode Go, Agnes and MiMo HTTP adapter contracts', () => {
  it('normalizes all five capabilities and materializes provider media into controlled storage', async () => {
    const sink: ProviderMediaSink = {
      async put(input) {
        storedMedia.push({ key: input.key, bytes: input.bytes.byteLength, contentType: input.contentType });
        return { uri: `s3://onecrew/${input.key}` };
      },
      async get(uri) {
        return { bytes: pngBytes, contentType: 'image/png', key: uri.replace('s3://onecrew/', '') };
      },
    };
    const registry = new ProviderRegistry();
    registry.register(
      new OpenCodeGoLlmProvider({
        apiKey: 'fixture',
        model: 'glm-5.2',
        route: 'primary',
        baseUrl: `${baseUrl}/go`,
        inputCnyPerMillionTokens: 1,
        outputCnyPerMillionTokens: 2,
      }),
    );
    registry.register(
      new OpenCodeGoVlmProvider({
        apiKey: 'fixture',
        model: 'minimax-m3',
        route: 'primary',
        baseUrl: `${baseUrl}/go`,
        inputCnyPerMillionTokens: 1,
        outputCnyPerMillionTokens: 2,
      }),
    );
    registry.register(
      new AgnesImageProvider({
        apiKey: 'fixture',
        model: 'agnes-image-2.1-flash',
        route: 'primary',
        baseUrl: `${baseUrl}/agnes`,
        costCnyPerImage: 0,
        mediaSink: sink,
      }),
    );
    registry.register(
      new AgnesVideoProvider({
        apiKey: 'fixture',
        model: 'agnes-video-v2.0',
        route: 'primary',
        baseUrl: `${baseUrl}/agnes`,
        costCnyPerSecond: 0,
        mediaSink: sink,
      }),
    );
    registry.register(
      new MimoTtsProvider({
        apiKey: 'fixture',
        model: 'mimo-v2.5-tts',
        route: 'primary',
        baseUrl: `${baseUrl}/mimo`,
        zhVoices: ['冰糖'],
        enVoices: ['Mia'],
        costCnyPerThousandCharacters: 0,
        mediaSink: sink,
      }),
    );
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
        mediaUri: `data:image/png;base64,${pngBytes.toString('base64')}`,
        mediaType: 'image',
        criteria: ['continuity'],
        expectedDescription: 'mountain scene',
      },
      {
        capability: 'image',
        projectId: 'prj_fixture',
        route: 'primary',
        shotId: 'shot_fixture',
        prompt: 'mountain',
        referenceUris: ['s3://onecrew/reference.png'],
        width: 1_024,
        height: 1_024,
        count: 1,
      },
      {
        capability: 'video',
        projectId: 'prj_fixture',
        route: 'primary',
        shotId: 'shot_fixture',
        prompt: 'move forward',
        referenceImageUri: 's3://onecrew/reference.png',
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
        outputFormat: 'wav_44100',
      },
    ];
    const gateway = new ProviderGateway(registry, { pollIntervalMs: 1, maxPolls: 3 });
    const results = [];
    for (const [index, request] of requests.entries()) {
      results.push(await gateway.execute(request, { idempotencyKey: `provided_fixture_${index}` }));
    }

    expect(results.map((result) => result.state.status)).toEqual(Array(5).fill('succeeded'));
    expect(storedMedia.map((item) => item.contentType).sort()).toEqual([
      'audio/wav',
      'image/png',
      'video/mp4',
    ]);
    expect(JSON.stringify(requestBodies.get('image'))).toContain('data:image/png;base64');
    expect(JSON.stringify(requestBodies.get('video'))).toContain('data:image/png;base64');
    expect(requestBodies.has('llm')).toBe(true);
    expect(requestBodies.has('vlm')).toBe(true);
    expect(requestBodies.has('tts')).toBe(true);
    expect(results[2]?.state.output).toMatchObject([{ width: 1, height: 1 }]);
    const videoOutput = results[3]?.state.output as Array<Record<string, unknown>> | undefined;
    expect(videoOutput?.[0]).not.toHaveProperty('width');
    expect(videoOutput?.[0]).not.toHaveProperty('height');
    expect(results[4]?.state.output).toMatchObject({ durationMs: 1_000 });
  });
});
