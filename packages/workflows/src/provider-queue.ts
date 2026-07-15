import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { z } from 'zod';

import { redisConnectionFromUrl } from './render-queue.js';

export const PROVIDER_QUEUE_NAME = 'onecrew-provider-jobs';
export const providerQueuePayloadSchema = z.object({ jobId: z.string().min(1).max(128) });
export type ProviderQueuePayload = z.infer<typeof providerQueuePayloadSchema>;

export interface ProviderJobQueue {
  enqueue(jobId: string): Promise<{ queueJobId: string }>;
  cancel(jobId: string): Promise<{ removed: boolean }>;
}

export class BullProviderQueue implements ProviderJobQueue {
  readonly queue: Queue<ProviderQueuePayload>;

  constructor(redisUrl: string) {
    this.queue = new Queue(PROVIDER_QUEUE_NAME, {
      connection: redisConnectionFromUrl(redisUrl),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 5_000 },
      },
    });
  }

  async enqueue(jobId: string): Promise<{ queueJobId: string }> {
    if (jobId.includes(':')) throw new Error('BullMQ custom job IDs must not contain colons');
    const options: JobsOptions = { jobId };
    const job = await this.queue.add('provider-execute', { jobId }, options);
    if (!job.id) throw new Error('BullMQ did not return a job ID');
    return { queueJobId: job.id };
  }

  async cancel(jobId: string): Promise<{ removed: boolean }> {
    const job = await this.queue.getJob(jobId);
    if (!job) return { removed: false };
    if ((await job.getState()) === 'active') return { removed: false };
    await job.remove();
    return { removed: true };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createProviderWorker(
  redisUrl: string,
  processor: Processor<ProviderQueuePayload>,
  concurrency: number,
): Worker<ProviderQueuePayload> {
  return new Worker<ProviderQueuePayload>(
    PROVIDER_QUEUE_NAME,
    async (job, token) => processor(job, token),
    {
      connection: redisConnectionFromUrl(redisUrl),
      concurrency,
      limiter: { max: Math.max(1, concurrency * 2), duration: 1_000 },
    },
  );
}
