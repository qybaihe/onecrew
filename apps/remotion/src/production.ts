import {
  localePackSchema,
  type AssetRecord,
  type CreativeProjectBundle,
  type GeneratedAudio,
  type LocalePack,
  type RenderManifest,
  type ShotSpec,
} from '@onecrew/contracts';

export class EpisodeAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpisodeAssemblyError';
  }
}

export interface EpisodeVideoSelection {
  shot: ShotSpec;
  asset: AssetRecord;
}

export interface SourceDialogueAudio {
  shotId: string;
  speaker: string;
  text: string;
  voiceId: string;
  audio: GeneratedAudio & { durationMs: number };
}

function latestVideo(assets: AssetRecord[], projectId: string, shotId: string): AssetRecord | undefined {
  return assets
    .filter(
      (asset) =>
        asset.projectId === projectId &&
        asset.shotId === shotId &&
        asset.type === 'video' &&
        asset.status !== 'archived' &&
        asset.status !== 'rejected',
    )
    .sort(
      (left, right) =>
        right.version - left.version || right.createdAt.localeCompare(left.createdAt),
    )[0];
}

export function selectEpisodeVideoAssets(
  bundle: CreativeProjectBundle,
  assets: AssetRecord[],
  episodeId: string,
): EpisodeVideoSelection[] {
  const episode = bundle.episodes.find((candidate) => candidate.episodeId === episodeId);
  if (!episode) throw new EpisodeAssemblyError(`Episode not found in project: ${episodeId}`);
  const allowUnassigned = bundle.episodes.length === 1;
  const shots = bundle.shots
    .filter((shot) => shot.episodeId === episodeId || (allowUnassigned && !shot.episodeId))
    .sort((left, right) => left.sequence - right.sequence);
  if (shots.length === 0) throw new EpisodeAssemblyError(`Episode ${episodeId} has no shots`);
  const missing: string[] = [];
  const selected = shots.flatMap((shot) => {
    const asset = latestVideo(assets, bundle.project.projectId, shot.shotId);
    if (!asset) {
      missing.push(shot.shotId);
      return [];
    }
    return [{ shot, asset }];
  });
  if (missing.length > 0) {
    throw new EpisodeAssemblyError(
      `Episode ${episodeId} is missing generated video assets for ${missing.length} shot(s): ${missing.join(', ')}`,
    );
  }
  return selected;
}

export function buildEpisodeRenderShots(
  selections: EpisodeVideoSelection[],
  durationSecondsByAssetId: ReadonlyMap<string, number>,
  fps = 30,
): RenderManifest['shots'] {
  let cursor = 0;
  const timeline = selections.map(({ shot, asset }) => {
    const sourceDurationSec = durationSecondsByAssetId.get(asset.assetId);
    if (!sourceDurationSec || !Number.isFinite(sourceDurationSec)) {
      throw new EpisodeAssemblyError(`Missing probed duration for ${asset.assetId}`);
    }
    const timelineDuration = Math.max(1, Math.round(shot.durationSec * fps));
    const sourceDuration = Math.floor(sourceDurationSec * fps);
    const toleranceFrames = Math.ceil(fps * 0.25);
    if (sourceDuration + toleranceFrames < timelineDuration) {
      throw new EpisodeAssemblyError(
        `Video ${asset.assetId} is ${sourceDurationSec.toFixed(2)}s but shot ${shot.shotId} requires ${shot.durationSec.toFixed(2)}s; regenerate a longer source instead of looping or stretching it`,
      );
    }
    const inFrame = cursor;
    const outFrame = inFrame + timelineDuration;
    cursor = outFrame;
    return {
      shotId: shot.shotId,
      videoUri: asset.uri,
      inFrame,
      outFrame,
      sourceStartFrame: 0,
      sourceEndFrame: timelineDuration,
      crop: { x: 0.5, y: 0.5, scale: 1.04 },
    };
  });
  const durationSec = cursor / fps;
  if (durationSec < 60 || durationSec > 90) {
    throw new EpisodeAssemblyError(
      `Episode timeline is ${durationSec.toFixed(2)}s; production episodes must contain 60-90s of real shot material`,
    );
  }
  const durationByHash = new Map<string, number>();
  for (const [index, selection] of selections.entries()) {
    const shot = timeline[index]!;
    const duration = shot.outFrame - shot.inFrame;
    durationByHash.set(
      selection.asset.contentHash,
      (durationByHash.get(selection.asset.contentHash) ?? 0) + duration,
    );
  }
  const minimumDistinctAssets = Math.max(4, Math.ceil(durationSec / 15));
  if (durationByHash.size < minimumDistinctAssets) {
    throw new EpisodeAssemblyError(
      `Episode requires at least ${minimumDistinctAssets} distinct video contents; received ${durationByHash.size}. Generate the missing story shots instead of duplicating files`,
    );
  }
  const largestContentRatio = Math.max(...durationByHash.values()) / cursor;
  if (largestContentRatio > 0.35) {
    throw new EpisodeAssemblyError(
      `One video content occupies ${(largestContentRatio * 100).toFixed(1)}% of the episode; maximum is 35%`,
    );
  }
  return timeline;
}

export function buildSourceLocalePack(input: {
  projectId: string;
  title: string;
  cta: string;
  marketingCopy: string[];
  shots: RenderManifest['shots'];
  dialogue: SourceDialogueAudio[];
  fps?: number;
  leadInMs?: number;
  tailMs?: number;
}): LocalePack {
  const fps = input.fps ?? 30;
  const leadInMs = input.leadInMs ?? 350;
  const tailMs = input.tailMs ?? 350;
  const shotsById = new Map(input.shots.map((shot) => [shot.shotId, shot] as const));
  const lines = input.dialogue.map((dialogue, index) => {
    const shot = shotsById.get(dialogue.shotId);
    if (!shot) throw new EpisodeAssemblyError(`Dialogue references unknown shot ${dialogue.shotId}`);
    const startMs = Math.round((shot.inFrame / fps) * 1_000 + leadInMs);
    const shotEndMs = Math.round((shot.outFrame / fps) * 1_000 - tailMs);
    const endMs = startMs + dialogue.audio.durationMs;
    if (endMs > shotEndMs) {
      throw new EpisodeAssemblyError(
        `Dialogue for ${dialogue.shotId} ends ${endMs - shotEndMs}ms after its shot; shorten the line or regenerate a longer shot`,
      );
    }
    return {
      lineId: `line_zh_${String(index + 1).padStart(3, '0')}`,
      shotId: dialogue.shotId,
      speaker: dialogue.speaker,
      text: dialogue.text,
      startMs,
      endMs,
      voiceId: dialogue.voiceId,
      audioUri: dialogue.audio.uri,
      audioDurationMs: dialogue.audio.durationMs,
    };
  });
  return localePackSchema.parse({
    projectId: input.projectId,
    locale: 'zh-CN',
    version: 1,
    sourceLocale: 'zh-CN',
    translationMode: 'source',
    title: input.title,
    lines,
    cta: input.cta,
    marketingCopy: input.marketingCopy,
  });
}
