import { createHash } from 'node:crypto';

import {
  assetRecordSchema,
  creativeReferenceGridRequestSchema,
  type AssetRecord,
  type CreativeReferenceGridRequest,
  type CreativeReferenceGridResult,
} from '@onecrew/contracts';
import type { AssetRepository, CreativeRepository } from '@onecrew/db';
import { splitImageGrid, type ImageGridSplitInput, type ImageGridTile, type S3MediaStore } from '@onecrew/media';

type GridSplitter = (input: ImageGridSplitInput) => Promise<ImageGridTile[]>;

export class CreativeReferenceGridSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeReferenceGridSourceError';
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function derivedAssetId(sourceAssetId: string, rows: number, columns: number, tile: ImageGridTile): string {
  const hash = createHash('sha256')
    .update(`${sourceAssetId}:${rows}:${columns}:${tile.index}:`)
    .update(tile.bytes)
    .digest('hex');
  return `asset_ref_${hash.slice(0, 32)}`;
}

export class CreativeReferenceGridProcessor {
  constructor(
    private readonly creative: Pick<CreativeRepository, 'applyReferenceGrid'>,
    private readonly assets: Pick<AssetRepository, 'get'>,
    private readonly mediaStore: Pick<S3MediaStore, 'get' | 'put'>,
    private readonly ffmpegPath = 'ffmpeg',
    private readonly splitter: GridSplitter = splitImageGrid,
  ) {}

  async process(
    entityId: string,
    input: CreativeReferenceGridRequest,
    idempotencyKey: string,
  ): Promise<CreativeReferenceGridResult> {
    const request = creativeReferenceGridRequestSchema.parse(input);
    const source = (await this.assets.get(request.sourceAssetId)).value;
    if (!source.uri.startsWith('s3://')) {
      throw new CreativeReferenceGridSourceError('Reference grid source must be controlled S3/MinIO media');
    }
    if (!['image', 'character', 'scene', 'prop', 'poster'].includes(source.type)) {
      throw new CreativeReferenceGridSourceError(`Reference grid source is not an image asset: ${source.type}`);
    }
    const object = await this.mediaStore.get(source.uri);
    const tiles = await this.splitter({
      bytes: object.bytes,
      rows: request.rows,
      columns: request.columns,
      ffmpegPath: this.ffmpegPath,
    });
    const now = new Date().toISOString();
    const records: AssetRecord[] = [];
    for (const tile of tiles) {
      const contentHash = sha256(tile.bytes);
      const assetId = derivedAssetId(source.assetId, request.rows, request.columns, tile);
      const key = [
        'creative',
        'reference-grids',
        source.projectId,
        source.assetId,
        `${request.rows}x${request.columns}`,
        `${String(tile.index + 1).padStart(2, '0')}-${contentHash}.png`,
      ].join('/');
      const stored = await this.mediaStore.put({ key, bytes: tile.bytes, contentType: tile.contentType });
      records.push(assetRecordSchema.parse({
        assetId,
        projectId: source.projectId,
        type: 'image',
        version: 1,
        parentAssetId: source.assetId,
        uri: stored.uri,
        provider: 'onecrew-media',
        model: 'ffmpeg-grid-v1',
        source: `Reference tile ${tile.index + 1}/${tiles.length} derived from ${source.assetId}`,
        license: source.license,
        creativeRole: `reference-grid-r${tile.row + 1}-c${tile.column + 1}`,
        contentHash,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      }));
    }
    return this.creative.applyReferenceGrid({
      entityId,
      sourceAssetId: source.assetId,
      expectedEntityVersion: request.expectedEntityVersion,
      rows: request.rows,
      columns: request.columns,
      actorOpenId: request.actorOpenId,
      idempotencyKey,
      tiles: records,
    });
  }
}
