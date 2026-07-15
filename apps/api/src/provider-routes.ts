import type { ProviderCallback, ProviderRequest } from '@onecrew/contracts';
import {
  IdempotencyConflictError,
  RecordNotFoundError,
} from '@onecrew/db';
import { VersionConflictError } from '@onecrew/domain';
import {
  ProviderCallbackSecurityError,
  ProviderSubmissionInProgressError,
  verifyProviderCallback,
  type ProviderCallbackProcessor,
  type ProviderOrchestrator,
} from '@onecrew/workflows';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export interface ProviderRouteOptions {
  orchestrator: Pick<ProviderOrchestrator, 'submit' | 'get' | 'cancel'>;
  callbackProcessor: Pick<ProviderCallbackProcessor, 'handle'>;
  callbackSecret?: string;
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function bodyRecord(body: unknown): Record<string, unknown> {
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
}

function acceptedWire(response: Awaited<ReturnType<ProviderOrchestrator['submit']>>) {
  return {
    job_id: response.jobId,
    status: response.status,
    mode: response.mode,
    provider: response.provider,
    route: response.route,
    estimated_cost_cny: response.estimatedCostCny,
    status_url: response.statusUrl,
    replayed: response.replayed,
    ...(response.warning ? { warning: response.warning } : {}),
  };
}

export function registerProviderRoutes(app: FastifyInstance, options?: ProviderRouteOptions): void {
  async function submit(
    request: FastifyRequest,
    reply: FastifyReply,
    capability: ProviderRequest['capability'],
    projectId?: string,
  ) {
    if (!options) return providerError(reply, new ProviderRoutesNotConfiguredError());
    try {
      const idempotencyKey = firstHeader(request.headers['idempotency-key']);
      if (!idempotencyKey) throw new MissingIdempotencyKeyError();
      const parsedBody = bodyRecord(request.body);
      const result = await options.orchestrator.submit(
        {
          ...parsedBody,
          capability,
          ...(projectId ? { projectId } : {}),
        } as ProviderRequest,
        idempotencyKey,
      );
      reply.code(202);
      return acceptedWire(result);
    } catch (error) {
      return providerError(reply, error);
    }
  }

  app.post('/v1/projects/:projectId/plan', async (request, reply) => {
    const params = request.params as { projectId?: string };
    return submit(request, reply, 'llm', params.projectId);
  });
  app.post('/v1/images/generate', (request, reply) => submit(request, reply, 'image'));
  app.post('/v1/shots/generate', (request, reply) => submit(request, reply, 'video'));
  app.post('/v1/audio/synthesize', (request, reply) => submit(request, reply, 'tts'));
  app.get('/v1/jobs/:jobId', async (request, reply) => {
    if (!options) return providerError(reply, new ProviderRoutesNotConfiguredError());
    try {
      const { jobId } = request.params as { jobId: string };
      const state = await options.orchestrator.get(jobId);
      return {
        job: state.job.value,
        version: state.job.version,
        provider_run: {
          route: state.run.route,
          ...(state.run.queueJobId ? { queue_job_id: state.run.queueJobId } : {}),
          ...(state.run.externalJobId ? { external_job_id: state.run.externalJobId } : {}),
          ...(state.run.submittedAt ? { submitted_at: state.run.submittedAt } : {}),
          ...(state.run.completedAt ? { completed_at: state.run.completedAt } : {}),
        },
        ...(state.output === undefined ? {} : { output: state.output }),
      };
    } catch (error) {
      return providerError(reply, error);
    }
  });

  app.post('/v1/jobs/:jobId/cancel', async (request, reply) => {
    if (!options) return providerError(reply, new ProviderRoutesNotConfiguredError());
    try {
      const { jobId } = request.params as { jobId: string };
      return await options.orchestrator.cancel(jobId);
    } catch (error) {
      return providerError(reply, error);
    }
  });

  app.post('/v1/providers/callback', async (request, reply) => {
    if (!options) return providerError(reply, new ProviderRoutesNotConfiguredError());
    try {
      if (!request.rawBody) throw new ProviderCallbackSecurityError('Missing callback body');
      verifyProviderCallback(
        request.rawBody,
        firstHeader(request.headers['x-onecrew-timestamp']),
        firstHeader(request.headers['x-onecrew-signature']),
        options.callbackSecret,
      );
      const result = await options.callbackProcessor.handle(request.body as ProviderCallback);
      reply.code(202);
      return result;
    } catch (error) {
      return providerError(reply, error);
    }
  });
}

export class ProviderRoutesNotConfiguredError extends Error {
  constructor() {
    super('Provider routes are not configured');
    this.name = 'ProviderRoutesNotConfiguredError';
  }
}

export class MissingIdempotencyKeyError extends Error {
  constructor() {
    super('Idempotency-Key header is required');
    this.name = 'MissingIdempotencyKeyError';
  }
}

function providerError(reply: FastifyReply, error: unknown) {
  if (error instanceof ProviderRoutesNotConfiguredError) reply.code(503);
  else if (error instanceof RecordNotFoundError) reply.code(404);
  else if (error instanceof ProviderCallbackSecurityError) reply.code(401);
  else if (
    error instanceof IdempotencyConflictError ||
    error instanceof VersionConflictError ||
    error instanceof ProviderSubmissionInProgressError
  ) {
    reply.code(409);
  } else if (error instanceof ZodError || error instanceof MissingIdempotencyKeyError) reply.code(400);
  else reply.code(500);
  return {
    ok: false,
    error: error instanceof Error ? error.name : 'UnknownError',
    ...(error instanceof Error && error.name === 'ProviderError'
      ? { code: (error as { code?: string }).code }
      : {}),
  };
}
