import {
  convertLocalMiniDramaProject,
  exportLocalMiniDramaArchive,
  exportOneCrewArchive,
  importLocalMiniDramaArchive,
  importOneCrewArchive,
  materializeCreativeArchive,
  materializeOneCrewArchive,
} from '@onecrew/creative';
import {
  characterSpecSchema,
  episodeSpecSchema,
  propSpecSchema,
  sceneSpecSchema,
  shotSpecSchema,
} from '@onecrew/contracts';
import { InvalidCreativeAssetBindingError, RecordNotFoundError, type CreativeRepository } from '@onecrew/db';
import { VersionConflictError } from '@onecrew/domain';
import type { S3MediaStore } from '@onecrew/media';
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

export function registerCreativeRoutes(app: FastifyInstance, options?: CreativeRouteOptions): void {
  app.get('/v1/creative/projects', async (_request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      return { projects: await options.repository.listProjects() };
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

export class InvalidCreativeArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCreativeArchiveError';
  }
}

function creativeError(reply: FastifyReply, error: unknown) {
  const code = (error as { code?: unknown } | undefined)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof CreativeRoutesNotConfiguredError || error instanceof CreativeMediaStoreNotConfiguredError) {
    reply.code(503);
  } else if (error instanceof RecordNotFoundError) {
    reply.code(404);
  } else if (error instanceof VersionConflictError) {
    reply.code(409);
  } else if (code === '23505') {
    reply.code(409);
  } else if (
    error instanceof ZodError ||
    error instanceof InvalidCreativeAssetBindingError ||
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
