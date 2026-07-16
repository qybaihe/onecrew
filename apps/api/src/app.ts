import { loadEnv, type AppEnv } from '@onecrew/config';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  createInfrastructureProbes,
  runProbe,
  type ProbeResult,
  type ReadinessProbe,
} from './readiness.js';
import { registerCreativeRoutes, type CreativeRouteOptions } from './creative-routes.js';
import { registerFeishuRoutes, type FeishuRouteOptions } from './feishu-routes.js';
import { registerLocalizationRoutes, type LocalizationRouteOptions } from './localization-routes.js';
import { registerProviderRoutes, type ProviderRouteOptions } from './provider-routes.js';
import { registerPublishRoutes, type PublishRouteOptions } from './publish-routes.js';
import { registerQcRoutes, type QcRouteOptions } from './qc-routes.js';
import { registerRenderRoutes, type RenderRouteOptions } from './render-routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface CreateAppOptions {
  env?: AppEnv;
  probes?: ReadinessProbe[];
  logger?: boolean;
  creatives?: CreativeRouteOptions;
  feishu?: FeishuRouteOptions;
  localizations?: LocalizationRouteOptions;
  providers?: ProviderRouteOptions;
  publishes?: PublishRouteOptions;
  qc?: QcRouteOptions;
  renders?: RenderRouteOptions;
}

export interface ReadyResponse {
  status: 'ready' | 'degraded';
  checkedAt: string;
  components: Record<string, ProbeResult>;
}

const redactedLogPaths = [
  'req.headers.authorization',
  'req.headers.x-api-key',
  'req.body.token',
  'req.body.secret',
  'req.body.password',
  'res.headers.set-cookie',
];

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const env = options.env ?? loadEnv();
  const probes = options.probes ?? createInfrastructureProbes(env);
  const app = Fastify({
    logger:
      options.logger === false || env.NODE_ENV === 'test'
        ? false
        : {
            level: env.LOG_LEVEL,
            redact: {
              paths: redactedLogPaths,
              censor: '[REDACTED]',
            },
          },
  });

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    const rawBody = typeof body === 'string' ? body : body.toString('utf8');
    request.rawBody = rawBody;
    try {
      done(null, JSON.parse(rawBody) as unknown);
    } catch (error) {
      done(error as Error);
    }
  });
  app.addContentTypeParser(
    ['application/zip', 'application/x-zip-compressed'],
    { parseAs: 'buffer' },
    (_request, body, done) => done(null, body),
  );

  app.get('/healthz', { logLevel: 'silent' }, async () => ({
    status: 'ok' as const,
    service: 'onecrew-api',
    version: env.APP_VERSION,
    uptimeSec: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString(),
  }));

  app.get('/readyz', async (_request, reply): Promise<ReadyResponse> => {
    const results = await Promise.all(
      probes.map(async (probe) => [probe.name, await runProbe(probe)] as const),
    );
    const components = Object.fromEntries(results);
    const status = results.every(([, result]) => result.status === 'up') ? 'ready' : 'degraded';

    reply.code(status === 'ready' ? 200 : 503);
    return {
      status,
      checkedAt: new Date().toISOString(),
      components,
    };
  });

  registerCreativeRoutes(app, options.creatives);
  registerFeishuRoutes(app, options.feishu);
  registerLocalizationRoutes(app, options.localizations);
  registerProviderRoutes(app, options.providers);
  registerPublishRoutes(app, options.publishes);
  registerQcRoutes(app, options.qc);
  registerRenderRoutes(app, options.renders);

  app.addHook('onClose', async () => {
    await Promise.all(probes.map(async (probe) => probe.close?.()));
  });

  return app;
}
