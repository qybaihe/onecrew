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

const MAX_PROMPT_LENGTH = 20_000;

function continuitySection(shot: ShotSpec): string {
  if (!shot.continuity) return '';
  const continuity = JSON.stringify({
    characters: shot.continuity.characters,
    ...(shot.continuity.lighting ? { lighting: shot.continuity.lighting } : {}),
    ...(shot.continuity.cameraAxis ? { cameraAxis: shot.continuity.cameraAxis } : {}),
    ...(shot.continuity.notes ? { notes: shot.continuity.notes } : {}),
  });
  return `\n\nContinuity constraints: ${continuity}`;
}

function promptWithSections(basePrompt: string, sections: string[]): string {
  const suffix = sections.join('');
  if (suffix.length >= MAX_PROMPT_LENGTH) return suffix.slice(0, MAX_PROMPT_LENGTH);
  return `${basePrompt.slice(0, MAX_PROMPT_LENGTH - suffix.length)}${suffix}`;
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

interface CreativeReferenceCandidate {
  assetId: string;
  label: string;
}

interface CreativeResolvedReference extends CreativeReferenceCandidate {
  uri: string;
}

const entityKindLabels = {
  character: '角色',
  scene: '场景',
  prop: '道具',
} as const;

function referenceCandidates(bundle: CreativeProjectBundle, shot: ShotSpec): CreativeReferenceCandidate[] {
  const previousShot = bundle.shots
    .filter((candidate) => candidate.episodeId === shot.episodeId && candidate.sequence < shot.sequence)
    .sort((left, right) => right.sequence - left.sequence)[0];
  const candidates: CreativeReferenceCandidate[] = [
    ...(previousShot?.lastFrameAssetId
      ? [{ assetId: previousShot.lastFrameAssetId, label: '上一镜尾帧' }]
      : []),
    ...(shot.firstFrameAssetId
      ? [{ assetId: shot.firstFrameAssetId, label: '本镜首帧' }]
      : []),
    ...shot.referenceAssetIds.map((assetId, index) => ({
      assetId,
      label: `分镜参考 ${index + 1}`,
    })),
  ];
  const entitiesById = new Map(bundle.entities.map((entity) => [entity.entityId, entity] as const));
  const orderedEntityIds = [...shot.characters, shot.sceneId, ...(shot.propIds ?? [])];
  for (const entityId of orderedEntityIds) {
    const entity = entitiesById.get(entityId);
    if (!entity) continue;
    const kindLabel = entityKindLabels[entity.kind];
    candidates.push(
      ...entity.referenceAssetIds.map((assetId, index) => ({
        assetId,
        label: `${kindLabel}「${entity.name}」主参考 ${index + 1}`,
      })),
      ...entity.extraAssetIds.map((assetId, index) => ({
        assetId,
        label: `${kindLabel}「${entity.name}」补充参考 ${index + 1}`,
      })),
    );
  }
  return candidates;
}

function resolveReferences(
  assets: AssetRecord[],
  projectId: string,
  candidates: CreativeReferenceCandidate[],
): CreativeResolvedReference[] {
  const byId = new Map(
    assets.filter((asset) => asset.projectId === projectId).map((asset) => [asset.assetId, asset] as const),
  );
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    if (seen.has(candidate.assetId)) return [];
    seen.add(candidate.assetId);
    const asset = byId.get(candidate.assetId);
    return asset ? [{ ...candidate, uri: asset.uri }] : [];
  }).slice(0, 10);
}

function referenceMapSection(references: CreativeResolvedReference[]): string {
  if (references.length === 0) return '';
  return `\n\nReference image map (keep exact order):\n${references
    .map((reference, index) => `@图片${index + 1}：${reference.label}`)
    .join('\n')}`;
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
    const references = resolveReferences(
      input.assets,
      project.projectId,
      referenceCandidates(input.bundle, shot),
    );
    return imageProviderRequestSchema.parse({
      capability: 'image',
      projectId: project.projectId,
      route,
      generationNonce: input.generationNonce,
      shotId: shot.shotId,
      prompt: promptWithSections(shot.polishedPrompt ?? shot.imagePrompt ?? shot.prompt, [
        continuitySection(shot),
        referenceMapSection(references),
      ]),
      ...(shot.negativePrompt ? { negativePrompt: shot.negativePrompt } : {}),
      referenceUris: references.map((reference) => reference.uri),
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
    prompt: promptWithSections(shot.videoPrompt ?? shot.polishedPrompt ?? shot.prompt, [continuitySection(shot)]),
    ...(latestImage ?? firstFrame ? { referenceImageUri: (latestImage ?? firstFrame)!.uri } : {}),
    ...(lastFrame ? { lastFrameUri: lastFrame.uri } : {}),
    durationSec: Math.min(30, Math.max(1, Math.round(shot.durationSec))),
    aspectRatio,
  });
}
