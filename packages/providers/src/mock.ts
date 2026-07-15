import {
  generatedAudioSchema,
  generatedImageSchema,
  generatedVideoSchema,
  imageProviderRequestSchema,
  llmProviderOutputSchema,
  llmProviderRequestSchema,
  ttsProviderRequestSchema,
  videoProviderRequestSchema,
  vlmProviderOutputSchema,
  vlmProviderRequestSchema,
  type GeneratedAudio,
  type GeneratedImage,
  type GeneratedVideo,
  type ImageProviderRequest,
  type LlmProviderOutput,
  type LlmProviderRequest,
  type ProviderCapability,
  type ProviderRequest,
  type ProviderRoute,
  type TtsProviderRequest,
  type VideoProviderRequest,
  type VlmProviderOutput,
  type VlmProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { z } from 'zod';

import { ProviderError } from './errors.js';
import { ProviderRegistry } from './registry.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';
import type { ProviderMediaSink } from './elevenlabs.js';

function requestText(input: ProviderRequest): string {
  if ('prompt' in input) return input.prompt;
  if ('text' in input) return input.text;
  return input.expectedDescription;
}

class DeterministicMockProvider<I extends ProviderRequest, O> implements ProviderJob<I, O> {
  readonly descriptor: ProviderDescriptor;
  private readonly transientAttempts = new Map<string, number>();
  private readonly cancelled = new Set<string>();

  constructor(
    capability: ProviderCapability,
    route: ProviderRoute,
    readonly inputSchema: z.ZodType<I>,
    readonly outputSchema: z.ZodType<O>,
    private readonly createOutput: (input: I, hash: string) => O | Promise<O>,
    private readonly estimateCost: (input: I) => number,
  ) {
    this.descriptor = {
      name: `mock-${capability}-${route}`,
      model: `deterministic-${capability}-v1`,
      capability,
      route,
      mode: 'mock',
      verification: 'mock_verified',
      timeoutMs: 2_000,
      maxAttempts: 3,
      rateLimitPerSecond: 100,
    };
  }

  async submit(input: I, context: ProviderCallContext): Promise<ProviderSubmitResult<O>> {
    const hash = createInputHash(input);
    const text = requestText(input);
    if (text.includes('[MOCK_FAIL_PERMANENT]')) {
      throw new ProviderError('MOCK_PERMANENT', 'Injected permanent Mock failure', false);
    }
    if (text.includes('[MOCK_FAIL_TRANSIENT]')) {
      const count = (this.transientAttempts.get(context.idempotencyKey) ?? 0) + 1;
      this.transientAttempts.set(context.idempotencyKey, count);
      if (count < 3) throw new ProviderError('MOCK_TRANSIENT', 'Injected transient Mock failure', true);
    }
    const externalJobId = `mock_${this.descriptor.capability}_${hash.slice(0, 20)}`;
    return {
      externalJobId,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output: await this.createOutput(input, hash),
        actualCostCny: this.estimateCost(input),
      },
    };
  }

  async query(externalJobId: string): Promise<ProviderJobState<O>> {
    if (this.cancelled.has(externalJobId)) return { status: 'cancelled' };
    throw new ProviderError('MOCK_UNKNOWN_JOB', `Unknown Mock job ${externalJobId}`, false, 404);
  }

  async cancel(externalJobId: string): Promise<void> {
    this.cancelled.add(externalJobId);
  }

  async estimate(input: I): Promise<{ amountCny: number }> {
    return { amountCny: this.estimateCost(input) };
  }
}

function mockUri(capability: ProviderCapability, hash: string, extension: string): string {
  return `mock://onecrew/${capability}/${hash.slice(0, 24)}.${extension}`;
}

function createProvider<I extends ProviderRequest, O>(
  capability: ProviderCapability,
  route: ProviderRoute,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  createOutput: (input: I, hash: string) => O | Promise<O>,
  estimateCost: (input: I) => number,
): ProviderJob<I, O> {
  return new DeterministicMockProvider(
    capability,
    route,
    inputSchema,
    outputSchema,
    createOutput,
    estimateCost,
  );
}

