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
import type { ProviderMediaSink } from './elevenlabs.js';
import { bearerHeaders, fetchProvider, fetchProviderJson } from './http.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';

const imageResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            url: z.url().nullable().optional(),
            b64_json: z.string().min(1).nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
    request_id: z.string().min(1).optional(),
  })
  .passthrough();

const videoCreateResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    task_id: z.string().min(1).optional(),
    video_id: z.string().min(1),
    status: z.string().optional(),
  })
  .passthrough();

const videoQueryResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    video_id: z.string().min(1).optional(),
    status: z.string().min(1),
    progress: z.coerce.number().min(0).max(100).optional(),
    seconds: z.coerce.number().positive().optional(),
    size: z.string().optional(),
    url: z.url().nullable().optional(),
    error: z
      .union([
        z.string(),
        z.object({ code: z.string().optional(), message: z.string().optional() }).passthrough(),
      ])
      .nullable()
      .optional(),
  })
  .passthrough();

interface AgnesBaseConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  baseUrl?: string;
  mediaSink: ProviderMediaSink;
  verification?: ProviderDescriptor['verification'];
}

export interface AgnesImageConfig extends AgnesBaseConfig {
  costCnyPerImage: number;
}

export interface AgnesVideoConfig extends AgnesBaseConfig {
  costCnyPerSecond: number;
}

function ratioFor(width: number, height: number): '1:1' | '3:4' | '4:3' | '16:9' | '9:16' | '2:3' | '3:2' | '21:9' {
  const value = width / height;
  const ratios = [
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['4:3', 4 / 3],
    ['16:9', 16 / 9],
    ['9:16', 9 / 16],
    ['2:3', 2 / 3],
    ['3:2', 3 / 2],
    ['21:9', 21 / 9],
  ] as const;
  return ratios.reduce((best, candidate) =>
    Math.abs(candidate[1] - value) < Math.abs(best[1] - value) ? candidate : best,
  )[0];
}

function normalizeImageMime(contentType: string, uri = ''): GeneratedImage['mimeType'] {
  const normalized = contentType.split(';')[0]?.trim().toLowerCase();
  if (normalized === 'image/png') return 'image/png';
  if (normalized === 'image/webp') return 'image/webp';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'image/jpeg';
  if (/\.png(?:\?|$)/i.test(uri)) return 'image/png';
  if (/\.webp(?:\?|$)/i.test(uri)) return 'image/webp';
  return 'image/jpeg';
}

function imageExtension(mimeType: GeneratedImage['mimeType']): 'png' | 'jpg' | 'webp' {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function imageDimensions(
  bytes: Uint8Array,
  mimeType: GeneratedImage['mimeType'],
): { width: number; height: number } | undefined {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    mimeType === 'image/png' &&
    view.length >= 24 &&
    view.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { width: view.readUInt32BE(16), height: view.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg' && view.length >= 4 && view[0] === 0xff && view[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < view.length) {
      if (view[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = view[offset + 1];
      if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
      const length = view.readUInt16BE(offset + 2);
      if (length < 2 || offset + length + 2 > view.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        )
      ) {
        return { width: view.readUInt16BE(offset + 7), height: view.readUInt16BE(offset + 5) };
      }
      offset += length + 2;
    }
  }
  if (
    mimeType === 'image/webp' &&
    view.length >= 30 &&
    view.toString('ascii', 0, 4) === 'RIFF' &&
    view.toString('ascii', 8, 12) === 'WEBP'
  ) {
    const chunk = view.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      const width = 1 + view.readUIntLE(24, 3);
      const height = 1 + view.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === 'VP8 ' && view.length >= 30 && view.subarray(23, 26).equals(Buffer.from([157, 1, 42]))) {
      return { width: view.readUInt16LE(26) & 0x3fff, height: view.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === 'VP8L' && view.length >= 25 && view[20] === 0x2f) {
      const byte1 = view[21]!;
      const byte2 = view[22]!;
      const byte3 = view[23]!;
      const byte4 = view[24]!;
      return {
        width: 1 + (((byte2 & 0x3f) << 8) | byte1),
        height: 1 + (((byte4 & 0x0f) << 10) | (byte3 << 2) | ((byte2 & 0xc0) >> 6)),
      };
    }
  }
  return undefined;
}

async function controlledInputUri(uri: string, mediaSink: ProviderMediaSink): Promise<string> {
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) return uri;
  if (!uri.startsWith('s3://') || !mediaSink.get) {
    throw new ProviderError(
      'AGNES_REFERENCE_URI_UNSUPPORTED',
      'Agnes references require HTTP(S), Data URI, or a readable controlled S3 object',
      false,
    );
  }
  const object = await mediaSink.get(uri);
  if (!object.contentType.startsWith('image/')) {
    throw new ProviderError('AGNES_REFERENCE_NOT_IMAGE', 'Agnes reference object is not an image', false);
  }
  return `data:${object.contentType};base64,${Buffer.from(object.bytes).toString('base64')}`;
}

