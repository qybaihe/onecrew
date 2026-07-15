import {
  assetRecordSchema,
  creativeProjectBundleSchema,
  type AssetRecord,
  type CreativeProjectBundle,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { buildCreativeContinuityQcRequest, CreativeContinuityQcAssetError } from './continuity-qc.js';

const now = '2026-07-15T00:00:00.000Z';
const bundle: CreativeProjectBundle = creativeProjectBundleSchema.parse({
  bundleVersion: '1.0',
  source: { system: 'onecrew', importedAt: now },
  project: {
    projectId: 'prj_qc',
    nameZh: '星海连续性测试',
    nameEn: 'Continuity Test',
    synopsis: '连续性测试',
    audience: '测试',
    genres: ['科幻'],
    ownerOpenId: 'ou_test',
    locales: ['zh-CN'],
    aspectRatios: ['16:9'],
    budgetLimitCny: 10,
    status: 'draft',
  },
  episodes: [{
    episodeId: 'episode_qc', projectId: 'prj_qc', episodeNumber: 1, title: '第一集',
    scriptContent: '', durationSec: 8, characterIds: ['character_luo'], sceneIds: ['scene_gate'],
    propIds: ['prop_sword'], status: 'planning',
  }],
  entities: [
    {
      entityId: 'character_luo', projectId: 'prj_qc', episodeId: 'episode_qc', kind: 'character',
      name: '洛', role: '守门人', appearance: '银发、深蓝披风', referenceAssetIds: [], extraAssetIds: [],
      sortOrder: 0, status: 'ready',
    },
    {
      entityId: 'scene_gate', projectId: 'prj_qc', episodeId: 'episode_qc', kind: 'scene',
      name: '星门', location: '星海边界', timeOfDay: '夜晚', atmosphere: '冷峻', lightingStyle: '银蓝边缘光',
      referenceAssetIds: [], extraAssetIds: [], sortOrder: 0, status: 'ready',
    },
    {
      entityId: 'prop_sword', projectId: 'prj_qc', episodeId: 'episode_qc', kind: 'prop',
      name: '光剑', category: '武器', referenceAssetIds: [], extraAssetIds: [], sortOrder: 0, status: 'ready',
    },
  ],
  shots: [
    {
      shotId: 'shot_prev', projectId: 'prj_qc', episodeId: 'episode_qc', sequence: 1, durationSec: 4,
      characters: ['character_luo'], sceneId: 'scene_gate', action: '洛转身看向星门。', camera: '中景固定',
      prompt: '洛站在星门前', referenceAssetIds: [], importance: 'normal', closeupDialogue: false, status: 'planned',
    },
    {
      shotId: 'shot_qc', projectId: 'prj_qc', episodeId: 'episode_qc', sequence: 2, durationSec: 4,
      characters: ['character_luo'], sceneId: 'scene_gate', propIds: ['prop_sword'], action: '洛拔出光剑冲向星门。',
      camera: '低机位缓慢推进', dialogueZh: '跟我来。', prompt: '洛冲向星门', imagePrompt: '电影感科幻画面',
      videoPrompt: '低机位推进，披风随风摆动', referenceAssetIds: [], importance: 'hero', closeupDialogue: true,
      status: 'planned', continuity: {
        sourceShotId: 'shot_prev', characters: { character_luo: { clothing: '深蓝披风', expression: '坚定', props: ['prop_sword'] } },
        lighting: '银蓝边缘光', cameraAxis: '沿星门中轴线左侧', notes: '披风破损位置保持在右肩。',
      },
    },
  ],
  framePrompts: [],
  mediaFiles: [],
});

function asset(input: Partial<AssetRecord> & Pick<AssetRecord, 'assetId' | 'uri'>): AssetRecord {
  const { assetId, uri, ...overrides } = input;
  return assetRecordSchema.parse({
    assetId,
    projectId: 'prj_qc',
    shotId: 'shot_qc',
    type: 'video',
    version: 2,
    uri,
    provider: 'volcengine-seedance',
    model: 'seedance',
    source: 'Provider Job job_qc_source; input SHA-256 abc',
    license: 'provider terms',
    contentHash: 'a'.repeat(64),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

describe('creative continuity QC', () => {
  it('builds an auditable QC request from the saved shot, entities, continuity snapshot and asset', () => {
    const request = buildCreativeContinuityQcRequest({
      bundle,
      assets: [asset({ assetId: 'asset_qc', uri: 's3://onecrew/creative/shot-qc.mp4' })],
      shotId: 'shot_qc',
    });

    expect(request).toMatchObject({
      projectId: 'prj_qc',
      shotId: 'shot_qc',
      sourceAssetId: 'asset_qc',
      sourceJobId: 'job_qc_source',
      mediaType: 'video',
      mediaUri: 's3://onecrew/creative/shot-qc.mp4',
      technical: { durationSec: 4, allowedVideoCodecs: ['h264', 'hevc', 'vp9', 'av1'] },
      remediation: 'generation',
      autoRemediate: true,
    });
    expect(request.expectedDescription).toContain('连续性快照');
    expect(request.criteria).toEqual(expect.arrayContaining([
      expect.stringContaining('角色身份与外观稳定：洛'),
      expect.stringContaining('与上一镜 shot_prev 的尾帧'),
      expect.stringContaining('不得越轴'),
      expect.stringContaining('视频时间维度稳定'),
      expect.stringContaining('对白表演与口型'),
    ]));
  });

  it('selects the newest controlled shot asset and rejects mock placeholders', () => {
    const controlled = asset({ assetId: 'asset_controlled', uri: 's3://onecrew/creative/shot-qc.png', type: 'image', version: 1 });
    const mock = asset({ assetId: 'asset_mock', uri: 'mock://onecrew/video/shot-qc.mp4', version: 3 });
    const request = buildCreativeContinuityQcRequest({ bundle, assets: [mock, controlled], shotId: 'shot_qc' });
    expect(request.sourceAssetId).toBe('asset_controlled');
    expect(request.mediaType).toBe('image');
    expect(request.technical).toMatchObject({
      allowedVideoCodecs: ['png', 'mjpeg', 'webp'],
      allowedPixelFormats: expect.arrayContaining(['rgb24']),
    });
    expect(() => buildCreativeContinuityQcRequest({ bundle, assets: [mock], shotId: 'shot_qc', assetId: mock.assetId }))
      .toThrow(CreativeContinuityQcAssetError);
  });
});
