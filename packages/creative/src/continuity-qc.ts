import {
  qcRunRequestSchema,
  type AssetRecord,
  type CreativeEntity,
  type CreativeProjectBundle,
  type ProviderRoute,
  type QcRunRequest,
  type ShotSpec,
} from '@onecrew/contracts';

export interface CreativeContinuityQcInput {
  bundle: CreativeProjectBundle;
  assets: AssetRecord[];
  shotId: string;
  assetId?: string;
  route?: ProviderRoute;
  qualityAttempt?: number;
  autoRemediate?: boolean;
}

export class CreativeContinuityQcAssetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeContinuityQcAssetError';
  }
}

function trim(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximum);
}

function findShot(bundle: CreativeProjectBundle, shotId: string): ShotSpec {
  const shot = bundle.shots.find((candidate) => candidate.shotId === shotId);
  if (!shot) throw new CreativeContinuityQcAssetError(`Creative shot not found: ${shotId}`);
  return shot;
}

function controlledShotAssets(assets: AssetRecord[], projectId: string, shotId: string): AssetRecord[] {
  return assets
    .filter((asset) =>
      asset.projectId === projectId &&
      asset.shotId === shotId &&
      (asset.type === 'image' || asset.type === 'video') &&
      asset.uri.startsWith('s3://') &&
      asset.status !== 'archived',
    )
    .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt));
}

function selectAsset(input: CreativeContinuityQcInput, shot: ShotSpec): AssetRecord {
  const projectId = input.bundle.project.projectId;
  if (input.assetId) {
    const selected = input.assets.find((asset) => asset.assetId === input.assetId);
    if (!selected || selected.projectId !== projectId || selected.shotId !== shot.shotId) {
      throw new CreativeContinuityQcAssetError(
        `QC asset ${input.assetId} is not bound to shot ${shot.shotId}`,
      );
    }
    if (selected.type !== 'image' && selected.type !== 'video') {
      throw new CreativeContinuityQcAssetError(`QC asset ${input.assetId} must be image or video`);
    }
    if (!selected.uri.startsWith('s3://')) {
      throw new CreativeContinuityQcAssetError(
        `QC asset ${input.assetId} is not materialized in the controlled media store`,
      );
    }
    return selected;
  }
  const selected = controlledShotAssets(input.assets, projectId, shot.shotId)[0];
  if (!selected) {
    throw new CreativeContinuityQcAssetError(
      `Shot ${shot.shotId} has no image or video materialized in the controlled media store`,
    );
  }
  return selected;
}

function namedEntity(bundle: CreativeProjectBundle, entityId: string): CreativeEntity | undefined {
  return bundle.entities.find((entity) => entity.entityId === entityId);
}

function entityDescription(entity: CreativeEntity | undefined): string | undefined {
  if (!entity) return undefined;
  if (entity.kind === 'character') {
    return [entity.name, entity.role, entity.appearance, entity.description].filter(Boolean).join('；');
  }
  if (entity.kind === 'scene') {
    return [entity.name, entity.location, entity.timeOfDay, entity.atmosphere, entity.lightingStyle, entity.description]
      .filter(Boolean)
      .join('；');
  }
  return [entity.name, entity.category, entity.description].filter(Boolean).join('；');
}

function addCriterion(criteria: string[], value: string | undefined): void {
  const normalized = trim(value, 500);
  if (normalized && !criteria.includes(normalized)) criteria.push(normalized);
}

