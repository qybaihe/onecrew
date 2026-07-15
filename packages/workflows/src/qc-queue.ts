import { Queue, Worker, type JobsOptions, type Processor } from 'bullmq';
import { z } from 'zod';

import { redisConnectionFromUrl } from './render-queue.js';

export const QC_QUEUE_NAME = 'onecrew-qc-runs';
export const qcQueuePayloadSchema = z.object({ qcRunId: z.string().min(1).max(128) });
export type QcQueuePayload = z.infer<typeof qcQueuePayloadSchema>;

export interface QcJobQueue {
  enqueue(qcRunId: string): Promise<{ queueJobId: string }>;
  cancel(qcRunId: string): Promise<{ removed: boolean }>;
}

export class BullQcQueue implements QcJobQueue {
  readonly queue: Queue<QcQueuePayload>;

  constructor(redisUrl: string) {
    this.queue = new Queue(QC_QUEUE_NAME, {
      connection: redisConnectionFromUrl(redisUrl),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 2_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail: { count: 2_000 },
      },
    });
  }

  async enqueue(qcRunId: string): Promise<{ queueJobId: string }> {
    if (qcRunId.includes(':')) throw new Error('BullMQ custom job IDs must not contain colons');
    const options: JobsOptions = { jobId: qcRunId };
    const job = await this.queue.add('qc-run', { qcRunId }, options);
    if (!job.id) throw new Error('BullMQ did not return a QC Job ID');
    return { queueJobId: job.id };
  }

  async cancel(qcRunId: string): Promise<{ removed: boolean }> {
    const job = await this.queue.getJob(qcRunId);
    if (!job || (await job.getState()) === 'active') return { removed: false };
    await job.remove();
    return { removed: true };
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}

export function createQcWorker(
  redisUrl: string,
  processor: Processor<QcQueuePayload>,
  concurrency: number,
): Worker<QcQueuePayload> {
  return new Worker<QcQueuePayload>(
    QC_QUEUE_NAME,
    async (job, token) => processor(job, token),
    { connection: redisConnectionFromUrl(redisUrl), concurrency },
  );
}
