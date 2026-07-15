import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type {
  CreativeEntity,
  CreativeGenerationBatch,
  CreativeReusableAsset,
  CreativeStoryPlan,
  EpisodeSpec,
  JobStatus,
  ProjectSpec,
  ProviderMode,
  QcRunRecord,
  ShotSpec,
} from '@onecrew/contracts';
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
  applyCreativeStoryPlan,
  cancelCreativeGenerationBatch,
  downloadCreativeProject,
  getCreativeGenerationBatch,
  getCreativeJob,
  getLatestCreativeGenerationBatch,
  getCreativeProject,
  getCreativeQcRun,
  getCreativeStoryPlan,
  importCreativeArchive,
  listCreativeProjects,
  preprocessCreativeReferenceGrid,
  reuseCreativeAsset,
  retryCreativeGenerationBatch,
  searchCreativeReusableAssets,
  submitCreativeGenerationBatch,
  submitCreativeContinuityQc,
  submitCreativeShotGeneration,
  submitCreativeStoryPlan,
  updateCreativeEntity,
  updateCreativeEpisode,
  updateCreativeShot,
  type CreativeProjectResponse,
} from './creative-api.js';
import './studio.css';

type StudioView = 'storyboards' | 'canvas';
type SaveState = 'idle' | 'saving' | 'saved';
type GenerationKind = 'image' | 'video';
type GenerationStatus = 'idle' | 'submitting' | JobStatus;
type ContinuityQcStatus = 'idle' | 'submitting' | QcRunRecord['status'];
type StoryPlanStatus = 'idle' | 'submitting' | 'applying' | 'applied' | JobStatus;
type ReferenceGridStatus = 'idle' | 'processing' | 'done';
type ReusableAssetStatus = 'idle' | 'searching' | 'reusing';

interface GenerationState {
  status: GenerationStatus;
  jobId?: string;
  mode?: ProviderMode;
  provider?: string;
  outputAssetIds?: string[];
}

interface ContinuityQcState {
  status: ContinuityQcStatus;
  qcRunId?: string;
  assetId?: string;
  assetVersion?: number;
  mediaType?: 'image' | 'video';
  decision?: QcRunRecord['decision'];
  reason?: string;
  reviewDelivery?: QcRunRecord['reviewDelivery'];
}

interface StoryPlanState {
  status: StoryPlanStatus;
  jobId?: string;
  mode?: ProviderMode;
  provider?: string;
  plan?: CreativeStoryPlan;
  projectVersion?: number;
}

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

