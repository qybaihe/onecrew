import {
  creativeProjectBundleSchema,
  creativeStoryPlanRequestSchema,
  creativeStoryPlanSchema,
  type CreativeProjectBundle,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { CreativeStoryPlanner } from './creative-story-planner.js';

const bundle: CreativeProjectBundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0', source: { system: 'onecrew' },
  project: {
    projectId: 'prj_story_flow', nameZh: '星门', nameEn: 'Star Gate', synopsis: '守门人发现新坐标。',
    audience: '科幻观众', genres: ['科幻'], ownerOpenId: 'ou_story', locales: ['zh-CN'], aspectRatios: ['16:9'],
    budgetLimitCny: 10, status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_story_existing', projectId: 'prj_story_flow', episodeNumber: 1, title: '序章',
    scriptContent: '序章', durationSec: 30, characterIds: [], sceneIds: [], propIds: [], status: 'draft',
  }],
  entities: [], shots: [], framePrompts: [], mediaFiles: [],
});

const plan = creativeStoryPlanSchema.parse({
  title: '续章', logline: '导航员抵达。',
  episodes: [{
    title: '星图回响', synopsis: '坐标出现。', scriptContent: '云岚：坐标出现了。', durationSec: 60,
    characterNames: ['云岚'], sceneNames: ['星门回廊'], propNames: [],
  }],
  characters: [{ name: '云岚', role: '导航员', personality: '敏锐', appearance: '短发', voiceStyle: '清晰', identityAnchors: ['短发'] }],
  scenes: [{ name: '星门回廊', description: '回廊', location: '星门', timeOfDay: '夜', atmosphere: '神秘', lightingStyle: '青蓝' }],
  props: [],
});

describe('CreativeStoryPlanner', () => {
  it('submits a structured Job and applies its output through one append-only repository call', async () => {
    let submitted: unknown;
    let appended: Parameters<NonNullable<ConstructorParameters<typeof CreativeStoryPlanner>[0]['appendStoryPlan']>>[0] | undefined;
    const planner = new CreativeStoryPlanner(
      {
        async getBundle() { return bundle; },
        async appendStoryPlan(input) {
          appended = input;
          return {
            projectId: input.projectId, jobId: input.jobId, projectVersion: 2, replayed: false,
            episodeIds: input.episodes.map((episode) => episode.episodeId),
            entityIds: input.entities.map((entity) => entity.entityId),
          };
        },
      },
      {
        async submit(request) {
          submitted = request;
          return {
            jobId: 'job_story_flow', status: 'queued', mode: 'mock', provider: 'mock-llm-primary', route: 'primary',
            estimatedCostCny: 0.01, statusUrl: '/v1/jobs/job_story_flow', replayed: false,
          };
        },
        async get() {
          return {
            job: { value: {
              jobId: 'job_story_flow', projectId: 'prj_story_flow', capability: 'plan', provider: 'mock-llm-primary',
              model: 'mock', mode: 'mock', status: 'succeeded', attempt: 1, inputHash: 'a'.repeat(64), outputAssetIds: [],
              createdAt: '2026-07-15T00:00:00.000Z', updatedAt: '2026-07-15T00:00:00.000Z',
            }, version: 3 },
            run: { jobId: 'job_story_flow', route: 'primary', request: {
              capability: 'llm', projectId: 'prj_story_flow', operation: 'script', prompt: '必须输出 1 集', locale: 'zh-CN',
              imageUris: [], outputSchema: { title: 'OneCrewCreativeStoryPlan' }, maxOutputTokens: 4000, route: 'primary',
            } },
            output: { text: JSON.stringify(plan), structured: plan },
          };
        },
      },
    );
    await expect(planner.submit(
      'prj_story_flow',
      creativeStoryPlanRequestSchema.parse({ brief: '追加一集', episodeCount: 1, generationNonce: 1 }),
      'story_plan_1',
    )).resolves.toMatchObject({ jobId: 'job_story_flow' });
    expect(submitted).toMatchObject({ capability: 'llm', outputSchema: { title: 'OneCrewCreativeStoryPlan' } });

    await expect(planner.apply('prj_story_flow', 'job_story_flow', 1, 'ou_studio'))
      .resolves.toMatchObject({ projectVersion: 2, episodeIds: [expect.stringMatching(/^episode_/)] });
    expect(appended).toMatchObject({ expectedProjectVersion: 1, actorOpenId: 'ou_studio' });
    expect(appended?.entities).toHaveLength(2);
  });
});
