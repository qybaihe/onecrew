import type { AppEnv } from '@onecrew/config';
import { Redis } from 'ioredis';
import { Pool } from 'pg';

export interface ReadinessProbe {
  readonly name: 'postgres' | 'redis' | 'objectStorage';
  check(): Promise<void>;
  close?(): Promise<void>;
}

export interface ProbeResult {
  status: 'up' | 'down';
  latencyMs: number;
  errorType?: string;
}

export async function runProbe(probe: ReadinessProbe): Promise<ProbeResult> {
  const startedAt = performance.now();

  try {
    await probe.check();
    return {
      status: 'up',
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - startedAt),
      errorType: error instanceof Error ? error.name : 'UnknownError',
    };
  }
}

export function createInfrastructureProbes(env: AppEnv): ReadinessProbe[] {
  const postgres = new Pool({
    connectionString: env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 1_500,
    idleTimeoutMillis: 5_000,
  });

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_500,
    commandTimeout: 1_500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);

  return [
    {
      name: 'postgres',
      async check() {
        await postgres.query('select 1 as ready');
      },
      async close() {
        await postgres.end();
      },
    },
    {
      name: 'redis',
      async check() {
        if (redis.status === 'wait' || redis.status === 'end') {
          await redis.connect();
        }
        await redis.ping();
      },
      async close() {
        if (redis.status !== 'end') {
          redis.disconnect(false);
        }
      },
    },
    {
      name: 'objectStorage',
      async check() {
        const readyUrl = new URL('/minio/health/ready', env.S3_ENDPOINT);
        const response = await fetch(readyUrl, {
          signal: AbortSignal.timeout(1_500),
        });

        if (!response.ok) {
          throw new Error(`Object storage readiness returned HTTP ${response.status}`);
        }
      },
    },
  ];
}
