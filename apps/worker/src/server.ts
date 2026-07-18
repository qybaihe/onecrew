import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadEnv } from '@onecrew/config';
import { createDatabase, createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { FeishuClient } from '@onecrew/feishu';
import { S3MediaStore } from '@onecrew/media';
import { ProviderGateway, createProviderRegistry } from '@onecrew/providers';
import { runControlledProcess, TechnicalQcEngine } from '@onecrew/qc';
import { ServerRemotionEngine } from '@onecrew/remotion';
import {
  BullLocalizationQueue,
  BullProviderQueue,
  BullQcQueue,
  BullRenderQueue,
  LocalizationOrchestrator,
  ProviderOrchestrator,
  QcOrchestrator,
  RenderOrchestrator,
  createLocalizationWorker,
  createProviderWorker,
  createQcWorker,
  createRenderWorker,
} from '@onecrew/workflows';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const mediaStore = S3MediaStore.fromEnv(env);
await mediaStore.ensureBucket();
const registry = createProviderRegistry(env, mediaStore);
const gateway = new ProviderGateway(registry, {
  pollIntervalMs: env.PROVIDER_POLL_INTERVAL_MS,
  onAudit: async (event) => {
    const eventId = `provider_${createInputHash(event).slice(0, 32)}`;
    await repositories.audit.record({
      auditId: `audit_${createInputHash({ eventId, action: event.action }).slice(0, 32)}`,
      source: 'provider_gateway',
      eventId,
      action: event.action,
      outcome: event.action === 'error' ? 'failed' : 'accepted',
      details: {
        capability: event.capability,
        provider: event.provider,
        model: event.model,
        mode: event.mode,
        route: event.route,
        inputHash: event.inputHash,
        ...(event.outputHash ? { outputHash: event.outputHash } : {}),
        attempt: event.attempt,
        latencyMs: event.latencyMs,
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      },
    });
  },
});
const queue = new BullProviderQueue(env.REDIS_URL);
const orchestrator = new ProviderOrchestrator(repositories, gateway, queue, {
  softBudgetRatio: env.PROVIDER_SOFT_BUDGET_RATIO,
});
const worker = createProviderWorker(
  env.REDIS_URL,
  async (job) => orchestrator.execute(job.data.jobId),
  env.PROVIDER_QUEUE_CONCURRENCY,
);
const localizationQueue = new BullLocalizationQueue(env.REDIS_URL);
const localizationOrchestrator = new LocalizationOrchestrator(
  repositories,
  localizationQueue,
  orchestrator,
  {
    providerPollMs: env.QC_PROVIDER_POLL_MS,
    providerTimeoutMs: env.QC_PROVIDER_TIMEOUT_MS,
    cancelPollMs: env.QC_CANCEL_POLL_MS,
  },
);
const localizationWorker = createLocalizationWorker(
  env.REDIS_URL,
  async (job) => localizationOrchestrator.execute(job.data.localizationRunId),
  env.LOCALIZATION_QUEUE_CONCURRENCY,
);
const renderQueue = new BullRenderQueue(env.REDIS_URL);
const remotionEngine = new ServerRemotionEngine({
  ...(env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: env.REMOTION_BROWSER_EXECUTABLE }
    : {}),
  ...(env.REMOTION_FINAL_MAX_DIMENSION
    ? { finalMaxDimension: env.REMOTION_FINAL_MAX_DIMENSION }
    : {}),
  mediaUriResolver: async (uri) => {
    if (!uri.startsWith('s3://')) return uri;
    return mediaStore.presignGet(uri);
  },
});
const renderOrchestrator = new RenderOrchestrator(
  repositories,
  renderQueue,
  remotionEngine,
  mediaStore,
  { codeVersion: env.APP_VERSION, cancelPollMs: env.RENDER_CANCEL_POLL_MS },
);
const renderWorker = createRenderWorker(
  env.REDIS_URL,
  async (job) => renderOrchestrator.execute(job.data.renderId),
  env.RENDER_QUEUE_CONCURRENCY,
);
const qcQueue = new BullQcQueue(env.REDIS_URL);
const technicalQc = new TechnicalQcEngine({
  ffmpegPath: env.FFMPEG_PATH,
  ffprobePath: env.FFPROBE_PATH,
});
const feishuClient =
  env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_QC_RECEIVE_ID
    ? new FeishuClient({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET })
    : undefined;
