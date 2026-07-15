import {
  assetRecordSchema,
  creativeProjectBundleSchema,
  jobRecordSchema,
  type CreativeGenerationBatch,
  type JobRecord,
  type ProviderRequest,
} from '@onecrew/contracts';
import type { Versioned } from '@onecrew/db';
import { describe, expect, it } from 'vitest';

import { CreativeGenerationBatchOrchestrator } from './creative-generation-batch-orchestrator.js';

const now = '2026-07-15T00:00:00.000Z';
const projectId = 'prj_batch';
const shotIds = ['shot_batch_1', 'shot_batch_2', 'shot_batch_3'];

const bundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0',
  source: { system: 'onecrew' },
  project: {
    projectId,
    nameZh: '批量生成测试',
    nameEn: 'Batch generation test',
    synopsis: 'Batch generation test fixture.',
    audience: 'test',
    genres: ['test'],
    ownerOpenId: 'ou_test',
    locales: ['zh-CN'],
    aspectRatios: ['16:9'],
    budgetLimitCny: 100,
    status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_batch',
    projectId,
    episodeNumber: 1,
    title: '第一集',
    scriptContent: '',
    durationSec: 15,
    characterIds: [],
    sceneIds: ['scene_batch'],
    propIds: [],
    status: 'draft',
  }],
  entities: [{
    entityId: 'scene_batch',
    projectId,
    kind: 'scene',
    name: '星门',
    location: '星门',
    referenceAssetIds: [],
    extraAssetIds: [],
    sortOrder: 0,
    status: 'ready',
  }],
  shots: shotIds.map((shotId, index) => ({
    shotId,
    projectId,
    episodeId: 'episode_batch',
    sequence: index + 1,
    durationSec: 5,
    characters: [],
    sceneId: 'scene_batch',
    action: `动作 ${index + 1}`,
    camera: '固定',
    prompt: `prompt ${index + 1}`,
    referenceAssetIds: [],
    importance: 'normal',
    closeupDialogue: false,
    status: 'planned',
  })),
  framePrompts: [],
  mediaFiles: [],
});

const existingImage = assetRecordSchema.parse({
  assetId: 'asset_existing_image',
  projectId,
  shotId: shotIds[0],
  type: 'image',
  version: 1,
  uri: 's3://onecrew/existing.png',
  provider: 'fixture',
  model: 'fixture-v1',
  source: 'test',
  license: 'test',
  contentHash: '1'.repeat(64),
  status: 'draft',
  createdAt: now,
  updatedAt: now,
});

function fixture() {
  let stored: Versioned<CreativeGenerationBatch> | undefined;
  let storedKey: string | undefined;
  const jobs = new Map<string, Versioned<JobRecord>>();
  const requests: ProviderRequest[] = [];
  let sequence = 0;

  const createJob = (request: ProviderRequest, status: JobRecord['status'] = 'queued') => {
    sequence += 1;
    const jobId = `job_batch_${sequence}`;
    const job = jobRecordSchema.parse({
      jobId,
      projectId,
      ...('shotId' in request && request.shotId ? { shotId: request.shotId } : {}),
      capability: request.capability,
      provider: `mock-${request.capability}-primary`,
      model: 'deterministic-v1',
      mode: 'mock',
      status,
      attempt: 1,
      estimatedCostCny: 0.01,
      inputHash: String(sequence).padStart(64, '0'),
      outputAssetIds: [],
      createdAt: now,
      updatedAt: now,
    });
    jobs.set(jobId, { value: job, version: 1 });
    return {
      jobId,
      status: 'queued' as const,
      mode: 'mock' as const,
      provider: job.provider,
      route: 'primary' as const,
      estimatedCostCny: 0.01,
      statusUrl: `/v1/jobs/${jobId}`,
      replayed: false,
    };
  };

  const repositories = {
    creative: {
      async getBundle() { return bundle; },
      async listAssets() { return [existingImage]; },
      async getRecordVersions() {
        return {
          project: 1,
          episodes: { episode_batch: 1 },
          entities: { scene_batch: 1 },
          shots: Object.fromEntries(shotIds.map((shotId) => [shotId, 1])),
          framePrompts: {},
        };
      },
    },
    creativeGenerationBatches: {
      async create(record: CreativeGenerationBatch, idempotencyKey: string) {
        stored = { value: record, version: 1 };
        storedKey = idempotencyKey;
        return stored;
      },
      async get(batchId: string) {
        if (!stored || stored.value.batchId !== batchId) throw new Error('batch not found');
        return stored;
      },
      async getByIdempotency(id: string, key: string) {
        return stored?.value.projectId === id && storedKey === key ? stored : undefined;
      },
      async latestForProject(id: string) {
        return stored?.value.projectId === id ? stored : undefined;
      },
      async replace(batchId: string, expectedVersion: number, record: CreativeGenerationBatch) {
        if (!stored || stored.value.batchId !== batchId || stored.version !== expectedVersion) {
          throw new Error('batch version conflict');
        }
        stored = { value: record, version: expectedVersion + 1 };
        return stored;
      },
    },
    jobs: {
      async get(jobId: string) {
        const job = jobs.get(jobId);
        if (!job) throw new Error('job not found');
        return job;
      },
    },
  };
  const provider = {
    async submit(request: ProviderRequest) {
      requests.push(request);
      return createJob(request);
    },
    async cancel(jobId: string) {
      const current = jobs.get(jobId)!;
      jobs.set(jobId, {
        value: jobRecordSchema.parse({ ...current.value, status: 'cancelled', updatedAt: now }),
        version: current.version + 1,
      });
      return { status: 'cancelled' as const };
    },
    async regenerate(jobId: string) {
      const current = jobs.get(jobId)!;
      return createJob({
        capability: current.value.capability as 'image' | 'video',
        projectId,
        shotId: current.value.shotId,
        route: 'primary',
        generationNonce: current.value.attempt + 1,
        prompt: 'retry',
        ...(current.value.capability === 'image'
          ? { width: 1024, height: 576, count: 1, referenceUris: [] }
          : { durationSec: 5, aspectRatio: '16:9' }),
      } as ProviderRequest);
    },
  };
  return {
    orchestrator: new CreativeGenerationBatchOrchestrator(repositories, provider),
    jobs,
    requests,
  };
}

