import type { AssetRecord, CreativeProjectBundle, ProjectSpec } from '@onecrew/contracts';

interface ProjectListResponse {
  projects: ProjectSpec[];
}

export interface CreativeProjectResponse {
  bundle: CreativeProjectBundle;
  assets: AssetRecord[];
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
  const projectId = `prj_studio_${Date.now()}`;
  const query = new URLSearchParams({ projectId, ownerOpenId: 'ou_local_studio' });
  const response = await request(`/v1/creative/imports/local-mini-drama/zip?${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });
  return json<CreativeImportResponse>(response);
}
