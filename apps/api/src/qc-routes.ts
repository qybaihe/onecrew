import { qcRunRequestSchema } from '@onecrew/contracts';
import { IdempotencyConflictError, RecordNotFoundError } from '@onecrew/db';
import {
  QcSubmissionInProgressError,
  type QcOrchestrator,
} from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ZodError } from 'zod';

export interface QcRouteOptions {
  orchestrator: Pick<QcOrchestrator, 'submit' | 'get' | 'cancel'>;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function registerQcRoutes(app: FastifyInstance, options?: QcRouteOptions): void {
  app.post('/v1/qc/run', async (request, reply) => {
    if (!options) return qcError(reply, new QcRoutesNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey) throw new MissingQcIdempotencyKeyError();
      const result = await options.orchestrator.submit(qcRunRequestSchema.parse(request.body), idempotencyKey);
      reply.code(202);
      return {
        qc_run_id: result.qcRunId,
        status: result.status,
        status_url: result.statusUrl,
        replayed: result.replayed,
      };
    } catch (error) {
      return qcError(reply, error);
    }
  });

  app.get('/v1/qc/runs/:qcRunId', async (request, reply) => {
    if (!options) return qcError(reply, new QcRoutesNotConfiguredError());
    try {
      const { qcRunId } = request.params as { qcRunId: string };
      const result = await options.orchestrator.get(qcRunId);
      return { qc_run: result.value, version: result.version };
    } catch (error) {
      return qcError(reply, error);
    }
  });

  app.post('/v1/qc/runs/:qcRunId/cancel', async (request, reply) => {
    if (!options) return qcError(reply, new QcRoutesNotConfiguredError());
    try {
      const { qcRunId } = request.params as { qcRunId: string };
      return await options.orchestrator.cancel(qcRunId);
    } catch (error) {
      return qcError(reply, error);
    }
  });
}

export class QcRoutesNotConfiguredError extends Error {
  constructor() {
    super('QC routes are not configured');
    this.name = 'QcRoutesNotConfiguredError';
  }
}

export class MissingQcIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingQcIdempotencyKeyError';
  }
}

function qcError(reply: FastifyReply, error: unknown) {
  if (error instanceof QcRoutesNotConfiguredError) reply.code(503);
  else if (error instanceof RecordNotFoundError) reply.code(404);
  else if (error instanceof IdempotencyConflictError || error instanceof QcSubmissionInProgressError) {
    reply.code(409);
  } else if (error instanceof ZodError || error instanceof MissingQcIdempotencyKeyError) reply.code(400);
  else reply.code(500);
  return { ok: false, error: error instanceof Error ? error.name : 'UnknownError' };
}
