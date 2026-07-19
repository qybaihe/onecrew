import type {
  CreativeGenerationBatch,
  HumanGate,
  JobRecord,
  LocalizationRunRecord,
  PublishRecord,
  QcRunRecord,
  RenderRecord,
} from '@onecrew/contracts';
import type { AuditLogEntry, Versioned } from '@onecrew/db';
import type { FastifyInstance, FastifyReply } from 'fastify';

interface VersionedListRepository<T> {
  list(projectId?: string, limit?: number): Promise<Array<Versioned<T>>>;
}

interface BatchListRepository {
  listForProject(projectId: string, limit?: number): Promise<Array<Versioned<CreativeGenerationBatch>>>;
}

interface HumanGateListRepository {
  list(projectId?: string, limit?: number): Promise<HumanGate[]>;
}

interface AuditListRepository {
  list(projectId?: string, limit?: number): Promise<AuditLogEntry[]>;
}

export interface WorkbenchRouteOptions {
  jobs: VersionedListRepository<JobRecord>;
  batches: BatchListRepository;
  qcRuns: VersionedListRepository<QcRunRecord>;
  renders: VersionedListRepository<RenderRecord>;
  localizations: VersionedListRepository<LocalizationRunRecord>;
  publishes: VersionedListRepository<PublishRecord>;
  humanGates: HumanGateListRepository;
  audit: AuditListRepository;
}

export interface WorkbenchSourceWarning {
  source: keyof WorkbenchRouteOptions;
  error: string;
}

function requestedLimit(value: unknown): number {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(250, Math.max(1, parsed));
}

export function registerWorkbenchRoutes(app: FastifyInstance, options?: WorkbenchRouteOptions): void {
  app.get('/v1/workbench/snapshot', async (request, reply) => {
    if (!options) return workbenchError(reply, new WorkbenchRoutesNotConfiguredError());
    try {
      const query = request.query as { projectId?: string; limit?: string };
      const projectId = query.projectId?.trim() || undefined;
      const limit = requestedLimit(query.limit);
      const warnings: WorkbenchSourceWarning[] = [];
      const safeList = async <T>(source: WorkbenchSourceWarning['source'], loader: () => Promise<T>): Promise<T> => {
        try {
          return await loader();
        } catch (error) {
          warnings.push({ source, error: error instanceof Error ? error.name : 'UnknownError' });
          return [] as T;
        }
      };
      const [jobs, batches, qcRuns, renders, localizations, publishes, humanGates, audit] =
        await Promise.all([
          safeList('jobs', () => options.jobs.list(projectId, limit)),
          projectId ? safeList('batches', () => options.batches.listForProject(projectId, limit)) : Promise.resolve([]),
          safeList('qcRuns', () => options.qcRuns.list(projectId, limit)),
          safeList('renders', () => options.renders.list(projectId, limit)),
          safeList('localizations', () => options.localizations.list(projectId, limit)),
          safeList('publishes', () => options.publishes.list(projectId, limit)),
          safeList('humanGates', () => options.humanGates.list(projectId, limit)),
          safeList('audit', () => options.audit.list(projectId, limit)),
        ]);

      return {
        scope: projectId ? { projectId } : { projectId: null },
        generatedAt: new Date().toISOString(),
        jobs,
        batches,
        qcRuns,
        renders,
        localizations,
        publishes,
        humanGates,
        audit,
        warnings,
      };
    } catch (error) {
      return workbenchError(reply, error);
    }
  });
}

export class WorkbenchRoutesNotConfiguredError extends Error {
  constructor() {
    super('Workbench routes are not configured');
    this.name = 'WorkbenchRoutesNotConfiguredError';
  }
}

function workbenchError(reply: FastifyReply, error: unknown) {
  reply.code(error instanceof WorkbenchRoutesNotConfiguredError ? 503 : 500);
  return { ok: false, error: error instanceof Error ? error.name : 'UnknownError' };
}
