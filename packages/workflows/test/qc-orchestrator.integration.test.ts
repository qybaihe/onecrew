import { loadEnv } from '@onecrew/config';
import {
  projectSpecSchema,
  qcRunRequestSchema,
  type ProviderRequest,
  type TechnicalQcReport,
} from '@onecrew/contracts';
import { createDatabase, createRepositories } from '@onecrew/db';
import { ProviderGateway, createMockRegistry } from '@onecrew/providers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ProviderOrchestrator } from '../src/provider-orchestrator.js';
import { BullProviderQueue, createProviderWorker } from '../src/provider-queue.js';
import { QcOrchestrator } from '../src/qc-orchestrator.js';
import { BullQcQueue, createQcWorker } from '../src/qc-queue.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const providerQueue = new BullProviderQueue(env.REDIS_URL);
const provider = new ProviderOrchestrator(
  repositories,
  new ProviderGateway(createMockRegistry(), {
    pollIntervalMs: 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
  }),
  providerQueue,
  { softBudgetRatio: 0.8 },
);
const providerWorker = createProviderWorker(
  env.REDIS_URL,
  async (job) => provider.execute(job.data.jobId),
  2,
);
const qcQueue = new BullQcQueue(env.REDIS_URL);
const injectedFailure: TechnicalQcReport = {
  passed: false,
  probe: {
    durationSec: 2,
    width: 320,
    height: 180,
    fps: 30,
    videoCodec: 'h264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    colorSpace: 'bt709',
  },
  blackSegments: [{ startSec: 0, endSec: 2, durationSec: 2 }],
  freezeSegments: [{ startSec: 0, endSec: 2, durationSec: 2 }],
  silenceSegments: [{ startSec: 0, endSec: 2, durationSec: 2 }],
  checks: [
    {
      code: 'black_frames',
      passed: false,
      severity: 'error',
      actual: 2,
      expected: 0.25,
      reason: 'Black frames last 2.000s; limit is 0.250s',
    },
    {
      code: 'freeze_frames',
      passed: false,
      severity: 'error',
      actual: 2,
      expected: 0.5,
      reason: 'Frozen picture lasts 2.000s; limit is 0.500s',
    },
    {
      code: 'silence',
      passed: false,
      severity: 'error',
      actual: 2,
      expected: 0.5,
      reason: 'Silence lasts 2.000s; limit is 0.500s',
    },
  ],
  analyzedAt: new Date().toISOString(),
};
const qc = new QcOrchestrator(
  repositories,
  qcQueue,
  provider,
  undefined,
  { async analyze() { return injectedFailure; } },
  {
    async materialize(uri) {
      return { filePath: '/tmp/injected-failure.mp4', providerUri: uri, cleanup: async () => undefined };
    },
  },
  undefined,
  { providerPollMs: 20, providerTimeoutMs: 8_000, providerFailureGraceMs: 50, cancelPollMs: 20 },
);
const qcWorker = createQcWorker(env.REDIS_URL, async (job) => qc.execute(job.data.qcRunId), 1);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

async function waitForJob(jobId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const current = await repositories.jobs.get(jobId);
    if (current.value.status === 'succeeded') return;
    if (current.value.status === 'failed') throw new Error(current.value.errorMessage ?? 'Provider failed');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for job ${jobId}`);
}

async function waitForQc(qcRunId: string, status: 'succeeded' | 'waiting_human') {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const current = await qc.get(qcRunId);
    if (current.value.status === status) return current;
    if (current.value.status === 'failed') throw new Error(current.value.errorMessage ?? 'QC failed');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for QC ${qcRunId} to become ${status}`);
}

beforeAll(async () => {
  await Promise.all([providerWorker.waitUntilReady(), qcWorker.waitUntilReady()]);
});

afterAll(async () => {
  await qcWorker.close();
  await providerWorker.close();
  await qcQueue.close();
  await providerQueue.close();
  await database.close();
});

