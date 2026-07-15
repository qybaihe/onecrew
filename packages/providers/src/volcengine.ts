import {
  generatedImageSchema,
  generatedVideoSchema,
  imageProviderRequestSchema,
  videoProviderRequestSchema,
  type GeneratedImage,
  type GeneratedVideo,
  type ImageProviderRequest,
  type ProviderRoute,
  type VideoProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { z } from 'zod';

import { ProviderError } from './errors.js';
import { bearerHeaders, fetchProviderJson } from './http.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';

const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        url: z.url().optional(),
        b64_json: z.string().min(1).optional(),
        size: z.string().optional(),
      }),
    )
    .min(1),
  request_id: z.string().optional(),
});

const videoCreateResponseSchema = z.object({ id: z.string().min(1) });
const videoQueryResponseSchema = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    content: z.object({ video_url: z.url().optional() }).optional(),
    output: z.object({ video_url: z.url().optional() }).optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).optional(),
  })
  .passthrough();

interface VolcengineBaseConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  baseUrl?: string;
  verification?: ProviderDescriptor['verification'];
}

export interface VolcengineImageConfig extends VolcengineBaseConfig {
  costCnyPerImage: number;
}

export interface VolcengineVideoConfig extends VolcengineBaseConfig {
  costCnyPerSecond: number;
}

function imageMimeType(uri: string): GeneratedImage['mimeType'] {
  if (/\.png(?:\?|$)/i.test(uri)) return 'image/png';
  if (/\.webp(?:\?|$)/i.test(uri)) return 'image/webp';
  return 'image/jpeg';
}

export class VolcengineSeedreamProvider
  implements ProviderJob<ImageProviderRequest, GeneratedImage[]>
{
  readonly inputSchema = imageProviderRequestSchema;
  readonly outputSchema = z.array(generatedImageSchema).min(1);
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: VolcengineImageConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.descriptor = {
      name: 'volcengine-seedream',
      model: config.model,
      capability: 'image',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 180_000,
      maxAttempts: 3,
      rateLimitPerSecond: 2,
    };
  }

  async submit(
    input: ImageProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedImage[]>> {
    const { response, json } = await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/images/generations`,
      {
        method: 'POST',
        headers: bearerHeaders(this.config.apiKey, context.idempotencyKey),
        body: JSON.stringify({
          model: this.config.model,
          prompt: input.prompt,
          size: `${input.width}x${input.height}`,
          n: input.count,
          response_format: 'url',
          watermark: false,
          ...(input.negativePrompt ? { negative_prompt: input.negativePrompt } : {}),
          ...(input.referenceUris.length > 0 ? { image: input.referenceUris } : {}),
          ...(input.seed === undefined ? {} : { seed: input.seed }),
        }),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const payload = imageResponseSchema.parse(json);
    const output = payload.data.map((item, index): GeneratedImage => {
      const uri = item.url ?? `data:image/png;base64,${item.b64_json ?? ''}`;
      if (!item.url && !item.b64_json) {
        throw new ProviderError('SEEDREAM_MISSING_IMAGE', `Seedream result ${index} has no image`, false);
      }
      return {
        uri,
        mimeType: imageMimeType(uri),
        width: input.width,
        height: input.height,
        ...(input.seed === undefined ? {} : { seed: input.seed + index }),
      };
    });
    return {
      externalJobId:
        payload.request_id ?? response.headers.get('x-request-id') ?? `seedream_${createInputHash(output).slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output: this.outputSchema.parse(output),
        actualCostCny: input.count * this.config.costCnyPerImage,
      },
    };
  }

  async query(): Promise<ProviderJobState<GeneratedImage[]>> {
    throw new ProviderError('SEEDREAM_SYNCHRONOUS', 'Seedream image jobs complete during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('SEEDREAM_ALREADY_COMPLETE', 'Synchronous Seedream jobs cannot be cancelled', false);
  }

  async estimate(input: ImageProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: input.count * this.config.costCnyPerImage };
  }
}

function encodedVideoJobId(remoteId: string, durationSec: number): string {
  return `${remoteId}::onecrew_duration_${durationSec}`;
}

