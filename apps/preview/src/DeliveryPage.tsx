import { lazy, Suspense, useState } from 'react';
import type { JobRecord } from '@onecrew/contracts';
import type { WorkbenchRoute } from './workbench-model.js';
import type { WorkbenchData } from './OneCrewWorkbench.js';
import { navigateTo } from './workbench-model.js';

const ReviewApp = lazy(async () => ({ default: (await import('./ReviewApp.js')).ReviewApp }));

type DeliveryTab = 'review' | 'renders' | 'localization' | 'release' | 'experiments' | 'tasks';

const TABS: Array<{ id: DeliveryTab; label: string }> = [
  { id: 'review', label: '审片' },
  { id: 'renders', label: '渲染' },
  { id: 'tasks', label: '任务' },
  { id: 'localization', label: '本地化' },
  { id: 'release', label: '发布' },
  { id: 'experiments', label: '实验' },
];

const jobStatusLabels: Record<JobRecord['status'], string> = {
  queued: '排队中', running: '运行中', waiting_human: '待复核',
  succeeded: '已完成', failed: '失败', cancelled: '已取消',
};
const capabilityLabels: Record<JobRecord['capability'], string> = {
  plan: '故事规划', design_compile: '设计编译', image: '图片', video: '视频',
  tts: '配音', lipsync: '口型', qc: '质检', remotion_preview: '预览渲染',
  remotion_final: '正式渲染', publish: '发布',
};

function money(v = 0): string {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(v);
}
function dateTime(v?: string): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(v));
}
function statusTone(s: string): string {
  if (['succeeded', 'approved', 'done', 'up'].includes(s)) return 'ok';
  if (['running', 'queued'].includes(s)) return 'run';
  if (['waiting_human', 'waiting'].includes(s)) return 'wait';
  if (['failed', 'down'].includes(s)) return 'fail';
  return 'plain';
}

function tabFromRoute(route: WorkbenchRoute): DeliveryTab {
  if (route === 'review' || route === 'review-compare') return 'review';
  if (route === 'renders' || route === 'render-detail' || route === 'promo') return 'renders';
  if (route === 'localization' || route === 'locale-detail') return 'localization';
  if (route === 'release' || route === 'releases') return 'release';
  if (route === 'experiments' || route === 'experiment-detail') return 'experiments';
  if (route === 'jobs' || route === 'job-batch' || route === 'qc' || route === 'qc-detail') return 'tasks';
  return 'review';
}

export function DeliveryPage({ data, route, initialTab }: { data: WorkbenchData; route?: WorkbenchRoute; initialTab?: DeliveryTab }) {
  const [tab, setTab] = useState<DeliveryTab>(initialTab ?? (route ? tabFromRoute(route) : 'review'));

  return (
    <>
      <div className="oc-page-header">
        <h1>交付中心</h1>
        <p>审片、渲染、任务、本地化、发布与实验。</p>
      </div>

      <div className="oc-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'oc-tab active' : 'oc-tab'} type="button" onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'review' && (
        <Suspense fallback={<div className="oc-empty"><div className="oc-spinner" /><h3>加载审片</h3></div>}>
          <div style={{ minHeight: 500 }}>
            <ReviewApp onOpenStudio={() => navigateTo('production')} />
          </div>
        </Suspense>
      )}
      {tab === 'renders' && <RendersPanel data={data} />}
      {tab === 'tasks' && <TasksPanel data={data} />}
      {tab === 'localization' && <LocalizationPanel data={data} />}
      {tab === 'release' && <ReleasePanel data={data} />}
      {tab === 'experiments' && <ExperimentsPanel data={data} />}
    </>
  );
}

function RendersPanel({ data }: { data: WorkbenchData }) {
  const renders = data.snapshot?.renders.map((i) => i.value) ?? [];
  if (renders.length === 0) return <div className="oc-empty"><h3>暂无渲染记录</h3><p>提交 Remotion 渲染任务后显示。</p></div>;
  return (
    <div className="oc-asset-grid">
      {renders.map((r) => (
        <div key={r.renderId} className="oc-card"><div className="oc-card-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span className={`oc-chip ${statusTone(r.status)}`}>{r.status}</span>
            <span className="mono" style={{ fontSize: 10, color: 'var(--oc-fg-muted)' }}>{r.manifest.compositionId}</span>
          </div>
          <strong style={{ fontSize: 13 }}>{r.manifest.localePack.title}</strong>
          <p style={{ fontSize: 11, color: 'var(--oc-fg-secondary)', marginTop: 4 }}>{r.manifest.output.width}×{r.manifest.output.height} · {r.manifest.fps} FPS · {r.manifest.locale}</p>
          <small style={{ fontSize: 10, color: 'var(--oc-fg-muted)' }}>{r.renderMode} · {dateTime(r.updatedAt)}</small>
        </div></div>
      ))}
    </div>
  );
}

