import { describe, expect, it } from 'vitest';

import { allFixtureInputs, createFixtureInput, createFixtureManifest } from './fixtures.js';
import {
  calculateMaxDimensionScale,
  calculatePreviewScale,
  getCompositionDuration,
  InvalidRenderManifestError,
  validateRenderManifest,
} from './manifest.js';

describe('OneCrew Remotion manifests', () => {
  it('validates all six shared compositions and their locked durations', () => {
    expect(allFixtureInputs.map((input) => input.manifest.compositionId)).toEqual([
      'EpisodeMaster',
      'EpisodeLocalized',
      'Trailer30',
      'Teaser15Vertical',
      'Bumper6',
      'MotionPoster',
    ]);
    expect(allFixtureInputs.map((input) => validateRenderManifest(input.manifest).compositionId)).toHaveLength(6);
    expect(getCompositionDuration(createFixtureInput('EpisodeMaster'))).toBe(1_800);
    expect(getCompositionDuration(createFixtureInput('EpisodeLocalized'))).toBe(1_800);
    expect(getCompositionDuration(createFixtureInput('Trailer30'))).toBe(900);
    expect(getCompositionDuration(createFixtureInput('Teaser15Vertical'))).toBe(450);
    expect(getCompositionDuration(createFixtureInput('Bumper6'))).toBe(180);
    expect(getCompositionDuration(createFixtureInput('MotionPoster'))).toBe(180);
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
});
