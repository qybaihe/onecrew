import { describe, expect, it } from 'vitest';

import { allFixtureInputs, createFixtureInput, createFixtureManifest } from './fixtures.js';
import {
  analyzeManifestContent,
  calculateMaxDimensionScale,
  calculatePreviewScale,
  getCompositionDuration,
  InvalidRenderManifestError,
  validateRenderManifest,
} from './manifest.js';
import { resolveManifestMediaUris } from './server/render-engine.js';

describe('OneCrew Remotion manifests', () => {
  it('validates all six shared compositions and their locked durations', () => {
    expect(allFixtureInputs.map((input) => input.manifest.compositionId)).toEqual([
      'EpisodeMaster',
      'EpisodeLocalized',
      'Trailer30',
      'Teaser15Vertical',
      'Bumper6',
      'MotionPoster',
      'PipelineSmoke',
    ]);
    expect(allFixtureInputs.map((input) => validateRenderManifest(input.manifest).compositionId)).toHaveLength(7);
    expect(getCompositionDuration(createFixtureInput('EpisodeMaster'))).toBe(1_800);
    expect(getCompositionDuration(createFixtureInput('EpisodeLocalized'))).toBe(1_800);
    expect(getCompositionDuration(createFixtureInput('Trailer30'))).toBe(900);
    expect(getCompositionDuration(createFixtureInput('Teaser15Vertical'))).toBe(450);
    expect(getCompositionDuration(createFixtureInput('Bumper6'))).toBe(180);
    expect(getCompositionDuration(createFixtureInput('MotionPoster'))).toBe(180);
    expect(getCompositionDuration(createFixtureInput('PipelineSmoke'))).toBe(180);
  });

  it('rejects padded episodes with repeated assets or sparse dialogue', () => {
    const repeated = createFixtureManifest('EpisodeMaster');
    repeated.shots = repeated.shots.map((shot) => ({
      ...shot,
      videoUri: 'https://media.test/repeated.mp4',
    }));
    expect(() => validateRenderManifest(repeated)).toThrow(/distinct video assets/);

    const sparse = createFixtureManifest('EpisodeMaster');
    sparse.localePack.lines = sparse.localePack.lines.slice(0, 1);
    expect(() => validateRenderManifest(sparse)).toThrow(/dialogue density/);
  });

  it('reports production content quality and validates independent source trims', () => {
    const manifest = createFixtureManifest('EpisodeMaster');
    expect(analyzeManifestContent(manifest)).toMatchObject({
      durationSec: 60,
      distinctAssetCount: 10,
      minimumDistinctAssetCount: 4,
      duplicateAssetShotRatio: 0,
    });
    const invalidTrim = createFixtureManifest('PipelineSmoke');
    invalidTrim.shots[0] = {
      ...invalidTrim.shots[0]!,
      sourceStartFrame: 30,
      sourceEndFrame: undefined,
    };
    expect(() => validateRenderManifest(invalidTrim)).toThrow(/provided together/);
  });

  it('rejects composition, locale, subtitle reference and dimension drift', () => {
    const verticalTrailer = createFixtureManifest('Trailer30');
    verticalTrailer.aspectRatio = '1:1';
    verticalTrailer.output = { codec: 'h264', width: 1080, height: 1080 };
    expect(() => validateRenderManifest(verticalTrailer)).toThrow(InvalidRenderManifestError);

    const wrongLocale = createFixtureManifest('EpisodeMaster');
    wrongLocale.locale = 'en-US';
    expect(() => validateRenderManifest(wrongLocale)).toThrow(/Locale Pack locale/);

    const unknownShot = createFixtureManifest('Bumper6');
    const firstLine = unknownShot.localePack.lines[0];
    if (!firstLine) throw new Error('Fixture has no subtitle line');
    firstLine.shotId = 'shot_unknown';
    expect(() => validateRenderManifest(unknownShot)).toThrow(/unknown shot/);

    const wrongDimensions = createFixtureManifest('Bumper6');
    wrongDimensions.output.width = 1920;
    expect(() => validateRenderManifest(wrongDimensions)).toThrow(/dimensions/);
  });

  it('scales previews down without upscaling small outputs', () => {
    expect(calculatePreviewScale(1920, 1080)).toBeCloseTo(1 / 3);
    expect(calculatePreviewScale(1080, 1920)).toBeCloseTo(1 / 3);
    expect(calculatePreviewScale(320, 180)).toBe(1);
  });

  it('scales renderer output without changing the composition design space', () => {
    expect(calculateMaxDimensionScale(1920, 1080, 640)).toBeCloseTo(1 / 3);
    expect(calculateMaxDimensionScale(1080, 1920, 640)).toBeCloseTo(1 / 3);
    expect(calculateMaxDimensionScale(360, 640, 640)).toBe(1);
  });

  it('materializes shot video, dialogue audio and music URIs before server rendering', async () => {
    const manifest = createFixtureManifest('Bumper6');
    const input = {
      ...manifest,
      shots: manifest.shots.map((shot) => ({
        ...shot,
        videoUri: `s3://onecrew/${shot.shotId}.mp4`,
      })),
      musicUri: 's3://onecrew/music.wav',
      localePack: {
        ...manifest.localePack,
        lines: manifest.localePack.lines.map((line) => ({
          ...line,
          audioUri: `s3://onecrew/${line.lineId}.wav`,
        })),
      },
    };
    const resolved = await resolveManifestMediaUris(
      input,
      async (uri) => uri.replace('s3://onecrew/', 'https://media.test/'),
    );
    expect(resolved.shots.every((shot) => shot.videoUri.startsWith('https://media.test/'))).toBe(true);
    expect(
      resolved.localePack.lines.every((line) => line.audioUri?.startsWith('https://media.test/')),
    ).toBe(true);
    expect(resolved.musicUri).toBe('https://media.test/music.wav');
  });
});
