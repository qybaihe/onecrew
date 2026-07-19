import { useState, type FormEvent } from 'react';
import type { CreativeStoryPlan, JobStatus, ProviderMode } from '@onecrew/contracts';
import {
  applyCreativeStoryPlan,
  getCreativeProject,
  getCreativeStoryPlan,
  submitCreativeStoryPlan,
} from './creative-api.js';
import type { WorkbenchData } from './OneCrewWorkbench.js';

type StoryPlanStatus = 'idle' | 'submitting' | 'applying' | 'applied' | JobStatus;

const STATUS_LABELS: Record<StoryPlanStatus, string> = {
  idle: '等待创作简报',
  submitting: '正在提交',
  queued: '已排队',
  running: '正在生成故事结构',
  waiting_human: '等待审批',
  succeeded: '规划已生成',
  failed: '生成失败',
  cancelled: '已取消',
  applying: '正在写入工程',
  applied: '已写入工程',
};

export function StoryPlanStep({ data }: { data: WorkbenchData }) {
  const [brief, setBrief] = useState(() => data.project?.bundle.project.synopsis ?? '');
  const [episodeCount, setEpisodeCount] = useState(3);
  const [status, setStatus] = useState<StoryPlanStatus>('idle');
  const [jobId, setJobId] = useState('');
  const [mode, setMode] = useState<ProviderMode | undefined>();
  const [provider, setProvider] = useState('');
  const [plan, setPlan] = useState<CreativeStoryPlan>();
  const [error, setError] = useState('');
  const [projectVersion, setProjectVersion] = useState<number>();

  const busy = ['submitting', 'queued', 'running', 'waiting_human', 'applying'].includes(status);

  const followPlan = async (projectId: string, jId: string) => {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const current = await getCreativeStoryPlan(projectId, jId);
      setStatus(current.job.status);
      setJobId(current.job.jobId);
      setMode(current.job.mode);
      setProvider(current.job.provider ?? '');
      if (current.plan) setPlan(current.plan);
      if (current.job.status === 'succeeded' || current.job.status === 'waiting_human') return;
      if (current.job.status === 'failed' || current.job.status === 'cancelled') {
        throw new Error(current.job.errorMessage ?? '故事规划失败');
      }
      await new Promise((r) => window.setTimeout(r, 750));
    }
    throw new Error('规划仍在运行，可稍后刷新。');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!data.selectedProjectId || !brief.trim()) return;
    const projectId = data.selectedProjectId;
    setError('');
    setStatus('submitting');
    setPlan(undefined);
    try {
      const accepted = await submitCreativeStoryPlan(projectId, brief.trim(), episodeCount);
      setStatus(accepted.status);
      setJobId(accepted.job_id);
      setMode(accepted.mode);
      setProvider(accepted.provider ?? '');
      if (accepted.status !== 'waiting_human') await followPlan(projectId, accepted.job_id);
    } catch (reason) {
      setStatus('failed');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleApply = async () => {
    if (!data.project || !data.selectedProjectId || !jobId || !plan) return;
    const projectId = data.selectedProjectId;
    setError('');
    setStatus('applying');
    try {
      const result = await applyCreativeStoryPlan(projectId, jobId, data.project.versions.project);
      setProjectVersion(result.applied.projectVersion);
      setStatus('applied');
      await data.refresh(projectId);
      // Refresh project data
      const refreshed = await getCreativeProject(projectId);
      // data.refresh handles state update
      void refreshed;
    } catch (reason) {
      setStatus(plan ? 'succeeded' : 'failed');
      setError(`${reason instanceof Error ? reason.message : String(reason)}`);
    }
  };

  return (
    <div className="oc-card">
      <div className="oc-card-header">
        <h2>故事规划</h2>
        <span className="subtitle">
          <span className={`oc-chip ${status === 'succeeded' || status === 'applied' ? 'ok' : busy ? 'run' : status === 'failed' ? 'fail' : 'plain'}`}>
            {STATUS_LABELS[status]}
          </span>
        </span>
      </div>
      <div className="oc-card-body">
        {error && <div className="oc-alert" style={{ margin: '0 0 14px' }}><span>{error}</span></div>}

        <form className="oc-form-group" onSubmit={(e) => void handleSubmit(e)}>
          <div className="oc-field">
            <span>创作简报</span>
            <textarea
              required rows={3} minLength={1} maxLength={20_000}
              placeholder="例如：围绕星门的新坐标续写三集，每集都有明确目标、转折与集尾钩子。"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="oc-field" style={{ width: 100 }}>
              <span>新增集数</span>
              <input
                type="number" min={1} max={12} value={episodeCount}
                onChange={(e) => setEpisodeCount(Math.min(12, Math.max(1, Number(e.target.value))))}
              />
            </div>
            <button className="oc-btn primary" type="submit" disabled={!data.selectedProjectId || !brief.trim() || busy} style={{ marginTop: 18 }}>
              {['submitting', 'queued', 'running'].includes(status) ? '正在生成…' : '生成规划预览'}
            </button>
            {status === 'waiting_human' && (
              <button className="oc-btn" type="button" style={{ marginTop: 18 }} onClick={() => { if (data.selectedProjectId && jobId) void followPlan(data.selectedProjectId, jobId).catch((r) => setError(String(r))); }}>
                审批后刷新
              </button>
            )}
          </div>
        </form>

        {plan && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--oc-border-light)', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <h3 style={{ fontSize: 15 }}>{plan.title}</h3>
                <p style={{ fontSize: 12, color: 'var(--oc-fg-secondary)', marginTop: 4 }}>{plan.logline}</p>
              </div>
              <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--oc-fg-muted)' }}>
                <span>{plan.episodes.length} 集</span>
                <span>{plan.characters.length} 角色</span>
                <span>{plan.scenes.length} 场景</span>
                <span>{plan.props.length} 道具</span>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
              {plan.episodes.map((ep, i) => (
                <div key={`${ep.title}-${i}`} style={{ padding: '10px 14px', border: '1px solid var(--oc-border-light)', borderRadius: 'var(--oc-radius-sm)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--oc-accent)' }}>EP{String(i + 1).padStart(2, '0')}</span>
                    <strong style={{ fontSize: 12 }}>{ep.title}</strong>
                    <span style={{ fontSize: 10, color: 'var(--oc-fg-muted)', marginLeft: 'auto' }}>{ep.durationSec}s</span>
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--oc-fg-secondary)', marginTop: 4 }}>{ep.synopsis}</p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button className="oc-btn primary" type="button" disabled={status !== 'succeeded'} onClick={() => void handleApply()}>
                {status === 'applying' ? '写入中…' : status === 'applied' ? `已写入 v${projectVersion ?? ''}` : '写入可编辑工程'}
              </button>
              <small style={{ fontSize: 10, color: 'var(--oc-fg-muted)' }}>
                {mode ? `${mode.toUpperCase()} · ` : ''}{provider || '结构化生成'}{jobId ? ` · ${jobId}` : ''}
              </small>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
