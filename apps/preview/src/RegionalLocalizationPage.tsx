import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  CreativeStoryPlan,
  JobRecord,
  RegionalCulturePack,
  RegionalCulturePackRegion,
} from '@onecrew/contracts';

import {
  getCreativeStoryPlan,
  getRegionalCulturePack,
  submitCreativeStoryPlan,
  submitRegionalCulturePack,
  type CreativeProjectResponse,
  type RegionalCulturePackPreview,
} from './creative-api.js';
import './regional-localization.css';

const REGION_OPTIONS: Array<{
  id: RegionalCulturePackRegion;
  label: string;
  locale: string;
  description: string;
}> = [
  { id: 'america', label: '美国', locale: 'EN-US', description: '快节奏、高冲突、个人选择' },
  { id: 'russia', label: '俄罗斯', locale: 'RU-RU', description: '家族羁绊、命运张力、冷峻视觉' },
  { id: 'uk', label: '英国', locale: 'EN-GB', description: '阶层摩擦、克制幽默、反转叙事' },
];

const STATUS_LABELS: Record<JobRecord['status'], string> = {
  queued: '已排队',
  running: '生成中',
  waiting_human: '等待人工审批',
  succeeded: '已完成',
  failed: '已失败',
  cancelled: '已取消',
};

type PipelineStage = 'idle' | 'culture' | 'story' | 'done' | 'error';
type ResultTab = 'culture' | 'story' | 'json';

interface RegionalLocalizationPageProps {
  projectId?: string;
  project?: CreativeProjectResponse;
  onRefresh(): Promise<void>;
  onOpenStoryPlan(): void;
}

interface PipelineJob {
  kind: 'culture' | 'story';
  job: JobRecord;
}

interface PersistedRegionalRun {
  region: RegionalCulturePackRegion;
  brief: string;
  episodeCount: number;
  useCulturePack: boolean;
  cultureJobId?: string;
}

const REGIONAL_RUN_STORAGE_PREFIX = 'onecrew.regional.';

function isRegion(value: unknown): value is RegionalCulturePackRegion {
  return value === 'america' || value === 'russia' || value === 'uk';
}

function readPersistedRun(projectId: string): PersistedRegionalRun | undefined {
  try {
    const raw = window.localStorage.getItem(`${REGIONAL_RUN_STORAGE_PREFIX}${projectId}`);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<PersistedRegionalRun> & { includeStoryPlan?: unknown };
    if (
      !isRegion(value.region)
      || typeof value.brief !== 'string'
      || typeof value.episodeCount !== 'number'
      || (value.cultureJobId !== undefined && typeof value.cultureJobId !== 'string')
    ) return undefined;
    return {
      region: value.region,
      brief: value.brief,
      episodeCount: Math.min(12, Math.max(1, value.episodeCount)),
      // Older saved culture runs used includeStoryPlan. Any saved culture Job
      // means the user intentionally chose the culture-first path.
      useCulturePack: typeof value.useCulturePack === 'boolean' ? value.useCulturePack : Boolean(value.cultureJobId),
      ...(value.cultureJobId ? { cultureJobId: value.cultureJobId } : {}),
    };
  } catch {
    return undefined;
  }
}

