import {
  compositionIdSchema,
  renderManifestSchema,
  type AspectRatio,
  type CompositionId,
  type RenderManifest,
} from '@onecrew/contracts';

import type { RemotionInputProps } from './types.js';

const allowedAspects: Record<CompositionId, readonly AspectRatio[]> = {
  EpisodeMaster: ['16:9', '9:16'],
  EpisodeLocalized: ['16:9', '9:16'],
  Trailer30: ['16:9', '9:16'],
  Teaser15Vertical: ['9:16'],
  Bumper6: ['9:16', '1:1'],
  MotionPoster: ['9:16', '1:1'],
  PipelineSmoke: ['16:9', '9:16', '1:1'],
};

const fixedDurationSeconds: Partial<Record<CompositionId, number>> = {
  Trailer30: 30,
  Teaser15Vertical: 15,
  Bumper6: 6,
};

export class InvalidRenderManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRenderManifestError';
  }
}

function expectedRatio(aspectRatio: AspectRatio): number {
  if (aspectRatio === '16:9') return 16 / 9;
  if (aspectRatio === '9:16') return 9 / 16;
  return 1;
}

function isEpisode(manifest: RenderManifest): boolean {
  return manifest.compositionId === 'EpisodeMaster' || manifest.compositionId === 'EpisodeLocalized';
}

