import { createHash } from 'node:crypto';

import {
  creativeStoryPlanSchema,
  episodeSpecSchema,
  creativeEntitySchema,
  type CreativeEntity,
  type CreativeProjectBundle,
  type CreativeStoryPlan,
  type CreativeStoryPlanRequest,
  type EpisodeSpec,
  type LlmProviderRequest,
  type RegionalCulturePack,
} from '@onecrew/contracts';
import { z } from 'zod';

export interface CreativeStoryPlanGenerationInput {
  bundle: CreativeProjectBundle;
  request: CreativeStoryPlanRequest;
  culturePack?: RegionalCulturePack | undefined;
}

export interface CreativeStoryPlanMaterializationInput {
  bundle: CreativeProjectBundle;
  plan: CreativeStoryPlan;
  jobId: string;
}

export interface MaterializedCreativeStoryPlan {
  episodes: EpisodeSpec[];
  entities: CreativeEntity[];
}

export class CreativeStoryPlanValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeStoryPlanValidationError';
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase('zh-CN');
}

function storyPlanOutputSchema(): Record<string, unknown> {
  return {
    ...z.toJSONSchema(creativeStoryPlanSchema, { target: 'draft-2020-12' }),
    title: 'OneCrewCreativeStoryPlan',
  };
}

export function buildCreativeStoryPlanRequest(input: CreativeStoryPlanGenerationInput): LlmProviderRequest {
  const { project } = input.bundle;
  const existingEpisodes = input.bundle.episodes.map((episode) => ({
    episodeNumber: episode.episodeNumber,
    title: episode.title,
    description: episode.description ?? '',
  }));
  const existingEntities = input.bundle.entities.map((entity) => ({
    kind: entity.kind,
    name: entity.name,
    description: entity.description ?? '',
  }));
  const culturePack = input.culturePack;
  const cultureSection = culturePack
    ? [
        `目标出海地区：${culturePack.regionLabel}`,
        `地区受众画像：${culturePack.audienceProfile}`,
        `偏好题材：${culturePack.themes.join('、')}`,
        `核心精神面貌：${culturePack.spiritValues.join('、')}`,
        `禁忌规避：${culturePack.taboos.length > 0 ? culturePack.taboos.join('、') : '无'}`,
        `钩子结构：${culturePack.hookStructures.join('、')}`,
        `视觉符号：${culturePack.visualMotifs.join('、')}`,
        `参考案例：${culturePack.referenceCases.map((c) => `${c.title}——${c.whyItWorks}`).join('；')}`,
        '请严格按照以上地域文化包创作剧本、角色与场景，确保题材、精神面貌、视觉符号与参考案例一致，避免触碰禁忌。',
      ].join('\n')
    : undefined;
  const briefLine = culturePack
    ? `本次创作要求（已按地域文化包本土化）：${culturePack.localizedBrief}`
    : `本次创作要求：${input.request.brief}`;
  const prompt = [
    '你是 OneCrew 短剧总编剧与视觉设定师。请为现有项目追加新的剧集规划和可复用角色、场景、道具设定。',
    `必须输出 ${input.request.episodeCount} 集，严格遵循给定 JSON Schema，不要输出额外字段。`,
    '每集 scriptContent 必须是可继续拆分镜的完整中文剧本；所有 characterNames、sceneNames、propNames 必须精确引用输出设定或现有设定中的名称。',
    '避免重复现有实体；若沿用现有角色、场景或道具，请使用完全相同的名称。角色 appearance 与 identityAnchors 要能稳定支持后续图像连续性。',
    `项目：${project.nameZh} / ${project.nameEn}`,
    `项目简介：${project.synopsis}`,
    `受众：${project.audience}`,
    `类型：${project.genres.join('、')}`,
    project.style ? `风格：${project.style}` : '',
    cultureSection,
    briefLine,
    `现有剧集：${JSON.stringify(existingEpisodes)}`,
    `现有设定：${JSON.stringify(existingEntities)}`,
  ]
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 100_000);

  return {
    capability: 'llm',
    projectId: project.projectId,
    operation: 'script',
    prompt,
    locale: 'zh-CN',
    imageUris: [],
    outputSchema: storyPlanOutputSchema(),
    maxOutputTokens: Math.min(32_000, Math.max(4_000, input.request.episodeCount * 2_500)),
    route: input.request.route,
    generationNonce: input.request.generationNonce,
  };
}

