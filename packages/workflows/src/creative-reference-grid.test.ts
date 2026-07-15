import { assetRecordSchema, creativeReferenceGridRequestSchema } from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import { CreativeReferenceGridProcessor } from './creative-reference-grid.js';

const now = '2026-07-15T00:00:00.000Z';
const source = assetRecordSchema.parse({
  assetId: 'asset_grid_source', projectId: 'prj_grid', type: 'image', version: 1,
  uri: 's3://onecrew/source/grid.png', provider: 'import', model: 'source', source: 'fixture', license: 'fixture',
  contentHash: '1'.repeat(64), status: 'draft', createdAt: now, updatedAt: now,
});

describe('CreativeReferenceGridProcessor', () => {
  it('stores deterministic tiles and applies them through one repository operation', async () => {
    const puts: Array<{ key: string; bytes: Uint8Array }> = [];
    let applied: unknown;
    const processor = new CreativeReferenceGridProcessor(
      {
        async applyReferenceGrid(input) {
          applied = input;
          return {
            projectId: 'prj_grid', entityId: input.entityId, sourceAssetId: input.sourceAssetId,
            rows: input.rows, columns: input.columns, tileAssetIds: input.tiles.map((tile) => tile.assetId),
            entityVersion: 2, replayed: false,
          };
        },
      },
      { async get() { return { value: source, version: 1 }; } },
      {
        async get() { return { bytes: new Uint8Array([9]), contentType: 'image/png', key: 'source/grid.png' }; },
        async put(input) {
          puts.push({ key: input.key, bytes: input.bytes });
          return { uri: `s3://onecrew/${input.key}` };
        },
      },
      'ffmpeg-fixture',
      async () => Array.from({ length: 4 }, (_, index) => ({
        index, row: Math.floor(index / 2), column: index % 2,
        bytes: new Uint8Array([index + 1]), contentType: 'image/png' as const,
      })),
    );
    const result = await processor.process(
      'character_grid',
      creativeReferenceGridRequestSchema.parse({
        sourceAssetId: source.assetId, expectedEntityVersion: 1, rows: 2, columns: 2, actorOpenId: 'ou_grid',
      }),
      'grid_process_1',
    );
    expect(result).toMatchObject({ entityId: 'character_grid', entityVersion: 2, tileAssetIds: expect.any(Array) });
    expect(result.tileAssetIds).toHaveLength(4);
    expect(new Set(result.tileAssetIds).size).toBe(4);
    expect(puts).toHaveLength(4);
    expect(puts[0]?.key).toContain('/2x2/01-');
    expect(applied).toMatchObject({
      sourceAssetId: source.assetId,
      expectedEntityVersion: 1,
      idempotencyKey: 'grid_process_1',
    });
    expect((applied as { tiles: unknown[] }).tiles).toHaveLength(4);
    expect((applied as { tiles: unknown[] }).tiles[0]).toMatchObject({
      parentAssetId: source.assetId,
      creativeRole: 'reference-grid-r1-c1',
    });
  });
});
