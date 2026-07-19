import { describe, expect, it } from 'vitest';

import { formatBudgetProviderFailure } from './BudgetAllocationPage.js';

describe('formatBudgetProviderFailure', () => {
  it('keeps an exhausted GLM endpoint actionable without claiming a product failure', () => {
    expect(formatBudgetProviderFailure(
      'GoUsageLimitError: Monthly usage limit reached. Resets in 10 days.',
      'glm-5.2',
    )).toBe(
      'glm-5.2 端点的月度额度已用尽（预计 10 天后重置）。方案输入已保留；启用余额或更换有额度的端点后可直接重试。',
    );
  });
});
