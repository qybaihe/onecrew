import {
  technicalQcExpectationSchema,
  technicalQcReportSchema,
  type TechnicalQcExpectation,
  type TechnicalQcReport,
} from '@onecrew/contracts';

import { runControlledProcess, type ProcessResult } from './process.js';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  pix_fmt?: string;
  color_range?: string;
  color_space?: string;
  sample_rate?: string;
  channels?: number;
  bit_rate?: string;
}

interface ProbePayload {
  streams?: ProbeStream[];
  format?: { duration?: string; bit_rate?: string; size?: string; format_name?: string };
}

export interface TechnicalQcEngineOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  timeoutMs?: number;
  processRunner?: typeof runControlledProcess;
}

export interface TechnicalQcInput {
  filePath: string;
  mediaType: 'image' | 'video';
  expected?: Partial<TechnicalQcExpectation>;
  signal?: AbortSignal;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rational(value: string | undefined): number {
  if (!value) return 0;
  const [numerator, denominator] = value.split('/').map(Number);
  if (
    numerator === undefined ||
    denominator === undefined ||
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    denominator === 0
  ) {
    return 0;
  }
  return numerator / denominator;
}

function intervalsFromRegex(
  text: string,
  expression: RegExp,
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const intervals: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  for (const match of text.matchAll(expression)) {
    const startSec = finiteNumber(match.groups?.start);
    const endSec = finiteNumber(match.groups?.end);
    const durationSec = finiteNumber(match.groups?.duration, Math.max(0, endSec - startSec));
    intervals.push({ startSec, endSec, durationSec });
  }
  return intervals;
}

function freezeIntervals(
  text: string,
  mediaDurationSec: number,
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const starts = [...text.matchAll(/freeze_start:\s*(?<value>-?[0-9.]+)/g)].map((match) => finiteNumber(match.groups?.value));
  const ends = [...text.matchAll(/freeze_end:\s*(?<value>-?[0-9.]+)/g)].map((match) => finiteNumber(match.groups?.value));
  const durations = [...text.matchAll(/freeze_duration:\s*(?<value>[0-9.]+)/g)].map((match) => finiteNumber(match.groups?.value));
  return starts.map((startSec, index) => {
    const durationSec = durations[index] ?? Math.max(0, mediaDurationSec - startSec);
    const endSec = ends[index] ?? startSec + durationSec;
    return { startSec, endSec, durationSec };
  });
}

function silenceIntervals(
  text: string,
  mediaDurationSec: number,
): Array<{ startSec: number; endSec: number; durationSec: number }> {
  const starts = [...text.matchAll(/silence_start:\s*(?<value>-?[0-9.]+)/g)].map((match) => finiteNumber(match.groups?.value));
  const ends = [...text.matchAll(/silence_end:\s*(?<end>-?[0-9.]+)\s*\|\s*silence_duration:\s*(?<duration>[0-9.]+)/g)];
  return starts.map((startSec, index) => {
    const endMatch = ends[index];
    const endSec = endMatch ? finiteNumber(endMatch.groups?.end) : mediaDurationSec;
    return {
      startSec,
      endSec,
      durationSec: endMatch ? finiteNumber(endMatch.groups?.duration) : Math.max(0, endSec - startSec),
    };
  });
}

function lastMetric(text: string, expression: RegExp, negativeInfinity = -100): number | undefined {
  const matches = [...text.matchAll(expression)];
  const value = matches.at(-1)?.groups?.value;
  if (value === undefined) return undefined;
  if (value === '-inf') return negativeInfinity;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function brightnessJump(text: string): number | undefined {
  const values = [...text.matchAll(/lavfi\.signalstats\.YAVG=(?<value>[0-9.]+)/g)].map((match) => finiteNumber(match.groups?.value));
  if (values.length < 2) return undefined;
  let maximum = 0;
  for (let index = 1; index < values.length; index += 1) {
    maximum = Math.max(maximum, Math.abs((values[index] ?? 0) - (values[index - 1] ?? 0)));
  }
  return maximum;
}

function frameHashes(text: string): string[] {
  return text
    .split('\n')
    .filter((line) => /^\d+,/.test(line))
    .map((line) => line.split(',').at(-1)?.trim())
    .filter((value): value is string => Boolean(value));
}

function sceneChangeCount(text: string): number {
  return [...text.matchAll(/Parsed_showinfo[^\n]*\bn:\s*\d+/g)].length;
}

export class TechnicalQcEngine {
  private readonly ffmpegPath: string;
  private readonly ffprobePath: string;
  private readonly timeoutMs: number;
  private readonly run: typeof runControlledProcess;

  constructor(options: TechnicalQcEngineOptions = {}) {
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.run = options.processRunner ?? runControlledProcess;
  }

  async checkAvailability(): Promise<{ ffmpeg: string; ffprobe: string }> {
    const [ffmpeg, ffprobe] = await Promise.all([
      this.run(this.ffmpegPath, ['-version'], { timeoutMs: 10_000 }),
      this.run(this.ffprobePath, ['-version'], { timeoutMs: 10_000 }),
    ]);
    return {
      ffmpeg: ffmpeg.stdout.split('\n')[0] ?? '',
      ffprobe: ffprobe.stdout.split('\n')[0] ?? '',
    };
  }

  async analyze(input: TechnicalQcInput): Promise<TechnicalQcReport> {
    const expected = technicalQcExpectationSchema.parse(input.expected ?? {});
    let probeResult: ProcessResult;
    try {
      probeResult = await this.run(
        this.ffprobePath,
        [
          '-v',
          'error',
          '-show_entries',
          'format=duration,bit_rate,size,format_name:stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,pix_fmt,color_range,color_space,sample_rate,channels,bit_rate',
          '-of',
          'json',
          input.filePath,
        ],
        { timeoutMs: this.timeoutMs, ...(input.signal ? { signal: input.signal } : {}) },
      );
    } catch (error) {
      return technicalQcReportSchema.parse({
        passed: false,
        probe: { durationSec: 0, width: 0, height: 0, fps: 0, videoCodec: 'unknown', pixelFormat: 'unknown' },
        blackSegments: [],
        freezeSegments: [],
        silenceSegments: [],
        checks: [{ code: 'decode', passed: false, severity: 'error', reason: error instanceof Error ? error.message : 'Media probe failed' }],
        analyzedAt: new Date().toISOString(),
      });
    }

    const payload = JSON.parse(probeResult.stdout) as ProbePayload;
    const video = payload.streams?.find((stream) => stream.codec_type === 'video');
    const audio = payload.streams?.find((stream) => stream.codec_type === 'audio');
    const durationSec = finiteNumber(payload.format?.duration);
    const fps = rational(video?.avg_frame_rate || video?.r_frame_rate);
    const probe = {
      durationSec,
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps,
      videoCodec: video?.codec_name ?? 'unknown',
      pixelFormat: video?.pix_fmt ?? 'unknown',
      ...(video?.color_range ? { colorRange: video.color_range } : {}),
      ...(video?.color_space ? { colorSpace: video.color_space } : {}),
      ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
      ...(audio?.sample_rate ? { sampleRate: Math.round(finiteNumber(audio.sample_rate)) } : {}),
      ...(audio?.channels === undefined ? {} : { channels: audio.channels }),
      ...((payload.format?.bit_rate ?? video?.bit_rate)
        ? { bitRate: Math.round(finiteNumber(payload.format?.bit_rate ?? video?.bit_rate)) }
        : {}),
    };

    const decode = await this.run(
      this.ffmpegPath,
      [
        '-hide_banner',
        '-nostats',
        '-v',
        'error',
        '-xerror',
        '-i',
        input.filePath,
        ...(input.mediaType === 'image' ? ['-frames:v', '1'] : []),
        '-f',
        'null',
        '-',
      ],
      {
        timeoutMs: this.timeoutMs,
        allowFailure: true,
        ...(input.signal ? { signal: input.signal } : {}),
      },
    );

    let videoAnalysis = '';
    let audioAnalysis = '';
    let sceneChanges: number | undefined;
    let sampledFrameCount: number | undefined;
    let visualVariationRatio: number | undefined;
    if (input.mediaType === 'video' && video) {
      const result = await this.run(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-nostats',
          '-v',
          'info',
          '-i',
          input.filePath,
          '-map',
          '0:v:0',
          '-vf',
          'blackdetect=d=0.25:pix_th=0.02,freezedetect=n=-50dB:d=0.5,framestep=5,signalstats,metadata=print:key=lavfi.signalstats.YAVG',
          '-an',
          '-f',
          'null',
          '-',
        ],
        {
          timeoutMs: this.timeoutMs,
          allowFailure: true,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      videoAnalysis = result.stderr;
      if (
        expected.minSceneChanges !== undefined ||
        expected.minVisualVariationRatio !== undefined
      ) {
        const [sceneResult, sampleResult] = await Promise.all([
          this.run(
            this.ffmpegPath,
            [
              '-hide_banner',
              '-nostats',
              '-v',
              'info',
              '-i',
              input.filePath,
              '-map',
              '0:v:0',
              '-vf',
              'select=gt(scene\\,0.18),showinfo',
              '-an',
              '-f',
              'null',
              '-',
            ],
            {
              timeoutMs: this.timeoutMs,
              allowFailure: true,
              ...(input.signal ? { signal: input.signal } : {}),
            },
          ),
          this.run(
            this.ffmpegPath,
            [
              '-hide_banner',
              '-loglevel',
              'error',
              '-i',
              input.filePath,
              '-map',
              '0:v:0',
              '-vf',
              'crop=iw*0.6:ih*0.6:iw*0.2:ih*0.2,fps=1,scale=32:18:flags=area,format=gray',
              '-an',
              '-f',
              'framemd5',
              '-',
            ],
            {
              timeoutMs: this.timeoutMs,
              allowFailure: true,
              ...(input.signal ? { signal: input.signal } : {}),
            },
          ),
        ]);
        sceneChanges = sceneChangeCount(sceneResult.stderr);
        const hashes = frameHashes(sampleResult.stdout);
        sampledFrameCount = hashes.length;
        visualVariationRatio = hashes.length === 0 ? 0 : new Set(hashes).size / hashes.length;
      }
    }
    if (input.mediaType === 'video' && audio) {
      const result = await this.run(
        this.ffmpegPath,
        [
          '-hide_banner',
          '-nostats',
          '-v',
          'info',
          '-i',
          input.filePath,
          '-map',
          '0:a:0',
          '-af',
          'silencedetect=noise=-50dB:d=0.5,ebur128=peak=true',
          '-vn',
          '-f',
          'null',
          '-',
        ],
        {
          timeoutMs: this.timeoutMs,
          allowFailure: true,
          ...(input.signal ? { signal: input.signal } : {}),
        },
      );
      audioAnalysis = result.stderr;
    }

    const blackSegments = intervalsFromRegex(
      videoAnalysis,
      /black_start:(?<start>-?[0-9.]+)\s+black_end:(?<end>-?[0-9.]+)\s+black_duration:(?<duration>[0-9.]+)/g,
    );
    const freezeSegments = freezeIntervals(videoAnalysis, durationSec);
    const silenceSegments = silenceIntervals(audioAnalysis, durationSec);
    const integratedLufs = lastMetric(audioAnalysis, /I:\s*(?<value>-?(?:[0-9.]+|inf))\s+LUFS/g);
    const truePeakDbtp = lastMetric(audioAnalysis, /Peak:\s*(?<value>-?(?:[0-9.]+|inf))\s+dBFS/g);
    const maxBrightnessJump = brightnessJump(videoAnalysis);
    const checks: TechnicalQcReport['checks'] = [];
    const add = (
      code: string,
      passed: boolean,
      reason: string,
      actual?: string | number | boolean,
      expectedValue?: string | number | boolean,
    ) => checks.push({ code, passed, severity: passed ? 'info' : 'error', reason, ...(actual === undefined ? {} : { actual }), ...(expectedValue === undefined ? {} : { expected: expectedValue }) });

    add('decode', decode.exitCode === 0, decode.exitCode === 0 ? 'Media decodes without fatal errors' : decode.stderr.trim().slice(-500) || 'Decode failed');
    add('video_stream', Boolean(video), video ? 'Video stream is present' : 'Video stream is missing');
    if (expected.width !== undefined) add('width', probe.width === expected.width, probe.width === expected.width ? 'Video width matches expectation' : `Video width ${probe.width}px does not match required ${expected.width}px`, probe.width, expected.width);
    if (expected.height !== undefined) add('height', probe.height === expected.height, probe.height === expected.height ? 'Video height matches expectation' : `Video height ${probe.height}px does not match required ${expected.height}px`, probe.height, expected.height);
    if (expected.fps !== undefined) add('fps', Math.abs(probe.fps - expected.fps) <= 0.01, Math.abs(probe.fps - expected.fps) <= 0.01 ? 'Frame rate matches expectation' : `Frame rate ${probe.fps.toFixed(3)}fps does not match required ${expected.fps}fps`, Number(probe.fps.toFixed(3)), expected.fps);
    if (expected.durationSec !== undefined) add('duration', Math.abs(durationSec - expected.durationSec) <= expected.durationToleranceSec, Math.abs(durationSec - expected.durationSec) <= expected.durationToleranceSec ? 'Duration is within tolerance' : `Duration ${durationSec.toFixed(3)}s differs from ${expected.durationSec}s by more than ${expected.durationToleranceSec}s`, Number(durationSec.toFixed(3)), expected.durationSec);
    add('video_codec', expected.allowedVideoCodecs.includes(probe.videoCodec), expected.allowedVideoCodecs.includes(probe.videoCodec) ? 'Video codec is allowed' : `Video codec ${probe.videoCodec} is not in the allowed set`, probe.videoCodec, expected.allowedVideoCodecs.join(','));
    add('pixel_format', expected.allowedPixelFormats.includes(probe.pixelFormat), expected.allowedPixelFormats.includes(probe.pixelFormat) ? 'Pixel format is allowed' : `Pixel format ${probe.pixelFormat} is not in the allowed set`, probe.pixelFormat, expected.allowedPixelFormats.join(','));
    if (expected.colorSpace !== undefined) add('color_space', probe.colorSpace === expected.colorSpace, probe.colorSpace === expected.colorSpace ? 'Color space matches expectation' : `Color space ${probe.colorSpace ?? 'unknown'} does not match required ${expected.colorSpace}`, probe.colorSpace ?? 'unknown', expected.colorSpace);
    const longestBlack = Math.max(0, ...blackSegments.map((item) => item.durationSec));
    add('black_frames', longestBlack <= expected.maxBlackDurationSec, longestBlack <= expected.maxBlackDurationSec ? 'Longest black segment is within limit' : `Black segment ${longestBlack.toFixed(3)}s exceeds ${expected.maxBlackDurationSec.toFixed(3)}s limit`, Number(longestBlack.toFixed(3)), expected.maxBlackDurationSec);
    const freezeCutoffSec = Math.max(0, durationSec - expected.ignoreFreezeTailSec);
    const scoredFreezeSegments = freezeSegments
      .map((item) => ({ ...item, endSec: Math.min(item.endSec, freezeCutoffSec) }))
      .filter((item) => item.endSec > item.startSec)
      .map((item) => ({ ...item, durationSec: item.endSec - item.startSec }));
    const longestFreeze = Math.max(0, ...scoredFreezeSegments.map((item) => item.durationSec));
    add(
      'freeze_frames',
      longestFreeze <= expected.maxFreezeDurationSec,
      longestFreeze <= expected.maxFreezeDurationSec
        ? expected.ignoreFreezeTailSec > 0
          ? `Longest frozen segment before the intentional ${expected.ignoreFreezeTailSec.toFixed(2)}s tail is within limit`
          : 'Longest frozen segment is within limit'
        : `Frozen segment ${longestFreeze.toFixed(3)}s exceeds ${expected.maxFreezeDurationSec.toFixed(3)}s limit`,
      Number(longestFreeze.toFixed(3)),
      expected.maxFreezeDurationSec,
    );
    if (maxBrightnessJump !== undefined) add('brightness_jump', maxBrightnessJump <= expected.maxBrightnessJump, maxBrightnessJump <= expected.maxBrightnessJump ? 'Sampled brightness changes stay within limit' : `Brightness jump ${maxBrightnessJump.toFixed(3)} exceeds ${expected.maxBrightnessJump.toFixed(3)} limit`, Number(maxBrightnessJump.toFixed(3)), expected.maxBrightnessJump);
    if (expected.minSceneChanges !== undefined) {
      add(
        'scene_changes',
        (sceneChanges ?? 0) >= expected.minSceneChanges,
        (sceneChanges ?? 0) >= expected.minSceneChanges
          ? 'Scene-change count meets the narrative variation minimum'
          : `Detected ${sceneChanges ?? 0} scene changes; at least ${expected.minSceneChanges} are required`,
        sceneChanges ?? 0,
        expected.minSceneChanges,
      );
    }
    if (expected.minVisualVariationRatio !== undefined) {
      const ratio = visualVariationRatio ?? 0;
      add(
        'visual_variation',
        ratio >= expected.minVisualVariationRatio,
        ratio >= expected.minVisualVariationRatio
          ? 'Sampled center frames contain sufficient visual variation'
          : `Visual variation ratio ${(ratio * 100).toFixed(1)}% is below ${(expected.minVisualVariationRatio * 100).toFixed(1)}%`,
        Number(ratio.toFixed(4)),
        expected.minVisualVariationRatio,
      );
    }
    add('audio_required', !expected.requireAudio || Boolean(audio), audio ? 'Audio stream is present' : expected.requireAudio ? 'Required audio stream is missing' : 'Audio is optional');
    if (audio) {
      add('audio_codec', expected.allowedAudioCodecs.includes(probe.audioCodec ?? ''), expected.allowedAudioCodecs.includes(probe.audioCodec ?? '') ? 'Audio codec is allowed' : `Audio codec ${probe.audioCodec ?? 'unknown'} is not in the allowed set`, probe.audioCodec ?? 'unknown', expected.allowedAudioCodecs.join(','));
      const longestSilence = Math.max(0, ...silenceSegments.map((item) => item.durationSec));
      add('silence', longestSilence <= expected.maxSilenceDurationSec, longestSilence <= expected.maxSilenceDurationSec ? 'Longest silence is within limit' : `Silence ${longestSilence.toFixed(3)}s exceeds ${expected.maxSilenceDurationSec.toFixed(3)}s limit`, Number(longestSilence.toFixed(3)), expected.maxSilenceDurationSec);
      if (expected.minIntegratedLufs !== undefined) add('loudness_min', (integratedLufs ?? -100) >= expected.minIntegratedLufs, (integratedLufs ?? -100) >= expected.minIntegratedLufs ? 'Integrated loudness is above minimum' : `Integrated loudness ${integratedLufs ?? -100} LUFS is below ${expected.minIntegratedLufs} LUFS`, integratedLufs ?? -100, expected.minIntegratedLufs);
      if (expected.maxIntegratedLufs !== undefined) add('loudness_max', (integratedLufs ?? 100) <= expected.maxIntegratedLufs, (integratedLufs ?? 100) <= expected.maxIntegratedLufs ? 'Integrated loudness is below maximum' : `Integrated loudness ${integratedLufs ?? 100} LUFS exceeds ${expected.maxIntegratedLufs} LUFS`, integratedLufs ?? 100, expected.maxIntegratedLufs);
      if (expected.maxTruePeakDbtp !== undefined) add('true_peak', (truePeakDbtp ?? 100) <= expected.maxTruePeakDbtp, (truePeakDbtp ?? 100) <= expected.maxTruePeakDbtp ? 'True peak is within limit' : `True peak ${truePeakDbtp ?? 100} dBTP exceeds ${expected.maxTruePeakDbtp} dBTP`, truePeakDbtp ?? 100, expected.maxTruePeakDbtp);
    }
    const invalidCue = expected.subtitleCues.find((cue) => cue.endMs <= cue.startMs || cue.endMs > durationSec * 1_000 + expected.durationToleranceSec * 1_000);
    add('subtitle_bounds', !invalidCue, invalidCue ? `Subtitle ${invalidCue.lineId} exceeds media bounds` : 'Subtitle timings stay inside media bounds');

    return technicalQcReportSchema.parse({
      passed: checks.every((check) => check.passed || check.severity !== 'error'),
      probe,
      blackSegments,
      freezeSegments,
      silenceSegments,
      ...(integratedLufs === undefined ? {} : { integratedLufs }),
      ...(truePeakDbtp === undefined ? {} : { truePeakDbtp }),
      ...(maxBrightnessJump === undefined ? {} : { maxBrightnessJump }),
      ...(sceneChanges === undefined ? {} : { sceneChanges }),
      ...(sampledFrameCount === undefined ? {} : { sampledFrameCount }),
      ...(visualVariationRatio === undefined ? {} : { visualVariationRatio }),
      checks,
      analyzedAt: new Date().toISOString(),
    });
  }
}
