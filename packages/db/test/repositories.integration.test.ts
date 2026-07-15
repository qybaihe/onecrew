import { loadEnv } from '@onecrew/config';
import { creativeProjectBundleSchema, projectSpecSchema } from '@onecrew/contracts';
import { createInputHash, InvalidStateTransitionError, VersionConflictError } from '@onecrew/domain';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/client.js';
import {
  createRepositories,
  IdempotencyConflictError,
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
    expect(creativeAudit.map((row) => row.action).sort()).toEqual(['update_episode', 'update_shot']);
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
