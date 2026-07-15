import { loadEnv } from '@onecrew/config';
import { createDatabase, createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import {
  CardActionService,
  FeishuClient,
  FeishuRecordSync,
  type CardActionRuntime,
} from '@onecrew/feishu';
import { S3MediaStore } from '@onecrew/media';
import { ProviderGateway, createProviderRegistry } from '@onecrew/providers';
import {
  BullLocalizationQueue,
  BullProviderQueue,
  BullQcQueue,
  BullRenderQueue,
  LocalizationOrchestrator,
  ProductionWorkflow,
  PublishOrchestrator,
  ProviderCallbackProcessor,
  ProviderOrchestrator,
  QcOrchestrator,
  RenderOrchestrator,
} from '@onecrew/workflows';

import { createApp } from './app.js';

const env = loadEnv();
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const mediaStore = S3MediaStore.fromEnv(env);
await mediaStore.ensureBucket();
const providerRegistry = createProviderRegistry(env, mediaStore);
const providerGateway = new ProviderGateway(providerRegistry, {
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
        attempt: event.attempt,
        latencyMs: event.latencyMs,
        ...(event.outputHash ? { outputHash: event.outputHash } : {}),
        ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      },
    });
  },
});
const providerQueue = new BullProviderQueue(env.REDIS_URL);
const providerOrchestrator = new ProviderOrchestrator(
  repositories,
  providerGateway,
  providerQueue,
  { softBudgetRatio: env.PROVIDER_SOFT_BUDGET_RATIO },
);
const providerCallbackProcessor = new ProviderCallbackProcessor(repositories);
const localizationQueue = new BullLocalizationQueue(env.REDIS_URL);
const localizationOrchestrator = new LocalizationOrchestrator(
  repositories,
  localizationQueue,
  providerOrchestrator,
  {
    providerPollMs: env.QC_PROVIDER_POLL_MS,
    providerTimeoutMs: env.QC_PROVIDER_TIMEOUT_MS,
    cancelPollMs: env.QC_CANCEL_POLL_MS,
  },
);
const feishuDataClient =
  env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_BASE_APP_TOKEN
    ? new FeishuClient({ appId: env.FEISHU_APP_ID, appSecret: env.FEISHU_APP_SECRET })
    : undefined;
