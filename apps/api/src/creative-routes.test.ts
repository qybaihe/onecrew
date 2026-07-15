import {
  type CreativeProjectBundle,
  episodeSpecSchema,
  sceneSpecSchema,
  shotSpecSchema,
} from '@onecrew/contracts';
import { VersionConflictError } from '@onecrew/domain';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';

const projectFile = {
  version: '1.4',
  exported_at: '2026-07-15T00:00:00.000Z',
  drama: { title: 'API 导入测试', genre: '短剧' },
  episodes: [
    {
      episode_number: 1,
      title: '第一集',
      storyboards: [{ storyboard_number: 1, action: '角色进入场景。', scene_index: 0 }],
    },
  ],
  characters: [],
  scenes: [{ location: '测试场景' }],
  props: [],
};

describe('creative routes', () => {
  it('imports LocalMiniDrama JSON into the creative repository', async () => {
    let importedBundle: CreativeProjectBundle | undefined;
    const app = createApp({
      logger: false,
      probes: [],
      creatives: {
        repository: {
          async importBundle(bundle) {
            importedBundle = bundle;
            return {
              projectId: bundle.project.projectId,
              episodes: bundle.episodes.length,
              entities: bundle.entities.length,
              shots: bundle.shots.length,
              framePrompts: bundle.framePrompts.length,
              assets: 0,
            };
          },
          async getBundle() {
            if (!importedBundle) throw new Error('not imported');
            return importedBundle;
          },
          async listProjects() {
            return importedBundle ? [importedBundle.project] : [];
          },
          async listAssets() {
            return [];
          },
          async getRecordVersions() {
            if (!importedBundle) throw new Error('not imported');
            return {
              project: 1,
              episodes: Object.fromEntries(importedBundle.episodes.map((episode) => [episode.episodeId, 1])),
              entities: {},
              shots: Object.fromEntries(importedBundle.shots.map((shot) => [shot.shotId, 1])),
              framePrompts: {},
            };
          },
          async updateEpisode() {
            throw new Error('not used');
          },
          async updateEntity() {
            throw new Error('not used');
          },
          async updateShot() {
            throw new Error('not used');
          },
        },
        mediaStore: {
          async put(input) {
            return { uri: `s3://test/${input.key}` };
          },
          async get() {
            throw new Error('No media should be read in this fixture');
          },
        },
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/creative/imports/local-mini-drama/json',
      payload: { projectId: 'prj_api_import', ownerOpenId: 'ou_api', project: projectFile },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      ok: true,
      imported: { projectId: 'prj_api_import', episodes: 1, shots: 1 },
      source: { system: 'local-mini-drama', version: '1.4', license: 'MIT' },
    });
    expect(importedBundle?.shots[0]).toMatchObject({ action: '角色进入场景。', status: 'planned' });

    const exported = await app.inject({
      method: 'GET',
      url: '/v1/creative/projects/prj_api_import/exports/onecrew.zip',
    });
    expect(exported.statusCode).toBe(200);
    expect(exported.headers['content-type']).toContain('application/zip');
    expect(exported.headers['content-disposition']).toContain('.onecrew.zip');
    expect(exported.rawPayload.subarray(0, 2).toString('ascii')).toBe('PK');

    const reimported = await app.inject({
      method: 'POST',
      url: '/v1/creative/imports/onecrew/zip',
      headers: { 'content-type': 'application/zip' },
      payload: exported.rawPayload,
    });
    expect(reimported.statusCode).toBe(201);
    expect(reimported.json()).toMatchObject({ ok: true, imported: { projectId: 'prj_api_import' } });
    await app.close();
  });

  it('updates creative records with optimistic versions and returns conflicts as 409', async () => {
    const now = new Date().toISOString();
    const projectId = 'prj_edit_api';
    const episodeId = 'episode_edit_api';
    const shotId = 'shot_edit_api';
    const entityId = 'scene_edit_api';
    const episode = episodeSpecSchema.parse({
      episodeId,
      projectId,
      episodeNumber: 1,
      title: '旧标题',
      scriptContent: '旧剧本',
      durationSec: 6,
      characterIds: [],
      sceneIds: [],
      propIds: [],
      status: 'draft',
    });
    const shot = shotSpecSchema.parse({
      shotId,
      projectId,
      episodeId,
      sequence: 1,
      durationSec: 6,
      characters: [],
      sceneId: entityId,
      action: '旧动作',
      camera: '固定',
      prompt: '旧提示词',
      referenceAssetIds: [],
      importance: 'normal',
      closeupDialogue: false,
      status: 'planned',
    });
    let episodeVersion = 1;
    let entityVersion = 1;
    let shotVersion = 1;
    let currentEpisode = episode;
    let currentEntity = sceneSpecSchema.parse({
      entityId,
      projectId,
      episodeId,
      kind: 'scene',
      name: '星门',
      location: '星门',
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: 0,
      status: 'draft',
    });
    let currentShot = shot;
    const bundle: CreativeProjectBundle = {
      bundleVersion: '1.0',
      source: { system: 'onecrew', importedAt: now },
      project: {
        projectId,
        nameZh: '编辑测试',
        nameEn: 'Editing test',
        synopsis: '验证乐观锁编辑。',
        audience: '测试',
        genres: ['test'],
        ownerOpenId: 'ou_test',
        locales: ['zh-CN'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 0,
        status: 'draft',
      },
      episodes: [currentEpisode],
      entities: [currentEntity],
      shots: [currentShot],
      framePrompts: [],
      mediaFiles: [],
    };
    const app = createApp({
      logger: false,
      probes: [],
      creatives: {
        repository: {
          async importBundle() { throw new Error('not used'); },
          async getBundle() { return { ...bundle, episodes: [currentEpisode], entities: [currentEntity], shots: [currentShot] }; },
          async listProjects() { return [bundle.project]; },
          async listAssets() { return []; },
          async getRecordVersions() {
            return {
              project: 1,
              episodes: { [episodeId]: episodeVersion },
              entities: { [entityId]: entityVersion },
              shots: { [shotId]: shotVersion },
              framePrompts: {},
            };
          },
          async updateEpisode(id, expectedVersion, patch) {
            if (id !== episodeId) throw new Error('wrong episode');
            if (expectedVersion !== episodeVersion) throw new VersionConflictError(expectedVersion, episodeVersion);
            currentEpisode = episodeSpecSchema.parse({ ...currentEpisode, ...patch });
            episodeVersion += 1;
            return { value: currentEpisode, version: episodeVersion };
          },
          async updateEntity(id, expectedVersion, patch) {
            if (id !== entityId) throw new Error('wrong entity');
            if (expectedVersion !== entityVersion) throw new VersionConflictError(expectedVersion, entityVersion);
            currentEntity = sceneSpecSchema.parse({ ...currentEntity, ...patch });
            entityVersion += 1;
            return { value: currentEntity, version: entityVersion };
          },
          async updateShot(id, expectedVersion, patch) {
            if (id !== shotId) throw new Error('wrong shot');
            if (expectedVersion !== shotVersion) throw new VersionConflictError(expectedVersion, shotVersion);
            currentShot = shotSpecSchema.parse({ ...currentShot, ...patch });
            shotVersion += 1;
            return { value: currentShot, version: shotVersion };
          },
        },
      },
    });

    const episodeResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/creative/episodes/${episodeId}`,
      payload: { expectedVersion: 1, editId: 'edit_episode_1', actorOpenId: 'ou_studio', patch: { title: '新标题', scriptContent: '新剧本' } },
    });
    expect(episodeResponse.statusCode).toBe(200);
    expect(episodeResponse.json()).toMatchObject({ record: { title: '新标题', scriptContent: '新剧本' }, version: 2 });

    const shotResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/creative/shots/${shotId}`,
      payload: { expectedVersion: 1, editId: 'edit_shot_1', actorOpenId: 'ou_studio', patch: { action: '新动作', camera: '缓慢推进' } },
    });
    expect(shotResponse.statusCode).toBe(200);
    expect(shotResponse.json()).toMatchObject({ record: { action: '新动作', camera: '缓慢推进' }, version: 2 });

    const entityResponse = await app.inject({
      method: 'PATCH',
      url: `/v1/creative/entities/${entityId}`,
      payload: {
        expectedVersion: 1,
        editId: 'edit_entity_1',
        actorOpenId: 'ou_studio',
        patch: { name: '远古星门', location: '星海边界', atmosphere: '静谧、宏大' },
      },
    });
    expect(entityResponse.statusCode).toBe(200);
    expect(entityResponse.json()).toMatchObject({ record: { name: '远古星门', location: '星海边界' }, version: 2 });

    const conflict = await app.inject({
      method: 'PATCH',
      url: `/v1/creative/shots/${shotId}`,
      payload: { expectedVersion: 1, editId: 'edit_shot_stale', actorOpenId: 'ou_studio', patch: { action: '过期修改' } },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ error: 'VersionConflictError' });
    await app.close();
  });

  it('keeps creative imports unavailable when no repository is wired', async () => {
    const app = createApp({ logger: false, probes: [] });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/creative/imports/local-mini-drama/json',
      payload: { project: projectFile },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
