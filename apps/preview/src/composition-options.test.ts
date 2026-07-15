import { describe, expect, it } from 'vitest';

import { compositionOptions, optionFor } from './composition-options.js';

describe('preview composition catalog', () => {
  it('exposes the six fixed Remotion compositions once', () => {
    expect(compositionOptions).toHaveLength(6);
    expect(new Set(compositionOptions.map((item) => item.id)).size).toBe(6);
    expect(optionFor('EpisodeLocalized')).toMatchObject({ format: '16:9', duration: '60s' });
  });
});
