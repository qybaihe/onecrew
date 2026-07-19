import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type {
  BudgetAllocationMarket,
  BudgetAllocationPlan,
  BudgetDistributionModel,
  BudgetMonetizationModel,
  BudgetRiskTolerance,
  JobRecord,
} from '@onecrew/contracts';

import {
  getBudgetAllocationPlan,
  submitBudgetAllocationPlan,
  type BudgetAllocationPlanPreview,
  type CreativeProjectResponse,
} from './creative-api.js';
import './budget-allocation.css';

type BudgetStage = 'idle' | 'running' | 'done' | 'error';
type BudgetTab = 'allocation' | 'phases' | 'channels' | 'gates' | 'operations' | 'evidence' | 'json';

interface BudgetAllocationPageProps {
  projectId?: string;
  project?: CreativeProjectResponse;
  onRefresh(): Promise<void>;
}

interface BudgetFormState {
  market: BudgetAllocationMarket;
  totalBudgetCny: number;
  horizonWeeks: number;
  distributionModel: BudgetDistributionModel;
  monetizationModel: BudgetMonetizationModel;
  riskTolerance: BudgetRiskTolerance;
  brief: string;
  cpiCny: string;
  day7RetentionPercent: string;
  payerConversionPercent: string;
  day30NetLtvCny: string;
  paidRoas: string;
}

interface PersistedBudgetRun {
  form: BudgetFormState;
  jobId?: string;
}

const STORAGE_PREFIX = 'onecrew.budgetAgent.';
const TERMINAL_STATUSES: JobRecord['status'][] = [
  'succeeded',
  'failed',
  'cancelled',
  'waiting_human',
];

const STATUS_LABELS: Record<JobRecord['status'], string> = {
  queued: '已排队',
  running: 'GLM 分析中',
  waiting_human: '等待人工审批',
  succeeded: '方案已完成',
  failed: '生成失败',
  cancelled: '已取消',
};

const MARKET_OPTIONS: Array<{ id: BudgetAllocationMarket; code: string; label: string; detail: string }> = [
  { id: 'north_america', code: 'NA', label: '北美', detail: '美国主投 · 加拿大验证' },
  { id: 'united_states', code: 'US', label: '美国', detail: '单市场集中验证' },
  { id: 'canada', code: 'CA', label: '加拿大', detail: '英语市场小规模验证' },
];

const DISTRIBUTION_OPTIONS: Array<{ id: BudgetDistributionModel; label: string }> = [
  { id: 'owned_app', label: '独立 App' },
  { id: 'licensed_platform', label: '平台发行' },
  { id: 'social_first', label: '社媒优先' },
  { id: 'hybrid', label: '混合发行' },
];

const MONETIZATION_OPTIONS: Array<{ id: BudgetMonetizationModel; label: string }> = [
  { id: 'hybrid', label: 'IAP + 订阅混合' },
  { id: 'iap', label: '按集解锁 / IAP' },
  { id: 'subscription', label: '订阅' },
  { id: 'ad_supported', label: '广告变现' },
];

const RISK_OPTIONS: Array<{ id: BudgetRiskTolerance; label: string; detail: string }> = [
  { id: 'conservative', label: '保守', detail: '更大储备、更小首投' },
  { id: 'balanced', label: '平衡', detail: '验证与增长兼顾' },
  { id: 'aggressive', label: '进取', detail: '更快验证、更高波动' },
];

const ALLOCATION_COLORS = [
  '#653aff', '#8c6cff', '#b29dff', '#17151c', '#524d5d',
  '#ed9b22', '#d95f76', '#339a74', '#6087c4', '#b2aeb9',
];

