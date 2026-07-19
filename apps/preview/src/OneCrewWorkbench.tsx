import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { JobRecord, ProjectSpec } from '@onecrew/contracts';

import {
  downloadCreativeProject,
  getCreativeProject,
  importCreativeArchive,
  listCreativeProjects,
  type CreativeProjectResponse,
} from './creative-api.js';
import {
  getInfrastructureSnapshot,
  getWorkbenchSnapshot,
  listProjectExperiments,
  type InfrastructureSnapshot,
  type WorkbenchSnapshot,
} from './workbench-api.js';
import {
  navigateTo,
  PRIMARY_NAVIGATION,
  routeFromHash,
  routeLabel,
  sectionForRoute,
  type PrimarySection,
  type WorkbenchRoute,
} from './workbench-model.js';
import type { ExperimentRecord } from '@onecrew/contracts';

const PlanningPage = lazy(async () => ({ default: (await import('./PlanningPage.js')).PlanningPage }));
const ProductionPage = lazy(async () => ({ default: (await import('./ProductionPage.js')).ProductionPage }));
const AssetsHubPage = lazy(async () => ({ default: (await import('./AssetsHubPage.js')).AssetsHubPage }));
const DeliveryPage = lazy(async () => ({ default: (await import('./DeliveryPage.js')).DeliveryPage }));

export interface WorkbenchData {
  projects: ProjectSpec[];
  selectedProjectId: string | undefined;
  project: CreativeProjectResponse | undefined;
  snapshot: WorkbenchSnapshot | undefined;
  infrastructure: InfrastructureSnapshot | undefined;
  experiments: ExperimentRecord[];
  loading: boolean;
  error: string | undefined;
  refresh(preferredProjectId?: string): Promise<void>;
  selectProject(projectId: string): void;
}

const jobStatusLabels: Record<JobRecord['status'], string> = {
  queued: '排队中',
  running: '运行中',
  waiting_human: '待复核',
  succeeded: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

const capabilityLabels: Record<JobRecord['capability'], string> = {
  plan: '故事规划',
  design_compile: '设计编译',
  image: '图片',
  video: '视频',
  tts: '配音',
  lipsync: '口型',
  qc: '质检',
  remotion_preview: '预览渲染',
  remotion_final: '正式渲染',
  publish: '发布',
};

function money(value = 0): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
}

