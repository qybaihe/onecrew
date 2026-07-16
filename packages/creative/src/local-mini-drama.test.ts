import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  exportLocalMiniDramaArchive,
  exportOneCrewArchive,
  importOneCrewArchive,
  materializeOneCrewArchive,
} from './creative-export.js';
import {
  convertLocalMiniDramaProject,
  importLocalMiniDramaArchive,
  materializeCreativeArchive,
  normalizeArchivePath,
} from './local-mini-drama.js';

const fixture = {
  version: '1.4',
  exported_at: '2026-07-15T00:00:00.000Z',
  drama: {
    title: '山海测试剧',
    description: '一部用于验证导入关系的测试短剧。',
    genre: '奇幻,冒险',
    style: 'cinematic',
    status: 'draft',
    tags: '["连续性","双语"]',
    metadata: { aspect_ratio: '9:16' },
  },
  characters: [
    {
      name: '林遥',
      role: '主角',
      appearance: '银白短发',
      identity_anchors: '["银白短发","星纹披风"]',
      style_tokens: ['cinematic'],
      color_palette: ['#112244'],
      image_file: 'media/characters/lin.png',
      extra_image_files: ['media/characters/lin-side.png'],
    },
  ],
  scenes: [
    { location: '星门', time: '夜', prompt: '古老星门', image_file: 'media/scenes/gate.png' },
    { location: '星门', time: '夜', prompt: '重复场景不应再次创建' },
  ],
  props: [{ name: '星盘', type: '法器', image_file: 'media/props/plate.png' }],
  episodes: [
    {
      episode_number: 1,
      title: '裂隙',
      script_content: '林遥来到星门。',
      duration: 10,
      storyboards: [
        {
          storyboard_number: 1,
          title: '抵达星门',
          action: '林遥走到星门前。',
          dialogue: '门后是什么？',
          shot_type: '近景',
          angle_h: '正面',
          angle_v: '平视',
          movement: '缓慢推进',
          image_prompt: '林遥站在星门前',
          video_prompt: '镜头缓慢推进',
          duration: 5,
          character_indices: [0],
          scene_index: 1,
          prop_indices: [0],
          continuity_snapshot: JSON.stringify({
            characters: { 林遥: { position: '星门前', clothing: '星纹披风' } },
            lighting: '蓝色月光',
          }),
          creation_mode: 'universal',
          universal_segment_text: '林遥抵达星门并停下。',
          frame_prompts: [
            { frame_type: 'first', prompt: '首帧提示词' },
            { frame_type: 'tail', prompt: '尾帧提示词' },
          ],
          image_generations: [
            { original_id: 42, frame_type: 'first', zip_file: 'media/storyboards/shot-1-first.png' },
          ],
          video_file: 'media/videos/shot-1.mp4',
        },
      ],
    },
  ],
};

