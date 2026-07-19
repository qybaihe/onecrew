import {
  generatedAudioSchema,
  generatedImageSchema,
  generatedVideoSchema,
  imageProviderRequestSchema,
  llmProviderOutputSchema,
  llmProviderRequestSchema,
  ttsProviderRequestSchema,
  videoProviderRequestSchema,
  vlmProviderOutputSchema,
  vlmProviderRequestSchema,
  type GeneratedAudio,
  type GeneratedImage,
  type GeneratedVideo,
  type ImageProviderRequest,
  type LlmProviderOutput,
  type LlmProviderRequest,
  type ProviderCapability,
  type ProviderRequest,
  type ProviderRoute,
  type TtsProviderRequest,
  type VideoProviderRequest,
  type VlmProviderOutput,
  type VlmProviderRequest,
} from '@onecrew/contracts';
import { createInputHash } from '@onecrew/domain';
import { z } from 'zod';

import { ProviderError } from './errors.js';
import { ProviderRegistry } from './registry.js';
import type {
  ProviderCallContext,
  ProviderDescriptor,
  ProviderJob,
  ProviderJobState,
  ProviderSubmitResult,
} from './types.js';
import type { ProviderMediaSink } from './elevenlabs.js';

function requestText(input: ProviderRequest): string {
  if ('prompt' in input) return input.prompt;
  if ('text' in input) return input.text;
  return input.expectedDescription;
}

class DeterministicMockProvider<I extends ProviderRequest, O> implements ProviderJob<I, O> {
  readonly descriptor: ProviderDescriptor;
  private readonly transientAttempts = new Map<string, number>();
  private readonly cancelled = new Set<string>();

  constructor(
    capability: ProviderCapability,
    route: ProviderRoute,
    readonly inputSchema: z.ZodType<I>,
    readonly outputSchema: z.ZodType<O>,
    private readonly createOutput: (input: I, hash: string) => O | Promise<O>,
    private readonly estimateCost: (input: I) => number,
  ) {
    this.descriptor = {
      name: `mock-${capability}-${route}`,
      model: `deterministic-${capability}-v1`,
      capability,
      route,
      mode: 'mock',
      verification: 'mock_verified',
      timeoutMs: 2_000,
      maxAttempts: 3,
      rateLimitPerSecond: 100,
    };
  }

  async submit(input: I, context: ProviderCallContext): Promise<ProviderSubmitResult<O>> {
    const hash = createInputHash(input);
    const text = requestText(input);
    if (text.includes('[MOCK_FAIL_PERMANENT]')) {
      throw new ProviderError('MOCK_PERMANENT', 'Injected permanent Mock failure', false);
    }
    if (text.includes('[MOCK_FAIL_TRANSIENT]')) {
      const count = (this.transientAttempts.get(context.idempotencyKey) ?? 0) + 1;
      this.transientAttempts.set(context.idempotencyKey, count);
      if (count < 3) throw new ProviderError('MOCK_TRANSIENT', 'Injected transient Mock failure', true);
    }
    const externalJobId = `mock_${this.descriptor.capability}_${hash.slice(0, 20)}`;
    return {
      externalJobId,
      immediateState: {
        status: 'succeeded',
        progress: 1,
        output: await this.createOutput(input, hash),
        actualCostCny: this.estimateCost(input),
      },
    };
  }

  async query(externalJobId: string): Promise<ProviderJobState<O>> {
    if (this.cancelled.has(externalJobId)) return { status: 'cancelled' };
    throw new ProviderError('MOCK_UNKNOWN_JOB', `Unknown Mock job ${externalJobId}`, false, 404);
  }

  async cancel(externalJobId: string): Promise<void> {
    this.cancelled.add(externalJobId);
  }

  async estimate(input: I): Promise<{ amountCny: number }> {
    return { amountCny: this.estimateCost(input) };
  }
}

function mockUri(capability: ProviderCapability, hash: string, extension: string): string {
  return `mock://onecrew/${capability}/${hash.slice(0, 24)}.${extension}`;
}

function createProvider<I extends ProviderRequest, O>(
  capability: ProviderCapability,
  route: ProviderRoute,
  inputSchema: z.ZodType<I>,
  outputSchema: z.ZodType<O>,
  createOutput: (input: I, hash: string) => O | Promise<O>,
  estimateCost: (input: I) => number,
): ProviderJob<I, O> {
  return new DeterministicMockProvider(
    capability,
    route,
    inputSchema,
    outputSchema,
    createOutput,
    estimateCost,
  );
}

