import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { CreativeEntity, EpisodeSpec, ProjectSpec, ShotSpec } from '@onecrew/contracts';
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  downloadCreativeProject,
  getCreativeProject,
  importCreativeArchive,
  listCreativeProjects,
  updateCreativeEpisode,
  updateCreativeShot,
  type CreativeProjectResponse,
} from './creative-api.js';
import './studio.css';

type StudioView = 'storyboards' | 'canvas';
type SaveState = 'idle' | 'saving' | 'saved';

interface EpisodeDraft {
  title: string;
  description: string;
  scriptContent: string;
  durationSec: string;
}

interface ShotDraft {
  title: string;
  action: string;
  camera: string;
  dialogueZh: string;
  narrationZh: string;
  imagePrompt: string;
  videoPrompt: string;
  negativePrompt: string;
  durationSec: string;
  continuityNotes: string;
}

function episodeDraft(episode: EpisodeSpec | undefined): EpisodeDraft {
  return {
    title: episode?.title ?? '',
    description: episode?.description ?? '',
    scriptContent: episode?.scriptContent ?? '',
    durationSec: String(episode?.durationSec ?? 0),
  };
}

function shotDraft(shot: ShotSpec | undefined): ShotDraft {
  return {
    title: shot?.title ?? '',
    action: shot?.action ?? '',
    camera: shot?.camera ?? '',
    dialogueZh: shot?.dialogueZh ?? '',
    narrationZh: shot?.narrationZh ?? '',
    imagePrompt: shot?.imagePrompt ?? shot?.prompt ?? '',
    videoPrompt: shot?.videoPrompt ?? '',
    negativePrompt: shot?.negativePrompt ?? '',
    durationSec: String(shot?.durationSec ?? 1),
    continuityNotes: shot?.continuity?.notes ?? '',
  };
}

export interface StudioAppProps {
  onOpenReview(): void;
}

const entityLabels: Record<CreativeEntity['kind'], string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
};

function flowGraph(shots: ShotSpec[], selectedShotId: string | undefined): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = shots.map((shot, index) => ({
    id: shot.shotId,
    position: { x: index * 286, y: index % 2 === 0 ? 70 : 250 },
    className: shot.shotId === selectedShotId ? 'shot-flow-node selected' : 'shot-flow-node',
    data: {
      label: (
        <div className="flow-node-content">
          <span>SHOT {String(shot.sequence).padStart(3, '0')}</span>
          <strong>{shot.title?.trim() || shot.action}</strong>
          <small>{shot.durationSec}s · {shot.shotType ?? shot.camera}</small>
        </div>
      ),
    },
  }));
  const edges: Edge[] = shots.slice(1).map((shot, index) => ({
    id: `edge-${shots[index]!.shotId}-${shot.shotId}`,
    source: shots[index]!.shotId,
    target: shot.shotId,
    type: 'smoothstep',
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: 'var(--teal)', strokeWidth: 1.5 },
  }));
  return { nodes, edges };
}