function mockStructuredOutput(input: LlmProviderRequest): Record<string, unknown> {
  const marker = 'ONECREW_MOCK_OUTPUT_JSON=';
  const markerIndex = input.prompt.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const json = input.prompt.slice(markerIndex + marker.length).trim();
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return {
    mock: true,
    operation: input.operation,
    locale: input.locale,
    hash: createInputHash(input),
  };
}

function createMockWav(durationMs: number, frequency: number): Uint8Array {
  const sampleRate = 24_000;
  const samples = Math.max(1, Math.round((durationMs / 1_000) * sampleRate));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 240, (samples - index) / 240);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 1_600 * fade;
    buffer.writeInt16LE(Math.round(value), 44 + index * 2);
  }
  return new Uint8Array(buffer);
}

export function createMockRegistry(mediaSink?: ProviderMediaSink): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const route of ['primary', 'fallback'] as const) {
    registry.register(
      createProvider<LlmProviderRequest, LlmProviderOutput>(
        'llm',
        route,
        llmProviderRequestSchema,
        llmProviderOutputSchema,
        (input, hash) => {
          const structured = input.outputSchema ? mockStructuredOutput(input) : undefined;
          return {
            text: structured ? JSON.stringify(structured) : `[MOCK:${route}] ${input.operation} ${hash.slice(0, 12)}`,
            ...(structured ? { structured } : {}),
          };
        },
        (input) => Number((input.prompt.length * 0.00001).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<ImageProviderRequest, GeneratedImage[]>(
        'image',
        route,
        imageProviderRequestSchema,
        z.array(generatedImageSchema).min(1),
        (input, hash) =>
          Array.from({ length: input.count }, (_, index) => ({
            uri: mockUri('image', createInputHash({ hash, index }), 'png'),
            mimeType: 'image/png',
            width: input.width,
            height: input.height,
            seed: input.seed ?? Number.parseInt(hash.slice(index, index + 8), 16),
          })),
        (input) => Number((input.count * input.width * input.height * 0.00000001).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<VideoProviderRequest, GeneratedVideo[]>(
        'video',
        route,
        videoProviderRequestSchema,
        z.array(generatedVideoSchema).min(1),
        (input, hash) => [
          {
            uri: mockUri('video', hash, 'mp4'),
            mimeType: 'video/mp4',
            durationSec: input.durationSec,
          },
        ],
        (input) => Number((input.durationSec * 0.01).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<TtsProviderRequest, GeneratedAudio>(
        'tts',
        route,
        ttsProviderRequestSchema,
        generatedAudioSchema,
        async (input, hash) => {
          const durationMs = Math.min(15_000, Math.max(500, input.text.length * 120));
          if (!mediaSink) {
            return {
              uri: mockUri('tts', hash, input.outputFormat.startsWith('mp3') ? 'mp3' : 'wav'),
              mimeType: input.outputFormat.startsWith('mp3') ? 'audio/mpeg' as const : 'audio/wav' as const,
              durationMs,
              characterCost: input.text.length,
            };
          }
          const stored = await mediaSink.put({
            key: `providers/mock/tts/${input.projectId}/${input.lineId}/${hash}.wav`,
            bytes: createMockWav(durationMs, 180 + Number.parseInt(hash.slice(0, 2), 16)),
            contentType: 'audio/wav',
          });
          return {
            uri: stored.uri,
            mimeType: 'audio/wav' as const,
            durationMs,
            characterCost: input.text.length,
          };
        },
        (input) => Number((input.text.length * 0.00002).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<VlmProviderRequest, VlmProviderOutput>(
        'vlm',
        route,
        vlmProviderRequestSchema,
        vlmProviderOutputSchema,
        () => ({
          scores: {
            character: 0.92,
            clothing: 0.92,
            background: 0.92,
            action: 0.92,
            flicker: 0.92,
            lipsync: 0.92,
            subtitle: 0.92,
            brand: 0.92,
            safeArea: 0.92,
            audio: 0.92,
            compliance: 0.92,
          },
          decision: 'pass',
          reason: `MOCK ${route} deterministic QC pass`,
        }),
        (input) => Number((input.criteria.length * 0.001).toFixed(4)),
      ),
    );
  }
  registry.assertComplete();
  return registry;
}
