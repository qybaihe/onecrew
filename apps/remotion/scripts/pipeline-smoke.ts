import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { loadEnv } from '@onecrew/config';
import {
  assetRecordSchema,
  creativeProjectBundleSchema,
  generatedAudioSchema,
  localizationRunRecordSchema,
  qcRunRecordSchema,
  renderRecordSchema,
  type LocalePack,
  type RenderManifest,
} from '@onecrew/contracts';
import { S3MediaStore } from '@onecrew/media';
import { z } from 'zod';

import { fixtureDesignManifest } from '../src/fixtures.js';
import { validateRenderManifest } from '../src/manifest.js';

const runFile = promisify(execFile);
const env = loadEnv();
const apiUrl = process.env.ONECREW_API_URL ?? `http://${env.HOST}:${env.PORT}`;
const [projectId, shotId, outputArgument] = process.argv.slice(2).filter((argument) => argument !== '--');
if (!projectId || !shotId) {
  throw new Error('Usage: tsx scripts/pipeline-smoke.ts <projectId> <shotId> [outputDirectory]');
}
const root = path.resolve(import.meta.dirname, '../../..');
const outputDirectory = path.resolve(
  outputArgument ?? path.join(root, 'output', 'real-e2e', 'pipeline-smoke'),
);
const runId =
  process.env.ONECREW_SMOKE_RUN_ID ??
  `smoke_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const renderMode = process.env.ONECREW_RENDER_MODE === 'final' ? 'final' : 'preview';
const mediaStore = S3MediaStore.fromEnv(env);

const projectResponseSchema = z.object({
  bundle: creativeProjectBundleSchema,
  assets: z.array(assetRecordSchema),
});

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function waitFor<T>(
  pathname: string,
  status: (body: T) => string,
  terminal: string[] = ['succeeded'],
  timeoutMs = 10 * 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await api<T>(pathname);
    const current = status(body);
    if (terminal.includes(current)) return body;
    if (current === 'failed' || current === 'cancelled') {
      throw new Error(`${pathname} reached ${current}: ${JSON.stringify(body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${pathname}`);
}

async function providerJob(pathname: string, suffix: string, payload: unknown) {
  const accepted = await api<{ job_id: string }>(pathname, {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_${suffix}` },
    body: JSON.stringify(payload),
  });
  const completed = await waitFor<{ job: { status: string; outputAssetIds?: string[] }; output?: unknown }>(
    `/v1/jobs/${accepted.job_id}`,
    (body) => body.job.status,
  );
  return { jobId: accepted.job_id, output: completed.output, outputAssetIds: completed.job.outputAssetIds ?? [] };
}

await mkdir(outputDirectory, { recursive: true });
await mediaStore.ensureBucket();

