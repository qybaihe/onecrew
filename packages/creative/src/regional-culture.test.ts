import { llmProviderRequestSchema, regionalCulturePackRequestSchema } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { buildRegionalCultureRequest, regionalCulturePackOutputSchema } from './regional-culture.js';

const baseProject = {
  projectId: 'prj_shanhai_demo',
  nameZh: '山海星辰',
  nameEn: 'Shanhai Stars',
  synopsis: '守星人穿越山海裂隙，寻找失落星辰。',
  audience: '中文短剧受众',
  genres: ['奇幻', '冒险'],
};

describe('buildRegionalCultureRequest', () => {
  it('produces a valid LlmProviderRequest with operation regional_culture', () => {
    const request = buildRegionalCultureRequest({
      project: baseProject,
      request: regionalCulturePackRequestSchema.parse({
        region: 'america',
        brief: '为美国市场重写本项目。',
        generationNonce: 1,
      }),
    });
    expect(() => llmProviderRequestSchema.parse(request)).not.toThrow();
    expect(request).toMatchObject({
      capability: 'llm',
      operation: 'regional_culture',
      projectId: 'prj_shanhai_demo',
      locale: 'zh-CN',
    });
    expect(request.outputSchema).toMatchObject({ title: 'OneCrewRegionalCulturePack', type: 'object' });
  });

  it('america prompt cites Claimed by the Dragon as the worked example', () => {
    const request = buildRegionalCultureRequest({
      project: baseProject,
      request: regionalCulturePackRequestSchema.parse({
        region: 'america',
        brief: '为美国市场重写本项目。',
        generationNonce: 1,
      }),
    });
    expect(request.prompt).toContain('Claimed by the Dragon');
    expect(request.prompt).toContain('平台归属与热度待市场团队核验');
    expect(request.prompt).toContain('不得把“爆款”或平台归属写成已验证事实');
    expect(request.prompt).toContain('中年女性');
    expect(request.prompt).toContain('fated mate');
  });

  it('russia prompt does NOT mention Claimed by the Dragon (US-specific reference)', () => {
    const request = buildRegionalCultureRequest({
      project: baseProject,
      request: regionalCulturePackRequestSchema.parse({
        region: 'russia',
        brief: '为俄罗斯市场重写本项目。',
        generationNonce: 1,
      }),
    });
    expect(request.prompt).not.toContain('Claimed by the Dragon');
    expect(request.prompt).toContain('俄罗斯');
    expect(request.prompt).toContain('家庭荣誉');
  });

  it('uk prompt mentions period romance and restrained emotion', () => {
    const request = buildRegionalCultureRequest({
      project: baseProject,
      request: regionalCulturePackRequestSchema.parse({
        region: 'uk',
        brief: '为英国市场重写本项目。',
        generationNonce: 1,
      }),
    });
    expect(request.prompt).toContain('英国');
    expect(request.prompt).toContain('Bridgerton');
    expect(request.prompt).toContain('克制的激情');
  });

  it('output schema title is OneCrewRegionalCulturePack', () => {
    const schema = regionalCulturePackOutputSchema();
    expect(schema.title).toBe('OneCrewRegionalCulturePack');
    expect(schema.type).toBe('object');
  });
});