function decodeVideoJobId(externalJobId: string): { remoteId: string; durationSec: number } {
  const match = externalJobId.match(/^(.*)::onecrew_duration_(\d+)$/);
  if (!match?.[1] || !match[2]) {
    throw new ProviderError('SEEDANCE_JOB_ID_INVALID', 'Invalid persisted Seedance job id', false);
  }
  return { remoteId: match[1], durationSec: Number(match[2]) };
}

export class VolcengineSeedanceProvider
  implements ProviderJob<VideoProviderRequest, GeneratedVideo[]>
{
  readonly inputSchema = videoProviderRequestSchema;
  readonly outputSchema = z.array(generatedVideoSchema).min(1);
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: VolcengineVideoConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/$/, '');
    this.descriptor = {
      name: 'volcengine-seedance',
      model: config.model,
      capability: 'video',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 120_000,
      maxAttempts: 3,
      rateLimitPerSecond: 2,
    };
  }

  async submit(
    input: VideoProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedVideo[]>> {
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: input.prompt }];
    if (input.referenceImageUri) {
      content.push({
        type: 'image_url',
        image_url: { url: input.referenceImageUri },
        role: 'first_frame',
      });
    }
    if (input.lastFrameUri) {
      content.push({ type: 'image_url', image_url: { url: input.lastFrameUri }, role: 'last_frame' });
    }
    const { json } = await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/contents/generations/tasks`,
      {
        method: 'POST',
        headers: bearerHeaders(this.config.apiKey, context.idempotencyKey),
        body: JSON.stringify({
          model: this.config.model,
          content,
          duration: input.durationSec,
          ratio: input.aspectRatio,
          generate_audio: false,
          watermark: false,
          ...(input.seed === undefined ? {} : { seed: input.seed }),
        }),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const response = videoCreateResponseSchema.parse(json);
    return { externalJobId: encodedVideoJobId(response.id, input.durationSec) };
  }

  async query(
    externalJobId: string,
    context: ProviderCallContext,
  ): Promise<ProviderJobState<GeneratedVideo[]>> {
    const { remoteId, durationSec } = decodeVideoJobId(externalJobId);
    const { json } = await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/contents/generations/tasks/${encodeURIComponent(remoteId)}`,
      {
        method: 'GET',
        headers: bearerHeaders(this.config.apiKey),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const response = videoQueryResponseSchema.parse(json);
    if (['queued', 'pending'].includes(response.status)) return { status: 'queued', progress: 0 };
    if (['running', 'processing'].includes(response.status)) return { status: 'running' };
    if (['cancelled', 'canceled'].includes(response.status)) return { status: 'cancelled' };
    if (['failed', 'error', 'expired'].includes(response.status)) {
      return {
        status: 'failed',
        errorCode: response.error?.code ?? `SEEDANCE_${response.status.toUpperCase()}`,
        errorMessage: response.error?.message ?? `Seedance task ended as ${response.status}`,
      };
    }
    if (['succeeded', 'completed', 'success'].includes(response.status)) {
      const uri = response.content?.video_url ?? response.output?.video_url;
      if (!uri) return { status: 'failed', errorCode: 'SEEDANCE_MISSING_VIDEO', errorMessage: 'No video URL' };
      return {
        status: 'succeeded',
        progress: 1,
        output: [{ uri, mimeType: 'video/mp4', durationSec }],
        actualCostCny: durationSec * this.config.costCnyPerSecond,
      };
    }
    throw new ProviderError('SEEDANCE_UNKNOWN_STATUS', `Unknown Seedance status ${response.status}`, true);
  }

  async cancel(externalJobId: string, context: ProviderCallContext): Promise<void> {
    const { remoteId } = decodeVideoJobId(externalJobId);
    await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/contents/generations/tasks/${encodeURIComponent(remoteId)}`,
      {
        method: 'DELETE',
        headers: bearerHeaders(this.config.apiKey),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
  }

  async estimate(input: VideoProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: input.durationSec * this.config.costCnyPerSecond };
  }
}
