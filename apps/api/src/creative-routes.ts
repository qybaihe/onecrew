import {
  buildCreativeContinuityQcRequest,
  buildCreativeShotGenerationRequest,
  convertLocalMiniDramaProject,
  CreativeContinuityQcAssetError,
  CreativeStoryPlanValidationError,
  exportLocalMiniDramaArchive,
  exportOneCrewArchive,
  importLocalMiniDramaArchive,
  importOneCrewArchive,
  materializeCreativeArchive,
  materializeOneCrewArchive,
} from '@onecrew/creative';
import {
  budgetAllocationRequestSchema,
  characterSpecSchema,
  creativeGenerationBatchRequestSchema,
  creativeReferenceGridRequestSchema,
  creativeReusableAssetReuseRequestSchema,
  creativeStoryPlanRequestSchema,
  creativeWorkflowGroupCreateRequestSchema,
  creativeWorkflowGroupRunRequestSchema,
  episodeSpecSchema,
  propSpecSchema,
  regionalCulturePackRequestSchema,
  sceneSpecSchema,
  shotSpecSchema,
} from '@onecrew/contracts';
import {
  IdempotencyConflictError,
  InvalidCreativeAssetBindingError,
  InvalidCreativeReferenceGridError,
  InvalidCreativeReusableAssetError,
  InvalidCreativeWorkflowGroupError,
  RecordNotFoundError,
  type CreativeRepository,
  type CreativeWorkflowGroupRepository,
  type ShotRepository,
} from '@onecrew/db';
import { createInputHash, VersionConflictError } from '@onecrew/domain';
import { InvalidImageGridError, type S3MediaStore } from '@onecrew/media';
import {
  BudgetAllocationPlanNotReadyError,
  BudgetAllocationPlannerOutputError,
  CreativeGenerationBatchValidationError,
  CreativeReferenceGridSourceError,
  CreativeStoryPlanNotReadyError,
  CreativeStoryPlanOutputError,
  type BudgetAllocationPlanner,
  type CreativeStoryPlanner,
  ProviderSubmissionInProgressError,
  RegionalCulturePackNotReadyError,
  RegionalCulturePlannerOutputError,
  type CreativeGenerationBatchOrchestrator,
  type CreativeReferenceGridProcessor,
  type ProviderOrchestrator,
  type QcOrchestrator,
  type RegionalCulturePlanner,
} from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

export interface CreativeRouteOptions {
  repository: Pick<
    CreativeRepository,
    | 'importBundle'
    | 'getBundle'
    | 'getRecordVersions'
    | 'listProjects'
    | 'listAssets'
    | 'updateEntity'
    | 'updateEpisode'
    | 'updateShot'
  >;
  mediaStore?: Pick<S3MediaStore, 'put' | 'get'>;
  shotRepository?: Pick<ShotRepository, 'get'>;
  generator?: Pick<ProviderOrchestrator, 'submit'>;
  batchGenerator?: Pick<CreativeGenerationBatchOrchestrator, 'submit' | 'get' | 'latest' | 'cancel' | 'retry'>;
  continuityQc?: Pick<QcOrchestrator, 'submit'>;
  storyPlanner?: Pick<CreativeStoryPlanner, 'submit' | 'preview' | 'apply'>;
  regionalCulturePlanner?: Pick<RegionalCulturePlanner, 'submit' | 'preview'>;
  budgetAllocationPlanner?: Pick<BudgetAllocationPlanner, 'submit' | 'preview'>;
  referenceGrid?: Pick<CreativeReferenceGridProcessor, 'process'>;
  reusableAssets?: Pick<CreativeRepository, 'searchReusableAssets' | 'reuseAsset'>;
  workflowGroups?: Pick<
    CreativeWorkflowGroupRepository,
    'create' | 'get' | 'listForProject' | 'attachBatch'
  >;
}

const importOptionsSchema = z.object({
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  ownerOpenId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  nameEn: z.string().min(1).max(200).optional(),
});

const jsonImportSchema = importOptionsSchema.extend({
  project: z.unknown(),
});

const editContextSchema = z.object({
  expectedVersion: z.number().int().positive(),
  editId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  actorOpenId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
});

