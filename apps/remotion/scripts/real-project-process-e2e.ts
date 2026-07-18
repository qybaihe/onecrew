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
  publishRecordSchema,
  qcRunRecordSchema,
  renderRecordSchema,
  type CampaignCreative,
  type RenderManifest,
} from '@onecrew/contracts';
import { buildCampaignPlan, buildLocalizedEpisodeManifest } from '@onecrew/localization';
import { S3MediaStore } from '@onecrew/media';
import { z } from 'zod';

import { fixtureDesignManifest } from '../src/fixtures.js';
import { analyzeManifestContent, validateRenderManifest } from '../src/manifest.js';
import {
  EpisodeAssemblyError,
  buildEpisodeRenderShots,
  buildSourceLocalePack,
  selectEpisodeVideoAssets,
  type EpisodeVideoSelection,
  type SourceDialogueAudio,
} from '../src/production.js';

const runFile = promisify(execFile);
const env = loadEnv();
const apiUrl = process.env.ONECREW_API_URL ?? `http://${env.HOST}:${env.PORT}`;
const [projectId, episodeId, outputArgument] = process.argv.slice(2).filter((argument) => argument !== '--');
if (!projectId || !episodeId) {
  throw new Error(
    'Usage: tsx scripts/real-project-process-e2e.ts <projectId> <episodeId> [outputDirectory]',
  );
}
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputDirectory = path.resolve(
  outputArgument ?? path.join(workspaceRoot, 'output', 'real-e2e', 'production'),
);
const runId =
  process.env.ONECREW_E2E_RUN_ID ??
  `real_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
const renderMode = process.env.ONECREW_RENDER_MODE === 'final' ? 'final' : 'preview';
const mediaStore = S3MediaStore.fromEnv(env);

const projectResponseSchema = z.object({
  bundle: creativeProjectBundleSchema,
  assets: z.array(assetRecordSchema),
});

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${text}`);
  }
  return body as T;
}

async function waitFor<T>(
  pathname: string,
  readStatus: (body: T) => string,
  terminal: string[] = ['succeeded'],
  timeoutMs = 15 * 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await api<T>(pathname);
    const status = readStatus(body);
    if (terminal.includes(status)) return body;
    if (status === 'failed' || status === 'cancelled') {
      throw new Error(`${pathname} reached ${status}: ${JSON.stringify(body)}`);
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
  const completed = await waitFor<{
    job: { status: string; outputAssetIds?: string[] };
    output?: unknown;
  }>(
    `/v1/jobs/${accepted.job_id}`,
    (body) => body.job.status,
    ['succeeded'],
    5 * 60_000,
  );
  return {
    jobId: accepted.job_id,
    output: completed.output,
    outputAssetIds: completed.job.outputAssetIds ?? [],
  };
}

async function mapConcurrent<Input, Output>(
  inputs: Input[],
  concurrency: number,
  task: (input: Input, index: number) => Promise<Output>,
): Promise<Output[]> {
  const outputs = new Array<Output>(inputs.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, inputs.length)) }, async () => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      outputs[index] = await task(inputs[index]!, index);
    }
  });
  await Promise.all(workers);
  return outputs;
}

async function materializeAndProbeSources(selections: EpisodeVideoSelection[]) {
  const sourceDirectory = path.join(outputDirectory, 'sources');
  await mkdir(sourceDirectory, { recursive: true });
  return mapConcurrent(selections, 3, async ({ shot, asset }) => {
    const object = await mediaStore.get(asset.uri);
    const localPath = path.join(sourceDirectory, `${String(shot.sequence).padStart(3, '0')}-${shot.shotId}.mp4`);
    await writeFile(localPath, object.bytes);
    const probe = await runFile(env.FFPROBE_PATH, [
      '-v',
      'error',
      '-show_entries',
      'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate',
      '-of',
      'json',
      localPath,
    ]);
    const parsed = z
      .object({ format: z.object({ duration: z.coerce.number().positive(), size: z.string().optional() }) })
      .passthrough()
      .parse(JSON.parse(probe.stdout));
    return {
      assetId: asset.assetId,
      shotId: shot.shotId,
      uri: asset.uri,
      contentHash: asset.contentHash,
      durationSec: parsed.format.duration,
      bytes: object.bytes.byteLength,
      localPath,
      probe: JSON.parse(probe.stdout) as unknown,
    };
  });
}

