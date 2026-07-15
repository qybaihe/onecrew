import { loadEnv } from '@onecrew/config';
import {
  assetRecordSchema,
  creativeGenerationBatchSchema,
  creativeProjectBundleSchema,
  projectSpecSchema,
} from '@onecrew/contracts';
import { createInputHash, InvalidStateTransitionError, VersionConflictError } from '@onecrew/domain';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/client.js';
import {
  createRepositories,
  IdempotencyConflictError,
  InvalidCreativeAssetBindingError,
} from '../src/repositories.js';
import { auditLogs } from '../src/schema.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const client = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(client.db);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
  await client.close();
});

describe('PostgreSQL repositories', () => {
  it('atomically registers reference-grid tiles and replaces the composite entity binding', async () => {
    const projectId = `prj_reference_grid_${suffix}`;
    const entityId = `character_reference_grid_${suffix}`;
    const sourceAssetId = `asset_reference_grid_source_${suffix}`;
    await repositories.creative.importBundle(creativeProjectBundleSchema.parse({
      bundleVersion: '1.0', source: { system: 'onecrew' },
      project: {
        projectId, nameZh: '参考图网格测试', nameEn: 'Reference Grid Test', synopsis: '拆分组合参考图。',
        audience: '开发测试', genres: ['test'], ownerOpenId: 'ou_grid_owner', locales: ['zh-CN'],
        aspectRatios: ['16:9'], budgetLimitCny: 1, status: 'draft',
      },
      episodes: [{
        episodeId: `episode_reference_grid_${suffix}`, projectId, episodeNumber: 1, title: '参考图测试',
        scriptContent: '', durationSec: 1, characterIds: [entityId], sceneIds: [], propIds: [], status: 'draft',
      }],
      entities: [{
        entityId, projectId, kind: 'character', name: '云岚', referenceAssetIds: [sourceAssetId], extraAssetIds: [],
        identityAnchors: [], styleTokens: [], colorPalette: [], stages: [], sortOrder: 0, status: 'draft',
      }],
      shots: [], framePrompts: [], mediaFiles: [],
    }));
    const createdAt = new Date().toISOString();
    const source = assetRecordSchema.parse({
      assetId: sourceAssetId, projectId, type: 'image', version: 1, uri: `s3://onecrew/grid/${sourceAssetId}.png`,
      provider: 'import', model: 'source', source: 'grid fixture', license: 'fixture', contentHash: '6'.repeat(64),
      status: 'draft', createdAt, updatedAt: createdAt,
    });
    await repositories.assets.create(source);
    const tiles = Array.from({ length: 4 }, (_, index) => assetRecordSchema.parse({
      assetId: `asset_reference_grid_tile_${index}_${suffix}`, projectId, type: 'image', version: 1,
      parentAssetId: sourceAssetId, uri: `s3://onecrew/grid/${sourceAssetId}/tile-${index}.png`,
      provider: 'onecrew-media', model: 'ffmpeg-grid-v1', source: `tile ${index}`, license: 'fixture',
      creativeRole: `reference-grid-r${Math.floor(index / 2) + 1}-c${index % 2 + 1}`,
      contentHash: String(index + 1).repeat(64), status: 'draft', createdAt, updatedAt: createdAt,
    }));
    const input = {
      entityId, sourceAssetId, expectedEntityVersion: 1, rows: 2, columns: 2, actorOpenId: 'ou_grid_editor',
      idempotencyKey: `reference_grid_${suffix}`, tiles,
    };
    await expect(repositories.creative.applyReferenceGrid(input)).resolves.toMatchObject({
      entityId, sourceAssetId, entityVersion: 2, replayed: false,
      tileAssetIds: tiles.map((tile) => tile.assetId),
    });
    const restored = await repositories.creative.getBundle(projectId);
    expect(restored.entities[0]?.referenceAssetIds).toEqual(tiles.map((tile) => tile.assetId));
    await expect(repositories.creative.applyReferenceGrid(input)).resolves.toMatchObject({
      entityVersion: 2, replayed: true,
    });
    await expect(repositories.creative.applyReferenceGrid({
      ...input, idempotencyKey: `reference_grid_stale_${suffix}`,
    })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('atomically appends a generated story plan, bumps the project version, and replays by Job', async () => {
    const projectId = `prj_story_append_${suffix}`;
    const bundle = creativeProjectBundleSchema.parse({
      bundleVersion: '1.0',
      source: { system: 'onecrew' },
      project: {
        projectId, nameZh: '故事追加测试', nameEn: 'Story Append Test', synopsis: '验证故事计划安全追加。',
        audience: '开发测试', genres: ['test'], ownerOpenId: 'ou_story_owner', locales: ['zh-CN'],
        aspectRatios: ['16:9'], budgetLimitCny: 1, totalEpisodes: 1, status: 'draft',
      },
      episodes: [{
        episodeId: `episode_story_existing_${suffix}`, projectId, episodeNumber: 1, title: '序章',
        scriptContent: '序章。', durationSec: 30, characterIds: [], sceneIds: [], propIds: [], status: 'draft',
      }],
      entities: [], shots: [], framePrompts: [], mediaFiles: [],
    });
    await repositories.creative.importBundle(bundle);
    const jobId = `job_story_append_${suffix}`;
    const entityId = `character_story_append_${suffix}`;
    const episodeId = `episode_story_append_${suffix}`;
    const appended = await repositories.creative.appendStoryPlan({
      projectId,
      jobId,
      expectedProjectVersion: 1,
      actorOpenId: 'ou_story_editor',
      entities: [{
        entityId, projectId, kind: 'character', name: '云岚', role: '导航员', identityAnchors: ['青绿披肩'],
        referenceAssetIds: [], extraAssetIds: [], styleTokens: [], colorPalette: [], stages: [], sortOrder: 0,
        status: 'draft',
      }],
      episodes: [{
        episodeId, projectId, episodeNumber: 2, title: '星图回响', scriptContent: '云岚抵达星门。', durationSec: 60,
        characterIds: [entityId], sceneIds: [], propIds: [], status: 'planning',
      }],
    });
    expect(appended).toMatchObject({ projectId, jobId, projectVersion: 2, replayed: false });
    const restored = await repositories.creative.getBundle(projectId);
    expect(restored.project.totalEpisodes).toBe(2);
    expect(restored.episodes.map((episode) => episode.episodeId)).toContain(episodeId);
    expect(restored.entities.map((entity) => entity.entityId)).toContain(entityId);

    await expect(repositories.creative.appendStoryPlan({
      projectId,
      jobId,
      expectedProjectVersion: 2,
      actorOpenId: 'ou_story_editor',
      entities: [],
      episodes: [],
    })).resolves.toMatchObject({ projectVersion: 2, replayed: true, episodeIds: [episodeId] });

    await expect(repositories.creative.appendStoryPlan({
      projectId,
      jobId: `job_story_stale_${suffix}`,
      expectedProjectVersion: 1,
      actorOpenId: 'ou_story_editor',
      entities: [],
      episodes: [],
    })).rejects.toBeInstanceOf(VersionConflictError);
  });

  it('imports and reads back a complete creative bundle transactionally', async () => {
    const now = new Date().toISOString();
    const projectId = `prj_creative_${suffix}`;
    const episodeId = `episode_creative_${suffix}`;
    const characterId = `character_creative_${suffix}`;
    const sceneId = `scene_creative_${suffix}`;
    const shotId = `shot_creative_${suffix}`;
    const framePromptId = `frame_creative_${suffix}`;
    const bundle = creativeProjectBundleSchema.parse({
      bundleVersion: '1.0',
      source: { system: 'local-mini-drama', version: '1.4', license: 'MIT', importedAt: now },
      project: {
        projectId,
        nameZh: '创作工程导入测试',
        nameEn: 'Creative Import Test',
        synopsis: '验证剧集、素材实体、结构化分镜和帧提示词事务导入。',
        audience: '开发测试',
        genres: ['test'],
        ownerOpenId: 'ou_test_owner',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9'],
        budgetLimitCny: 0,
        totalEpisodes: 1,
        source: { system: 'local-mini-drama', version: '1.4', license: 'MIT', importedAt: now },
        status: 'draft',
      },
      episodes: [{
        episodeId,
        projectId,
        episodeNumber: 1,
        title: '第一集',
        scriptContent: '角色进入星门。',
        durationSec: 6,
        characterIds: [characterId],
        sceneIds: [sceneId],
        propIds: [],
        status: 'draft',
      }],
      entities: [
        {
          entityId: characterId,
          projectId,
          kind: 'character',
          name: '测试角色',
          identityAnchors: ['银白短发'],
          styleTokens: [],
          colorPalette: [],
          stages: [],
          referenceAssetIds: [],
          extraAssetIds: [],
          sortOrder: 0,
          status: 'draft',
        },
        {
          entityId: sceneId,
          projectId,
          episodeId,
          kind: 'scene',
          name: '星门',
          location: '星门',
          referenceAssetIds: [],
          extraAssetIds: [],
          sortOrder: 0,
          status: 'draft',
        },
      ],
      shots: [{
        shotId,
        projectId,
        episodeId,
        sequence: 1,
        durationSec: 6,
        characters: [characterId],
        sceneId,
        propIds: [],
        action: '角色进入星门。',
        camera: '缓慢推进',
        prompt: 'cinematic stargate',
        referenceAssetIds: [],
        framePromptIds: [framePromptId],
        creationMode: 'classic',
        importance: 'hero',
        closeupDialogue: false,
        status: 'planned',
      }],
      framePrompts: [{
        framePromptId,
        shotId,
        frameType: 'first',
        prompt: '星门前的首帧',
      }],
      mediaFiles: [],
    });
    const assetId = `asset_creative_${suffix}`;
    const imported = await repositories.creative.importBundle(bundle, [{
      assetId,
      projectId,
      shotId,
      type: 'image',
      version: 1,
      uri: `https://assets.onecrew.local/${assetId}.png`,
      provider: 'import',
      model: 'local-mini-drama-project-1.4',
      source: 'integration fixture',
      license: 'MIT',
      contentHash: createInputHash({ assetId }),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    }]);

    expect(imported).toMatchObject({ projectId, episodes: 1, entities: 2, shots: 1, framePrompts: 1, assets: 1 });
    const restored = await repositories.creative.getBundle(projectId);
    expect(restored.episodes[0]).toMatchObject({ episodeId, title: '第一集' });
    expect(restored.entities.map((entity) => entity.kind).sort()).toEqual(['character', 'scene']);
    expect(restored.shots[0]).toMatchObject({ shotId, episodeId, sceneId });
    expect(restored.framePrompts[0]).toMatchObject({ framePromptId, frameType: 'first' });

    const versions = await repositories.creative.getRecordVersions(projectId);
    expect(versions).toMatchObject({ project: 1, episodes: { [episodeId]: 1 }, shots: { [shotId]: 1 } });
    const editedEpisode = await repositories.creative.updateEpisode(
      episodeId,
      1,
      { title: '第一集：星门开启', scriptContent: '角色跨过星门。' },
      { editId: `edit_episode_${suffix}`, actorOpenId: 'ou_studio_editor' },
    );
    expect(editedEpisode).toMatchObject({ value: { title: '第一集：星门开启' }, version: 2 });
    const editedShot = await repositories.creative.updateShot(
      shotId,
      1,
      { action: '角色跨过星门。', camera: '缓慢跟拍' },
      { editId: `edit_shot_${suffix}`, actorOpenId: 'ou_studio_editor' },
    );
    expect(editedShot).toMatchObject({ value: { action: '角色跨过星门。', camera: '缓慢跟拍' }, version: 2 });
    const editedEntity = await repositories.creative.updateEntity(
      sceneId,
      1,
      { name: '远古星门', atmosphere: '静谧而宏大', referenceAssetIds: [assetId] },
      { editId: `edit_entity_${suffix}`, actorOpenId: 'ou_studio_editor' },
    );
    expect(editedEntity).toMatchObject({
      value: { kind: 'scene', name: '远古星门', referenceAssetIds: [assetId] },
      version: 2,
    });
    await expect(
      repositories.creative.updateEntity(
        sceneId,
        2,
        { referenceAssetIds: [`asset_outside_${suffix}`] },
        { editId: `edit_entity_invalid_asset_${suffix}`, actorOpenId: 'ou_studio_editor' },
      ),
    ).rejects.toBeInstanceOf(InvalidCreativeAssetBindingError);
    await expect(
      repositories.creative.updateShot(
        shotId,
        1,
        { action: '这是一次过期编辑。' },
        { editId: `edit_shot_stale_${suffix}`, actorOpenId: 'ou_studio_editor' },
      ),
    ).rejects.toBeInstanceOf(VersionConflictError);
    const creativeAudit = await client.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.projectId, projectId));
    expect(creativeAudit.map((row) => row.action).sort()).toEqual([
      'update_creative_entity',
      'update_episode',
      'update_shot',
    ]);
    expect(creativeAudit.every((row) => row.source === 'creative_studio' && row.outcome === 'accepted')).toBe(true);
  });

  it('persists a project and enforces legal, optimistic transitions', async () => {
    const projectId = `prj_repo_${suffix}`;
    const project = projectSpecSchema.parse({
      projectId,
      nameZh: '仓储测试',
      nameEn: 'Repository Test',
      synopsis: '验证真实 PostgreSQL 仓储与状态机。',
      audience: '开发测试',
      genres: ['test'],
      ownerOpenId: 'ou_test_owner',
      locales: ['zh-CN', 'en-US'],
      aspectRatios: ['16:9'],
      budgetLimitCny: 1,
      status: 'draft',
    });

    const created = await repositories.projects.create(project);
    expect(created).toMatchObject({ value: { projectId, status: 'draft' }, version: 1 });

    const running = await repositories.projects.transition(projectId, 1, 'running');
    expect(running).toMatchObject({ value: { status: 'running' }, version: 2 });

    await expect(repositories.projects.transition(projectId, 1, 'failed')).rejects.toBeInstanceOf(
      VersionConflictError,
    );
    await expect(repositories.projects.transition(projectId, 2, 'draft')).rejects.toBeInstanceOf(
      InvalidStateTransitionError,
    );
  });

  it('reserves, completes, and safely replays idempotent requests', async () => {
    const scope = 'integration:create-project';
    const key = `idem_${suffix}`;
    const requestHash = createInputHash({ name: 'same request' });

    await expect(repositories.idempotency.reserve(scope, key, requestHash)).resolves.toEqual({
      state: 'reserved',
    });
    await expect(repositories.idempotency.reserve(scope, key, requestHash)).resolves.toEqual({
      state: 'in_progress',
    });

    await repositories.idempotency.complete(scope, key, requestHash, {
      response: { ok: true },
      resourceType: 'project',
      resourceId: `prj_${suffix}`,
    });

    await expect(repositories.idempotency.reserve(scope, key, requestHash)).resolves.toMatchObject({
      state: 'replayed',
      response: { ok: true },
      resourceType: 'project',
      resourceId: `prj_${suffix}`,
    });
    await expect(
      repositories.idempotency.reserve(scope, key, createInputHash({ name: 'different request' })),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('persists Shot, Asset, Job, QC, and Render contracts with their state machines', async () => {
    const now = new Date().toISOString();
    const projectId = `prj_entities_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '全实体测试',
        nameEn: 'All Entity Test',
        synopsis: '验证所有阶段一核心实体。',
        audience: '开发测试',
        genres: ['test'],
        ownerOpenId: 'ou_test_owner',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9', '9:16'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );

    const shotId = `shot_entities_${suffix}`;
    const shot = await repositories.shots.create({
      shotId,
      projectId,
      sequence: 1,
      durationSec: 6,
      characters: ['char_test'],
      sceneId: 'scene_test',
      action: '主角抬头看见星门。',
      camera: '缓慢推近',
      dialogueZh: '出发。',
      prompt: 'cinematic stargate',
      referenceAssetIds: [],
      importance: 'hero',
      closeupDialogue: true,
      status: 'planned',
    });
    await expect(repositories.shots.transition(shotId, shot.version, 'generating')).resolves.toMatchObject({
      value: { status: 'generating' },
      version: 2,
    });

    const assetId = `asset_entities_${suffix}`;
    const asset = await repositories.assets.create({
      assetId,
      projectId,
      shotId,
      type: 'video',
      version: 1,
      uri: `https://assets.onecrew.local/${assetId}.mp4`,
      provider: 'mock-video-primary',
      model: 'mock-v1',
      source: 'generated by deterministic integration fixture',
      license: 'OneCrew test fixture',
      contentHash: createInputHash({ assetId, version: 1 }),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    });
    await expect(repositories.assets.transition(assetId, asset.version, 'approved')).resolves.toMatchObject({
      value: { status: 'approved' },
      version: 2,
    });

    const jobId = `job_entities_${suffix}`;
    const job = await repositories.jobs.create(
      {
        jobId,
        projectId,
        shotId,
        capability: 'video',
        provider: 'mock-video-primary',
        model: 'mock-v1',
        mode: 'mock',
        status: 'queued',
        attempt: 1,
        estimatedCostCny: 0,
        actualCostCny: 0,
        inputHash: createInputHash({ shotId, capability: 'video' }),
        outputAssetIds: [],
        createdAt: now,
        updatedAt: now,
      },
      `video:${shotId}:v1`,
    );
    const runningJob = await repositories.jobs.transition(jobId, job.version, 'running');
    const waitingJob = await repositories.jobs.transition(jobId, runningJob.version, 'waiting_human');
    await expect(repositories.jobs.transition(jobId, waitingJob.version, 'queued')).resolves.toMatchObject({
      value: { status: 'queued' },
      version: 4,
    });

    const batchId = `batch_entities_${suffix}`;
    const generationBatch = creativeGenerationBatchSchema.parse({
      batchId,
      projectId,
      kind: 'video',
      status: 'running',
      missingOnly: true,
      route: 'primary',
      generationNonce: 1,
      concurrency: 3,
      items: [{
        shotId,
        expectedVersion: 2,
        status: 'queued',
        jobId,
        mode: 'mock',
        provider: 'mock-video-primary',
        estimatedCostCny: 0,
        outputAssetIds: [],
        retryCount: 0,
      }],
      inputHash: createInputHash({ projectId, kind: 'video', shotId }),
      createdAt: now,
      updatedAt: now,
    });
    const createdBatch = await repositories.creativeGenerationBatches.create(
      generationBatch,
      `batch:${projectId}:video`,
    );
    await expect(
      repositories.creativeGenerationBatches.getByIdempotency(projectId, `batch:${projectId}:video`),
    ).resolves.toMatchObject({ value: { batchId, status: 'running' }, version: 1 });
    await expect(repositories.creativeGenerationBatches.latestForProject(projectId)).resolves.toMatchObject({
      value: { batchId },
      version: 1,
    });
    await expect(
      repositories.creativeGenerationBatches.replace(batchId, createdBatch.version, {
        ...generationBatch,
        status: 'cancelled',
        items: generationBatch.items.map((item) => ({ ...item, status: 'cancelled' as const })),
        updatedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ value: { status: 'cancelled' }, version: 2 });

    await expect(
      repositories.qc.create({
        qcId: `qc_entities_${suffix}`,
        projectId,
        shotId,
        scores: {
          character: 0.95,
          clothing: 0.94,
          background: 0.93,
          action: 0.92,
          flicker: 0.4,
          lipsync: 0.9,
          subtitle: 0.99,
          brand: 0.97,
          safeArea: 0.98,
          audio: 0.96,
          compliance: 1,
        },
        decision: 'regenerate',
        reason: '故意注入的闪烁分数低于阈值。',
        retryPatch: { negative_prompt_append: 'facial flicker' },
        createdAt: now,
      }),
    ).resolves.toMatchObject({ decision: 'regenerate' });

    const renderId = `render_entities_${suffix}`;
    const manifest = {
      renderId,
      projectId,
      compositionId: 'EpisodeMaster' as const,
      locale: 'zh-CN' as const,
      aspectRatio: '16:9' as const,
      fps: 30 as const,
      designPack: {
        designSystemId: 'design_shanhai_demo',
        version: '1.0.0',
        designMdUri: 'https://assets.onecrew.local/design/DESIGN.md',
        brandTokensUri: 'https://assets.onecrew.local/design/brand.tokens.json',
        motionTokensUri: 'https://assets.onecrew.local/design/motion.tokens.json',
        promoSpecUri: 'https://assets.onecrew.local/design/promo.spec.json',
        assetUris: ['https://assets.onecrew.local/design/logo.svg'],
        source: 'open-design' as const,
        sourceLicense: 'OneCrew test fixture',
        createdAt: now,
      },
      localePack: {
        projectId,
        locale: 'zh-CN' as const,
        title: '全实体测试',
        lines: [
          {
            lineId: `line_entities_${suffix}`,
            shotId,
            speaker: '测试角色',
            text: '出发。',
            startMs: 0,
            endMs: 1_000,
            voiceId: 'voice_test',
          },
        ],
        cta: '立即观看',
        marketingCopy: ['星门已经开启。'],
      },
      shots: [
        {
          shotId,
          videoUri: `https://assets.onecrew.local/${assetId}.mp4`,
          inFrame: 0,
          outFrame: 180,
        },
      ],
      output: { codec: 'h264' as const, width: 1920, height: 1080 },
    };
    const render = await repositories.renders.create({
      renderId,
      projectId,
      manifest,
      renderMode: 'preview',
      status: 'queued',
      manifestHash: createInputHash(manifest),
      designPackVersion: '1.0.0',
      codeVersion: 'integration-test',
      createdAt: now,
      updatedAt: now,
    });
    const runningRender = await repositories.renders.transition(renderId, render.version, 'running');
    await expect(
      repositories.renders.transition(renderId, runningRender.version, 'succeeded'),
    ).resolves.toMatchObject({ value: { status: 'succeeded' }, version: 3 });
  });
});
