import {
  convertLocalMiniDramaProject,
  importLocalMiniDramaArchive,
  materializeCreativeArchive,
} from '@onecrew/creative';
import { RecordNotFoundError, type CreativeRepository } from '@onecrew/db';
import type { S3MediaStore } from '@onecrew/media';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z, ZodError } from 'zod';

export interface CreativeRouteOptions {
  repository: Pick<CreativeRepository, 'importBundle' | 'getBundle' | 'listProjects' | 'listAssets'>;
  mediaStore?: Pick<S3MediaStore, 'put'>;
}

const importOptionsSchema = z.object({
  projectId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  ownerOpenId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/).optional(),
  nameEn: z.string().min(1).max(200).optional(),
});

const jsonImportSchema = importOptionsSchema.extend({
  project: z.unknown(),
});

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

  app.get('/v1/creative/projects/:projectId', async (request, reply) => {
    if (!options) return creativeError(reply, new CreativeRoutesNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      const [bundle, assets] = await Promise.all([
        options.repository.getBundle(projectId),
        options.repository.listAssets(projectId),
      ]);
      return { bundle, assets };
    } catch (error) {
      return creativeError(reply, error);
    }
  });
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
  } else if (code === '23505') {
    reply.code(409);
  } else if (
    error instanceof ZodError ||
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
