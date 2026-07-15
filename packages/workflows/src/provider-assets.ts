import {
  generatedAudioSchema,
  generatedImageSchema,
  generatedVideoSchema,
  type AssetRecord,
  type JobRecord,
  type ProviderRequest,
} from '@onecrew/contracts';
import type { createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';

type Repositories = ReturnType<typeof createRepositories>;

interface MediaOutput {
  type: 'image' | 'video' | 'audio';
  uri: string;
  descriptor: unknown;
}

function mediaOutputs(request: ProviderRequest, output: unknown): MediaOutput[] {
  if (request.capability === 'image') {
    return generatedImageSchema.array().parse(output).map((item) => ({
      type: 'image' as const,
      uri: item.uri,
      descriptor: item,
    }));
  }
  if (request.capability === 'video') {
    return generatedVideoSchema.array().parse(output).map((item) => ({
      type: 'video' as const,
      uri: item.uri,
      descriptor: item,
    }));
  }
  if (request.capability === 'tts') {
    const item = generatedAudioSchema.parse(output);
    return [{ type: 'audio', uri: item.uri, descriptor: item }];
  }
  return [];
}

export async function persistProviderAssets(
  repositories: Repositories,
  job: JobRecord,
  request: ProviderRequest,
  output: unknown,
): Promise<string[]> {
  const outputs = mediaOutputs(request, output);
  const assetIds: string[] = [];
  for (const [index, item] of outputs.entries()) {
    const parent =
      'shotId' in request && request.shotId
        ? await repositories.assets.latestForShot(job.projectId, request.shotId, item.type)
        : undefined;
    const now = new Date().toISOString();
    const record: AssetRecord = {
      assetId: `asset_${createInputHash({ jobId: job.jobId, index, uri: item.uri }).slice(0, 32)}`,
      projectId: job.projectId,
      ...('shotId' in request && request.shotId ? { shotId: request.shotId } : {}),
      type: item.type,
      version: (parent?.value.version ?? 0) + 1,
      ...(parent ? { parentAssetId: parent.value.assetId } : {}),
      uri: item.uri,
      provider: job.provider,
      model: job.model,
      ...('seed' in request && request.seed !== undefined ? { seed: String(request.seed) } : {}),
      source: `Provider Job ${job.jobId}; input SHA-256 ${job.inputHash}`,
      license:
        job.mode === 'mock'
          ? 'OneCrew deterministic Mock fixture; repository project license applies.'
          : 'Provider-generated media; usage is subject to the configured provider terms.',
      contentHash: createInputHash(item.descriptor),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    const created = await repositories.assets.create(record);
    assetIds.push(created.value.assetId);
  }
  return assetIds;
}