function mockStructuredOutput(input: LlmProviderRequest): Record<string, unknown> {
  const marker = 'ONECREW_MOCK_OUTPUT_JSON=';
  const markerIndex = input.prompt.lastIndexOf(marker);
  if (markerIndex >= 0) {
    const json = input.prompt.slice(markerIndex + marker.length).trim();
    const parsed = JSON.parse(json) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  if (input.outputSchema?.title === 'OneCrewRegionalCulturePack') {
    const regionMatch = input.prompt.match(/目标地区：([^（\n]+)/)?.[1]?.trim() ?? 'america';
    const region = (['america', 'russia', 'uk'].find((r) => regionMatch.toLowerCase().includes(r)) ?? 'america') as
      | 'america'
      | 'russia'
      | 'uk';
    const label = { america: '美国', russia: '俄罗斯', uk: '英国' }[region];
    const themesByRegion: Record<'america' | 'russia' | 'uk', string[]> = {
      america: ['龙族奇幻浪漫', 'fated mate 命定伴侣', '契约婚姻', 'billionaire 强势男主', '复仇逆袭'],
      russia: ['二战史诗', '寡头权力斗争', '东正教宿命', '冰雪王国', '硬汉复仇'],
      uk: ['摄政时期浪漫', '贵族秘辛', '阶级跨越', '侦探悬疑', '职场智斗'],
    };
    const spiritByRegion: Record<'america' | 'russia' | 'uk', string[]> = {
      america: ['命运翻转', '被低估的女主逆袭', '禁忌之恋', '女性自我主张'],
      russia: ['忍受与救赎', '家庭与祖国高于个人', '男性的沉默担当', '命运不可逃避'],
      uk: ['克制的激情', '尊严与体面', '智慧胜于蛮力', '命运与阶级博弈'],
    };
    const motifsByRegion: Record<'america' | 'russia' | 'uk', string[]> = {
      america: ['月光', '龙穴与中世纪城堡', '现代豪宅', '满月', '誓约戒指'],
      russia: ['雪原', '洋葱顶教堂', '苏联时代建筑', '军大衣', '东正教圣像'],
      uk: ['乔治王朝庄园', '雨夜伦敦街道', '茶会与舞会', '手写书信', '定制西装'],
    };
    const taboosByRegion: Record<'america' | 'russia' | 'uk', string[]> = {
      america: ['避免中式婆媳关系', '避免修仙渡劫设定', '避免东亚家族伦理戏'],
      russia: ['避免 LGBTQ+ 主线', '避免对东正教不敬的符号'],
      uk: ['避免过度裸露与直白情欲', '避免不尊重王室与历史的桥段'],
    };
    const referenceByRegion: Record<'america' | 'russia' | 'uk', { title: string; whyItWorks: string }[]> = {
      america: [{
        title: 'Claimed by the Dragon',
        whyItWorks: '龙族诅咒 + 命定伴侣 + 美国中年女性受众 + 每集 cliffhanger 结尾，证明西方奇幻浪漫题材在美国市场的爆发力。',
      }],
      russia: [{
        title: '本地历史剧爆款（虚构示例）',
        whyItWorks: '强情节 + 家庭荣誉 + 男性英雄主义，契合俄罗斯受众对"牺牲-救赎"弧线的偏好。',
      }],
      uk: [{
        title: 'Bridgerton',
        whyItWorks: '摄政时期浪漫 + 阶级张力 + 克制的激情，验证英式时代剧的全球吸引力。',
      }],
    };
    return {
      region,
      regionLabel: label,
      audienceProfile:
        region === 'america'
          ? 'ReelShort / DramaBox 中年女性与千禧一代女性，偏好 1-3 分钟竖屏 cliffhanger 短剧'
          : region === 'russia'
            ? '偏好强情节与家庭荣誉叙事的本土短剧受众'
            : '偏好克制张力与时代剧美学的英剧受众',
      themes: themesByRegion[region],
      spiritValues: spiritByRegion[region],
      taboos: taboosByRegion[region],
      hookStructures: ['开场 5 秒高冲突画面（献祭/追逐/变身）', '每 60 秒一个反转', '每集结尾命运级 cliffhanger'],
      visualMotifs: motifsByRegion[region],
      referenceCases: referenceByRegion[region],
      localizedBrief: `面向${label}市场的本土化短剧：守星人穿越命运之门，与被封印的龙王结成命定伴侣，在每集 60 秒一个反转的节奏中解开诅咒。`,
    };
  }
  if (input.outputSchema?.title === 'OneCrewBudgetAllocationDraft') {
    return {
      headline: '先释放 18% 验证北美信号，再让 cohort 数据决定后续 82%',
      executiveSummary:
        '100 万人民币不应平均撒向制作与流量。先完成可归因的最小内容包和 12–20 条 Hook 变体，以美国为主市场验证创意与单位经济；只有达到预先登记的留存、付费和回收门槛，才进入证明与受控放量。国内爆款是题材先验，不是北美市场证明。',
      allocationRecommendations: [
        { category: 'market_validation', label: '受众与市场验证', weightBps: 300, rationale: '用小样本确认题材、角色关系和付费钩子是否能被北美受众理解。', releaseGate: '项目启动即释放，完成访谈、概念测试和竞品拆解后关闭。' },
        { category: 'product_measurement', label: '产品与归因数据', weightBps: 800, rationale: '完成落地页、付费墙、事件埋点、SKAN/MMP 或等效服务端 cohort 看板。', releaseGate: '关键事件能在平台与后端对账后，才允许效果投放。' },
        { category: 'script_localization', label: '剧本本土化', weightBps: 600, rationale: '把人物动机、对白、节奏和付费卡点从源头改写为北美版本。', releaseGate: '文化审读与英语母语审校通过后进入制作。' },
        { category: 'ai_production', label: 'AI 正片制作', weightBps: 1600, rationale: '由 OneCrew 承担分镜、资产、视频、配音和版本自动化，人只处理高价值创意选择。', releaseGate: '先制作最小可售内容包；验证通过后才补齐后续集。' },
        { category: 'post_qc', label: '后期与质量控制', weightBps: 500, rationale: '覆盖声音、字幕、连续性、设备兼容和必要返工。', releaseGate: '技术 QC 和英语语义 QC 均通过后发布。' },
        { category: 'creative_factory', label: '广告创意工厂', weightBps: 1000, rationale: '从正片批量切出不同开场、冲突、人物和 CTA 的竖屏素材。', releaseGate: '每轮只扩写已胜出的单一变量，不为低样本素材过早加码。' },
        { category: 'paid_acquisition', label: '效果投放', weightBps: 4000, rationale: '用 Meta、TikTok、Google 与 Apple Ads 获得可归因用户并验证单位经济。', releaseGate: '按 validate → prove → scale 分批拨款，任何一层未过门槛即冻结余款。' },
        { category: 'creator_community', label: '达人、ASO 与社群', weightBps: 400, rationale: '补充可信的原生表达、商店页素材和低成本复访触点。', releaseGate: '只签短周期、小额、可追踪的交付与授权。' },
        { category: 'legal_compliance', label: '法务与合规', weightBps: 300, rationale: '处理 IP 链路、音乐与肖像授权、隐私、商店和广告审核。', releaseGate: '上线前完成权利清单与高风险素材复核。' },
        { category: 'contingency', label: '返工与汇率储备', weightBps: 500, rationale: '吸收模型返工、审核替换、平台结算与不可预见成本。', releaseGate: '仅由阶段复盘明确批准，不自动并入流量预算。' },
      ],
      phaseRecommendations: [
        { phase: 'validate', label: '验证题材与链路', weeks: '第 1–3 周', weightBps: 1800, objective: '交付最小可售内容包、埋点闭环和首轮创意测试，判断北美信号是否存在。', exitCriteria: ['事件归因可对账', '至少一组 Hook 在足量曝光后稳定领先内部中位数', '首批 cohort 未触发预设停损线'] },
        { phase: 'prove', label: '证明单位经济', weeks: '第 4–7 周', weightBps: 2700, objective: '用多个 cohort 验证 CPI、留存、付费和净 LTV 的关系，而非追求下载量。', exitCriteria: ['至少三个独立 cohort 方向一致', '获客成本满足目标回收期公式', '创意补给速度覆盖疲劳速度'] },
        { phase: 'scale', label: '受控放量', weeks: '第 8–12 周', weightBps: 4000, objective: '只扩大已证明的渠道、受众和 Hook 组合，并持续保留对照组。', exitCriteria: ['每次加预算后关键指标未跌破停损线', '跨渠道归因与现金回收仍可解释', '产能与客服没有形成新瓶颈'] },
        { phase: 'reserve', label: '未释放储备', weeks: '全周期', weightBps: 1500, objective: '在结果不确定时保留选择权，处理返工、合规或给胜出组合补量。', exitCriteria: ['仅在书面阶段复盘通过后释放', '若单位经济不成立则保持未花费状态'] },
      ],
      channelRecommendations: [
        { channel: 'meta', label: 'Meta', weightBps: 3800, role: '测试更广泛年龄层、人物关系与付费转化，承接规模化候选。', testDesign: '保持落地页和出价一致，按 Hook/人物冲突拆分创意；学习期内避免频繁修改。', scaleRule: '连续 cohort 达标后，以不破坏学习的幅度逐次增加预算。', stopRule: '足量样本后 CPI/LTV 关系仍越过停损线，暂停对应创意或 ad set。' },
        { channel: 'tiktok', label: 'TikTok', weightBps: 3200, role: '高频验证前三秒 Hook、原生感和年轻受众的内容反应。', testDesign: '每组保留 2–3 条单变量创意，并为拆分测试保留完整观察期。', scaleRule: '达到转化样本门槛后单次预算调整控制在约 30% 内。', stopRule: '创意达到样本门槛仍低于内部中位数，停止而非靠加预算挽救。' },
        { channel: 'google_app', label: 'Google App Campaigns', weightBps: 2000, role: '覆盖 Search、YouTube、Discover 与应用生态，验证较强意图用户。', testDesign: '按安装与高价值事件分开目标，并准备文本、图片和视频资产组合。', scaleRule: '保留 7–14 天学习期，预算满足目标 CPI/CPA 所需样本后再判断。', stopRule: '学习期结束且高价值事件成本持续不达标则降级或暂停。' },
        { channel: 'apple_ads', label: 'Apple Ads', weightBps: 1000, role: '捕获 App Store 内品牌、品类、竞品和发现型搜索意图。', testDesign: '拆分 Brand、Category、Competitor、Discovery 四类 campaign，单独看词与安装质量。', scaleRule: '只扩展同时满足量级和下游付费质量的关键词主题。', stopRule: '搜索词无相关性或安装后价值不足时否词并停投。' },
      ],
      kpiGates: [
        { metric: '创意 Hook 胜率', definition: '同一渠道、同一目标下，达到最低曝光后的创意相对内部中位数表现。', target: '至少出现可重复领先的 Hook；不使用跨账户固定 CTR 猜测。', minimumSample: '每条创意达到预先登记的曝光/点击量，且至少完成两轮独立复测。', actionIfMissed: '停止放量，回到角色关系、前三秒冲突和 CTA 的单变量迭代。' },
        { metric: '归因完整率', definition: '平台点击/安装/关键事件与后端订单、退款的可对账程度。', target: '关键漏斗事件可以按渠道和 cohort 解释。', minimumSample: '端到端测试订单 + 首批真实安装 cohort。', actionIfMissed: '冻结效果预算，先修复埋点、SKAN/MMP 或服务端事件。' },
        { metric: 'CPI 对净 LTV', definition: '获客成本相对保守净 LTV 与目标回收周期的关系。', target: 'CPI 不高于经退款、平台分成和税费调整后的可承受获客成本。', minimumSample: '至少三个独立 cohort，并覆盖一个完整早期付费窗口。', actionIfMissed: '缩减渠道，测试付费墙与内容卡点；两轮无改善则停止该市场放量。' },
        { metric: '留存与付费质量', definition: 'D1/D7 内容消费、解锁和退款，而非仅安装量。', target: '新 cohort 不低于项目自有基线，且随创意放量不显著恶化。', minimumSample: '每个主渠道获得足够用户形成稳定 cohort。', actionIfMissed: '定位是广告承诺错配、首集节奏还是付费墙问题，并只改一个变量。' },
        { metric: '创意疲劳速度', definition: '频次上升时 CTR、CPI 和高价值事件成本的变化。', target: '每周胜出创意补给量高于淘汰量。', minimumSample: '至少两周连续素材与频次数据。', actionIfMissed: '不继续扩量，把预算移回创意工厂并复用胜出母题生成新变体。' },
      ],
      onePersonCadence: [
        { cadence: '每日 20 分钟', automation: 'OneCrew 汇总花费、漏斗、cohort、异常任务和创意疲劳信号。', humanDecision: '只处理异常、暂停明显越线项，不根据单日波动改战略。', deliverable: '一页异常日报与动作清单' },
        { cadence: '每周二、周五', automation: '按胜出母题批量生成 Hook、字幕、配音、封面和 CTA 变体并完成技术 QC。', humanDecision: '选择单变量假设、淘汰重复或文化不适配素材。', deliverable: '12–20 条可投放竖屏创意包' },
        { cadence: '每周一', automation: '按渠道、创意和 cohort 生成预算消耗与单位经济复盘。', humanDecision: '决定继续、修复、停损或小步放量，并签署下一周释放额度。', deliverable: '周预算拨款单' },
        { cadence: '阶段末', automation: '整理证据、假设变化、未花预算和下一阶段情景。', humanDecision: '对 validate/prove/scale 闸门做最终批准。', deliverable: '阶段 Go / Fix / Stop 决策' },
      ],
      assumptions: [
        { claim: '源 IP 的情绪母题能够迁移到北美。', basis: '源市场爆款仅提供题材先验，仍需用北美概念测试和真实 cohort 验证。', confidence: 'low', invalidatedBy: '两轮足量 Hook 测试仍无可重复胜出创意，或受众无法理解核心关系。' },
        { claim: 'OneCrew 能把版本迭代压缩到一人可运营。', basis: '脚本、资产、生成、QC 和数据汇总可以自动化，但最终创意与放量仍由人负责。', confidence: 'medium', invalidatedBy: '人工返工时长持续超过自动化节省，或每周创意补给无法覆盖疲劳。' },
        { claim: '独立 App 模式能获得可用的付费与留存数据。', basis: '前提是事件埋点、订单、退款、平台归因和 cohort 看板在投放前完成。', confidence: 'medium', invalidatedBy: '平台与后端关键事件长期无法对账。' },
        { claim: '40% 效果投放是合适的初始规划权重。', basis: '这是基于 100 万规模和验证优先原则的规划假设，不是行业固定比例。', confidence: 'low', invalidatedBy: '首期单位经济明显优于或劣于预期，或发行模式不需要自有获客。' },
      ],
      risks: [
        { risk: '把国内爆款误判为北美产品市场匹配。', earlySignal: '广告有点击但首集消费、留存或付费显著断层。', mitigation: '先验证人物动机和付费卡点，再补拍完整长季。' },
        { risk: '算法学习期内频繁改预算导致数据不可解释。', earlySignal: '每次修改后波动加剧，始终无法形成稳定 cohort。', mitigation: '预登记观察窗与样本量，除停损外不做日内追涨杀跌。' },
        { risk: '创意获客承诺与正片体验不一致。', earlySignal: 'CTR 尚可但安装后立即流失、退款或差评上升。', mitigation: '按 Hook 来源标记 cohort，删除误导素材并修复首集兑现速度。' },
        { risk: '版权、肖像、音乐或 AI 标识要求造成下架返工。', earlySignal: '广告拒审、商店问询或权利文件缺失。', mitigation: '上线前维护权利清单，保留可替换音画资产和合规预算。' },
      ],
    };
  }
  if (input.outputSchema?.title === 'OneCrewCreativeStoryPlan') {
    const episodeCount = Math.min(12, Math.max(1, Number(input.prompt.match(/必须输出\s+(\d+)\s+集/)?.[1] ?? 1)));
    return {
      title: '星门回响（Mock 规划）',
      logline: '新导航员带着星图碎片抵达星门，迫使守门人作出选择。',
      episodes: Array.from({ length: episodeCount }, (_, index) => ({
        title: `续章 ${index + 1}：星图回响`,
        synopsis: `云岚在第 ${index + 1} 次星门脉冲中找到新的坐标线索。`,
        scriptContent: `【星门回廊】\n云岚握紧星图碎片：第 ${index + 1} 组坐标出现了。\n星门发出青蓝脉冲，新的航线在空中展开。`,
        durationSec: 60,
        characterNames: ['云岚'],
        sceneNames: ['星门回廊'],
        propNames: ['星图碎片'],
      })),
      characters: [{
        name: '云岚',
        role: '星图导航员',
        personality: '敏锐、克制、在危险中保持好奇',
        appearance: '深色短发，青绿色导航披肩，左耳佩戴星轨终端',
        voiceStyle: '清晰、冷静、略带紧迫感',
        identityAnchors: ['深色短发', '青绿色导航披肩', '左耳星轨终端'],
      }],
      scenes: [{
        name: '星门回廊',
        description: '环绕星门核心的悬浮金属回廊，墙面流动着古老坐标。',
        location: '星门内部',
        timeOfDay: '永夜',
        atmosphere: '寂静、神秘、逐步升温',
        lightingStyle: '青蓝脉冲光与暖色人物轮廓光',
      }],
      props: [{
        name: '星图碎片',
        description: '能够响应星门脉冲的半透明坐标载体。',
        category: '关键线索',
        prompt: '半透明晶体星图碎片，内部有细密金色航线流动',
      }],
    };
  }
  return {
    mock: true,
    operation: input.operation,
    locale: input.locale,
    hash: createInputHash(input),
  };
}

function createMockWav(durationMs: number, frequency: number): Uint8Array {
  const sampleRate = 24_000;
  const samples = Math.max(1, Math.round((durationMs / 1_000) * sampleRate));
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 240, (samples - index) / 240);
    const value = Math.sin((2 * Math.PI * frequency * index) / sampleRate) * 1_600 * fade;
    buffer.writeInt16LE(Math.round(value), 44 + index * 2);
  }
  return new Uint8Array(buffer);
}

