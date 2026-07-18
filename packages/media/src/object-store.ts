import type { AppEnv } from '@onecrew/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PutMediaInput {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface S3MediaStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  maxObjectBytes?: number;
}

export function validateObjectKey(key: string): string {
  if (
    key.length < 1 ||
    key.length > 1_024 ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid object key: ${key}`);
  }
  return key;
}

export function parseControlledS3Uri(uri: string, expectedBucket: string): string {
  const parsed = new URL(uri);
  if (parsed.protocol !== 's3:' || parsed.hostname !== expectedBucket) {
    throw new Error(`Media URI must use controlled bucket s3://${expectedBucket}`);
  }
  return validateObjectKey(decodeURIComponent(parsed.pathname.replace(/^\//, '')));
}

export class S3MediaStore {
  readonly client: S3Client;
  readonly bucket: string;
  private readonly maxObjectBytes: number;

  constructor(options: S3MediaStoreOptions) {
    this.bucket = options.bucket;
    this.maxObjectBytes = options.maxObjectBytes ?? 512 * 1024 * 1024;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
    });
  }

  static fromEnv(env: AppEnv): S3MediaStore {
    return new S3MediaStore({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKey: env.S3_ACCESS_KEY,
      secretKey: env.S3_SECRET_KEY,
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404) throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(input: PutMediaInput): Promise<{ uri: string }> {
    const key = validateObjectKey(input.key);
    if (!input.contentType.includes('/')) throw new Error('Media contentType must be a MIME type');
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > this.maxObjectBytes) {
      throw new Error(`Media object size ${input.bytes.byteLength} is outside the allowed range`);
    }
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: input.bytes,
        ContentType: input.contentType,
        Metadata: { onecrew: 'controlled-media' },
      }),
    );
    return { uri: `s3://${this.bucket}/${key}` };
  }

  async get(uri: string): Promise<{ bytes: Uint8Array; contentType: string; key: string }> {
    const key = parseControlledS3Uri(uri, this.bucket);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!response.Body) throw new Error(`S3 object has no response body: ${key}`);
    if (response.ContentLength !== undefined && response.ContentLength > this.maxObjectBytes) {
      throw new Error(`Media object size ${response.ContentLength} exceeds the allowed range`);
    }
    const bytes = await response.Body.transformToByteArray();
    if (bytes.byteLength < 1 || bytes.byteLength > this.maxObjectBytes) {
      throw new Error(`Media object size ${bytes.byteLength} is outside the allowed range`);
    }
    return { bytes, contentType: response.ContentType ?? 'application/octet-stream', key };
  }

  async presignGet(uri: string, expiresInSeconds = 3_600): Promise<string> {
    const key = parseControlledS3Uri(uri, this.bucket);
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 604_800) {
      throw new Error('Presigned media URL expiry must be between 1 and 604800 seconds');
    }
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }

  destroy(): void {
    this.client.destroy();
  }
}
