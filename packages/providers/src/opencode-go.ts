import {
  llmProviderOutputSchema,
  llmProviderRequestSchema,
  vlmProviderOutputSchema,
  vlmProviderRequestSchema,
  type LlmProviderOutput,
  type LlmProviderRequest,
  type ProviderRoute,
  type VlmProviderOutput,
  type VlmProviderRequest,
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

const tokenUsageSchema = z
  .object({
    prompt_tokens: z.number().nonnegative().optional(),
    completion_tokens: z.number().nonnegative().optional(),
    input_tokens: z.number().nonnegative().optional(),
    output_tokens: z.number().nonnegative().optional(),
  })
  .passthrough();

const chatResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.union([
                  z.string(),
                  z.array(z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough()),
                ]),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: tokenUsageSchema.optional(),
  })
  .passthrough();

const messagesResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()).min(1),
    usage: tokenUsageSchema.optional(),
  })
  .passthrough();

interface OpenCodeGoBaseConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  baseUrl?: string;
  inputCnyPerMillionTokens: number;
  outputCnyPerMillionTokens: number;
  verification?: ProviderDescriptor['verification'];
}

export type OpenCodeGoLlmConfig = OpenCodeGoBaseConfig;
export type OpenCodeGoVlmConfig = OpenCodeGoBaseConfig;

function contentText(content: string | Array<{ text?: string | undefined }>): string {
  return typeof content === 'string'
    ? content
    : content.map((item) => item.text ?? '').filter(Boolean).join('\n');
}

function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

function parseJson(text: string, code: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(stripJsonFence(text)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('expected a JSON object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new ProviderError(
      code,
      `OpenCode Go returned invalid structured JSON: ${error instanceof Error ? error.message : 'unknown error'}`,
      false,
    );
  }
}

function tokenCost(
  usage: z.infer<typeof tokenUsageSchema> | undefined,
  inputCnyPerMillionTokens: number,
  outputCnyPerMillionTokens: number,
): number | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? usage.output_tokens ?? 0;
  return (
    (inputTokens * inputCnyPerMillionTokens + outputTokens * outputCnyPerMillionTokens) /
    1_000_000
  );
}

