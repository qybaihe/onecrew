import type {
  ProviderCapability,
  ProviderJobState as ProviderJobStateContract,
  ProviderMode,
  ProviderRequest,
  ProviderRoute,
} from '@onecrew/contracts';
import type { z } from 'zod';

export type ProviderVerification = 'mock_verified' | 'config_ready_unverified' | 'real_smoke_verified';

export interface ProviderDescriptor {
  name: string;
  model: string;
  capability: ProviderCapability;
  route: ProviderRoute;
  mode: ProviderMode;
  verification: ProviderVerification;
  timeoutMs: number;
  maxAttempts: number;
  rateLimitPerSecond: number;
}

export type ProviderJobState<TOutput> = Omit<ProviderJobStateContract, 'output'> & {
  output?: TOutput;
};

export interface ProviderCallContext {
  idempotencyKey: string;
  signal?: AbortSignal;
  callbackUrl?: string;
}

export interface ProviderSubmitResult<TOutput> {
  externalJobId: string;
  immediateState?: ProviderJobState<TOutput>;
}

export interface ProviderJob<TInput extends ProviderRequest, TOutput> {
  readonly descriptor: ProviderDescriptor;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  submit(input: TInput, context: ProviderCallContext): Promise<ProviderSubmitResult<TOutput>>;
  query(externalJobId: string, context: ProviderCallContext): Promise<ProviderJobState<TOutput>>;
  cancel(externalJobId: string, context: ProviderCallContext): Promise<void>;
  estimate(input: TInput): Promise<{ amountCny: number }>;
}

export type AnyProviderJob = ProviderJob<ProviderRequest, unknown>;

export interface ProviderAuditEvent {
  action: 'estimate' | 'submit' | 'query' | 'cancel' | 'complete' | 'error';
  capability: ProviderCapability;
  provider: string;
  model: string;
  mode: ProviderMode;
  route: ProviderRoute;
  inputHash: string;
  outputHash?: string;
  attempt: number;
  latencyMs: number;
  errorCode?: string;
}

export interface ProviderExecutionResult<TOutput = unknown> {
  descriptor: ProviderDescriptor;
  externalJobId: string;
  state: ProviderJobState<TOutput>;
  inputHash: string;
  estimatedCostCny: number;
  latencyMs: number;
}
