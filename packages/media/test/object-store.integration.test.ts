import { DeleteObjectCommand } from '@aws-sdk/client-s3';
import { loadEnv } from '@onecrew/config';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { S3MediaStore } from '../src/object-store.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const store = S3MediaStore.fromEnv(env);

beforeAll(async () => {
  await store.ensureBucket();
});

afterAll(() => {
  store.destroy();
});

describe('S3MediaStore against local MinIO', () => {
  it('writes and reads controlled media bytes', async () => {
    const key = `integration/stage4-${Date.now()}.txt`;
    const bytes = new TextEncoder().encode('onecrew-media-proof');
    const written = await store.put({ key, bytes, contentType: 'text/plain' });
    const fetched = await store.get(written.uri);

    expect(written.uri).toBe(`s3://${store.bucket}/${key}`);
    expect(new TextDecoder().decode(fetched.bytes)).toBe('onecrew-media-proof');
    expect(fetched).toMatchObject({ contentType: 'text/plain', key });

    const signedUrl = await store.presignGet(written.uri, 60);
    const signedResponse = await fetch(signedUrl);
    expect(signedResponse.ok).toBe(true);
    expect(signedResponse.headers.get('content-type')).toContain('text/plain');
    expect(await signedResponse.text()).toBe('onecrew-media-proof');

    await store.client.send(new DeleteObjectCommand({ Bucket: store.bucket, Key: key }));
  });
});
