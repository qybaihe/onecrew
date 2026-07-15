import type {
  AssetRecord,
  CreativeEntity,
  CreativeProjectBundle,
  EpisodeSpec,
  JobRecord,
  ProjectSpec,
  ShotSpec,
} from '@onecrew/contracts';

interface ProjectListResponse {
  projects: ProjectSpec[];
}

export interface CreativeProjectResponse {
  bundle: CreativeProjectBundle;
  assets: AssetRecord[];
  versions: {
    project: number;
    episodes: Record<string, number>;
    entities: Record<string, number>;
    shots: Record<string, number>;
    framePrompts: Record<string, number>;
  };
}

export interface CreativeImportResponse {
  ok: true;
  imported: {
    projectId: string;
    episodes: number;
    entities: number;
    shots: number;
    framePrompts: number;
    assets: number;
  };
  media: number;
}

interface CreativeEditResponse<Record> {
  ok: true;
  record: Record;
  version: number;
}

export interface CreativeGenerationAccepted {
  job_id: string;
  status: 'queued' | 'waiting_human';
  mode: 'mock' | 'real';
  provider: string;
  route: 'primary' | 'fallback';
  estimated_cost_cny: number;
  status_url: string;
  replayed: boolean;
  warning?: string;
}

export interface CreativeJobResponse {
  job: JobRecord;
  version: number;
  output?: unknown;
}

export type EpisodeEditPatch = Partial<
  Pick<EpisodeSpec, 'title' | 'description' | 'scriptContent' | 'durationSec' | 'status'>
>;

export type ShotEditPatch = Partial<
  Pick<
    ShotSpec,
    | 'title'
    | 'description'
    | 'action'
    | 'camera'
    | 'dialogueZh'
    | 'narrationZh'
    | 'imagePrompt'
    | 'videoPrompt'
    | 'negativePrompt'
    | 'durationSec'
    | 'continuity'
  >
>;

export type EntityEditPatch = Partial<{
  name: string;
  description: string;
  prompt: string;
  polishedPrompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  role: string;
  personality: string;
  appearance: string;
  voiceStyle: string;
  location: string;
  timeOfDay: string;
  atmosphere: string;
  lightingStyle: string;
  category: string;
}>;

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: T & { message?: string };
  try {
    body = JSON.parse(text) as T & { message?: string };
  } catch {
    throw new Error(`OneCrew API returned ${response.status} without a JSON response`);
  }
  if (!response.ok) throw new Error(body.message ?? `OneCrew API returned ${response.status}`);
  return body;
}

async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.status !== 502 && response.status !== 503) return response;
      lastError = new Error(`OneCrew API is starting (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 300));
  }
  throw lastError instanceof Error ? lastError : new Error('OneCrew API is unavailable');
}

export async function listCreativeProjects(): Promise<ProjectSpec[]> {
  const response = await request('/v1/creative/projects');
  return (await json<ProjectListResponse>(response)).projects;
}

export async function getCreativeProject(projectId: string): Promise<CreativeProjectResponse> {
  const response = await request(`/v1/creative/projects/${encodeURIComponent(projectId)}`);
  return json<CreativeProjectResponse>(response);
}

export async function importCreativeArchive(file: File): Promise<CreativeImportResponse> {
  const isNativeArchive = file.name.toLowerCase().endsWith('.onecrew.zip');
  const projectId = `prj_studio_${Date.now()}`;
  const query = new URLSearchParams({ projectId, ownerOpenId: 'ou_local_studio' });
  const endpoint = isNativeArchive
    ? '/v1/creative/imports/onecrew/zip'
    : `/v1/creative/imports/local-mini-drama/zip?${query}`;
  const response = await request(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });
  return json<CreativeImportResponse>(response);
}

function editContext(expectedVersion: number) {
  return {
    expectedVersion,
    editId: `studio_${crypto.randomUUID()}`,
    actorOpenId: 'ou_local_studio',
  };
}

export async function updateCreativeEpisode(
  episodeId: string,
  expectedVersion: number,
  patch: EpisodeEditPatch,
): Promise<CreativeEditResponse<EpisodeSpec>> {
  const response = await request(`/v1/creative/episodes/${encodeURIComponent(episodeId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...editContext(expectedVersion), patch }),
  });
  return json<CreativeEditResponse<EpisodeSpec>>(response);
}

export async function updateCreativeShot(
  shotId: string,
  expectedVersion: number,
  patch: ShotEditPatch,
): Promise<CreativeEditResponse<ShotSpec>> {
  const response = await request(`/v1/creative/shots/${encodeURIComponent(shotId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...editContext(expectedVersion), patch }),
  });
  return json<CreativeEditResponse<ShotSpec>>(response);
}

export async function updateCreativeEntity(
  entityId: string,
  expectedVersion: number,
  patch: EntityEditPatch,
): Promise<CreativeEditResponse<CreativeEntity>> {
  const response = await request(`/v1/creative/entities/${encodeURIComponent(entityId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...editContext(expectedVersion), patch }),
  });
  return json<CreativeEditResponse<CreativeEntity>>(response);
}

export async function submitCreativeShotGeneration(
  shotId: string,
  expectedVersion: number,
  kind: 'image' | 'video',
): Promise<CreativeGenerationAccepted> {
  const idempotencyKey = `studio_generation_${crypto.randomUUID()}`;
  const response = await request(`/v1/creative/shots/${encodeURIComponent(shotId)}/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
    body: JSON.stringify({
      expectedVersion,
      kind,
      route: 'primary',
      generationNonce: Date.now(),
    }),
  });
  return json<CreativeGenerationAccepted>(response);
}

export async function getCreativeJob(jobId: string): Promise<CreativeJobResponse> {
  const response = await request(`/v1/jobs/${encodeURIComponent(jobId)}`);
  return json<CreativeJobResponse>(response);
}

export async function downloadCreativeProject(projectId: string): Promise<void> {
  const response = await request(`/v1/creative/projects/${encodeURIComponent(projectId)}/exports/onecrew.zip`);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `OneCrew API returned ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${projectId}.onecrew.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
