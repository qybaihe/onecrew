import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { z } from 'zod';

export const RENDER_QUEUE_NAME = 'onecrew-remotion-renders';
export const renderQueuePayloadSchema = z.object({ renderId: z.string().min(1).max(128) });
export type RenderQueuePayload = z.infer<typeof renderQueuePayloadSchema>;

export function redisConnectionFromUrl(redisUrl: string) {
  const parsed = new URL(redisUrl);
  const dbText = parsed.pathname.replace(/^\//, '');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(dbText ? { db: Number(dbText) } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}
export interface RenderJobQueue {
  enqueue(renderId: string): Promise<{ queueJobId: string }>;
  cancel(renderId: string): Promise<{ removed: boolean }>;
}

export class BullRenderQueue implements RenderJobQueue {
  readonly queue: Queue<RenderQueuePayload>;

  constructor(redisUrl: string) {
    this.queue = new Queue(RENDER_QUEUE_NAME, {
      connection: redisConnectionFromUrl(redisUrl),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 500 },
        removeOnFail: { count: 2_000 },
      },
    });
  }

  async enqueue(renderId: string): Promise<{ queueJobId: string }> {
    if (renderId.includes(':')) throw new Error('BullMQ custom job IDs must not contain colons');
    const existing = await this.queue.getJob(renderId);
    if (existing?.id) {
      if ((await existing.getState()) === 'failed') {
        await existing.retry('failed', {
          resetAttemptsMade: true,
          resetAttemptsStarted: true,
        });
      }
      return { queueJobId: existing.id };
    }
    const options: JobsOptions = { jobId: renderId };
    const job = await this.queue.add('remotion-render', { renderId }, options);
    if (!job.id) throw new Error('BullMQ did not return a render Job ID');
    return { queueJobId: job.id };
  }

  async cancel(renderId: string): Promise<{ removed: boolean }> {
    const job = await this.queue.getJob(renderId);
    if (!job || (await job.getState()) === 'active') return { removed: false };
    await job.remove();
    return { removed: true };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createRenderWorker(
  redisUrl: string,
  processor: Processor<RenderQueuePayload>,
  concurrency: number,
): Worker<RenderQueuePayload> {
  return new Worker<RenderQueuePayload>(
    RENDER_QUEUE_NAME,
    async (job, token) => processor(job, token),
    { connection: redisConnectionFromUrl(redisUrl), concurrency },
  );
}