function canonicalMediaIdentity(uri: string): string {
  const parsed = new URL(uri);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

function coveredMilliseconds(lines: RenderManifest['localePack']['lines']): number {
  const intervals = lines
    .map((line) => [line.startMs, line.endMs] as const)
    .sort((left, right) => left[0] - right[0]);
  let covered = 0;
  let start: number | undefined;
  let end: number | undefined;
  for (const [nextStart, nextEnd] of intervals) {
    if (start === undefined || end === undefined) {
      start = nextStart;
      end = nextEnd;
    } else if (nextStart <= end) {
      end = Math.max(end, nextEnd);
    } else {
      covered += end - start;
      start = nextStart;
      end = nextEnd;
    }
  }
  return covered + (start === undefined || end === undefined ? 0 : end - start);
}

function longestDialogueGapMilliseconds(
  lines: RenderManifest['localePack']['lines'],
  durationMs: number,
): number {
  const intervals = lines
    .map((line) => [line.startMs, line.endMs] as const)
    .sort((left, right) => left[0] - right[0]);
  let cursor = 0;
  let longest = 0;
  for (const [start, end] of intervals) {
    longest = Math.max(longest, start - cursor);
    cursor = Math.max(cursor, end);
  }
  return Math.max(longest, durationMs - cursor);
}

export interface ManifestContentQuality {
  durationSec: number;
  distinctAssetCount: number;
  minimumDistinctAssetCount: number;
  duplicateAssetShotRatio: number;
  largestAssetTimelineRatio: number;
  dialogueDensity: number;
  dialogueShotCoverage: number;
  longestDialogueGapSec: number;
}

export function analyzeManifestContent(manifest: RenderManifest): ManifestContentQuality {
  const durationFrames = Math.max(...manifest.shots.map((shot) => shot.outFrame));
  const durationSec = durationFrames / manifest.fps;
  const durationByAsset = new Map<string, number>();
  for (const shot of manifest.shots) {
    const identity = canonicalMediaIdentity(shot.videoUri);
    durationByAsset.set(identity, (durationByAsset.get(identity) ?? 0) + shot.outFrame - shot.inFrame);
  }
  const distinctAssetCount = durationByAsset.size;
  const lineShotIds = new Set(manifest.localePack.lines.map((line) => line.shotId));
  return {
    durationSec,
    distinctAssetCount,
    minimumDistinctAssetCount: Math.max(4, Math.ceil(durationSec / 15)),
    duplicateAssetShotRatio: 1 - distinctAssetCount / manifest.shots.length,
    largestAssetTimelineRatio:
      Math.max(0, ...durationByAsset.values()) / Math.max(1, durationFrames),
    dialogueDensity:
      coveredMilliseconds(manifest.localePack.lines) / Math.max(1, durationSec * 1_000),
    dialogueShotCoverage: lineShotIds.size / manifest.shots.length,
    longestDialogueGapSec:
      longestDialogueGapMilliseconds(manifest.localePack.lines, durationSec * 1_000) / 1_000,
  };
}

function validateEpisodeContent(manifest: RenderManifest): void {
  const sortedShots = [...manifest.shots].sort((left, right) => left.inFrame - right.inFrame);
  if (sortedShots[0]?.inFrame !== 0) {
    throw new InvalidRenderManifestError('Episode timeline must start at frame 0');
  }
  for (let index = 1; index < sortedShots.length; index += 1) {
    if (sortedShots[index]!.inFrame !== sortedShots[index - 1]!.outFrame) {
      throw new InvalidRenderManifestError(
        `Episode timeline must be contiguous between ${sortedShots[index - 1]!.shotId} and ${sortedShots[index]!.shotId}`,
      );
    }
  }
  for (const shot of sortedShots) {
    if (shot.sourceStartFrame === undefined || shot.sourceEndFrame === undefined) continue;
    const sourceDuration = shot.sourceEndFrame - shot.sourceStartFrame;
    const timelineDuration = shot.outFrame - shot.inFrame;
    const playbackRate = sourceDuration / timelineDuration;
    if (playbackRate < 0.8) {
      throw new InvalidRenderManifestError(
        `Shot ${shot.shotId} would stretch source media by more than 25%; regenerate a longer localized source`,
      );
    }
  }
  const quality = analyzeManifestContent(manifest);
  if (quality.distinctAssetCount < quality.minimumDistinctAssetCount) {
    throw new InvalidRenderManifestError(
      `Episode requires at least ${quality.minimumDistinctAssetCount} distinct video assets; received ${quality.distinctAssetCount}`,
    );
  }
  if (quality.duplicateAssetShotRatio > 0.4) {
    throw new InvalidRenderManifestError(
      `Episode duplicate-asset shot ratio ${(quality.duplicateAssetShotRatio * 100).toFixed(1)}% exceeds 40%`,
    );
  }
  if (quality.largestAssetTimelineRatio > 0.35) {
    throw new InvalidRenderManifestError(
      `A single video asset occupies ${(quality.largestAssetTimelineRatio * 100).toFixed(1)}% of the episode; maximum is 35%`,
    );
  }
  if (quality.dialogueDensity < 0.12) {
    throw new InvalidRenderManifestError(
      `Episode dialogue density ${(quality.dialogueDensity * 100).toFixed(1)}% is below the 12% minimum`,
    );
  }
  const minimumDialogueShots = Math.min(
    manifest.shots.length,
    Math.max(3, Math.ceil(manifest.shots.length * 0.3)),
  );
  const dialogueShotCount = new Set(manifest.localePack.lines.map((line) => line.shotId)).size;
  if (dialogueShotCount < minimumDialogueShots) {
    throw new InvalidRenderManifestError(
      `Episode dialogue must cover at least ${minimumDialogueShots} shots; received ${dialogueShotCount}`,
    );
  }
  const maximumGapSec = Math.max(18, quality.durationSec * 0.35);
  if (quality.longestDialogueGapSec > maximumGapSec) {
    throw new InvalidRenderManifestError(
      `Episode contains a ${quality.longestDialogueGapSec.toFixed(1)}s dialogue gap; maximum is ${maximumGapSec.toFixed(1)}s`,
    );
  }
}

export function validateRenderManifest(input: unknown): RenderManifest {
  const manifest = renderManifestSchema.parse(input);
  if (manifest.localePack.projectId !== manifest.projectId) {
    throw new InvalidRenderManifestError('Locale Pack project does not match Render Manifest');
  }
  if (manifest.localePack.locale !== manifest.locale) {
    throw new InvalidRenderManifestError('Locale Pack locale does not match Render Manifest');
  }
  if (!allowedAspects[manifest.compositionId].includes(manifest.aspectRatio)) {
    throw new InvalidRenderManifestError(
      `${manifest.compositionId} does not support ${manifest.aspectRatio}`,
    );
  }
  if (manifest.compositionId === 'EpisodeMaster' && manifest.locale !== 'zh-CN') {
    throw new InvalidRenderManifestError('EpisodeMaster is the zh-CN master composition');
  }
  if (manifest.compositionId === 'EpisodeLocalized' && manifest.locale !== 'en-US') {
    throw new InvalidRenderManifestError('EpisodeLocalized is the en-US composition');
  }
  const actualRatio = manifest.output.width / manifest.output.height;
  if (Math.abs(actualRatio - expectedRatio(manifest.aspectRatio)) > 0.01) {
    throw new InvalidRenderManifestError('Output dimensions do not match aspectRatio');
  }
  const shotIds = new Set(manifest.shots.map((shot) => shot.shotId));
  if (shotIds.size !== manifest.shots.length) {
    throw new InvalidRenderManifestError('Render Manifest shot IDs must be unique');
  }
  const episodeDuration = Math.max(...manifest.shots.map((shot) => shot.outFrame));
  for (const line of manifest.localePack.lines) {
    if (!shotIds.has(line.shotId)) {
      throw new InvalidRenderManifestError(`Subtitle line references unknown shot ${line.shotId}`);
    }
    if (line.endMs > (episodeDuration / manifest.fps) * 1_000) {
      throw new InvalidRenderManifestError(`Subtitle line ${line.lineId} exceeds composition duration`);
    }
  }
  if (
    isEpisode(manifest) &&
    (episodeDuration < 60 * manifest.fps || episodeDuration > 90 * manifest.fps)
  ) {
    throw new InvalidRenderManifestError('Episode duration must be between 60 and 90 seconds');
  }
  if (manifest.compositionId === 'PipelineSmoke') {
    const durationSec = episodeDuration / manifest.fps;
    if (durationSec < 1 || durationSec > 15) {
      throw new InvalidRenderManifestError('PipelineSmoke duration must be between 1 and 15 seconds');
    }
  }
  if (isEpisode(manifest)) validateEpisodeContent(manifest);
  return manifest;
}

export function getCompositionDuration(input: RemotionInputProps): number {
  const id = compositionIdSchema.parse(input.manifest.compositionId);
  const fixed = fixedDurationSeconds[id];
  if (fixed) return Math.round(fixed * input.manifest.fps);
  if (id === 'MotionPoster') {
    return Math.round(input.design.promoSpec.motionPoster.durationSec * input.manifest.fps);
  }
  return Math.max(...input.manifest.shots.map((shot) => shot.outFrame));
}

export function calculatePreviewScale(width: number, height: number): number {
  return Math.min(1, 640 / width, 640 / height);
}

export function calculateMaxDimensionScale(width: number, height: number, maxDimension: number): number {
  return Math.min(1, maxDimension / width, maxDimension / height);
}