const episodePatchSchema = episodeSpecSchema
  .pick({ title: true, description: true, scriptContent: true, durationSec: true, status: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Episode patch must change at least one field' });

const shotPatchSchema = shotSpecSchema
  .omit({ shotId: true, projectId: true, episodeId: true, sequence: true })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Shot patch must change at least one field' });

const episodeEditSchema = editContextSchema.extend({ patch: episodePatchSchema });
const shotEditSchema = editContextSchema.extend({ patch: shotPatchSchema });

const entityPatchSchema = z.union([
  characterSpecSchema
    .omit({ entityId: true, projectId: true, episodeId: true, kind: true })
    .partial()
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, { message: 'Entity patch must change at least one field' }),
  sceneSpecSchema
    .omit({ entityId: true, projectId: true, episodeId: true, kind: true })
    .partial()
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, { message: 'Entity patch must change at least one field' }),
  propSpecSchema
    .omit({ entityId: true, projectId: true, episodeId: true, kind: true })
    .partial()
    .strict()
    .refine((patch) => Object.keys(patch).length > 0, { message: 'Entity patch must change at least one field' }),
]);
const entityEditSchema = editContextSchema.extend({ patch: entityPatchSchema });
const shotGenerationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  kind: z.enum(['image', 'video']),
  route: z.enum(['primary', 'fallback']).default('primary'),
  generationNonce: z.number().int().nonnegative(),
});
const continuityQcSchema = z.object({
  expectedVersion: z.number().int().positive(),
  assetId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  route: z.enum(['primary', 'fallback']).default('primary'),
  qualityAttempt: z.number().int().min(1).max(100).default(1),
  autoRemediate: z.boolean().default(true),
});
const storyPlanApplySchema = z.object({
  expectedProjectVersion: z.number().int().positive(),
  actorOpenId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
});
const batchRetrySchema = z.object({ route: z.enum(['primary', 'fallback']).default('primary') });
const reusableAssetSearchSchema = z.object({
  q: z.string().max(200).optional(),
  kind: z.enum(['character', 'scene', 'prop']).optional(),
  excludeProjectId: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerCreativeRoutes(app: FastifyInstance, options?: CreativeRouteOptions): void {
  app.get('/v1/creative/reusable-assets', async (request, reply) => {
    if (!options?.reusableAssets) return creativeError(reply, new CreativeReusableAssetsNotConfiguredError());
    try {
      const query = reusableAssetSearchSchema.parse(request.query);
      return {
        items: await options.reusableAssets.searchReusableAssets({
          limit: query.limit,
          ...(query.q ? { q: query.q } : {}),
          ...(query.kind ? { kind: query.kind } : {}),
          ...(query.excludeProjectId ? { excludeProjectId: query.excludeProjectId } : {}),
        }),
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects', async (_request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      return { projects: await options.repository.listProjects() };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/workflow-groups', async (request, reply) => {
    if (!options?.workflowGroups) return creativeError(reply, new CreativeWorkflowGroupsNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const groups = await options.workflowGroups.listForProject(projectId);
      return { groups: groups.map((group) => ({ group: group.value, version: group.version })) };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/workflow-groups', async (request, reply) => {
    if (!options?.workflowGroups) return creativeError(reply, new CreativeWorkflowGroupsNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeWorkflowGroupIdempotencyKeyError();
      const { projectId } = request.params as { projectId: string };
      const input = creativeWorkflowGroupCreateRequestSchema.parse(request.body);
      const now = new Date().toISOString();
      const result = await options.workflowGroups.create({
        groupId: `group_${createInputHash({ projectId, idempotencyKey }).slice(0, 32)}`,
        projectId,
        ...input,
        createdAt: now,
        updatedAt: now,
      });
      reply.code(result.replayed ? 200 : 201);
      return { group: result.value, version: result.version, replayed: result.replayed };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/workflow-groups/:groupId/run', async (request, reply) => {
    if (!options?.workflowGroups) return creativeError(reply, new CreativeWorkflowGroupsNotConfiguredError());
    if (!options.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeWorkflowGroupIdempotencyKeyError();
      const { groupId } = request.params as { groupId: string };
      const input = creativeWorkflowGroupRunRequestSchema.parse(request.body);
      const current = await options.workflowGroups.get(groupId);
      const scopedIdempotencyKey = `workflow-group:${groupId}:${idempotencyKey}`;
      if (current.version !== input.expectedGroupVersion) {
        const replayBatchId = `batch_${createInputHash({
          projectId: current.value.projectId,
          idempotencyKey: scopedIdempotencyKey,
        }).slice(0, 32)}`;
        if (current.value.lastBatchId === replayBatchId) {
          const batch = await options.batchGenerator.get(replayBatchId);
          reply.code(202);
          return {
            group: current.value,
            groupVersion: current.version,
            batch: batch.value,
            batchVersion: batch.version,
          };
        }
        throw new VersionConflictError(input.expectedGroupVersion, current.version);
      }
      const batch = await options.batchGenerator.submit(
        current.value.projectId,
        {
          kind: current.value.generationKind,
          shotIds: current.value.shotIds,
          expectedVersions: input.expectedShotVersions,
          missingOnly: input.forceRegenerate ? false : current.value.missingOnly,
          route: input.route,
          generationNonce: input.generationNonce,
          concurrency: current.value.concurrency,
        },
        scopedIdempotencyKey,
      );
      const group = await options.workflowGroups.attachBatch(
        groupId,
        input.expectedGroupVersion,
        batch.value.batchId,
      );
      reply.code(202);
      return {
        group: group.value,
        groupVersion: group.version,
        batch: batch.value,
        batchVersion: batch.version,
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/regional-culture-packs', async (request, reply) => {
    if (!options?.regionalCulturePlanner)
      return creativeError(reply, new RegionalCulturePlannerNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingRegionalCulturePackIdempotencyKeyError();
      const { projectId } = request.params as { projectId: string };
      const accepted = await options.regionalCulturePlanner.submit(
        projectId,
        regionalCulturePackRequestSchema.parse(request.body),
        idempotencyKey,
      );
      reply.code(202);
      return {
        job_id: accepted.jobId,
        status: accepted.status,
        mode: accepted.mode,
        provider: accepted.provider,
        route: accepted.route,
        estimated_cost_cny: accepted.estimatedCostCny,
        status_url: accepted.statusUrl,
        replayed: accepted.replayed,
        ...(accepted.warning ? { warning: accepted.warning } : {}),
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/regional-culture-packs/:jobId', async (request, reply) => {
    if (!options?.regionalCulturePlanner)
      return creativeError(reply, new RegionalCulturePlannerNotConfiguredError());
    try {
      const { projectId, jobId } = request.params as { projectId: string; jobId: string };
      return await options.regionalCulturePlanner.preview(projectId, jobId);
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/budget-allocation-plans', async (request, reply) => {
    if (!options?.budgetAllocationPlanner)
      return creativeError(reply, new BudgetAllocationPlannerNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingBudgetAllocationPlanIdempotencyKeyError();
      const { projectId } = request.params as { projectId: string };
      const accepted = await options.budgetAllocationPlanner.submit(
        projectId,
        budgetAllocationRequestSchema.parse(request.body),
        idempotencyKey,
      );
      reply.code(202);
      return {
        job_id: accepted.jobId,
        status: accepted.status,
        mode: accepted.mode,
        provider: accepted.provider,
        route: accepted.route,
        estimated_cost_cny: accepted.estimatedCostCny,
        status_url: accepted.statusUrl,
        replayed: accepted.replayed,
        ...(accepted.warning ? { warning: accepted.warning } : {}),
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/budget-allocation-plans/:jobId', async (request, reply) => {
    if (!options?.budgetAllocationPlanner)
      return creativeError(reply, new BudgetAllocationPlannerNotConfiguredError());
    try {
      const { projectId, jobId } = request.params as { projectId: string; jobId: string };
      return await options.budgetAllocationPlanner.preview(projectId, jobId);
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/story-plans', async (request, reply) => {
    if (!options?.storyPlanner) return creativeError(reply, new CreativeStoryPlannerNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeStoryPlanIdempotencyKeyError();
      const { projectId } = request.params as { projectId: string };
      const accepted = await options.storyPlanner.submit(
        projectId,
        creativeStoryPlanRequestSchema.parse(request.body),
        idempotencyKey,
      );
      reply.code(202);
      return {
        job_id: accepted.jobId,
        status: accepted.status,
        mode: accepted.mode,
        provider: accepted.provider,
        route: accepted.route,
        estimated_cost_cny: accepted.estimatedCostCny,
        status_url: accepted.statusUrl,
        replayed: accepted.replayed,
        ...(accepted.warning ? { warning: accepted.warning } : {}),
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/story-plans/:jobId', async (request, reply) => {
    if (!options?.storyPlanner) return creativeError(reply, new CreativeStoryPlannerNotConfiguredError());
    try {
      const { projectId, jobId } = request.params as { projectId: string; jobId: string };
      return await options.storyPlanner.preview(projectId, jobId);
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/story-plans/:jobId/apply', async (request, reply) => {
    if (!options?.storyPlanner) return creativeError(reply, new CreativeStoryPlannerNotConfiguredError());
    try {
      const { projectId, jobId } = request.params as { projectId: string; jobId: string };
      const input = storyPlanApplySchema.parse(request.body);
      const applied = await options.storyPlanner.apply(
        projectId,
        jobId,
        input.expectedProjectVersion,
        input.actorOpenId,
      );
      return { ok: true, applied };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/imports/local-mini-drama/json', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const input = jsonImportSchema.parse(request.body);
      const bundle = convertLocalMiniDramaProject(input.project, {
        ...(input.projectId ? { projectId: input.projectId } : {}),
        ...(input.ownerOpenId ? { ownerOpenId: input.ownerOpenId } : {}),
        ...(input.nameEn ? { nameEn: input.nameEn } : {}),
      });
      const imported = await options.repository.importBundle(bundle);
      reply.code(201);
      return { ok: true, imported, source: bundle.source };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post(
    '/v1/creative/imports/local-mini-drama/zip',
    { bodyLimit: 512 * 1024 * 1024 },
    async (request, reply) => {
      if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
      if (!options.mediaStore) return creativeError(reply, new CreativeMediaStoreNotConfiguredError());
      try {
        const query = importOptionsSchema.parse(request.query);
        if (!Buffer.isBuffer(request.body)) throw new InvalidCreativeArchiveError('Request body must be a ZIP buffer');
        const parsed = importLocalMiniDramaArchive(request.body, {
          ...(query.projectId ? { projectId: query.projectId } : {}),
          ...(query.ownerOpenId ? { ownerOpenId: query.ownerOpenId } : {}),
          ...(query.nameEn ? { nameEn: query.nameEn } : {}),
        });
        const materialized = await materializeCreativeArchive(parsed, options.mediaStore);
        const imported = await options.repository.importBundle(materialized.bundle, materialized.assets);
        reply.code(201);
        return {
          ok: true,
          imported,
          source: materialized.bundle.source,
          media: materialized.assets.length,
        };
      } catch (error) {
        return creativeError(reply, error);
      }
    },
  );

  app.post(
    '/v1/creative/imports/onecrew/zip',
    { bodyLimit: 512 * 1024 * 1024 },
    async (request, reply) => {
      if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
      if (!options.mediaStore) return creativeError(reply, new CreativeMediaStoreNotConfiguredError());
      try {
        if (!Buffer.isBuffer(request.body)) throw new InvalidCreativeArchiveError('Request body must be a ZIP buffer');
        const parsed = importOneCrewArchive(request.body);
        const materialized = await materializeOneCrewArchive(parsed, options.mediaStore);
        const imported = await options.repository.importBundle(materialized.bundle, materialized.assets);
        reply.code(201);
        return {
          ok: true,
          imported,
          source: materialized.bundle.source,
          media: materialized.assets.length,
        };
      } catch (error) {
        return creativeError(reply, error);
      }
    },
  );

  app.get('/v1/creative/projects/:projectId', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const [bundle, assets, versions] = await Promise.all([
        options.repository.getBundle(projectId),
        options.repository.listAssets(projectId),
        options.repository.getRecordVersions(projectId),
      ]);
      return { bundle, assets, versions };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.patch('/v1/creative/episodes/:episodeId', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const { episodeId } = request.params as { episodeId: string };
      const input = episodeEditSchema.parse(request.body);
      const record = await options.repository.updateEpisode(
        episodeId,
        input.expectedVersion,
        input.patch,
        { editId: input.editId, actorOpenId: input.actorOpenId },
      );
      return { ok: true, record: record.value, version: record.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.patch('/v1/creative/shots/:shotId', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const { shotId } = request.params as { shotId: string };
      const input = shotEditSchema.parse(request.body);
      const record = await options.repository.updateShot(
        shotId,
        input.expectedVersion,
        input.patch,
        { editId: input.editId, actorOpenId: input.actorOpenId },
      );
      return { ok: true, record: record.value, version: record.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.patch('/v1/creative/entities/:entityId', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const { entityId } = request.params as { entityId: string };
      const input = entityEditSchema.parse(request.body);
      const record = await options.repository.updateEntity(
        entityId,
        input.expectedVersion,
        input.patch,
        { editId: input.editId, actorOpenId: input.actorOpenId },
      );
      return { ok: true, record: record.value, version: record.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/entities/:entityId/reference-grids', async (request, reply) => {
    if (!options?.referenceGrid) return creativeError(reply, new CreativeReferenceGridNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeReferenceGridIdempotencyKeyError();
      const { entityId } = request.params as { entityId: string };
      const result = await options.referenceGrid.process(
        entityId,
        creativeReferenceGridRequestSchema.parse(request.body),
        idempotencyKey,
      );
      return { ok: true, result };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/entities/:entityId/reusable-assets', async (request, reply) => {
    if (!options?.reusableAssets) return creativeError(reply, new CreativeReusableAssetsNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeReusableAssetIdempotencyKeyError();
      const { entityId } = request.params as { entityId: string };
      const input = creativeReusableAssetReuseRequestSchema.parse(request.body);
      const result = await options.reusableAssets.reuseAsset({ entityId, idempotencyKey, ...input });
      return { ok: true, result };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/shots/:shotId/generations', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    if (!options.shotRepository || !options.generator) {
      return creativeError(reply, new CreativeGenerationNotConfiguredError());
    }
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeGenerationIdempotencyKeyError();
      const { shotId } = request.params as { shotId: string };
      const input = shotGenerationSchema.parse(request.body);
      const shot = await options.shotRepository.get(shotId);
      if (shot.version !== input.expectedVersion) {
        throw new VersionConflictError(input.expectedVersion, shot.version);
      }
      const [bundle, assets] = await Promise.all([
        options.repository.getBundle(shot.value.projectId),
        options.repository.listAssets(shot.value.projectId),
      ]);
      const accepted = await options.generator.submit(
        buildCreativeShotGenerationRequest({
          bundle,
          assets,
          shotId,
          kind: input.kind,
          route: input.route,
          generationNonce: input.generationNonce,
        }),
        idempotencyKey,
      );
      reply.code(202);
      return {
        job_id: accepted.jobId,
        status: accepted.status,
        mode: accepted.mode,
        provider: accepted.provider,
        route: accepted.route,
        estimated_cost_cny: accepted.estimatedCostCny,
        status_url: accepted.statusUrl,
        replayed: accepted.replayed,
        ...(accepted.warning ? { warning: accepted.warning } : {}),
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/shots/:shotId/continuity-qc', async (request, reply) => {
    if (!options?.shotRepository || !options.continuityQc) {
      return creativeError(reply, new CreativeContinuityQcNotConfiguredError());
    }
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeContinuityQcIdempotencyKeyError();
      const { shotId } = request.params as { shotId: string };
      const input = continuityQcSchema.parse(request.body);
      const shot = await options.shotRepository.get(shotId);
      if (shot.version !== input.expectedVersion) {
        throw new VersionConflictError(input.expectedVersion, shot.version);
      }
      const [bundle, assets] = await Promise.all([
        options.repository.getBundle(shot.value.projectId),
        options.repository.listAssets(shot.value.projectId),
      ]);
      const qcRequest = buildCreativeContinuityQcRequest({
        bundle,
        assets,
        shotId,
        ...(input.assetId ? { assetId: input.assetId } : {}),
        route: input.route,
        qualityAttempt: input.qualityAttempt,
        autoRemediate: input.autoRemediate,
      });
      const selectedAsset = assets.find((asset) => asset.assetId === qcRequest.sourceAssetId);
      if (!selectedAsset) throw new CreativeContinuityQcAssetError('Selected QC asset is missing');
      const accepted = await options.continuityQc.submit(qcRequest, idempotencyKey);
      reply.code(202);
      return {
        qc_run_id: accepted.qcRunId,
        status: accepted.status,
        status_url: accepted.statusUrl,
        replayed: accepted.replayed,
        source_asset_id: selectedAsset.assetId,
        source_asset_version: selectedAsset.version,
        media_type: qcRequest.mediaType,
      };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/projects/:projectId/generation-batches', async (request, reply) => {
    if (!options?.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeGenerationIdempotencyKeyError();
      const { projectId } = request.params as { projectId: string };
      const result = await options.batchGenerator.submit(
        projectId,
        creativeGenerationBatchRequestSchema.parse(request.body),
        idempotencyKey,
      );
      reply.code(202);
      return { batch: result.value, version: result.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/generation-batches/:batchId', async (request, reply) => {
    if (!options?.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const { batchId } = request.params as { batchId: string };
      const result = await options.batchGenerator.get(batchId);
      return { batch: result.value, version: result.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/generation-batches/latest', async (request, reply) => {
    if (!options?.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const result = await options.batchGenerator.latest(projectId);
      return result ? { batch: result.value, version: result.version } : { batch: null, version: 0 };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/generation-batches/:batchId/cancel', async (request, reply) => {
    if (!options?.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const { batchId } = request.params as { batchId: string };
      const result = await options.batchGenerator.cancel(batchId);
      return { batch: result.value, version: result.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.post('/v1/creative/generation-batches/:batchId/retry', async (request, reply) => {
    if (!options?.batchGenerator) return creativeError(reply, new CreativeGenerationNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey?.trim()) throw new MissingCreativeGenerationIdempotencyKeyError();
      const { batchId } = request.params as { batchId: string };
      const input = batchRetrySchema.parse(request.body ?? {});
      const result = await options.batchGenerator.retry(batchId, input.route, idempotencyKey);
      reply.code(202);
      return { batch: result.value, version: result.version };
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/exports/onecrew.zip', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    if (!options.mediaStore) return creativeError(reply, new CreativeMediaStoreNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const [bundle, assets] = await Promise.all([
        options.repository.getBundle(projectId),
        options.repository.listAssets(projectId),
      ]);
      const archive = await exportOneCrewArchive(bundle, assets, options.mediaStore);
      return sendArchive(reply, archive.filename, archive.buffer);
    } catch (error) {
      return creativeError(reply, error);
    }
  });

  app.get('/v1/creative/projects/:projectId/exports/compatible.zip', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    if (!options.mediaStore) return creativeError(reply, new CreativeMediaStoreNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const [bundle, assets] = await Promise.all([
        options.repository.getBundle(projectId),
        options.repository.listAssets(projectId),
      ]);
      const archive = await exportLocalMiniDramaArchive(bundle, assets, options.mediaStore);
      return sendArchive(reply, archive.filename, archive.buffer);
    } catch (error) {
      return creativeError(reply, error);
    }
  });
}

function sendArchive(reply: FastifyReply, filename: string, buffer: Buffer) {
  const asciiFilename = filename.replace(/[^A-Za-z0-9._-]/g, '-');
  reply.header('content-type', 'application/zip');
  reply.header(
    'content-disposition',
    `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  return reply.send(buffer);
}

export class CreativeRoutesNotConfiguredError extends Error {
  constructor() {
    super('Creative routes are not configured');
    this.name = 'CreativeRoutesNotConfiguredError';
  }
}

export class CreativeMediaStoreNotConfiguredError extends Error {
  constructor() {
    super('Creative media store is not configured');
    this.name = 'CreativeMediaStoreNotConfiguredError';
  }
}

export class CreativeGenerationNotConfiguredError extends Error {
  constructor() {
    super('Creative shot generation is not configured');
    this.name = 'CreativeGenerationNotConfiguredError';
  }
}

export class CreativeContinuityQcNotConfiguredError extends Error {
  constructor() {
    super('Creative continuity QC is not configured');
    this.name = 'CreativeContinuityQcNotConfiguredError';
  }
}

export class CreativeStoryPlannerNotConfiguredError extends Error {
  constructor() {
    super('Creative story planner is not configured');
    this.name = 'CreativeStoryPlannerNotConfiguredError';
  }
}

export class RegionalCulturePlannerNotConfiguredError extends Error {
  constructor() {
    super('Regional culture planner is not configured');
    this.name = 'RegionalCulturePlannerNotConfiguredError';
  }
}

export class BudgetAllocationPlannerNotConfiguredError extends Error {
  constructor() {
    super('Budget allocation planner is not configured');
    this.name = 'BudgetAllocationPlannerNotConfiguredError';
  }
}

export class MissingRegionalCulturePackIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for regional culture pack generation');
    this.name = 'MissingRegionalCulturePackIdempotencyKeyError';
  }
}

export class MissingBudgetAllocationPlanIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for budget allocation planning');
    this.name = 'MissingBudgetAllocationPlanIdempotencyKeyError';
  }
}

export class CreativeReferenceGridNotConfiguredError extends Error {
  constructor() {
    super('Creative reference-grid preprocessing is not configured');
    this.name = 'CreativeReferenceGridNotConfiguredError';
  }
}

export class CreativeReusableAssetsNotConfiguredError extends Error {
  constructor() {
    super('Creative reusable asset library is not configured');
    this.name = 'CreativeReusableAssetsNotConfiguredError';
  }
}

export class CreativeWorkflowGroupsNotConfiguredError extends Error {
  constructor() {
    super('Creative workflow groups are not configured');
    this.name = 'CreativeWorkflowGroupsNotConfiguredError';
  }
}

export class MissingCreativeGenerationIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative generation');
    this.name = 'MissingCreativeGenerationIdempotencyKeyError';
  }
}

export class MissingCreativeContinuityQcIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative continuity QC');
    this.name = 'MissingCreativeContinuityQcIdempotencyKeyError';
  }
}

export class MissingCreativeStoryPlanIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative story planning');
    this.name = 'MissingCreativeStoryPlanIdempotencyKeyError';
  }
}

export class MissingCreativeReferenceGridIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative reference-grid preprocessing');
    this.name = 'MissingCreativeReferenceGridIdempotencyKeyError';
  }
}

export class MissingCreativeReusableAssetIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative asset reuse');
    this.name = 'MissingCreativeReusableAssetIdempotencyKeyError';
  }
}

export class MissingCreativeWorkflowGroupIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required for creative workflow groups');
    this.name = 'MissingCreativeWorkflowGroupIdempotencyKeyError';
  }
}

export class InvalidCreativeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCreativeArchiveError';
  }
}

function creativeError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (
    error instanceof CreativeRoutesNotConfiguredError ||
    error instanceof CreativeMediaStoreNotConfiguredError ||
    error instanceof CreativeGenerationNotConfiguredError ||
    error instanceof CreativeContinuityQcNotConfiguredError ||
    error instanceof CreativeStoryPlannerNotConfiguredError ||
    error instanceof RegionalCulturePlannerNotConfiguredError ||
    error instanceof BudgetAllocationPlannerNotConfiguredError ||
    error instanceof CreativeReferenceGridNotConfiguredError ||
    error instanceof CreativeReusableAssetsNotConfiguredError ||
    error instanceof CreativeWorkflowGroupsNotConfiguredError
  ) {
    reply.code(503);
  } else if (error instanceof RecordNotFoundError) {
    reply.code(404);
  } else if (
    error instanceof VersionConflictError ||
    error instanceof CreativeStoryPlanNotReadyError ||
    error instanceof RegionalCulturePackNotReadyError ||
    error instanceof BudgetAllocationPlanNotReadyError
  ) {
    reply.code(409);
  } else if (error instanceof IdempotencyConflictError || error instanceof ProviderSubmissionInProgressError) {
    reply.code(409);
  } else if (code === '23505') {
    reply.code(409);
  } else if (
    error instanceof ZodError ||
    error instanceof InvalidCreativeAssetBindingError ||
    error instanceof CreativeGenerationBatchValidationError ||
    error instanceof MissingCreativeGenerationIdempotencyKeyError ||
    error instanceof MissingCreativeContinuityQcIdempotencyKeyError ||
    error instanceof MissingCreativeStoryPlanIdempotencyKeyError ||
    error instanceof MissingRegionalCulturePackIdempotencyKeyError ||
    error instanceof MissingBudgetAllocationPlanIdempotencyKeyError ||
    error instanceof MissingCreativeReferenceGridIdempotencyKeyError ||
    error instanceof MissingCreativeReusableAssetIdempotencyKeyError ||
    error instanceof MissingCreativeWorkflowGroupIdempotencyKeyError ||
    error instanceof InvalidCreativeReferenceGridError ||
    error instanceof InvalidCreativeReusableAssetError ||
    error instanceof InvalidCreativeWorkflowGroupError ||
    error instanceof InvalidImageGridError ||
    error instanceof CreativeReferenceGridSourceError ||
    error instanceof CreativeContinuityQcAssetError ||
    error instanceof CreativeStoryPlanOutputError ||
    error instanceof CreativeStoryPlanValidationError ||
    error instanceof RegionalCulturePlannerOutputError ||
    error instanceof BudgetAllocationPlannerOutputError ||
    error instanceof InvalidCreativeArchiveError ||
    /LocalMiniDrama|Archive|project\.json|declared media file|archive root|absolute path/i.test(message)
  ) {
    reply.code(400);
  } else {
    reply.code(500);
  }
  return {
    ok: false,
    error: error instanceof Error ? error.name : 'UnknownError',
    message,
  };
}