describe('LocalMiniDrama adapter', () => {
  it('maps the 1.4 project format into the OneCrew creative domain', () => {
    const bundle = convertLocalMiniDramaProject(fixture, {
      projectId: 'prj_import_test',
      ownerOpenId: 'ou_test',
    });

    expect(bundle.project).toMatchObject({
      projectId: 'prj_import_test',
      nameZh: '山海测试剧',
      aspectRatios: ['9:16'],
      genres: ['奇幻', '冒险'],
      source: { system: 'local-mini-drama', version: '1.4', license: 'MIT' },
    });
    expect(bundle.episodes).toHaveLength(1);
    expect(bundle.entities.filter((entity) => entity.kind === 'scene')).toHaveLength(1);
    expect(bundle.entities.filter((entity) => entity.kind === 'character')[0]).toMatchObject({
      name: '林遥',
      identityAnchors: ['银白短发', '星纹披风'],
    });
    expect(bundle.shots[0]).toMatchObject({
      title: '抵达星门',
      propIds: [expect.stringMatching(/^prop_/)],
      cameraAngle: { horizontal: '正面', vertical: '平视' },
      creationMode: 'universal',
      continuity: { lighting: '蓝色月光' },
    });
    expect(bundle.framePrompts.map((frame) => frame.frameType)).toEqual(['first', 'last']);
    expect(bundle.mediaFiles).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourcePath: 'media/characters/lin.png', ownerType: 'entity' }),
        expect.objectContaining({ sourcePath: 'media/storyboards/shot-1-first.png', originalId: 42 }),
        expect.objectContaining({ sourcePath: 'media/videos/shot-1.mp4', mediaType: 'video' }),
      ]),
    );
  });

  it('reads a guarded ZIP and returns only declared media', () => {
    const zip = new AdmZip();
    zip.addFile('project.json', Buffer.from(JSON.stringify(fixture)));
    for (const path of [
      'media/characters/lin.png',
      'media/characters/lin-side.png',
      'media/scenes/gate.png',
      'media/props/plate.png',
      'media/storyboards/shot-1-first.png',
      'media/videos/shot-1.mp4',
    ]) {
      zip.addFile(path, Buffer.from(`fixture:${path}`));
    }

    const result = importLocalMiniDramaArchive(zip.toBuffer(), { projectId: 'prj_zip_test' });

    expect(result.bundle.project.projectId).toBe('prj_zip_test');
    expect(result.files.has('project.json')).toBe(false);
    expect(result.files.get('media/videos/shot-1.mp4')?.toString()).toContain('fixture:');
  });

  it('rejects missing media declared by project.json', () => {
    const zip = new AdmZip();
    zip.addFile('project.json', Buffer.from(JSON.stringify(fixture)));
    expect(() => importLocalMiniDramaArchive(zip.toBuffer())).toThrow(/missing declared media file/);
  });

  it('rejects archive path traversal', () => {
    expect(() => normalizeArchivePath('../outside.txt')).toThrow(/escapes the archive root/);
    expect(() => normalizeArchivePath('media/../../outside.txt')).toThrow(/escapes the archive root/);
    expect(() => normalizeArchivePath('/absolute/file.png')).toThrow(/absolute path/);
  });

  it('uploads archive media and binds versioned OneCrew assets', async () => {
    const zip = new AdmZip();
    zip.addFile('project.json', Buffer.from(JSON.stringify(fixture)));
    for (const mediaPath of [
      'media/characters/lin.png',
      'media/characters/lin-side.png',
      'media/scenes/gate.png',
      'media/props/plate.png',
      'media/storyboards/shot-1-first.png',
      'media/videos/shot-1.mp4',
    ]) {
      zip.addFile(mediaPath, Buffer.from(`fixture:${mediaPath}`));
    }
    const parsed = importLocalMiniDramaArchive(zip.toBuffer(), { projectId: 'prj_materialize_test' });
    const writes: Array<{ key: string; contentType: string }> = [];
    const result = await materializeCreativeArchive(parsed, {
      async put(input) {
        writes.push({ key: input.key, contentType: input.contentType });
        return { uri: `s3://onecrew-test/${input.key}` };
      },
    });

    expect(result.assets).toHaveLength(parsed.bundle.mediaFiles.length);
    expect(result.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'character', provider: 'import', license: 'MIT' }),
        expect.objectContaining({ type: 'video', shotId: result.bundle.shots[0]?.shotId }),
      ]),
    );
    expect(result.bundle.shots[0]?.firstFrameAssetId).toMatch(/^asset_/);
    expect(result.bundle.framePrompts.find((frame) => frame.frameType === 'first')?.boundAssetId).toBe(
      result.bundle.shots[0]?.firstFrameAssetId,
    );
    expect(writes).toEqual(expect.arrayContaining([expect.objectContaining({ contentType: 'video/mp4' })]));
  });

  it('exports a portable compatible ZIP that can be imported again', async () => {
    const sourceZip = new AdmZip();
    sourceZip.addFile('project.json', Buffer.from(JSON.stringify(fixture)));
    for (const mediaPath of [
      'media/characters/lin.png',
      'media/characters/lin-side.png',
      'media/scenes/gate.png',
      'media/props/plate.png',
      'media/storyboards/shot-1-first.png',
      'media/videos/shot-1.mp4',
    ]) {
      sourceZip.addFile(mediaPath, Buffer.from(`fixture:${mediaPath}`));
    }
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const parsed = importLocalMiniDramaArchive(sourceZip.toBuffer(), { projectId: 'prj_export_source' });
    const materialized = await materializeCreativeArchive(parsed, {
      async put(input) {
        const uri = `s3://onecrew-test/${input.key}`;
        objects.set(uri, { bytes: input.bytes, contentType: input.contentType });
        return { uri };
      },
    });
    const exported = await exportLocalMiniDramaArchive(materialized.bundle, materialized.assets, {
      async get(uri) {
        const object = objects.get(uri);
        if (!object) throw new Error(`missing fake object: ${uri}`);
        return { ...object, key: uri.slice(uri.indexOf('/', 5) + 1) };
      },
    });

    const zip = new AdmZip(exported.buffer);
    const projectJson = JSON.parse(zip.readAsText('project.json')) as {
      version: string;
      episodes: Array<{ storyboards: Array<{ image_generations: unknown[]; frame_prompts: unknown[] }> }>;
    };
    expect(projectJson.version).toBe('1.4');
    expect(projectJson.episodes[0]?.storyboards[0]?.image_generations).toHaveLength(1);
    expect(projectJson.episodes[0]?.storyboards[0]?.frame_prompts).toHaveLength(2);
    expect(exported.mediaFiles).toBe(materialized.assets.length);

    const roundTrip = importLocalMiniDramaArchive(exported.buffer, { projectId: 'prj_export_roundtrip' });
    expect(roundTrip.bundle.episodes).toHaveLength(materialized.bundle.episodes.length);
    expect(roundTrip.bundle.shots[0]).toMatchObject({
      action: materialized.bundle.shots[0]?.action,
      creationMode: 'universal',
      cameraAngle: { horizontal: '正面', vertical: '平视' },
    });
    expect(roundTrip.bundle.framePrompts.map((frame) => frame.frameType)).toEqual(['first', 'last']);
  });

  it('exports and materializes the native OneCrew archive without losing asset metadata', async () => {
    const bundle = convertLocalMiniDramaProject(fixture, { projectId: 'prj_native_export' });
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const sourceFiles = new Map(bundle.mediaFiles.map((media) => [media.sourcePath, Buffer.from(media.sourcePath)]));
    const materialized = await materializeCreativeArchive({ bundle, files: sourceFiles }, {
      async put(input) {
        const uri = `s3://onecrew-test/${input.key}`;
        objects.set(uri, { bytes: input.bytes, contentType: input.contentType });
        return { uri };
      },
    });
    const exported = await exportOneCrewArchive(materialized.bundle, materialized.assets, {
      async get(uri) {
        const object = objects.get(uri);
        if (!object) throw new Error(`missing fake object: ${uri}`);
        return { ...object, key: uri.slice(uri.indexOf('/', 5) + 1) };
      },
    });
    const parsed = importOneCrewArchive(exported.buffer);
    const restored = await materializeOneCrewArchive(parsed, {
      async put(input) {
        return { uri: `s3://onecrew-restored/${input.key}` };
      },
    });

    expect(parsed.manifest.format).toBe('onecrew-creative-project');
    expect(restored.bundle).toEqual(materialized.bundle);
    expect(restored.assets).toHaveLength(materialized.assets.length);
    expect(restored.assets[0]).toMatchObject({
      assetId: materialized.assets[0]?.assetId,
      contentHash: materialized.assets[0]?.contentHash,
      creativeRole: materialized.assets[0]?.creativeRole,
    });
    expect(restored.assets[0]?.uri).toMatch(/^s3:\/\/onecrew-restored\//);

    const originalZip = new AdmZip(exported.buffer);
    const tamperedZip = new AdmZip();
    for (const entry of originalZip.getEntries()) {
      const bytes = entry.entryName.startsWith('media/assets/') ? Buffer.from('tampered') : entry.getData();
      tamperedZip.addFile(entry.entryName, bytes);
    }
    expect(() => importOneCrewArchive(tamperedZip.toBuffer())).toThrow(/media hash mismatch/);
  });
});
