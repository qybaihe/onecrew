import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { loadEnv } from '@onecrew/config';
import {
  generatedAudioSchema,
  generatedImageSchema,
  generatedVideoSchema,
  localizationRunRecordSchema,
  publishRecordSchema,
  qcRunRecordSchema,
  renderRecordSchema,
  type CampaignCreative,
  type LocalePack,
  type RenderManifest,
} from '@onecrew/contracts';
import { buildCampaignPlan, buildLocalizedEpisodeManifest } from '@onecrew/localization';
import { S3MediaStore } from '@onecrew/media';

import { createFixtureManifest, fixtureDesignManifest } from '../src/fixtures.js';

const runFile = promisify(execFile);
const env = loadEnv();
const apiUrl = process.env.ONECREW_API_URL ?? `http://${env.HOST}:${env.PORT}`;
const workspaceRoot = path.resolve(import.meta.dirname, '../../..');
const outputDirectory = path.resolve(
  process.argv[2] ?? path.join(workspaceRoot, 'outputs', 'stage7-process-smoke'),
);
const mediaStore = S3MediaStore.fromEnv(env);
const smokeVersion = process.env.ONECREW_SMOKE_VERSION ?? 'stage7_process_v1';
const renderMode = process.env.ONECREW_RENDER_MODE === 'final' ? 'final' : 'preview';

async function api<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${pathname} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body as T;
}

async function waitFor<T>(
  pathname: string,
  readStatus: (body: T) => string,
  timeoutMs = 15 * 60_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await api<T>(pathname);
    const status = readStatus(body);
    if (status === 'succeeded') return body;
    if (status === 'failed' || status === 'cancelled' || status === 'waiting_human') {
      throw new Error(`${pathname} reached ${status}: ${JSON.stringify(body)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${pathname}`);
}

async function runProviderJob(pathname: string, idempotencySuffix: string, payload: unknown) {
  const accepted = await api<{ job_id: string }>(pathname, {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${smokeVersion}_${idempotencySuffix}` },
    body: JSON.stringify(payload),
  });
  const completed = await waitFor<{
    job: { status: string; outputAssetIds?: string[] };
    output?: unknown;
  }>(
    `/v1/jobs/${accepted.job_id}`,
    (body) => body.job.status,
    60_000,
  );
  return {
    jobId: accepted.job_id,
    output: completed.output,
    outputAssetIds: completed.job.outputAssetIds ?? [],
  };
}

async function synthesizeSourceLine(line: LocalePack['lines'][number]) {
  const accepted = await api<{ job_id: string }>('/v1/audio/synthesize', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${smokeVersion}_tts_${line.lineId}` },
    body: JSON.stringify({
      projectId: 'prj_shanhai_demo',
      route: 'primary',
      lineId: line.lineId,
      text: line.text,
      locale: 'zh-CN',
      voiceId: line.voiceId,
      outputFormat: 'wav_44100',
    }),
  });
  const completed = await waitFor<{
    job: { status: string; outputAssetIds?: string[] };
    output?: unknown;
  }>(
    `/v1/jobs/${accepted.job_id}`,
    (body) => body.job.status,
    60_000,
  );
  return {
    line,
    audio: generatedAudioSchema.parse(completed.output),
    jobId: accepted.job_id,
    outputAssetIds: completed.job.outputAssetIds ?? [],
  };
}

async function downloadRender(record: ReturnType<typeof renderRecordSchema.parse>) {
  if (!record.outputUri) throw new Error(`Render ${record.renderId} has no outputUri`);
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

async function createPoster(render: Awaited<ReturnType<typeof downloadRender>>) {
  const filename = `${render.record.manifest.locale}.poster.jpg`;
  const localPath = path.join(outputDirectory, filename);
  await runFile(env.FFMPEG_PATH, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-ss',
    '2',
    '-i',
    render.localPath,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    localPath,
  ]);
  const bytes = new Uint8Array(await readFile(localPath));
  const stored = await mediaStore.put({
    key: `campaigns/${smokeVersion}/prj_shanhai_demo/posters/${filename}`,
    bytes,
    contentType: 'image/jpeg',
  });
  return { filename, localPath, bytes: bytes.byteLength, uri: stored.uri };
}