interface EntityDraft {
  name: string;
  description: string;
  prompt: string;
  referenceAssetIds: string[];
  detailOne: string;
  detailTwo: string;
  detailThree: string;
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

function entityDraft(entity: CreativeEntity | undefined): EntityDraft {
  if (!entity) {
    return { name: '', description: '', prompt: '', referenceAssetIds: [], detailOne: '', detailTwo: '', detailThree: '' };
  }
  if (entity.kind === 'character') {
    return {
      name: entity.name,
      description: entity.description ?? '',
      prompt: entity.prompt ?? '',
      referenceAssetIds: entity.referenceAssetIds,
      detailOne: entity.role ?? '',
      detailTwo: entity.personality ?? '',
      detailThree: entity.appearance ?? '',
    };
  }
  if (entity.kind === 'scene') {
    return {
      name: entity.name,
      description: entity.description ?? '',
      prompt: entity.prompt ?? '',
      referenceAssetIds: entity.referenceAssetIds,
      detailOne: entity.location,
      detailTwo: entity.timeOfDay ?? '',
      detailThree: entity.atmosphere ?? '',
    };
  }
  return {
    name: entity.name,
    description: entity.description ?? '',
    prompt: entity.prompt ?? '',
    referenceAssetIds: entity.referenceAssetIds,
    detailOne: entity.category ?? '',
    detailTwo: '',
    detailThree: '',
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

const entityDetailLabels: Record<CreativeEntity['kind'], [string, string, string]> = {
  character: ['角色定位', '性格', '外观锚点'],
  scene: ['地点', '时间', '氛围'],
  prop: ['分类', '', ''],
};

const generationStatusLabels: Record<GenerationStatus, string> = {
  idle: '尚未提交',
  submitting: '正在提交',
  queued: '已进入队列',
  running: '生成中',
  waiting_human: '等待飞书预算审批',
  succeeded: '已生成并登记新版本',
  failed: '生成失败',
  cancelled: '已取消',
};

const continuityQcStatusLabels: Record<ContinuityQcStatus, string> = {
  idle: '尚未检查',
  submitting: '正在提交',
  queued: '已进入 QC 队列',
  running: '技术检查中',
  waiting_provider: '连续性语义检查中',
  waiting_human: '等待飞书人工复核',
  succeeded: 'QC 已完成',
  failed: 'QC 执行失败',
  cancelled: 'QC 已取消',
};

const batchStatusLabels: Record<CreativeGenerationBatch['status'], string> = {
  submitting: '正在提交',
  running: '批量生成中',
  waiting_human: '等待飞书预算审批',
  succeeded: '批量生成完成',
  partial: '部分成功',
  failed: '批量生成失败',
  cancelled: '已停止',
};

const storyPlanStatusLabels: Record<StoryPlanStatus, string> = {
  idle: '等待创作简报',
  submitting: '正在提交规划',
  queued: '已进入生成队列',
  running: '正在构建故事与设定',
  waiting_human: '等待飞书预算审批',
  succeeded: '规划已生成，等待写入',
  failed: '规划生成失败',
  cancelled: '规划已取消',
  applying: '正在写入可编辑工程',
  applied: '已追加到工程',
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
  const [selectedEntityId, setSelectedEntityId] = useState<string>();
  const [view, setView] = useState<StudioView>('storyboards');
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [episodeSave, setEpisodeSave] = useState<SaveState>('idle');
  const [shotSave, setShotSave] = useState<SaveState>('idle');
  const [entitySave, setEntitySave] = useState<SaveState>('idle');
  const [episodeForm, setEpisodeForm] = useState<EpisodeDraft>(() => episodeDraft(undefined));
  const [shotForm, setShotForm] = useState<ShotDraft>(() => shotDraft(undefined));
  const [entityForm, setEntityForm] = useState<EntityDraft>(() => entityDraft(undefined));
  const [shotGenerations, setShotGenerations] = useState<Partial<Record<GenerationKind, GenerationState>>>({});
  const [continuityQc, setContinuityQc] = useState<ContinuityQcState>({ status: 'idle' });
  const [generationBatch, setGenerationBatch] = useState<CreativeGenerationBatch>();
  const [batchAction, setBatchAction] = useState<'idle' | 'submitting' | 'polling' | 'stopping' | 'retrying'>('idle');
  const [storyBrief, setStoryBrief] = useState('');
  const [storyEpisodeCount, setStoryEpisodeCount] = useState(3);
  const [storyPlan, setStoryPlan] = useState<StoryPlanState>({ status: 'idle' });
  const [referenceGridStatus, setReferenceGridStatus] = useState<ReferenceGridStatus>('idle');
  const [referenceGridSourceId, setReferenceGridSourceId] = useState('');
  const [referenceGridShape, setReferenceGridShape] = useState('2x2');
  const [referenceGridTileCount, setReferenceGridTileCount] = useState(0);
  const [reusableAssetQuery, setReusableAssetQuery] = useState('');
  const [reusableAssets, setReusableAssets] = useState<CreativeReusableAsset[]>([]);
  const [reusableAssetStatus, setReusableAssetStatus] = useState<ReusableAssetStatus>('idle');
  const [reusingAssetId, setReusingAssetId] = useState('');
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);
  const generationSelectionRef = useRef('');
  const projectSelectionRef = useRef('');

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
    projectSelectionRef.current = selectedProjectId ?? '';
    setGenerationBatch(undefined);
    setBatchAction('idle');
    setStoryPlan({ status: 'idle' });
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
        setStoryBrief(result.bundle.project.synopsis);
        setSelectedEpisodeId(result.bundle.episodes[0]?.episodeId);
        setSelectedShotId(result.bundle.shots[0]?.shotId);
        setSelectedEntityId(result.bundle.entities[0]?.entityId);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
    void getLatestCreativeGenerationBatch(selectedProjectId)
      .then((result) => {
        if (projectSelectionRef.current === selectedProjectId) setGenerationBatch(result.batch ?? undefined);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [selectedProjectId]);

  const bundle = project?.bundle;
  const versionedAssets = project?.assets ?? [];
  const episodes = bundle?.episodes ?? [];
  const entities = bundle?.entities ?? [];
  const episodeShots = useMemo(
    () => (bundle?.shots ?? []).filter((shot) => !selectedEpisodeId || shot.episodeId === selectedEpisodeId),
    [bundle, selectedEpisodeId],
  );
  const selectedShot = (bundle?.shots ?? []).find((shot) => shot.shotId === selectedShotId);
  const selectedEpisode = episodes.find((episode) => episode.episodeId === selectedEpisodeId);
  const selectedEntity = entities.find((entity) => entity.entityId === selectedEntityId);
  const referenceGridSources = versionedAssets.filter((asset) =>
    ['image', 'character', 'scene', 'prop', 'poster'].includes(asset.type) &&
    asset.uri.startsWith('s3://') &&
    !asset.creativeRole?.startsWith('reference-grid-'),
  );
  const reusedSourceAssetIds = new Set(
    versionedAssets
      .filter((asset) => entityForm.referenceAssetIds.includes(asset.assetId) && asset.parentAssetId)
      .map((asset) => asset.parentAssetId!),
  );
  const selectedQcAsset = versionedAssets
    .filter((asset) =>
      asset.shotId === selectedShotId &&
      (asset.type === 'image' || asset.type === 'video') &&
      asset.uri.startsWith('s3://') &&
      asset.status !== 'archived',
    )
    .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt))[0];
  const graph = useMemo(() => flowGraph(episodeShots, selectedShotId), [episodeShots, selectedShotId]);
  const shotDirty = useMemo(
    () => Boolean(selectedShot && JSON.stringify(shotForm) !== JSON.stringify(shotDraft(selectedShot))),
    [selectedShot, shotForm],
  );
  const entityDirty = useMemo(
    () => Boolean(selectedEntity && JSON.stringify(entityForm) !== JSON.stringify(entityDraft(selectedEntity))),
    [selectedEntity, entityForm],
  );

  useEffect(() => {
    setEpisodeForm(episodeDraft(selectedEpisode));
    setEpisodeSave('idle');
  }, [selectedProjectId, selectedEpisodeId]);

  useEffect(() => {
    generationSelectionRef.current = `${selectedProjectId ?? ''}:${selectedShotId ?? ''}`;
    setShotForm(shotDraft(selectedShot));
    setShotSave('idle');
    setShotGenerations({});
    setContinuityQc({ status: 'idle' });
  }, [selectedProjectId, selectedShotId]);

  useEffect(() => {
    setEntityForm(entityDraft(selectedEntity));
    setEntitySave('idle');
    setReferenceGridStatus('idle');
    setReferenceGridSourceId('');
    setReferenceGridTileCount(0);
    setReusableAssetQuery(selectedEntity?.name ?? '');
    setReusableAssets([]);
    setReusableAssetStatus('idle');
    setReusingAssetId('');
  }, [selectedProjectId, selectedEntityId]);

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

  const followStoryPlan = async (projectId: string, jobId: string) => {
    const stillSelected = () => projectSelectionRef.current === projectId;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const current = await getCreativeStoryPlan(projectId, jobId);
      if (!stillSelected()) return;
      setStoryPlan({
        status: current.job.status,
        jobId: current.job.jobId,
        mode: current.job.mode,
        provider: current.job.provider,
        ...(current.plan ? { plan: current.plan } : {}),
      });
      if (current.job.status === 'succeeded' || current.job.status === 'waiting_human') return;
      if (current.job.status === 'failed' || current.job.status === 'cancelled') {
        throw new Error(current.job.errorMessage ?? storyPlanStatusLabels[current.job.status]);
      }
      await new Promise((resolve) => window.setTimeout(resolve, 750));
      if (!stillSelected()) return;
    }
    throw new Error('故事规划仍在运行，可稍后刷新状态。');
  };

