import { publishRequestSchema } from '@onecrew/contracts';
import { IdempotencyConflictError, RecordNotFoundError } from '@onecrew/db';
import type { PublishOrchestrator } from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export interface PublishRouteOptions {
  orchestrator: Pick<PublishOrchestrator, 'submit' | 'get' | 'listExperiments'>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerPublishRoutes(app: FastifyInstance, options?: PublishRouteOptions): void {
  app.post('/v1/publishes', async (request, reply) => {
    if (!options) return publishError(reply, new PublishRoutesNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey) throw new MissingPublishIdempotencyKeyError();
      const record = await options.orchestrator.submit(publishRequestSchema.parse(request.body), idempotencyKey);
      reply.code(record.status === 'succeeded' ? 201 : 202);
      return { publish: record };
    } catch (error) {
      return publishError(reply, error);
    }
  });

  app.get('/v1/publishes/:publishId', async (request, reply) => {
    if (!options) return publishError(reply, new PublishRoutesNotConfiguredError());
    try {
      const { publishId } = request.params as { publishId: string };
      const result = await options.orchestrator.get(publishId);
      return { publish: result.value, version: result.version };
    } catch (error) {
      return publishError(reply, error);
    }
  });

  app.get('/v1/projects/:projectId/experiments', async (request, reply) => {
    if (!options) return publishError(reply, new PublishRoutesNotConfiguredError());
    try {
      const { projectId } = request.params as { projectId: string };
      return { experiments: await options.orchestrator.listExperiments(projectId) };
    } catch (error) {
      return publishError(reply, error);
    }
  });
}

class PublishRoutesNotConfiguredError extends Error {
  constructor() {
    super('Publish routes are not configured');
    this.name = 'PublishRoutesNotConfiguredError';
  }
}

class MissingPublishIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingPublishIdempotencyKeyError';
  }
}

function publishError(reply: FastifyReply, error: unknown) {
  if (error instanceof PublishRoutesNotConfiguredError) reply.code(503);
  else if (error instanceof RecordNotFoundError) reply.code(404);
  else if (error instanceof IdempotencyConflictError) reply.code(409);
  else if (error instanceof ZodError || error instanceof MissingPublishIdempotencyKeyError) reply.code(400);
  else reply.code(500);
  return { ok: false, error: error instanceof Error ? error.name : 'UnknownError' };
}
