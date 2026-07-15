import { describe, expect, it } from 'vitest';

import { parseControlledS3Uri, validateObjectKey } from './object-store.js';

describe('validateObjectKey', () => {
  it('accepts controlled nested keys', () => {
    expect(validateObjectKey('providers/tts/prj_1/audio.mp3')).toBe('providers/tts/prj_1/audio.mp3');
  });

  it('rejects traversal and absolute keys', () => {
    expect(() => validateObjectKey('../secret')).toThrow('Invalid object key');
    expect(() => validateObjectKey('/absolute/file')).toThrow('Invalid object key');
  });

  it('only resolves objects from the configured controlled bucket', () => {
    expect(parseControlledS3Uri('s3://onecrew/renders/demo.mp4', 'onecrew')).toBe('renders/demo.mp4');
    expect(() => parseControlledS3Uri('s3://other/renders/demo.mp4', 'onecrew')).toThrow(/controlled bucket/);
    expect(() => parseControlledS3Uri('https://example.com/demo.mp4', 'onecrew')).toThrow(/controlled bucket/);
  });
});