async function downloadRender(record: ReturnType<typeof renderRecordSchema.parse>) {
  if (!record.outputUri) throw new Error(`Render ${record.renderId} has no output URI`);
  const object = await mediaStore.get(record.outputUri);
  const filename = `${record.manifest.locale}.${record.manifest.compositionId}.${renderMode}.mp4`;
  const localPath = path.join(outputDirectory, filename);
  await writeFile(localPath, object.bytes);
  const probe = await runFile(env.FFPROBE_PATH, [
    '-v',
    'error',
    '-show_entries',
    'format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,sample_rate,channels',
    '-of',
    'json',
    localPath,
  ]);
  return {
    record,
    filename,
    localPath,
    bytes: object.bytes.byteLength,
    probe: JSON.parse(probe.stdout) as unknown,
  };
}

await mkdir(outputDirectory, { recursive: true });
await mediaStore.ensureBucket();

try {
  const projectResponse = projectResponseSchema.parse(
    await api(`/v1/creative/projects/${encodeURIComponent(projectId)}`),
  );
  const episode = projectResponse.bundle.episodes.find((candidate) => candidate.episodeId === episodeId);
  if (!episode) throw new EpisodeAssemblyError(`Episode ${episodeId} does not belong to ${projectId}`);

  const selections = selectEpisodeVideoAssets(projectResponse.bundle, projectResponse.assets, episodeId);
  const sourceFiles = await materializeAndProbeSources(selections);
  const durationByAssetId = new Map(sourceFiles.map((source) => [source.assetId, source.durationSec] as const));
  const sharedShots = buildEpisodeRenderShots(selections, durationByAssetId);

  const dialogueCandidates = selections.flatMap(({ shot }) => {
    const text = shot.dialogueZh?.trim() || shot.narrationZh?.trim();
    if (!text) return [];
    const characterId = shot.dialogueZh?.trim() ? shot.characters[0] : undefined;
    const character = characterId
      ? projectResponse.bundle.entities.find((entity) => entity.entityId === characterId && entity.kind === 'character')
      : undefined;
    return [{ shot, text, speaker: character?.name ?? (shot.narrationZh?.trim() ? '旁白' : '角色'), voiceKey: characterId ?? 'narrator' }];
  });
  const minimumDialogueShots = Math.min(sharedShots.length, Math.max(3, Math.ceil(sharedShots.length * 0.3)));
  if (dialogueCandidates.length < minimumDialogueShots) {
    throw new EpisodeAssemblyError(
      `Episode has scripted dialogue or narration in only ${dialogueCandidates.length} shots; at least ${minimumDialogueShots} are required before production rendering`,
    );
  }

  const voiceIndexByKey = new Map<string, number>();
  for (const candidate of dialogueCandidates) {
    if (!voiceIndexByKey.has(candidate.voiceKey)) voiceIndexByKey.set(candidate.voiceKey, voiceIndexByKey.size + 1);
  }
  const sourceTts = await mapConcurrent(dialogueCandidates, 2, async (candidate, index) => {
    const voiceIndex = voiceIndexByKey.get(candidate.voiceKey)!;
    const sourceVoiceId = `voice_zh_${String(voiceIndex).padStart(2, '0')}`;
    const targetVoiceId = `voice_en_${String(voiceIndex).padStart(2, '0')}`;
    const lineId = `line_${runId}_zh_${String(index + 1).padStart(3, '0')}`;
    const job = await providerJob('/v1/audio/synthesize', `source_tts_${candidate.shot.shotId}`, {
      projectId,
      route: 'primary',
      lineId,
      text: candidate.text,
      locale: 'zh-CN',
      voiceId: sourceVoiceId,
      outputFormat: 'wav_44100',
    });
    const audio = generatedAudioSchema.parse(job.output);
    if (!audio.durationMs) throw new Error(`TTS did not return durationMs for ${candidate.shot.shotId}`);
    return { candidate, lineId, sourceVoiceId, targetVoiceId, job, audio };
  });

  const sourcePack = buildSourceLocalePack({
    projectId,
    title: episode.title || projectResponse.bundle.project.nameZh,
    cta: '沿星轨启程',
    marketingCopy: [projectResponse.bundle.project.synopsis.slice(0, 1_000)],
    shots: sharedShots,
    dialogue: sourceTts.map(({ candidate, sourceVoiceId, audio }): SourceDialogueAudio => ({
      shotId: candidate.shot.shotId,
      speaker: candidate.speaker,
      text: candidate.text,
      voiceId: sourceVoiceId,
      audio: { ...audio, durationMs: audio.durationMs! },
    })),
  });
  const targetVoiceBySourceVoice = Object.fromEntries(
    sourceTts.map(({ sourceVoiceId, targetVoiceId }) => [sourceVoiceId, targetVoiceId]),
  );

  const localizationAccepted = await api<{ localization_run_id: string }>('/v1/localizations', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_localization` },
    body: JSON.stringify({
      projectId,
      sourceLocalePack: sourcePack,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice,
      route: 'primary',
      fps: 30,
      lineGapMs: 250,
      leadInMs: 350,
      tailMs: 350,
    }),
  });
  const localizationBody = await waitFor<{ localization_run: unknown }>(
    `/v1/localizations/${localizationAccepted.localization_run_id}`,
    (body) => localizationRunRecordSchema.parse(body.localization_run).status,
    ['succeeded'],
    10 * 60_000,
  );
  const localization = localizationRunRecordSchema.parse(localizationBody.localization_run);
  if (!localization.localePack || !localization.localizedShots) {
    throw new Error('Localization output is incomplete');
  }

  const campaign = buildCampaignPlan({
    campaignId: runId,
    projectId,
    designPack: fixtureDesignManifest,
    zhLocalePack: sourcePack,
    enLocalePack: localization.localePack,
    zhShots: sharedShots,
    enShots: localization.localizedShots,
  });
  const zhEpisode: RenderManifest = {
    renderId: `render_${runId}_zh_episode`,
    projectId,
    compositionId: 'EpisodeMaster',
    locale: 'zh-CN',
    aspectRatio: '16:9',
    fps: 30,
    designPack: fixtureDesignManifest,
    localePack: sourcePack,
    shots: sharedShots,
    output: { codec: 'h264', width: 1920, height: 1080 },
  };
  const enEpisode = buildLocalizedEpisodeManifest({
    renderId: `render_${runId}_en_episode`,
    projectId,
    designPack: fixtureDesignManifest,
    localePack: localization.localePack,
    shots: localization.localizedShots,
  });
  const manifests = [zhEpisode, enEpisode, ...campaign.variants].map(validateRenderManifest);
  const contentQuality = {
    zh: analyzeManifestContent(zhEpisode),
    en: analyzeManifestContent(enEpisode),
  };

  await Promise.all(
    manifests.map((manifest) =>
      api('/v1/renders', {
        method: 'POST',
        headers: { 'idempotency-key': `idem_${runId}_${manifest.renderId}` },
        body: JSON.stringify({ manifest, mode: renderMode }),
      }),
    ),
  );
  const completedRenders = await Promise.all(
    manifests.map(async (manifest) => {
      const body = await waitFor<{ render: unknown }>(
        `/v1/renders/${manifest.renderId}`,
        (value) => renderRecordSchema.parse(value.render).status,
      );
      return downloadRender(renderRecordSchema.parse(body.render));
    }),
  );

  const qcSource = completedRenders.find(
    (render) => render.record.manifest.compositionId === 'EpisodeMaster',
  );
  if (!qcSource?.record.outputUri) throw new Error('Chinese EpisodeMaster render is required for QC');
  const qcAccepted = await api<{ qc_run_id: string }>('/v1/qc/run', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_episode_qc` },
    body: JSON.stringify({
      projectId,
      sourceRenderId: qcSource.record.renderId,
      mediaUri: qcSource.record.outputUri,
      mediaType: 'video',
      expectedDescription: `${episode.title}：由 ${sharedShots.length} 个独立剧情镜头组成的 OneCrew 中文正片，无循环补时长。`,
      criteria: [
        '镜头按剧情顺序推进，不得周期性重复同一段画面',
        '角色、场景和动作在相邻镜头之间保持连续',
        '字幕、对白、品牌和安全区适合正式发布',
      ],
      technical: {
        width: renderMode === 'preview' ? 640 : 1920,
        height: renderMode === 'preview' ? 360 : 1080,
        fps: 30,
        durationSec: contentQuality.zh.durationSec,
        durationToleranceSec: 0.35,
        requireAudio: true,
        maxBlackDurationSec: 0.75,
        maxFreezeDurationSec: 1.5,
        ignoreFreezeTailSec: 4.2,
        maxSilenceDurationSec: 18,
        minSceneChanges: Math.max(3, Math.floor(sharedShots.length / 2)),
        minVisualVariationRatio: 0.9,
        subtitleCues: sourcePack.lines.map((line) => ({
          lineId: line.lineId,
          startMs: line.startMs,
          endMs: line.endMs,
        })),
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
    10 * 60_000,
  );
  const qc = qcRunRecordSchema.parse(qcBody.qc_run);
  if (qc.status !== 'succeeded') {
    throw new Error(`Episode QC requires human approval before publishing: ${qc.qcRunId}`);
  }

  const campaignRenders = completedRenders.filter((render) =>
    campaign.variants.some((manifest) => manifest.renderId === render.record.renderId),
  );
  const creatives: CampaignCreative[] = campaignRenders.map(({ record }) => ({
    creativeId: `creative_${record.renderId.replace(/^render_/, '')}`,
    projectId,
    locale: record.manifest.locale,
    compositionId: record.manifest.compositionId as CampaignCreative['compositionId'],
    aspectRatio: record.manifest.aspectRatio,
    renderId: record.renderId,
    mediaUri: record.outputUri!,
    hook: record.manifest.localePack.marketingCopy[0]!,
    cta: record.manifest.localePack.cta,
    platforms: record.manifest.locale === 'zh-CN' ? ['抖音'] : ['TikTok', 'YouTube'],
  }));
  const publishId = `publish_${runId}`;
  const publishResponse = await api<{ publish: unknown }>('/v1/publishes', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${runId}_publish` },
    body: JSON.stringify({
      publishId,
      projectId,
      episode: `EP${String(episode.episodeNumber).padStart(2, '0')}`,
      designPack: fixtureDesignManifest,
      localePacks: [sourcePack, localization.localePack],
      creatives,
      delivery: 'package_export',
    }),
  });
  const publish = publishRecordSchema.parse(publishResponse.publish);
  if (!publish.packageUri) throw new Error('Publish package URI is missing');
  const publishPackage = await mediaStore.get(publish.packageUri);
  const packagePath = path.join(outputDirectory, 'onecrew-publish-package.zip');
  await writeFile(packagePath, publishPackage.bytes);

  const report = {
    runId,
    apiUrl,
    projectId,
    episodeId,
    sourceAssets: selections.map(({ shot, asset }) => ({ shotId: shot.shotId, asset })),
    sourceFiles,
    sourceTts: sourceTts.map(({ candidate, job, audio }) => ({
      shotId: candidate.shot.shotId,
      jobId: job.jobId,
      outputAssetIds: job.outputAssetIds,
      audio,
    })),
    contentQuality,
    localization: {
      localizationRunId: localization.localizationRunId,
      mode: localization.mode,
      localePackId: localization.localePackId,
      lineCount: localization.localePack.lines.length,
    },
    renders: completedRenders.map(({ record, filename, bytes, probe }) => ({
      renderId: record.renderId,
      renderMode: record.renderMode,
      locale: record.manifest.locale,
      compositionId: record.manifest.compositionId,
      outputUri: record.outputUri,
      filename,
      bytes,
      probe,
    })),
    qc,
    publish,
    packagePath,
  };
  await writeFile(path.join(outputDirectory, 'process-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'onecrew_real_project_e2e_complete', report }, null, 2)}\n`);
} finally {
  mediaStore.destroy();
}