export function createMockRegistry(mediaSink?: ProviderMediaSink): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const route of ['primary', 'fallback'] as const) {
    registry.register(
      createProvider<LlmProviderRequest, LlmProviderOutput>(
        'llm',
        route,
        llmProviderRequestSchema,
        llmProviderOutputSchema,
        (input, hash) => {
          const structured = input.outputSchema ? mockStructuredOutput(input) : undefined;
          return {
            text: structured ? JSON.stringify(structured) : `[MOCK:${route}] ${input.operation} ${hash.slice(0, 12)}`,
            ...(structured ? { structured } : {}),
          };
        },
        (input) => Number((input.prompt.length * 0.00001).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<ImageProviderRequest, GeneratedImage[]>(
        'image',
        route,
        imageProviderRequestSchema,
        z.array(generatedImageSchema).min(1),
        (input, hash) =>
          Array.from({ length: input.count }, (_, index) => ({
            uri: mockUri('image', createInputHash({ hash, index }), 'png'),
            mimeType: 'image/png',
            width: input.width,
            height: input.height,
            seed: input.seed ?? Number.parseInt(hash.slice(index, index + 8), 16),
          })),
        (input) => Number((input.count * input.width * input.height * 0.00000001).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<VideoProviderRequest, GeneratedVideo[]>(
        'video',
        route,
        videoProviderRequestSchema,
        z.array(generatedVideoSchema).min(1),
        (input, hash) => [
          {
            uri: mockUri('video', hash, 'mp4'),
            mimeType: 'video/mp4',
            durationSec: input.durationSec,
          },
        ],
        (input) => Number((input.durationSec * 0.01).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<TtsProviderRequest, GeneratedAudio>(
        'tts',
        route,
        ttsProviderRequestSchema,
        generatedAudioSchema,
        async (input, hash) => {
          const durationMs = Math.min(15_000, Math.max(500, input.text.length * 120));
          if (!mediaSink) {
            return {
              uri: mockUri('tts', hash, input.outputFormat.startsWith('mp3') ? 'mp3' : 'wav'),
              mimeType: input.outputFormat.startsWith('mp3') ? 'audio/mpeg' as const : 'audio/wav' as const,
              durationMs,
              characterCost: input.text.length,
            };
          }
          const stored = await mediaSink.put({
            key: `providers/mock/tts/${input.projectId}/${input.lineId}/${hash}.wav`,
            bytes: createMockWav(durationMs, 180 + Number.parseInt(hash.slice(0, 2), 16)),
            contentType: 'audio/wav',
          });
          return {
            uri: stored.uri,
            mimeType: 'audio/wav' as const,
            durationMs,
            characterCost: input.text.length,
          };
        },
        (input) => Number((input.text.length * 0.00002).toFixed(4)),
      ),
    );
    registry.register(
      createProvider<VlmProviderRequest, VlmProviderOutput>(
        'vlm',
        route,
        vlmProviderRequestSchema,
        vlmProviderOutputSchema,
        () => ({
          scores: {
            character: 0.92,
            clothing: 0.92,
            background: 0.92,
            action: 0.92,
            flicker: 0.92,
            lipsync: 0.92,
            subtitle: 0.92,
            brand: 0.92,
            safeArea: 0.92,
            audio: 0.92,
            compliance: 0.92,
          },
          decision: 'pass',
          reason: `MOCK ${route} deterministic QC pass`,
        }),
        (input) => Number((input.criteria.length * 0.001).toFixed(4)),
      ),
    );
  }
  registry.assertComplete();
  return registry;
}