function persistRun(projectId: string, value: PersistedRegionalRun): void {
  window.localStorage.setItem(`${REGIONAL_RUN_STORAGE_PREFIX}${projectId}`, JSON.stringify(value));
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function formatProviderFailure(message: string, model: string): string {
  if (/GoUsageLimitError|Monthly usage limit reached/i.test(message)) {
    const resetDays = message.match(/Resets in\s+(\d+)\s+days?/i)?.[1];
    return `${model} 端点的月度用量已达上限${resetDays ? `（预计 ${resetDays} 天后重置）` : ''}。请启用可用余额或更换有额度的端点，然后点击“重试脚本”。`;
  }
  if (/invalid structured JSON|Unterminated string in JSON/i.test(message)) {
    return `${model} 返回的剧本 JSON 不完整。文化包不会重跑，可直接重试脚本。`;
  }
  return message;
}

function jobFailure(job: JobRecord): Error {
  const message = job.errorMessage ?? `${job.jobId} ${STATUS_LABELS[job.status]}`;
  return new Error(formatProviderFailure(message, job.model));
}

function terminal(status: JobRecord['status']): boolean {
  return ['succeeded', 'failed', 'cancelled', 'waiting_human'].includes(status);
}

function serialize(pack?: RegionalCulturePack, plan?: CreativeStoryPlan): string {
  return JSON.stringify({ culturePack: pack ?? null, storyPlan: plan ?? null }, null, 2);
}

function elapsed(job?: JobRecord): string {
  if (!job) return '—';
  if (job.latencyMs !== undefined) return `${(job.latencyMs / 1_000).toFixed(1)} s`;
  const duration = Date.parse(job.updatedAt) - Date.parse(job.createdAt);
  return Number.isFinite(duration) ? `${Math.max(0, duration / 1_000).toFixed(1)} s` : '—';
}

export function buildDirectStoryBrief(region: RegionalCulturePackRegion, brief: string): string {
  const option = REGION_OPTIONS.find((item) => item.id === region)!;
  const instruction = [
    `目标市场：${option.label}（${option.locale}，region=${option.id}）。`,
    `市场创作方向：${option.description}。`,
    '请直接产出面向该市场的本土化短剧脚本规划；人物动机、冲突、对白语感、场景和集尾钩子都应从目标市场出发，不要先写中文市场版本再翻译。',
  ].join('\n');
  const available = Math.max(0, 20_000 - instruction.length - 2);
  return `${instruction}\n\n${brief.trim().slice(0, available)}`;
}

export function RegionalLocalizationPage({
  projectId,
  project,
  onRefresh,
  onOpenStoryPlan,
}: RegionalLocalizationPageProps) {
  const [region, setRegion] = useState<RegionalCulturePackRegion>('america');
  const [brief, setBrief] = useState('');
  const [episodeCount, setEpisodeCount] = useState(1);
  const [useCulturePack, setUseCulturePack] = useState(false);
  const [stage, setStage] = useState<PipelineStage>('idle');
  const [cultureJobId, setCultureJobId] = useState<string>();
  const [culturePreview, setCulturePreview] = useState<RegionalCulturePackPreview>();
  const [storyJob, setStoryJob] = useState<JobRecord>();
  const [storyPlan, setStoryPlan] = useState<CreativeStoryPlan>();
  const [activeJob, setActiveJob] = useState<PipelineJob>();
  const [tab, setTab] = useState<ResultTab>('culture');
  const [error, setError] = useState<string>();
  const [warning, setWarning] = useState<string>();
  const [copied, setCopied] = useState(false);
  const runSequence = useRef(0);

  useEffect(() => {
    const sequence = ++runSequence.current;
    const persisted = projectId ? readPersistedRun(projectId) : undefined;
    setRegion(persisted?.region ?? 'america');
    setBrief(persisted?.brief ?? project?.bundle.project.synopsis ?? '');
    setEpisodeCount(persisted?.episodeCount ?? 1);
    setUseCulturePack(persisted?.useCulturePack ?? false);
    setStage('idle');
    setCultureJobId(persisted?.cultureJobId);
    setCulturePreview(undefined);
    setStoryJob(undefined);
    setStoryPlan(undefined);
    setActiveJob(undefined);
    setError(undefined);
    setWarning(undefined);

    if (!projectId || !persisted?.cultureJobId) return;
    setStage('culture');
    void getRegionalCulturePack(projectId, persisted.cultureJobId)
      .then((preview) => {
        if (runSequence.current !== sequence) return;
        setCulturePreview(preview);
        if (preview.job.status === 'succeeded' && preview.pack) {
          if (preview.pack.region !== persisted.region) {
            throw new Error(`已保存文化包的地区不匹配：${preview.pack.region}`);
          }
          setStage('done');
          setWarning('已恢复这个项目最近成功生成的文化包。');
          return;
        }
        if (terminal(preview.job.status)) throw jobFailure(preview.job);
        setStage('idle');
        setWarning('最近的文化包任务仍在后端运行，可稍后刷新页面恢复结果。');
      })
      .catch((reason: unknown) => {
        if (runSequence.current !== sequence) return;
        setStage('idle');
        const message = reason instanceof Error ? reason.message : String(reason);
        if (/output is missing|has no structured output|does not use the regional culture pack contract/.test(message)) {
          setCultureJobId(undefined);
          setUseCulturePack(false);
          persistRun(projectId, {
            region: persisted.region,
            brief: persisted.brief,
            episodeCount: persisted.episodeCount,
            useCulturePack: false,
          });
          setWarning('最近的文化包产物不可用，已切换为“直接生成剧本”；本次不会再引用该 Job。');
          return;
        }
        setWarning(`未能恢复最近的文化包：${message}`);
      });
  }, [projectId, project?.bundle.project.synopsis]);

  useEffect(() => () => {
    runSequence.current += 1;
  }, []);

  const pack = culturePreview?.pack;
  const latestJob = storyJob ?? culturePreview?.job ?? activeJob?.job;
  const resultJson = useMemo(() => serialize(pack, storyPlan), [pack, storyPlan]);
  const busy = stage === 'culture' || stage === 'story';

  const pollCulturePack = async (jobId: string, sequence: number): Promise<RegionalCulturePackPreview> => {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (runSequence.current !== sequence) throw new Error('任务已被新的生成请求取代');
      const preview = await getRegionalCulturePack(projectId!, jobId);
      setCulturePreview(preview);
      setActiveJob({ kind: 'culture', job: preview.job });
      if (terminal(preview.job.status)) return preview;
      await delay(1_000);
    }
    throw new Error('文化包生成超过 180 秒，任务仍可在生成任务中心查看');
  };

  const pollStoryPlan = async (jobId: string, sequence: number): Promise<CreativeStoryPlan> => {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      if (runSequence.current !== sequence) throw new Error('任务已被新的生成请求取代');
      const preview = await getCreativeStoryPlan(projectId!, jobId);
      setStoryJob(preview.job);
      setActiveJob({ kind: 'story', job: preview.job });
      if (preview.job.status === 'succeeded' && preview.plan) return preview.plan;
      if (terminal(preview.job.status)) throw jobFailure(preview.job);
      await delay(1_000);
    }
    throw new Error('剧本规划生成超过 240 秒，任务仍可在生成任务中心查看');
  };

  const runCulturePipeline = async () => {
    if (!projectId) return setError('请先选择一个 OneCrew 项目。');
    if (!brief.trim()) return setError('请输入地域需求或原始故事简介。');
    const sequence = ++runSequence.current;
    setStage('culture');
    setCultureJobId(undefined);
    setCulturePreview(undefined);
    setStoryJob(undefined);
    setStoryPlan(undefined);
    setActiveJob(undefined);
    setError(undefined);
    setWarning(undefined);
    setCopied(false);
    setTab('culture');
    persistRun(projectId, {
      region,
      brief: brief.trim(),
      episodeCount,
      useCulturePack: true,
    });
    try {
      const accepted = await submitRegionalCulturePack(projectId, region, brief.trim());
      if (runSequence.current !== sequence) return;
      setCultureJobId(accepted.job_id);
      persistRun(projectId, {
        region,
        brief: brief.trim(),
        episodeCount,
        useCulturePack: true,
        cultureJobId: accepted.job_id,
      });
      setWarning(accepted.warning);
      const preview = await pollCulturePack(accepted.job_id, sequence);
      if (preview.job.status !== 'succeeded' || !preview.pack) throw jobFailure(preview.job);
      if (preview.pack.region !== region) {
        throw new Error(`地区校验失败：请求 ${region}，模型返回 ${preview.pack.region}`);
      }
      setStage('story');
      const storyAccepted = await submitCreativeStoryPlan(
        projectId,
        buildDirectStoryBrief(region, brief),
        episodeCount,
        accepted.job_id,
      );
      if (runSequence.current !== sequence) return;
      if (storyAccepted.warning) setWarning(storyAccepted.warning);
      const nextPlan = await pollStoryPlan(storyAccepted.job_id, sequence);
      if (runSequence.current !== sequence) return;
      setStoryPlan(nextPlan);
      setStage('done');
      setActiveJob(undefined);
      setTab('story');
      await onRefresh();
    } catch (reason) {
      if (runSequence.current !== sequence) return;
      setStage('error');
      setActiveJob(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
      await onRefresh().catch(() => undefined);
    }
  };

  const runDirectStoryPlan = async () => {
    if (!projectId) return setError('请先选择一个 OneCrew 项目。');
    if (!brief.trim()) return setError('请输入地域需求或原始故事简介。');
    const sequence = ++runSequence.current;
    setStage('story');
    setCultureJobId(undefined);
    setCulturePreview(undefined);
    setStoryJob(undefined);
    setStoryPlan(undefined);
    setActiveJob(undefined);
    setError(undefined);
    setWarning('已跳过文化包，地域要求将直接注入剧本生成。');
    setCopied(false);
    setTab('story');
    persistRun(projectId, {
      region,
      brief: brief.trim(),
      episodeCount,
      useCulturePack: false,
    });
    try {
      const accepted = await submitCreativeStoryPlan(
        projectId,
        buildDirectStoryBrief(region, brief),
        episodeCount,
      );
      if (runSequence.current !== sequence) return;
      if (accepted.warning) setWarning(accepted.warning);
      const nextPlan = await pollStoryPlan(accepted.job_id, sequence);
      if (runSequence.current !== sequence) return;
      setStoryPlan(nextPlan);
      setStage('done');
      setActiveJob(undefined);
      setWarning(undefined);
      await onRefresh();
    } catch (reason) {
      if (runSequence.current !== sequence) return;
      setStage('error');
      setActiveJob(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
      await onRefresh().catch(() => undefined);
    }
  };

  const retryStoryPlan = async () => {
    if (!projectId || !cultureJobId || !pack) return setError('缺少已完成的文化包，请重新生成完整方案。');
    const sequence = ++runSequence.current;
    setStage('story');
    setStoryJob(undefined);
    setStoryPlan(undefined);
    setActiveJob(undefined);
    setError(undefined);
    setWarning('正在复用已成功的文化包，仅重试剧本规划。');
    try {
      const accepted = await submitCreativeStoryPlan(
        projectId,
        buildDirectStoryBrief(region, brief),
        episodeCount,
        cultureJobId,
      );
      if (runSequence.current !== sequence) return;
      if (accepted.warning) setWarning(accepted.warning);
      const nextPlan = await pollStoryPlan(accepted.job_id, sequence);
      if (runSequence.current !== sequence) return;
      setStoryPlan(nextPlan);
      setStage('done');
      setActiveJob(undefined);
      setWarning(undefined);
      setTab('story');
      await onRefresh();
    } catch (reason) {
      if (runSequence.current !== sequence) return;
      setStage('error');
      setActiveJob(undefined);
      setError(reason instanceof Error ? reason.message : String(reason));
      await onRefresh().catch(() => undefined);
    }
  };

  const cancelLocalWait = () => {
    runSequence.current += 1;
    setStage(storyPlan || culturePreview?.pack ? 'done' : 'idle');
    setActiveJob(undefined);
    setWarning('已停止页面轮询；后端任务未被取消，可在任务中心继续查看。');
  };

  const copyResult = async () => {
    await navigator.clipboard.writeText(resultJson);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  };

  const downloadResult = () => {
    const blob = new Blob([resultJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `onecrew-regional-${region}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="regional-agent">
      <header className="regional-hero">
        <div>
          <span className="regional-kicker">ONECREW / REGIONAL INTELLIGENCE</span>
          <h1>地域本土化 Agent</h1>
          <p>选择目标市场并直接生成本土化脚本；需要更完整的市场分析时，可额外启用文化包。这里连接真实 API，不是静态演示页。</p>
        </div>
        <div className="regional-runtime" aria-label="当前运行状态">
          <span className={latestJob?.mode === 'real' ? 'live' : ''} />
          <div>
            <strong>{latestJob ? `${latestJob.mode.toUpperCase()} · ${latestJob.model}` : '等待生成任务'}</strong>
            <small>{latestJob ? `${latestJob.provider} · ${STATUS_LABELS[latestJob.status]}` : '生成后显示 Provider 与模型'}</small>
          </div>
        </div>
      </header>

      <div className="regional-workspace">
        <section className="regional-panel regional-input-panel">
          <div className="regional-panel-head">
            <div><span>01</span><h2>输入地域需求</h2></div>
            <small>{project?.bundle.project.nameZh ?? '未选择项目'}</small>
          </div>
          <div className="regional-panel-body">
            <fieldset className="regional-region-fieldset" disabled={busy}>
              <legend>目标市场</legend>
              <div className="regional-region-grid">
                {REGION_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    className={region === option.id ? 'selected' : ''}
                    type="button"
                    aria-pressed={region === option.id}
                    onClick={() => setRegion(option.id)}
                  >
                    <span>{option.locale}</span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="regional-brief-field">
              <span>故事与地域需求 <small>{brief.length} / 20,000</small></span>
              <textarea
                rows={9}
                maxLength={20_000}
                disabled={busy}
                value={brief}
                placeholder="例：面向美国女性短剧用户，保留龙族奇幻设定，强化女主的主动选择、第一集即时危机和集尾反转。"
                onChange={(event) => setBrief(event.target.value)}
              />
            </label>

            <div className="regional-options-row">
              <label>
                <span>规划集数</span>
                <input
                  type="number"
                  min={1}
                  max={12}
                  disabled={busy}
                  value={episodeCount}
                  onChange={(event) => setEpisodeCount(Math.min(12, Math.max(1, Number(event.target.value) || 1)))}
                />
              </label>
              <label className="regional-check">
                <input
                  type="checkbox"
                  checked={useCulturePack}
                  disabled={busy}
                  onChange={(event) => setUseCulturePack(event.target.checked)}
                />
                <span><strong>先生成地域文化包（可选）</strong><small>开启后增加一次 LLM 调用，再将文化包注入剧本</small></span>
              </label>
            </div>

            <div className="regional-submit-row">
              <button className="regional-primary" type="button" disabled={busy || !projectId || !brief.trim()} onClick={() => void (useCulturePack ? runCulturePipeline() : runDirectStoryPlan())}>
                {busy ? <span className="regional-spinner" /> : <span aria-hidden="true">✦</span>}
                {stage === 'culture' ? '正在生成文化包…' : stage === 'story' ? '正在生成本土化剧本…' : useCulturePack ? '生成文化包 + 剧本' : '直接生成本土化剧本'}
              </button>
              {busy && <button className="regional-secondary" type="button" onClick={cancelLocalWait}>停止等待</button>}
              <small>真实模式通常需要 1–2 分钟</small>
            </div>
          </div>
        </section>

        <aside className="regional-panel regional-progress-panel">
          <div className="regional-panel-head"><div><span>02</span><h2>生成流程</h2></div><small>{stage === 'done' ? '完成' : busy ? '运行中' : '就绪'}</small></div>
          <div className="regional-panel-body">
            <ol className="regional-steps">
              <PipelineStep index="1" title="地域需求" detail={`${REGION_OPTIONS.find((item) => item.id === region)?.label ?? region} · ${brief.trim() ? '已就绪' : '待输入'}`} state={brief.trim() ? 'done' : 'idle'} />
              <PipelineStep index="2" title="地域文化包" detail={!useCulturePack && !pack ? '已跳过 · 可选增强' : culturePreview?.job ? `${STATUS_LABELS[culturePreview.job.status]} · ${elapsed(culturePreview.job)}` : '受众 / 主题 / 价值 / 禁忌 / Hook'} state={!useCulturePack && !pack ? 'skipped' : stage === 'culture' ? 'active' : pack ? 'done' : stage === 'error' && cultureJobId ? 'error' : 'idle'} />
              <PipelineStep index="3" title="本土化剧本" detail={storyJob ? `${STATUS_LABELS[storyJob.status]} · ${elapsed(storyJob)}` : `${episodeCount} 集 · ${useCulturePack ? '文化包注入' : '地域需求直注'}`} state={stage === 'story' ? 'active' : storyPlan ? 'done' : stage === 'error' ? 'error' : 'idle'} />
            </ol>

            {latestJob && <dl className="regional-job-meta">
              <div><dt>Job</dt><dd>{latestJob.jobId}</dd></div>
              <div><dt>Provider</dt><dd>{latestJob.provider}</dd></div>
              <div><dt>Model</dt><dd>{latestJob.model}</dd></div>
              <div><dt>Mode</dt><dd><span className={`regional-mode ${latestJob.mode}`}>{latestJob.mode.toUpperCase()}</span></dd></div>
              <div><dt>耗时</dt><dd>{elapsed(latestJob)}</dd></div>
              <div><dt>估算成本</dt><dd>¥{(latestJob.actualCostCny ?? latestJob.estimatedCostCny ?? 0).toFixed(4)}</dd></div>
            </dl>}

            {!latestJob && <div className="regional-progress-empty"><span>○</span><p>提交后在这里查看真实 Job、Provider、模型和耗时。</p></div>}
          </div>
        </aside>
      </div>

      {(error || warning) && <div className={error ? 'regional-alert error' : 'regional-alert'} role={error ? 'alert' : 'status'}>
        <strong>{error ? '生成未完成' : '运行提示'}</strong><span>{error ?? warning}</span>
        {error && <button type="button" onClick={() => void (pack && cultureJobId && useCulturePack ? retryStoryPlan() : useCulturePack ? runCulturePipeline() : runDirectStoryPlan())}>
          {pack && cultureJobId && useCulturePack ? '仅重试剧本' : '重试脚本'}
        </button>}
      </div>}

      {(pack || storyPlan) && <section className="regional-results" aria-live="polite">
        <div className="regional-results-head">
          <div><span>03</span><div><h2>本土化结果</h2><p>{pack?.regionLabel ?? REGION_OPTIONS.find((item) => item.id === region)?.label} · 可审计的本土化剧本产物</p></div></div>
          <div className="regional-result-actions">
            {pack && cultureJobId && useCulturePack && !storyPlan && !busy && (
              <button type="button" onClick={() => void retryStoryPlan()}>基于此文化包生成剧本</button>
            )}
            <button type="button" onClick={() => void copyResult()}>{copied ? '已复制' : '复制 JSON'}</button>
            <button type="button" onClick={downloadResult}>下载结果</button>
          </div>
        </div>
        <div className="regional-tabs" role="tablist" aria-label="本土化结果类型">
          <button type="button" role="tab" aria-selected={tab === 'culture'} disabled={!pack} className={tab === 'culture' ? 'active' : ''} onClick={() => setTab('culture')}>地域文化包</button>
          <button type="button" role="tab" aria-selected={tab === 'story'} disabled={!storyPlan} className={tab === 'story' ? 'active' : ''} onClick={() => setTab('story')}>本土化剧本</button>
          <button type="button" role="tab" aria-selected={tab === 'json'} className={tab === 'json' ? 'active' : ''} onClick={() => setTab('json')}>原始 JSON</button>
        </div>

        {tab === 'culture' && pack && <CulturePackResult pack={pack} />}
        {tab === 'story' && storyPlan && <StoryPlanResult plan={storyPlan} onOpenStoryPlan={onOpenStoryPlan} />}
        {tab === 'json' && <pre className="regional-json"><code>{resultJson}</code></pre>}
      </section>}
    </div>
  );
}

function PipelineStep({ index, title, detail, state }: { index: string; title: string; detail: string; state: 'idle' | 'active' | 'done' | 'error' | 'skipped' }) {
  return <li className={state}>
    <span>{state === 'done' ? '✓' : state === 'error' ? '!' : index}</span>
    <div><strong>{title}</strong><small>{detail}</small></div>
  </li>;
}

function TagList({ items, empty = '无额外项' }: { items: string[]; empty?: string }) {
  return <div className="regional-tags">{items.length ? items.map((item) => <span key={item}>{item}</span>) : <small>{empty}</small>}</div>;
}

function CulturePackResult({ pack }: { pack: RegionalCulturePack }) {
  return <div className="regional-culture-result">
    <section className="regional-result-card wide accent">
      <span>LOCALIZED BRIEF</span><h3>本土化创作简报</h3><p>{pack.localizedBrief}</p>
    </section>
    <section className="regional-result-card wide">
      <span>AUDIENCE</span><h3>受众画像</h3><p>{pack.audienceProfile}</p>
    </section>
    <section className="regional-result-card"><span>THEMES</span><h3>主题偏好</h3><TagList items={pack.themes} /></section>
    <section className="regional-result-card"><span>VALUES</span><h3>精神价值</h3><TagList items={pack.spiritValues} /></section>
    <section className="regional-result-card"><span>TABOOS</span><h3>文化禁忌</h3><TagList items={pack.taboos} /></section>
    <section className="regional-result-card"><span>HOOKS</span><h3>Hook 结构</h3><TagList items={pack.hookStructures} /></section>
    <section className="regional-result-card wide"><span>VISUAL MOTIFS</span><h3>视觉母题</h3><TagList items={pack.visualMotifs} /></section>
    <section className="regional-result-card wide">
      <span>REFERENCE CASES</span><h3>参考案例</h3>
      <div className="regional-case-list">{pack.referenceCases.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.whyItWorks}</p></article>)}</div>
    </section>
  </div>;
}

function StoryPlanResult({ plan, onOpenStoryPlan }: { plan: CreativeStoryPlan; onOpenStoryPlan(): void }) {
  return <div className="regional-story-result">
    <section className="regional-story-summary">
      <div><span>STORY PLAN</span><h3>{plan.title}</h3><p>{plan.logline}</p></div>
      <dl><div><dt>剧集</dt><dd>{plan.episodes.length}</dd></div><div><dt>角色</dt><dd>{plan.characters.length}</dd></div><div><dt>场景</dt><dd>{plan.scenes.length}</dd></div><div><dt>道具</dt><dd>{plan.props.length}</dd></div></dl>
    </section>
    <div className="regional-episode-list">
      {plan.episodes.map((episode, index) => <article key={`${index}-${episode.title}`}>
        <span>EP {String(index + 1).padStart(2, '0')}</span>
        <div><h3>{episode.title}</h3><p>{episode.synopsis}</p><small>{episode.durationSec} 秒 · {episode.characterNames.join(' / ') || '角色待定'}</small></div>
        <details><summary>查看剧本正文</summary><pre>{episode.scriptContent}</pre></details>
      </article>)}
    </div>
    <div className="regional-story-foot">
      <p>当前结果是 Job artifact，尚未写入项目；如需编辑或原子写入，请进入故事规划页。</p>
      <button type="button" onClick={onOpenStoryPlan}>进入故事规划 <span aria-hidden="true">→</span></button>
    </div>
  </div>;
}
