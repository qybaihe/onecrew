import {
  generatedAudioSchema,
  ttsProviderRequestSchema,
  type GeneratedAudio,
  type ProviderRoute,
  type TtsProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { z } from 'zod';

import { ProviderError } from './errors.js';
import type { ProviderMediaSink } from './elevenlabs.js';
import { fetchProviderJson } from './http.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';

const mimoResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                audio: z.object({ data: z.string().min(1) }).passthrough(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

export interface MimoTtsConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  baseUrl?: string;
  zhVoices: string[];
  enVoices: string[];
  costCnyPerThousandCharacters: number;
  mediaSink: ProviderMediaSink;
  verification?: ProviderDescriptor['verification'];
}

function selectVoice(input: TtsProviderRequest, voices: string[]): string {
  if (voices.length === 0) throw new ProviderError('MIMO_VOICE_LIST_EMPTY', 'MiMo voice list is empty', false);
  const index = Number.parseInt(createInputHash(input.voiceId).slice(0, 8), 16) % voices.length;
  return voices[index]!;
}

function audioFormat(input: TtsProviderRequest): {
  apiFormat: 'wav' | 'pcm16';
  extension: 'wav' | 'pcm';
  mimeType: GeneratedAudio['mimeType'];
} {
  if (input.outputFormat.startsWith('pcm')) {
    return { apiFormat: 'pcm16', extension: 'pcm', mimeType: 'audio/pcm' };
  }
  return { apiFormat: 'wav', extension: 'wav', mimeType: 'audio/wav' };
}

function wavDurationMs(bytes: Uint8Array): number | undefined {
  if (bytes.byteLength < 44) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    );
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return undefined;

  let byteRate: number | undefined;
  let dataBytes: number | undefined;
  for (let offset = 12; offset + 8 <= bytes.byteLength;) {
    const chunkId = tag(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkStart + chunkSize > bytes.byteLength) return undefined;
    if (chunkId === 'fmt ' && chunkSize >= 12) {
      byteRate = view.getUint32(chunkStart + 8, true);
    } else if (chunkId === 'data') {
      dataBytes = chunkSize;
    }
    if (byteRate && dataBytes !== undefined) break;
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!byteRate || dataBytes === undefined) return undefined;
  return Math.max(1, Math.round((dataBytes / byteRate) * 1_000));
}

export class MimoTtsProvider implements ProviderJob<TtsProviderRequest, GeneratedAudio> {
  readonly inputSchema = ttsProviderRequestSchema;
  readonly outputSchema = generatedAudioSchema;
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: MimoTtsConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.xiaomimimo.com/v1').replace(/\/$/, '');
    this.descriptor = {
      name: 'xiaomi-mimo-v2.5-tts',
      model: config.model,
      capability: 'tts',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 180_000,
      maxAttempts: 3,
      rateLimitPerSecond: 3,
    };
  }

  async submit(
    input: TtsProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedAudio>> {
    const format = audioFormat(input);
    const voice = selectVoice(input, input.locale === 'zh-CN' ? this.config.zhVoices : this.config.enVoices);
    const { json } = await fetchProviderJson(this.descriptor.name, `${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'api-key': this.config.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': context.idempotencyKey,
      },
      body: JSON.stringify({
        model: this.config.model,
        messages: [{ role: 'assistant', content: input.text }],
        audio: { format: format.apiFormat, voice },
      }),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const response = mimoResponseSchema.parse(json);
    const audioBase64 = response.choices[0]!.message.audio.data;
    const bytes = new Uint8Array(Buffer.from(audioBase64, 'base64'));
    if (bytes.byteLength === 0) throw new ProviderError('MIMO_EMPTY_AUDIO', 'MiMo returned empty audio', false);
    const hash = createInputHash(input);
    const stored = await this.config.mediaSink.put({
      key: `providers/tts/${input.projectId}/${input.lineId}/${hash}.${format.extension}`,
      bytes,
      contentType: format.mimeType,
    });
    const durationMs = format.mimeType === 'audio/wav' ? wavDurationMs(bytes) : undefined;
    const output = generatedAudioSchema.parse({
      uri: stored.uri,
      mimeType: format.mimeType,
      ...(durationMs ? { durationMs } : {}),
      characterCost: input.text.length,
    });
    return {
      externalJobId: response.id ?? `mimo_${hash.slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output,
        actualCostCny: (input.text.length / 1_000) * this.config.costCnyPerThousandCharacters,
      },
    };
  }

  async query(): Promise<ProviderJobState<GeneratedAudio>> {
    throw new ProviderError('MIMO_SYNCHRONOUS', 'MiMo TTS completes during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('MIMO_ALREADY_COMPLETE', 'Completed MiMo TTS cannot be cancelled', false);
  }

  async estimate(input: TtsProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: (input.text.length / 1_000) * this.config.costCnyPerThousandCharacters };
  }
}
