import { Composition, type CalculateMetadataFunction } from 'remotion';
import type { ComponentType } from 'react';
import type { CompositionId } from '@onecrew/contracts';

import {
  Bumper6,
  EpisodeLocalized,
  EpisodeMaster,
  MotionPoster,
  Teaser15Vertical,
  Trailer30,
} from './compositions.js';
import { createFixtureInput } from './fixtures.js';
import { getCompositionDuration, validateRenderManifest } from './manifest.js';
import { remotionInputPropsSchema, type RemotionInputProps } from './types.js';

const compositions: ReadonlyArray<{
  id: CompositionId;
  component: ComponentType<RemotionInputProps>;
}> = [
  { id: 'EpisodeMaster', component: EpisodeMaster },
  { id: 'EpisodeLocalized', component: EpisodeLocalized },
  { id: 'Trailer30', component: Trailer30 },
  { id: 'Teaser15Vertical', component: Teaser15Vertical },
  { id: 'Bumper6', component: Bumper6 },
  { id: 'MotionPoster', component: MotionPoster },
];

function metadataFor(id: CompositionId): CalculateMetadataFunction<RemotionInputProps> {
  return ({ props }) => {
    const input = remotionInputPropsSchema.parse(props);
    const manifest = validateRenderManifest(input.manifest);
    if (manifest.compositionId !== id) {
      throw new Error(`Composition ${id} cannot render manifest ${manifest.compositionId}`);
    }
    return {
      durationInFrames: getCompositionDuration(input),
      fps: manifest.fps,
      width: manifest.output.width,
      height: manifest.output.height,
      props: input,
    };
  };
}
export function RemotionRoot() {
  return (
    <>
      {compositions.map(({ id, component }) => {
        const fixture = createFixtureInput(id);
        return (
          <Composition
            key={id}
            id={id}
            component={component}
            durationInFrames={getCompositionDuration(fixture)}
            fps={30}
            width={fixture.manifest.output.width}
            height={fixture.manifest.output.height}
            defaultProps={fixture}
            calculateMetadata={metadataFor(id)}
          />
        );
      })}
    </>
  );
}
