import {
  budgetAllocationRequestSchema,
  creativeProjectBundleSchema,
  type CreativeProjectBundle,
  type LlmProviderRequest,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { BudgetAllocationPlanner } from './budget-allocation-planner.js';

const bundle: CreativeProjectBundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0',
  source: { system: 'onecrew' },
  project: {
    projectId: 'prj_budget_flow',
    nameZh: '北美短剧',
    nameEn: 'North America Drama',
    synopsis: '一个已验证的源 IP 准备进入北美。',
    audience: '竖屏短剧受众',
    genres: ['奇幻', '爱情'],
    ownerOpenId: 'ou_budget',
    locales: ['zh-CN', 'en-US'],
    aspectRatios: ['9:16'],
    budgetLimitCny: 1_000_000,
    status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_budget_1',
    projectId: 'prj_budget_flow',
    episodeNumber: 1,
    title: '试播集',
    scriptContent: '第一集。',
    durationSec: 60,
    characterIds: [],
    sceneIds: [],
    propIds: [],
    status: 'draft',
  }],
  entities: [],
  shots: [],
  framePrompts: [],
  mediaFiles: [],
});

describe('BudgetAllocationPlanner', () => {
  it('submits a structured budget Job and returns a pending preview without inventing a plan', async () => {
    let submitted: LlmProviderRequest | undefined;
    const planner = new BudgetAllocationPlanner(
      { async getBundle() { return bundle; } },
      {
        async submit(request) {
          submitted = request as LlmProviderRequest;
          return {
            jobId: 'job_budget_flow',
            status: 'queued',
            mode: 'mock',
            provider: 'mock-llm-primary',
            route: 'primary',
            estimatedCostCny: 0.02,
            statusUrl: '/v1/jobs/job_budget_flow',
            replayed: false,
          };
        },
        async get() {
          return {
            job: {
              value: {
                jobId: 'job_budget_flow',
                projectId: 'prj_budget_flow',
                capability: 'plan',
                provider: 'mock-llm-primary',
                model: 'mock',
                mode: 'mock',
                status: 'running',
                attempt: 1,
                inputHash: 'b'.repeat(64),
                outputAssetIds: [],
                createdAt: '2026-07-19T00:00:00.000Z',
                updatedAt: '2026-07-19T00:00:01.000Z',
              },
              version: 2,
            },
            run: {
              jobId: 'job_budget_flow',
              route: 'primary',
              request: submitted!,
            },
          };
        },
      },
    );

    const accepted = await planner.submit(
      'prj_budget_flow',
      budgetAllocationRequestSchema.parse({
        totalBudgetCny: 1_000_000,
        brief: '一人剧组，先验证后放量。',
        generationNonce: 1,
      }),
      'budget_flow_1',
    );
    expect(accepted.jobId).toBe('job_budget_flow');
    expect(submitted).toMatchObject({
      capability: 'llm',
      operation: 'budget_allocation',
      outputSchema: { title: 'OneCrewBudgetAllocationDraft' },
    });

    const preview = await planner.preview('prj_budget_flow', 'job_budget_flow');
    expect(preview.job.status).toBe('running');
    expect(preview.plan).toBeUndefined();
  });
});
