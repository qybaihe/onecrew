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
  for (const line of manifest.localePack.lines) {
    if (!shotIds.has(line.shotId)) {
      throw new InvalidRenderManifestError(`Subtitle line references unknown shot ${line.shotId}`);
    }
  }
  const episodeDuration = Math.max(...manifest.shots.map((shot) => shot.outFrame));
  if (
    (manifest.compositionId === 'EpisodeMaster' || manifest.compositionId === 'EpisodeLocalized') &&
    (episodeDuration < 60 * manifest.fps || episodeDuration > 90 * manifest.fps)
  ) {
    throw new InvalidRenderManifestError('Episode duration must be between 60 and 90 seconds');
  }
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