async function download(
  provider: string,
  uri: string,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const response = await fetchProvider(provider, uri, {
    method: 'GET',
    ...(signal ? { signal } : {}),
  });
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new ProviderError('AGNES_MEDIA_TOO_LARGE', `Agnes media exceeds ${maxBytes} bytes`, false);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
    throw new ProviderError('AGNES_MEDIA_SIZE_INVALID', `Agnes media size ${bytes.byteLength} is invalid`, false);
  }
  return { bytes, contentType: response.headers.get('content-type') ?? 'application/octet-stream' };
}

export class AgnesImageProvider implements ProviderJob<ImageProviderRequest, GeneratedImage[]> {
  readonly inputSchema = imageProviderRequestSchema;
  readonly outputSchema = z.array(generatedImageSchema).min(1);
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: AgnesImageConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://apihub.agnes-ai.com').replace(/\/$/, '');
    this.descriptor = {
      name: 'agnes-image-2.1-flash',
      model: config.model,
      capability: 'image',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 360_000,
      maxAttempts: 3,
      rateLimitPerSecond: 2,
    };
  }

  async submit(
    input: ImageProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedImage[]>> {
    const references = await Promise.all(
      input.referenceUris.map((uri) => controlledInputUri(uri, this.config.mediaSink)),
    );
    const prompt = input.negativePrompt
      ? `${input.prompt}\nAvoid: ${input.negativePrompt}`
      : input.prompt;
    const output: GeneratedImage[] = [];
    const requestIds: string[] = [];
    for (let index = 0; index < input.count; index += 1) {
      const { response, json } = await fetchProviderJson(
        this.descriptor.name,
        `${this.baseUrl}/v1/images/generations`,
        {
          method: 'POST',
          headers: bearerHeaders(this.config.apiKey, `${context.idempotencyKey}:${index}`),
          body: JSON.stringify({
            model: this.config.model,
            prompt,
            size: '1K',
            ratio: ratioFor(input.width, input.height),
            ...(references.length === 0
              ? { return_base64: true }
              : { extra_body: { image: references, response_format: 'url' } }),
          }),
          ...(context.signal ? { signal: context.signal } : {}),
        },
      );
      const payload = imageResponseSchema.parse(json);
      const item = payload.data[0]!;
      let bytes: Uint8Array;
      let mimeType: GeneratedImage['mimeType'];
      if (item.b64_json) {
        bytes = new Uint8Array(Buffer.from(item.b64_json, 'base64'));
        mimeType = 'image/png';
      } else if (item.url) {
        const downloaded = await download(this.descriptor.name, item.url, context.signal, 64 * 1024 * 1024);
        bytes = downloaded.bytes;
        mimeType = normalizeImageMime(downloaded.contentType, item.url);
      } else {
        throw new ProviderError('AGNES_IMAGE_MISSING_OUTPUT', 'Agnes image response has no URL or Base64 data', false);
      }
      const hash = createInputHash({ input, index });
      const stored = await this.config.mediaSink.put({
        key: `providers/images/${input.projectId}/${input.shotId ?? 'unassigned'}/${hash}.${imageExtension(mimeType)}`,
        bytes,
        contentType: mimeType,
      });
      const dimensions = imageDimensions(bytes, mimeType) ?? {
        width: input.width,
        height: input.height,
      };
      output.push({
        uri: stored.uri,
        mimeType,
        ...dimensions,
        ...(input.seed === undefined ? {} : { seed: input.seed + index }),
      });
      const requestId = payload.request_id ?? response.headers.get('x-request-id');
      if (requestId) requestIds.push(requestId);
    }
    return {
      externalJobId: requestIds.join(',') || `agnes_image_${createInputHash(output).slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output: this.outputSchema.parse(output),
        actualCostCny: input.count * this.config.costCnyPerImage,
      },
    };
  }

  async query(): Promise<ProviderJobState<GeneratedImage[]>> {
    throw new ProviderError('AGNES_IMAGE_SYNCHRONOUS', 'Agnes image generation completes during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('AGNES_IMAGE_ALREADY_COMPLETE', 'Completed Agnes image generation cannot be cancelled', false);
  }

  async estimate(input: ImageProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: input.count * this.config.costCnyPerImage };
  }
}

interface EncodedVideoJob {
  videoId: string;
  taskId?: string;
  projectId: string;
  shotId: string;
  durationSec: number;
  width: number;
  height: number;
  inputHash: string;
}

function encodeVideoJob(input: EncodedVideoJob): string {
  return `agnes_${Buffer.from(JSON.stringify(input)).toString('base64url')}`;
}

function decodeVideoJob(externalJobId: string): EncodedVideoJob {
  try {
    if (!externalJobId.startsWith('agnes_')) throw new Error('prefix');
    const decoded = JSON.parse(Buffer.from(externalJobId.slice('agnes_'.length), 'base64url').toString('utf8')) as EncodedVideoJob;
    if (!decoded.videoId || !decoded.projectId || !decoded.shotId || !decoded.inputHash) throw new Error('shape');
    return decoded;
  } catch {
    throw new ProviderError('AGNES_VIDEO_JOB_ID_INVALID', 'Invalid persisted Agnes video job id', false);
  }
}

function videoDimensions(aspectRatio: VideoProviderRequest['aspectRatio']): { width: number; height: number } {
  if (aspectRatio === '9:16') return { width: 720, height: 1_280 };
  if (aspectRatio === '1:1') return { width: 768, height: 768 };
  return { width: 1_280, height: 720 };
}

function videoTiming(durationSec: number): { frameRate: number; numFrames: number } {
  const frameRate = Math.max(1, Math.min(24, Math.floor(440 / durationSec)));
  const groups = Math.max(1, Math.min(55, Math.round((durationSec * frameRate) / 8)));
  return { frameRate, numFrames: groups * 8 + 1 };
}

function errorMessage(error: z.infer<typeof videoQueryResponseSchema>['error']): string | undefined {
  if (typeof error === 'string') return error;
  return error?.message ?? error?.code;
}

export class AgnesVideoProvider implements ProviderJob<VideoProviderRequest, GeneratedVideo[]> {
  readonly inputSchema = videoProviderRequestSchema;
  readonly outputSchema = z.array(generatedVideoSchema).min(1);
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: AgnesVideoConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://apihub.agnes-ai.com').replace(/\/$/, '');
    this.descriptor = {
      name: 'agnes-video-v2.0',
      model: config.model,
      capability: 'video',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 180_000,
      maxAttempts: 3,
      rateLimitPerSecond: 2,
    };
  }

  async submit(
    input: VideoProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<GeneratedVideo[]>> {
    const firstFrame = input.referenceImageUri
      ? await controlledInputUri(input.referenceImageUri, this.config.mediaSink)
      : undefined;
    const lastFrame = input.lastFrameUri
      ? await controlledInputUri(input.lastFrameUri, this.config.mediaSink)
      : undefined;
    const dimensions = videoDimensions(input.aspectRatio);
    const timing = videoTiming(input.durationSec);
    const { json } = await fetchProviderJson(this.descriptor.name, `${this.baseUrl}/v1/videos`, {
      method: 'POST',
      headers: bearerHeaders(this.config.apiKey, context.idempotencyKey),
      body: JSON.stringify({
        model: this.config.model,
        prompt: input.prompt,
        width: dimensions.width,
        height: dimensions.height,
        num_frames: timing.numFrames,
        frame_rate: timing.frameRate,
        ...(input.seed === undefined ? {} : { seed: input.seed }),
        ...(firstFrame && lastFrame
          ? { mode: 'keyframes', extra_body: { image: [firstFrame, lastFrame], mode: 'keyframes' } }
          : firstFrame || lastFrame
            ? { image: firstFrame ?? lastFrame, mode: 'ti2vid' }
            : {}),
      }),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const response = videoCreateResponseSchema.parse(json);
    const taskId = response.task_id ?? response.id;
    return {
      externalJobId: encodeVideoJob({
        videoId: response.video_id,
        ...(taskId ? { taskId } : {}),
        projectId: input.projectId,
        shotId: input.shotId,
        durationSec: input.durationSec,
        ...dimensions,
        inputHash: createInputHash(input),
      }),
    };
  }

  async query(
    externalJobId: string,
    context: ProviderCallContext,
  ): Promise<ProviderJobState<GeneratedVideo[]>> {
    const job = decodeVideoJob(externalJobId);
    const url = new URL(`${this.baseUrl}/agnesapi`);
    url.searchParams.set('video_id', job.videoId);
    url.searchParams.set('model_name', this.config.model);
    const { json } = await fetchProviderJson(this.descriptor.name, url.toString(), {
      method: 'GET',
      headers: bearerHeaders(this.config.apiKey),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const response = videoQueryResponseSchema.parse(json);
    const status = response.status.toLowerCase();
    const progress = response.progress === undefined ? undefined : response.progress / 100;
    if (['queued', 'pending'].includes(status)) return { status: 'queued', ...(progress === undefined ? {} : { progress }) };
    if (['running', 'processing', 'generating', 'in_progress'].includes(status)) {
      return { status: 'running', ...(progress === undefined ? {} : { progress }) };
    }
    if (['cancelled', 'canceled'].includes(status)) return { status: 'cancelled', ...(progress === undefined ? {} : { progress }) };
    if (['failed', 'error', 'expired'].includes(status)) {
      return {
        status: 'failed',
        errorCode: `AGNES_VIDEO_${status.toUpperCase()}`,
        errorMessage: errorMessage(response.error) ?? `Agnes video task ended as ${status}`,
      };
    }
    if (!['completed', 'succeeded', 'success'].includes(status)) {
      throw new ProviderError('AGNES_VIDEO_UNKNOWN_STATUS', `Unknown Agnes video status ${response.status}`, true);
    }
    if (!response.url) {
      return { status: 'failed', errorCode: 'AGNES_VIDEO_MISSING_URL', errorMessage: 'Agnes video task has no output URL' };
    }
    const downloaded = await download(this.descriptor.name, response.url, context.signal, 512 * 1024 * 1024);
    const stored = await this.config.mediaSink.put({
      key: `providers/videos/${job.projectId}/${job.shotId}/${job.inputHash}.mp4`,
      bytes: downloaded.bytes,
      contentType: 'video/mp4',
    });
    const durationSec = response.seconds ?? job.durationSec;
    return {
      status: 'succeeded',
      progress: 1,
      output: [{
        uri: stored.uri,
        mimeType: 'video/mp4',
        durationSec,
      }],
      actualCostCny: durationSec * this.config.costCnyPerSecond,
    };
  }

  async cancel(): Promise<void> {
    throw new ProviderError(
      'AGNES_VIDEO_CANCEL_UNSUPPORTED',
      'Agnes Video V2.0 does not document a cancellation endpoint; the remote task remains active',
      false,
    );
  }

  async estimate(input: VideoProviderRequest): Promise<{ amountCny: number }> {
    return { amountCny: input.durationSec * this.config.costCnyPerSecond };
  }
}