function criteriaForShot(bundle: CreativeProjectBundle, shot: ShotSpec, mediaType: 'image' | 'video'): string[] {
  const criteria: string[] = [];
  addCriterion(criteria, `画面动作与分镜一致：${shot.action}`);
  addCriterion(criteria, `镜头语言与构图一致：${[shot.shotType, shot.camera, shot.movement].filter(Boolean).join('；')}`);

  for (const characterId of shot.characters) {
    const character = namedEntity(bundle, characterId);
    const state = shot.continuity?.characters[characterId];
    addCriterion(
      criteria,
      `角色身份与外观稳定：${entityDescription(character) ?? characterId}${state ? `；本镜状态 ${JSON.stringify(state)}` : ''}`,
    );
  }

  const scene = namedEntity(bundle, shot.sceneId);
  addCriterion(
    criteria,
    `场景与光照保持一致：${entityDescription(scene) ?? shot.sceneId}${shot.continuity?.lighting ? `；连续性光照 ${shot.continuity.lighting}` : ''}`,
  );

  for (const propId of shot.propIds ?? []) {
    addCriterion(criteria, `道具身份、位置和持有关系准确：${entityDescription(namedEntity(bundle, propId)) ?? propId}`);
  }

  if (shot.continuity?.sourceShotId) {
    const sourceShot = bundle.shots.find((candidate) => candidate.shotId === shot.continuity?.sourceShotId);
    addCriterion(
      criteria,
      `与上一镜 ${sourceShot?.title?.trim() || sourceShot?.shotId || shot.continuity.sourceShotId} 的尾帧在角色、场景、动作方向和光线方面自然衔接`,
    );
  }
  addCriterion(criteria, shot.continuity?.cameraAxis ? `不得越轴；镜头轴线约束：${shot.continuity.cameraAxis}` : undefined);
  addCriterion(criteria, shot.continuity?.notes ? `连续性备注必须满足：${shot.continuity.notes}` : undefined);
  addCriterion(criteria, shot.lightingStyle ? `本镜光照风格：${shot.lightingStyle}` : undefined);
  addCriterion(criteria, shot.atmosphere ? `本镜氛围：${shot.atmosphere}` : undefined);
  addCriterion(criteria, '不得出现无依据的角色、服装、场景、道具或画面风格漂移');
  if (mediaType === 'video') {
    addCriterion(criteria, '视频时间维度稳定：无闪烁、形变、身份跳变、背景跳变或镜头运动突变');
    if (shot.dialogueZh) addCriterion(criteria, `对白表演与口型、情绪一致：${shot.dialogueZh}`);
  }
  return criteria.slice(0, 50);
}

function sourceJobId(asset: AssetRecord): string | undefined {
  return asset.source.match(/^Provider Job ([A-Za-z0-9][A-Za-z0-9_-]*);/)?.[1];
}

function technicalExpectation(mediaType: 'image' | 'video', shot: ShotSpec): QcRunRequest['technical'] {
  if (mediaType === 'image') {
    return {
      requireAudio: false,
      allowedVideoCodecs: ['png', 'mjpeg', 'webp'],
      allowedAudioCodecs: ['aac', 'mp3'],
      allowedPixelFormats: ['rgb24', 'rgba', 'gray', 'pal8', 'yuv420p', 'yuvj420p', 'yuva420p'],
      durationToleranceSec: 0.35,
      maxBlackDurationSec: 0.75,
      maxFreezeDurationSec: 1.5,
      maxSilenceDurationSec: 2,
      maxBrightnessJump: 70,
      subtitleCues: [],
    };
  }
  return {
    durationSec: shot.durationSec,
    durationToleranceSec: Math.max(0.35, Math.min(2, shot.durationSec * 0.1)),
    requireAudio: false,
    allowedVideoCodecs: ['h264', 'hevc', 'vp9', 'av1'],
    allowedAudioCodecs: ['aac', 'mp3', 'opus'],
    allowedPixelFormats: ['yuv420p', 'yuvj420p', 'yuv420p10le'],
    maxBlackDurationSec: 0.75,
    maxFreezeDurationSec: 1.5,
    maxSilenceDurationSec: 2,
    maxBrightnessJump: 70,
    subtitleCues: [],
  };
}

export function buildCreativeContinuityQcRequest(input: CreativeContinuityQcInput): QcRunRequest {
  const shot = findShot(input.bundle, input.shotId);
  const asset = selectAsset(input, shot);
  const mediaType = asset.type as 'image' | 'video';
  const description = [
    `项目：${input.bundle.project.nameZh}`,
    `分镜：${shot.title?.trim() || `SHOT ${shot.sequence}`}`,
    `动作：${shot.action}`,
    `镜头：${shot.camera}`,
    shot.imagePrompt ? `图像提示词：${shot.imagePrompt}` : undefined,
    shot.videoPrompt ? `视频提示词：${shot.videoPrompt}` : undefined,
    shot.continuity ? `连续性快照：${JSON.stringify(shot.continuity)}` : undefined,
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 10_000);
  const jobId = sourceJobId(asset);

  return qcRunRequestSchema.parse({
    projectId: input.bundle.project.projectId,
    shotId: shot.shotId,
    sourceAssetId: asset.assetId,
    ...(jobId ? { sourceJobId: jobId } : {}),
    mediaUri: asset.uri,
    mediaType,
    expectedDescription: description,
    criteria: criteriaForShot(input.bundle, shot, mediaType),
    technical: technicalExpectation(mediaType, shot),
    route: input.route ?? 'primary',
    qualityAttempt: input.qualityAttempt ?? 1,
    autoRemediate: input.autoRemediate ?? true,
    remediation: 'generation',
  });
}