function defaultForm(synopsis = ''): BudgetFormState {
  return {
    market: 'north_america',
    totalBudgetCny: 1_000_000,
    horizonWeeks: 12,
    distributionModel: 'owned_app',
    monetizationModel: 'hybrid',
    riskTolerance: 'balanced',
    brief: [
      synopsis,
      '给定一个在源市场已经验证的爆款短剧 IP、一套 OneCrew AI 全链路工具和 100 万人民币预算，设计“一人剧组，爆款出海”的北美执行方案。优先验证真实单位经济，不承诺必爆；明确首批放款、制作与投放比例、停损线和每周执行节奏。',
    ].filter(Boolean).join('\n\n'),
    cpiCny: '',
    day7RetentionPercent: '',
    payerConversionPercent: '',
    day30NetLtvCny: '',
    paidRoas: '',
  };
}

function readPersisted(projectId: string): PersistedBudgetRun | undefined {
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${projectId}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PersistedBudgetRun>;
    if (!value.form || typeof value.form.brief !== 'string' || typeof value.form.totalBudgetCny !== 'number') {
      return undefined;
    }
    return value as PersistedBudgetRun;
  } catch {
    return undefined;
  }
}

function persist(projectId: string, value: PersistedBudgetRun): void {
  window.localStorage.setItem(`${STORAGE_PREFIX}${projectId}`, JSON.stringify(value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function cny(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);
}

function compactCny(value: number): string {
  if (value >= 10_000) return `¥${(value / 10_000).toFixed(value % 10_000 === 0 ? 0 : 1)} 万`;
  return cny(value);
}

function elapsed(job?: JobRecord): string {
  if (!job) return '—';
  if (job.latencyMs !== undefined) return `${(job.latencyMs / 1_000).toFixed(1)} s`;
  const duration = Date.parse(job.updatedAt) - Date.parse(job.createdAt);
  return Number.isFinite(duration) ? `${Math.max(0, duration / 1_000).toFixed(1)} s` : '—';
}

export function formatBudgetProviderFailure(message: string, model: string): string {
  if (/GoUsageLimitError|Monthly usage limit reached/i.test(message)) {
    const resetDays = message.match(/Resets in\s+(\d+)\s+days?/i)?.[1];
    return `${model} 端点的月度额度已用尽${resetDays ? `（预计 ${resetDays} 天后重置）` : ''}。方案输入已保留；启用余额或更换有额度的端点后可直接重试。`;
  }
  if (/invalid structured JSON|Unterminated string in JSON/i.test(message)) {
    return `${model} 返回的预算 JSON 不完整。输入与 Job 证据已保留，可直接重新生成。`;
  }
  return message;
}

function failure(job: JobRecord): Error {
  return new Error(formatBudgetProviderFailure(job.errorMessage ?? `${job.jobId} ${STATUS_LABELS[job.status]}`, job.model));
}

function knownMetric(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function donutBackground(plan: BudgetAllocationPlan): string {
  let cursor = 0;
  const stops = plan.allocations.map((item, index) => {
    const start = cursor;
    cursor += item.percentage;
    return `${ALLOCATION_COLORS[index % ALLOCATION_COLORS.length]} ${start}% ${cursor}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function BudgetAllocationPage({ projectId, project, onRefresh }: BudgetAllocationPageProps) {
  const [form, setForm] = useState<BudgetFormState>(() => defaultForm());
  const [stage, setStage] = useState<BudgetStage>('idle');
  const [job, setJob] = useState<JobRecord>();
  const [plan, setPlan] = useState<BudgetAllocationPlan>();
  const [tab, setTab] = useState<BudgetTab>('allocation');
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [copied, setCopied] = useState(false);
  const runSequence = useRef(0);

  useEffect(() => {
    const sequence = ++runSequence.current;
    const saved = projectId ? readPersisted(projectId) : undefined;
    setForm(saved?.form ?? defaultForm(project?.bundle.project.synopsis));
    setStage('idle');
    setJob(undefined);
    setPlan(undefined);
    setError(undefined);
    setNotice(undefined);
    setTab('allocation');
    if (!projectId || !saved?.jobId) return;

    void getBudgetAllocationPlan(projectId, saved.jobId)
      .then((preview) => {
        if (runSequence.current !== sequence) return;
        setJob(preview.job);
        if (preview.job.status === 'succeeded' && preview.plan) {
          setPlan(preview.plan);
          setStage('done');
          setNotice('已恢复这个项目最近完成的预算方案。');
          return;
        }
        if (TERMINAL_STATUSES.includes(preview.job.status)) throw failure(preview.job);
        setNotice('最近的预算 Job 仍在后端运行；可重新生成，旧 Job 仍保留在任务中心。');
      })
      .catch((reason: unknown) => {
        if (runSequence.current !== sequence) return;
        setNotice(`未能恢复最近的预算方案：${reason instanceof Error ? reason.message : String(reason)}`);
      });
  }, [projectId, project?.bundle.project.synopsis]);

  useEffect(() => () => { runSequence.current += 1; }, []);

  const busy = stage === 'running';
  const json = useMemo(() => JSON.stringify(plan ?? null, null, 2), [plan]);
  const hasKnownMetrics = [
    form.cpiCny,
    form.day7RetentionPercent,
    form.payerConversionPercent,
    form.day30NetLtvCny,
    form.paidRoas,
  ].some((value) => value.trim());

  const poll = async (jobId: string, sequence: number): Promise<BudgetAllocationPlanPreview> => {
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      if (runSequence.current !== sequence) throw new Error('页面等待已被新的预算请求取代');
      const preview = await getBudgetAllocationPlan(projectId!, jobId);
      setJob(preview.job);
      if (preview.job.status === 'succeeded' && preview.plan) return preview;
      if (TERMINAL_STATUSES.includes(preview.job.status)) throw failure(preview.job);
      await delay(1_000);
    }
    throw new Error('预算分析超过 300 秒；Job 仍保留在生成任务中心，可稍后恢复。');
  };

  const submit = async () => {
    if (!projectId) return setError('请先选择一个 OneCrew 项目。');
    if (!form.brief.trim()) return setError('请输入 IP、发行目标和预算约束。');
    if (form.totalBudgetCny < 10_000) return setError('总预算不能低于 ¥10,000。');
    const sequence = ++runSequence.current;
    setStage('running');
    setJob(undefined);
    setPlan(undefined);
    setError(undefined);
    setNotice(hasKnownMetrics ? undefined : '没有历史指标：GLM 将使用公式和阶段门槛，不会伪造 CPI、留存或 LTV。');
    setTab('allocation');
    setCopied(false);
    persist(projectId, { form });

    const knownMetrics = {
      cpiCny: knownMetric(form.cpiCny),
      day7RetentionPercent: knownMetric(form.day7RetentionPercent),
      payerConversionPercent: knownMetric(form.payerConversionPercent),
      day30NetLtvCny: knownMetric(form.day30NetLtvCny),
      paidRoas: knownMetric(form.paidRoas),
    };
    const cleanedMetrics = Object.fromEntries(
      Object.entries(knownMetrics).filter((entry): entry is [string, number] => entry[1] !== undefined),
    );
    try {
      const accepted = await submitBudgetAllocationPlan(projectId, {
        market: form.market,
        totalBudgetCny: Math.round(form.totalBudgetCny),
        horizonWeeks: form.horizonWeeks,
        distributionModel: form.distributionModel,
        monetizationModel: form.monetizationModel,
        riskTolerance: form.riskTolerance,
        brief: form.brief.trim(),
        ...(Object.keys(cleanedMetrics).length ? { knownMetrics: cleanedMetrics } : {}),
      });
      if (runSequence.current !== sequence) return;
      persist(projectId, { form, jobId: accepted.job_id });
      if (accepted.warning) setNotice(accepted.warning);
      const preview = await poll(accepted.job_id, sequence);
      if (runSequence.current !== sequence) return;
      setPlan(preview.plan);
      setStage('done');
      setNotice(undefined);
      await onRefresh();
    } catch (reason) {
      if (runSequence.current !== sequence) return;
      setStage('error');
      setError(reason instanceof Error ? reason.message : String(reason));
      await onRefresh().catch(() => undefined);
    }
  };

  const cancelWait = () => {
    runSequence.current += 1;
    setStage(plan ? 'done' : 'idle');
    setNotice('已停止页面轮询；后端 Job 未被取消，可在任务中心继续查看。');
  };

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `onecrew-budget-${form.market}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="budget-agent">
      <header className="budget-hero">
        <div>
          <span className="budget-kicker">ONECREW / CAPITAL ALLOCATION</span>
          <h1>出海预算决策 Agent</h1>
          <p>把爆款 IP、AI 产能和有限现金变成可验证的北美上市计划。GLM 负责策略判断，OneCrew 负责金额对账与阶段拨款；目标是找到可扩张信号，不是许诺“必爆”。</p>
        </div>
        <div className="budget-runtime">
          <span className={job?.mode === 'real' ? 'live' : ''} />
          <div>
            <strong>{job ? `${job.mode.toUpperCase()} · ${job.model}` : '等待预算任务'}</strong>
            <small>{job ? `${job.provider} · ${STATUS_LABELS[job.status]}` : '生成后显示真实 Provider / Model'}</small>
          </div>
        </div>
      </header>

      <section className="budget-input-card">
        <div className="budget-section-head">
          <div><span>01</span><div><h2>定义资金约束</h2><p>{project?.bundle.project.nameZh ?? '未选择项目'}</p></div></div>
          <small>所有金额统一按人民币整数对账</small>
        </div>
        <div className="budget-input-body">
          <div className="budget-form-grid">
            <div className="budget-market-block">
              <label className="budget-label">目标市场</label>
              <div className="budget-market-options">
                {MARKET_OPTIONS.map((option) => <button
                  key={option.id}
                  type="button"
                  disabled={busy}
                  className={form.market === option.id ? 'selected' : ''}
                  aria-pressed={form.market === option.id}
                  onClick={() => setForm((current) => ({ ...current, market: option.id }))}
                ><span>{option.code}</span><strong>{option.label}</strong><small>{option.detail}</small></button>)}
              </div>
            </div>

            <div className="budget-number-block">
              <label className="budget-label" htmlFor="budget-total">总预算（人民币）</label>
              <div className="budget-money-input"><span>¥</span><input id="budget-total" type="number" min={10_000} max={1_000_000_000} step={10_000} disabled={busy} value={form.totalBudgetCny} onChange={(event) => setForm((current) => ({ ...current, totalBudgetCny: Math.max(0, Number(event.target.value) || 0) }))} /></div>
              <div className="budget-presets">{[300_000, 1_000_000, 3_000_000].map((value) => <button type="button" disabled={busy} key={value} onClick={() => setForm((current) => ({ ...current, totalBudgetCny: value }))}>{compactCny(value)}</button>)}</div>
            </div>

            <label className="budget-select-field"><span>决策周期</span><select disabled={busy} value={form.horizonWeeks} onChange={(event) => setForm((current) => ({ ...current, horizonWeeks: Number(event.target.value) }))}><option value={8}>8 周</option><option value={12}>12 周</option><option value={16}>16 周</option><option value={24}>24 周</option></select></label>
            <label className="budget-select-field"><span>发行模式</span><select disabled={busy} value={form.distributionModel} onChange={(event) => setForm((current) => ({ ...current, distributionModel: event.target.value as BudgetDistributionModel }))}>{DISTRIBUTION_OPTIONS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
            <label className="budget-select-field"><span>变现模式</span><select disabled={busy} value={form.monetizationModel} onChange={(event) => setForm((current) => ({ ...current, monetizationModel: event.target.value as BudgetMonetizationModel }))}>{MONETIZATION_OPTIONS.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>

            <div className="budget-risk-field">
              <span className="budget-label">风险偏好</span>
              <div>{RISK_OPTIONS.map((item) => <button key={item.id} type="button" disabled={busy} className={form.riskTolerance === item.id ? 'selected' : ''} onClick={() => setForm((current) => ({ ...current, riskTolerance: item.id }))}><strong>{item.label}</strong><small>{item.detail}</small></button>)}</div>
            </div>
          </div>

          <label className="budget-brief-field">
            <span>IP、发行目标与现实约束 <small>{form.brief.length} / 20,000</small></span>
            <textarea rows={7} maxLength={20_000} disabled={busy} value={form.brief} onChange={(event) => setForm((current) => ({ ...current, brief: event.target.value }))} />
          </label>

          <details className="budget-metrics">
            <summary><span>已有投放 / 产品指标（可选）</span><small>{hasKnownMetrics ? '将覆盖纯假设' : '留空时输出验证公式，不编造 benchmark'}</small></summary>
            <div>
              <MetricInput label="CPI" suffix="元" value={form.cpiCny} disabled={busy} onChange={(value) => setForm((current) => ({ ...current, cpiCny: value }))} />
              <MetricInput label="D7 留存" suffix="%" value={form.day7RetentionPercent} disabled={busy} onChange={(value) => setForm((current) => ({ ...current, day7RetentionPercent: value }))} />
              <MetricInput label="付费转化" suffix="%" value={form.payerConversionPercent} disabled={busy} onChange={(value) => setForm((current) => ({ ...current, payerConversionPercent: value }))} />
              <MetricInput label="D30 净 LTV" suffix="元" value={form.day30NetLtvCny} disabled={busy} onChange={(value) => setForm((current) => ({ ...current, day30NetLtvCny: value }))} />
              <MetricInput label="Paid ROAS" suffix="x" value={form.paidRoas} disabled={busy} onChange={(value) => setForm((current) => ({ ...current, paidRoas: value }))} />
            </div>
          </details>

          <div className="budget-submit-row">
            <button className="budget-primary" type="button" disabled={busy || !projectId || !form.brief.trim()} onClick={() => void submit()}>{busy ? <span className="budget-spinner" /> : <span aria-hidden="true">✦</span>}{busy ? 'GLM 正在制定预算方案…' : `生成 ${compactCny(form.totalBudgetCny)} 北美方案`}</button>
            {busy && <button className="budget-secondary" type="button" onClick={cancelWait}>停止等待</button>}
            <small>结构化 GLM 调用 · Job artifact · 不自动花费预算</small>
          </div>
        </div>
      </section>

      {(error || notice) && <div className={error ? 'budget-alert error' : 'budget-alert'} role={error ? 'alert' : 'status'}><strong>{error ? '本次方案未完成' : '决策提示'}</strong><span>{error ?? notice}</span>{error && <button type="button" onClick={() => void submit()}>重新生成</button>}</div>}

      {job && <section className="budget-job-strip" aria-live="polite">
        <div><span className={busy ? 'active' : ''} /><strong>{STATUS_LABELS[job.status]}</strong><small>{job.jobId}</small></div>
        <dl><div><dt>Provider</dt><dd>{job.provider}</dd></div><div><dt>Model</dt><dd>{job.model}</dd></div><div><dt>Mode</dt><dd>{job.mode.toUpperCase()}</dd></div><div><dt>耗时</dt><dd>{elapsed(job)}</dd></div><div><dt>LLM 成本</dt><dd>¥{(job.actualCostCny ?? job.estimatedCostCny ?? 0).toFixed(4)}</dd></div></dl>
      </section>}

      {plan && <section className="budget-results">
        <div className="budget-results-head">
          <div><span>02</span><div><h2>可执行预算方案</h2><p>{plan.marketLabel} · {plan.horizonWeeks} 周 · 证据更新至 {plan.evidenceAsOf}</p></div></div>
          <div><button type="button" onClick={() => void copy()}>{copied ? '已复制' : '复制 JSON'}</button><button type="button" onClick={download}>下载方案</button></div>
        </div>

        <div className="budget-thesis">
          <div><span>CAPITAL THESIS</span><h2>{plan.headline}</h2><p>{plan.executiveSummary}</p></div>
          <div className="budget-donut-wrap">
            <div className="budget-donut" style={{ '--budget-donut': donutBackground(plan) } as CSSProperties}><div><strong>{compactCny(plan.totalBudgetCny)}</strong><small>总预算</small></div></div>
          </div>
        </div>

        <div className="budget-kpi-cards">
          <SummaryCard label="首批仅释放" value={compactCny(plan.initialReleaseCny)} detail={`${((plan.initialReleaseCny / plan.totalBudgetCny) * 100).toFixed(1)}% · 验证未过不放下一笔`} tone="accent" />
          <SummaryCard label="效果投放池" value={compactCny(plan.paidMediaBudgetCny)} detail="按阶段与渠道门槛分批释放" />
          <SummaryCard label="制作 + 本土化" value={compactCny(plan.allocations.filter((item) => ['script_localization', 'ai_production', 'post_qc'].includes(item.category)).reduce((sum, item) => sum + item.amountCny, 0))} detail="先最小可售内容包，再补全长季" />
          <SummaryCard label="未释放储备" value={compactCny(plan.phases.find((item) => item.phase === 'reserve')?.amountCny ?? 0)} detail="没有书面 Go 决策就不花" tone="safe" />
        </div>

        <nav className="budget-tabs" aria-label="预算方案结果">
          {([
            ['allocation', '资金去向'], ['phases', '阶段拨款'], ['channels', '投放渠道'], ['gates', 'KPI 闸门'],
            ['operations', '一人执行'], ['evidence', '假设与证据'], ['json', 'JSON'],
          ] as Array<[BudgetTab, string]>).map(([id, label]) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}
        </nav>

        <div className="budget-tab-content">
          {tab === 'allocation' && <AllocationView plan={plan} />}
          {tab === 'phases' && <PhaseView plan={plan} />}
          {tab === 'channels' && <ChannelView plan={plan} />}
          {tab === 'gates' && <GateView plan={plan} />}
          {tab === 'operations' && <OperationsView plan={plan} />}
          {tab === 'evidence' && <EvidenceView plan={plan} />}
          {tab === 'json' && <pre className="budget-json"><code>{json}</code></pre>}
        </div>
      </section>}
    </div>
  );
}

function MetricInput({ label, suffix, value, disabled, onChange }: { label: string; suffix: string; value: string; disabled: boolean; onChange(value: string): void }) {
  return <label><span>{label}</span><div><input type="number" min={0} step="any" value={value} disabled={disabled} placeholder="未知" onChange={(event) => onChange(event.target.value)} /><small>{suffix}</small></div></label>;
}

function SummaryCard({ label, value, detail, tone = '' }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function AllocationView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-allocation-view">
    <div className="budget-view-intro"><div><span>100% RECONCILED</span><h3>每一元都必须有用途，也必须有放款条件</h3></div><strong>{cny(plan.allocations.reduce((sum, item) => sum + item.amountCny, 0))}</strong></div>
    <div className="budget-allocation-list">{plan.allocations.map((item, index) => <article key={item.category}>
      <div className="budget-allocation-title"><span style={{ background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} /><div><h4>{item.label}</h4><small>{item.category}</small></div><strong>{compactCny(item.amountCny)}</strong><b>{item.percentage.toFixed(1)}%</b></div>
      <div className="budget-bar"><span style={{ width: `${item.percentage}%`, background: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length] }} /></div>
      <p>{item.rationale}</p><dl><dt>释放条件</dt><dd>{item.releaseGate}</dd></dl>
    </article>)}</div>
  </div>;
}

function PhaseView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-phase-view">
    <div className="budget-release-rule"><span>拨款原则</span><strong>上一阶段不通过，下一阶段金额保持未花费</strong><p>这不是一份一次性支出清单，而是 {plan.horizonWeeks} 周的资本释放协议。</p></div>
    <ol>{plan.phases.map((item, index) => <li key={item.phase} className={item.phase === 'reserve' ? 'reserve' : ''}>
      <div className="budget-phase-index"><span>{String(index + 1).padStart(2, '0')}</span><i /></div>
      <article><div><span>{item.weeks}</span><b>{item.percentage.toFixed(1)}%</b></div><h3>{item.label}</h3><strong>{compactCny(item.amountCny)}</strong><p>{item.objective}</p><h4>退出条件</h4><ul>{item.exitCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></article>
    </li>)}</ol>
  </div>;
}

function ChannelView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-channel-view">
    <div className="budget-view-intro"><div><span>PAID MEDIA POOL</span><h3>平台份额是起始假设，胜者由 cohort 决定</h3></div><strong>{compactCny(plan.paidMediaBudgetCny)}</strong></div>
    <div className="budget-channel-grid">{plan.channels.map((item, index) => <article key={item.channel}>
      <header><span style={{ background: ALLOCATION_COLORS[index] }} /> <div><h3>{item.label}</h3><small>{item.shareOfPaidMediaPercent.toFixed(1)}% of media</small></div><strong>{compactCny(item.amountCny)}</strong></header>
      <p>{item.role}</p><dl><div><dt>怎么测</dt><dd>{item.testDesign}</dd></div><div><dt>何时加</dt><dd>{item.scaleRule}</dd></div><div><dt>何时停</dt><dd>{item.stopRule}</dd></div></dl>
    </article>)}</div>
  </div>;
}

function GateView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-gate-view"><div className="budget-view-intro"><div><span>GO / FIX / STOP</span><h3>没有样本量，就没有“达标”</h3></div><strong>{plan.kpiGates.length} 道闸门</strong></div><div className="budget-table-wrap"><table><thead><tr><th>指标</th><th>定义</th><th>通过标准</th><th>最低样本</th><th>未通过动作</th></tr></thead><tbody>{plan.kpiGates.map((gate) => <tr key={gate.metric}><td><strong>{gate.metric}</strong></td><td>{gate.definition}</td><td>{gate.target}</td><td>{gate.minimumSample}</td><td>{gate.actionIfMissed}</td></tr>)}</tbody></table></div></div>;
}

function OperationsView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-operations-view">
    <section><div className="budget-view-intro"><div><span>ONE-PERSON OPERATING SYSTEM</span><h3>自动化做重复劳动，人只做不可逆决策</h3></div></div><div className="budget-cadence-list">{plan.onePersonCadence.map((item, index) => <article key={`${item.cadence}-${index}`}><span>{item.cadence}</span><div><h4>OneCrew 自动化</h4><p>{item.automation}</p></div><div><h4>人来决定</h4><p>{item.humanDecision}</p></div><strong>{item.deliverable}</strong></article>)}</div></section>
    <section><div className="budget-view-intro"><div><span>RISK RADAR</span><h3>最可能烧掉预算的地方</h3></div></div><div className="budget-risk-list">{plan.risks.map((item) => <article key={item.risk}><h4>{item.risk}</h4><dl><div><dt>早期信号</dt><dd>{item.earlySignal}</dd></div><div><dt>应对</dt><dd>{item.mitigation}</dd></div></dl></article>)}</div></section>
  </div>;
}

function EvidenceView({ plan }: { plan: BudgetAllocationPlan }) {
  return <div className="budget-evidence-view">
    <section><div className="budget-view-intro"><div><span>ASSUMPTION LEDGER</span><h3>每个关键判断都写明反证条件</h3></div></div><div className="budget-assumption-list">{plan.assumptions.map((item) => <article key={item.claim}><header><span className={item.confidence}>{item.confidence.toUpperCase()}</span><h4>{item.claim}</h4></header><p>{item.basis}</p><dl><dt>什么会推翻它</dt><dd>{item.invalidatedBy}</dd></dl></article>)}</div></section>
    <section><div className="budget-view-intro"><div><span>EVIDENCE SOURCES</span><h3>官方平台规则与市场情报分开标注</h3></div><small>截至 {plan.evidenceAsOf}</small></div><div className="budget-source-list">{plan.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}><span>{source.evidenceType === 'official_platform' ? '官方平台' : source.evidenceType === 'market_intelligence' ? '市场情报' : '规划假设'} · {source.confidence.toUpperCase()}</span><h4>{source.title}</h4><p>{source.usedFor}</p><small>打开来源 ↗</small></a>)}</div></section>
  </div>;
}
