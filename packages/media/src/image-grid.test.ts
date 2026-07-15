import { describe, expect, it } from 'vitest';

import { buildImageGridFilter, InvalidImageGridError } from './image-grid.js';

describe('image grid preprocessing', () => {
  it('builds deterministic crop outputs in reading order', () => {
    expect(buildImageGridFilter(2, 2)).toBe(
      '[0:v]split=4[grid0][grid1][grid2][grid3];' +
      '[grid0]crop=iw/2:ih/2:0*iw/2:0*ih/2[tile0];' +
      '[grid1]crop=iw/2:ih/2:1*iw/2:0*ih/2[tile1];' +
      '[grid2]crop=iw/2:ih/2:0*iw/2:1*ih/2[tile2];' +
      '[grid3]crop=iw/2:ih/2:1*iw/2:1*ih/2[tile3]',
    );
  });

  it('rejects a single-cell or oversized grid', () => {
    expect(() => buildImageGridFilter(1, 1)).toThrow(InvalidImageGridError);
    expect(() => buildImageGridFilter(4, 2)).toThrow(InvalidImageGridError);
  });
});
