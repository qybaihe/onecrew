import {
  assetRecordSchema,
  characterSpecSchema,
  creativeEntitySchema,
  creativeProjectBundleSchema,
  episodeSpecSchema,
  feishuCardActionSchema,
  framePromptSpecSchema,
  humanGateSchema,
  experimentRecordSchema,
  jobRecordSchema,
  localePackRecordSchema,
  localizationRunRecordSchema,
  projectSpecSchema,
  providerCallbackSchema,
  providerRequestSchema,
  qcRecordSchema,
  qcRunRecordSchema,
  publishRecordSchema,
  renderRecordSchema,
  propSpecSchema,
  sceneSpecSchema,
  shotSpecSchema,
  type AssetRecord,
  type AssetStatus,
  type CreativeEntity,
  type CreativeProjectBundle,
  type EpisodeSpec,
  type FeishuCardAction,
  type FramePromptSpec,
  type HumanGate,
  type ExperimentRecord,
  type JobRecord,
  type JobStatus,
  type LocalePackRecord,
  type LocalizationRunRecord,
  type LocalizationRunStatus,
  type ProjectSpec,
  type ProjectStatus,
  type ProviderCallback,
  type ProviderMode,
  type ProviderRequest,
  type ProviderRoute,
  type QCRecord,
  type QcRunRecord,
  type QcRunStatus,
  type PublishRecord,
  type RenderRecord,
  type RenderStatus,
  type ShotSpec,
  type ShotStatus,
} from '@onecrew/contracts';
import {
  assertExpectedVersion,
  assertTransition,
  createInputHash,
  VersionConflictError,
} from '@onecrew/domain';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';

import type { OneCrewDatabase } from './client.js';
import {
  assets,
  auditLogs,
  creativeEntities,
  episodes,
  experiments,
  feishuRecordLinks,
  framePrompts,
  humanGates,
  idempotencyKeys,
  jobs,
  localePacks,
  localizationRuns,
  projects,
  providerCache,
  providerCallbacks,
  providerJobRuns,
  publishes,
  qcRecords,
  qcRuns,
  renders,
  shots,
} from './schema.js';

export class RecordNotFoundError extends Error {
  constructor(
    readonly entity: string,
    readonly id: string,
  ) {
    super(`${entity} not found: ${id}`);
    this.name = 'RecordNotFoundError';
  }
}

export class IdempotencyConflictError extends Error {
  constructor(readonly scope: string, readonly key: string) {
    super(`Idempotency key was reused with a different request: ${scope}/${key}`);
    this.name = 'IdempotencyConflictError';
  }
}

export class InvalidCreativeAssetBindingError extends Error {
  constructor(readonly assetIds: string[]) {
    super(`Creative entity references assets outside its project: ${assetIds.join(', ')}`);
    this.name = 'InvalidCreativeAssetBindingError';
  }
}

export interface Versioned<T> {
  value: T;
  version: number;
}

async function currentVersionOrThrow(
  db: OneCrewDatabase,
  entity: 'project' | 'episode' | 'creative_entity' | 'shot' | 'asset' | 'job' | 'render' | 'qc_run' | 'localization_run',
  id: string,
): Promise<number> {
  if (entity === 'project') {
    const [row] = await db.select({ version: projects.version }).from(projects).where(eq(projects.projectId, id));
    if (row) return row.version;
  }
  if (entity === 'episode') {
    const [row] = await db.select({ version: episodes.version }).from(episodes).where(eq(episodes.episodeId, id));
    if (row) return row.version;
  }
  if (entity === 'creative_entity') {
    const [row] = await db
      .select({ version: creativeEntities.version })
      .from(creativeEntities)
      .where(eq(creativeEntities.entityId, id));
    if (row) return row.version;
  }
  if (entity === 'shot') {
    const [row] = await db.select({ version: shots.version }).from(shots).where(eq(shots.shotId, id));
    if (row) return row.version;
  }
  if (entity === 'asset') {
    const [row] = await db.select({ version: assets.rowVersion }).from(assets).where(eq(assets.assetId, id));
    if (row) return row.version;
  }
  if (entity === 'job') {
    const [row] = await db.select({ version: jobs.version }).from(jobs).where(eq(jobs.jobId, id));
    if (row) return row.version;
  }
  if (entity === 'render') {
    const [row] = await db.select({ version: renders.version }).from(renders).where(eq(renders.renderId, id));
    if (row) return row.version;
  }
  if (entity === 'qc_run') {
    const [row] = await db.select({ version: qcRuns.version }).from(qcRuns).where(eq(qcRuns.qcRunId, id));
    if (row) return row.version;
  }
  if (entity === 'localization_run') {
    const [row] = await db
      .select({ version: localizationRuns.version })
      .from(localizationRuns)
      .where(eq(localizationRuns.localizationRunId, id));
    if (row) return row.version;
  }
  throw new RecordNotFoundError(entity, id);
}

async function throwVersionConflict(
  db: OneCrewDatabase,
  entity: 'project' | 'episode' | 'creative_entity' | 'shot' | 'asset' | 'job' | 'render' | 'qc_run' | 'localization_run',
  id: string,
  expectedVersion: number,
): Promise<never> {
  const actualVersion = await currentVersionOrThrow(db, entity, id);
  throw new VersionConflictError(expectedVersion, actualVersion);
}

