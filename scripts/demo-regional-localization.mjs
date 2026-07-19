#!/usr/bin/env node
/**
 * OneCrew 出海地域本土化最小演示（Mock 模式）。
 *
 * 链路：地域文化包 → 故事规划（注入文化包）→ 应用 → 10 图 → 10 视频 → 中文 TTS
 *       → PipelineSmoke 渲染（~10s）→ QC → 证据落盘。
 *
 * 用法：
 *   node scripts/demo-regional-localization.mjs [--region america|russia|uk]
 *                                                [--api http://127.0.0.1:3000]
 *                                                [--project prj_shanhai_demo]
 *                                                [--output outputs/regional-demo-america-<ts>]
 *                                                [--dry-run]
 */

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, '..');

// ---------- CLI parsing ----------
const args = process.argv.slice(2);
function readArg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const hasFlag = (name) => args.includes(`--${name}`);
if (hasFlag('help')) {
  console.log(`Usage: node scripts/demo-regional-localization.mjs [--region america|russia|uk] [--api URL] [--project ID] [--output DIR] [--dry-run]`);
  process.exit(0);
}
const REGION = readArg('region', 'america');
if (!['america', 'russia', 'uk'].includes(REGION)) {
  console.error(`Unknown --region ${REGION}; expected america|russia|uk`);
  process.exit(2);
}
const API = readArg('api', process.env.ONECREW_API_URL ?? 'http://127.0.0.1:3000');
const PROJECT_ID = readArg('project', 'prj_shanhai_demo');
const ts = new Date().toISOString().replace(/[:T]/g, '').replace(/\..+$/, '').slice(0, 14);
const OUTPUT = path.resolve(readArg('output', path.join(workspaceRoot, 'outputs', `regional-demo-${REGION}-${ts}`)));
const DRY_RUN = hasFlag('dry-run');
const IDEM_PREFIX = `regional_demo_${REGION}_${ts}`;

const STEPS = [
  'waitForReady',
  'regionalCulturePack',
  'storyPlan',
  'applyStoryPlan',
  'generateImages',
  'generateVideos',
  'synthesizeZhTts',
  'renderPipelineSmoke',
  'runQc',
  'writeProof',
];

if (DRY_RUN) {
  console.log(JSON.stringify({ region: REGION, api: API, project: PROJECT_ID, output: OUTPUT, steps: STEPS }, null, 2));
  process.exit(0);
}

// ---------- HTTP helpers ----------
async function api(pathname, init = {}) {
  const response = await fetch(`${API}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${pathname} → ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitFor(pathname, readStatus, timeoutMs = 10 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await api(pathname);
    const status = readStatus(last);
    if (status === 'succeeded') return last;
    if (['failed', 'cancelled', 'waiting_human'].includes(status)) {
      throw new Error(`${pathname} reached ${status}: ${JSON.stringify(last)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for ${pathname}; last=${JSON.stringify(last)}`);
}

async function submitJob(pathname, idemSuffix, payload) {
  const accepted = await api(pathname, {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_${idemSuffix}` },
    body: JSON.stringify(payload),
  });
  const jobId = accepted.job_id;
  const completed = await waitFor(`/v1/jobs/${jobId}`, (b) => b.job.status);
  return { jobId, accepted, completed };
}

async function ffprobe(filePath) {
  const { stdout } = await runFile('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration',
    '-of', 'json',
    filePath,
  ]);
  return JSON.parse(stdout);
}

// ---------- Main ----------
const proof = {
  region: REGION,
  projectId: PROJECT_ID,
  api: API,
  output: OUTPUT,
  startedAt: new Date().toISOString(),
  steps: {},
};

async function record(step, data) {
  proof.steps[step] = { completedAt: new Date().toISOString(), ...data };
  await mkdir(OUTPUT, { recursive: true });
  await writeFile(path.join(OUTPUT, 'process-proof.json'), JSON.stringify(proof, null, 2));
  console.log(`✓ ${step}`);
}

