import {
  budgetAllocationCategorySchema,
  budgetAllocationChannelSchema,
  budgetAllocationPhaseSchema,
  budgetAllocationPlanSchema,
  budgetAllocationRequestSchema,
  type BudgetAllocationPlan,
  type BudgetAllocationRequest,
  type LlmProviderRequest,
  type ProjectSpec,
} from '@onecrew/contracts';
import { z } from 'zod';

export const BUDGET_EVIDENCE_AS_OF = '2026-07-19';
export const BUDGET_CONTEXT_MARKER = 'ONECREW_BUDGET_CONTEXT_JSON=';

export interface BuildBudgetAllocationRequestInput {
  project: Pick<ProjectSpec, 'projectId' | 'nameZh' | 'nameEn' | 'synopsis' | 'audience' | 'genres'>;
  request: BudgetAllocationRequest;
}

const weightedAllocationSchema = z.object({
  category: budgetAllocationCategorySchema,
  label: z.string().min(1).max(200),
  weightBps: z.number().int().min(0).max(10_000),
  rationale: z.string().min(1).max(2_000),
  releaseGate: z.string().min(1).max(1_000),
});

const weightedPhaseSchema = z.object({
  phase: budgetAllocationPhaseSchema,
  label: z.string().min(1).max(200),
  weeks: z.string().min(1).max(100),
  weightBps: z.number().int().min(0).max(10_000),
  objective: z.string().min(1).max(2_000),
  exitCriteria: z.array(z.string().min(1).max(1_000)).min(1).max(8),
});

const weightedChannelSchema = z.object({
  channel: budgetAllocationChannelSchema,
  label: z.string().min(1).max(200),
  weightBps: z.number().int().min(0).max(10_000),
  role: z.string().min(1).max(1_000),
  testDesign: z.string().min(1).max(2_000),
  scaleRule: z.string().min(1).max(1_000),
  stopRule: z.string().min(1).max(1_000),
});

export const budgetAllocationDraftSchema = z.object({
  headline: z.string().min(1).max(500),
  executiveSummary: z.string().min(1).max(4_000),
  allocationRecommendations: z.array(weightedAllocationSchema).min(6).max(12),
  phaseRecommendations: z.array(weightedPhaseSchema).min(3).max(6),
  channelRecommendations: z.array(weightedChannelSchema).min(2).max(8),
  kpiGates: budgetAllocationPlanSchema.shape.kpiGates,
  onePersonCadence: budgetAllocationPlanSchema.shape.onePersonCadence,
  assumptions: budgetAllocationPlanSchema.shape.assumptions,
  risks: budgetAllocationPlanSchema.shape.risks,
});

export type BudgetAllocationDraft = z.infer<typeof budgetAllocationDraftSchema>;

const MARKET_LABELS: Record<BudgetAllocationRequest['market'], string> = {
  north_america: '北美（美国为主、加拿大验证）',
  united_states: '美国',
  canada: '加拿大',
};

const SOURCE_NOTES: BudgetAllocationPlan['sources'] = [
  {
    title: 'Sensor Tower — State of Short Drama Apps 2025',
    url: 'https://sensortower.com/blog/state-of-short-drama-apps-2025',
    evidenceType: 'market_intelligence',
    confidence: 'medium',
    usedFor: '判断美国短剧应用市场的收入权重、竞争强度及数据口径边界。',
  },
  {
    title: 'Meta for Business — Ad budgets, costs and schedules',
    url: 'https://www.facebook.com/business/ads/pricing',
    evidenceType: 'official_platform',
    confidence: 'high',
    usedFor: '设置至少七天学习窗口、预算控制与多版位投放原则。',
  },
  {
    title: 'TikTok for Business — Test, learn and scale performance campaigns',
    url: 'https://ads.tiktok.com/business/en-US/blog/test-learn-performance-marketing',
    evidenceType: 'official_platform',
    confidence: 'high',
    usedFor: '设置测试时长、转化样本预算与逐步放量规则。',
  },
  {
    title: 'Google Ads Help — Set up App campaigns for your goal',
    url: 'https://support.google.com/google-ads/answer/6167156?hl=en',
    evidenceType: 'official_platform',
    confidence: 'high',
    usedFor: '设置 App Campaign 的日预算与 7–14 天学习期。',
  },
  {
    title: 'Apple Ads — Campaign structure best practices',
    url: 'https://ads.apple.com/app-store/best-practices/campaign-structure',
    evidenceType: 'official_platform',
    confidence: 'high',
    usedFor: '设计品牌、品类、竞品与发现四类搜索广告测试结构。',
  },
];

export function budgetAllocationDraftOutputSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(budgetAllocationDraftSchema, { target: 'draft-2020-12' }),
    title: 'OneCrewBudgetAllocationDraft',
  };
}