const qcOrchestrator = new QcOrchestrator(
  repositories,
  qcQueue,
  orchestrator,
  renderOrchestrator,
  technicalQc,
  {
    async materialize(uri) {
      const object = await mediaStore.get(uri);
      const directory = await mkdtemp(path.join(os.tmpdir(), 'onecrew-qc-'));
      const extension = path.extname(object.key) || '.bin';
      const filePath = path.join(directory, `source${extension}`);
      const reviewPath = path.join(directory, 'vlm-review.jpg');
      await writeFile(filePath, object.bytes);
      const isVideo = object.contentType.startsWith('video/') || extension.toLowerCase() === '.mp4';
      await runControlledProcess(
        env.FFMPEG_PATH,
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          filePath,
          '-frames:v',
          '1',
          '-vf',
          isVideo
            ? 'fps=1,scale=320:-2:flags=lanczos,tile=3x3:padding=4:margin=4'
            : 'scale=1280:-2:force_original_aspect_ratio=decrease:flags=lanczos',
          '-q:v',
          '3',
          reviewPath,
        ],
        { timeoutMs: 120_000 },
      );
      const reviewBytes = await readFile(reviewPath);
      return {
        filePath,
        providerUri: `data:image/jpeg;base64,${reviewBytes.toString('base64')}`,
        providerMediaType: 'image' as const,
        cleanup: () => rm(directory, { recursive: true, force: true }),
      };
    },
  },
  feishuClient && env.FEISHU_QC_RECEIVE_ID
    ? {
        async publish({ card }) {
          await feishuClient.sendInteractiveCard(
            env.FEISHU_QC_RECEIVE_ID!,
            env.FEISHU_QC_RECEIVE_ID_TYPE,
            card,
          );
          return 'sent' as const;
        },
      }
    : undefined,
  {
    providerPollMs: env.QC_PROVIDER_POLL_MS,
    providerTimeoutMs: env.QC_PROVIDER_TIMEOUT_MS,
    providerFailureGraceMs: env.QC_PROVIDER_FAILURE_GRACE_MS,
    cancelPollMs: env.QC_CANCEL_POLL_MS,
  },
);
const qcWorker = createQcWorker(
  env.REDIS_URL,
  async (job) => qcOrchestrator.execute(job.data.qcRunId),
  env.QC_QUEUE_CONCURRENCY,
);

worker.on('completed', (job, result) => {
  process.stdout.write(`${JSON.stringify({ event: 'provider_job_completed', jobId: job.id, result })}\n`);
});
worker.on('failed', (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'provider_job_failed', jobId: job?.id, errorType: error.name })}\n`,
  );
});
renderWorker.on('completed', (job, result) => {
  process.stdout.write(`${JSON.stringify({ event: 'render_completed', renderId: job.id, result })}\n`);
});
renderWorker.on('failed', (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'render_failed', renderId: job?.id, errorType: error.name })}\n`,
  );
});
qcWorker.on('completed', (job, result) => {
  process.stdout.write(`${JSON.stringify({ event: 'qc_completed', qcRunId: job.id, result })}\n`);
});
qcWorker.on('failed', (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'qc_failed', qcRunId: job?.id, errorType: error.name })}\n`,
  );
});
localizationWorker.on('completed', (job, result) => {
  process.stdout.write(
    `${JSON.stringify({ event: 'localization_completed', localizationRunId: job.id, result })}\n`,
  );
});
localizationWorker.on('failed', (job, error) => {
  process.stderr.write(
    `${JSON.stringify({ event: 'localization_failed', localizationRunId: job?.id, errorType: error.name })}\n`,
  );
});
const qcBinaries = await technicalQc.checkAvailability();
await Promise.all([
  worker.waitUntilReady(),
  renderWorker.waitUntilReady(),
  qcWorker.waitUntilReady(),
  localizationWorker.waitUntilReady(),
  remotionEngine.prepare(),
]);
process.stdout.write(
  `${JSON.stringify({
    event: 'onecrew_worker_ready',
    providerMode: env.PROVIDER_MODE,
    routes: registry.describe(),
    remotion: { renderer: 'server', queueConcurrency: env.RENDER_QUEUE_CONCURRENCY },
    qc: {
      queueConcurrency: env.QC_QUEUE_CONCURRENCY,
      ffmpeg: qcBinaries.ffmpeg,
      ffprobe: qcBinaries.ffprobe,
      reviewDelivery: feishuClient ? 'feishu' : 'mock_outbox',
    },
    localization: { queueConcurrency: env.LOCALIZATION_QUEUE_CONCURRENCY },
  })}\n`,
);

async function stop(signal: NodeJS.Signals): Promise<void> {
  process.stdout.write(`${JSON.stringify({ event: 'onecrew_worker_stopping', signal })}\n`);
  await worker.close();
  await renderWorker.close();
  await qcWorker.close();
  await localizationWorker.close();
  await localizationQueue.close();
  await qcQueue.close();
  await renderQueue.close();
  await queue.close();
  mediaStore.destroy();
  await database.close();
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));