function plannedEntityId(projectId: string, jobId: string, kind: CreativeEntity['kind'], name: string): string {
  return `${kind}_${hash(`${projectId}:${jobId}:${kind}:${normalizedName(name)}`).slice(0, 28)}`;
}

export function materializeCreativeStoryPlan(
  input: CreativeStoryPlanMaterializationInput,
): MaterializedCreativeStoryPlan {
  const plan = creativeStoryPlanSchema.parse(input.plan);
  const projectId = input.bundle.project.projectId;
  const source = {
    system: 'onecrew' as const,
    version: 'creative-story-plan-v1',
    reference: `Provider Job ${input.jobId}`,
    importedAt: new Date().toISOString(),
  };
  const entityIds = new Map<string, string>();
  for (const entity of input.bundle.entities) {
    entityIds.set(`${entity.kind}:${normalizedName(entity.name)}`, entity.entityId);
  }
  const entities: CreativeEntity[] = [];
  const addEntity = (entity: CreativeEntity) => {
    const key = `${entity.kind}:${normalizedName(entity.name)}`;
    if (entityIds.has(key)) return;
    entityIds.set(key, entity.entityId);
    entities.push(creativeEntitySchema.parse(entity));
  };

  for (const [index, character] of plan.characters.entries()) {
    addEntity({
      entityId: plannedEntityId(projectId, input.jobId, 'character', character.name),
      projectId,
      kind: 'character',
      name: character.name,
      description: [character.role, character.personality, character.appearance].filter(Boolean).join('；'),
      prompt: [character.appearance, ...character.identityAnchors].filter(Boolean).join('，'),
      role: character.role,
      personality: character.personality,
      appearance: character.appearance,
      voiceStyle: character.voiceStyle,
      identityAnchors: character.identityAnchors,
      referenceAssetIds: [],
      extraAssetIds: [],
      styleTokens: [],
      colorPalette: [],
      stages: [],
      sortOrder: index,
      status: 'draft',
      source,
    });
  }
  for (const [index, scene] of plan.scenes.entries()) {
    addEntity({
      entityId: plannedEntityId(projectId, input.jobId, 'scene', scene.name),
      projectId,
      kind: 'scene',
      name: scene.name,
      description: scene.description,
      location: scene.location,
      timeOfDay: scene.timeOfDay,
      atmosphere: scene.atmosphere,
      lightingStyle: scene.lightingStyle,
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: index,
      status: 'draft',
      source,
    });
  }
  for (const [index, prop] of plan.props.entries()) {
    addEntity({
      entityId: plannedEntityId(projectId, input.jobId, 'prop', prop.name),
      projectId,
      kind: 'prop',
      name: prop.name,
      description: prop.description,
      category: prop.category,
      prompt: prop.prompt,
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: index,
      status: 'draft',
      source,
    });
  }

  const resolveNames = (kind: CreativeEntity['kind'], names: string[], episodeTitle: string): string[] =>
    [...new Set(names.map((name) => {
      const entityId = entityIds.get(`${kind}:${normalizedName(name)}`);
      if (!entityId) {
        throw new CreativeStoryPlanValidationError(
          `Episode ${episodeTitle} references missing ${kind}: ${name}`,
        );
      }
      return entityId;
    }))];
  const startingEpisode = Math.max(0, ...input.bundle.episodes.map((episode) => episode.episodeNumber));
  const episodes = plan.episodes.map((episode, index) => episodeSpecSchema.parse({
    episodeId: `episode_${hash(`${projectId}:${input.jobId}:${index + 1}:${episode.title}`).slice(0, 28)}`,
    projectId,
    episodeNumber: startingEpisode + index + 1,
    title: episode.title,
    description: episode.synopsis,
    scriptContent: episode.scriptContent,
    durationSec: episode.durationSec,
    characterIds: resolveNames('character', episode.characterNames, episode.title),
    sceneIds: resolveNames('scene', episode.sceneNames, episode.title),
    propIds: resolveNames('prop', episode.propNames, episode.title),
    status: 'planning',
    source,
  }));
  return { episodes, entities };
}