describe('creative generation batch orchestrator', () => {
  it('skips existing assets, submits the missing shots, replays idempotently, and syncs completion', async () => {
    const test = fixture();
    const request = {
      kind: 'image' as const,
      expectedVersions: Object.fromEntries(shotIds.map((shotId) => [shotId, 1])),
      missingOnly: true,
      route: 'primary' as const,
      generationNonce: 10,
      concurrency: 2,
    };
    const submitted = await test.orchestrator.submit(projectId, request, 'batch-image-1');
    expect(submitted.value.status).toBe('running');
    expect(submitted.value.items.map((item) => item.status)).toEqual(['skipped', 'queued', 'queued']);
    expect(test.requests).toHaveLength(2);

    const replayed = await test.orchestrator.submit(projectId, request, 'batch-image-1');
    expect(replayed.value.batchId).toBe(submitted.value.batchId);
    expect(test.requests).toHaveLength(2);

    for (const [jobId, current] of test.jobs) {
      test.jobs.set(jobId, {
        value: jobRecordSchema.parse({
          ...current.value,
          status: 'succeeded',
          outputAssetIds: [`asset_${jobId}`],
          updatedAt: now,
        }),
        version: current.version + 1,
      });
    }
    const completed = await test.orchestrator.get(submitted.value.batchId);
    expect(completed.value.status).toBe('succeeded');
    expect(completed.value.items.flatMap((item) => item.outputAssetIds)).toEqual([
      'asset_job_batch_1',
      'asset_job_batch_2',
    ]);
  });

  it('stops active jobs and retries cancelled items as new provider jobs', async () => {
    const test = fixture();
    const submitted = await test.orchestrator.submit(projectId, {
      kind: 'video',
      shotIds: [shotIds[1]!, shotIds[2]!],
      expectedVersions: { [shotIds[1]!]: 1, [shotIds[2]!]: 1 },
      missingOnly: false,
      route: 'primary',
      generationNonce: 20,
      concurrency: 2,
    }, 'batch-video-1');
    const stopped = await test.orchestrator.cancel(submitted.value.batchId);
    expect(stopped.value.status).toBe('cancelled');
    expect(stopped.value.items.every((item) => item.status === 'cancelled')).toBe(true);

    const retried = await test.orchestrator.retry(
      submitted.value.batchId,
      'fallback',
      'batch-video-retry-1',
    );
    expect(retried.value.status).toBe('running');
    expect(retried.value.route).toBe('fallback');
    expect(retried.value.items.every((item) => item.status === 'queued' && item.retryCount === 1)).toBe(true);
    expect(test.jobs).toHaveLength(4);
  });
});
