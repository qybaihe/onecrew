import {
  assetRecordSchema,
  creativeProjectBundleSchema,
  type AssetRecord,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { buildCreativeShotGenerationRequest } from './shot-generation.js';

const now = '2026-07-15T00:00:00.000Z';

function asset(input: Pick<AssetRecord, 'assetId' | 'shotId' | 'type' | 'version' | 'uri'>): AssetRecord {
  return assetRecordSchema.parse({
    ...input,
    projectId: 'prj_generation',
    provider: 'fixture',
    model: 'fixture-v1',
    source: 'test fixture',
    license: 'test fixture',
    contentHash: '1'.repeat(64),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });
}

const assets = [
  asset({ assetId: 'asset_previous_tail', shotId: 'shot_previous', type: 'image', version: 1, uri: 's3://onecrew/previous-tail.png' }),
  asset({ assetId: 'asset_character', type: 'character', version: 1, uri: 's3://onecrew/character.png' }),
  asset({ assetId: 'asset_character_extra', type: 'image', version: 1, uri: 's3://onecrew/character-extra.png' }),
  asset({ assetId: 'asset_shot_reference', type: 'image', version: 1, uri: 's3://onecrew/reference.png' }),
  asset({ assetId: 'asset_image_v1', shotId: 'shot_current', type: 'image', version: 1, uri: 's3://onecrew/current-v1.png' }),
  asset({ assetId: 'asset_image_v2', shotId: 'shot_current', type: 'image', version: 2, uri: 's3://onecrew/current-v2.png' }),
  asset({ assetId: 'asset_last_frame', shotId: 'shot_current', type: 'image', version: 3, uri: 's3://onecrew/current-tail.png' }),
];

const bundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0',
  source: { system: 'onecrew' },
  project: {
    projectId: 'prj_generation',
    nameZh: '生成测试',
    nameEn: 'Generation test',
    synopsis: 'Single-shot generation fixture.',
    audience: 'test',
    genres: ['test'],
    ownerOpenId: 'ou_test',
    locales: ['zh-CN'],
    aspectRatios: ['9:16'],
    budgetLimitCny: 10,
    status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_one',
    projectId: 'prj_generation',
    episodeNumber: 1,
    title: '第一集',
    scriptContent: '',
    durationSec: 11,
    characterIds: ['character_hero'],
    sceneIds: ['scene_gate'],
    propIds: [],
    status: 'draft',
  }],
  entities: [
    {
      entityId: 'character_hero',
      projectId: 'prj_generation',
      kind: 'character',
      name: '林遥',
      referenceAssetIds: ['asset_character'],
      extraAssetIds: ['asset_character_extra'],
      sortOrder: 0,
      status: 'ready',
    },
    {
      entityId: 'scene_gate',
      projectId: 'prj_generation',
      kind: 'scene',
      name: '星门',
      location: '星门',
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: 1,
      status: 'ready',
    },
  ],
  shots: [
    {
      shotId: 'shot_previous',
      projectId: 'prj_generation',
      episodeId: 'episode_one',
      sequence: 1,
      durationSec: 5,
      characters: ['character_hero'],
      sceneId: 'scene_gate',
      action: '林遥抵达星门。',
      camera: '固定',
      prompt: 'previous',
      referenceAssetIds: [],
      lastFrameAssetId: 'asset_previous_tail',
      importance: 'normal',
      closeupDialogue: false,
      status: 'planned',
    },
    {
      shotId: 'shot_current',
      projectId: 'prj_generation',
      episodeId: 'episode_one',
      sequence: 2,
      durationSec: 5.6,
      characters: ['character_hero'],
      sceneId: 'scene_gate',
      action: '林遥穿过星门。',
      camera: '缓慢跟拍',
      prompt: 'base prompt',
      imagePrompt: 'image prompt',
      videoPrompt: 'video prompt',
      negativePrompt: 'watermark',
      firstFrameAssetId: 'asset_image_v1',
      referenceAssetIds: ['asset_shot_reference'],
      lastFrameAssetId: 'asset_last_frame',
      continuity: { characters: {}, lighting: '银蓝边缘光', notes: '保持面部与披风一致。' },
      importance: 'hero',
      closeupDialogue: false,
      status: 'planned',
    },
  ],
  framePrompts: [],
  mediaFiles: [],
});

describe('creative shot generation request builder', () => {
  it('builds an image request from the persisted shot and ordered continuity references', () => {
    const request = buildCreativeShotGenerationRequest({
      bundle,
      assets,
      shotId: 'shot_current',
      kind: 'image',
      route: 'primary',
      generationNonce: 7,
    });
    expect(request).toMatchObject({
      capability: 'image',
      projectId: 'prj_generation',
      shotId: 'shot_current',
      width: 576,
      height: 1_024,
      negativePrompt: 'watermark',
      generationNonce: 7,
      referenceUris: [
        's3://onecrew/previous-tail.png',
        's3://onecrew/current-v1.png',
        's3://onecrew/reference.png',
        's3://onecrew/character.png',
        's3://onecrew/character-extra.png',
      ],
    });
    expect('prompt' in request && request.prompt).toContain('image prompt');
    expect('prompt' in request && request.prompt).toContain('银蓝边缘光');
    expect('prompt' in request && request.prompt).toContain('@图片1：上一镜尾帧');
    expect('prompt' in request && request.prompt).toContain('@图片4：角色「林遥」主参考 1');
    expect('prompt' in request && request.prompt).toContain('@图片5：角色「林遥」补充参考 1');
  });

  it('uses the newest image version over an older bound first frame, plus the explicit tail frame', () => {
    const request = buildCreativeShotGenerationRequest({
      bundle,
      assets,
      shotId: 'shot_current',
      kind: 'video',
      route: 'fallback',
      generationNonce: 8,
    });
    expect(request).toMatchObject({
      capability: 'video',
      route: 'fallback',
      prompt: expect.stringContaining('video prompt'),
      referenceImageUri: 's3://onecrew/current-v2.png',
      lastFrameUri: 's3://onecrew/current-tail.png',
      durationSec: 6,
      aspectRatio: '9:16',
      generationNonce: 8,
    });
  });
});
