import {
  budgetAllocationRequestSchema,
  budgetAllocationPlanSchema,
  llmProviderRequestSchema,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import {
  budgetAllocationDraftOutputSchema,
  buildBudgetAllocationRequest,
  materializeBudgetAllocationPlan,
} from './budget-allocation.js';

const project = {
  projectId: 'prj_budget_demo',
  nameZh: '山海星辰',
  nameEn: 'Shanhai Stars',
  synopsis: '一个已在国内验证的奇幻短剧 IP，计划以 AI 全链路制作北美版本。',
  audience: '18–40 岁奇幻短剧观众',
  genres: ['奇幻', '爱情'],
};

const request = budgetAllocationRequestSchema.parse({
  market: 'north_america',
  totalBudgetCny: 1_000_003,
  horizonWeeks: 12,
  distributionModel: 'owned_app',
  monetizationModel: 'hybrid',
  riskTolerance: 'balanced',
  brief: '用一人剧组验证北美市场，先试再放量。',
  generationNonce: 1,
});

const draft = {
  headline: '先用 18% 验证，再让数据决定后续 82%',
  executiveSummary: '国内爆款只证明内容母题有潜力，不证明北美单位经济成立。',
  allocationRecommendations: [
    ['market_validation', '市场验证', 300],
    ['product_measurement', '产品与归因', 800],
    ['script_localization', '剧本本土化', 600],
    ['ai_production', 'AI 制作', 1600],
    ['post_qc', '后期与 QC', 500],
    ['creative_factory', '广告创意工厂', 1000],
    ['paid_acquisition', '效果投放', 4000],
    ['creator_community', '达人与社群', 400],
    ['legal_compliance', '法务与合规', 300],
    ['contingency', '机动储备', 500],
  ].map(([category, label, weightBps]) => ({
    category,
    label,
    weightBps,
    rationale: `${label}用于形成可验证的上市信号。`,
    releaseGate: '上一阶段达到样本门槛后释放。',
  })),
  phaseRecommendations: [
    { phase: 'validate', label: '验证', weeks: '第 1–3 周', weightBps: 1800 },
    { phase: 'prove', label: '证明单位经济', weeks: '第 4–7 周', weightBps: 2700 },
    { phase: 'scale', label: '受控放量', weeks: '第 8–12 周', weightBps: 4000 },
    { phase: 'reserve', label: '未释放储备', weeks: '全周期', weightBps: 1500 },
  ].map((item) => ({
    ...item,
    objective: `${item.label}阶段目标。`,
    exitCriteria: ['达到预先登记的样本和单位经济门槛。'],
  })),
  channelRecommendations: [
    ['meta', 'Meta', 3800],
    ['tiktok', 'TikTok', 3200],
    ['google_app', 'Google App Campaigns', 2000],
    ['apple_ads', 'Apple Ads', 1000],
  ].map(([channel, label, weightBps]) => ({
    channel,
    label,
    weightBps,
    role: `${label}承担差异化获客实验。`,
    testDesign: '保持单变量并预先登记样本量。',
    scaleRule: '连续 cohort 达标后小步增加预算。',
    stopRule: '样本达标仍低于停损线则暂停。',
  })),
  kpiGates: [
    { metric: '创意胜率', definition: '胜出创意占比', target: '高于当前中位数', minimumSample: '每条至少 10,000 展示', actionIfMissed: '回到 Hook 迭代' },
    { metric: 'CPI/LTV', definition: '获客成本相对净 LTV', target: '满足目标回收期', minimumSample: '至少三个安装 cohort', actionIfMissed: '停止放量' },
    { metric: 'D7 留存', definition: '安装后第七日活跃', target: '不低于基线', minimumSample: '每渠道足量 cohort', actionIfMissed: '修复内容与付费墙' },
  ],
  onePersonCadence: [
    { cadence: '每日', automation: '生成数据快照', humanDecision: '处理异常', deliverable: '日报' },
    { cadence: '每周两次', automation: '批量变体', humanDecision: '选择 Hook', deliverable: '创意包' },
    { cadence: '每周', automation: '汇总 cohort', humanDecision: '放量或停损', deliverable: '周决策' },
  ],
  assumptions: [
    { claim: '国内热度可迁移', basis: '仅作为待验证假设', confidence: 'low', invalidatedBy: '北美受众测试不达标' },
    { claim: '独立 App 可归因', basis: '需要先完成事件埋点', confidence: 'medium', invalidatedBy: '归因链路不完整' },
    { claim: 'AI 可降低制作迭代成本', basis: 'OneCrew 自动化链路', confidence: 'medium', invalidatedBy: '人工返工超过预算' },
  ],
  risks: [
    { risk: '创意疲劳', earlySignal: '频控上升且 CTR 下滑', mitigation: '每周补充 Hook 变体' },
    { risk: '归因失真', earlySignal: '平台与后端事件偏差', mitigation: '先修复埋点再放量' },
    { risk: '合规返工', earlySignal: '广告或商店审核拒绝', mitigation: '预留法务与素材替换' },
  ],
} as const;

describe('budget allocation creative request', () => {
  it('builds a GLM-compatible structured LLM request with evidence guardrails', () => {
    const providerRequest = buildBudgetAllocationRequest({ project, request });
    expect(() => llmProviderRequestSchema.parse(providerRequest)).not.toThrow();
    expect(providerRequest.operation).toBe('budget_allocation');
    expect(providerRequest.outputSchema).toMatchObject({ title: 'OneCrewBudgetAllocationDraft' });
    expect(providerRequest.prompt).toContain('国内爆款 IP 不等于北美已验证 IP');
    expect(providerRequest.prompt).toContain('不得编造固定 CPI');
    expect(providerRequest.prompt).toContain('Sensor Tower');
    expect(providerRequest.prompt).toContain('首期只能释放 validate');
  });

  it('exposes a JSON schema for the draft response', () => {
    expect(budgetAllocationDraftOutputSchema()).toMatchObject({
      title: 'OneCrewBudgetAllocationDraft',
      type: 'object',
    });
  });

  it('normalizes model weights into exact, reconciling CNY amounts', () => {
    const plan = materializeBudgetAllocationPlan(request, draft);
    expect(() => budgetAllocationPlanSchema.parse(plan)).not.toThrow();
    expect(plan.allocations.reduce((sum, item) => sum + item.amountCny, 0)).toBe(request.totalBudgetCny);
    expect(plan.phases.reduce((sum, item) => sum + item.amountCny, 0)).toBe(request.totalBudgetCny);
    expect(plan.channels.reduce((sum, item) => sum + item.amountCny, 0)).toBe(plan.paidMediaBudgetCny);
    expect(plan.initialReleaseCny).toBe(plan.phases.find((item) => item.phase === 'validate')?.amountCny);
    expect(plan.allocations.find((item) => item.category === 'paid_acquisition')?.amountCny).toBe(
      plan.paidMediaBudgetCny,
    );
  });
});
