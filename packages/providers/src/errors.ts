export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRouteError';
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(provider: string, timeoutMs: number) {
    super('PROVIDER_TIMEOUT', `${provider} exceeded ${timeoutMs}ms`, true, 504);
    this.name = 'ProviderTimeoutError';
  }
}

export class BudgetApprovalRequiredError extends Error {
  constructor(
    readonly spentCny: number,
    readonly estimateCny: number,
    readonly hardLimitCny: number,
  ) {
    super(
      `Estimated project spend ${(spentCny + estimateCny).toFixed(4)} CNY exceeds hard limit ${hardLimitCny.toFixed(4)} CNY`,
    );
    this.name = 'BudgetApprovalRequiredError';
  }
}