function dateTime(value?: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

function statusTone(status: string): string {
  if (['succeeded', 'approved', 'done', 'ready', 'up', 'resolved', 'accepted'].includes(status)) return 'ok';
  if (['running', 'queued', 'building', 'generating'].includes(status)) return 'run';
  if (['waiting_human', 'waiting', 'planning'].includes(status)) return 'wait';
  if (['failed', 'rejected', 'down'].includes(status)) return 'fail';
  return 'plain';
}

function StatusChip({ status, label }: { status: string; label?: string }) {
  return <span className={`oc-chip ${statusTone(status)}`}>{label ?? status}</span>;
}

function projectPriority(project: ProjectSpec): number {
  if (project.projectId === 'prj_shanhai_demo') return 0;
  if (/OneCrew|山海|真实全链路/i.test(`${project.nameZh} ${project.nameEn}`)) return 1;
  if (/测试|test|导入/i.test(`${project.nameZh} ${project.nameEn}`)) return 3;
  return 2;
}

function preferredProject(projects: ProjectSpec[]): ProjectSpec | undefined {
  return [...projects].sort((l, r) => projectPriority(l) - projectPriority(r))[0];
}

function LoadingFallback() {
  return <div className="oc-empty"><div className="oc-spinner" /><h3>正在加载</h3><p>OneCrew 正在读取模块数据。</p></div>;
}

const NAV_ICONS: Record<string, ReactNode> = {
  grid: <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1" y="1" width="7" height="7" rx="1.5"/><rect x="10" y="1" width="7" height="7" rx="1.5"/><rect x="1" y="10" width="7" height="7" rx="1.5"/><rect x="10" y="10" width="7" height="7" rx="1.5"/></svg>,
  compass: <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="9" cy="9" r="7.5"/><path d="M12 6l-2.5 3.5L6 12l2.5-3.5z"/></svg>,
  film: <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="3" width="15" height="12" rx="2"/><path d="M1.5 7h15M1.5 11h15M6 3v12M12 3v12"/></svg>,
  layers: <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M9 2L2 6l7 4 7-4-7-4z"/><path d="M2 9.5L9 13.5l7-4"/><path d="M2 13L9 17l7-4"/></svg>,
  send: <svg viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M16 2L8 10M16 2l-5 14-3-6-6-3 14-5z"/></svg>,
};

export function OneCrewWorkbench() {
  const [route, setRoute] = useState<WorkbenchRoute>(() => routeFromHash(window.location.hash));
  const [projects, setProjects] = useState<ProjectSpec[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(() => {
    const explicit = window.localStorage.getItem('onecrew.projectSelectionExplicit') === '1';
    return explicit ? window.localStorage.getItem('onecrew.selectedProjectId') ?? undefined : undefined;
  });
  const [project, setProject] = useState<CreativeProjectResponse>();
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot>();
  const [infrastructure, setInfrastructure] = useState<InfrastructureSnapshot>();
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [navOpen, setNavOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refreshSeq = useRef(0);

  const section = sectionForRoute(route);

  useEffect(() => {
    const onHash = () => { setRoute(routeFromHash(window.location.hash)); setNavOpen(false); };
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) navigateTo('dashboard');
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const refresh = useCallback(async (preferredProjectId?: string) => {
    const seq = ++refreshSeq.current;
    setLoading(true);
    setError(undefined);
    try {
      const nextProjects = await listCreativeProjects();
      const ordered = [...nextProjects].sort((l, r) => {
        const p = projectPriority(l) - projectPriority(r);
        return p || l.nameZh.localeCompare(r.nameZh, 'zh-CN');
      });
      const requested = preferredProjectId ?? selectedProjectId;
      const valid = nextProjects.some((i) => i.projectId === requested) ? requested : preferredProject(nextProjects)?.projectId;
      if (seq !== refreshSeq.current) return;
      setProjects(ordered);
      setSelectedProjectId(valid);
      if (valid) window.localStorage.setItem('onecrew.selectedProjectId', valid);

      const [nextProject, nextSnapshot, nextInfra, nextExperiments] = await Promise.all([
        valid ? getCreativeProject(valid) : Promise.resolve(undefined),
        getWorkbenchSnapshot(valid),
        getInfrastructureSnapshot().catch(() => undefined),
        valid ? listProjectExperiments(valid).catch(() => []) : Promise.resolve([]),
      ]);
      if (seq !== refreshSeq.current) return;
      setProject(nextProject);
      setSnapshot(nextSnapshot);
      setInfrastructure(nextInfra);
      setExperiments(nextExperiments);
    } catch (reason) {
      if (seq === refreshSeq.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => { document.title = `${routeLabel(route)} · OneCrew`; }, [route]);

  const selectProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    window.localStorage.setItem('onecrew.selectedProjectId', projectId);
    window.localStorage.setItem('onecrew.projectSelectionExplicit', '1');
  };

  const jobs = snapshot?.jobs.map((i) => i.value) ?? [];
  const activeJobCount = jobs.filter((j) => ['queued', 'running'].includes(j.status)).length;
  const reviewCount = (snapshot?.humanGates.filter((g) => g.status === 'waiting').length ?? 0)
    + (snapshot?.qcRuns.filter((i) => i.value.status === 'waiting_human').length ?? 0);

  const data: WorkbenchData = { projects, selectedProjectId, project, snapshot, infrastructure, experiments, loading, error, refresh, selectProject };

  return (
    <div className="oc-shell">
      <button className={navOpen ? 'oc-nav-mask open' : 'oc-nav-mask'} aria-label="关闭导航" onClick={() => setNavOpen(false)} />
      <aside className={navOpen ? 'oc-sidebar open' : 'oc-sidebar'}>
        <button className="oc-brand" type="button" onClick={() => navigateTo('dashboard')}>
          <span className="oc-brand-mark">OC</span>
          <span><strong>OneCrew</strong><small>AI WORKBENCH</small></span>
        </button>
        <nav className="oc-nav" aria-label="OneCrew 主导航">
          {PRIMARY_NAVIGATION.map((item) => {
            const badge = item.section === 'dashboard' ? activeJobCount + reviewCount : 0;
            return (
              <button
                key={item.section}
                className={section === item.section ? 'oc-nav-item active' : 'oc-nav-item'}
                type="button"
                onClick={() => navigateTo(item.section)}
                title={item.description}
              >
                <span className="oc-nav-icon">{NAV_ICONS[item.icon]}</span>
                <span>{item.label}</span>
                {badge > 0 && <span className="oc-nav-badge">{badge}</span>}
              </button>
            );
          })}
        </nav>
        <div className="oc-sidebar-footer">
          <span className={infrastructure?.status === 'ready' ? 'oc-status-dot up' : 'oc-status-dot down'} />
          <small>{infrastructure?.status === 'ready' ? '系统正常' : '状态待确认'}</small>
        </div>
      </aside>

      <div className="oc-main">
        <header className="oc-topbar">
          <button className="oc-nav-toggle" type="button" aria-label="打开导航" onClick={() => setNavOpen(true)}>☰</button>
          <span className="oc-topbar-title">{routeLabel(route)}</span>
          <div className="oc-topbar-spacer" />
          <select
            className="oc-project-select"
            aria-label="当前项目"
            value={selectedProjectId ?? ''}
            onChange={(e) => e.target.value && selectProject(e.target.value)}
          >
            {projects.length === 0 && <option value="">暂无项目</option>}
            {projects.map((p) => <option key={p.projectId} value={p.projectId}>{p.nameZh}</option>)}
          </select>
          <button className="oc-settings-btn" type="button" aria-label="设置" onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
          {settingsOpen && (
            <div className="oc-settings-menu">
              <button type="button" onClick={() => { setSettingsOpen(false); navigateTo('providers'); }}>Provider 状态</button>
              <button type="button" onClick={() => { setSettingsOpen(false); navigateTo('infra'); }}>基础设施</button>
              <button type="button" onClick={() => { setSettingsOpen(false); navigateTo('budget'); }}>预算与审批</button>
              <button type="button" onClick={() => { setSettingsOpen(false); navigateTo('audit'); }}>操作日志</button>
              <button type="button" onClick={() => { setSettingsOpen(false); navigateTo('project-transfer'); }}>工程导入导出</button>
            </div>
          )}
        </header>

        {error && <div className="oc-alert" role="alert"><strong>同步失败</strong><span>{error}</span><button type="button" onClick={() => void refresh()}>重试</button></div>}

        <main className={section === 'production' || route === 'review' ? 'oc-content full-width' : 'oc-content'}>
          <RouteContent section={section} route={route} data={data} />
        </main>
      </div>
    </div>
  );
}

function RouteContent({ section, route, data }: { section: PrimarySection; route: WorkbenchRoute; data: WorkbenchData }) {
  if (section === 'dashboard') {
    // Deep routes that map to dashboard section
    if (route === 'providers' || route === 'infra' || route === 'budget' || route === 'audit') {
      return <OperationsPage route={route} data={data} />;
    }
    if (route === 'project-transfer') {
      return <TransferRedirect data={data} />;
    }
    if (route === 'jobs' || route === 'job-batch') {
      return <Suspense fallback={<LoadingFallback />}><DeliveryPage data={data} initialTab="tasks" /></Suspense>;
    }
    return <DashboardPage data={data} />;
  }
  if (section === 'planning') {
    return <Suspense fallback={<LoadingFallback />}><PlanningPage data={data} route={route} /></Suspense>;
  }
  if (section === 'production') {
    return <Suspense fallback={<LoadingFallback />}><ProductionPage data={data} route={route} /></Suspense>;
  }
  if (section === 'assets') {
    return <Suspense fallback={<LoadingFallback />}><AssetsHubPage data={data} route={route} /></Suspense>;
  }
  if (section === 'delivery') {
    return <Suspense fallback={<LoadingFallback />}><DeliveryPage data={data} route={route} /></Suspense>;
  }
  return <DashboardPage data={data} />;
}

/* === Dashboard (Workbench Home) === */
function DashboardPage({ data }: { data: WorkbenchData }) {
  const bundle = data.project?.bundle;
  const jobs = data.snapshot?.jobs.map((i) => i.value) ?? [];
  const renders = data.snapshot?.renders.map((i) => i.value) ?? [];
  const currentJob = jobs.find((j) => ['running', 'queued', 'waiting_human'].includes(j.status));
  const failedJobs = jobs.filter((j) => j.status === 'failed').length;

  return (
    <>
      <div className="oc-page-header">
        <h1>{bundle?.project.nameZh ?? 'OneCrew 工作台'}</h1>
        <p>{bundle?.project.synopsis ?? 'AI 短剧出海制作工作台 — 策划、制作、资产与交付的统一入口。'}</p>
      </div>

      {currentJob && (
        <div className="oc-card" style={{ marginBottom: 18, borderColor: 'var(--oc-accent)' }}>
          <div className="oc-card-body" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' }}>
            <StatusChip status={currentJob.status} label={jobStatusLabels[currentJob.status]} />
            <div style={{ flex: 1 }}>
              <strong style={{ fontSize: 12 }}>{capabilityLabels[currentJob.capability]}任务</strong>
              <small style={{ display: 'block', color: 'var(--oc-fg-muted)', fontSize: 10 }}>{currentJob.jobId} · {currentJob.provider} · {currentJob.mode.toUpperCase()}</small>
            </div>
            <button className="oc-btn small" type="button" onClick={() => navigateTo('jobs')}>查看</button>
          </div>
        </div>
      )}

      <div className="oc-stats">
        <div className="oc-stat">
          <div className="oc-stat-label">剧集 / 分镜</div>
          <div className="oc-stat-value">{bundle?.episodes.length ?? 0}<span style={{ fontSize: 14, color: 'var(--oc-fg-muted)' }}> / {bundle?.shots.length ?? 0}</span></div>
          <div className="oc-stat-detail">{bundle?.entities.length ?? 0} 个设定实体</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">版本资产</div>
          <div className="oc-stat-value">{data.project?.assets.length ?? 0}</div>
          <div className="oc-stat-detail">{data.project?.assets.filter((a) => a.status === 'approved').length ?? 0} 个已通过</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">运行任务</div>
          <div className="oc-stat-value">{jobs.filter((j) => ['queued', 'running'].includes(j.status)).length}</div>
          <div className="oc-stat-detail accent">{jobs.filter((j) => j.status === 'waiting_human').length} 个待复核</div>
        </div>
        <div className="oc-stat">
          <div className="oc-stat-label">渲染交付</div>
          <div className="oc-stat-value">{renders.filter((r) => r.status === 'succeeded').length}</div>
          <div className="oc-stat-detail">{data.experiments.length} 条实验</div>
        </div>
      </div>

      <div className="oc-quick-grid">
        <button className="oc-quick-card" type="button" onClick={() => navigateTo('planning')}>
          <strong>策划</strong>
          <span>地域本土化 → 预算策略 → 故事规划</span>
        </button>
        <button className="oc-quick-card" type="button" onClick={() => navigateTo('production')}>
          <strong>制作</strong>
          <span>剧本编辑 → 分镜 → 生成</span>
        </button>
        <button className="oc-quick-card" type="button" onClick={() => navigateTo('assets')}>
          <strong>资产</strong>
          <span>{bundle?.entities.length ?? 0} 个角色/场景/道具</span>
        </button>
        <button className="oc-quick-card" type="button" onClick={() => navigateTo('delivery')}>
          <strong>交付</strong>
          <span>审片 → 渲染 → 发布</span>
        </button>
      </div>

      <div className="oc-split-2-1">
        <div className="oc-card">
          <div className="oc-card-header"><h2>最近任务</h2><span className="subtitle"><button className="oc-btn ghost small" type="button" onClick={() => navigateTo('jobs')}>全部</button></span></div>
          <div className="oc-card-body" style={{ padding: 0 }}>
            <div className="oc-table-wrap">
              <table className="oc-table">
                <thead><tr><th>任务</th><th>能力</th><th>Provider</th><th>成本</th><th>状态</th></tr></thead>
                <tbody>
                  {jobs.slice(0, 5).map((job) => (
                    <tr key={job.jobId}>
                      <td><strong>{job.jobId}</strong><small>{dateTime(job.updatedAt)}</small></td>
                      <td>{capabilityLabels[job.capability]}</td>
                      <td>{job.provider}</td>
                      <td className="mono">{money(job.actualCostCny ?? job.estimatedCostCny)}</td>
                      <td><StatusChip status={job.status} label={jobStatusLabels[job.status]} /></td>
                    </tr>
                  ))}
                  {jobs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--oc-fg-muted)' }}>暂无任务记录</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div>
          <div className="oc-card" style={{ marginBottom: 16 }}>
            <div className="oc-card-header"><h2>生产健康</h2></div>
            <div className="oc-card-body" style={{ display: 'grid', gap: 10 }}>
              <HealthRow label="Provider" ok={!jobs.some((j) => j.status === 'failed')} detail={`${failedJobs} 个失败`} />
              <HealthRow label="QC 质检" ok={!(data.snapshot?.qcRuns.some((r) => r.value.status === 'failed') ?? false)} detail={`${data.snapshot?.qcRuns.filter((r) => r.value.status === 'waiting_human').length ?? 0} 待人工`} />
              <HealthRow label="基础设施" ok={data.infrastructure?.status === 'ready'} detail={data.infrastructure?.status ?? '未连接'} />
            </div>
          </div>
          <div className="oc-card">
            <div className="oc-card-header"><h2>项目信息</h2></div>
            <div className="oc-card-body">
              <dl className="oc-dl">
                <dt>状态</dt><dd><StatusChip status={bundle?.project.status ?? 'draft'} /></dd>
                <dt>语言</dt><dd>{bundle?.project.locales.join(' / ') ?? '—'}</dd>
                <dt>预算</dt><dd className="mono">{money(bundle?.project.budgetLimitCny)}</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function HealthRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className={ok ? 'oc-status-dot up' : 'oc-status-dot down'} />
      <strong style={{ fontSize: 12, flex: 1 }}>{label}</strong>
      <small style={{ color: 'var(--oc-fg-muted)', fontSize: 10 }}>{detail}</small>
    </div>
  );
}

/* === Operations (deep route) === */
function OperationsPage({ route, data }: { route: WorkbenchRoute; data: WorkbenchData }) {
  const jobs = data.snapshot?.jobs.map((i) => i.value) ?? [];
  if (route === 'infra') {
    return <>
      <div className="oc-page-header"><h1>基础设施</h1><p>API、数据库、队列与存储健康状态。</p></div>
      <div className="oc-asset-grid">
        {Object.entries(data.infrastructure?.components ?? {}).map(([name, comp]) => (
          <div key={name} className="oc-card"><div className="oc-card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span className={comp.status === 'up' ? 'oc-status-dot up' : 'oc-status-dot down'} />
              <strong style={{ fontSize: 13 }}>{name}</strong>
              <StatusChip status={comp.status} />
            </div>
            {comp.latencyMs !== undefined && <small className="mono" style={{ color: 'var(--oc-fg-muted)' }}>{comp.latencyMs} ms</small>}
          </div></div>
        ))}
      </div>
      {!data.infrastructure && <div className="oc-empty"><h3>无法读取</h3><p>启动 API 后获取依赖探测结果。</p></div>}
    </>;
  }
  if (route === 'providers') {
    const providers = [...new Set(jobs.map((j) => j.provider))];
    return <>
      <div className="oc-page-header"><h1>Provider 状态</h1><p>模型、模式与任务表现统计。</p></div>
      <div className="oc-asset-grid">
        {providers.map((provider) => {
          const records = jobs.filter((j) => j.provider === provider);
          const failures = records.filter((j) => j.status === 'failed').length;
          return <div key={provider} className="oc-card"><div className="oc-card-body">
            <strong style={{ fontSize: 14 }}>{provider}</strong>
            <p style={{ fontSize: 11, color: 'var(--oc-fg-muted)', margin: '4px 0 12px' }}>{[...new Set(records.map((j) => j.model))].join(' · ')}</p>
            <dl className="oc-dl"><dt>任务</dt><dd>{records.length}</dd><dt>失败率</dt><dd>{records.length ? `${(failures / records.length * 100).toFixed(1)}%` : '0%'}</dd><dt>成本</dt><dd className="mono">{money(records.reduce((s, j) => s + (j.actualCostCny ?? j.estimatedCostCny ?? 0), 0))}</dd></dl>
          </div></div>;
        })}
      </div>
      {providers.length === 0 && <div className="oc-empty"><h3>暂无 Provider</h3><p>提交生成任务后显示统计。</p></div>}
    </>;
  }
  if (route === 'budget') {
    const gates = data.snapshot?.humanGates ?? [];
    const spent = jobs.reduce((s, j) => s + (j.actualCostCny ?? j.estimatedCostCny ?? 0), 0);
    const budgetLimit = data.project?.bundle.project.budgetLimitCny ?? 0;
    return <>
      <div className="oc-page-header"><h1>预算与审批</h1><p>任务消耗与飞书人工闸门。</p></div>
      <div className="oc-stats">
        <div className="oc-stat"><div className="oc-stat-label">预算上限</div><div className="oc-stat-value" style={{ fontSize: 20 }}>{money(budgetLimit)}</div></div>
        <div className="oc-stat"><div className="oc-stat-label">已消耗</div><div className="oc-stat-value" style={{ fontSize: 20 }}>{money(spent)}</div><div className="oc-stat-detail accent">{budgetLimit ? `${Math.min(100, spent / budgetLimit * 100).toFixed(1)}%` : '—'}</div></div>
        <div className="oc-stat"><div className="oc-stat-label">待审批</div><div className="oc-stat-value">{gates.filter((g) => g.status === 'waiting').length}</div></div>
        <div className="oc-stat"><div className="oc-stat-label">已处理</div><div className="oc-stat-value">{gates.filter((g) => g.status !== 'waiting').length}</div></div>
      </div>
      <div className="oc-card"><div className="oc-card-body" style={{ padding: 0 }}>
        <div className="oc-table-wrap"><table className="oc-table">
          <thead><tr><th>闸门</th><th>节点</th><th>对象</th><th>状态</th><th>时间</th></tr></thead>
          <tbody>{gates.map((g) => <tr key={g.gateId}><td className="mono">{g.gateId}</td><td>{g.node}</td><td>{g.targetType}</td><td><StatusChip status={g.status} /></td><td>{dateTime(g.createdAt)}</td></tr>)}</tbody>
        </table></div>
        {gates.length === 0 && <div className="oc-empty" style={{ border: 0 }}><h3>没有人工闸门</h3><p>需要人工处理时会出现。</p></div>}
      </div></div>
    </>;
  }
  // audit
  const audit = data.snapshot?.audit ?? [];
  return <>
    <div className="oc-page-header"><h1>操作日志</h1><p>关键操作可追溯记录。</p></div>
    <div className="oc-card"><div className="oc-card-body" style={{ padding: 0 }}>
      <div className="oc-table-wrap"><table className="oc-table">
        <thead><tr><th>时间</th><th>来源</th><th>动作</th><th>对象</th><th>结果</th></tr></thead>
        <tbody>{audit.map((a) => <tr key={a.auditId}><td>{dateTime(a.createdAt)}</td><td>{a.source}</td><td><strong>{a.action}</strong></td><td>{a.targetType ?? '—'}</td><td><StatusChip status={a.outcome} /></td></tr>)}</tbody>
      </table></div>
      {audit.length === 0 && <div className="oc-empty" style={{ border: 0 }}><h3>暂无审计事件</h3><p>关键写入会自动留痕。</p></div>}
    </div></div>
  </>;
}

/* === Transfer (deep route, simplified) === */
function TransferRedirect({ data }: { data: WorkbenchData }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setMsg(`正在导入 ${file.name}…`);
    try {
      const result = await importCreativeArchive(file);
      data.selectProject(result.imported.projectId);
      await data.refresh(result.imported.projectId);
      setMsg(`导入成功：${result.imported.episodes} 集 · ${result.imported.shots} 镜`);
    } catch (reason) {
      setMsg(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const handleExport = async () => {
    if (!data.selectedProjectId) return;
    setMsg('正在打包…');
    try {
      await downloadCreativeProject(data.selectedProjectId);
      setMsg('导出完成，下载已开始。');
    } catch (reason) {
      setMsg(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return <>
    <div className="oc-page-header"><h1>工程导入导出</h1><p>以 OneCrew 工程包迁移项目。</p></div>
    {msg && <div className="oc-card" style={{ marginBottom: 16 }}><div className="oc-card-body" style={{ fontSize: 12 }}>{msg}</div></div>}
    <div className="oc-split">
      <div className="oc-card"><div className="oc-card-header"><h2>导入工程</h2></div><div className="oc-card-body">
        <input ref={fileInput} className="visually-hidden" type="file" accept=".zip" onChange={(e) => void handleImport(e.target.files?.[0])} />
        <button className="oc-btn primary" type="button" onClick={() => fileInput.current?.click()}>选择 ZIP 文件</button>
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--oc-fg-muted)' }}>支持 .onecrew.zip 或兼容 .zip，最大 512 MB</p>
      </div></div>
      <div className="oc-card"><div className="oc-card-header"><h2>导出当前工程</h2></div><div className="oc-card-body">
        <button className="oc-btn" type="button" disabled={!data.selectedProjectId} onClick={() => void handleExport()}>导出 OneCrew 工程包</button>
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--oc-fg-muted)' }}>{data.project?.bundle.project.nameZh ?? '未选择项目'}</p>
      </div></div>
    </div>
  </>;
}