export function StudioApp({ onOpenReview }: StudioAppProps) {
  const [projects, setProjects] = useState<ProjectSpec[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [project, setProject] = useState<CreativeProjectResponse>();
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>();
  const [selectedShotId, setSelectedShotId] = useState<string>();
  const [view, setView] = useState<StudioView>('storyboards');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [episodeSave, setEpisodeSave] = useState<SaveState>('idle');
  const [shotSave, setShotSave] = useState<SaveState>('idle');
  const [episodeForm, setEpisodeForm] = useState<EpisodeDraft>(() => episodeDraft(undefined));
  const [shotForm, setShotForm] = useState<ShotDraft>(() => shotDraft(undefined));
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const refreshProjects = async (preferredId?: string) => {
    const result = await listCreativeProjects();
    setProjects(result);
    setSelectedProjectId(preferredId ?? selectedProjectId ?? result[0]?.projectId);
  };

  useEffect(() => {
    void refreshProjects().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setProject(undefined);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(undefined);
    void getCreativeProject(selectedProjectId)
      .then((result) => {
        setProject(result);
        setSelectedEpisodeId(result.bundle.episodes[0]?.episodeId);
        setSelectedShotId(result.bundle.shots[0]?.shotId);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [selectedProjectId]);

  const bundle = project?.bundle;
  const episodes = bundle?.episodes ?? [];
  const entities = bundle?.entities ?? [];
  const episodeShots = useMemo(
    () => (bundle?.shots ?? []).filter((shot) => !selectedEpisodeId || shot.episodeId === selectedEpisodeId),
    [bundle, selectedEpisodeId],
  );
  const selectedShot = (bundle?.shots ?? []).find((shot) => shot.shotId === selectedShotId);
  const selectedEpisode = episodes.find((episode) => episode.episodeId === selectedEpisodeId);
  const graph = useMemo(() => flowGraph(episodeShots, selectedShotId), [episodeShots, selectedShotId]);

  useEffect(() => {
    setEpisodeForm(episodeDraft(selectedEpisode));
    setEpisodeSave('idle');
  }, [selectedProjectId, selectedEpisodeId]);

  useEffect(() => {
    setShotForm(shotDraft(selectedShot));
    setShotSave('idle');
  }, [selectedProjectId, selectedShotId]);

  const handleImport = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setError(undefined);
    try {
      const imported = await importCreativeArchive(file);
      await refreshProjects(imported.imported.projectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const handleExport = async () => {
    if (!selectedProjectId) return;
    setExporting(true);
    setError(undefined);
    try {
      await downloadCreativeProject(selectedProjectId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  };

  function changeEpisodeField<Field extends keyof EpisodeDraft>(field: Field, value: EpisodeDraft[Field]) {
    setEpisodeForm((draft) => ({ ...draft, [field]: value }));
    setEpisodeSave('idle');
  }

  function changeShotField<Field extends keyof ShotDraft>(field: Field, value: ShotDraft[Field]) {
    setShotForm((draft) => ({ ...draft, [field]: value }));
    setShotSave('idle');
  }

  const handleEpisodeSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !selectedEpisode) return;
    const expectedVersion = project.versions.episodes[selectedEpisode.episodeId];
    if (!expectedVersion) return setError('无法读取当前剧集版本，请刷新页面。');
    setEpisodeSave('saving');
    setError(undefined);
    try {
      const result = await updateCreativeEpisode(selectedEpisode.episodeId, expectedVersion, {
        title: episodeForm.title.trim(),
        description: episodeForm.description,
        scriptContent: episodeForm.scriptContent,
        durationSec: Number(episodeForm.durationSec),
      });
      setProject((current) => current ? {
        ...current,
        bundle: {
          ...current.bundle,
          episodes: current.bundle.episodes.map((episode) => episode.episodeId === result.record.episodeId ? result.record : episode),
        },
        versions: { ...current.versions, episodes: { ...current.versions.episodes, [result.record.episodeId]: result.version } },
      } : current);
      setEpisodeSave('saved');
    } catch (reason) {
      setEpisodeSave('idle');
      setError(`${reason instanceof Error ? reason.message : String(reason)}；已重新读取服务端版本。`);
      const latest = await getCreativeProject(selectedEpisode.projectId).catch(() => undefined);
      if (latest) {
        setProject(latest);
        setEpisodeForm(episodeDraft(latest.bundle.episodes.find((episode) => episode.episodeId === selectedEpisode.episodeId)));
      }
    }
  };

  const handleShotSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !selectedShot) return;
    const expectedVersion = project.versions.shots[selectedShot.shotId];
    if (!expectedVersion) return setError('无法读取当前分镜版本，请刷新页面。');
    const continuityBase = { ...(selectedShot.continuity ?? { characters: {} }) };
    delete continuityBase.notes;
    setShotSave('saving');
    setError(undefined);
    try {
      const result = await updateCreativeShot(selectedShot.shotId, expectedVersion, {
        title: shotForm.title,
        action: shotForm.action,
        camera: shotForm.camera,
        dialogueZh: shotForm.dialogueZh,
        narrationZh: shotForm.narrationZh,
        imagePrompt: shotForm.imagePrompt,
        videoPrompt: shotForm.videoPrompt,
        negativePrompt: shotForm.negativePrompt,
        durationSec: Number(shotForm.durationSec),
        continuity: {
          ...continuityBase,
          ...(shotForm.continuityNotes.trim() ? { notes: shotForm.continuityNotes } : {}),
        },
      });
      setProject((current) => current ? {
        ...current,
        bundle: {
          ...current.bundle,
          shots: current.bundle.shots.map((shot) => shot.shotId === result.record.shotId ? result.record : shot),
        },
        versions: { ...current.versions, shots: { ...current.versions.shots, [result.record.shotId]: result.version } },
      } : current);
      setShotSave('saved');
    } catch (reason) {
      setShotSave('idle');
      setError(`${reason instanceof Error ? reason.message : String(reason)}；已重新读取服务端版本。`);
      const latest = await getCreativeProject(selectedShot.projectId).catch(() => undefined);
      if (latest) {
        setProject(latest);
        setShotForm(shotDraft(latest.bundle.shots.find((shot) => shot.shotId === selectedShot.shotId)));
      }
    }
  };

  return (
    <div className="studio-shell">
      <header className="studio-topbar">
        <a className="brand" href="#studio" aria-label="OneCrew 创作台首页">
          <span className="brand-mark" aria-hidden="true">✦</span>
          <span><strong>ONECREW</strong><small>CREATIVE STUDIO</small></span>
        </a>
        <div className="studio-project-switcher">
          <label htmlFor="project-select">当前项目</label>
          <select
            id="project-select"
            value={selectedProjectId ?? ''}
            onChange={(event) => setSelectedProjectId(event.target.value || undefined)}
          >
            {projects.length === 0 && <option value="">暂无创作工程</option>}
            {projects.map((item) => <option key={item.projectId} value={item.projectId}>{item.nameZh}</option>)}
          </select>
        </div>
        <div className="studio-actions">
          <input
            ref={fileInput}
            className="visually-hidden"
            type="file"
            accept=".zip,application/zip"
            aria-label="选择创作工程 ZIP"
            onChange={(event) => void handleImport(event.target.files?.[0])}
          />
          <button className="studio-button primary" type="button" disabled={importing} onClick={() => fileInput.current?.click()}>
            {importing ? '正在导入…' : '导入工程 ZIP'}
          </button>
          <button
            className="studio-button export"
            type="button"
            disabled={!selectedProjectId || exporting}
            onClick={() => void handleExport()}
          >
            {exporting ? '正在打包…' : '导出 OneCrew 工程'}
          </button>
          <button className="studio-button ghost" type="button" onClick={onOpenReview}>打开审片</button>
        </div>
      </header>

      {error && <div className="studio-alert" role="alert"><strong>操作失败</strong><span>{error}</span></div>}

      <main className="studio-layout">
        <aside className="studio-sidebar" aria-label="剧集导航">
          <div className="studio-eyebrow">PROJECT / EPISODES</div>
          <h1>{bundle?.project.nameZh ?? '创作工程'}</h1>
          <p className="studio-synopsis">{bundle?.project.synopsis ?? '导入创作工程，或从 API 创建一个新的 OneCrew 创作项目。'}</p>

          <dl className="studio-stats">
            <div><dt>剧集</dt><dd>{episodes.length}</dd></div>
            <div><dt>分镜</dt><dd>{bundle?.shots.length ?? 0}</dd></div>
            <div><dt>素材</dt><dd>{entities.length}</dd></div>
            <div><dt>版本资产</dt><dd>{project?.assets.length ?? 0}</dd></div>
          </dl>

          <nav className="episode-nav" aria-label="剧集列表">
            {episodes.map((episode) => {
              const count = bundle?.shots.filter((shot) => shot.episodeId === episode.episodeId).length ?? 0;
              return (
                <button
                  key={episode.episodeId}
                  type="button"
                  className={selectedEpisodeId === episode.episodeId ? 'episode-item active' : 'episode-item'}
                  onClick={() => {
                    setSelectedEpisodeId(episode.episodeId);
                    setSelectedShotId(bundle?.shots.find((shot) => shot.episodeId === episode.episodeId)?.shotId);
                  }}
                >
                  <span>{String(episode.episodeNumber).padStart(2, '0')}</span>
                  <strong>{episode.title}</strong>
                  <small>{count} 镜</small>
                </button>
              );
            })}
          </nav>

          {selectedEpisode && (
            <form className="episode-editor" onSubmit={(event) => void handleEpisodeSave(event)}>
              <div className="editor-heading">
                <div><span>EPISODE SCRIPT</span><strong>剧本编辑</strong></div>
                <small>v{project?.versions.episodes[selectedEpisode.episodeId] ?? '—'}</small>
              </div>
              <label>
                <span>剧集标题</span>
                <input
                  required
                  maxLength={300}
                  value={episodeForm.title}
                  onChange={(event) => changeEpisodeField('title', event.target.value)}
                />
              </label>
              <label>
                <span>剧情概要</span>
                <textarea
                  rows={2}
                  maxLength={10_000}
                  value={episodeForm.description}
                  onChange={(event) => changeEpisodeField('description', event.target.value)}
                />
              </label>
              <label>
                <span>剧本正文</span>
                <textarea
                  className="script-textarea"
                  rows={8}
                  maxLength={200_000}
                  value={episodeForm.scriptContent}
                  onChange={(event) => changeEpisodeField('scriptContent', event.target.value)}
                />
              </label>
              <div className="editor-footer">
                <label>
                  <span>时长 /秒</span>
                  <input
                    type="number"
                    min="0"
                    max="7200"
                    step="0.1"
                    value={episodeForm.durationSec}
                    onChange={(event) => changeEpisodeField('durationSec', event.target.value)}
                  />
                </label>
                <button type="submit" disabled={episodeSave === 'saving'}>
                  {episodeSave === 'saving' ? '保存中…' : episodeSave === 'saved' ? '已保存 ✓' : '保存剧本'}
                </button>
              </div>
            </form>
          )}

          <div className="studio-boundary-note">
            <span aria-hidden="true">✓</span>
            <p><strong>创作边界</strong>这里只编辑内容与素材；审批、切换模型和转人工仍在飞书完成。</p>
          </div>
        </aside>

        <section className="studio-main" aria-busy={loading}>
          <div className="studio-main-header">
            <div>
              <div className="studio-eyebrow">CREATIVE PIPELINE</div>
              <h2>{episodes.find((episode) => episode.episodeId === selectedEpisodeId)?.title ?? '分镜工作区'}</h2>
            </div>
            <div className="view-tabs" role="tablist" aria-label="创作视图">
              <button type="button" role="tab" aria-selected={view === 'storyboards'} className={view === 'storyboards' ? 'active' : ''} onClick={() => setView('storyboards')}>分镜列表</button>
              <button type="button" role="tab" aria-selected={view === 'canvas'} className={view === 'canvas' ? 'active' : ''} onClick={() => setView('canvas')}>流程画布</button>
            </div>
          </div>

          {loading ? (
            <div className="studio-empty"><span className="studio-spinner" />正在读取创作工程…</div>
          ) : episodeShots.length === 0 ? (
            <div className="studio-empty">当前剧集还没有分镜。</div>
          ) : view === 'storyboards' ? (
            <div className="shot-list" role="list">
              {episodeShots.map((shot) => (
                <button
                  key={shot.shotId}
                  type="button"
                  role="listitem"
                  className={selectedShotId === shot.shotId ? 'shot-card selected' : 'shot-card'}
                  onClick={() => setSelectedShotId(shot.shotId)}
                >
                  <span className="shot-number">{String(shot.sequence).padStart(3, '0')}</span>
                  <span className="shot-copy">
                    <small>{shot.shotType ?? '镜头'} · {shot.durationSec}s</small>
                    <strong>{shot.title?.trim() || shot.action}</strong>
                    <span>{shot.camera}</span>
                  </span>
                  <span className={`shot-status ${shot.status}`}>{shot.status}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flow-canvas" role="tabpanel" aria-label="分镜流程画布">
              <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                fitView
                minZoom={0.35}
                maxZoom={1.5}
                onNodeClick={(_event, node) => setSelectedShotId(node.id)}
                proOptions={{ hideAttribution: false }}
              >
                <Background color="oklch(0.45 0.045 238 / 0.36)" gap={24} size={1} />
                <MiniMap
                  pannable
                  zoomable
                  bgColor="oklch(0.14 0.035 248)"
                  nodeColor="oklch(0.58 0.12 190)"
                  maskColor="oklch(0.12 0.03 250 / 0.72)"
                />
                <Controls showInteractive={false} />
              </ReactFlow>
            </div>
          )}

          {selectedShot && (
            <form className="shot-inspector" aria-label="当前分镜编辑" onSubmit={(event) => void handleShotSave(event)}>
              <div className="inspector-heading">
                <div>
                  <span>SHOT {String(selectedShot.sequence).padStart(3, '0')} / EDITOR</span>
                  <h3>分镜参数</h3>
                </div>
                <small>v{project?.versions.shots[selectedShot.shotId] ?? '—'} · {selectedShot.referenceAssetIds.length} 个参考资产</small>
              </div>
              <div className="inspector-grid">
                <label>
                  <span>分镜标题</span>
                  <input value={shotForm.title} maxLength={500} onChange={(event) => changeShotField('title', event.target.value)} />
                </label>
                <label>
                  <span>时长 /秒</span>
                  <input type="number" min="0.1" max="120" step="0.1" required value={shotForm.durationSec} onChange={(event) => changeShotField('durationSec', event.target.value)} />
                </label>
                <label className="wide">
                  <span>画面动作</span>
                  <textarea rows={3} required maxLength={5_000} value={shotForm.action} onChange={(event) => changeShotField('action', event.target.value)} />
                </label>
                <label className="wide">
                  <span>镜头语言</span>
                  <input required maxLength={1_000} value={shotForm.camera} onChange={(event) => changeShotField('camera', event.target.value)} />
                </label>
                <label>
                  <span>对白</span>
                  <textarea rows={3} maxLength={5_000} value={shotForm.dialogueZh} onChange={(event) => changeShotField('dialogueZh', event.target.value)} />
                </label>
                <label>
                  <span>旁白</span>
                  <textarea rows={3} maxLength={5_000} value={shotForm.narrationZh} onChange={(event) => changeShotField('narrationZh', event.target.value)} />
                </label>
                <label className="wide">
                  <span>图像提示词</span>
                  <textarea rows={4} maxLength={20_000} value={shotForm.imagePrompt} onChange={(event) => changeShotField('imagePrompt', event.target.value)} />
                </label>
                <label className="wide">
                  <span>视频提示词</span>
                  <textarea rows={3} maxLength={20_000} value={shotForm.videoPrompt} onChange={(event) => changeShotField('videoPrompt', event.target.value)} />
                </label>
                <label>
                  <span>负向提示词</span>
                  <textarea rows={3} maxLength={5_000} value={shotForm.negativePrompt} onChange={(event) => changeShotField('negativePrompt', event.target.value)} />
                </label>
                <label>
                  <span>连续性备注</span>
                  <textarea rows={3} maxLength={4_000} value={shotForm.continuityNotes} onChange={(event) => changeShotField('continuityNotes', event.target.value)} />
                </label>
              </div>
              <div className="inspector-actions">
                <span>首帧 {selectedShot.firstFrameAssetId ? '已绑定' : '未绑定'} · 尾帧 {selectedShot.lastFrameAssetId ? '已绑定' : '未绑定'}</span>
                <button type="submit" disabled={shotSave === 'saving'}>
                  {shotSave === 'saving' ? '保存中…' : shotSave === 'saved' ? '已保存 ✓' : '保存分镜'}
                </button>
              </div>
            </form>
          )}
        </section>

        <aside className="asset-panel" aria-label="创作素材库">
          <div className="asset-panel-heading">
            <div><div className="studio-eyebrow">ASSET LIBRARY</div><h2>素材库</h2></div>
            <span>{entities.length}</span>
          </div>
          <div className="entity-groups">
            {(['character', 'scene', 'prop'] as const).map((kind) => {
              const items = entities.filter((entity) => entity.kind === kind);
              return (
                <section key={kind} className="entity-group">
                  <h3>{entityLabels[kind]} <span>{items.length}</span></h3>
                  {items.map((entity) => (
                    <article key={entity.entityId} className="entity-card">
                      <div className={`entity-icon ${kind}`} aria-hidden="true">{kind === 'character' ? '人' : kind === 'scene' ? '景' : '物'}</div>
                      <div><strong>{entity.name}</strong><p>{entity.description ?? entity.prompt ?? '等待补充设定'}</p></div>
                      <span className="entity-assets">{entity.referenceAssetIds.length + entity.extraAssetIds.length}</span>
                    </article>
                  ))}
                </section>
              );
            })}
          </div>
        </aside>
      </main>
    </div>
  );
}