await mkdir(outputDirectory, { recursive: true });
await mediaStore.ensureBucket();

try {
  const masterFixture = createFixtureManifest('EpisodeMaster');
  const storyPlan = await runProviderJob(
    '/v1/projects/prj_shanhai_demo/plan',
    'story_plan',
    {
      operation: 'script',
      prompt: '为固定的山海星辰十镜头演示生成结构化剧本计划；保持林遥和岳岚两位角色。',
      locale: 'zh-CN',
      imageUris: [],
      maxOutputTokens: 1_000,
    },
  );
  const referenceImages = await Promise.all(
    masterFixture.shots.map(async (shot, index) => {
      const result = await runProviderJob('/v1/images/generate', `image_${shot.shotId}`, {
        projectId: 'prj_shanhai_demo',
        route: 'primary',
        shotId: shot.shotId,
        prompt: `山海星辰固定演示镜头 ${index + 1} 的电影感参考图，青绿与琥珀色星光。`,
        negativePrompt: 'text, watermark, unstable face, duplicate people',
        referenceUris: [],
        width: 1024,
        height: 576,
        count: 1,
        seed: 7_000 + index,
      });
      return {
        jobId: result.jobId,
        assetIds: result.outputAssetIds,
        image: generatedImageSchema.array().min(1).parse(result.output)[0]!,
      };
    }),
  );
  const generatedVideos = await Promise.all(
    masterFixture.shots.map(async (shot, index) => {
      const result = await runProviderJob('/v1/shots/generate', `video_${shot.shotId}`, {
        projectId: 'prj_shanhai_demo',
        route: 'primary',
        shotId: shot.shotId,
        prompt: `山海星辰固定演示镜头 ${index + 1}，守星人穿越山海裂隙，电影级运镜。`,
        referenceImageUri: referenceImages[index]!.image.uri,
        durationSec: 6,
        aspectRatio: '16:9',
        seed: 8_000 + index,
      });
      return {
        jobId: result.jobId,
        assetIds: result.outputAssetIds,
        video: generatedVideoSchema.array().min(1).parse(result.output)[0]!,
      };
    }),
  );
  const sharedShots = masterFixture.shots.map((shot, index) => ({
    ...shot,
    videoUri: generatedVideos[index]!.video.uri,
  }));
  const sourceAudio = await Promise.all(masterFixture.localePack.lines.map(synthesizeSourceLine));
  const sourcePack: LocalePack = {
    ...masterFixture.localePack,
    version: 1,
    sourceLocale: 'zh-CN',
    translationMode: 'source',
    lines: sourceAudio.map(({ line, audio }) => {
      const shot = sharedShots.find((candidate) => candidate.shotId === line.shotId);
      if (!shot || !audio.durationMs) throw new Error(`Missing shot or duration for ${line.lineId}`);
      const startMs = Math.round((shot.inFrame / masterFixture.fps) * 1_000 + 350);
      return {
        ...line,
        startMs,
        endMs: startMs + audio.durationMs,
        audioUri: audio.uri,
        audioDurationMs: audio.durationMs,
      };
    }),
  };

  const localizationAccepted = await api<{ localization_run_id: string }>('/v1/localizations', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${smokeVersion}_localization` },
    body: JSON.stringify({
      projectId: 'prj_shanhai_demo',
      sourceLocalePack: sourcePack,
      sharedShots,
      targetLocale: 'en-US',
      targetVoiceBySourceVoice: { voice_lin: 'voice_lin_en', voice_yue: 'voice_yue_en' },
      route: 'primary',
      fps: 30,
      lineGapMs: 250,
      leadInMs: 350,
      tailMs: 350,
    }),
  });
  const localizationBody = await waitFor<{ localization_run: unknown; version: number }>(
    `/v1/localizations/${localizationAccepted.localization_run_id}`,
    (body) => localizationRunRecordSchema.parse(body.localization_run).status,
    120_000,
  );
  const localization = localizationRunRecordSchema.parse(localizationBody.localization_run);
  if (!localization.localePack || !localization.localizedShots) throw new Error('Localization output is incomplete');

  const campaign = buildCampaignPlan({
    campaignId: smokeVersion,
    projectId: 'prj_shanhai_demo',
    designPack: fixtureDesignManifest,
    zhLocalePack: sourcePack,
    enLocalePack: localization.localePack,
    zhShots: sharedShots,
    enShots: localization.localizedShots,
  });
  const zhEpisode: RenderManifest = {
    ...masterFixture,
    renderId: `render_${smokeVersion}_zh_episode`,
    localePack: sourcePack,
    shots: sharedShots,
  };
  const enEpisode = buildLocalizedEpisodeManifest({
    renderId: `render_${smokeVersion}_en_episode`,
    projectId: 'prj_shanhai_demo',
    designPack: fixtureDesignManifest,
    localePack: localization.localePack,
    shots: localization.localizedShots,
  });
  const manifests: RenderManifest[] = [zhEpisode, enEpisode, ...campaign.variants].map((manifest) => ({
    ...manifest,
    renderRevision: 2,
  }));
  await Promise.all(
    manifests.map((manifest) =>
      api('/v1/renders', {
        method: 'POST',
        headers: { 'idempotency-key': `idem_${smokeVersion}_${manifest.renderId}` },
        body: JSON.stringify({ manifest, mode: renderMode }),
      }),
    ),
  );
  const completedRenders = await Promise.all(
    manifests.map(async (manifest) => {
      const body = await waitFor<{ render: unknown; version: number }>(
        `/v1/renders/${manifest.renderId}`,
        (value) => renderRecordSchema.parse(value.render).status,
      );
      return downloadRender(renderRecordSchema.parse(body.render));
    }),
  );
  const qcSource = completedRenders.find(
    (render) =>
      render.record.manifest.locale === 'zh-CN' &&
      render.record.manifest.compositionId === 'EpisodeMaster',
  );
  if (!qcSource?.record.outputUri) throw new Error('Chinese EpisodeMaster render is required for QC');
  const qcDurationSec =
    Math.max(...qcSource.record.manifest.shots.map((shot) => shot.outFrame)) /
    qcSource.record.manifest.fps;
  const qcAccepted = await api<{ qc_run_id: string }>('/v1/qc/run', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${smokeVersion}_qc` },
    body: JSON.stringify({
      projectId: 'prj_shanhai_demo',
      sourceRenderId: qcSource.record.renderId,
      mediaUri: qcSource.record.outputUri,
      mediaType: 'video',
      expectedDescription: 'OneCrew full Chinese episode assembled from ten distinct narrative shots with timed dialogue.',
      criteria: [
        'narrative shot variety',
        'low repetition',
        'dialogue coverage',
        'subtitle safe area',
        'audio and visual continuity',
        'compliance',
      ],
      technical: {
        width: renderMode === 'preview' ? 640 : qcSource.record.manifest.output.width,
        height: renderMode === 'preview' ? 360 : qcSource.record.manifest.output.height,
        fps: 30,
        durationSec: qcDurationSec,
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
  const qcBody = await waitFor<{ qc_run: unknown; version: number }>(
    `/v1/qc/runs/${qcAccepted.qc_run_id}`,
    (body) => qcRunRecordSchema.parse(body.qc_run).status,
    120_000,
  );
  const qc = qcRunRecordSchema.parse(qcBody.qc_run);
  const posters = await Promise.all(
    completedRenders
      .filter((render) => render.record.manifest.compositionId === 'MotionPoster')
      .map(createPoster),
  );
  const posterByLocale = new Map(
    completedRenders
      .filter((render) => render.record.manifest.compositionId === 'MotionPoster')
      .map((render, index) => [render.record.manifest.locale, posters[index]!.uri]),
  );
  const campaignRenders = completedRenders.filter((render) =>
    campaign.variants.some((manifest) => manifest.renderId === render.record.renderId),
  );
  const creatives: CampaignCreative[] = campaignRenders.map(({ record }) => ({
    creativeId: `creative_${record.renderId.replace(/^render_/, '')}`,
    projectId: record.projectId,
    locale: record.manifest.locale,
    compositionId: record.manifest.compositionId as CampaignCreative['compositionId'],
    aspectRatio: record.manifest.aspectRatio,
    renderId: record.renderId,
    mediaUri: record.outputUri!,
    hook: record.manifest.localePack.marketingCopy[0]!,
    cta: record.manifest.localePack.cta,
    coverUri: posterByLocale.get(record.manifest.locale),
    platforms: record.manifest.locale === 'zh-CN' ? ['抖音'] : ['TikTok', 'YouTube'],
  }));
  const publishId = `publish_${smokeVersion}`;
  const publishResponse = await api<{ publish: unknown }>('/v1/publishes', {
    method: 'POST',
    headers: { 'idempotency-key': `idem_${smokeVersion}_publish` },
    body: JSON.stringify({
      publishId,
      projectId: 'prj_shanhai_demo',
      episode: 'EP01',
      designPack: fixtureDesignManifest,
      localePacks: [sourcePack, localization.localePack],
      creatives,
      delivery: 'package_export',
    }),
  });
  const publish = publishRecordSchema.parse(publishResponse.publish);
  if (!publish.packageUri) throw new Error('Publish package URI is missing');
  const packageObject = await mediaStore.get(publish.packageUri);
  await writeFile(path.join(outputDirectory, 'onecrew-publish-package.zip'), packageObject.bytes);
  const experiments = await api<{ experiments: unknown[] }>('/v1/projects/prj_shanhai_demo/experiments');
  const localizedDurationSec = Math.max(...localization.localizedShots.map((shot) => shot.outFrame)) / 30;
  const report = {
    smokeVersion,
    apiUrl,
    renderMode,
    providerGeneration: {
      storyPlanJobId: storyPlan.jobId,
      imageJobs: referenceImages.map(({ jobId, assetIds, image }) => ({ jobId, assetIds, uri: image.uri })),
      videoJobs: generatedVideos.map(({ jobId, assetIds, video }) => ({ jobId, assetIds, uri: video.uri })),
    },
    sourceTts: sourceAudio.map(({ line, audio, jobId, outputAssetIds }) => ({
      lineId: line.lineId,
      jobId,
      assetIds: outputAssetIds,
      uri: audio.uri,
      durationMs: audio.durationMs,
    })),
    localization: {
      localizationRunId: localization.localizationRunId,
      localePackId: localization.localePackId,
      mode: localization.mode,
      lineCount: localization.localePack.lines.length,
      localizedDurationSec,
      sharedShotUris: localization.localizedShots.map((shot) => shot.videoUri),
      sameShotAssets: localization.localizedShots.every(
        (shot, index) => shot.videoUri === sharedShots[index]?.videoUri,
      ),
    },
    campaign: { campaignId: campaign.campaignId, variantCount: campaign.variants.length },
    renders: completedRenders.map(({ record, filename, bytes, probe }) => ({
      renderId: record.renderId,
      locale: record.manifest.locale,
      compositionId: record.manifest.compositionId,
      outputUri: record.outputUri,
      filename,
      bytes,
      probe,
    })),
    qc,
    posters,
    publish,
    experimentCount: publish.experimentIds.length,
    projectExperimentLedgerCount: experiments.experiments.length,
  };
  await writeFile(path.join(outputDirectory, 'process-proof.json'), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ event: 'onecrew_mock_e2e_complete', report }, null, 2)}\n`);
} finally {
  mediaStore.destroy();
}
