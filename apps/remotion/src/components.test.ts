import { describe, expect, it } from 'vitest';

import { calculateSourcePlayback } from './components.js';

describe('source media trimming', () => {
  it('keeps timeline placement separate from source playback bounds', () => {
    expect(
      calculateSourcePlayback(
        {
          shotId: 'shot_trim',
          videoUri: 'https://media.test/source.mp4',
          inFrame: 900,
          outFrame: 1_140,
          sourceStartFrame: 120,
          sourceEndFrame: 300,
        },
        240,
      ),
    ).toEqual({ startFrom: 120, playbackRate: 0.75 });
  });
});
