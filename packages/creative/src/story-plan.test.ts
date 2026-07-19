import {
  creativeProjectBundleSchema,
  creativeStoryPlanRequestSchema,
  creativeStoryPlanSchema,
  regionalCulturePackSchema,
  type CreativeProjectBundle,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildCreativeStoryPlanRequest,
  CreativeStoryPlanValidationError,
  materializeCreativeStoryPlan,
} from './story-plan.js';

const bundle: CreativeProjectBundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0',
  source: { system: 'onecrew' },
  project: {
    projectId: 'prj_story', nameZh: '星门', nameEn: 'Star Gate', synopsis: '守门人寻找失落坐标。',
    audience: '年轻科幻观众', genres: ['科幻'], ownerOpenId: 'ou_story', locales: ['zh-CN'],
    aspectRatios: ['16:9'], budgetLimitCny: 10, status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_existing', projectId: 'prj_story', episodeNumber: 1, title: '序章',
    scriptContent: '洛守在星门前。', durationSec: 60, characterIds: ['character_existing'], sceneIds: [],
    propIds: [], status: 'planning',
  }],
  entities: [{
    entityId: 'character_existing', projectId: 'prj_story', kind: 'character', name: '洛', role: '守门人',
    referenceAssetIds: [], extraAssetIds: [], identityAnchors: [], styleTokens: [], colorPalette: [], stages: [],
    sortOrder: 0, status: 'ready',
  }],
  shots: [], framePrompts: [], mediaFiles: [],
});

const plan = creativeStoryPlanSchema.parse({
  title: '星门余烬',
  logline: '洛与新同伴穿过失控星门。',
  episodes: [{
    title: '第二集：余烬', synopsis: '洛唤醒星钥。', scriptContent: '洛：星门还活着。', durationSec: 90,
    characterNames: ['洛', '岚'], sceneNames: ['星门内环'], propNames: ['星钥'],
  }],
  characters: [
    { name: '洛', role: '守门人', personality: '坚定', appearance: '银发', voiceStyle: '低沉', identityAnchors: ['银发'] },
    { name: '岚', role: '导航员', personality: '敏锐', appearance: '红色短发', voiceStyle: '清晰', identityAnchors: ['红发'] },
  ],
  scenes: [{ name: '星门内环', description: '悬浮环带', location: '星门内部', timeOfDay: '永夜', atmosphere: '危险', lightingStyle: '青蓝脉冲' }],
  props: [{ name: '星钥', description: '古老坐标器', category: '关键道具', prompt: '青铜星钥', }],
});

describe('creative story planning', () => {
  it('builds a strict structured LLM request from current project context', () => {
    const request = buildCreativeStoryPlanRequest({
      bundle,
      request: creativeStoryPlanRequestSchema.parse({ brief: '追加一集，强化悬念。', episodeCount: 1, generationNonce: 3 }),
    });
    expect(request).toMatchObject({ capability: 'llm', operation: 'script', projectId: 'prj_story', locale: 'zh-CN' });
    expect(request.prompt).toContain('现有剧集');
    expect(request.prompt).toContain('追加一集');
    expect(request.outputSchema).toMatchObject({ title: 'OneCrewCreativeStoryPlan', type: 'object' });
  });

  it('materializes append-only episodes and reuses existing entities by kind and name', () => {
    const result = materializeCreativeStoryPlan({ bundle, plan, jobId: 'job_story_1' });
    expect(result.episodes).toHaveLength(1);
    expect(result.entities).toHaveLength(3);
    expect(result.entities.map((entity) => `${entity.kind}:${entity.name}`)).toEqual([
      'character:岚', 'scene:星门内环', 'prop:星钥',
    ]);
    expect(result.entities[0]).toMatchObject({
      kind: 'character',
      description: '导航员；敏锐；红色短发',
      prompt: expect.stringContaining('红发'),
    });
    expect(result.episodes[0]).toMatchObject({
      episodeNumber: 2,
      characterIds: expect.arrayContaining(['character_existing']),
      status: 'planning',
      source: { reference: 'Provider Job job_story_1' },
    });
  });

  it('rejects episode references that do not exist in the plan or current project', () => {
    const broken = creativeStoryPlanSchema.parse({
      ...plan,
      episodes: [{ ...plan.episodes[0]!, characterNames: ['不存在角色'] }],
    });
    expect(() => materializeCreativeStoryPlan({ bundle, plan: broken, jobId: 'job_story_bad' }))
      .toThrow(CreativeStoryPlanValidationError);
  });

  it('omits the regional culture section when no pack is provided', () => {
    const request = buildCreativeStoryPlanRequest({
      bundle,
      request: creativeStoryPlanRequestSchema.parse({ brief: '追加一集。', episodeCount: 1, generationNonce: 1 }),
    });
    expect(request.prompt).not.toContain('目标出海地区：');
    expect(request.prompt).toContain('本次创作要求：追加一集。');
  });

  it('injects all eight regional culture lines and uses localizedBrief when a pack is provided', () => {
    const culturePack = regionalCulturePackSchema.parse({
      region: 'america',
      regionLabel: '美国',
      audienceProfile: 'ReelShort 中年女性',
      themes: ['龙族奇幻浪漫', 'fated mate', '契约婚姻'],
      spiritValues: ['命运翻转', '禁忌之恋', '女性自我主张'],
      taboos: ['避免中式婆媳关系'],
      hookStructures: ['开场 5 秒献祭', '每 60 秒一个反转'],
      visualMotifs: ['月光', '龙穴', '红裙'],
      referenceCases: [{ title: 'Claimed by the Dragon', whyItWorks: '龙族诅咒 + 命定伴侣' }],
      localizedBrief: 'Cursed dragon king claims human bride before the full moon.',
    });
    const request = buildCreativeStoryPlanRequest({
      bundle,
      request: creativeStoryPlanRequestSchema.parse({
        brief: '中文 brief 不应再被使用',
        episodeCount: 1,
        generationNonce: 1,
        regionalCulturePackJobId: 'job_culture_1',
      }),
      culturePack,
    });
    expect(request.prompt).toContain('目标出海地区：美国');
    expect(request.prompt).toContain('地区受众画像：ReelShort 中年女性');
    expect(request.prompt).toContain('偏好题材：龙族奇幻浪漫、fated mate、契约婚姻');
    expect(request.prompt).toContain('核心精神面貌：命运翻转、禁忌之恋、女性自我主张');
    expect(request.prompt).toContain('禁忌规避：避免中式婆媳关系');
    expect(request.prompt).toContain('钩子结构：开场 5 秒献祭、每 60 秒一个反转');
    expect(request.prompt).toContain('视觉符号：月光、龙穴、红裙');
    expect(request.prompt).toContain('Claimed by the Dragon——龙族诅咒 + 命定伴侣');
    expect(request.prompt).toContain('本次创作要求（已按地域文化包本土化）：Cursed dragon king claims human bride before the full moon.');
    expect(request.prompt).not.toContain('本次创作要求：中文 brief 不应再被使用');
  });
});
