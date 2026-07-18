import { describe, expect, it } from 'vitest';

import { compositionOptions, optionFor } from './composition-options.js';

describe('preview composition catalog', () => {
  it('exposes six delivery compositions plus the isolated pipeline smoke once', () => {
    expect(compositionOptions).toHaveLength(7);
    expect(new Set(compositionOptions.map((item) => item.id)).size).toBe(7);
    expect(optionFor('EpisodeLocalized')).toMatchObject({ format: '16:9', duration: '60s' });
    expect(optionFor('PipelineSmoke')).toMatchObject({ duration: '1–15s' });
  });
});