export class OpenCodeGoLlmProvider implements ProviderJob<LlmProviderRequest, LlmProviderOutput> {
  readonly inputSchema = llmProviderRequestSchema;
  readonly outputSchema = llmProviderOutputSchema;
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenCodeGoLlmConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://opencode.ai/zen/go/v1').replace(/\/$/, '');
    this.descriptor = {
      name: 'opencode-go-chat-llm',
      model: config.model,
      capability: 'llm',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 180_000,
      maxAttempts: 3,
      rateLimitPerSecond: 3,
    };
  }

  async submit(
    input: LlmProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<LlmProviderOutput>> {
    if (input.imageUris.length > 0) {
      throw new ProviderError(
        'OPENCODE_GLM_IMAGE_INPUT_UNSUPPORTED',
        'The configured GLM text model does not accept image inputs; use the VLM capability instead',
        false,
      );
    }
    const structuredInstruction = input.outputSchema
      ? `\n\nReturn exactly one JSON object and no Markdown. The object must satisfy this JSON Schema:\n${JSON.stringify(input.outputSchema)}`
      : '';
    const { json } = await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: bearerHeaders(this.config.apiKey, context.idempotencyKey),
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: `${input.prompt}${structuredInstruction}` }],
          max_tokens: input.maxOutputTokens,
          temperature: 0,
        }),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    const response = chatResponseSchema.parse(json);
    const text = contentText(response.choices[0]!.message.content);
    if (!text) throw new ProviderError('OPENCODE_EMPTY_OUTPUT', 'OpenCode Go returned no text', false);
    const output = llmProviderOutputSchema.parse({
      text,
      ...(input.outputSchema ? { structured: parseJson(text, 'OPENCODE_INVALID_STRUCTURED_OUTPUT') } : {}),
    });
    const actualCostCny = tokenCost(
      response.usage,
      this.config.inputCnyPerMillionTokens,
      this.config.outputCnyPerMillionTokens,
    );
    return {
      externalJobId: response.id ?? `opencode_${createInputHash(output).slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output,
        ...(actualCostCny === undefined ? {} : { actualCostCny }),
      },
    };
  }

  async query(): Promise<ProviderJobState<LlmProviderOutput>> {
    throw new ProviderError('OPENCODE_SYNCHRONOUS', 'OpenCode Go chat completes during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('OPENCODE_ALREADY_COMPLETE', 'Completed OpenCode Go chat cannot be cancelled', false);
  }

  async estimate(input: LlmProviderRequest): Promise<{ amountCny: number }> {
    const inputTokens = Math.ceil((input.prompt.length + JSON.stringify(input.outputSchema ?? {}).length) / 4);
    return {
      amountCny:
        (inputTokens * this.config.inputCnyPerMillionTokens +
          input.maxOutputTokens * this.config.outputCnyPerMillionTokens) /
        1_000_000,
    };
  }
}

function anthropicImageSource(uri: string): Record<string, unknown> {
  const dataUri = uri.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (dataUri?.[1] && dataUri[2]) {
    return { type: 'base64', media_type: dataUri[1], data: dataUri[2] };
  }
  if (uri.startsWith('https://') || uri.startsWith('http://')) return { type: 'url', url: uri };
  throw new ProviderError(
    'OPENCODE_VLM_MEDIA_URI_UNSUPPORTED',
    'OpenCode Go VLM requires an HTTP(S) image or image Data URI',
    false,
  );
}

const scoreKeys = [
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
] as const;

function normalizeVlmOutput(parsed: Record<string, unknown>): VlmProviderOutput {
  if (!parsed.scores) {
    const scores = Object.fromEntries(scoreKeys.map((key) => [key, parsed[key]]));
    return vlmProviderOutputSchema.parse({ ...parsed, scores });
  }
  return vlmProviderOutputSchema.parse(parsed);
}

export class OpenCodeGoVlmProvider implements ProviderJob<VlmProviderRequest, VlmProviderOutput> {
  readonly inputSchema = vlmProviderRequestSchema;
  readonly outputSchema = vlmProviderOutputSchema;
  readonly descriptor: ProviderDescriptor;
  private readonly baseUrl: string;

  constructor(private readonly config: OpenCodeGoVlmConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://opencode.ai/zen/go/v1').replace(/\/$/, '');
    this.descriptor = {
      name: 'opencode-go-messages-vlm',
      model: config.model,
      capability: 'vlm',
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 180_000,
      maxAttempts: 3,
      rateLimitPerSecond: 3,
    };
  }

  async submit(
    input: VlmProviderRequest,
    context: ProviderCallContext,
  ): Promise<ProviderSubmitResult<VlmProviderOutput>> {
    if (input.mediaType !== 'image') {
      throw new ProviderError(
        'OPENCODE_VLM_VIDEO_INPUT_UNSUPPORTED',
        'OneCrew must materialize video QC as a review contact sheet before calling OpenCode Go VLM',
        false,
      );
    }
    const prompt = [
      `Evaluate the supplied review image. Expected content: ${input.expectedDescription}`,
      `Criteria: ${input.criteria.join('; ')}`,
      `Return only JSON with scores for ${scoreKeys.join(', ')} as numbers from 0 to 1,`,
      'decision as pass, regenerate, switch_model, or manual, and a non-empty reason.',
    ].join('\n');
    const { json } = await fetchProviderJson(this.descriptor.name, `${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Idempotency-Key': context.idempotencyKey,
      },
      body: JSON.stringify({
        model: this.config.model,
        max_tokens: 2_000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: anthropicImageSource(input.mediaUri) },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const response = messagesResponseSchema.parse(json);
    const text = response.content.map((item) => item.text ?? '').filter(Boolean).join('\n');
    if (!text) throw new ProviderError('OPENCODE_VLM_EMPTY_OUTPUT', 'OpenCode Go VLM returned no text', false);
    const output = normalizeVlmOutput(parseJson(text, 'OPENCODE_VLM_INVALID_STRUCTURED_OUTPUT'));
    const actualCostCny = tokenCost(
      response.usage,
      this.config.inputCnyPerMillionTokens,
      this.config.outputCnyPerMillionTokens,
    );
    return {
      externalJobId: response.id ?? `opencode_vlm_${createInputHash(output).slice(0, 20)}`,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output,
        ...(actualCostCny === undefined ? {} : { actualCostCny }),
      },
    };
  }

  async query(): Promise<ProviderJobState<VlmProviderOutput>> {
    throw new ProviderError('OPENCODE_VLM_SYNCHRONOUS', 'OpenCode Go VLM completes during submit', false);
  }

  async cancel(): Promise<void> {
    throw new ProviderError('OPENCODE_VLM_ALREADY_COMPLETE', 'Completed OpenCode Go VLM cannot be cancelled', false);
  }

  async estimate(input: VlmProviderRequest): Promise<{ amountCny: number }> {
    const inputTokens = Math.ceil((input.expectedDescription.length + JSON.stringify(input.criteria).length) / 4) + 1_000;
    return {
      amountCny:
        (inputTokens * this.config.inputCnyPerMillionTokens +
          2_000 * this.config.outputCnyPerMillionTokens) /
        1_000_000,
    };
  }
}