function TasksPanel({ data }: { data: WorkbenchData }) {
  const jobs = data.snapshot?.jobs.map((i) => i.value) ?? [];
  const batches = data.snapshot?.batches.map((i) => i.value) ?? [];
  const qcRuns = data.snapshot?.qcRuns.map((i) => i.value) ?? [];
  const spent = jobs.reduce((s, j) => s + (j.actualCostCny ?? j.estimatedCostCny ?? 0), 0);

  return (
    <>
      <div className="oc-stats">
        <div className="oc-stat"><div className="oc-stat-label">运行中</div><div className="oc-stat-value">{jobs.filter((j) => ['queued', 'running'].includes(j.status)).length}</div></div>
        <div className="oc-stat"><div className="oc-stat-label">待复核</div><div className="oc-stat-value">{jobs.filter((j) => j.status === 'waiting_human').length}</div><div className="oc-stat-detail accent">飞书审批</div></div>
        <div className="oc-stat"><div className="oc-stat-label">QC 质检</div><div className="oc-stat-value">{qcRuns.length}</div><div className="oc-stat-detail">{qcRuns.filter((r) => r.status === 'waiting_human').length} 待人工</div></div>
        <div className="oc-stat"><div className="oc-stat-label">累计消耗</div><div className="oc-stat-value" style={{ fontSize: 18 }}>{money(spent)}</div></div>
      </div>

      {batches.length > 0 && (
        <div className="oc-card" style={{ marginBottom: 16 }}>
          <div className="oc-card-header"><h2>批量任务</h2><span className="subtitle">{batches.length} 个批次</span></div>
          <div className="oc-card-body" style={{ display: 'grid', gap: 10 }}>
            {batches.slice(0, 5).map((b) => (
              <div key={b.batchId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid var(--oc-border-light)', borderRadius: 'var(--oc-radius-sm)' }}>
                <span className={`oc-chip ${statusTone(b.status)}`}>{b.status}</span>
                <span style={{ fontSize: 11, flex: 1 }}>{b.kind === 'image' ? '图片' : '视频'} · {b.items.length} 项</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--oc-fg-muted)' }}>成功 {b.items.filter((i) => i.status === 'succeeded').length}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="oc-card">
        <div className="oc-card-header"><h2>全部任务</h2><span className="subtitle">{jobs.length} 条</span></div>
        <div className="oc-card-body" style={{ padding: 0 }}>
          <div className="oc-table-wrap">
            <table className="oc-table">
              <thead><tr><th>任务</th><th>能力</th><th>Provider</th><th>成本</th><th>状态</th></tr></thead>
              <tbody>
                {jobs.slice(0, 20).map((job) => (
                  <tr key={job.jobId}>
                    <td><strong>{job.jobId}</strong><small>{dateTime(job.updatedAt)}</small></td>
                    <td>{capabilityLabels[job.capability]}</td>
                    <td>{job.provider}</td>
                    <td className="mono">{money(job.actualCostCny ?? job.estimatedCostCny)}</td>
                    <td><span className={`oc-chip ${statusTone(job.status)}`}>{jobStatusLabels[job.status]}</span></td>
                  </tr>
                ))}
                {jobs.length === 0 && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--oc-fg-muted)' }}>暂无任务</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

function LocalizationPanel({ data }: { data: WorkbenchData }) {
  const runs = data.snapshot?.localizations.map((i) => i.value) ?? [];
  if (runs.length === 0) return <div className="oc-empty"><h3>暂无本地化任务</h3><p>完成中文母版后提交 en-US 本地化。</p></div>;
  return (
    <div className="oc-card"><div className="oc-card-body" style={{ padding: 0 }}>
      <div className="oc-table-wrap"><table className="oc-table">
        <thead><tr><th>任务</th><th>目标语言</th><th>TTS</th><th>Locale Pack</th><th>状态</th></tr></thead>
        <tbody>{runs.map((r) => (
          <tr key={r.localizationRunId}>
            <td><strong>{r.localizationRunId}</strong><small>{dateTime(r.updatedAt)}</small></td>
            <td>{r.request.targetLocale}</td>
            <td>{r.ttsJobIds.length}</td>
            <td className="mono">{r.localePackId ?? '—'}</td>
            <td><span className={`oc-chip ${statusTone(r.status)}`}>{r.status}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div></div>
  );
}

function ReleasePanel({ data }: { data: WorkbenchData }) {
  const publishes = data.snapshot?.publishes.map((i) => i.value) ?? [];
  if (publishes.length === 0) return <div className="oc-empty"><h3>暂无发布包</h3><p>完成渲染与 QC 后构建交付包。</p></div>;
  return (
    <div className="oc-card"><div className="oc-card-body" style={{ padding: 0 }}>
      <div className="oc-table-wrap"><table className="oc-table">
        <thead><tr><th>发布包</th><th>剧集</th><th>大小</th><th>实验</th><th>状态</th></tr></thead>
        <tbody>{publishes.map((p) => (
          <tr key={p.publishId}>
            <td><strong>{p.publishId}</strong></td>
            <td>{p.request.episode}</td>
            <td className="mono">{p.packageBytes ? `${(p.packageBytes / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
            <td>{p.experimentIds.length}</td>
            <td><span className={`oc-chip ${statusTone(p.status)}`}>{p.status}</span></td>
          </tr>
        ))}</tbody>
      </table></div>
    </div></div>
  );
}

function ExperimentsPanel({ data }: { data: WorkbenchData }) {
  if (data.experiments.length === 0) return <div className="oc-empty"><h3>暂无实验数据</h3><p>发布包生成实验种子后显示。</p></div>;
  return (
    <div className="oc-card"><div className="oc-card-body" style={{ padding: 0 }}>
      <div className="oc-table-wrap"><table className="oc-table">
        <thead><tr><th>实验</th><th>平台</th><th>Hook</th><th>消耗</th><th>CTR</th><th>ROAS</th></tr></thead>
        <tbody>{data.experiments.map((e) => (
          <tr key={e.experimentId}>
            <td><strong>{e.experimentId}</strong><small>{e.episode}</small></td>
            <td>{e.platform}</td>
            <td>{e.hook}</td>
            <td className="mono">{money(e.spend)}</td>
            <td>{(e.ctr * 100).toFixed(1)}%</td>
            <td>{e.roas.toFixed(2)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div></div>
  );
}
