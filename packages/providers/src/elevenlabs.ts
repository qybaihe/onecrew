import {
  generatedAudioSchema,
  ttsProviderRequestSchema,
  type GeneratedAudio,
  type ProviderRoute,
  type TtsProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';

import { ProviderError } from './errors.js';
import { fetchProvider } from './http.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';

export interface ProviderMediaSink {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ uri: string }>;
}

export interface ElevenLabsConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  costCnyPerThousandCharacters: number;
  mediaSink: ProviderMediaSink;
  baseUrl?: string;
  verification?: ProviderDescriptor['verification'];
}

function audioMetadata(format: TtsProviderRequest['outputFormat']): {
  extension: string;
  mimeType: GeneratedAudio['mimeType'];
} {
  if (format.startsWith('mp3')) return { extension: 'mp3', mimeType: 'audio/mpeg' };
  if (format.startsWith('pcm')) return { extension: 'pcm', mimeType: 'audio/pcm' };
  return { extension: 'wav', mimeType: 'audio/wav' };
}

export class ElevenLabsTtsProvider implements ProviderJob<TtsProviderRequest, GeneratedAudio> {
  readonly inputSchema = ttsProviderRequestSchema;
  readonly outputSchema = generatedAudioSchema;
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: ElevenLabsConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.elevenlabs.io/v1').replace(/\/$/, '');
    this.descriptor = {
      name: 'elevenlabs-tts',
      model: config.model,
      capability: 'tts',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 120_000,
      maxAttempts: 3,
      rateLimitPerSecond: 3,
    };
  }

  async submit(
    input: TtsProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedAudio>> {
    const response = await fetchProvider(
      this.descriptor.name,
      `${this.baseUrl}/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${encodeURIComponent(input.outputFormat)}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': this.config.apiKey,
          'Content-Type': 'application/json',
          'Idempotency-Key': context.idempotencyKey,
        },
        body: JSON.stringify({
          text: input.text,
          model_id: this.config.model,
          ...(input.seed === undefined ? {} : { seed: input.seed }),
        }),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new ProviderError('ELEVENLABS_EMPTY_AUDIO', 'Empty audio body', false);
    const hash = createInputHash(input);
    const metadata = audioMetadata(input.outputFormat);
    const stored = await this.config.mediaSink.put({
      key: `providers/tts/${input.projectId}/${input.lineId}/${hash}.${metadata.extension}`,
      bytes,
      contentType: metadata.mimeType,
    });
    const characterCost = Number(response.headers.get('character-cost') ?? input.text.length);
    const output = generatedAudioSchema.parse({
      uri: stored.uri,
      mimeType: metadata.mimeType,
      characterCost,
    });
    return {
      externalJobId: response.headers.get('request-id') ?? `elevenlabs_${hash.slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output,
        actualCostCny: (characterCost / 1_000) * this.config.costCnyPerThousandCharacters,
      },
    };
  }

  async query(): Promise<ProviderJobState<GeneratedAudio>> {
    throw new ProviderError('ELEVENLABS_SYNCHRONOUS', 'ElevenLabs TTS completes during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('ELEVENLABS_ALREADY_COMPLETE', 'Completed TTS requests cannot be cancelled', false);
  }

  async estimate(input: TtsProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: (input.text.length / 1_000) * this.config.costCnyPerThousandCharacters };
  }
}
