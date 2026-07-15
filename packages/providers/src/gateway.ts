import {
  providerJobStateSchema,
  providerRequestSchema,
  type ProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';

import { ProviderError } from './errors.js';
import { SlidingWindowLimiter, withExecutionPolicy } from './policy.js';
import type { ProviderRegistry } from './registry.js';
import type {
  AnyProviderJob,
  ProviderAuditEvent,
  ProviderCallContext,
  ProviderExecutionResult,
  ProviderJobState,
} from './types.js';

export interface ProviderGatewayOptions {
  pollIntervalMs?: number;
  maxPolls?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  onAudit?: (event: ProviderAuditEvent) => void | Promise<void>;
}

export interface ProviderExecutionHooks {
  onSubmitted?: (externalJobId: string) => void | Promise<void>;
}

export class ProviderGateway {
  private readonly limiter = new SlidingWindowLimiter();

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly options: ProviderGatewayOptions = {},
  ) {}

  private async call<T>(
    provider: AnyProviderJob,
    action: ProviderAuditEvent['action'],
    inputHash: string,
    operation: (context: { attempt: number; signal: AbortSignal }) => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    await this.limiter.acquire(provider.descriptor.name, provider.descriptor.rateLimitPerSecond);
    try {
      const result = await withExecutionPolicy(
        provider.descriptor.name,
        provider.descriptor.timeoutMs,
        {
          maxAttempts: provider.descriptor.maxAttempts,
          baseDelayMs: this.options.retryBaseDelayMs ?? 100,
          maxDelayMs: this.options.retryMaxDelayMs ?? 2_000,
        },
        async (attempt, signal) => operation({ attempt, signal }),
      );
      await this.options.onAudit?.({
        action,
        capability: provider.descriptor.capability,
        provider: provider.descriptor.name,
        model: provider.descriptor.model,
        mode: provider.descriptor.mode,
        route: provider.descriptor.route,
        inputHash,
        attempt: result.attempts,
        latencyMs: Date.now() - startedAt,
      });
      return result.value;
    } catch (error) {
      await this.options.onAudit?.({
        action: 'error',
        capability: provider.descriptor.capability,
        provider: provider.descriptor.name,
        model: provider.descriptor.model,
        mode: provider.descriptor.mode,
        route: provider.descriptor.route,
        inputHash,
        attempt: provider.descriptor.maxAttempts,
        latencyMs: Date.now() - startedAt,
        ...(error instanceof ProviderError ? { errorCode: error.code } : {}),
      });
      throw error;
    }
  }

  async estimate(requestInput: ProviderRequest): Promise<{
    descriptor: AnyProviderJob['descriptor'];
    inputHash: string;
    amountCny: number;
  }> {
    const request = providerRequestSchema.parse(requestInput);
    const provider = this.registry.get(request.capability, request.route);
    const parsed = provider.inputSchema.parse(request);
    const inputHash = createInputHash(parsed);
    const estimate = await this.call(provider, 'estimate', inputHash, () => provider.estimate(parsed));
    return { descriptor: provider.descriptor, inputHash, amountCny: estimate.amountCny };
  }

  async execute(
    requestInput: ProviderRequest,
    context: Omit<ProviderCallContext, 'signal'>,
    hooks: ProviderExecutionHooks = {},
  ): Promise<ProviderExecutionResult> {
    const startedAt = Date.now();
    const request = providerRequestSchema.parse(requestInput);
    const provider = this.registry.get(request.capability, request.route);
    const input = provider.inputSchema.parse(request);
    const inputHash = createInputHash(input);
    const estimate = await this.call(provider, 'estimate', inputHash, () => provider.estimate(input));
    const submitted = await this.call(provider, 'submit', inputHash, ({ signal }) =>
      provider.submit(input, { ...context, signal }),
    );
    await hooks.onSubmitted?.(submitted.externalJobId);

    let state = submitted.immediateState
      ? this.validateState(provider, submitted.immediateState)
      : await this.query(provider, submitted.externalJobId, context, inputHash);
    let polls = 0;
    while (state.status === 'queued' || state.status === 'running') {
      polls += 1;
      if (polls > (this.options.maxPolls ?? 120)) {
        throw new ProviderError('PROVIDER_POLL_LIMIT', 'Provider job exceeded polling limit', true);
      }
      await new Promise((resolve) => setTimeout(resolve, this.options.pollIntervalMs ?? 1_000));
      state = await this.query(provider, submitted.externalJobId, context, inputHash);
    }
    if (state.status === 'failed') {
      throw new ProviderError(
        state.errorCode ?? 'PROVIDER_JOB_FAILED',
        state.errorMessage ?? 'Provider job failed',
        false,
      );
    }
    await this.options.onAudit?.({
      action: 'complete',
      capability: provider.descriptor.capability,
      provider: provider.descriptor.name,
      model: provider.descriptor.model,
      mode: provider.descriptor.mode,
      route: provider.descriptor.route,
      inputHash,
      ...(state.output === undefined ? {} : { outputHash: createInputHash(state.output) }),
      attempt: 1,
      latencyMs: Date.now() - startedAt,
    });
    return {
      descriptor: provider.descriptor,
      externalJobId: submitted.externalJobId,
      state,
      inputHash,
      estimatedCostCny: estimate.amountCny,
      latencyMs: Date.now() - startedAt,
    };
  }

  async cancel(
    requestInput: ProviderRequest,
    externalJobId: string,
    context: Omit<ProviderCallContext, 'signal'>,
  ): Promise<void> {
    const request = providerRequestSchema.parse(requestInput);
    const provider = this.registry.get(request.capability, request.route);
    const inputHash = createInputHash(request);
    await this.call(provider, 'cancel', inputHash, ({ signal }) =>
      provider.cancel(externalJobId, { ...context, signal }),
    );
  }

  private async query(
    provider: AnyProviderJob,
    externalJobId: string,
    context: Omit<ProviderCallContext, 'signal'>,
    inputHash: string,
  ): Promise<ProviderJobState<unknown>> {
    const state = await this.call(provider, 'query', inputHash, ({ signal }) =>
      provider.query(externalJobId, { ...context, signal }),
    );
    return this.validateState(provider, state);
  }

  private validateState(
    provider: AnyProviderJob,
    input: ProviderJobState<unknown>,
  ): ProviderJobState<unknown> {
    const state = providerJobStateSchema.parse(input) as ProviderJobState<unknown>;
    if (state.status === 'succeeded') {
      if (state.output === undefined) throw new ProviderError('MISSING_OUTPUT', 'Succeeded job has no output', false);
      return { ...state, output: provider.outputSchema.parse(state.output) };
    }
    return state;
  }
}