describe('durable QC orchestration with bounded recovery', () => {
  it('auto-regenerates once, then emits an actionable four-action card and recovers via fallback', async () => {
    const projectId = `prj_qc_${suffix}`;
    const shotId = `shot_qc_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '质检恢复闭环',
        nameEn: 'QC Recovery Loop',
        synopsis: 'Deliberately injected black, freeze and silence defects.',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_qc_test',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 100,
        status: 'draft',
      }),
    );
    await repositories.shots.create({
      shotId,
      projectId,
      sequence: 1,
      durationSec: 2,
      characters: [],
      sceneId: 'scene_qc',
      action: 'Hero crosses the ridge',
      camera: 'slow push',
      prompt: 'Hero crosses a luminous mountain ridge',
      referenceAssetIds: [],
      importance: 'hero',
      closeupDialogue: false,
      status: 'planned',
    });
    const sourceRequest: ProviderRequest = {
      capability: 'video',
      projectId,
      route: 'primary',
      shotId,
      prompt: 'Hero crosses a luminous mountain ridge',
      durationSec: 2,
      aspectRatio: '16:9',
    };
    const source = await provider.submit(sourceRequest, `idem_qc_source_${suffix}`);
    await waitForJob(source.jobId);

    const baseRequest = {
      projectId,
      shotId,
      sourceJobId: source.jobId,
      mediaUri: `mock://onecrew/video/injected-${suffix}.mp4`,
      mediaType: 'video' as const,
      expectedDescription: 'ShotSpec hero action with immutable Design Pack wardrobe and brand tokens',
      criteria: ['character', 'clothing', 'scene', 'props', 'action', 'subtitles', 'locale', 'brand', 'lipsync', 'artifacts', 'compliance'],
      technical: {},
      route: 'primary' as const,
      autoRemediate: true,
      remediation: 'generation' as const,
    };
    const first = await qc.submit(
      qcRunRequestSchema.parse({ ...baseRequest, qualityAttempt: 1 }),
      `idem_qc_first_${suffix}`,
    );
    const autoRecovered = await waitForQc(first.qcRunId, 'succeeded');
    expect(autoRecovered.value).toMatchObject({
      decision: 'regenerate',
      retryPatch: { technical_failure_codes: ['black_frames', 'freeze_frames', 'silence'] },
    });
    expect(autoRecovered.value.remediationJobId).toMatch(/^job_/);
    await waitForJob(autoRecovered.value.remediationJobId!);

    const second = await qc.submit(
      qcRunRequestSchema.parse({ ...baseRequest, qualityAttempt: 2 }),
      `idem_qc_second_${suffix}`,
    );
    const waiting = await waitForQc(second.qcRunId, 'waiting_human');
    expect(waiting.value).toMatchObject({
      decision: 'manual',
      reviewDelivery: 'mock_outbox',
    });
    expect(waiting.value.reason).toContain('Automatic quality retry limit reached');
    expect(waiting.value.reason).toContain('Black frames last 2.000s');
    const actions = (
      waiting.value.reviewCard?.body as {
        elements?: Array<{
          columns?: Array<{
            elements?: Array<{
              behaviors?: Array<{ type?: string; value?: { action?: string } }>;
            }>;
          }>;
        }>;
      }
    ).elements?.flatMap((element) =>
      (element.columns ?? []).flatMap((column) =>
        (column.elements ?? []).flatMap((button) =>
          (button.behaviors ?? [])
            .filter((behavior) => behavior.type === 'callback')
            .map((behavior) => behavior.value?.action),
        ),
      ),
    );
    expect(actions).toEqual(['approve', 'regenerate', 'switch_provider', 'manual']);

    const gate = await repositories.humanGates.get(waiting.value.gateId!);
    const resolved = await qc.resolveHuman(second.qcRunId, 'switch_provider', `evt_qc_switch_${suffix}`);
    expect(resolved).toMatchObject({ outcome: 'qc_regeneration_queued', route: 'fallback' });
    await repositories.humanGates.resolve(gate.gateId, gate.version, {
      action: 'switch_provider',
      projectId,
      targetType: gate.targetType,
      targetId: gate.targetId,
      expectedVersion: gate.expectedTargetVersion,
      actorOpenId: 'ou_qc_test',
      eventId: `evt_qc_switch_${suffix}`,
    });
    const recovered = await qc.get(second.qcRunId);
    expect(recovered.value).toMatchObject({ status: 'succeeded', remediationJobId: resolved.replacementId });
    await waitForJob(recovered.value.remediationJobId!);
  });
});