function knownMetricsText(metrics: BudgetAllocationRequest['knownMetrics']): string {
  if (!metrics || Object.keys(metrics).length === 0) return '无历史指标。不得假装已有 CPI、留存、LTV 或 ROAS。';
  return JSON.stringify(metrics);
}

export function buildBudgetAllocationRequest(input: BuildBudgetAllocationRequestInput): LlmProviderRequest {
  const { project, request } = input;
  const prompt = [
    '你是 OneCrew 的出海短剧预算决策 Agent。任务不是承诺“必爆”，而是在有限预算下最大化获得可验证信号和可扩张单位经济模型的概率。',
    '请严格输出给定 JSON Schema，不要输出 Markdown，不要添加 schema 外字段。全部解释使用简体中文。',
    '这是一个独立的预算 Job artifact：你负责提出权重、阶段门槛、投放实验和一人执行节奏；后端会把权重归一化并精确计算人民币金额。',
    [
      '硬约束：',
      '1. allocationRecommendations 必须覆盖十个互不重复的 category；其中 paid_acquisition 必须存在。',
      '2. phaseRecommendations 至少覆盖 validate、prove、scale、reserve；首期只能释放 validate 的钱。',
      '3. 三组 weightBps 各自应合计 10000；即使有算术误差，后端也会归一化。',
      '4. 国内爆款 IP 不等于北美已验证 IP。没有北美 cohort 数据时，必须把传播假设标成待验证。',
      '5. 不得编造固定 CPI、留存、付费率、LTV 或 ROAS。目标应优先写成相对基线、公式或阶段门槛。',
      '6. paid acquisition 不得一次性释放；必须写清最低样本、停损、放量条件和预算调整幅度。',
      '7. “一人剧组”代表 OneCrew 自动化执行重复劳动，人仍负责选题、合规、最终创意与放量决策。',
      '8. 所有平台结论只能使用下方证据；平台份额属于规划假设，不得伪装成行业事实。',
    ].join('\n'),
    [
      `证据版本：${BUDGET_EVIDENCE_AS_OF}`,
      'E1（中置信，Sensor Tower 2025）：2025 Q1 美国短剧 App IAP 收入约 3.5 亿美元，占全球约 49%；该口径不含广告变现、第三方安卓商店和站外支付。用于判断市场吸引力与竞争强度，不用于推算本项目收入。',
      'E2（高置信，Meta 官方）：预算应支持至少 7 天学习；可使用 Advantage+ campaign budget；手动版位建议至少 6 个；App campaign 强调创意多样化。',
      'E3（高置信，TikTok 官方）：拆分测试建议至少 14 天且预算至少为历史 CPA 的 20 倍；App Install CBO 建议 ad group 预算覆盖约 50 倍目标 CPA、3–5 个活跃 ad group、每组 2–3 条创意，达到约 50 次转化后再调整，单次预算调整尽量控制在 30% 内。',
      'E4（高置信，Google 官方）：App Campaign 安装量优化的日预算建议至少为目标 CPI 的 50 倍，重大修改后应留出 7–14 天学习期。',
      'E5（高置信，Apple 官方）：搜索结果广告可按 Brand、Category、Competitor、Discovery 四类 campaign 组织；实际预算由账户拍卖数据验证。',
    ].join('\n'),
    [
      `项目：${project.nameZh} / ${project.nameEn}`,
      `项目简介：${project.synopsis}`,
      `原受众：${project.audience}`,
      `类型：${project.genres.join('、')}`,
      `目标市场：${MARKET_LABELS[request.market]}`,
      `总预算：人民币 ${request.totalBudgetCny} 元`,
      `决策周期：${request.horizonWeeks} 周`,
      `发行模式：${request.distributionModel}`,
      `变现模式：${request.monetizationModel}`,
      `风险偏好：${request.riskTolerance}`,
      `已知历史指标：${knownMetricsText(request.knownMetrics)}`,
      `本次目标与约束：${request.brief}`,
    ].join('\n'),
    '输出必须回答：钱怎么分、为什么这样分、第一笔只放多少、什么指标达标才继续、没达标时停什么、一个人每天和每周具体做什么。',
    `${BUDGET_CONTEXT_MARKER}${JSON.stringify(request)}`,
  ].join('\n\n').slice(0, 100_000);

  return {
    capability: 'llm',
    projectId: project.projectId,
    operation: 'budget_allocation',
    prompt,
    locale: 'zh-CN',
    imageUris: [],
    outputSchema: budgetAllocationDraftOutputSchema(),
    maxOutputTokens: 12_000,
    route: request.route,
    generationNonce: request.generationNonce,
  };
}

