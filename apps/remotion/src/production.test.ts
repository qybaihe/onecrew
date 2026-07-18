import type {
  AssetRecord,
  CreativeProjectBundle,
  GeneratedAudio,
  ShotSpec,
} from '@onecrew/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildEpisodeRenderShots,
  buildSourceLocalePack,
  selectEpisodeVideoAssets,
  type EpisodeVideoSelection,
} from './production.js';

const now = '2026-07-17T00:00:00.000Z';

function shot(index: number): ShotSpec {
  return {
    shotId: `shot_${index}`,
    projectId: 'prj_production',
    episodeId: 'episode_1',
    sequence: index,
    durationSec: 6,
    characters: [],
    sceneId: 'scene_1',
    action: `Action ${index}`,
    camera: 'medium shot',
    dialogueZh: `对白 ${index}`,
    prompt: `Prompt ${index}`,
    referenceAssetIds: [],
    importance: 'normal',
    closeupDialogue: false,
    status: 'approved',
  };
}

function asset(index: number, contentHash = String(index).padStart(64, '0')): AssetRecord {
  return {
    assetId: `asset_${index}`,
    projectId: 'prj_production',
    shotId: `shot_${index}`,
    type: 'video',
    version: 1,
    uri: `https://media.test/shot-${index}.mp4`,
    provider: 'test',
    model: 'test-video',
    source: 'test fixture',
    license: 'test',
    contentHash,
    status: 'approved',
    createdAt: now,
    updatedAt: now,
  };
}

function selections(hash?: string): EpisodeVideoSelection[] {
  return Array.from({ length: 10 }, (_, offset) => {
    const index = offset + 1;
    return { shot: shot(index), asset: asset(index, hash ?? String(index).padStart(64, '0')) };
  });
}

describe('production episode assembly', () => {
  it('builds a contiguous 60-second timeline from ten distinct real sources', () => {
    const selected = selections();
    const durations = new Map(selected.map(({ asset }) => [asset.assetId, 6] as const));
    const result = buildEpisodeRenderShots(selected, durations);
    expect(result).toHaveLength(10);
    expect(result[0]).toMatchObject({ inFrame: 0, outFrame: 180, sourceStartFrame: 0, sourceEndFrame: 180 });
    expect(result.at(-1)).toMatchObject({ inFrame: 1_620, outFrame: 1_800 });
  });

  it('rejects duplicate content and short source media instead of padding', () => {
    const duplicate = selections('a'.repeat(64));
    const durations = new Map(duplicate.map(({ asset }) => [asset.assetId, 6] as const));
    expect(() => buildEpisodeRenderShots(duplicate, durations)).toThrow(/distinct video contents/);

    const selected = selections();
    const tooShort = new Map(selected.map(({ asset }, index) => [asset.assetId, index === 0 ? 2 : 6] as const));
    expect(() => buildEpisodeRenderShots(selected, tooShort)).toThrow(/regenerate a longer source/);
  });

  it('refuses episodes with missing per-shot video assets', () => {
    const shots = Array.from({ length: 10 }, (_, index) => shot(index + 1));
    const bundle = {
      project: { projectId: 'prj_production' },
      episodes: [{ episodeId: 'episode_1' }],
      shots,
    } as CreativeProjectBundle;
    expect(() => selectEpisodeVideoAssets(bundle, shots.slice(0, 9).map((_, index) => asset(index + 1)), 'episode_1')).toThrow(
      /shot_10/,
    );
  });

  it('places TTS inside its own shot and rejects overflowing dialogue', () => {
    const selected = selections();
    const durations = new Map(selected.map(({ asset }) => [asset.assetId, 6] as const));
    const renderShots = buildEpisodeRenderShots(selected, durations);
    const audio = (durationMs: number): GeneratedAudio & { durationMs: number } => ({
      uri: 'https://media.test/dialogue.wav',
      mimeType: 'audio/wav',
      durationMs,
    });
    const localePack = buildSourceLocalePack({
      projectId: 'prj_production',
      title: '山海星辰',
      cta: '启程',
      marketingCopy: ['循光而行'],
      shots: renderShots,
      dialogue: renderShots.map((item, index) => ({
        shotId: item.shotId,
        speaker: '守星人',
        text: `对白 ${index + 1}`,
        voiceId: 'voice_zh',
        audio: audio(2_000),
      })),
    });
    expect(localePack.lines).toHaveLength(10);
    expect(localePack.lines[1]).toMatchObject({ startMs: 6_350, endMs: 8_350 });

    expect(() =>
      buildSourceLocalePack({
        projectId: 'prj_production',
        title: '山海星辰',
        cta: '启程',
        marketingCopy: ['循光而行'],
        shots: renderShots,
        dialogue: [{
          shotId: renderShots[0]!.shotId,
          speaker: '守星人',
          text: '过长对白',
          voiceId: 'voice_zh',
          audio: audio(6_000),
        }],
      }),
    ).toThrow(/after its shot/);
  });
});
