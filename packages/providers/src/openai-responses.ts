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

const responseSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(['queued', 'in_progress', 'completed', 'failed', 'cancelled', 'incomplete']),
    output: z.array(z.unknown()).optional(),
    error: z.object({ code: z.string().optional(), message: z.string().optional() }).nullable().optional(),
    usage: z
      .object({ input_tokens: z.number().nonnegative(), output_tokens: z.number().nonnegative() })
      .optional(),
  })
  .passthrough();

export interface OpenAIResponsesConfig {
  apiKey: string;
  model: string;
  route: ProviderRoute;
  capability: 'llm' | 'vlm';
  baseUrl?: string;
  inputCnyPerMillionTokens: number;
  outputCnyPerMillionTokens: number;
  verification?: ProviderDescriptor['verification'];
}

function extractOutputText(output: unknown[] | undefined): string {
  const texts: string[] = [];
  for (const item of output ?? []) {
    if (!item || typeof item !== 'object' || !('content' in item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (!part || typeof part !== 'object') continue;
      if ('text' in part && typeof part.text === 'string') texts.push(part.text);
    }
  }
  return texts.join('\n');
}

function mapStatus(status: z.infer<typeof responseSchema>['status']): ProviderJobState<unknown>['status'] {
  if (status === 'completed') return 'succeeded';
  if (status === 'failed' || status === 'incomplete') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return status === 'in_progress' ? 'running' : 'queued';
}

abstract class OpenAIResponsesProviderBase<I extends LlmProviderRequest | VlmProviderRequest, O>
  implements ProviderJob<I, O>
{
  readonly descriptor: ProviderDescriptor;
  abstract readonly inputSchema: z.ZodType<I>;
  abstract readonly outputSchema: z.ZodType<O>;
  protected readonly baseUrl: string;

  constructor(protected readonly config: OpenAIResponsesConfig) {
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.descriptor = {
      name: `openai-responses-${config.capability}`,
      model: config.model,
      capability: config.capability,
      route: config.route,
      mode: 'real',
      verification: config.verification ?? 'config_ready_unverified',
      timeoutMs: 120_000,
      maxAttempts: 3,
      rateLimitPerSecond: 5,
    };
  }

  protected abstract createBody(input: I): Record<string, unknown>;
  protected abstract parseOutput(text: string): O;

  async submit(input: I, context: ProviderCallContext): Promise<ProviderSubmitResult<O>> {
    const { json } = await fetchProviderJson(this.descriptor.name, `${this.baseUrl}/responses`, {
      method: 'POST',
      headers: bearerHeaders(this.config.apiKey, context.idempotencyKey),
      body: JSON.stringify({
        model: this.config.model,
        background: true,
        store: true,
        metadata: { onecrew_idempotency_key: context.idempotencyKey.slice(0, 64) },
        ...this.createBody(input),
      }),
      ...(context.signal ? { signal: context.signal } : {}),
    });
    const response = responseSchema.parse(json);
    const state = this.parseState(response);
    return {
      externalJobId: response.id,
      ...(state.status === 'queued' || state.status === 'running' ? {} : { immediateState: state }),
    };
  }

  async query(externalJobId: string, context: ProviderCallContext): Promise<ProviderJobState<O>> {
    const { json } = await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/responses/${encodeURIComponent(externalJobId)}`,
      {
        method: 'GET',
        headers: bearerHeaders(this.config.apiKey),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
    return this.parseState(responseSchema.parse(json));
  }

  async cancel(externalJobId: string, context: ProviderCallContext): Promise<void> {
    await fetchProviderJson(
      this.descriptor.name,
      `${this.baseUrl}/responses/${encodeURIComponent(externalJobId)}/cancel`,
      {
        method: 'POST',
        headers: bearerHeaders(this.config.apiKey),
        ...(context.signal ? { signal: context.signal } : {}),
      },
    );
  }

  async estimate(input: I): Promise<{ amountCny: number }> {
    const inputTokens = Math.ceil(JSON.stringify(input).length / 4);
    const outputTokens = 'maxOutputTokens' in input ? input.maxOutputTokens : 2_000;
    return {
      amountCny:
        (inputTokens * this.config.inputCnyPerMillionTokens +
          outputTokens * this.config.outputCnyPerMillionTokens) /
        1_000_000,
    };
  }

  private parseState(response: z.infer<typeof responseSchema>): ProviderJobState<O> {
    const status = mapStatus(response.status);
    const actualCostCny = response.usage
      ? (response.usage.input_tokens * this.config.inputCnyPerMillionTokens +
          response.usage.output_tokens * this.config.outputCnyPerMillionTokens) /
        1_000_000
      : undefined;
    if (status === 'succeeded') {
      const text = extractOutputText(response.output);
      if (!text) throw new ProviderError('OPENAI_EMPTY_OUTPUT', 'OpenAI response has no output text', false);
      return {
        status,
        output: this.outputSchema.parse(this.parseOutput(text)),
        ...(actualCostCny === undefined ? {} : { actualCostCny }),
      };
    }
    if (status === 'failed') {
      return {
        status,
        errorCode: response.error?.code ?? `OPENAI_${response.status.toUpperCase()}`,
        errorMessage: response.error?.message ?? `OpenAI response ended as ${response.status}`,
        ...(actualCostCny === undefined ? {} : { actualCostCny }),
      };
    }
    return { status, ...(actualCostCny === undefined ? {} : { actualCostCny }) };
  }
}

export class OpenAILlmProvider extends OpenAIResponsesProviderBase<LlmProviderRequest, LlmProviderOutput> {
  readonly inputSchema = llmProviderRequestSchema;
  readonly outputSchema = llmProviderOutputSchema;

  protected createBody(input: LlmProviderRequest): Record<string, unknown> {
    const content: Array<Record<string, unknown>> = [{ type: 'input_text', text: input.prompt }];
    content.push(...input.imageUris.map((imageUrl) => ({ type: 'input_image', image_url: imageUrl })));
    return {
      input: [{ role: 'user', content }],
      max_output_tokens: input.maxOutputTokens,
      ...(input.outputSchema
        ? {
            text: {
              format: {
                type: 'json_schema',
                name: `onecrew_${input.operation}`,
                strict: true,
                schema: input.outputSchema,
              },
            },
          }
        : {}),
    };
  }

  protected parseOutput(text: string): LlmProviderOutput {
    try {
      return { text, structured: JSON.parse(text) as Record<string, unknown> };
    } catch {
      return { text };
    }
  }
}

const vlmJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scores', 'decision', 'reason'],
  properties: {
    scores: {
      type: 'object',
      additionalProperties: false,
      required: [
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
      ],
      properties: Object.fromEntries(
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
        ].map((key) => [key, { type: 'number', minimum: 0, maximum: 1 }]),
      ),
    },
    decision: { type: 'string', enum: ['pass', 'regenerate', 'switch_model', 'manual'] },
    reason: { type: 'string' },
    retryPatch: { type: 'object' },
  },
} as const;

export class OpenAIVlmProvider extends OpenAIResponsesProviderBase<VlmProviderRequest, VlmProviderOutput> {
  readonly inputSchema = vlmProviderRequestSchema;
  readonly outputSchema = vlmProviderOutputSchema;

  protected createBody(input: VlmProviderRequest): Record<string, unknown> {
    if (input.mediaType === 'video') {
      throw new ProviderError(
        'OPENAI_VIDEO_INPUT_UNSUPPORTED',
        'This OpenAI VLM adapter only accepts image media; route video QC to a compatible fallback',
        false,
      );
    }
    return {
      input: [
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Evaluate this image. Expected: ${input.expectedDescription}\nCriteria: ${input.criteria.join('; ')}`,
            },
            { type: 'input_image', image_url: input.mediaUri },
          ],
        },
      ],
      text: { format: { type: 'json_schema', name: 'onecrew_vlm_qc', strict: true, schema: vlmJsonSchema } },
    };
  }

  protected parseOutput(text: string): VlmProviderOutput {
    try {
      return vlmProviderOutputSchema.parse(JSON.parse(text));
    } catch (error) {
      throw new ProviderError(
        'OPENAI_INVALID_STRUCTURED_OUTPUT',
        `OpenAI VLM output failed schema validation: ${error instanceof Error ? error.message : 'unknown error'}`,
        false,
      );
    }
  }
}
