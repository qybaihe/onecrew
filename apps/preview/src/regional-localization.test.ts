import { describe, expect, it } from 'vitest';

import { buildDirectStoryBrief, formatProviderFailure } from './RegionalLocalizationPage.js';

describe('buildDirectStoryBrief', () => {
  it('injects the selected market directly into the story brief', () => {
    const brief = buildDirectStoryBrief('uk', '保留星轨设定，强化阶层冲突。');

    expect(brief).toContain('目标市场：英国（EN-GB，region=uk）');
    expect(brief).toContain('人物动机、冲突、对白语感、场景和集尾钩子');
    expect(brief).toContain('保留星轨设定，强化阶层冲突。');
  });

  it('stays inside the story-plan request limit', () => {
    const brief = buildDirectStoryBrief('america', 'A'.repeat(20_000));

    expect(brief).toHaveLength(20_000);
  });
});

describe('formatProviderFailure', () => {
  it('turns the endpoint quota payload into an actionable message', () => {
    const message = formatProviderFailure(
      'GoUsageLimitError: Monthly usage limit reached. Resets in 10 days.',
      'glm-5.2',
    );

    expect(message).toBe('glm-5.2 端点的月度用量已达上限（预计 10 天后重置）。请启用可用余额或更换有额度的端点，然后点击“重试脚本”。');
  });
});
