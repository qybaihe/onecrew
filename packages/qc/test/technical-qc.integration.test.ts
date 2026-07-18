import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TechnicalQcExpectation } from '@onecrew/contracts';

import { runControlledProcess, TechnicalQcEngine } from '../src/index.js';

let directory = '';
let healthyPath = '';
let injectedFailurePath = '';
let repeatedPath = '';

beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'onecrew-qc-test-'));
  healthyPath = path.join(directory, 'healthy.mp4');
  injectedFailurePath = path.join(directory, 'black-freeze-silence.mp4');
  repeatedPath = path.join(directory, 'repeated.mp4');
  await runControlledProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-shortest', healthyPath,
  ]);
  await runControlledProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'color=c=black:size=320x180:rate=30',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-shortest', injectedFailurePath,
  ]);
  await runControlledProcess('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-stream_loop', '2', '-i', healthyPath,
    '-t', '6', '-c', 'copy', repeatedPath,
  ]);
});

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

const engine = new TechnicalQcEngine({ timeoutMs: 30_000 });
const expected: Partial<TechnicalQcExpectation> = {
  width: 320,
  height: 180,
  fps: 30,
  durationSec: 2,
  durationToleranceSec: 0.15,
  requireAudio: true,
  allowedVideoCodecs: ['h264'],
  allowedAudioCodecs: ['aac'],
  allowedPixelFormats: ['yuv420p'],
  colorSpace: 'bt709',
  maxBlackDurationSec: 0.25,
  maxFreezeDurationSec: 0.5,
  maxSilenceDurationSec: 0.5,
  maxBrightnessJump: 255,
  subtitleCues: [{ lineId: 'line_qc', startMs: 0, endMs: 1_900 }],
};

describe('FFmpeg deterministic technical QC', () => {
  it('kills a running FFmpeg subprocess through AbortSignal', async () => {
    const controller = new AbortController();
    const running = runControlledProcess(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-re',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=30',
        '-f',
        'null',
        '-',
      ],
      { timeoutMs: 30_000, signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 100);
    await expect(running).rejects.toThrow('was cancelled');
  });

  it('probes, decodes and passes a controlled healthy fixture', async () => {
    const report = await engine.analyze({ filePath: healthyPath, mediaType: 'video', expected });
    expect(report).toMatchObject({
      passed: true,
      probe: { width: 320, height: 180, fps: 30, videoCodec: 'h264', audioCodec: 'aac' },
    });
    expect(report.checks.filter((check) => !check.passed)).toEqual([]);
  });

  it('finds deliberately injected black, freeze and silence defects', async () => {
    const report = await engine.analyze({
      filePath: injectedFailurePath,
      mediaType: 'video',
      expected,
    });
    expect(report.passed).toBe(false);
    const failures = report.checks.filter((check) => !check.passed).map((check) => check.code);
    expect(failures).toEqual(expect.arrayContaining(['black_frames', 'freeze_frames', 'silence']));
    expect(report.blackSegments[0]?.durationSec).toBeGreaterThan(1.9);
    expect(report.freezeSegments[0]?.durationSec).toBeGreaterThan(1.4);
    expect(report.silenceSegments[0]?.durationSec).toBeGreaterThan(1.9);
  });

  it('can exclude a declared intentional end-card tail from freeze scoring', async () => {
    const report = await engine.analyze({
      filePath: injectedFailurePath,
      mediaType: 'video',
      expected: {
        durationSec: 2,
        durationToleranceSec: 0.15,
        maxBlackDurationSec: 2.1,
        maxFreezeDurationSec: 0.5,
        ignoreFreezeTailSec: 2,
        maxSilenceDurationSec: 2.1,
        maxBrightnessJump: 255,
      },
    });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'freeze_frames', passed: true }));
  });

  it('rejects a periodically repeated clip through visual-variation sampling', async () => {
    const report = await engine.analyze({
      filePath: repeatedPath,
      mediaType: 'video',
      expected: {
        durationSec: 6,
        durationToleranceSec: 0.2,
        maxBlackDurationSec: 6,
        maxFreezeDurationSec: 6,
        maxSilenceDurationSec: 6,
        maxBrightnessJump: 255,
        minVisualVariationRatio: 0.9,
      },
    });
    expect(report.sampledFrameCount).toBeGreaterThanOrEqual(5);
    expect(report.visualVariationRatio).toBeLessThan(0.9);
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'visual_variation', passed: false }));
  });
});