try {
  const project = projectResponseSchema.parse(
    await api(`/v1/creative/projects/${encodeURIComponent(projectId)}`),
  );
  const shot = project.bundle.shots.find((candidate) => candidate.shotId === shotId);
  if (!shot) throw new Error(`Shot ${shotId} does not belong to ${projectId}`);
  const asset = project.assets
    .filter(
      (candidate) =>
        candidate.shotId === shotId &&
        candidate.type === 'video' &&
        candidate.status !== 'archived' &&
        candidate.status !== 'rejected',
    )
    .sort((left, right) => right.version - left.version || right.createdAt.localeCompare(left.createdAt))[0];
  if (!asset) throw new Error(`Shot ${shotId} has no generated video asset`);

  const source = await mediaStore.get(asset.uri);
  const sourcePath = path.join(outputDirectory, `${shotId}.source.mp4`);
  await writeFile(sourcePath, source.bytes);
  const probe = await runFile(env.FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate',
    '-of',
    'json',
    sourcePath,
  ]);
  const probed = z
    .object({ format: z.object({ duration: z.coerce.number().positive() }) })
    .passthrough()
    .parse(JSON.parse(probe.stdout));
  const durationSec = Math.min(15, probed.format.duration, Math.max(1, shot.durationSec));
  if (durationSec < 1) throw new Error('PipelineSmoke source must contain at least one second of media');
  const durationFrames = Math.floor(durationSec * 30);

  const sourceText = shot.dialogueZh?.trim() || shot.narrationZh?.trim() || '微光已经启程。';
  const sourceVoiceId = 'voice_smoke_zh';
  const targetVoiceId = 'voice_smoke_en';
  const sourceLineId = `line_${runId}_zh`;
  const sourceTts = await providerJob('/v1/audio/synthesize', 'source_tts', {
    projectId,
    route: 'primary',
    lineId: sourceLineId,
    text: sourceText,
    locale: 'zh-CN',
    voiceId: sourceVoiceId,
    outputFormat: 'wav_44100',
  });
  const sourceAudio = generatedAudioSchema.parse(sourceTts.output);
  if (!sourceAudio.durationMs) throw new Error('PipelineSmoke TTS did not return durationMs');
  if (sourceAudio.durationMs + 700 > durationSec * 1_000) {
    throw new Error('PipelineSmoke dialogue is longer than the source shot; use a longer shot or shorter line');
  }

  const sharedShots: RenderManifest['shots'] = [{
    shotId,
    videoUri: asset.uri,
    inFrame: 0,
    outFrame: durationFrames,
    sourceStartFrame: 0,
    sourceEndFrame: durationFrames,
    crop: { x: 0.5, y: 0.5, scale: 1.04 },
  }];
  const sourcePack: LocalePack = {
    projectId,
    locale: 'zh-CN',
    version: 1,
    sourceLocale: 'zh-CN',
    translationMode: 'source',
    title: project.bundle.project.nameZh,
    lines: [{
      lineId: sourceLineId,
      shotId,
      speaker: '链路测试',
      text: sourceText,
      startMs: 350,
      endMs: 350 + sourceAudio.durationMs,
      voiceId: sourceVoiceId,
      audioUri: sourceAudio.uri,
      audioDurationMs: sourceAudio.durationMs,
    }],
    cta: '启程',
    marketingCopy: ['OneCrew Pipeline Smoke'],
  };

  const localizationAccepted = await api<{ localization_run_id: string }>('/v1/localizations', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_localization` },
    body: JSON.stringify({
      projectId,
      sourceLocalePack: sourcePack,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice: { [sourceVoiceId]: targetVoiceId },
      route: 'primary',
      fps: 30,
      lineGapMs: 250,
      leadInMs: 350,
      tailMs: 350,
    }),
  });
  const localizedBody = await waitFor<{ localization_run: unknown }>(
    `/v1/localizations/${localizationAccepted.localization_run_id}`,
    (body) => localizationRunRecordSchema.parse(body.localization_run).status,
  );
  const localization = localizationRunRecordSchema.parse(localizedBody.localization_run);
  if (!localization.localePack || !localization.localizedShots) throw new Error('Smoke localization is incomplete');

  const manifests = [
    {
      renderId: `render_${runId}_zh`,
      projectId,
      compositionId: 'PipelineSmoke',
      locale: 'zh-CN',
      aspectRatio: '16:9',
      fps: 30,
      designPack: fixtureDesignManifest,
      localePack: sourcePack,
      shots: sharedShots,
      output: { codec: 'h264', width: 1920, height: 1080 },
    },
    {
      renderId: `render_${runId}_en`,
      projectId,
      compositionId: 'PipelineSmoke',
      locale: 'en-US',
      aspectRatio: '16:9',
      fps: 30,
      designPack: fixtureDesignManifest,
      localePack: localization.localePack,
      shots: localization.localizedShots,
      output: { codec: 'h264', width: 1920, height: 1080 },
    },
  ].map(validateRenderManifest);

  const renders = [];
  for (const manifest of manifests) {
    await api('/v1/renders', {
      method: 'POST',
      headers: { 'idempotency-key': `idem_${runId}_${manifest.renderId}` },
      body: JSON.stringify({ manifest, mode: renderMode }),
    });
    const completed = await waitFor<{ render: unknown }>(
      `/v1/renders/${manifest.renderId}`,
      (body) => renderRecordSchema.parse(body.render).status,
    );
    const record = renderRecordSchema.parse(completed.render);
    if (!record.outputUri) throw new Error(`Render ${record.renderId} has no output URI`);
    const object = await mediaStore.get(record.outputUri);
    const filename = `${record.manifest.locale}.PipelineSmoke.${renderMode}.mp4`;
    await writeFile(path.join(outputDirectory, filename), object.bytes);
    renders.push({ record, filename, bytes: object.bytes.byteLength });
  }

  const zhRender = renders.find(({ record }) => record.manifest.locale === 'zh-CN')!;
  const qcAccepted = await api<{ qc_run_id: string }>('/v1/qc/run', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_qc` },
    body: JSON.stringify({
      projectId,
      sourceRenderId: zhRender.record.renderId,
      mediaUri: zhRender.record.outputUri,
      mediaType: 'video',
      expectedDescription: '单镜头 OneCrew 技术链路烟雾测试，不代表正片内容验收。',
      criteria: ['视频可解码', '对白与字幕可播放', '无技术性黑屏'],
      technical: {
        width: renderMode === 'preview' ? 640 : 1920,
        height: renderMode === 'preview' ? 360 : 1080,
        fps: 30,
        durationSec,
        durationToleranceSec: 0.35,
        requireAudio: true,
        maxBlackDurationSec: 0.75,
        maxFreezeDurationSec: durationSec,
        maxSilenceDurationSec: durationSec,
        subtitleCues: sourcePack.lines.map((line) => ({ lineId: line.lineId, startMs: line.startMs, endMs: line.endMs })),
      },
      route: 'primary',
      qualityAttempt: 1,
      autoRemediate: false,
      remediation: 'remotion',
    }),
  });
  const qcBody = await waitFor<{ qc_run: unknown }>(
    `/v1/qc/runs/${qcAccepted.qc_run_id}`,
    (body) => qcRunRecordSchema.parse(body.qc_run).status,
    ['succeeded', 'waiting_human'],
  );
  const qc = qcRunRecordSchema.parse(qcBody.qc_run);
  const report = {
    runId,
    scope: 'pipeline-smoke-only',
    warning: 'A PipelineSmoke result must never be labeled or published as an EpisodeMaster.',
    projectId,
    shotId,
    sourceAsset: asset,
    sourceProbe: JSON.parse(probe.stdout) as unknown,
    sourceTts: { jobId: sourceTts.jobId, audio: sourceAudio },
    localizationRunId: localization.localizationRunId,
    renders,
    qc,
  };
  await writeFile(path.join(outputDirectory, 'pipeline-smoke-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'onecrew_pipeline_smoke_complete', report }, null, 2)}\n`);
} finally {
  mediaStore.destroy();
}
