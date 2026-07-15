import { useEffect, useMemo, useRef, useState } from 'react';
import type { CreativeEntity, ProjectSpec, ShotSpec } from '@onecrew/contracts';
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
  getCreativeProject,
  importCreativeArchive,
  listCreativeProjects,
  type CreativeProjectResponse,
} from './creative-api.js';
import './studio.css';

type StudioView = 'storyboards' | 'canvas';

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
          <strong>{shot.title ?? shot.action}</strong>
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
  const graph = useMemo(() => flowGraph(episodeShots, selectedShotId), [episodeShots, selectedShotId]);

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
          <button className="studio-button ghost" type="button" onClick={onOpenReview}>打开审片</button>
        </div>
      </header>

      {error && <div className="studio-alert" role="alert"><strong>操作失败</strong><span>{error}</span></div>}

      <main className="studio-layout">
        <aside className="studio-sidebar" aria-label="剧集导航">
          <div className="studio-eyebrow">PROJECT / EPISODES</div>
          <h1>{bundle?.project.nameZh ?? '创作工程'}</h1>
          <p className="studio-synopsis">{bundle?.project.synopsis ?? '导入 LocalMiniDrama 工程，或从 API 创建一个新的 OneCrew 创作项目。'}</p>

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
                    <strong>{shot.title ?? shot.action}</strong>
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
            <section className="shot-inspector" aria-label="当前分镜详情">
              <div><span>动作</span><p>{selectedShot.action}</p></div>
              <div><span>生成提示词</span><p>{selectedShot.imagePrompt ?? selectedShot.prompt}</p></div>
              <div><span>连续性</span><p>{selectedShot.continuity?.notes ?? '等待上一镜连续性快照'}</p></div>
              <div><span>参考资产</span><p>{selectedShot.referenceAssetIds.length} 个 · 首帧 {selectedShot.firstFrameAssetId ? '已绑定' : '未绑定'}</p></div>
            </section>
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
