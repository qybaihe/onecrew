import { ProviderError, ProviderTimeoutError } from './errors.js';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export async function withExecutionPolicy<T>(
  providerName: string,
  timeoutMs: number,
  policy: RetryPolicy,
  operation: (attempt: number, signal: AbortSignal) => Promise<T>,
): Promise<{ value: T; attempts: number }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      return { value: await operation(attempt, signal), attempts: attempt };
    } catch (error) {
      lastError = signal.aborted ? new ProviderTimeoutError(providerName, timeoutMs) : error;
      const retryable = lastError instanceof ProviderError ? lastError.retryable : false;
      if (!retryable || attempt === policy.maxAttempts) throw lastError;
      const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export class SlidingWindowLimiter {
  private readonly timestamps = new Map<string, number[]>();

  async acquire(key: string, maxPerSecond: number): Promise<void> {
    const now = Date.now();
    const recent = (this.timestamps.get(key) ?? []).filter((timestamp) => now - timestamp < 1_000);
    if (recent.length >= maxPerSecond) {
      const delay = Math.max(1, 1_000 - (now - recent[0]!));
      await new Promise((resolve) => setTimeout(resolve, delay));
      return this.acquire(key, maxPerSecond);
    }
    recent.push(Date.now());
    this.timestamps.set(key, recent);
  }
}

export interface BudgetDecision {
  status: 'within_budget' | 'soft_warning' | 'hard_approval';
  projectedCny: number;
  warning?: string;
}

export function evaluateBudget(
  spentCny: number,
  estimateCny: number,
  softLimitCny: number,
  hardLimitCny: number,
): BudgetDecision {
  const projectedCny = spentCny + estimateCny;
  if (projectedCny > hardLimitCny) {
    return { status: 'hard_approval', projectedCny, warning: 'Hard budget approval required' };
  }
  if (projectedCny > softLimitCny) {
    return { status: 'soft_warning', projectedCny, warning: 'Soft budget threshold exceeded' };
  }
  return { status: 'within_budget', projectedCny };
}
