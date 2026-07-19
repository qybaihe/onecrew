import type {
  CreativeGenerationBatch,
  ExperimentRecord,
  HumanGate,
  JobRecord,
  LocalizationRunRecord,
  PublishRecord,
  QcRunRecord,
  RenderRecord,
} from '@onecrew/contracts';

export interface VersionedRecord<T> {
  value: T;
  version: number;
}

export interface WorkbenchAuditEntry {
  auditId: string;
  source: string;
  eventId: string;
  action: string;
  outcome: 'accepted' | 'rejected' | 'failed';
  details: Record<string, unknown>;
  createdAt: string;
  projectId?: string;
  actorOpenId?: string;
  targetType?: string;
  targetId?: string;
}

export interface WorkbenchSnapshot {
  scope: { projectId: string | null };
  generatedAt: string;
  jobs: Array<VersionedRecord<JobRecord>>;
  batches: Array<VersionedRecord<CreativeGenerationBatch>>;
  qcRuns: Array<VersionedRecord<QcRunRecord>>;
  renders: Array<VersionedRecord<RenderRecord>>;
  localizations: Array<VersionedRecord<LocalizationRunRecord>>;
  publishes: Array<VersionedRecord<PublishRecord>>;
  humanGates: HumanGate[];
  audit: WorkbenchAuditEntry[];
  warnings: Array<{
    source: 'jobs' | 'batches' | 'qcRuns' | 'renders' | 'localizations' | 'publishes' | 'humanGates' | 'audit';
    error: string;
  }>;
}

export interface InfrastructureSnapshot {
  status: 'ready' | 'degraded';
  checkedAt: string;
  components: Record<string, { status: 'up' | 'down'; latencyMs?: number; errorType?: string }>;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { message?: string; error?: string };
  if (!response.ok) throw new Error(body.message ?? body.error ?? `OneCrew API returned ${response.status}`);
  return body;
}

async function resilientFetch(input: RequestInfo | URL): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(input);
      if (response.status !== 502 && response.status !== 503) return response;
      lastError = new Error(`OneCrew API is starting (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await new Promise((resolve) => window.setTimeout(resolve, attempt * 250));
  }
  throw lastError instanceof Error ? lastError : new Error('OneCrew API is unavailable');
}

export async function getWorkbenchSnapshot(projectId?: string): Promise<WorkbenchSnapshot> {
  const query = new URLSearchParams({ limit: '200' });
  if (projectId) query.set('projectId', projectId);
  return responseJson<WorkbenchSnapshot>(await resilientFetch(`/v1/workbench/snapshot?${query}`));
}

export async function getInfrastructureSnapshot(): Promise<InfrastructureSnapshot> {
  return responseJson<InfrastructureSnapshot>(await resilientFetch('/readyz'));
}

export async function listProjectExperiments(projectId: string): Promise<ExperimentRecord[]> {
  const response = await resilientFetch(`/v1/projects/${encodeURIComponent(projectId)}/experiments`);
  return (await responseJson<{ experiments: ExperimentRecord[] }>(response)).experiments;
}
