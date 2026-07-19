import {
  assetRecordSchema,
  type CreativeGenerationBatchRequest,
  type CreativeProjectBundle,
  type CreativeReferenceGridRequest,
  type CreativeStoryPlanRequest,
  type CreativeWorkflowGroup,
  type ProviderRequest,
  type QcRunRequest,
  type RegionalCulturePackRequest,
  creativeGenerationBatchSchema,
  creativeStoryPlanSchema,
  creativeWorkflowGroupSchema,
  episodeSpecSchema,
  regionalCulturePackSchema,
  sceneSpecSchema,
  shotSpecSchema,
} from '@onecrew/contracts';
import { createInputHash, VersionConflictError } from '@onecrew/domain';
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
    let generationRequest: ProviderRequest | undefined;
    let continuityQcRequest: QcRunRequest | undefined;
    let storyPlanRequest: CreativeStoryPlanRequest | undefined;
    let referenceGridRequest: CreativeReferenceGridRequest | undefined;
    let reusedAssetInput: { entityId: string; sourceAssetId: string; expectedEntityVersion: number } | undefined;
    const batchSubmitRequests: Array<{
      projectId: string;
      request: CreativeGenerationBatchRequest;
      idempotencyKey: string;
    }> = [];
    const submittedWorkflowBatches = new Map<string, typeof batchRecord>();
    let currentWorkflowGroup: CreativeWorkflowGroup | undefined;
    let workflowGroupVersion = 0;
    const storyPlan = creativeStoryPlanSchema.parse({
      title: '星门续章', logline: '导航员抵达星门。',
      episodes: [{
        title: '第二集', synopsis: '坐标出现。', scriptContent: '云岚：坐标出现了。', durationSec: 60,
        characterNames: ['云岚'], sceneNames: ['星门回廊'], propNames: [],
      }],
      characters: [{ name: '云岚', role: '导航员', personality: '敏锐', appearance: '短发', voiceStyle: '清晰', identityAnchors: ['短发'] }],
      scenes: [{ name: '星门回廊', description: '回廊', location: '星门', timeOfDay: '夜', atmosphere: '神秘', lightingStyle: '青蓝' }],
      props: [],
    });
    const qcAsset = assetRecordSchema.parse({
      assetId: 'asset_api_qc',
      projectId,
      shotId,
      type: 'image',
      version: 1,
      uri: 's3://onecrew/creative/api-qc.png',
      provider: 'import',
      model: 'source',
      source: 'Imported creative source',
      license: 'test fixture',
      contentHash: '8'.repeat(64),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });
    const reusableAsset = assetRecordSchema.parse({
      ...qcAsset,
      assetId: 'asset_api_reusable',
      projectId: 'prj_api_library_origin',
      shotId: undefined,
      type: 'scene',
      uri: 's3://onecrew/library/api-reusable.png',
      creativeRole: 'scene-master',
      contentHash: 'b'.repeat(64),
    });
    const batchRecord = creativeGenerationBatchSchema.parse({
      batchId: 'batch_api_generation',
      projectId,
      kind: 'image',
      status: 'running',
      missingOnly: true,
      route: 'primary',
      generationNonce: 12,
      concurrency: 2,
      items: [{
        shotId,
        expectedVersion: 2,
        status: 'queued',
        jobId: 'job_api_batch',
        mode: 'mock',
        provider: 'mock-image-primary',
        estimatedCostCny: 0.01,
        outputAssetIds: [],
        retryCount: 0,
      }],
      inputHash: '9'.repeat(64),
      createdAt: now,
      updatedAt: now,
    });
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
          async listAssets() { return [qcAsset]; },
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
        shotRepository: {
          async get(id) {
            if (id !== shotId) throw new Error('wrong shot');
            return { value: currentShot, version: shotVersion };
          },
        },
        generator: {
          async submit(request) {
            generationRequest = request;
            return {
              jobId: 'job_creative_generation',
              status: 'queued',
              mode: 'mock',
              provider: 'mock-image-primary',
              route: 'primary',
              estimatedCostCny: 0.01,
              statusUrl: '/v1/jobs/job_creative_generation',
              replayed: false,
            };
          },
        },
        batchGenerator: {
          async submit(id, request, idempotencyKey) {
            if (id !== projectId) throw new Error('wrong project');
            batchSubmitRequests.push({ projectId: id, request, idempotencyKey });
            if (idempotencyKey.startsWith('workflow-group:')) {
              const workflowBatch = creativeGenerationBatchSchema.parse({
                ...batchRecord,
                batchId: `batch_${createInputHash({ projectId, idempotencyKey }).slice(0, 32)}`,
                kind: request.kind,
                missingOnly: request.missingOnly,
                generationNonce: request.generationNonce,
                concurrency: request.concurrency,
              });
              submittedWorkflowBatches.set(workflowBatch.batchId, workflowBatch);
              return { value: workflowBatch, version: 1 };
            }
            return { value: batchRecord, version: 1 };
          },
          async get(id) {
            const workflowBatch = submittedWorkflowBatches.get(id);
            if (workflowBatch) return { value: workflowBatch, version: 1 };
            if (id !== batchRecord.batchId) throw new Error('wrong batch');
            return { value: batchRecord, version: 1 };
          },
          async latest(id) {
            if (id !== projectId) throw new Error('wrong project');
            return { value: batchRecord, version: 1 };
          },
          async cancel(id) {
            if (id !== batchRecord.batchId) throw new Error('wrong batch');
            return { value: { ...batchRecord, status: 'cancelled' as const }, version: 2 };
          },
          async retry(id) {
            if (id !== batchRecord.batchId) throw new Error('wrong batch');
            return { value: { ...batchRecord, route: 'fallback' as const }, version: 3 };
          },
        },
        continuityQc: {
          async submit(request) {
            continuityQcRequest = request;
            return {
              qcRunId: 'qc_api_continuity',
              status: 'queued',
              statusUrl: '/v1/qc/runs/qc_api_continuity',
              replayed: false,
            };
          },
        },
        storyPlanner: {
          async submit(id, request) {
            if (id !== projectId) throw new Error('wrong project');
            storyPlanRequest = request;
            return {
              jobId: 'job_api_story_plan',
              status: 'queued',
              mode: 'mock',
              provider: 'mock-llm-primary',
              route: 'primary',
              estimatedCostCny: 0.01,
              statusUrl: '/v1/jobs/job_api_story_plan',
              replayed: false,
            };
          },
          async preview(id, jobId) {
            if (id !== projectId || jobId !== 'job_api_story_plan') throw new Error('wrong story plan');
            return {
              job: {
                jobId,
                projectId,
                capability: 'plan',
                provider: 'mock-llm-primary',
                model: 'deterministic-v1',
                mode: 'mock',
                status: 'succeeded',
                attempt: 1,
                inputHash: '7'.repeat(64),
                outputAssetIds: [],
                createdAt: now,
                updatedAt: now,
              },
              plan: storyPlan,
            };
          },
          async apply(id, jobId, expectedProjectVersion, actorOpenId) {
            if (id !== projectId || jobId !== 'job_api_story_plan') throw new Error('wrong story plan');
            if (expectedProjectVersion !== 1 || actorOpenId !== 'ou_studio') throw new Error('wrong apply input');
            return {
              projectId,
              jobId,
              projectVersion: 2,
              replayed: false,
              episodeIds: ['episode_api_story'],
              entityIds: ['character_api_story', 'scene_api_story'],
            };
          },
        },
        referenceGrid: {
          async process(id, request, idempotencyKey) {
            if (id !== entityId || idempotencyKey !== 'creative_reference_grid_1') {
              throw new Error('wrong reference grid request');
            }
            referenceGridRequest = request;
            return {
              projectId,
              entityId,
              sourceAssetId: qcAsset.assetId,
              rows: request.rows,
              columns: request.columns,
              tileAssetIds: ['asset_grid_1', 'asset_grid_2', 'asset_grid_3', 'asset_grid_4'],
              entityVersion: 3,
              replayed: false,
            };
          },
        },
        reusableAssets: {
          async searchReusableAssets(input) {
            if (input.kind !== 'scene' || input.excludeProjectId !== projectId) {
              throw new Error('wrong reusable asset search');
            }
            return [{
              asset: reusableAsset,
              originProject: {
                projectId: reusableAsset.projectId,
                nameZh: '全局场景库',
                nameEn: 'Global scene library',
              },
              originEntity: { entityId: 'scene_api_library', kind: 'scene' as const, name: '星海边界' },
            }];
          },
          async reuseAsset(input) {
            reusedAssetInput = input;
            return {
              projectId,
              entityId: input.entityId,
              sourceAssetId: input.sourceAssetId,
              reusedAssetId: 'asset_reuse_api_scene',
              entityVersion: 3,
              replayed: false,
            };
          },
        },
        workflowGroups: {
          async create(record) {
            if (currentWorkflowGroup) {
              return { value: currentWorkflowGroup, version: workflowGroupVersion, replayed: true };
            }
            currentWorkflowGroup = creativeWorkflowGroupSchema.parse(record);
            workflowGroupVersion = 1;
            return { value: currentWorkflowGroup, version: workflowGroupVersion, replayed: false };
          },
          async get(groupId) {
            if (!currentWorkflowGroup || currentWorkflowGroup.groupId !== groupId) {
              throw new Error('wrong workflow group');
            }
            return { value: currentWorkflowGroup, version: workflowGroupVersion };
          },
          async listForProject(id) {
            if (id !== projectId) throw new Error('wrong project');
            return currentWorkflowGroup
              ? [{ value: currentWorkflowGroup, version: workflowGroupVersion }]
              : [];
          },
          async attachBatch(groupId, expectedVersion, batchId) {
            if (!currentWorkflowGroup || currentWorkflowGroup.groupId !== groupId) {
              throw new Error('wrong workflow group');
            }
            if (expectedVersion !== workflowGroupVersion) {
              throw new VersionConflictError(expectedVersion, workflowGroupVersion);
            }
            currentWorkflowGroup = creativeWorkflowGroupSchema.parse({
              ...currentWorkflowGroup,
              lastBatchId: batchId,
              updatedAt: new Date().toISOString(),
            });
            workflowGroupVersion += 1;
            return { value: currentWorkflowGroup, version: workflowGroupVersion };
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

    const missingReferenceGridKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/entities/${entityId}/reference-grids`,
      payload: {
        sourceAssetId: qcAsset.assetId,
        expectedEntityVersion: 2,
        rows: 2,
        columns: 2,
        actorOpenId: 'ou_studio',
      },
    });
    expect(missingReferenceGridKey.statusCode).toBe(400);

    const referenceGrid = await app.inject({
      method: 'POST',
      url: `/v1/creative/entities/${entityId}/reference-grids`,
      headers: { 'idempotency-key': 'creative_reference_grid_1' },
      payload: {
        sourceAssetId: qcAsset.assetId,
        expectedEntityVersion: 2,
        rows: 2,
        columns: 2,
        actorOpenId: 'ou_studio',
      },
    });
    expect(referenceGrid.statusCode).toBe(200);
    expect(referenceGrid.json()).toMatchObject({
      ok: true,
      result: { entityId, sourceAssetId: qcAsset.assetId, tileAssetIds: expect.any(Array), entityVersion: 3 },
    });
    expect(referenceGridRequest).toMatchObject({
      sourceAssetId: qcAsset.assetId,
      expectedEntityVersion: 2,
      rows: 2,
      columns: 2,
    });

    const reusableSearch = await app.inject({
      method: 'GET',
      url: `/v1/creative/reusable-assets?q=星海&kind=scene&excludeProjectId=${projectId}&limit=5`,
    });
    expect(reusableSearch.statusCode).toBe(200);
    expect(reusableSearch.json()).toMatchObject({
      items: [{
        asset: { assetId: reusableAsset.assetId },
        originProject: { nameZh: '全局场景库' },
        originEntity: { name: '星海边界' },
      }],
    });

    const missingReuseKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/entities/${entityId}/reusable-assets`,
      payload: {
        sourceAssetId: reusableAsset.assetId,
        expectedEntityVersion: 2,
        actorOpenId: 'ou_studio',
      },
    });
    expect(missingReuseKey.statusCode).toBe(400);

    const reuseAsset = await app.inject({
      method: 'POST',
      url: `/v1/creative/entities/${entityId}/reusable-assets`,
      headers: { 'idempotency-key': 'creative_reuse_asset_1' },
      payload: {
        sourceAssetId: reusableAsset.assetId,
        expectedEntityVersion: 2,
        actorOpenId: 'ou_studio',
      },
    });
    expect(reuseAsset.statusCode).toBe(200);
    expect(reuseAsset.json()).toMatchObject({
      result: { reusedAssetId: 'asset_reuse_api_scene', entityVersion: 3 },
    });
    expect(reusedAssetInput).toMatchObject({
      entityId,
      sourceAssetId: reusableAsset.assetId,
      expectedEntityVersion: 2,
    });

    const missingWorkflowGroupKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/workflow-groups`,
      payload: {
        name: '主线镜头', shotIds: [shotId], generationKind: 'image', missingOnly: true,
        concurrency: 2, createdBy: 'ou_studio',
      },
    });
    expect(missingWorkflowGroupKey.statusCode).toBe(400);

    const workflowGroup = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/workflow-groups`,
      headers: { 'idempotency-key': 'creative_workflow_group_1' },
      payload: {
        name: '主线镜头', description: '保存后继续补齐。', shotIds: [shotId], generationKind: 'image',
        missingOnly: true, concurrency: 2, createdBy: 'ou_studio',
      },
    });
    expect(workflowGroup.statusCode).toBe(201);
    expect(workflowGroup.json()).toMatchObject({
      group: { name: '主线镜头', shotIds: [shotId], generationKind: 'image' },
      version: 1,
      replayed: false,
    });
    const workflowGroupId = workflowGroup.json().group.groupId as string;

    const workflowGroups = await app.inject({
      method: 'GET',
      url: `/v1/creative/projects/${projectId}/workflow-groups`,
    });
    expect(workflowGroups.json()).toMatchObject({
      groups: [{ group: { groupId: workflowGroupId, name: '主线镜头' }, version: 1 }],
    });

    const workflowRun = await app.inject({
      method: 'POST',
      url: `/v1/creative/workflow-groups/${workflowGroupId}/run`,
      headers: { 'idempotency-key': 'creative_workflow_run_1' },
      payload: {
        expectedGroupVersion: 1,
        expectedShotVersions: { [shotId]: 2 },
        route: 'primary',
        generationNonce: 13,
        forceRegenerate: false,
      },
    });
    expect(workflowRun.statusCode).toBe(202);
    const workflowBatchId = workflowRun.json().batch.batchId as string;
    expect(workflowRun.json()).toMatchObject({
      group: { groupId: workflowGroupId, lastBatchId: workflowBatchId },
      groupVersion: 2,
      batch: { batchId: workflowBatchId },
    });
    expect(batchSubmitRequests.at(-1)).toMatchObject({
      projectId,
      request: { shotIds: [shotId], kind: 'image', missingOnly: true, concurrency: 2 },
      idempotencyKey: `workflow-group:${workflowGroupId}:creative_workflow_run_1`,
    });

    const workflowRunReplay = await app.inject({
      method: 'POST',
      url: `/v1/creative/workflow-groups/${workflowGroupId}/run`,
      headers: { 'idempotency-key': 'creative_workflow_run_1' },
      payload: {
        expectedGroupVersion: 1,
        expectedShotVersions: { [shotId]: 2 },
        route: 'primary',
        generationNonce: 13,
        forceRegenerate: false,
      },
    });
    expect(workflowRunReplay.statusCode).toBe(202);
    expect(workflowRunReplay.json()).toMatchObject({
      groupVersion: 2,
      batch: { batchId: workflowBatchId },
    });
    expect(batchSubmitRequests.filter((item) => item.idempotencyKey.endsWith('creative_workflow_run_1')))
      .toHaveLength(1);

    const workflowForceRun = await app.inject({
      method: 'POST',
      url: `/v1/creative/workflow-groups/${workflowGroupId}/run`,
      headers: { 'idempotency-key': 'creative_workflow_run_force_1' },
      payload: {
        expectedGroupVersion: 2,
        expectedShotVersions: { [shotId]: 2 },
        generationNonce: 14,
        forceRegenerate: true,
      },
    });
    expect(workflowForceRun.statusCode).toBe(202);
    expect(workflowForceRun.json()).toMatchObject({ groupVersion: 3 });
    expect(batchSubmitRequests.at(-1)?.request).toMatchObject({ missingOnly: false, generationNonce: 14 });

    const missingStoryPlanKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/story-plans`,
      payload: { brief: '追加一集星门故事。', episodeCount: 1, generationNonce: 1 },
    });
    expect(missingStoryPlanKey.statusCode).toBe(400);

    const storyPlanSubmission = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/story-plans`,
      headers: { 'idempotency-key': 'creative_story_plan_1' },
      payload: { brief: '追加一集星门故事。', episodeCount: 1, generationNonce: 1 },
    });
    expect(storyPlanSubmission.statusCode).toBe(202);
    expect(storyPlanSubmission.json()).toMatchObject({
      job_id: 'job_api_story_plan',
      status: 'queued',
      provider: 'mock-llm-primary',
    });
    expect(storyPlanRequest).toMatchObject({ brief: '追加一集星门故事。', episodeCount: 1 });

    const storyPlanPreview = await app.inject({
      method: 'GET',
      url: `/v1/creative/projects/${projectId}/story-plans/job_api_story_plan`,
    });
    expect(storyPlanPreview.statusCode).toBe(200);
    expect(storyPlanPreview.json()).toMatchObject({
      job: { status: 'succeeded' },
      plan: { title: '星门续章', episodes: [{ title: '第二集' }] },
    });

    const storyPlanApply = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/story-plans/job_api_story_plan/apply`,
      payload: { expectedProjectVersion: 1, actorOpenId: 'ou_studio' },
    });
    expect(storyPlanApply.statusCode).toBe(200);
    expect(storyPlanApply.json()).toMatchObject({
      ok: true,
      applied: { projectVersion: 2, episodeIds: ['episode_api_story'] },
    });

    const missingGenerationKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/shots/${shotId}/generations`,
      payload: { expectedVersion: 2, kind: 'image', generationNonce: 9 },
    });
    expect(missingGenerationKey.statusCode).toBe(400);

    const generation = await app.inject({
      method: 'POST',
      url: `/v1/creative/shots/${shotId}/generations`,
      headers: { 'idempotency-key': 'creative_generation_1' },
      payload: { expectedVersion: 2, kind: 'image', route: 'primary', generationNonce: 10 },
    });
    expect(generation.statusCode).toBe(202);
    expect(generation.json()).toMatchObject({
      job_id: 'job_creative_generation',
      status: 'queued',
      provider: 'mock-image-primary',
    });
    expect(generationRequest).toMatchObject({
      capability: 'image',
      projectId,
      shotId,
      prompt: '旧提示词',
      generationNonce: 10,
    });

    const staleGeneration = await app.inject({
      method: 'POST',
      url: `/v1/creative/shots/${shotId}/generations`,
      headers: { 'idempotency-key': 'creative_generation_stale' },
      payload: { expectedVersion: 1, kind: 'video', generationNonce: 11 },
    });
    expect(staleGeneration.statusCode).toBe(409);

    const missingQcKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/shots/${shotId}/continuity-qc`,
      payload: { expectedVersion: 2, assetId: qcAsset.assetId },
    });
    expect(missingQcKey.statusCode).toBe(400);

    const continuityQc = await app.inject({
      method: 'POST',
      url: `/v1/creative/shots/${shotId}/continuity-qc`,
      headers: { 'idempotency-key': 'creative_qc_1' },
      payload: { expectedVersion: 2, assetId: qcAsset.assetId, autoRemediate: true },
    });
    expect(continuityQc.statusCode).toBe(202);
    expect(continuityQc.json()).toMatchObject({
      qc_run_id: 'qc_api_continuity',
      source_asset_id: qcAsset.assetId,
      source_asset_version: 1,
      media_type: 'image',
    });
    expect(continuityQcRequest).toMatchObject({
      projectId,
      shotId,
      sourceAssetId: qcAsset.assetId,
      mediaUri: qcAsset.uri,
      criteria: expect.arrayContaining([expect.stringContaining('镜头语言与构图一致')]),
    });

    const batch = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/generation-batches`,
      headers: { 'idempotency-key': 'creative_batch_1' },
      payload: {
        kind: 'image',
        expectedVersions: { [shotId]: 2 },
        missingOnly: true,
        route: 'primary',
        generationNonce: 12,
        concurrency: 2,
      },
    });
    expect(batch.statusCode).toBe(202);
    expect(batch.json()).toMatchObject({ batch: { batchId: 'batch_api_generation', status: 'running' } });

    const latestBatch = await app.inject({
      method: 'GET',
      url: `/v1/creative/projects/${projectId}/generation-batches/latest`,
    });
    expect(latestBatch.json()).toMatchObject({ batch: { batchId: 'batch_api_generation' }, version: 1 });

    const stoppedBatch = await app.inject({
      method: 'POST',
      url: `/v1/creative/generation-batches/${batchRecord.batchId}/cancel`,
    });
    expect(stoppedBatch.json()).toMatchObject({ batch: { status: 'cancelled' }, version: 2 });

    const retriedBatch = await app.inject({
      method: 'POST',
      url: `/v1/creative/generation-batches/${batchRecord.batchId}/retry`,
      headers: { 'idempotency-key': 'creative_batch_retry_1' },
      payload: { route: 'fallback' },
    });
    expect(retriedBatch.statusCode).toBe(202);
    expect(retriedBatch.json()).toMatchObject({ batch: { route: 'fallback' }, version: 3 });

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

  it('exposes regional culture pack endpoints with idempotency and preview', async () => {
    const projectId = 'prj_api_culture';
    const jobId = 'job_api_culture';
    const now = new Date().toISOString();
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
    let capturedRequest: RegionalCulturePackRequest | undefined;
    let capturedKey: string | undefined;
    const app = createApp({
      logger: false,
      probes: [],
      creatives: {
        repository: {
          async importBundle() { throw new Error('not used'); },
          async getBundle() { throw new Error('not used'); },
          async getRecordVersions() { throw new Error('not used'); },
          async listProjects() { throw new Error('not used'); },
          async listAssets() { throw new Error('not used'); },
          async updateEntity() { throw new Error('not used'); },
          async updateEpisode() { throw new Error('not used'); },
          async updateShot() { throw new Error('not used'); },
        },
        regionalCulturePlanner: {
          async submit(id, request, idempotencyKey) {
            if (id !== projectId) throw new Error('wrong project');
            capturedRequest = request;
            capturedKey = idempotencyKey;
            return {
              jobId,
              status: 'queued',
              mode: 'mock',
              provider: 'mock-llm-primary',
              route: 'primary',
              estimatedCostCny: 0.01,
              statusUrl: `/v1/jobs/${jobId}`,
              replayed: false,
            };
          },
          async preview(id, requestedJobId) {
            if (id !== projectId || requestedJobId !== jobId) throw new Error('wrong culture pack job');
            return {
              job: {
                jobId: requestedJobId,
                projectId,
                capability: 'plan',
                provider: 'mock-llm-primary',
                model: 'deterministic-v1',
                mode: 'mock',
                status: 'succeeded',
                attempt: 1,
                inputHash: '7'.repeat(64),
                outputAssetIds: [],
                createdAt: now,
                updatedAt: now,
              },
              pack: culturePack,
            };
          },
        },
      },
    });

    const missingKey = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/regional-culture-packs`,
      payload: { region: 'america', brief: '为美国市场重写本项目。', generationNonce: 1 },
    });
    expect(missingKey.statusCode).toBe(400);

    const submission = await app.inject({
      method: 'POST',
      url: `/v1/creative/projects/${projectId}/regional-culture-packs`,
      headers: { 'idempotency-key': 'regional_culture_1' },
      payload: { region: 'america', brief: '为美国市场重写本项目。', generationNonce: 1 },
    });
    expect(submission.statusCode).toBe(202);
    expect(submission.json()).toMatchObject({
      job_id: jobId,
      status: 'queued',
      provider: 'mock-llm-primary',
      status_url: `/v1/jobs/${jobId}`,
    });
    expect(capturedRequest).toMatchObject({ region: 'america', brief: '为美国市场重写本项目。' });
    expect(capturedKey).toBe('regional_culture_1');

    const preview = await app.inject({
      method: 'GET',
      url: `/v1/creative/projects/${projectId}/regional-culture-packs/${jobId}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      job: { status: 'succeeded' },
      pack: { region: 'america', regionLabel: '美国' },
    });

    const notFound = await app.inject({
      method: 'GET',
      url: `/v1/creative/projects/${projectId}/regional-culture-packs/job_unknown`,
    });
    expect(notFound.statusCode).toBe(500);
    await app.close();
  });

  it('returns 503 when regional culture planner is not wired', async () => {
    const app = createApp({
      logger: false,
      probes: [],
      creatives: {
        repository: {
          async importBundle() { throw new Error('not used'); },
          async getBundle() { throw new Error('not used'); },
          async getRecordVersions() { throw new Error('not used'); },
          async listProjects() { throw new Error('not used'); },
          async listAssets() { throw new Error('not used'); },
          async updateEntity() { throw new Error('not used'); },
          async updateEpisode() { throw new Error('not used'); },
          async updateShot() { throw new Error('not used'); },
        },
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/creative/projects/prj_x/regional-culture-packs',
      headers: { 'idempotency-key': 'k' },
      payload: { region: 'america', brief: 'b', generationNonce: 1 },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
