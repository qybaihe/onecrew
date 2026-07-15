import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { z } from 'zod';

import { redisConnectionFromUrl } from './render-queue.js';

export const LOCALIZATION_QUEUE_NAME = 'onecrew-localization-runs';
export const localizationQueuePayloadSchema = z.object({ localizationRunId: z.string().min(1).max(128) });
export type LocalizationQueuePayload = z.infer<typeof localizationQueuePayloadSchema>;

export interface LocalizationJobQueue {
  enqueue(localizationRunId: string): Promise<{ queueJobId: string }>;
  cancel(localizationRunId: string): Promise<{ removed: boolean }>;
}

export class BullLocalizationQueue implements LocalizationJobQueue {
  readonly queue: Queue<LocalizationQueuePayload>;

  constructor(redisUrl: string) {
    this.queue = new Queue(LOCALIZATION_QUEUE_NAME, {
      connection: redisConnectionFromUrl(redisUrl),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 2_000 },
      },
    });
  }

  async enqueue(localizationRunId: string): Promise<{ queueJobId: string }> {
    if (localizationRunId.includes(':')) throw new Error('BullMQ custom job IDs must not contain colons');
    const options: JobsOptions = { jobId: localizationRunId };
    const job = await this.queue.add('localization-run', { localizationRunId }, options);
    if (!job.id) throw new Error('BullMQ did not return a localization Job ID');
    return { queueJobId: job.id };
  }

  async cancel(localizationRunId: string): Promise<{ removed: boolean }> {
    const job = await this.queue.getJob(localizationRunId);
    if (!job || (await job.getState()) === 'active') return { removed: false };
    await job.remove();
    return { removed: true };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createLocalizationWorker(
  redisUrl: string,
  processor: Processor<LocalizationQueuePayload>,
  concurrency: number,
): Worker<LocalizationQueuePayload> {
  return new Worker<LocalizationQueuePayload>(
    LOCALIZATION_QUEUE_NAME,
    async (job, token) => processor(job, token),
    { connection: redisConnectionFromUrl(redisUrl), concurrency },
  );
}
