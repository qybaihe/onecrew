import { localizationRequestSchema } from '@onecrew/contracts';
import { IdempotencyConflictError, RecordNotFoundError } from '@onecrew/db';
import type { LocalizationOrchestrator } from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export interface LocalizationRouteOptions {
  orchestrator: Pick<LocalizationOrchestrator, 'submit' | 'get' | 'cancel'>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerLocalizationRoutes(app: FastifyInstance, options?: LocalizationRouteOptions): void {
  app.post('/v1/localizations', async (request, reply) => {
    if (!options) return localizationError(reply, new LocalizationRoutesNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey) throw new MissingLocalizationIdempotencyKeyError();
      const response = await options.orchestrator.submit(localizationRequestSchema.parse(request.body), idempotencyKey);
      reply.code(202);
      return {
        localization_run_id: response.localizationRunId,
        status: response.status,
        status_url: response.statusUrl,
        replayed: response.replayed,
      };
    } catch (error) {
      return localizationError(reply, error);
    }
  });

  app.get('/v1/localizations/:localizationRunId', async (request, reply) => {
    if (!options) return localizationError(reply, new LocalizationRoutesNotConfiguredError());
    try {
      const { localizationRunId } = request.params as { localizationRunId: string };
      const result = await options.orchestrator.get(localizationRunId);
      return { localization_run: result.value, version: result.version };
    } catch (error) {
      return localizationError(reply, error);
    }
  });

  app.post('/v1/localizations/:localizationRunId/cancel', async (request, reply) => {
    if (!options) return localizationError(reply, new LocalizationRoutesNotConfiguredError());
    try {
      const { localizationRunId } = request.params as { localizationRunId: string };
      return await options.orchestrator.cancel(localizationRunId);
    } catch (error) {
      return localizationError(reply, error);
    }
  });
}

class LocalizationRoutesNotConfiguredError extends Error {
  constructor() {
    super('Localization routes are not configured');
    this.name = 'LocalizationRoutesNotConfiguredError';
  }
}

class MissingLocalizationIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingLocalizationIdempotencyKeyError';
  }
}

function localizationError(reply: FastifyReply, error: unknown) {
  if (error instanceof LocalizationRoutesNotConfiguredError) reply.code(503);
  else if (error instanceof RecordNotFoundError) reply.code(404);
  else if (error instanceof IdempotencyConflictError) reply.code(409);
  else if (error instanceof ZodError || error instanceof MissingLocalizationIdempotencyKeyError) reply.code(400);
  else reply.code(500);
  return { ok: false, error: error instanceof Error ? error.name : 'UnknownError' };
}
