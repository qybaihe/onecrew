import { Player } from '@remotion/player';
import type { ComponentType } from 'react';
import type { CompositionId } from '@onecrew/contracts';

import {
  Bumper6,
  EpisodeLocalized,
  EpisodeMaster,
  MotionPoster,
  Teaser15Vertical,
  Trailer30,
} from '../compositions.js';
import { getCompositionDuration, validateRenderManifest } from '../manifest.js';
import { remotionInputPropsSchema, type RemotionInputProps } from '../types.js';

const componentById: Record<CompositionId, ComponentType<RemotionInputProps>> = {
  EpisodeMaster,
  EpisodeLocalized,
  Trailer30,
  Teaser15Vertical,
  Bumper6,
  MotionPoster,
};

export function PreviewPlayer({ input }: { input: RemotionInputProps }) {
  const parsed = remotionInputPropsSchema.parse({ ...input, renderMode: 'preview' });
  const manifest = validateRenderManifest(parsed.manifest);
  const component = componentById[manifest.compositionId];
  return (
    <Player
      component={component}
      inputProps={parsed}
      durationInFrames={getCompositionDuration(parsed)}
      fps={manifest.fps}
      compositionWidth={manifest.output.width}
      compositionHeight={manifest.output.height}
      acknowledgeRemotionLicense
      controls
      loop={manifest.compositionId === 'MotionPoster'}
      style={{ width: '100%', aspectRatio: `${manifest.output.width} / ${manifest.output.height}` }}
    />
  );
}