async function main() {
  await mkdir(OUTPUT, { recursive: true });

  // 1. readiness
  const ready = await api('/readyz').catch((err) => {
    throw new Error(`API /readyz not ready at ${API}: ${err.message}`);
  });
  await record('waitForReady', { ready });

  // 2. regional culture pack
  const cultureResp = await api(`/v1/creative/projects/${PROJECT_ID}/regional-culture-packs`, {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_culture` },
    body: JSON.stringify({
      region: REGION,
      brief: `为现有「山海星辰」项目生成面向 ${REGION} 市场的本土化短剧文化包，并基于 Claimed by the Dragon 等真实出海爆款案例说明创作策略。`,
      route: 'primary',
      generationNonce: Date.now() % 1_000_000,
    }),
  });
  const cultureJobId = cultureResp.job_id;
  const culturePreview = await waitFor(
    `/v1/creative/projects/${PROJECT_ID}/regional-culture-packs/${cultureJobId}`,
    (b) => b.job.status,
  );
  if (!culturePreview.pack) throw new Error('culture pack preview succeeded but pack missing');
  await writeFile(path.join(OUTPUT, 'culture-pack.json'), JSON.stringify(culturePreview.pack, null, 2));
  await record('regionalCulturePack', { jobId: cultureJobId, pack: culturePreview.pack });

  // 3. story plan with culture pack injection
  const storyResp = await api(`/v1/creative/projects/${PROJECT_ID}/story-plans`, {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_story` },
    body: JSON.stringify({
      brief: '生成 1 集含 10 个分镜的出海本土化短剧。',
      episodeCount: 1,
      regionalCulturePackJobId: cultureJobId,
      route: 'primary',
      generationNonce: Date.now() % 1_000_000,
    }),
  });
  const storyJobId = storyResp.job_id;
  const storyPreview = await waitFor(
    `/v1/creative/projects/${PROJECT_ID}/story-plans/${storyJobId}`,
    (b) => b.job.status,
  );
  if (!storyPreview.plan) throw new Error('story plan preview succeeded but plan missing');
  await writeFile(path.join(OUTPUT, 'story-plan.json'), JSON.stringify(storyPreview.plan, null, 2));
  await record('storyPlan', { jobId: storyJobId, episodeCount: storyPreview.plan.episodes.length });

  // 4. apply story plan (need current project version)
  const bundle = await api(`/v1/creative/projects/${PROJECT_ID}`);
  const projectVersion = bundle.project?.version ?? bundle.version ?? 1;
  const applyResp = await api(`/v1/creative/projects/${PROJECT_ID}/story-plans/${storyJobId}/apply`, {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_apply` },
    body: JSON.stringify({ expectedProjectVersion: projectVersion, actorOpenId: 'demo_regional_localization' }),
  });
  await record('applyStoryPlan', { applied: applyResp.applied ?? applyResp });

  // 5. fetch updated bundle and pick the new episode's shots
  const updated = await api(`/v1/creative/projects/${PROJECT_ID}`);
  const episodes = updated.episodes ?? [];
  const latestEpisode = episodes[episodes.length - 1];
  if (!latestEpisode) throw new Error('no episode found after apply');
  const shots = (updated.shots ?? []).filter((s) => s.episodeId === latestEpisode.episodeId);
  if (shots.length === 0) throw new Error(`no shots found for episode ${latestEpisode.episodeId}`);
  const selectedShots = shots.slice(0, 10);
  await record('shotsResolved', { episodeId: latestEpisode.episodeId, shotCount: selectedShots.length });

  // 6. generate images (parallel)
  const imageJobs = await Promise.all(
    selectedShots.map((shot, index) =>
      submitJob('/v1/images/generate', `img_${index}`, {
        projectId: PROJECT_ID,
        shotId: shot.shotId,
        prompt: shot.imagePrompt ?? shot.polishedPrompt ?? shot.prompt ?? `山海星辰镜头 ${index + 1} 本土化电影感参考图`,
        negativePrompt: 'text, watermark, unstable face, duplicate people',
        referenceUris: [],
        width: 1024,
        height: 576,
        count: 1,
        seed: 8000 + index,
        route: 'primary',
        generationNonce: (Date.now() + index) % 1_000_000,
      }),
    ),
  );
  const imageUris = imageJobs.map((j) => {
    const output = j.completed.output;
    const images = output?.images ?? (Array.isArray(output) ? output : []);
    const uri = images[0]?.uri ?? output?.image?.uri;
    if (!uri) throw new Error(`image job ${j.jobId} returned no uri: ${JSON.stringify(output)}`);
    return uri;
  });
  await record('generateImages', { jobIds: imageJobs.map((j) => j.jobId), imageUris });

  // 7. generate videos (parallel)
  const videoJobs = await Promise.all(
    selectedShots.map((shot, index) =>
      submitJob('/v1/shots/generate', `vid_${index}`, {
        projectId: PROJECT_ID,
        shotId: shot.shotId,
        prompt: shot.videoPrompt ?? shot.polishedPrompt ?? shot.prompt ?? `山海星辰镜头 ${index + 1}，电影级运镜`,
        referenceImageUri: imageUris[index],
        durationSec: 6,
        aspectRatio: '16:9',
        seed: 9000 + index,
        route: 'primary',
        generationNonce: (Date.now() + 100 + index) % 1_000_000,
      }),
    ),
  );
  const videoUris = videoJobs.map((j) => {
    const output = j.completed.output;
    const uri = output?.video?.uri ?? output?.uri;
    if (!uri) throw new Error(`video job ${j.jobId} returned no uri: ${JSON.stringify(output)}`);
    return uri;
  });
  await record('generateVideos', { jobIds: videoJobs.map((j) => j.jobId), videoUris });

  // 8. Chinese TTS for dialogue lines (1 line per shot for the demo)
  const ttsJobs = [];
  const ttsUris = [];
  for (let index = 0; index < selectedShots.length; index++) {
    const shot = selectedShots[index];
    const text = shot.dialogue ?? shot.action ?? `镜头 ${index + 1} 本土化台词。`;
    const job = await submitJob('/v1/audio/synthesize', `tts_${index}`, {
      projectId: PROJECT_ID,
      lineId: `line_${REGION}_${index + 1}`,
      text,
      locale: 'zh-CN',
      voiceId: 'voice_lin',
      outputFormat: 'wav_44100',
      seed: 5000 + index,
      route: 'primary',
      generationNonce: (Date.now() + 200 + index) % 1_000_000,
    });
    ttsJobs.push(job.jobId);
    const output = job.completed.output;
    const uri = output?.audio?.uri ?? output?.uri;
    if (uri) ttsUris.push(uri);
  }
  await record('synthesizeZhTts', { jobIds: ttsJobs, audioUris: ttsUris });

  // 9. render PipelineSmoke (~10s = 300 frames @30fps) using first generated shot
  const fps = 30;
  const totalFrames = 300; // ~10s
  const renderId = `render_${IDEM_PREFIX}`;
  const manifest = {
    renderId,
    projectId: PROJECT_ID,
    compositionId: 'PipelineSmoke',
    locale: 'zh-CN',
    aspectRatio: '16:9',
    fps,
    designPack: {
      id: 'shanhai-demo',
      version: '1.0.0_c590888620ae',
      resolution: { hash: 'c590888620ae', algorithm: 'sha256' },
    },
    localePack: {
      projectId: PROJECT_ID,
      locale: 'zh-CN',
      title: `山海星辰 · ${REGION} 本土化`,
      lines: [{
        lineId: `line_${REGION}_1`,
        shotId: selectedShots[0].shotId,
        speaker: '林遥',
        text: selectedShots[0].dialogue ?? '星图没有消失，它在等我们。',
        startMs: 500,
        endMs: 4_500,
        voiceId: 'voice_lin',
      }],
      cta: '立即启程',
      marketingCopy: ['最后一角星图，藏在山海尽头。'],
    },
    shots: [{
      shotId: selectedShots[0].shotId,
      videoUri: videoUris[0],
      inFrame: 0,
      outFrame: totalFrames,
      sourceStartFrame: 0,
      sourceEndFrame: 180,
      crop: { x: 0.5, y: 0.5, scale: 1.05 },
    }],
    output: { codec: 'h264', width: 1920, height: 1080 },
  };
  await writeFile(path.join(OUTPUT, 'render-manifest.json'), JSON.stringify(manifest, null, 2));
  await api('/v1/renders', {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_render` },
    body: JSON.stringify({ manifest, mode: 'final' }),
  });
  const renderBody = await waitFor(`/v1/renders/${renderId}`, (b) => b.render.status, 15 * 60_000);
  const render = renderBody.render;
  if (!render.outputUri) throw new Error('render succeeded but outputUri missing');

  // download the MP4
  const downloadUrl = render.outputUri.startsWith('s3://')
    ? (await api(`/v1/renders/${renderId}/download`)).url ?? render.outputUri
    : render.outputUri;
  const mp4Path = path.join(OUTPUT, 'pipeline-smoke.mp4');
  const mp4Response = await fetch(downloadUrl);
  if (!mp4Response.ok) throw new Error(`failed to download render from ${downloadUrl}: ${mp4Response.status}`);
  const mp4Buffer = Buffer.from(await mp4Response.arrayBuffer());
  await writeFile(mp4Path, mp4Buffer);
  const probe = await ffprobe(mp4Path);
  const durationSec = Number(probe.format?.duration ?? 0);
  if (durationSec < 8 || durationSec > 12) {
    throw new Error(`render duration ${durationSec}s out of expected [8,12]s window`);
  }
  const videoStream = probe.streams?.find((s) => s.codec_type === 'video');
  const audioStream = probe.streams?.find((s) => s.codec_type === 'audio');
  if (videoStream?.codec_name !== 'h264') throw new Error(`unexpected video codec ${videoStream?.codec_name}`);
  if (!audioStream || !['aac', 'mp3', 'pcm_s16le'].includes(audioStream.codec_name)) {
    throw new Error(`unexpected audio stream ${JSON.stringify(audioStream)}`);
  }
  await record('renderPipelineSmoke', { renderId, outputUri: render.outputUri, mp4Path, durationSec, probe });

  // 10. QC run
  const qcAccepted = await api('/v1/qc/run', {
    method: 'POST',
    headers: { 'idempotency-key': `${IDEM_PREFIX}_qc` },
    body: JSON.stringify({
      projectId: PROJECT_ID,
      sourceRenderId: renderId,
      mediaUri: render.outputUri,
      mediaType: 'video',
      expectedDescription: `OneCrew ${REGION} localized short-drama PipelineSmoke clip assembled from one LLM-generated shot with timed Chinese dialogue.`,
      criteria: ['narrative coherence', 'audio presence', 'regional motif compliance'],
      technical: {
        width: 1920,
        height: 1080,
        fps,
        durationSec,
        durationToleranceSec: 0.5,
        requireAudio: true,
        maxBlackDurationSec: 1.0,
        maxFreezeDurationSec: 2.0,
        ignoreFreezeTailSec: 0,
        maxSilenceDurationSec: 12,
        minSceneChanges: 1,
        minVisualVariationRatio: 0.1,
        subtitleCues: [],
      },
      route: 'primary',
      qualityAttempt: 1,
      autoRemediate: false,
      remediation: 'remotion',
    }),
  });
  const qcBody = await waitFor(`/v1/qc/runs/${qcAccepted.qc_run_id}`, (b) => b.qc_run.status, 10 * 60_000);
  await writeFile(path.join(OUTPUT, 'qc-run.json'), JSON.stringify(qcBody.qc_run, null, 2));
  await record('runQc', { qcRunId: qcAccepted.qc_run_id, verdict: qcBody.qc_run.verdict ?? qcBody.qc_run.status });

  proof.finishedAt = new Date().toISOString();
  await writeFile(path.join(OUTPUT, 'process-proof.json'), JSON.stringify(proof, null, 2));
  console.log(`\n✅ regional localization demo complete: ${OUTPUT}`);
}

main().catch(async (err) => {
  proof.error = err.message;
  proof.finishedAt = new Date().toISOString();
  await mkdir(OUTPUT, { recursive: true }).catch(() => {});
  await writeFile(path.join(OUTPUT, 'process-proof.json'), JSON.stringify(proof, null, 2)).catch(() => {});
  console.error(`\n❌ demo failed: ${err.message}`);
  process.exit(1);
});