const publishOrchestrator = new PublishOrchestrator(
  repositories,
  mediaStore,
  feishuDataClient && env.FEISHU_BASE_APP_TOKEN
    ? {
        async write(records) {
          const tables = await feishuDataClient.listTables(env.FEISHU_BASE_APP_TOKEN!);
          const experimentTable = tables.find((table) => table.name === '出海实验');
          if (!experimentTable) throw new Error('Feishu Base is missing 出海实验 table');
          const sync = new FeishuRecordSync(feishuDataClient, repositories.feishuRecordLinks);
          for (const record of records) {
            const projectLink = await repositories.feishuRecordLinks.get('project', record.projectId);
            await sync.push({
              entityType: 'experiment',
              entityId: record.experimentId,
              appToken: env.FEISHU_BASE_APP_TOKEN!,
              tableId: experimentTable.table_id,
              localVersion: 1,
              fields: {
                experiment_id: record.experimentId,
                ...(projectLink ? { project_id: [projectLink.recordId] } : {}),
                creative_id: record.creativeId,
                episode: record.episode,
                language: record.language,
                platform: record.platform,
                hook: record.hook,
                ...(record.coverUri ? { cover: { link: record.coverUri, text: 'cover' } } : {}),
                spend: record.spend,
                retention_3s: record.retention3s,
                retention_15s: record.retention15s,
                ctr: record.ctr,
                conversion: record.conversion,
                roas: record.roas,
                recommendation: record.recommendation,
              },
            });
          }
          return 'sent' as const;
        },
      }
    : undefined,
);
const renderQueue = new BullRenderQueue(env.REDIS_URL);
const renderOrchestrator = new RenderOrchestrator(
  repositories,
  renderQueue,
  undefined,
  undefined,
  { codeVersion: env.APP_VERSION, cancelPollMs: env.RENDER_CANCEL_POLL_MS },
);
const qcQueue = new BullQcQueue(env.REDIS_URL);
const qcOrchestrator = new QcOrchestrator(
  repositories,
  qcQueue,
  providerOrchestrator,
  renderOrchestrator,
  undefined,
  undefined,
  undefined,
  {
    providerPollMs: env.QC_PROVIDER_POLL_MS,
    providerTimeoutMs: env.QC_PROVIDER_TIMEOUT_MS,
    providerFailureGraceMs: env.QC_PROVIDER_FAILURE_GRACE_MS,
    cancelPollMs: env.QC_CANCEL_POLL_MS,
  },
);
const productionWorkflow = await ProductionWorkflow.create({
  repositories,
  databaseUrl: env.DATABASE_URL,
});
const allowedActors = new Set(
  (env.FEISHU_ALLOWED_OPEN_IDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);
const workflowRuntime: CardActionRuntime = {
  async approve(action, gate) {
    if (gate.node.startsWith('qc_')) {
      return qcOrchestrator.resolveHuman(gate.workflowId, action.action, action.eventId);
    }
    if (gate.node === 'provider_budget_approval' && gate.targetType === 'job') {
      await providerOrchestrator.enqueueApprovedBudgetJob(gate.targetId);
      return { outcome: 'provider_job_queued', gateId: gate.gateId, jobId: gate.targetId };
    }
    const workflow = await productionWorkflow.resume(gate.workflowId, action.action);
    return {
      outcome: 'workflow_resumed',
      gateId: gate.gateId,
      workflowId: gate.workflowId,
      stage: workflow.state.currentStage,
      status: workflow.state.status,
    };
  },
  async regenerate(action, gate) {
    if (gate.node.startsWith('qc_')) {
      return qcOrchestrator.resolveHuman(gate.workflowId, action.action, action.eventId);
    }
    if (gate.targetType === 'job') {
      const replacement = await providerOrchestrator.regenerate(gate.targetId, 'primary', action.eventId);
      await providerOrchestrator.cancel(gate.targetId);
      return { outcome: 'regeneration_queued', gateId: gate.gateId, replacementJobId: replacement.jobId };
    }
    const workflow = await productionWorkflow.resume(gate.workflowId, action.action);
    return {
      outcome: 'workflow_regeneration_started',
      gateId: gate.gateId,
      stage: workflow.state.currentStage,
      route: workflow.state.preferredRoute,
    };
  },
  async switchProvider(action, gate) {
    if (gate.node.startsWith('qc_')) {
      return qcOrchestrator.resolveHuman(gate.workflowId, action.action, action.eventId);
    }
    if (gate.targetType === 'job') {
      const replacement = await providerOrchestrator.regenerate(gate.targetId, 'fallback', action.eventId);
      await providerOrchestrator.cancel(gate.targetId);
      return {
        outcome: 'fallback_regeneration_queued',
        gateId: gate.gateId,
        replacementJobId: replacement.jobId,
      };
    }
    const workflow = await productionWorkflow.resume(gate.workflowId, action.action);
    return {
      outcome: 'workflow_fallback_regeneration_started',
      gateId: gate.gateId,
      stage: workflow.state.currentStage,
      route: workflow.state.preferredRoute,
    };
  },
  async manual(action, gate) {
    if (gate.node.startsWith('qc_')) {
      return qcOrchestrator.resolveHuman(gate.workflowId, action.action, action.eventId);
    }
    if (gate.targetType === 'job') await providerOrchestrator.cancel(gate.targetId);
    if (gate.node === 'provider_budget_approval') {
      return { outcome: 'manual_required', gateId: gate.gateId, action: action.action };
    }
    const workflow = await productionWorkflow.resume(gate.workflowId, action.action);
    return {
      outcome: 'manual_required',
      gateId: gate.gateId,
      workflowId: gate.workflowId,
      status: workflow.state.status,
    };
  },
};
const cardActionService = new CardActionService({
  idempotency: repositories.idempotency,
  audit: repositories.audit,
  humanGates: repositories.humanGates,
  runtime: workflowRuntime,
  authorize: async (actorOpenId) => allowedActors.has(actorOpenId),
});
const app = createApp({
  env,
  creatives: { repository: repositories.creative, mediaStore },
  feishu: {
    security: {
      ...(env.FEISHU_VERIFICATION_TOKEN
        ? { verificationToken: env.FEISHU_VERIFICATION_TOKEN }
        : {}),
      ...(env.FEISHU_ENCRYPT_KEY ? { encryptKey: env.FEISHU_ENCRYPT_KEY } : {}),
    },
    cardActionService,
  },
  providers: {
    orchestrator: providerOrchestrator,
    callbackProcessor: providerCallbackProcessor,
    ...(env.PROVIDER_CALLBACK_SECRET ? { callbackSecret: env.PROVIDER_CALLBACK_SECRET } : {}),
  },
  localizations: { orchestrator: localizationOrchestrator },
  publishes: { orchestrator: publishOrchestrator },
  renders: { orchestrator: renderOrchestrator },
  qc: { orchestrator: qcOrchestrator },
});
app.addHook('onClose', async () => {
  await productionWorkflow.close();
  await renderQueue.close();
  await qcQueue.close();
  await providerQueue.close();
  await localizationQueue.close();
  mediaStore.destroy();
  await database.close();
});

async function stop(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, 'shutting down OneCrew API');
  await app.close();
  process.exitCode = 0;
}

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (error) {
  app.log.error({ err: error }, 'failed to start OneCrew API');
  process.exitCode = 1;
  await app.close();
}
