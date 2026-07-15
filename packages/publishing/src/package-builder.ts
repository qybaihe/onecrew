import { createHash } from 'node:crypto';

import {
  experimentRecordSchema,
  publishRequestSchema,
  type ExperimentRecord,
  type PublishRequest,
} from '@onecrew/contracts';
import { strToU8, zipSync } from 'fflate';

export interface PublishMediaReader {
  get(uri: string): Promise<{ bytes: Uint8Array; contentType: string; key?: string }>;
}

export interface BuiltPublishPackage {
  bytes: Uint8Array;
  packageHash: string;
  experiments: ExperimentRecord[];
  manifest: Record<string, unknown>;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

export async function buildPublishPackage(
  requestInput: PublishRequest,
  reader: PublishMediaReader,
  now = new Date(),
): Promise<BuiltPublishPackage> {
  const request = publishRequestSchema.parse(requestInput);
  const files: Record<string, Uint8Array> = {};
  const mediaEntries: Array<Record<string, unknown>> = [];
  for (const creative of request.creatives) {
    const media = await reader.get(creative.mediaUri);
    const extension = media.contentType === 'video/mp4' ? 'mp4' : 'bin';
    const fileName = `media/${creative.locale}/${creative.creativeId}.${extension}`;
    files[fileName] = media.bytes;
    mediaEntries.push({
      creativeId: creative.creativeId,
      locale: creative.locale,
      compositionId: creative.compositionId,
      aspectRatio: creative.aspectRatio,
      file: fileName,
      contentType: media.contentType,
      bytes: media.bytes.byteLength,
      sha256: sha256(media.bytes),
      platforms: creative.platforms,
    });
  }

  const manifest = {
    schemaVersion: 'onecrew-publish-package/v1',
    publishId: request.publishId,
    projectId: request.projectId,
    episode: request.episode,
    delivery: 'package_export',
    generatedAt: now.toISOString(),
    designPack: request.designPack,
    media: mediaEntries,
  };
  const experiments = request.creatives.flatMap((creative) =>
    creative.platforms.map((platform) =>
      experimentRecordSchema.parse({
        experimentId: `exp_${createHash('sha256').update(`${creative.creativeId}:${platform}`).digest('hex').slice(0, 32)}`,
        projectId: request.projectId,
        creativeId: creative.creativeId,
        episode: request.episode,
        language: creative.locale,
        platform,
        hook: creative.hook,
        ...(creative.coverUri ? { coverUri: creative.coverUri } : {}),
        spend: 0,
        retention3s: 0,
        retention15s: 0,
        ctr: 0,
        conversion: 0,
        roas: 0,
        recommendation: 'Collect platform metrics, compare hook retention, then iterate copy or cover without regenerating shared shots.',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      }),
    ),
  );
  files['manifest.json'] = jsonBytes(manifest);
  files['locales/zh-CN.json'] = jsonBytes(request.localePacks.find((pack) => pack.locale === 'zh-CN'));
  files['locales/en-US.json'] = jsonBytes(request.localePacks.find((pack) => pack.locale === 'en-US'));
  files['experiments/seed.json'] = jsonBytes(experiments);
  files['README.md'] = strToU8(
    '# OneCrew 发布包\n\n本包仅用于人工审核后上传。当前 delivery=package_export，不代表已发布到任何平台。\n',
  );
  files['LICENSES.md'] = strToU8(
    `# Sources and licenses\n\nDesign Pack: ${request.designPack.sourceLicense ?? 'See Design Pack manifest.'}\n`,
  );
  const bytes = zipSync(files, { level: 1, mtime: new Date('1980-01-01T00:00:00.000Z') });
  return { bytes, packageHash: sha256(bytes), experiments, manifest };
}