  const handleStoryPlanSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedProjectId || !storyBrief.trim()) return;
    const projectId = selectedProjectId;
    const stillSelected = () => projectSelectionRef.current === projectId;
    setError(undefined);
    setStoryPlan({ status: 'submitting' });
    try {
      const accepted = await submitCreativeStoryPlan(projectId, storyBrief.trim(), storyEpisodeCount);
      if (!stillSelected()) return;
      setStoryPlan({
        status: accepted.status,
        jobId: accepted.job_id,
        mode: accepted.mode,
        provider: accepted.provider,
      });
      if (accepted.status !== 'waiting_human') await followStoryPlan(projectId, accepted.job_id);
    } catch (reason) {
      if (!stillSelected()) return;
      setStoryPlan((current) => ({ ...current, status: 'failed' }));
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleStoryPlanRefresh = async () => {
    if (!selectedProjectId || !storyPlan.jobId) return;
    setError(undefined);
    try {
      await followStoryPlan(selectedProjectId, storyPlan.jobId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleStoryPlanApply = async () => {
    if (!project || !selectedProjectId || !storyPlan.jobId || !storyPlan.plan) return;
    const projectId = selectedProjectId;
    const stillSelected = () => projectSelectionRef.current === projectId;
    setError(undefined);
    setStoryPlan((current) => ({ ...current, status: 'applying' }));
    try {
      const result = await applyCreativeStoryPlan(
        projectId,
        storyPlan.jobId,
        project.versions.project,
      );
      const refreshed = await getCreativeProject(projectId);
      if (!stillSelected()) return;
      setProject(refreshed);
      const firstEpisodeId = result.applied.episodeIds[0];
      const firstEntityId = result.applied.entityIds[0];
      if (firstEpisodeId) {
        setSelectedEpisodeId(firstEpisodeId);
        setSelectedShotId(refreshed.bundle.shots.find((shot) => shot.episodeId === firstEpisodeId)?.shotId);
      }
      if (firstEntityId) setSelectedEntityId(firstEntityId);
      setStoryPlan((current) => ({
        ...current,
        status: 'applied',
        projectVersion: result.applied.projectVersion,
      }));
      await refreshProjects(projectId);
    } catch (reason) {
      if (!stillSelected()) return;
      setStoryPlan((current) => ({ ...current, status: current.plan ? 'succeeded' : 'failed' }));
      setError(`${reason instanceof Error ? reason.message : String(reason)}；已保留生成预览。`);
      const refreshed = await getCreativeProject(projectId).catch(() => undefined);
      if (refreshed) setProject(refreshed);
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

  function changeEntityField<Field extends keyof EntityDraft>(field: Field, value: EntityDraft[Field]) {
    setEntityForm((draft) => ({ ...draft, [field]: value }));
    setEntitySave('idle');
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

  const handleShotGeneration = async (kind: GenerationKind) => {
    if (!project || !selectedShot) return;
    if (shotDirty) return setError('请先保存当前分镜修改，再提交生成任务。');
    const expectedVersion = project.versions.shots[selectedShot.shotId];
    if (!expectedVersion) return setError('无法读取当前分镜版本，请刷新页面。');
    const selectionKey = `${selectedProjectId ?? ''}:${selectedShot.shotId}`;
    const stillSelected = () => generationSelectionRef.current === selectionKey;
    setError(undefined);
    setShotGenerations((current) => ({ ...current, [kind]: { status: 'submitting' } }));
    try {
      const accepted = await submitCreativeShotGeneration(selectedShot.shotId, expectedVersion, kind);
      if (!stillSelected()) return;
      setShotGenerations((current) => ({
        ...current,
        [kind]: {
          status: accepted.status,
          jobId: accepted.job_id,
          mode: accepted.mode,
          provider: accepted.provider,
        },
      }));
      if (accepted.status === 'waiting_human') return;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        if (!stillSelected()) return;
        const current = await getCreativeJob(accepted.job_id);
        if (!stillSelected()) return;
        setShotGenerations((generations) => ({
          ...generations,
          [kind]: {
            status: current.job.status,
            jobId: current.job.jobId,
            mode: current.job.mode,
            provider: current.job.provider,
            outputAssetIds: current.job.outputAssetIds,
          },
        }));
        if (current.job.status === 'succeeded') {
          const refreshed = await getCreativeProject(selectedShot.projectId);
          if (stillSelected()) setProject(refreshed);
          return;
        }
        if (current.job.status === 'waiting_human') return;
        if (current.job.status === 'failed' || current.job.status === 'cancelled') {
          throw new Error(current.job.errorMessage ?? `生成任务已${current.job.status === 'failed' ? '失败' : '取消'}`);
        }
      }
      throw new Error('生成任务仍在运行，可稍后刷新工程查看结果。');
    } catch (reason) {
      if (!stillSelected()) return;
      setShotGenerations((current) => {
        const previous = current[kind];
        const status = previous && previous.status !== 'idle' && previous.status !== 'submitting'
          ? previous.status
          : 'failed';
        return { ...current, [kind]: { ...previous, status } };
      });
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleContinuityQc = async () => {
    if (!project || !selectedShot) return;
    if (shotDirty) return setError('请先保存当前分镜修改，再运行连续性 QC。');
    if (!selectedQcAsset) {
      return setError('当前分镜没有可读取的受控图片或视频；Mock 占位 URI 不会被伪装成真实媒体检查。');
    }
    const expectedVersion = project.versions.shots[selectedShot.shotId];
    if (!expectedVersion) return setError('无法读取当前分镜版本，请刷新页面。');
    const selectionKey = `${selectedProjectId ?? ''}:${selectedShot.shotId}`;
    const stillSelected = () => generationSelectionRef.current === selectionKey;
    setError(undefined);
    setContinuityQc({
      status: 'submitting',
      assetId: selectedQcAsset.assetId,
      assetVersion: selectedQcAsset.version,
      mediaType: selectedQcAsset.type as 'image' | 'video',
    });
    try {
      const accepted = await submitCreativeContinuityQc(
        selectedShot.shotId,
        expectedVersion,
        selectedQcAsset.assetId,
      );
      if (!stillSelected()) return;
      setContinuityQc({
        status: accepted.status,
        qcRunId: accepted.qc_run_id,
        assetId: accepted.source_asset_id,
        assetVersion: accepted.source_asset_version,
        mediaType: accepted.media_type,
      });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        if (!stillSelected()) return;
        const current = await getCreativeQcRun(accepted.qc_run_id);
        if (!stillSelected()) return;
        setContinuityQc({
          status: current.qc_run.status,
          qcRunId: current.qc_run.qcRunId,
          assetId: accepted.source_asset_id,
          assetVersion: accepted.source_asset_version,
          mediaType: accepted.media_type,
          ...(current.qc_run.decision ? { decision: current.qc_run.decision } : {}),
          ...(current.qc_run.reason
            ? { reason: current.qc_run.reason }
            : current.qc_run.errorMessage
              ? { reason: current.qc_run.errorMessage }
              : {}),
          ...(current.qc_run.reviewDelivery ? { reviewDelivery: current.qc_run.reviewDelivery } : {}),
        });
        if (current.qc_run.status === 'succeeded' || current.qc_run.status === 'waiting_human') return;
        if (current.qc_run.status === 'failed' || current.qc_run.status === 'cancelled') {
          throw new Error(current.qc_run.errorMessage ?? `QC 已${current.qc_run.status === 'failed' ? '失败' : '取消'}`);
        }
      }
      throw new Error('QC 仍在运行，可稍后重新提交或通过 QC Run 查询状态。');
    } catch (reason) {
      if (!stillSelected()) return;
      setContinuityQc((current) => ({
        ...current,
        status: current.status === 'submitting' ? 'failed' : current.status,
        reason: reason instanceof Error ? reason.message : String(reason),
      }));
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const followGenerationBatch = async (batchId: string, projectId: string) => {
    const stillSelected = () => projectSelectionRef.current === projectId;
    setBatchAction('polling');
    const deadline = Date.now() + 120_000;
    try {
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        if (!stillSelected()) return;
        const current = await getCreativeGenerationBatch(batchId);
        if (!stillSelected()) return;
        setGenerationBatch(current.batch);
        if (['succeeded', 'partial', 'failed', 'cancelled', 'waiting_human'].includes(current.batch.status)) {
          setBatchAction('idle');
          const refreshed = await getCreativeProject(projectId);
          if (stillSelected()) setProject(refreshed);
          return;
        }
      }
      throw new Error('批量生成仍在运行，可使用“刷新状态”继续查看。');
    } catch (reason) {
      if (!stillSelected()) return;
      setBatchAction('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleBatchGeneration = async (kind: GenerationKind) => {
    if (!project || !selectedProjectId) return;
    if (shotDirty) return setError('请先保存当前分镜修改，再开始批量生成。');
    const projectId = selectedProjectId;
    setError(undefined);
    setBatchAction('submitting');
    try {
      const result = await submitCreativeGenerationBatch(projectId, kind, project.versions.shots);
      if (projectSelectionRef.current !== projectId) return;
      setGenerationBatch(result.batch);
      if (['succeeded', 'partial', 'failed', 'cancelled', 'waiting_human'].includes(result.batch.status)) {
        setBatchAction('idle');
        setProject(await getCreativeProject(projectId));
        return;
      }
      await followGenerationBatch(result.batch.batchId, projectId);
    } catch (reason) {
      if (projectSelectionRef.current !== projectId) return;
      setBatchAction('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleBatchCancel = async () => {
    if (!generationBatch) return;
    setError(undefined);
    setBatchAction('stopping');
    try {
      const result = await cancelCreativeGenerationBatch(generationBatch.batchId);
      setGenerationBatch(result.batch);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBatchAction('idle');
    }
  };

  const handleBatchRetry = async () => {
    if (!generationBatch || !selectedProjectId) return;
    const projectId = selectedProjectId;
    setError(undefined);
    setBatchAction('retrying');
    try {
      const result = await retryCreativeGenerationBatch(generationBatch.batchId);
      if (projectSelectionRef.current !== projectId) return;
      setGenerationBatch(result.batch);
      await followGenerationBatch(result.batch.batchId, projectId);
    } catch (reason) {
      if (projectSelectionRef.current === projectId) {
        setBatchAction('idle');
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  };

  const handleBatchRefresh = async () => {
    if (!generationBatch) return;
    setError(undefined);
    try {
      const result = await getCreativeGenerationBatch(generationBatch.batchId);
      setGenerationBatch(result.batch);
      if (selectedProjectId) setProject(await getCreativeProject(selectedProjectId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleEntitySave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project || !selectedEntity) return;
    const expectedVersion = project.versions.entities[selectedEntity.entityId];
    if (!expectedVersion) return setError('无法读取当前素材设定版本，请刷新页面。');
    const common = {
      name: entityForm.name.trim(),
      description: entityForm.description,
      prompt: entityForm.prompt,
      referenceAssetIds: entityForm.referenceAssetIds,
    };
    const details = selectedEntity.kind === 'character'
      ? { role: entityForm.detailOne, personality: entityForm.detailTwo, appearance: entityForm.detailThree }
      : selectedEntity.kind === 'scene'
        ? { location: entityForm.detailOne.trim(), timeOfDay: entityForm.detailTwo, atmosphere: entityForm.detailThree }
        : { category: entityForm.detailOne };
    setEntitySave('saving');
    setError(undefined);
    try {
      const result = await updateCreativeEntity(selectedEntity.entityId, expectedVersion, { ...common, ...details });
      setProject((current) => current ? {
        ...current,
        bundle: {
          ...current.bundle,
          entities: current.bundle.entities.map((entity) => entity.entityId === result.record.entityId ? result.record : entity),
        },
        versions: {
          ...current.versions,
          entities: { ...current.versions.entities, [result.record.entityId]: result.version },
        },
      } : current);
      setEntitySave('saved');
    } catch (reason) {
      setEntitySave('idle');
      setError(`${reason instanceof Error ? reason.message : String(reason)}；已重新读取服务端版本。`);
      const latest = await getCreativeProject(selectedEntity.projectId).catch(() => undefined);
      if (latest) {
        setProject(latest);
        setEntityForm(entityDraft(latest.bundle.entities.find((entity) => entity.entityId === selectedEntity.entityId)));
      }
    }
  };

  const handleReferenceGrid = async () => {
    if (!project || !selectedEntity) return;
    if (entityDirty) return setError('请先保存当前素材设定，再拆分组合参考图。');
    const sourceAssetId = referenceGridSourceId || referenceGridSources[0]?.assetId;
    const expectedVersion = project.versions.entities[selectedEntity.entityId];
    if (!sourceAssetId || !expectedVersion) return setError('请选择可控的图片资产并确认当前设定版本。');
    const [rows, columns] = referenceGridShape.split('x').map(Number) as [number, number];
    setError(undefined);
    setReferenceGridStatus('processing');
    try {
      const response = await preprocessCreativeReferenceGrid(
        selectedEntity.entityId,
        sourceAssetId,
        expectedVersion,
        rows,
        columns,
      );
      const latest = await getCreativeProject(selectedEntity.projectId);
      setProject(latest);
      setEntityForm(entityDraft(latest.bundle.entities.find((entity) => entity.entityId === selectedEntity.entityId)));
      setReferenceGridTileCount(response.result.tileAssetIds.length);
      setReferenceGridStatus('done');
    } catch (reason) {
      setReferenceGridStatus('idle');
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const handleReusableAssetSearch = async () => {
    if (!selectedEntity) return;
    setError(undefined);
    setReusableAssetStatus('searching');
    try {
      setReusableAssets(await searchCreativeReusableAssets(
        reusableAssetQuery.trim(),
        selectedEntity.kind,
        selectedEntity.projectId,
      ));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReusableAssetStatus('idle');
    }
  };

  const handleReusableAssetApply = async (sourceAssetId: string) => {
    if (!project || !selectedEntity) return;
    if (entityDirty) return setError('请先保存当前素材设定，再复用全局素材。');
    const expectedVersion = project.versions.entities[selectedEntity.entityId];
    if (!expectedVersion) return setError('无法读取当前素材设定版本，请刷新页面。');
    setError(undefined);
    setReusableAssetStatus('reusing');
    setReusingAssetId(sourceAssetId);
    try {
      await reuseCreativeAsset(selectedEntity.entityId, sourceAssetId, expectedVersion);
      const latest = await getCreativeProject(selectedEntity.projectId);
      setProject(latest);
      setEntityForm(entityDraft(latest.bundle.entities.find((entity) => entity.entityId === selectedEntity.entityId)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReusableAssetStatus('idle');
      setReusingAssetId('');
    }
  };

  const batchActive = Boolean(
    generationBatch && ['submitting', 'running', 'waiting_human'].includes(generationBatch.status),
  );
  const batchRetryable = generationBatch?.items.filter((item) =>
    ['submission_failed', 'failed', 'cancelled'].includes(item.status),
  ).length ?? 0;
  const batchCompleted = generationBatch?.items.filter((item) => item.status === 'succeeded').length ?? 0;
  const batchSkipped = generationBatch?.items.filter((item) => item.status === 'skipped').length ?? 0;
  const batchModes = [...new Set(generationBatch?.items.flatMap((item) => item.mode ? [item.mode] : []) ?? [])]
    .map((mode) => mode.toUpperCase())
    .join('/');
  const batchMutating = ['submitting', 'stopping', 'retrying'].includes(batchAction);

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

          <section className="story-planner" aria-label="故事规划">
            <div className="story-planner-heading">
              <div>
                <span>STORY PLANNING</span>
                <strong>从创作简报生成多集故事与设定</strong>
                <p>先预览剧集、角色、场景和道具，确认后才追加到当前工程；已有内容不会被替换。</p>
              </div>
              <span className="story-plan-status" data-status={storyPlan.status}>
                {storyPlanStatusLabels[storyPlan.status]}
              </span>
            </div>
            <form className="story-planner-form" onSubmit={(event) => void handleStoryPlanSubmit(event)}>
              <label>
                <span>创作简报</span>
                <textarea
                  required
                  rows={3}
                  minLength={1}
                  maxLength={20_000}
                  placeholder="例如：围绕星门的新坐标续写三集，每集都有明确目标、转折与集尾钩子。"
                  value={storyBrief}
                  onChange={(event) => setStoryBrief(event.target.value)}
                />
              </label>
              <div className="story-planner-controls">
                <label>
                  <span>新增集数</span>
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={storyEpisodeCount}
                    onChange={(event) => setStoryEpisodeCount(Math.min(12, Math.max(1, Number(event.target.value))))}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    !project || !storyBrief.trim() ||
                    ['submitting', 'queued', 'running', 'waiting_human', 'applying'].includes(storyPlan.status)
                  }
                >
                  {['submitting', 'queued', 'running'].includes(storyPlan.status) ? '正在生成…' : '生成规划预览'}
                </button>
                {storyPlan.status === 'waiting_human' && (
                  <button className="story-plan-refresh" type="button" onClick={() => void handleStoryPlanRefresh()}>
                    审批后刷新状态
                  </button>
                )}
              </div>
            </form>

            {storyPlan.plan && (
              <div className="story-plan-preview">
                <div className="story-plan-title">
                  <div>
                    <span>PLAN PREVIEW</span>
                    <h3>{storyPlan.plan.title}</h3>
                    <p>{storyPlan.plan.logline}</p>
                  </div>
                  <dl>
                    <div><dt>剧集</dt><dd>{storyPlan.plan.episodes.length}</dd></div>
                    <div><dt>角色</dt><dd>{storyPlan.plan.characters.length}</dd></div>
                    <div><dt>场景</dt><dd>{storyPlan.plan.scenes.length}</dd></div>
                    <div><dt>道具</dt><dd>{storyPlan.plan.props.length}</dd></div>
                  </dl>
                </div>
                <div className="story-plan-episodes">
                  {storyPlan.plan.episodes.map((episode, index) => (
                    <article key={`${episode.title}-${index}`}>
                      <span>EP {String(index + 1).padStart(2, '0')}</span>
                      <strong>{episode.title}</strong>
                      <p>{episode.synopsis}</p>
                      <small>{episode.durationSec}s · {episode.characterNames.join(' / ') || '无指定角色'}</small>
                    </article>
                  ))}
                </div>
                <div className="story-plan-entities">
                  {[
                    ['角色', storyPlan.plan.characters.map((item) => item.name)],
                    ['场景', storyPlan.plan.scenes.map((item) => item.name)],
                    ['道具', storyPlan.plan.props.map((item) => item.name)],
                  ].map(([label, names]) => (
                    <div key={String(label)}>
                      <span>{label}</span>
                      <p>{(names as string[]).join(' · ') || '本次无新增'}</p>
                    </div>
                  ))}
                </div>
                <div className="story-plan-apply">
                  <small>
                    {storyPlan.mode ? `${storyPlan.mode.toUpperCase()} · ` : ''}
                    {storyPlan.provider ?? '结构化生成'} · Job {storyPlan.jobId}
                  </small>
                  <button
                    type="button"
                    disabled={storyPlan.status !== 'succeeded'}
                    onClick={() => void handleStoryPlanApply()}
                  >
                    {storyPlan.status === 'applying'
                      ? '写入中…'
                      : storyPlan.status === 'applied'
                        ? `已写入工程 v${storyPlan.projectVersion ?? ''}`
                        : '写入可编辑工程'}
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="batch-generation" aria-label="批量生成">
            <div className="batch-generation-copy">
              <span>BATCH GENERATION</span>
              <strong>批量补齐缺失镜头</strong>
              <p>按当前数据库版本并发提交；已有结果自动跳过，每个 Job 独立幂等、计费并写入资产版本链。</p>
            </div>
            <div className="batch-generation-actions">
              <button
                type="button"
                disabled={!project || shotDirty || batchActive || batchAction !== 'idle'}
                onClick={() => void handleBatchGeneration('image')}
              >
                {batchAction === 'submitting' ? '提交中…' : '批量补齐分镜图'}
              </button>
              <button
                type="button"
                disabled={!project || shotDirty || batchActive || batchAction !== 'idle'}
                onClick={() => void handleBatchGeneration('video')}
              >
                {batchAction === 'submitting' ? '提交中…' : '批量补齐视频'}
              </button>
            </div>
            {generationBatch && (
              <div className="batch-generation-state">
                <div>
                  <span data-status={generationBatch.status}>{batchStatusLabels[generationBatch.status]}</span>
                  <small>
                    {generationBatch.kind === 'image' ? '图片' : '视频'}{batchModes ? ` · ${batchModes}` : ''} · 成功 {batchCompleted} · 跳过 {batchSkipped} · 待重试 {batchRetryable}
                  </small>
                </div>
                <div className="batch-generation-controls">
                  <button type="button" disabled={batchMutating} onClick={() => void handleBatchRefresh()}>刷新状态</button>
                  <button
                    type="button"
                    disabled={!batchActive || batchMutating}
                    onClick={() => void handleBatchCancel()}
                  >
                    {batchAction === 'stopping' ? '停止中…' : '停止未完成项'}
                  </button>
                  <button
                    type="button"
                    disabled={batchActive || batchRetryable === 0 || batchMutating}
                    onClick={() => void handleBatchRetry()}
                  >
                    {batchAction === 'retrying' ? '重试中…' : '重试失败项'}
                  </button>
                </div>
              </div>
            )}
          </section>

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
              <section className="shot-generation" aria-label="单镜生成">
                <div>
                  <span>GENERATE + CONTINUITY QC</span>
                  <strong>生成与连续性检查</strong>
                  <p>生成结果进入版本资产链；QC 复用技术检查、VLM 与飞书人工闸门，不另建审批台。</p>
                </div>
                {(['image', 'video'] as const).map((kind) => {
                  const generation = shotGenerations[kind] ?? { status: 'idle' as const };
                  const busy = ['submitting', 'queued', 'running'].includes(generation.status);
                  return (
                    <div className="generation-action" key={kind}>
                      <button
                        type="button"
                        disabled={shotDirty || shotSave === 'saving' || busy}
                        title={shotDirty ? '请先保存分镜修改' : undefined}
                        onClick={() => void handleShotGeneration(kind)}
                      >
                        {busy ? '处理中…' : kind === 'image' ? '生成分镜图' : '生成视频'}
                      </button>
                      <small data-status={generation.status}>
                        {generationStatusLabels[generation.status]}
                        {generation.mode ? ` · ${generation.mode.toUpperCase()}` : ''}
                        {generation.outputAssetIds?.length ? ` · v+${generation.outputAssetIds.length}` : ''}
                      </small>
                    </div>
                  );
                })}
                <div className="generation-action">
                  <button
                    type="button"
                    disabled={
                      shotDirty ||
                      shotSave === 'saving' ||
                      !selectedQcAsset ||
                      ['submitting', 'queued', 'running', 'waiting_provider'].includes(continuityQc.status)
                    }
                    title={selectedQcAsset ? '检查当前可读取的最新受控媒体资产' : '没有可读取的受控媒体；Mock 占位不参与 QC'}
                    onClick={() => void handleContinuityQc()}
                  >
                    {['submitting', 'queued', 'running', 'waiting_provider'].includes(continuityQc.status) ? '检查中…' : '运行连续性 QC'}
                  </button>
                  <small data-status={continuityQc.status} title={continuityQc.reason}>
                    {continuityQcStatusLabels[continuityQc.status]}
                    {continuityQc.assetVersion ? ` · ${continuityQc.mediaType} v${continuityQc.assetVersion}` : selectedQcAsset ? ` · ${selectedQcAsset.type} v${selectedQcAsset.version}` : ''}
                    {continuityQc.decision ? ` · ${continuityQc.decision}` : ''}
                    {continuityQc.reviewDelivery === 'sent' ? ' · 已送飞书' : ''}
                  </small>
                </div>
              </section>
              <div className="inspector-actions">
                <span>{shotDirty ? '有未保存修改 · ' : ''}首帧 {selectedShot.firstFrameAssetId ? '已绑定' : '未绑定'} · 尾帧 {selectedShot.lastFrameAssetId ? '已绑定' : '未绑定'}</span>
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
            <span title={`${entities.length} 个设定实体`}>{project?.assets.length ?? 0}</span>
          </div>
          <div className="entity-groups">
            {(['character', 'scene', 'prop'] as const).map((kind) => {
              const items = entities.filter((entity) => entity.kind === kind);
              return (
                <section key={kind} className="entity-group">
                  <h3>{entityLabels[kind]} <span>{items.length}</span></h3>
                  {items.map((entity) => (
                    <button
                      key={entity.entityId}
                      type="button"
                      className={selectedEntityId === entity.entityId ? 'entity-card selected' : 'entity-card'}
                      onClick={() => setSelectedEntityId(entity.entityId)}
                    >
                      <div className={`entity-icon ${kind}`} aria-hidden="true">{kind === 'character' ? '人' : kind === 'scene' ? '景' : '物'}</div>
                      <div><strong>{entity.name}</strong><p>{entity.description ?? entity.prompt ?? '等待补充设定'}</p></div>
                      <span className="entity-assets">{entity.referenceAssetIds.length + entity.extraAssetIds.length}</span>
                    </button>
                  ))}
                </section>
              );
            })}
          </div>

          {selectedEntity && (
            <form className="entity-editor" aria-label="当前素材设定编辑" onSubmit={(event) => void handleEntitySave(event)}>
              <div className="editor-heading">
                <div>
                  <span>{selectedEntity.kind.toUpperCase()} / EDITOR</span>
                  <strong>{entityLabels[selectedEntity.kind]}设定</strong>
                </div>
                <small>v{project?.versions.entities[selectedEntity.entityId] ?? '—'}</small>
              </div>
              <label>
                <span>名称</span>
                <input required maxLength={300} value={entityForm.name} onChange={(event) => changeEntityField('name', event.target.value)} />
              </label>
              <label>
                <span>描述</span>
                <textarea rows={3} maxLength={10_000} value={entityForm.description} onChange={(event) => changeEntityField('description', event.target.value)} />
              </label>
              <label>
                <span>生成提示词</span>
                <textarea rows={4} maxLength={20_000} value={entityForm.prompt} onChange={(event) => changeEntityField('prompt', event.target.value)} />
              </label>
              <label>
                <span>{entityDetailLabels[selectedEntity.kind][0]}</span>
                <input
                  required={selectedEntity.kind === 'scene'}
                  maxLength={selectedEntity.kind === 'scene' ? 500 : 2_000}
                  value={entityForm.detailOne}
                  onChange={(event) => changeEntityField('detailOne', event.target.value)}
                />
              </label>
              {entityDetailLabels[selectedEntity.kind][1] && (
                <label>
                  <span>{entityDetailLabels[selectedEntity.kind][1]}</span>
                  <textarea rows={2} maxLength={4_000} value={entityForm.detailTwo} onChange={(event) => changeEntityField('detailTwo', event.target.value)} />
                </label>
              )}
              {entityDetailLabels[selectedEntity.kind][2] && (
                <label>
                  <span>{entityDetailLabels[selectedEntity.kind][2]}</span>
                  <textarea rows={3} maxLength={10_000} value={entityForm.detailThree} onChange={(event) => changeEntityField('detailThree', event.target.value)} />
                </label>
              )}
              <section className="reference-grid-tool" aria-label="组合参考图拆分">
                <div>
                  <strong>组合参考图</strong>
                  <span>用 FFmpeg 在本地拆分为独立图片，按顺序绑定到当前设定。</span>
                </div>
                {referenceGridSources.length === 0 ? (
                  <p>暂无可拆分的 MinIO 图片资产。</p>
                ) : (
                  <>
                    <label>
                      <span>源图</span>
                      <select
                        value={referenceGridSourceId || referenceGridSources[0]?.assetId}
                        onChange={(event) => setReferenceGridSourceId(event.target.value)}
                      >
                        {referenceGridSources.map((asset) => (
                          <option key={asset.assetId} value={asset.assetId}>
                            {asset.creativeRole ?? asset.type} · v{asset.version}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>网格</span>
                      <select value={referenceGridShape} onChange={(event) => setReferenceGridShape(event.target.value)}>
                        <option value="1x2">1 × 2</option>
                        <option value="1x3">1 × 3</option>
                        <option value="2x2">2 × 2</option>
                        <option value="2x3">2 × 3</option>
                        <option value="3x3">3 × 3</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      disabled={referenceGridStatus === 'processing' || entityDirty}
                      onClick={() => void handleReferenceGrid()}
                    >
                      {referenceGridStatus === 'processing'
                        ? '正在拆分…'
                        : referenceGridStatus === 'done'
                          ? `已绑定 ${referenceGridTileCount} 张 ✓`
                          : '拆分并绑定'}
                    </button>
                  </>
                )}
              </section>
              <section className="reusable-asset-tool" aria-label="全局素材复用">
                <div>
                  <strong>全局素材库</strong>
                  <span>搜索其他工程的受控素材；复用时在当前工程建立可导出、可追溯的本地别名。</span>
                </div>
                <div className="reusable-asset-search">
                  <input
                    aria-label="搜索全局素材"
                    maxLength={200}
                    placeholder={`搜索${entityLabels[selectedEntity.kind]}名、工程或用途`}
                    value={reusableAssetQuery}
                    onChange={(event) => setReusableAssetQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void handleReusableAssetSearch();
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={reusableAssetStatus !== 'idle'}
                    onClick={() => void handleReusableAssetSearch()}
                  >
                    {reusableAssetStatus === 'searching' ? '搜索中…' : '搜索'}
                  </button>
                </div>
                {reusableAssets.length > 0 ? (
                  <div className="reusable-asset-results">
                    {reusableAssets.map((item) => {
                      const alreadyReused = reusedSourceAssetIds.has(item.asset.assetId);
                      return (
                        <article key={item.asset.assetId}>
                          <div>
                            <strong>{item.originEntity?.name ?? item.asset.creativeRole ?? item.asset.type}</strong>
                            <small>{item.asset.creativeRole ?? item.asset.type} · {item.originProject.nameZh} · v{item.asset.version}</small>
                          </div>
                          <button
                            type="button"
                            disabled={alreadyReused || reusableAssetStatus !== 'idle' || entityDirty}
                            onClick={() => void handleReusableAssetApply(item.asset.assetId)}
                          >
                            {alreadyReused
                              ? '已复用'
                              : reusingAssetId === item.asset.assetId
                                ? '复用中…'
                                : '复用'}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : reusableAssetQuery && reusableAssetStatus === 'idle' ? (
                  <p>输入关键词后搜索，不会显示当前工程或非受控媒体。</p>
                ) : null}
              </section>
              <fieldset className="asset-bindings">
                <legend>绑定参考资产</legend>
                {versionedAssets.length === 0 ? (
                  <p>当前项目还没有可绑定的版本资产。</p>
                ) : versionedAssets.map((asset) => (
                  <label key={asset.assetId}>
                    <input
                      type="checkbox"
                      checked={entityForm.referenceAssetIds.includes(asset.assetId)}
                      onChange={(event) => changeEntityField(
                        'referenceAssetIds',
                        event.target.checked
                          ? [...new Set([...entityForm.referenceAssetIds, asset.assetId])]
                          : entityForm.referenceAssetIds.filter((assetId) => assetId !== asset.assetId),
                      )}
                    />
                    <span><strong>{asset.creativeRole ?? asset.type}</strong><small>{asset.provider} · v{asset.version}</small></span>
                  </label>
                ))}
              </fieldset>
              <button className="entity-save" type="submit" disabled={entitySave === 'saving'}>
                {entitySave === 'saving' ? '保存中…' : entitySave === 'saved' ? '已保存 ✓' : '保存素材设定'}
              </button>
            </form>
          )}

          <section className="asset-records" aria-label="版本资产记录">
            <h3>版本资产 <span>{project?.assets.length ?? 0}</span></h3>
            {(project?.assets ?? []).map((asset) => (
              <article key={asset.assetId} title={asset.assetId}>
                <span>{asset.type}</span>
                <strong>{asset.creativeRole ?? `${asset.type} asset`}</strong>
                <small>{asset.provider} · v{asset.version} · {asset.status}</small>
              </article>
            ))}
          </section>
        </aside>
      </main>
    </div>
  );
}