export function readBudgetAllocationContext(prompt: string): BudgetAllocationRequest {
  const markerIndex = prompt.lastIndexOf(BUDGET_CONTEXT_MARKER);
  if (markerIndex < 0) throw new Error('Budget allocation request context is missing');
  const json = prompt.slice(markerIndex + BUDGET_CONTEXT_MARKER.length).trim();
  return budgetAllocationRequestSchema.parse(JSON.parse(json));
}

interface WeightedItem {
  weightBps: number;
}

function normalizedBasisPoints<T extends WeightedItem>(items: T[]): number[] {
  const weights = items.map((item) => Math.max(0, item.weightBps));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weightTotal > 0
    ? weights.map((weight) => (weight / weightTotal) * 10_000)
    : weights.map(() => 10_000 / items.length);
  const basisPoints = raw.map(Math.floor);
  let remainder = 10_000 - basisPoints.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    const targetIndex = order[index % order.length]!.index;
    basisPoints[targetIndex] = (basisPoints[targetIndex] ?? 0) + 1;
  }
  return basisPoints;
}

function exactAmounts(totalCny: number, basisPoints: number[]): number[] {
  const raw = basisPoints.map((value) => (totalCny * value) / 10_000);
  const amounts = raw.map(Math.floor);
  let remainder = totalCny - amounts.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (let index = 0; remainder > 0; index += 1, remainder -= 1) {
    const targetIndex = order[index % order.length]!.index;
    amounts[targetIndex] = (amounts[targetIndex] ?? 0) + 1;
  }
  return amounts;
}

function assertDistinct(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicate entries`);
}

export function materializeBudgetAllocationPlan(
  request: BudgetAllocationRequest,
  input: unknown,
): BudgetAllocationPlan {
  const draft = budgetAllocationDraftSchema.parse(input);
  assertDistinct(draft.allocationRecommendations.map((item) => item.category), 'allocationRecommendations');
  assertDistinct(draft.phaseRecommendations.map((item) => item.phase), 'phaseRecommendations');
  assertDistinct(draft.channelRecommendations.map((item) => item.channel), 'channelRecommendations');

  const paidMediaIndex = draft.allocationRecommendations.findIndex(
    (item) => item.category === 'paid_acquisition',
  );
  if (paidMediaIndex < 0) throw new Error('allocationRecommendations must include paid_acquisition');

  const allocationBps = normalizedBasisPoints(draft.allocationRecommendations);
  const allocationAmounts = exactAmounts(request.totalBudgetCny, allocationBps);
  const allocations = draft.allocationRecommendations.map((item, index) => ({
    category: item.category,
    label: item.label,
    amountCny: allocationAmounts[index]!,
    percentage: allocationBps[index]! / 100,
    rationale: item.rationale,
    releaseGate: item.releaseGate,
  }));

  const phaseBps = normalizedBasisPoints(draft.phaseRecommendations);
  const phaseAmounts = exactAmounts(request.totalBudgetCny, phaseBps);
  const phases = draft.phaseRecommendations.map((item, index) => ({
    phase: item.phase,
    label: item.label,
    weeks: item.weeks,
    amountCny: phaseAmounts[index]!,
    percentage: phaseBps[index]! / 100,
    objective: item.objective,
    exitCriteria: item.exitCriteria,
  }));

  const paidMediaBudgetCny = allocationAmounts[paidMediaIndex]!;
  const channelBps = normalizedBasisPoints(draft.channelRecommendations);
  const channelAmounts = exactAmounts(paidMediaBudgetCny, channelBps);
  const channels = draft.channelRecommendations.map((item, index) => ({
    channel: item.channel,
    label: item.label,
    amountCny: channelAmounts[index]!,
    shareOfPaidMediaPercent: channelBps[index]! / 100,
    role: item.role,
    testDesign: item.testDesign,
    scaleRule: item.scaleRule,
    stopRule: item.stopRule,
  }));

  const initialReleaseCny = phases.find((item) => item.phase === 'validate')?.amountCny ?? 0;
  return budgetAllocationPlanSchema.parse({
    market: request.market,
    marketLabel: MARKET_LABELS[request.market],
    totalBudgetCny: request.totalBudgetCny,
    horizonWeeks: request.horizonWeeks,
    evidenceAsOf: BUDGET_EVIDENCE_AS_OF,
    headline: draft.headline,
    executiveSummary: draft.executiveSummary,
    initialReleaseCny,
    allocations,
    phases,
    paidMediaBudgetCny,
    channels,
    kpiGates: draft.kpiGates,
    onePersonCadence: draft.onePersonCadence,
    assumptions: draft.assumptions,
    risks: draft.risks,
    sources: SOURCE_NOTES,
  });
}