export class ProjectRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: ProjectSpec): Promise<Versioned<ProjectSpec>> {
    const spec = projectSpecSchema.parse(input);
    const [row] = await this.db
      .insert(projects)
      .values({ projectId: spec.projectId, spec, status: spec.status })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created project');
    return { value: projectSpecSchema.parse(row.spec), version: row.version };
  }

  async get(projectId: string): Promise<Versioned<ProjectSpec>> {
    const [row] = await this.db.select().from(projects).where(eq(projects.projectId, projectId));
    if (!row) throw new RecordNotFoundError('project', projectId);
    return { value: projectSpecSchema.parse(row.spec), version: row.version };
  }

  async transition(
    projectId: string,
    expectedVersion: number,
    nextStatus: ProjectStatus,
  ): Promise<Versioned<ProjectSpec>> {
    const current = await this.get(projectId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('project', current.value.status, nextStatus);
    const next = projectSpecSchema.parse({ ...current.value, status: nextStatus });
    const [row] = await this.db
      .update(projects)
      .set({ spec: next, status: nextStatus, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(projects.projectId, projectId), eq(projects.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'project', projectId, expectedVersion);
    return { value: projectSpecSchema.parse(row.spec), version: row.version };
  }
}

export interface CreativeBundleImportResult {
  projectId: string;
  episodes: number;
  entities: number;
  shots: number;
  framePrompts: number;
  assets: number;
}

export interface CreativeRecordVersions {
  project: number;
  episodes: Record<string, number>;
  entities: Record<string, number>;
  shots: Record<string, number>;
  framePrompts: Record<string, number>;
}

export interface CreativeEditContext {
  editId: string;
  actorOpenId: string;
}

type EpisodeEditableField = 'title' | 'description' | 'scriptContent' | 'durationSec' | 'status';
type ShotEditableFields = Omit<ShotSpec, 'shotId' | 'projectId' | 'episodeId' | 'sequence'>;

export type CreativeEpisodePatch = {
  [Field in EpisodeEditableField]?: EpisodeSpec[Field] | undefined;
};

export type CreativeShotPatch = {
  [Field in keyof ShotEditableFields]?: ShotEditableFields[Field] | undefined;
};

export class CreativeRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async importBundle(
    input: CreativeProjectBundle,
    assetsToCreate: AssetRecord[] = [],
  ): Promise<CreativeBundleImportResult> {
    const bundle = creativeProjectBundleSchema.parse(input);
    const importedAssets = assetsToCreate.map((asset) => assetRecordSchema.parse(asset));
    await this.db.transaction(async (tx) => {
      await tx.insert(projects).values({
        projectId: bundle.project.projectId,
        spec: bundle.project,
        status: bundle.project.status,
      });
      if (bundle.episodes.length > 0) {
        await tx.insert(episodes).values(
          bundle.episodes.map((episode) => ({
            episodeId: episode.episodeId,
            projectId: episode.projectId,
            episodeNumber: episode.episodeNumber,
            spec: episode,
            status: episode.status,
          })),
        );
      }
      if (bundle.entities.length > 0) {
        await tx.insert(creativeEntities).values(
          bundle.entities.map((entity) => ({
            entityId: entity.entityId,
            projectId: entity.projectId,
            episodeId: entity.episodeId,
            kind: entity.kind,
            name: entity.name,
            spec: entity,
            status: entity.status,
          })),
        );
      }
      if (bundle.shots.length > 0) {
        await tx.insert(shots).values(
          bundle.shots.map((shot) => ({
            shotId: shot.shotId,
            projectId: shot.projectId,
            sequence: shot.sequence,
            spec: shot,
            status: shot.status,
          })),
        );
      }
      if (bundle.framePrompts.length > 0) {
        await tx.insert(framePrompts).values(
          bundle.framePrompts.map((framePrompt) => ({
            framePromptId: framePrompt.framePromptId,
            shotId: framePrompt.shotId,
            frameType: framePrompt.frameType,
            spec: framePrompt,
          })),
        );
      }
      if (importedAssets.length > 0) {
        await tx.insert(assets).values(
          importedAssets.map((record) => ({
            assetId: record.assetId,
            projectId: record.projectId,
            shotId: record.shotId,
            parentAssetId: record.parentAssetId,
            type: record.type,
            assetVersion: record.version,
            record,
            status: record.status,
            contentHash: record.contentHash,
          })),
        );
      }
    });
    return {
      projectId: bundle.project.projectId,
      episodes: bundle.episodes.length,
      entities: bundle.entities.length,
      shots: bundle.shots.length,
      framePrompts: bundle.framePrompts.length,
      assets: importedAssets.length,
    };
  }

  async getBundle(projectId: string): Promise<CreativeProjectBundle> {
    const [projectRow] = await this.db.select().from(projects).where(eq(projects.projectId, projectId));
    if (!projectRow) throw new RecordNotFoundError('project', projectId);
    const [episodeRows, entityRows, shotRows] = await Promise.all([
      this.db.select().from(episodes).where(eq(episodes.projectId, projectId)).orderBy(asc(episodes.episodeNumber)),
      this.db.select().from(creativeEntities).where(eq(creativeEntities.projectId, projectId)).orderBy(asc(creativeEntities.name)),
      this.db.select().from(shots).where(eq(shots.projectId, projectId)).orderBy(asc(shots.sequence)),
    ]);
    const shotIds = shotRows.map((row) => row.shotId);
    const frameRows = shotIds.length > 0
      ? await this.db.select().from(framePrompts).where(inArray(framePrompts.shotId, shotIds)).orderBy(asc(framePrompts.createdAt))
      : [];
    const project = projectSpecSchema.parse(projectRow.spec);
    return creativeProjectBundleSchema.parse({
      bundleVersion: '1.0',
      source: project.source ?? { system: 'onecrew' },
      project,
      episodes: episodeRows.map((row) => episodeSpecSchema.parse(row.spec)),
      entities: entityRows.map((row) => creativeEntitySchema.parse(row.spec)),
      shots: shotRows.map((row) => shotSpecSchema.parse(row.spec)),
      framePrompts: frameRows.map((row) => framePromptSpecSchema.parse(row.spec)),
      mediaFiles: [],
    });
  }

  async listProjects(): Promise<ProjectSpec[]> {
    const episodeProjects = await this.db.selectDistinct({ projectId: episodes.projectId }).from(episodes);
    if (episodeProjects.length === 0) return [];
    const rows = await this.db
      .select()
      .from(projects)
      .where(inArray(projects.projectId, episodeProjects.map((row) => row.projectId)))
      .orderBy(desc(projects.updatedAt));
    return rows.map((row) => projectSpecSchema.parse(row.spec));
  }

  async listAssets(projectId: string): Promise<AssetRecord[]> {
    const rows = await this.db
      .select()
      .from(assets)
      .where(eq(assets.projectId, projectId))
      .orderBy(desc(assets.createdAt));
    return rows.map((row) => assetRecordSchema.parse(row.record));
  }

  async getRecordVersions(projectId: string): Promise<CreativeRecordVersions> {
    const [projectRows, episodeRows, entityRows, shotRows] = await Promise.all([
      this.db.select({ projectId: projects.projectId, version: projects.version }).from(projects).where(eq(projects.projectId, projectId)),
      this.db.select({ id: episodes.episodeId, version: episodes.version }).from(episodes).where(eq(episodes.projectId, projectId)),
      this.db.select({ id: creativeEntities.entityId, version: creativeEntities.version }).from(creativeEntities).where(eq(creativeEntities.projectId, projectId)),
      this.db.select({ id: shots.shotId, version: shots.version }).from(shots).where(eq(shots.projectId, projectId)),
    ]);
    const [projectRow] = projectRows;
    if (!projectRow) throw new RecordNotFoundError('project', projectId);
    const shotIds = shotRows.map((row) => row.id);
    const frameRows = shotIds.length > 0
      ? await this.db.select({ id: framePrompts.framePromptId, version: framePrompts.version }).from(framePrompts).where(inArray(framePrompts.shotId, shotIds))
      : [];
    return {
      project: projectRow.version,
      episodes: Object.fromEntries(episodeRows.map((row) => [row.id, row.version])),
      entities: Object.fromEntries(entityRows.map((row) => [row.id, row.version])),
      shots: Object.fromEntries(shotRows.map((row) => [row.id, row.version])),
      framePrompts: Object.fromEntries(frameRows.map((row) => [row.id, row.version])),
    };
  }

  async updateEpisode(
    episodeId: string,
    expectedVersion: number,
    patch: CreativeEpisodePatch,
    context: CreativeEditContext,
  ): Promise<Versioned<EpisodeSpec>> {
    const [currentRow] = await this.db.select().from(episodes).where(eq(episodes.episodeId, episodeId));
    if (!currentRow) throw new RecordNotFoundError('episode', episodeId);
    assertExpectedVersion(expectedVersion, currentRow.version);
    const current = episodeSpecSchema.parse(currentRow.spec);
    const next = episodeSpecSchema.parse({
      ...current,
      ...patch,
      episodeId: current.episodeId,
      projectId: current.projectId,
      episodeNumber: current.episodeNumber,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(episodes)
        .set({ spec: next, status: next.status, version: expectedVersion + 1, updatedAt: new Date() })
        .where(and(eq(episodes.episodeId, episodeId), eq(episodes.version, expectedVersion)))
        .returning();
      if (!row) return throwVersionConflict(this.db, 'episode', episodeId, expectedVersion);
      await tx.insert(auditLogs).values({
        auditId: `audit_${createInputHash({ editId: context.editId, action: 'update_episode', episodeId }).slice(0, 32)}`,
        source: 'creative_studio',
        eventId: context.editId,
        projectId: current.projectId,
        actorOpenId: context.actorOpenId,
        action: 'update_episode',
        targetType: 'episode',
        targetId: episodeId,
        expectedVersion,
        outcome: 'accepted',
        details: { changedFields: Object.keys(patch), version: row.version },
      });
      return { value: episodeSpecSchema.parse(row.spec), version: row.version };
    });
  }

  async updateShot(
    shotId: string,
    expectedVersion: number,
    patch: CreativeShotPatch,
    context: CreativeEditContext,
  ): Promise<Versioned<ShotSpec>> {
    const [currentRow] = await this.db.select().from(shots).where(eq(shots.shotId, shotId));
    if (!currentRow) throw new RecordNotFoundError('shot', shotId);
    assertExpectedVersion(expectedVersion, currentRow.version);
    const current = shotSpecSchema.parse(currentRow.spec);
    const next = shotSpecSchema.parse({
      ...current,
      ...patch,
      shotId: current.shotId,
      projectId: current.projectId,
      episodeId: current.episodeId,
      sequence: current.sequence,
    });
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(shots)
        .set({ spec: next, status: next.status, version: expectedVersion + 1, updatedAt: new Date() })
        .where(and(eq(shots.shotId, shotId), eq(shots.version, expectedVersion)))
        .returning();
      if (!row) return throwVersionConflict(this.db, 'shot', shotId, expectedVersion);
      await tx.insert(auditLogs).values({
        auditId: `audit_${createInputHash({ editId: context.editId, action: 'update_shot', shotId }).slice(0, 32)}`,
        source: 'creative_studio',
        eventId: context.editId,
        projectId: current.projectId,
        actorOpenId: context.actorOpenId,
        action: 'update_shot',
        targetType: 'shot',
        targetId: shotId,
        expectedVersion,
        outcome: 'accepted',
        details: { changedFields: Object.keys(patch), version: row.version },
      });
      return { value: shotSpecSchema.parse(row.spec), version: row.version };
    });
  }

  async updateEntity(
    entityId: string,
    expectedVersion: number,
    patch: Record<string, unknown>,
    context: CreativeEditContext,
  ): Promise<Versioned<CreativeEntity>> {
    const [currentRow] = await this.db.select().from(creativeEntities).where(eq(creativeEntities.entityId, entityId));
    if (!currentRow) throw new RecordNotFoundError('creative_entity', entityId);
    assertExpectedVersion(expectedVersion, currentRow.version);
    const current = creativeEntitySchema.parse(currentRow.spec);
    const candidate = {
      ...current,
      ...patch,
      entityId: current.entityId,
      projectId: current.projectId,
      episodeId: current.episodeId,
      kind: current.kind,
    };
    const next = current.kind === 'character'
      ? characterSpecSchema.strict().parse(candidate)
      : current.kind === 'scene'
        ? sceneSpecSchema.strict().parse(candidate)
        : propSpecSchema.strict().parse(candidate);
    if (patch.referenceAssetIds !== undefined && next.referenceAssetIds.length > 0) {
      const boundAssets = await this.db
        .select({ assetId: assets.assetId, projectId: assets.projectId })
        .from(assets)
        .where(inArray(assets.assetId, next.referenceAssetIds));
      const validAssetIds = new Set(
        boundAssets.filter((asset) => asset.projectId === current.projectId).map((asset) => asset.assetId),
      );
      const invalidAssetIds = next.referenceAssetIds.filter((assetId) => !validAssetIds.has(assetId));
      if (invalidAssetIds.length > 0) throw new InvalidCreativeAssetBindingError(invalidAssetIds);
    }
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(creativeEntities)
        .set({
          spec: next,
          name: next.name,
          status: next.status,
          version: expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(creativeEntities.entityId, entityId), eq(creativeEntities.version, expectedVersion)))
        .returning();
      if (!row) return throwVersionConflict(this.db, 'creative_entity', entityId, expectedVersion);
      await tx.insert(auditLogs).values({
        auditId: `audit_${createInputHash({ editId: context.editId, action: 'update_creative_entity', entityId }).slice(0, 32)}`,
        source: 'creative_studio',
        eventId: context.editId,
        projectId: current.projectId,
        actorOpenId: context.actorOpenId,
        action: 'update_creative_entity',
        targetType: current.kind,
        targetId: entityId,
        expectedVersion,
        outcome: 'accepted',
        details: { changedFields: Object.keys(patch), version: row.version },
      });
      return { value: creativeEntitySchema.parse(row.spec), version: row.version };
    });
  }

  async createEpisode(input: EpisodeSpec): Promise<Versioned<EpisodeSpec>> {
    const spec = episodeSpecSchema.parse(input);
    const [row] = await this.db
      .insert(episodes)
      .values({
        episodeId: spec.episodeId,
        projectId: spec.projectId,
        episodeNumber: spec.episodeNumber,
        spec,
        status: spec.status,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created episode');
    return { value: episodeSpecSchema.parse(row.spec), version: row.version };
  }

  async createEntity(input: CreativeEntity): Promise<Versioned<CreativeEntity>> {
    const spec = creativeEntitySchema.parse(input);
    const [row] = await this.db
      .insert(creativeEntities)
      .values({
        entityId: spec.entityId,
        projectId: spec.projectId,
        episodeId: spec.episodeId,
        kind: spec.kind,
        name: spec.name,
        spec,
        status: spec.status,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created creative entity');
    return { value: creativeEntitySchema.parse(row.spec), version: row.version };
  }

  async createFramePrompt(input: FramePromptSpec): Promise<Versioned<FramePromptSpec>> {
    const spec = framePromptSpecSchema.parse(input);
    const [row] = await this.db
      .insert(framePrompts)
      .values({
        framePromptId: spec.framePromptId,
        shotId: spec.shotId,
        frameType: spec.frameType,
        spec,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created frame prompt');
    return { value: framePromptSpecSchema.parse(row.spec), version: row.version };
  }
}

export class ShotRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: ShotSpec): Promise<Versioned<ShotSpec>> {
    const spec = shotSpecSchema.parse(input);
    const [row] = await this.db
      .insert(shots)
      .values({
        shotId: spec.shotId,
        projectId: spec.projectId,
        sequence: spec.sequence,
        spec,
        status: spec.status,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created shot');
    return { value: shotSpecSchema.parse(row.spec), version: row.version };
  }

  async get(shotId: string): Promise<Versioned<ShotSpec>> {
    const [row] = await this.db.select().from(shots).where(eq(shots.shotId, shotId));
    if (!row) throw new RecordNotFoundError('shot', shotId);
    return { value: shotSpecSchema.parse(row.spec), version: row.version };
  }

  async transition(shotId: string, expectedVersion: number, nextStatus: ShotStatus): Promise<Versioned<ShotSpec>> {
    const current = await this.get(shotId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('shot', current.value.status, nextStatus);
    const next = shotSpecSchema.parse({ ...current.value, status: nextStatus });
    const [row] = await this.db
      .update(shots)
      .set({ spec: next, status: nextStatus, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(shots.shotId, shotId), eq(shots.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'shot', shotId, expectedVersion);
    return { value: shotSpecSchema.parse(row.spec), version: row.version };
  }
}

export class AssetRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: AssetRecord): Promise<Versioned<AssetRecord>> {
    const record = assetRecordSchema.parse(input);
    const [row] = await this.db
      .insert(assets)
      .values({
        assetId: record.assetId,
        projectId: record.projectId,
        shotId: record.shotId,
        parentAssetId: record.parentAssetId,
        type: record.type,
        assetVersion: record.version,
        record,
        status: record.status,
        contentHash: record.contentHash,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) return this.get(record.assetId);
    return { value: assetRecordSchema.parse(row.record), version: row.rowVersion };
  }

  async latestForShot(
    projectId: string,
    shotId: string,
    type: AssetRecord['type'],
  ): Promise<Versioned<AssetRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(assets)
      .where(
        and(
          eq(assets.projectId, projectId),
          eq(assets.shotId, shotId),
          eq(assets.type, type),
        ),
      )
      .orderBy(desc(assets.assetVersion), desc(assets.createdAt))
      .limit(1);
    if (!row) return undefined;
    return { value: assetRecordSchema.parse(row.record), version: row.rowVersion };
  }

  async get(assetId: string): Promise<Versioned<AssetRecord>> {
    const [row] = await this.db.select().from(assets).where(eq(assets.assetId, assetId));
    if (!row) throw new RecordNotFoundError('asset', assetId);
    return { value: assetRecordSchema.parse(row.record), version: row.rowVersion };
  }

  async transition(assetId: string, expectedVersion: number, nextStatus: AssetStatus): Promise<Versioned<AssetRecord>> {
    const current = await this.get(assetId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('asset', current.value.status, nextStatus);
    const next = assetRecordSchema.parse({
      ...current.value,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(assets)
      .set({ record: next, status: nextStatus, rowVersion: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(assets.assetId, assetId), eq(assets.rowVersion, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'asset', assetId, expectedVersion);
    return { value: assetRecordSchema.parse(row.record), version: row.rowVersion };
  }
}

export class JobRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: JobRecord, idempotencyKey: string): Promise<Versioned<JobRecord>> {
    const record = jobRecordSchema.parse(input);
    const [row] = await this.db
      .insert(jobs)
      .values({
        jobId: record.jobId,
        projectId: record.projectId,
        shotId: record.shotId,
        capability: record.capability,
        provider: record.provider,
        model: record.model,
        mode: record.mode,
        status: record.status,
        attempt: record.attempt,
        estimatedCostCny: record.estimatedCostCny?.toString(),
        actualCostCny: record.actualCostCny?.toString(),
        inputHash: record.inputHash,
        idempotencyKey,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created job');
    return { value: jobRecordSchema.parse(row.record), version: row.version };
  }

  async get(jobId: string): Promise<Versioned<JobRecord>> {
    const [row] = await this.db.select().from(jobs).where(eq(jobs.jobId, jobId));
    if (!row) throw new RecordNotFoundError('job', jobId);
    return { value: jobRecordSchema.parse(row.record), version: row.version };
  }

  async getByIdempotency(projectId: string, idempotencyKey: string): Promise<Versioned<JobRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.projectId, projectId), eq(jobs.idempotencyKey, idempotencyKey)));
    if (!row) return undefined;
    return { value: jobRecordSchema.parse(row.record), version: row.version };
  }

  async committedCostCny(projectId: string): Promise<number> {
    const [row] = await this.db
      .select({
        total: sql<string>`coalesce(sum(coalesce(${jobs.actualCostCny}, ${jobs.estimatedCostCny}, 0)), 0)`,
      })
      .from(jobs)
      .where(eq(jobs.projectId, projectId));
    return Number(row?.total ?? 0);
  }

  async transition(
    jobId: string,
    expectedVersion: number,
    nextStatus: JobStatus,
    patch: Partial<
      Pick<
        JobRecord,
        | 'provider'
        | 'model'
        | 'attempt'
        | 'estimatedCostCny'
        | 'actualCostCny'
        | 'latencyMs'
        | 'errorCode'
        | 'errorMessage'
        | 'outputAssetIds'
      >
    > = {},
  ): Promise<Versioned<JobRecord>> {
    const current = await this.get(jobId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('job', current.value.status, nextStatus);
    const next = jobRecordSchema.parse({
      ...current.value,
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(jobs)
      .set({
        record: next,
        status: nextStatus,
        provider: next.provider,
        model: next.model,
        attempt: next.attempt,
        ...(next.estimatedCostCny === undefined
          ? {}
          : { estimatedCostCny: next.estimatedCostCny.toString() }),
        ...(next.actualCostCny === undefined ? {} : { actualCostCny: next.actualCostCny.toString() }),
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.jobId, jobId), eq(jobs.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'job', jobId, expectedVersion);
    return { value: jobRecordSchema.parse(row.record), version: row.version };
  }
}

export class QcRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: QCRecord): Promise<QCRecord> {
    const record = qcRecordSchema.parse(input);
    const [row] = await this.db
      .insert(qcRecords)
      .values({
        qcId: record.qcId,
        projectId: record.projectId,
        shotId: record.shotId,
        decision: record.decision,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created QC record');
    return qcRecordSchema.parse(row.record);
  }

  async get(qcId: string): Promise<QCRecord> {
    const [row] = await this.db.select().from(qcRecords).where(eq(qcRecords.qcId, qcId));
    if (!row) throw new RecordNotFoundError('qc', qcId);
    return qcRecordSchema.parse(row.record);
  }
}

type QcRunPatch = Partial<
  Pick<
    QcRunRecord,
    | 'technicalReport'
    | 'semanticReport'
    | 'decision'
    | 'reason'
    | 'retryPatch'
    | 'vlmJobId'
    | 'remediationJobId'
    | 'remediationRenderId'
    | 'qcRecordId'
    | 'gateId'
    | 'reviewCard'
    | 'reviewDelivery'
    | 'errorCode'
    | 'errorMessage'
  >
>;

export class QcRunRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: QcRunRecord, idempotencyKey: string): Promise<Versioned<QcRunRecord>> {
    const record = qcRunRecordSchema.parse(input);
    const [row] = await this.db
      .insert(qcRuns)
      .values({
        qcRunId: record.qcRunId,
        projectId: record.request.projectId,
        shotId: record.request.shotId,
        sourceJobId: record.request.sourceJobId,
        status: record.status,
        idempotencyKey,
        request: record.request,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created QC run');
    return { value: qcRunRecordSchema.parse(row.record), version: row.version };
  }

  async get(qcRunId: string): Promise<Versioned<QcRunRecord>> {
    const [row] = await this.db.select().from(qcRuns).where(eq(qcRuns.qcRunId, qcRunId));
    if (!row) throw new RecordNotFoundError('qc_run', qcRunId);
    return { value: qcRunRecordSchema.parse(row.record), version: row.version };
  }

  async getByIdempotency(
    projectId: string,
    idempotencyKey: string,
  ): Promise<Versioned<QcRunRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(qcRuns)
      .where(and(eq(qcRuns.projectId, projectId), eq(qcRuns.idempotencyKey, idempotencyKey)));
    if (!row) return undefined;
    return { value: qcRunRecordSchema.parse(row.record), version: row.version };
  }

  async transition(
    qcRunId: string,
    expectedVersion: number,
    nextStatus: QcRunStatus,
    patch: QcRunPatch = {},
  ): Promise<Versioned<QcRunRecord>> {
    const current = await this.get(qcRunId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('qc_run', current.value.status, nextStatus);
    const next = qcRunRecordSchema.parse({
      ...current.value,
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(qcRuns)
      .set({ record: next, status: nextStatus, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(qcRuns.qcRunId, qcRunId), eq(qcRuns.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'qc_run', qcRunId, expectedVersion);
    return { value: qcRunRecordSchema.parse(row.record), version: row.version };
  }

  async patch(
    qcRunId: string,
    expectedVersion: number,
    patch: QcRunPatch,
  ): Promise<Versioned<QcRunRecord>> {
    const current = await this.get(qcRunId);
    assertExpectedVersion(expectedVersion, current.version);
    const next = qcRunRecordSchema.parse({
      ...current.value,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(qcRuns)
      .set({ record: next, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(qcRuns.qcRunId, qcRunId), eq(qcRuns.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'qc_run', qcRunId, expectedVersion);
    return { value: qcRunRecordSchema.parse(row.record), version: row.version };
  }
}

type LocalizationRunPatch = Partial<
  Pick<
    LocalizationRunRecord,
    | 'translationJobId'
    | 'ttsJobIds'
    | 'localePackId'
    | 'localePack'
    | 'localizedShots'
    | 'mode'
    | 'errorCode'
    | 'errorMessage'
  >
>;

export class LocalizationRunRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: LocalizationRunRecord, idempotencyKey: string): Promise<Versioned<LocalizationRunRecord>> {
    const record = localizationRunRecordSchema.parse(input);
    const [row] = await this.db
      .insert(localizationRuns)
      .values({
        localizationRunId: record.localizationRunId,
        projectId: record.request.projectId,
        status: record.status,
        idempotencyKey,
        request: record.request,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created localization run');
    return { value: localizationRunRecordSchema.parse(row.record), version: row.version };
  }

  async get(localizationRunId: string): Promise<Versioned<LocalizationRunRecord>> {
    const [row] = await this.db
      .select()
      .from(localizationRuns)
      .where(eq(localizationRuns.localizationRunId, localizationRunId));
    if (!row) throw new RecordNotFoundError('localization_run', localizationRunId);
    return { value: localizationRunRecordSchema.parse(row.record), version: row.version };
  }

  async getByIdempotency(
    projectId: string,
    idempotencyKey: string,
  ): Promise<Versioned<LocalizationRunRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(localizationRuns)
      .where(
        and(
          eq(localizationRuns.projectId, projectId),
          eq(localizationRuns.idempotencyKey, idempotencyKey),
        ),
      );
    return row ? { value: localizationRunRecordSchema.parse(row.record), version: row.version } : undefined;
  }

  async transition(
    localizationRunId: string,
    expectedVersion: number,
    status: LocalizationRunStatus,
    patch: LocalizationRunPatch = {},
  ): Promise<Versioned<LocalizationRunRecord>> {
    const current = await this.get(localizationRunId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('localization_run', current.value.status, status);
    const next = localizationRunRecordSchema.parse({
      ...current.value,
      ...patch,
      status,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(localizationRuns)
      .set({ record: next, status, version: expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(localizationRuns.localizationRunId, localizationRunId),
          eq(localizationRuns.version, expectedVersion),
        ),
      )
      .returning();
    if (!row) {
      return throwVersionConflict(this.db, 'localization_run', localizationRunId, expectedVersion);
    }
    return { value: localizationRunRecordSchema.parse(row.record), version: row.version };
  }

  async patch(
    localizationRunId: string,
    expectedVersion: number,
    patch: LocalizationRunPatch,
  ): Promise<Versioned<LocalizationRunRecord>> {
    const current = await this.get(localizationRunId);
    assertExpectedVersion(expectedVersion, current.version);
    const next = localizationRunRecordSchema.parse({
      ...current.value,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(localizationRuns)
      .set({ record: next, version: expectedVersion + 1, updatedAt: new Date() })
      .where(
        and(
          eq(localizationRuns.localizationRunId, localizationRunId),
          eq(localizationRuns.version, expectedVersion),
        ),
      )
      .returning();
    if (!row) {
      return throwVersionConflict(this.db, 'localization_run', localizationRunId, expectedVersion);
    }
    return { value: localizationRunRecordSchema.parse(row.record), version: row.version };
  }
}

export class LocalePackRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: LocalePackRecord): Promise<LocalePackRecord> {
    const record = localePackRecordSchema.parse(input);
    const [row] = await this.db
      .insert(localePacks)
      .values({
        localePackId: record.localePackId,
        projectId: record.projectId,
        locale: record.locale,
        packVersion: record.version,
        contentHash: record.contentHash,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created Locale Pack');
    return localePackRecordSchema.parse(row.record);
  }

  async get(localePackId: string): Promise<LocalePackRecord> {
    const [row] = await this.db.select().from(localePacks).where(eq(localePacks.localePackId, localePackId));
    if (!row) throw new RecordNotFoundError('locale_pack', localePackId);
    return localePackRecordSchema.parse(row.record);
  }

  async latest(projectId: string, locale: LocalePackRecord['locale']): Promise<LocalePackRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(localePacks)
      .where(and(eq(localePacks.projectId, projectId), eq(localePacks.locale, locale)))
      .orderBy(desc(localePacks.packVersion))
      .limit(1);
    return row ? localePackRecordSchema.parse(row.record) : undefined;
  }
}

export class PublishRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: PublishRecord, idempotencyKey: string): Promise<Versioned<PublishRecord>> {
    const record = publishRecordSchema.parse(input);
    const [row] = await this.db
      .insert(publishes)
      .values({
        publishId: record.publishId,
        projectId: record.request.projectId,
        status: record.status,
        idempotencyKey,
        request: record.request,
        record,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created publish');
    return { value: publishRecordSchema.parse(row.record), version: row.version };
  }

  async get(publishId: string): Promise<Versioned<PublishRecord>> {
    const [row] = await this.db.select().from(publishes).where(eq(publishes.publishId, publishId));
    if (!row) throw new RecordNotFoundError('publish', publishId);
    return { value: publishRecordSchema.parse(row.record), version: row.version };
  }

  async getByIdempotency(projectId: string, idempotencyKey: string): Promise<Versioned<PublishRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(publishes)
      .where(and(eq(publishes.projectId, projectId), eq(publishes.idempotencyKey, idempotencyKey)));
    return row ? { value: publishRecordSchema.parse(row.record), version: row.version } : undefined;
  }

  async patch(
    publishId: string,
    expectedVersion: number,
    patch: Partial<Omit<PublishRecord, 'publishId' | 'request' | 'createdAt'>>,
  ): Promise<Versioned<PublishRecord>> {
    const current = await this.get(publishId);
    assertExpectedVersion(expectedVersion, current.version);
    const next = publishRecordSchema.parse({
      ...current.value,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(publishes)
      .set({ record: next, status: next.status, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(publishes.publishId, publishId), eq(publishes.version, expectedVersion)))
      .returning();
    if (!row) throw new VersionConflictError(expectedVersion, (await this.get(publishId)).version);
    return { value: publishRecordSchema.parse(row.record), version: row.version };
  }
}

export class ExperimentRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async upsert(input: ExperimentRecord): Promise<ExperimentRecord> {
    const record = experimentRecordSchema.parse(input);
    const [row] = await this.db
      .insert(experiments)
      .values({
        experimentId: record.experimentId,
        projectId: record.projectId,
        creativeId: record.creativeId,
        language: record.language,
        platform: record.platform,
        record,
      })
      .onConflictDoUpdate({
        target: experiments.experimentId,
        set: { record, updatedAt: new Date() },
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the experiment record');
    return experimentRecordSchema.parse(row.record);
  }

  async listByProject(projectId: string): Promise<ExperimentRecord[]> {
    const rows = await this.db
      .select()
      .from(experiments)
      .where(eq(experiments.projectId, projectId))
      .orderBy(desc(experiments.createdAt));
    return rows.map((row) => experimentRecordSchema.parse(row.record));
  }
}

export class RenderRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: RenderRecord): Promise<Versioned<RenderRecord>> {
    const record = renderRecordSchema.parse(input);
    const [row] = await this.db
      .insert(renders)
      .values({
        renderId: record.renderId,
        projectId: record.projectId,
        compositionId: record.manifest.compositionId,
        locale: record.manifest.locale,
        aspectRatio: record.manifest.aspectRatio,
        manifest: record.manifest,
        renderMode: record.renderMode,
        record,
        manifestHash: record.manifestHash,
        designPackVersion: record.designPackVersion,
        codeVersion: record.codeVersion,
        status: record.status,
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the created render');
    return { value: renderRecordSchema.parse(row.record), version: row.version };
  }

  async get(renderId: string): Promise<Versioned<RenderRecord>> {
    const [row] = await this.db.select().from(renders).where(eq(renders.renderId, renderId));
    if (!row) throw new RecordNotFoundError('render', renderId);
    return { value: renderRecordSchema.parse(row.record), version: row.version };
  }

  async findSucceeded(
    manifestHash: string,
    renderMode: RenderRecord['renderMode'],
    codeVersion: string,
  ): Promise<Versioned<RenderRecord> | undefined> {
    const [row] = await this.db
      .select()
      .from(renders)
      .where(
        and(
          eq(renders.manifestHash, manifestHash),
          eq(renders.renderMode, renderMode),
          eq(renders.codeVersion, codeVersion),
          eq(renders.status, 'succeeded'),
        ),
      )
      .orderBy(desc(renders.updatedAt))
      .limit(1);
    if (!row) return undefined;
    return { value: renderRecordSchema.parse(row.record), version: row.version };
  }

  async transition(
    renderId: string,
    expectedVersion: number,
    nextStatus: RenderStatus,
    patch: Pick<RenderRecord, 'outputUri' | 'errorCode' | 'errorMessage'> = {},
  ): Promise<Versioned<RenderRecord>> {
    const current = await this.get(renderId);
    assertExpectedVersion(expectedVersion, current.version);
    assertTransition('render', current.value.status, nextStatus);
    const next = renderRecordSchema.parse({
      ...current.value,
      ...patch,
      status: nextStatus,
      updatedAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .update(renders)
      .set({ record: next, status: nextStatus, version: expectedVersion + 1, updatedAt: new Date() })
      .where(and(eq(renders.renderId, renderId), eq(renders.version, expectedVersion)))
      .returning();
    if (!row) return throwVersionConflict(this.db, 'render', renderId, expectedVersion);
    return { value: renderRecordSchema.parse(row.record), version: row.version };
  }
}

export interface IdempotencyReservation {
  state: 'reserved' | 'in_progress' | 'replayed';
  response?: unknown;
  resourceType?: string;
  resourceId?: string;
}

export class IdempotencyRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async reserve(scope: string, key: string, requestHash: string): Promise<IdempotencyReservation> {
    const [inserted] = await this.db
      .insert(idempotencyKeys)
      .values({ scope, key, requestHash })
      .onConflictDoNothing()
      .returning();
    if (inserted) return { state: 'reserved' };

    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!existing) throw new Error('Idempotency reservation disappeared after a conflict');
    if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(scope, key);

    if (existing.completedAt) {
      return {
        state: 'replayed',
        response: existing.response,
        ...(existing.resourceType ? { resourceType: existing.resourceType } : {}),
        ...(existing.resourceId ? { resourceId: existing.resourceId } : {}),
      };
    }
    return { state: 'in_progress' };
  }

  async complete(
    scope: string,
    key: string,
    requestHash: string,
    result: { response: unknown; resourceType: string; resourceId: string },
  ): Promise<void> {
    const [updated] = await this.db
      .update(idempotencyKeys)
      .set({
        response: result.response,
        resourceType: result.resourceType,
        resourceId: result.resourceId,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.requestHash, requestHash),
        ),
      )
      .returning({ key: idempotencyKeys.key });
    if (!updated) throw new IdempotencyConflictError(scope, key);
  }

  async release(scope: string, key: string, requestHash: string): Promise<void> {
    await this.db
      .delete(idempotencyKeys)
      .where(
        and(
          eq(idempotencyKeys.scope, scope),
          eq(idempotencyKeys.key, key),
          eq(idempotencyKeys.requestHash, requestHash),
          isNull(idempotencyKeys.completedAt),
        ),
      );
  }
}

export interface OpenHumanGateInput {
  gateId: string;
  workflowId: string;
  projectId: string;
  node: string;
  targetType: HumanGate['targetType'];
  targetId: string;
  expectedTargetVersion: number;
}

export class HumanGateRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async open(input: OpenHumanGateInput): Promise<HumanGate> {
    const state = humanGateSchema.parse({
      ...input,
      status: 'waiting',
      version: 1,
      createdAt: new Date().toISOString(),
    });
    const [row] = await this.db
      .insert(humanGates)
      .values({
        gateId: state.gateId,
        workflowId: state.workflowId,
        projectId: state.projectId,
        node: state.node,
        targetType: state.targetType,
        targetId: state.targetId,
        expectedTargetVersion: state.expectedTargetVersion,
        status: state.status,
        state,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return humanGateSchema.parse(row.state);

    const existing = await this.get(state.gateId);
    if (
      existing.workflowId !== state.workflowId ||
      existing.projectId !== state.projectId ||
      existing.node !== state.node ||
      existing.targetType !== state.targetType ||
      existing.targetId !== state.targetId ||
      existing.expectedTargetVersion !== state.expectedTargetVersion
    ) {
      throw new InvalidHumanGateResolutionError(
        state.gateId,
        'an existing gate with this ID has different immutable fields',
      );
    }
    return existing;
  }

  async get(gateId: string): Promise<HumanGate> {
    const [row] = await this.db.select().from(humanGates).where(eq(humanGates.gateId, gateId));
    if (!row) throw new RecordNotFoundError('human_gate', gateId);
    return humanGateSchema.parse(row.state);
  }

  async findWaiting(
    projectId: string,
    targetType: HumanGate['targetType'],
    targetId: string,
  ): Promise<HumanGate> {
    const [row] = await this.db
      .select()
      .from(humanGates)
      .where(
        and(
          eq(humanGates.projectId, projectId),
          eq(humanGates.targetType, targetType),
          eq(humanGates.targetId, targetId),
          eq(humanGates.status, 'waiting'),
        ),
      )
      .orderBy(desc(humanGates.createdAt))
      .limit(1);
    if (!row) throw new RecordNotFoundError('waiting_human_gate', `${targetType}/${targetId}`);
    return humanGateSchema.parse(row.state);
  }

  async resolve(gateId: string, expectedGateVersion: number, input: FeishuCardAction): Promise<HumanGate> {
    const action = feishuCardActionSchema.parse(input);
    const current = await this.get(gateId);
    assertExpectedVersion(expectedGateVersion, current.version);
    if (current.status !== 'waiting') {
      throw new InvalidHumanGateResolutionError(gateId, `gate status is ${current.status}`);
    }
    if (
      current.projectId !== action.projectId ||
      current.targetType !== action.targetType ||
      current.targetId !== action.targetId ||
      current.expectedTargetVersion !== action.expectedVersion
    ) {
      throw new InvalidHumanGateResolutionError(gateId, 'action target or version does not match gate');
    }

    const resolvedAt = new Date();
    const next = humanGateSchema.parse({
      ...current,
      status: action.action === 'manual' ? 'cancelled' : 'resolved',
      resolution: action.action,
      actorOpenId: action.actorOpenId,
      eventId: action.eventId,
      version: expectedGateVersion + 1,
      resolvedAt: resolvedAt.toISOString(),
    });
    const [row] = await this.db
      .update(humanGates)
      .set({
        status: next.status,
        resolution: next.resolution,
        actorOpenId: next.actorOpenId,
        eventId: next.eventId,
        state: next,
        version: next.version,
        resolvedAt,
      })
      .where(
        and(
          eq(humanGates.gateId, gateId),
          eq(humanGates.version, expectedGateVersion),
          eq(humanGates.status, 'waiting'),
        ),
      )
      .returning();
    if (!row) {
      const latest = await this.get(gateId);
      throw new VersionConflictError(expectedGateVersion, latest.version);
    }
    return humanGateSchema.parse(row.state);
  }
}

export class InvalidHumanGateResolutionError extends Error {
  constructor(readonly gateId: string, reason: string) {
    super(`Cannot resolve human gate ${gateId}: ${reason}`);
    this.name = 'InvalidHumanGateResolutionError';
  }
}

export interface AuditLogInput {
  auditId: string;
  source:
    | 'feishu_event'
    | 'feishu_card'
    | 'feishu_base_sync'
    | 'provider_gateway'
    | 'provider_callback'
    | 'creative_studio'
    | 'workflow';
  eventId: string;
  action: string;
  outcome: 'accepted' | 'rejected' | 'failed';
  details: Record<string, unknown>;
  projectId?: string;
  actorOpenId?: string;
  targetType?: string;
  targetId?: string;
  expectedVersion?: number;
}

export class AuditRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async record(input: AuditLogInput): Promise<void> {
    await this.db
      .insert(auditLogs)
      .values(input)
      .onConflictDoNothing();
  }
}

export interface FeishuRecordLink {
  entityType: string;
  entityId: string;
  appToken: string;
  tableId: string;
  recordId: string;
  localVersion: number;
  remoteRevision?: number;
  fieldHash: string;
}

export class FeishuRecordLinkRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async get(entityType: string, entityId: string): Promise<FeishuRecordLink | undefined> {
    const [row] = await this.db
      .select()
      .from(feishuRecordLinks)
      .where(and(eq(feishuRecordLinks.entityType, entityType), eq(feishuRecordLinks.entityId, entityId)));
    if (!row) return undefined;
    return {
      entityType: row.entityType,
      entityId: row.entityId,
      appToken: row.appToken,
      tableId: row.tableId,
      recordId: row.recordId,
      localVersion: row.localVersion,
      ...(row.remoteRevision === null ? {} : { remoteRevision: row.remoteRevision }),
      fieldHash: row.fieldHash,
    };
  }

  async getByRemote(
    appToken: string,
    tableId: string,
    recordId: string,
  ): Promise<FeishuRecordLink | undefined> {
    const [row] = await this.db
      .select()
      .from(feishuRecordLinks)
      .where(
        and(
          eq(feishuRecordLinks.appToken, appToken),
          eq(feishuRecordLinks.tableId, tableId),
          eq(feishuRecordLinks.recordId, recordId),
        ),
      );
    if (!row) return undefined;
    return {
      entityType: row.entityType,
      entityId: row.entityId,
      appToken: row.appToken,
      tableId: row.tableId,
      recordId: row.recordId,
      localVersion: row.localVersion,
      ...(row.remoteRevision === null ? {} : { remoteRevision: row.remoteRevision }),
      fieldHash: row.fieldHash,
    };
  }

  async upsert(input: Omit<FeishuRecordLink, 'fieldHash'> & { fields: Record<string, unknown> }): Promise<FeishuRecordLink> {
    const fieldHash = createInputHash(input.fields);
    const [row] = await this.db
      .insert(feishuRecordLinks)
      .values({
        entityType: input.entityType,
        entityId: input.entityId,
        appToken: input.appToken,
        tableId: input.tableId,
        recordId: input.recordId,
        localVersion: input.localVersion,
        remoteRevision: input.remoteRevision,
        fieldHash,
      })
      .onConflictDoUpdate({
        target: [feishuRecordLinks.entityType, feishuRecordLinks.entityId],
        set: {
          appToken: input.appToken,
          tableId: input.tableId,
          recordId: input.recordId,
          localVersion: input.localVersion,
          remoteRevision: input.remoteRevision,
          fieldHash,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the Feishu record link');
    return {
      entityType: row.entityType,
      entityId: row.entityId,
      appToken: row.appToken,
      tableId: row.tableId,
      recordId: row.recordId,
      localVersion: row.localVersion,
      ...(row.remoteRevision === null ? {} : { remoteRevision: row.remoteRevision }),
      fieldHash: row.fieldHash,
    };
  }
}

export interface ProviderJobRun {
  jobId: string;
  route: ProviderRoute;
  request: ProviderRequest;
  queueJobId?: string;
  externalJobId?: string;
  callbackUrl?: string;
  submittedAt?: string;
  completedAt?: string;
}

function mapProviderJobRun(row: typeof providerJobRuns.$inferSelect): ProviderJobRun {
  return {
    jobId: row.jobId,
    route: row.route,
    request: providerRequestSchema.parse(row.request),
    ...(row.queueJobId ? { queueJobId: row.queueJobId } : {}),
    ...(row.externalJobId ? { externalJobId: row.externalJobId } : {}),
    ...(row.callbackUrl ? { callbackUrl: row.callbackUrl } : {}),
    ...(row.submittedAt ? { submittedAt: row.submittedAt.toISOString() } : {}),
    ...(row.completedAt ? { completedAt: row.completedAt.toISOString() } : {}),
  };
}

export class ProviderJobRunRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async create(input: {
    jobId: string;
    route: ProviderRoute;
    request: ProviderRequest;
    callbackUrl?: string;
  }): Promise<ProviderJobRun> {
    const request = providerRequestSchema.parse(input.request);
    const [row] = await this.db
      .insert(providerJobRuns)
      .values({
        jobId: input.jobId,
        route: input.route,
        request,
        ...(input.callbackUrl ? { callbackUrl: input.callbackUrl } : {}),
      })
      .returning();
    if (!row) throw new Error('PostgreSQL did not return the Provider Job Run');
    return mapProviderJobRun(row);
  }

  async get(jobId: string): Promise<ProviderJobRun> {
    const [row] = await this.db.select().from(providerJobRuns).where(eq(providerJobRuns.jobId, jobId));
    if (!row) throw new RecordNotFoundError('provider_job_run', jobId);
    return mapProviderJobRun(row);
  }

  async findByExternal(provider: string, externalJobId: string): Promise<ProviderJobRun> {
    const [row] = await this.db
      .select({ run: providerJobRuns })
      .from(providerJobRuns)
      .innerJoin(jobs, eq(jobs.jobId, providerJobRuns.jobId))
      .where(and(eq(jobs.provider, provider), eq(providerJobRuns.externalJobId, externalJobId)));
    if (!row) throw new RecordNotFoundError('provider_external_job', `${provider}/${externalJobId}`);
    return mapProviderJobRun(row.run);
  }

  async markQueued(jobId: string, queueJobId: string): Promise<void> {
    const [row] = await this.db
      .update(providerJobRuns)
      .set({ queueJobId, updatedAt: new Date() })
      .where(eq(providerJobRuns.jobId, jobId))
      .returning({ jobId: providerJobRuns.jobId });
    if (!row) throw new RecordNotFoundError('provider_job_run', jobId);
  }

  async markSubmitted(jobId: string, externalJobId: string): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .update(providerJobRuns)
      .set({ externalJobId, submittedAt: now, updatedAt: now })
      .where(eq(providerJobRuns.jobId, jobId))
      .returning({ jobId: providerJobRuns.jobId });
    if (!row) throw new RecordNotFoundError('provider_job_run', jobId);
  }

  async markCompleted(jobId: string): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .update(providerJobRuns)
      .set({ completedAt: now, updatedAt: now })
      .where(eq(providerJobRuns.jobId, jobId))
      .returning({ jobId: providerJobRuns.jobId });
    if (!row) throw new RecordNotFoundError('provider_job_run', jobId);
  }
}

export interface ProviderCacheEntry {
  inputHash: string;
  provider: string;
  model: string;
  mode: ProviderMode;
  output: unknown;
  actualCostCny: number;
  sourceJobId: string;
}

export class ProviderCacheRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async get(
    inputHash: string,
    provider: string,
    model: string,
    mode: ProviderMode,
  ): Promise<ProviderCacheEntry | undefined> {
    const [row] = await this.db
      .select()
      .from(providerCache)
      .where(
        and(
          eq(providerCache.inputHash, inputHash),
          eq(providerCache.provider, provider),
          eq(providerCache.model, model),
          eq(providerCache.mode, mode),
          or(isNull(providerCache.expiresAt), gt(providerCache.expiresAt, new Date())),
        ),
      );
    if (!row) return undefined;
    return {
      inputHash: row.inputHash,
      provider: row.provider,
      model: row.model,
      mode: row.mode,
      output: row.output,
      actualCostCny: Number(row.actualCostCny),
      sourceJobId: row.sourceJobId,
    };
  }

  async put(input: ProviderCacheEntry, expiresAt?: Date): Promise<void> {
    await this.db
      .insert(providerCache)
      .values({
        ...input,
        actualCostCny: input.actualCostCny.toString(),
        ...(expiresAt ? { expiresAt } : {}),
      })
      .onConflictDoUpdate({
        target: [providerCache.inputHash, providerCache.provider, providerCache.model, providerCache.mode],
        set: {
          output: input.output,
          actualCostCny: input.actualCostCny.toString(),
          sourceJobId: input.sourceJobId,
          expiresAt: expiresAt ?? null,
          createdAt: new Date(),
        },
      });
  }
}

export class ProviderCallbackRepository {
  constructor(private readonly db: OneCrewDatabase) {}

  async reserve(input: ProviderCallback): Promise<{ created: boolean }> {
    const callback = providerCallbackSchema.parse(input);
    const bodyHash = createInputHash(callback);
    const [inserted] = await this.db
      .insert(providerCallbacks)
      .values({
        eventId: callback.eventId,
        provider: callback.provider,
        externalJobId: callback.externalJobId,
        bodyHash,
        callback,
      })
      .onConflictDoNothing()
      .returning({ eventId: providerCallbacks.eventId });
    if (inserted) return { created: true };
    const [existing] = await this.db
      .select({ bodyHash: providerCallbacks.bodyHash })
      .from(providerCallbacks)
      .where(eq(providerCallbacks.eventId, callback.eventId));
    if (!existing || existing.bodyHash !== bodyHash) {
      throw new IdempotencyConflictError('provider_callback', callback.eventId);
    }
    return { created: false };
  }
}

export function createRepositories(db: OneCrewDatabase) {
  return {
    projects: new ProjectRepository(db),
    creative: new CreativeRepository(db),
    shots: new ShotRepository(db),
    assets: new AssetRepository(db),
    jobs: new JobRepository(db),
    qc: new QcRepository(db),
    qcRuns: new QcRunRepository(db),
    localizationRuns: new LocalizationRunRepository(db),
    localePacks: new LocalePackRepository(db),
    renders: new RenderRepository(db),
    publishes: new PublishRepository(db),
    experiments: new ExperimentRepository(db),
    idempotency: new IdempotencyRepository(db),
    humanGates: new HumanGateRepository(db),
    audit: new AuditRepository(db),
    feishuRecordLinks: new FeishuRecordLinkRepository(db),
    providerJobRuns: new ProviderJobRunRepository(db),
    providerCache: new ProviderCacheRepository(db),
    providerCallbacks: new ProviderCallbackRepository(db),
  };
}
