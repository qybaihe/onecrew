import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  contractSchemas,
  localePackSchema,
  projectSpecSchema,
  renderManifestSchema,
} from './index.js';

const validProject = {
  projectId: 'prj_shanhai_demo',
  nameZh: '山海星辰',
  nameEn: 'Stars Beyond the Mountains and Seas',
  synopsis: '两位守星人在山海裂隙中寻找失落星图。',
  audience: '18-35 岁奇幻短剧观众',
  genres: ['奇幻', '冒险'],
  ownerOpenId: 'ou_demo_owner',
  locales: ['zh-CN', 'en-US'],
  aspectRatios: ['16:9', '9:16'],
  budgetLimitCny: 100,
  status: 'draft',
} as const;

describe('OneCrew contracts', () => {
  it('accepts the locked two-locale product contract', () => {
    expect(projectSpecSchema.parse(validProject)).toEqual(validProject);
  });

  it('rejects unsupported locales at the boundary', () => {
    expect(() => projectSpecSchema.parse({ ...validProject, locales: ['es-ES'] })).toThrow();
  });

  it('rejects invalid localized line timing', () => {
    expect(() =>
      localePackSchema.parse({
        projectId: 'prj_demo',
        locale: 'en-US',
        title: 'Demo',
        cta: 'Watch now',
        marketingCopy: [],
        lines: [
          {
            lineId: 'line_1',
            shotId: 'shot_1',
            speaker: 'Lin',
            text: 'Go.',
            startMs: 1_000,
            endMs: 900,
            voiceId: 'voice_lin',
          },
        ],
      }),
    ).toThrow(/endMs/);
  });

  it('keeps Remotion composition IDs closed', () => {
    const result = renderManifestSchema.safeParse({ compositionId: 'AnotherRenderer' });
    expect(result.success).toBe(false);
  });

  it('converts every public contract to JSON Schema', () => {
    for (const [name, schema] of Object.entries(contractSchemas)) {
      const jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12' });
      const root = jsonSchema as { type?: unknown; oneOf?: Array<{ type?: unknown }> };
      const isObjectSchema =
        root.type === 'object' ||
        (Array.isArray(root.oneOf) &&
          root.oneOf.length > 0 &&
          root.oneOf.every((variant) => variant.type === 'object'));
      expect(isObjectSchema, name).toBe(true);
    }
  });
});
