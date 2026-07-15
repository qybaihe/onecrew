import {
  imageProviderRequestSchema,
  videoProviderRequestSchema,
  type AssetRecord,
  type CreativeProjectBundle,
  type ImageProviderRequest,
  type ProviderRoute,
  type ShotSpec,
  type VideoProviderRequest,
} from '@onecrew/contracts';

export type CreativeShotGenerationKind = 'image' | 'video';

export interface CreativeShotGenerationInput {
  bundle: CreativeProjectBundle;
  assets: AssetRecord[];
  shotId: string;
  kind: CreativeShotGenerationKind;
  route?: ProviderRoute;
  generationNonce: number;
}

function findShot(bundle: CreativeProjectBundle, shotId: string): ShotSpec {
  const shot = bundle.shots.find((candidate) => candidate.shotId === shotId);
  if (!shot) throw new Error(`Creative shot not found in project ${bundle.project.projectId}: ${shotId}`);
  return shot;
}

function dimensions(aspectRatio: CreativeProjectBundle['project']['aspectRatios'][number]) {
  if (aspectRatio === '9:16') return { width: 576, height: 1_024 };
  if (aspectRatio === '1:1') return { width: 1_024, height: 1_024 };
  return { width: 1_024, height: 576 };
}

function promptWithContinuity(basePrompt: string, shot: ShotSpec): string {
  if (!shot.continuity) return basePrompt;
  const continuity = JSON.stringify({
    characters: shot.continuity.characters,
    ...(shot.continuity.lighting ? { lighting: shot.continuity.lighting } : {}),
    ...(shot.continuity.cameraAxis ? { cameraAxis: shot.continuity.cameraAxis } : {}),
    ...(shot.continuity.notes ? { notes: shot.continuity.notes } : {}),
  });
  const separator = '\n\nContinuity constraints: ';
  if (basePrompt.length + separator.length >= 20_000) return basePrompt.slice(0, 20_000);
  return `${basePrompt}${separator}${continuity.slice(0, 20_000 - basePrompt.length - separator.length)}`;
}

function latestShotImage(
  assets: AssetRecord[],
  projectId: string,
  shotId: string,
  excludedAssetId?: string,
): AssetRecord | undefined {
  return assets
    .filter((asset) =>
      asset.projectId === projectId &&
      asset.shotId === shotId &&
      asset.type === 'image' &&
      asset.assetId !== excludedAssetId,
    )
    .sort((left, right) => right.version - left.version)[0];
}

function referenceAssetIds(bundle: CreativeProjectBundle, shot: ShotSpec): string[] {
  const previousShot = bundle.shots
    .filter((candidate) => candidate.episodeId === shot.episodeId && candidate.sequence < shot.sequence)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const entityIds = new Set([shot.sceneId, ...shot.characters, ...(shot.propIds ?? [])]);
  const entityReferences = bundle.entities
    .filter((entity) => entityIds.has(entity.entityId))
    .flatMap((entity) => entity.referenceAssetIds);
  return [
    ...(previousShot?.lastFrameAssetId ? [previousShot.lastFrameAssetId] : []),
    ...(shot.firstFrameAssetId ? [shot.firstFrameAssetId] : []),
    ...shot.referenceAssetIds,
    ...entityReferences,
  ];
}

function assetUris(assets: AssetRecord[], projectId: string, assetIds: string[]): string[] {
  const byId = new Map(
    assets.filter((asset) => asset.projectId === projectId).map((asset) => [asset.assetId, asset] as const),
  );
  return [...new Set(assetIds)].flatMap((assetId) => {
    const asset = byId.get(assetId);
    return asset ? [asset.uri] : [];
  });
}

export function buildCreativeShotGenerationRequest(
  input: CreativeShotGenerationInput,
): ImageProviderRequest | VideoProviderRequest {
  const shot = findShot(input.bundle, input.shotId);
  const project = input.bundle.project;
  const route = input.route ?? 'primary';
  const aspectRatio = project.aspectRatios[0] ?? '16:9';
  const byId = new Map(
    input.assets.filter((asset) => asset.projectId === project.projectId).map((asset) => [asset.assetId, asset] as const),
  );

  if (input.kind === 'image') {
    const size = dimensions(aspectRatio);
    return imageProviderRequestSchema.parse({
      capability: 'image',
      projectId: project.projectId,
      route,
      generationNonce: input.generationNonce,
      shotId: shot.shotId,
      prompt: promptWithContinuity(shot.polishedPrompt ?? shot.imagePrompt ?? shot.prompt, shot),
      ...(shot.negativePrompt ? { negativePrompt: shot.negativePrompt } : {}),
      referenceUris: assetUris(input.assets, project.projectId, referenceAssetIds(input.bundle, shot)).slice(0, 10),
      ...size,
      count: 1,
    });
  }

  const latestImage = latestShotImage(input.assets, project.projectId, shot.shotId, shot.lastFrameAssetId);
  const firstFrame = shot.firstFrameAssetId ? byId.get(shot.firstFrameAssetId) : undefined;
  const lastFrame = shot.lastFrameAssetId ? byId.get(shot.lastFrameAssetId) : undefined;
  return videoProviderRequestSchema.parse({
    capability: 'video',
    projectId: project.projectId,
    route,
    generationNonce: input.generationNonce,
    shotId: shot.shotId,
    prompt: promptWithContinuity(shot.videoPrompt ?? shot.polishedPrompt ?? shot.prompt, shot),
    ...(latestImage ?? firstFrame ? { referenceImageUri: (latestImage ?? firstFrame)!.uri } : {}),
    ...(lastFrame ? { lastFrameUri: lastFrame.uri } : {}),
    durationSec: Math.min(30, Math.max(1, Math.round(shot.durationSec))),
    aspectRatio,
  });
}
