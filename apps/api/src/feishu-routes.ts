import {
  FeishuWebhookSecurityError,
  normalizeFeishuCardAction,
  parseFeishuWebhook,
  type CardActionService,
  type FeishuWebhookSecurity,
} from '@onecrew/feishu';
import type { FastifyInstance } from 'fastify';

export interface FeishuRouteOptions {
  security: FeishuWebhookSecurity;
  cardActionService: Pick<CardActionService, 'handle'>;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function urlVerificationChallenge(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.challenge !== 'string') return undefined;
  if (payload.type === 'url_verification' || typeof payload.token === 'string') {
    return payload.challenge;
  }
  return undefined;
}

export function registerFeishuRoutes(app: FastifyInstance, options?: FeishuRouteOptions): void {
  async function parseRequest(request: {
    rawBody?: string;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<Record<string, unknown>> {
    if (!options?.security.verificationToken) {
      throw new FeishuRouteNotConfiguredError();
    }
    if (!request.rawBody) throw new FeishuWebhookSecurityError('Missing raw Feishu request body');
    const timestamp = headerValue(request.headers['x-lark-request-timestamp']);
    const nonce = headerValue(request.headers['x-lark-request-nonce']);
    const signature = headerValue(request.headers['x-lark-signature']);
    return parseFeishuWebhook(
      request.rawBody,
      {
        ...(timestamp ? { timestamp } : {}),
        ...(nonce ? { nonce } : {}),
        ...(signature ? { signature } : {}),
      },
      options.security,
    );
  }

  app.post('/v1/feishu/events', async (request, reply) => {
    try {
      const payload = await parseRequest(request);
      const challenge = urlVerificationChallenge(payload);
      if (challenge) return { challenge };
      const header =
        typeof payload.header === 'object' && payload.header !== null
          ? (payload.header as Record<string, unknown>)
          : undefined;
      reply.code(202);
      return {
        accepted: true,
        eventId: typeof header?.event_id === 'string' ? header.event_id : undefined,
        eventType: typeof header?.event_type === 'string' ? header.event_type : undefined,
      };
    } catch (error) {
      return sendFeishuError(reply, error);
    }
  });

  app.post('/v1/feishu/card-actions', async (request, reply) => {
    try {
      const payload = await parseRequest(request);
      const challenge = urlVerificationChallenge(payload);
      if (challenge) return { challenge };
      const action = normalizeFeishuCardAction(payload);
      const result = await options!.cardActionService.handle(action);
      return { ok: true, result };
    } catch (error) {
      request.log.warn(
        {
          errorName: error instanceof Error ? error.name : 'UnknownError',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          hasTimestamp: typeof request.headers['x-lark-request-timestamp'] === 'string',
          hasNonce: typeof request.headers['x-lark-request-nonce'] === 'string',
          hasSignature: typeof request.headers['x-lark-signature'] === 'string',
        },
        'Feishu card callback rejected',
      );
      return sendFeishuError(reply, error);
    }
  });
}

export class FeishuRouteNotConfiguredError extends Error {
  constructor() {
    super('Feishu webhook security is not configured');
    this.name = 'FeishuRouteNotConfiguredError';
  }
}

function sendFeishuError(
  reply: { code(statusCode: number): unknown },
  error: unknown,
): { ok: false; error: string } {
  const name = error instanceof Error ? error.name : 'UnknownError';
  if (error instanceof FeishuRouteNotConfiguredError) reply.code(503);
  else if (error instanceof FeishuWebhookSecurityError || name === 'UnauthorizedFeishuActorError') {
    reply.code(401);
  } else if (
    name === 'CardActionInProgressError' ||
    name === 'VersionConflictError' ||
    name === 'InvalidHumanGateResolutionError'
  ) {
    reply.code(409);
  } else {
    reply.code(400);
  }
  return { ok: false, error: name };
}
