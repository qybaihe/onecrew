import { renderSubmissionSchema } from '@onecrew/contracts';
import { IdempotencyConflictError, RecordNotFoundError } from '@onecrew/db';
import type { RenderOrchestrator } from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export interface RenderRouteOptions {
  orchestrator: Pick<RenderOrchestrator, 'submit' | 'get' | 'cancel'>;
}
function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerRenderRoutes(app: FastifyInstance, options?: RenderRouteOptions): void {
  app.post('/v1/renders', async (request, reply) => {
    if (!options) return renderError(reply, new RenderRoutesNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey) throw new MissingRenderIdempotencyKeyError();
      const submission = renderSubmissionSchema.parse(request.body);
      const result = await options.orchestrator.submit(submission, idempotencyKey);
      reply.code(result.status === 'succeeded' ? 200 : 202);
      return {
        render_id: result.renderId,
        status: result.status,
        mode: result.mode,
        status_url: result.statusUrl,
        replayed: result.replayed,
        cached: result.cached,
      };
    } catch (error) {
      return renderError(reply, error);
    }
  });

  app.get('/v1/renders/:renderId', async (request, reply) => {
    if (!options) return renderError(reply, new RenderRoutesNotConfiguredError());
    try {
      const { renderId } = request.params as { renderId: string };
      const result = await options.orchestrator.get(renderId);
      return { render: result.value, version: result.version };
    } catch (error) {
      return renderError(reply, error);
    }
  });

  app.post('/v1/renders/:renderId/cancel', async (request, reply) => {
    if (!options) return renderError(reply, new RenderRoutesNotConfiguredError());
    try {
      const { renderId } = request.params as { renderId: string };
      return await options.orchestrator.cancel(renderId);
    } catch (error) {
      return renderError(reply, error);
    }
  });
}

export class RenderRoutesNotConfiguredError extends Error {
  constructor() {
    super('Render routes are not configured');
    this.name = 'RenderRoutesNotConfiguredError';
  }
}

export class MissingRenderIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingRenderIdempotencyKeyError';
  }
}

function renderError(reply: FastifyReply, error: unknown) {
  if (error instanceof RenderRoutesNotConfiguredError) reply.code(503);
  else if (error instanceof RecordNotFoundError) reply.code(404);
  else if (error instanceof IdempotencyConflictError) reply.code(409);
  else if (error instanceof ZodError || error instanceof MissingRenderIdempotencyKeyError) reply.code(400);
  else reply.code(500);
  return { ok: false, error: error instanceof Error ? error.name : 'UnknownError' };
}
