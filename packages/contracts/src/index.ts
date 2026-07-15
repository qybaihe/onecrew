import { z } from 'zod';

export const localeSchema = z.enum(['zh-CN', 'en-US']);
export const aspectRatioSchema = z.enum(['16:9', '9:16', '1:1']);
export const projectStatusSchema = z.enum(['draft', 'running', 'waiting_human', 'done', 'failed']);
export const shotStatusSchema = z.enum(['planned', 'generating', 'qc', 'approved', 'failed']);
export const assetStatusSchema = z.enum(['draft', 'approved', 'rejected', 'archived']);
export const jobStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_human',
  'succeeded',
  'failed',
  'cancelled',
]);
export const renderStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const renderModeSchema = z.enum(['preview', 'final']);
export const providerModeSchema = z.enum(['mock', 'sandbox', 'real']);
export const capabilitySchema = z.enum([
  'plan',
  'design_compile',
  'image',
  'video',
  'tts',
  'lipsync',
  'qc',
  'remotion_preview',
  'remotion_final',
  'publish',
]);
export const compositionIdSchema = z.enum([
  'EpisodeMaster',
  'EpisodeLocalized',
  'Trailer30',
  'Teaser15Vertical',
  'Bumper6',
  'MotionPoster',
]);
export const assetTypeSchema = z.enum([
  'character',
  'scene',
  'prop',
  'image',
  'video',
  'audio',
  'font',
  'logo',
  'design_pack',
  'template',
  'poster',
]);
export const qcDecisionSchema = z.enum(['pass', 'regenerate', 'switch_model', 'manual']);
export const qcRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_provider',
  'waiting_human',
  'succeeded',
  'failed',
  'cancelled',
]);
export const localizationRunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting_provider',
  'succeeded',
  'failed',
  'cancelled',
]);
export const publishStatusSchema = z.enum(['building', 'succeeded', 'failed']);
export const experimentPlatformSchema = z.enum(['抖音', 'TikTok', 'YouTube', '其他']);
export const feishuCardActionNameSchema = z.enum([
  'approve',
  'regenerate',
  'switch_provider',
  'manual',
]);

const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const isoTimestampSchema = z.iso.datetime({ offset: true });
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const nonNegativeMoneySchema = z.number().finite().nonnegative();

export const creativeSourceSchema = z.object({
  system: z.enum(['onecrew', 'local-mini-drama', 'manual', 'import']),
  version: z.string().min(1).max(80).optional(),
  reference: z.string().min(1).max(2_000).optional(),
  license: z.string().min(1).max(200).optional(),
  importedAt: isoTimestampSchema.optional(),
});

export const episodeStatusSchema = z.enum(['draft', 'planning', 'ready', 'rendered', 'archived']);
export const creativeEntityStatusSchema = z.enum(['draft', 'ready', 'archived']);
export const creativeEntityKindSchema = z.enum(['character', 'scene', 'prop']);
export const creationModeSchema = z.enum(['classic', 'universal']);
export const frameTypeSchema = z.enum(['first', 'last', 'key']);

export const continuityCharacterStateSchema = z.object({
  position: z.string().max(500).optional(),
  clothing: z.string().max(1_000).optional(),
  expression: z.string().max(500).optional(),
  props: z.array(idSchema).default([]),
});

export const continuitySnapshotSchema = z.object({
  sourceShotId: idSchema.optional(),
  characters: z.record(idSchema, continuityCharacterStateSchema).default({}),
  lighting: z.string().max(1_000).optional(),
  cameraAxis: z.string().max(500).optional(),
  notes: z.string().max(4_000).optional(),
});

export const episodeSpecSchema = z.object({
  episodeId: idSchema,
  projectId: idSchema,
  episodeNumber: z.number().int().positive(),
  title: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  scriptContent: z.string().max(200_000).default(''),
  durationSec: z.number().finite().nonnegative().max(7_200).default(0),
  characterIds: z.array(idSchema).default([]),
  sceneIds: z.array(idSchema).default([]),
  propIds: z.array(idSchema).default([]),
  status: episodeStatusSchema.default('draft'),
  source: creativeSourceSchema.optional(),
});

const creativeEntityBaseSchema = z.object({
  entityId: idSchema,
  projectId: idSchema,
  episodeId: idSchema.optional(),
  name: z.string().min(1).max(300),
  description: z.string().max(10_000).optional(),
  prompt: z.string().max(20_000).optional(),
  polishedPrompt: z.string().max(20_000).optional(),
  negativePrompt: z.string().max(10_000).optional(),
  referenceAssetIds: z.array(idSchema).default([]),
  extraAssetIds: z.array(idSchema).default([]),
  sortOrder: z.number().int().nonnegative().default(0),
  status: creativeEntityStatusSchema.default('draft'),
  source: creativeSourceSchema.optional(),
});

export const characterSpecSchema = creativeEntityBaseSchema.extend({
  kind: z.literal('character'),
  role: z.string().max(500).optional(),
  personality: z.string().max(4_000).optional(),
  appearance: z.string().max(10_000).optional(),
  voiceStyle: z.string().max(2_000).optional(),
  identityAnchors: z.array(z.string().min(1).max(1_000)).default([]),
  styleTokens: z.array(z.string().min(1).max(500)).default([]),
  colorPalette: z.array(z.string().min(1).max(100)).default([]),
  stages: z
    .array(
      z.object({
        stageId: idSchema,
        name: z.string().min(1).max(200),
        description: z.string().max(4_000).optional(),
        clothing: z.string().max(2_000).optional(),
        referenceAssetIds: z.array(idSchema).default([]),
      }),
    )
    .default([]),
  providerAssetRef: z.string().max(2_000).optional(),
});

export const sceneSpecSchema = creativeEntityBaseSchema.extend({
  kind: z.literal('scene'),
  location: z.string().min(1).max(500),
  timeOfDay: z.string().max(200).optional(),
  atmosphere: z.string().max(2_000).optional(),
  lightingStyle: z.string().max(2_000).optional(),
});

export const propSpecSchema = creativeEntityBaseSchema.extend({
  kind: z.literal('prop'),
  category: z.string().max(300).optional(),
});

export const creativeEntitySchema = z.discriminatedUnion('kind', [
  characterSpecSchema,
  sceneSpecSchema,
  propSpecSchema,
]);

export const framePromptSpecSchema = z.object({
  framePromptId: idSchema,
  shotId: idSchema,
  frameType: frameTypeSchema,
  prompt: z.string().min(1).max(20_000),
  description: z.string().max(4_000).optional(),
  layout: z.string().max(10_000).optional(),
  boundAssetId: idSchema.optional(),
  source: creativeSourceSchema.optional(),
});

export const projectSpecSchema = z.object({
  projectId: idSchema,
  nameZh: z.string().min(1).max(200),
  nameEn: z.string().min(1).max(200),
  synopsis: z.string().min(1).max(10_000),
  audience: z.string().min(1).max(1_000),
  genres: z.array(z.string().min(1).max(80)).min(1),
  ownerOpenId: idSchema,
  locales: z.array(localeSchema).min(1).max(2),
  aspectRatios: z.array(aspectRatioSchema).min(1).max(3),
  budgetLimitCny: nonNegativeMoneySchema,
  designSystemId: idSchema.optional(),
  style: z.string().max(500).optional(),
  tags: z.array(z.string().min(1).max(100)).optional(),
  totalEpisodes: z.number().int().positive().optional(),
  source: creativeSourceSchema.optional(),
  status: projectStatusSchema,
});

export const shotSpecSchema = z.object({
  shotId: idSchema,
  projectId: idSchema,
  sequence: z.number().int().positive(),
  durationSec: z.number().positive().max(120),
  characters: z.array(idSchema),
  sceneId: idSchema,
  episodeId: idSchema.optional(),
  propIds: z.array(idSchema).optional(),
  title: z.string().max(500).optional(),
  description: z.string().max(10_000).optional(),
  location: z.string().max(500).optional(),
  timeOfDay: z.string().max(200).optional(),
  action: z.string().min(1).max(5_000),
  camera: z.string().min(1).max(1_000),
  dialogueZh: z.string().max(5_000).optional(),
  narrationZh: z.string().max(5_000).optional(),
  atmosphere: z.string().max(2_000).optional(),
  result: z.string().max(2_000).optional(),
  shotType: z.string().max(200).optional(),
  cameraAngle: z
    .object({
      horizontal: z.string().max(200).optional(),
      vertical: z.string().max(200).optional(),
      side: z.string().max(200).optional(),
    })
    .optional(),
  movement: z.string().max(500).optional(),
  lightingStyle: z.string().max(1_000).optional(),
  depthOfField: z.string().max(500).optional(),
  prompt: z.string().min(1).max(10_000),
  imagePrompt: z.string().max(20_000).optional(),
  polishedPrompt: z.string().max(20_000).optional(),
  videoPrompt: z.string().max(20_000).optional(),
  negativePrompt: z.string().max(5_000).optional(),
  referenceAssetIds: z.array(idSchema),
  framePromptIds: z.array(idSchema).optional(),
  firstFrameAssetId: idSchema.optional(),
  lastFrameAssetId: idSchema.optional(),
  emotion: z.string().max(500).optional(),
  emotionIntensity: z.number().min(0).max(1).optional(),
  segmentIndex: z.number().int().nonnegative().optional(),
  segmentTitle: z.string().max(500).optional(),
  continuity: continuitySnapshotSchema.optional(),
  creationMode: creationModeSchema.optional(),
  universalSegmentText: z.string().max(20_000).optional(),
  layoutDescription: z.string().max(10_000).optional(),
  source: creativeSourceSchema.optional(),
  importance: z.enum(['normal', 'hero']),
  closeupDialogue: z.boolean(),
  status: shotStatusSchema,
});

export const creativeProjectBundleSchema = z
  .object({
    bundleVersion: z.literal('1.0'),
    source: creativeSourceSchema,
    project: projectSpecSchema,
    episodes: z.array(episodeSpecSchema).min(1),
    entities: z.array(creativeEntitySchema),
    shots: z.array(shotSpecSchema),
    framePrompts: z.array(framePromptSpecSchema).default([]),
    mediaFiles: z
      .array(
        z.object({
          sourcePath: z.string().min(1).max(2_000),
          mediaType: z.enum(['image', 'video', 'audio']),
          ownerType: z.enum(['entity', 'shot', 'frame']),
          ownerId: idSchema,
          role: z.string().min(1).max(200),
          originalId: z.union([z.string(), z.number()]).optional(),
        }),
      )
      .default([]),
  })
  .superRefine((bundle, context) => {
    const projectId = bundle.project.projectId;
    const episodeIds = new Set(bundle.episodes.map((episode) => episode.episodeId));
    const entityIds = new Set(bundle.entities.map((entity) => entity.entityId));
    const shotIds = new Set(bundle.shots.map((shot) => shot.shotId));
    for (const [index, episode] of bundle.episodes.entries()) {
      if (episode.projectId !== projectId) {
        context.addIssue({ code: 'custom', path: ['episodes', index, 'projectId'], message: 'must match project' });
      }
    }
    for (const [index, entity] of bundle.entities.entries()) {
      if (entity.projectId !== projectId) {
        context.addIssue({ code: 'custom', path: ['entities', index, 'projectId'], message: 'must match project' });
      }
    }
    for (const [index, shot] of bundle.shots.entries()) {
      if (shot.projectId !== projectId) {
        context.addIssue({ code: 'custom', path: ['shots', index, 'projectId'], message: 'must match project' });
      }
      if (shot.episodeId && !episodeIds.has(shot.episodeId)) {
        context.addIssue({ code: 'custom', path: ['shots', index, 'episodeId'], message: 'must reference an episode' });
      }
      if (!entityIds.has(shot.sceneId)) {
        context.addIssue({ code: 'custom', path: ['shots', index, 'sceneId'], message: 'must reference a scene' });
      }
    }
    for (const [index, frame] of bundle.framePrompts.entries()) {
      if (!shotIds.has(frame.shotId)) {
        context.addIssue({ code: 'custom', path: ['framePrompts', index, 'shotId'], message: 'must reference a shot' });
      }
    }
  });

export const designPackManifestSchema = z.object({
  designSystemId: idSchema,
  version: z.string().min(1).max(80),
  designMdUri: z.url(),
  brandTokensUri: z.url(),
  motionTokensUri: z.url(),
  promoSpecUri: z.url(),
  assetUris: z.array(z.url()),
  source: z.enum(['open-design', 'manual']),
  sourceLicense: z.string().min(1).max(2_000).optional(),
  createdAt: isoTimestampSchema,
});

export const localeLineSchema = z
  .object({
    lineId: idSchema,
    sourceLineId: idSchema.optional(),
    shotId: idSchema,
    speaker: z.string().min(1).max(200),
    text: z.string().min(1).max(5_000),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    voiceId: idSchema,
    audioAssetId: idSchema.optional(),
    audioUri: z.url().optional(),
    audioDurationMs: z.number().int().positive().optional(),
    translationNotes: z.string().min(1).max(1_000).optional(),
  })
  .refine((line) => line.endMs > line.startMs, {
    message: 'endMs must be greater than startMs',
    path: ['endMs'],
  });

export const localePackSchema = z.object({
  projectId: idSchema,
  locale: localeSchema,
  version: z.number().int().positive().optional(),
  sourceLocale: localeSchema.optional(),
  translationMode: z.enum(['source', 'mock', 'sandbox', 'real', 'manual']).optional(),
  title: z.string().min(1).max(300),
  lines: z.array(localeLineSchema),
  cta: z.string().min(1).max(500),
  marketingCopy: z.array(z.string().min(1).max(1_000)),
  shotTimingAdjustments: z
    .array(
      z.object({
        shotId: idSchema,
        sourceStartFrame: z.number().int().nonnegative(),
        sourceEndFrame: z.number().int().positive(),
        localizedStartFrame: z.number().int().nonnegative(),
        localizedEndFrame: z.number().int().positive(),
      }),
    )
    .optional(),
});

export const renderShotSchema = z
  .object({
    shotId: idSchema,
    videoUri: z.url(),
    inFrame: z.number().int().nonnegative(),
    outFrame: z.number().int().positive(),
    crop: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        scale: z.number().positive(),
      })
      .optional(),
  })
  .refine((shot) => shot.outFrame > shot.inFrame, {
    message: 'outFrame must be greater than inFrame',
    path: ['outFrame'],
  });

export const renderManifestSchema = z.object({
  renderId: idSchema,
  renderRevision: z.number().int().nonnegative().optional(),
  projectId: idSchema,
  compositionId: compositionIdSchema,
  locale: localeSchema,
  aspectRatio: aspectRatioSchema,
  fps: z.literal(30),
  designPack: designPackManifestSchema,
  localePack: localePackSchema,
  shots: z.array(renderShotSchema).min(1),
  musicUri: z.url().optional(),
  output: z.object({
    codec: z.literal('h264'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
});

export const renderSubmissionSchema = z.object({
  manifest: renderManifestSchema,
  mode: renderModeSchema.default('preview'),
});

export const localizedTextPackSchema = z.object({
  title: z.string().min(1).max(300),
  cta: z.string().min(1).max(500),
  marketingCopy: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  lines: z
    .array(
      z.object({
        sourceLineId: idSchema,
        speaker: z.string().min(1).max(200),
        text: z.string().min(1).max(5_000),
        translationNotes: z.string().min(1).max(1_000).optional(),
      }),
    )
    .min(1),
});

export const localizationRequestSchema = z
  .object({
    projectId: idSchema,
    sourceLocalePack: localePackSchema,
    sharedShots: z.array(renderShotSchema).min(1).max(200),
    targetLocale: z.literal('en-US'),
    targetVoiceBySourceVoice: z.record(idSchema, idSchema),
    route: z.enum(['primary', 'fallback']).default('primary'),
    fps: z.literal(30).default(30),
    lineGapMs: z.number().int().min(0).max(5_000).default(250),
    leadInMs: z.number().int().min(0).max(5_000).default(350),
    tailMs: z.number().int().min(0).max(5_000).default(350),
  })
  .superRefine((value, context) => {
    if (value.sourceLocalePack.locale !== 'zh-CN') {
      context.addIssue({ code: 'custom', path: ['sourceLocalePack', 'locale'], message: 'must be zh-CN' });
    }
    if (value.sourceLocalePack.projectId !== value.projectId) {
      context.addIssue({ code: 'custom', path: ['sourceLocalePack', 'projectId'], message: 'must match projectId' });
    }
    const shotIds = new Set(value.sharedShots.map((shot) => shot.shotId));
    for (const [index, line] of value.sourceLocalePack.lines.entries()) {
      if (!shotIds.has(line.shotId)) {
        context.addIssue({
          code: 'custom',
          path: ['sourceLocalePack', 'lines', index, 'shotId'],
          message: 'must reference sharedShots',
        });
      }
      if (!value.targetVoiceBySourceVoice[line.voiceId]) {
        context.addIssue({
          code: 'custom',
          path: ['targetVoiceBySourceVoice', line.voiceId],
          message: 'target voice is required for every source voice',
        });
      }
    }
  });

export const localizationRunRecordSchema = z.object({
  localizationRunId: idSchema,
  request: localizationRequestSchema,
  status: localizationRunStatusSchema,
  translationJobId: idSchema.optional(),
  ttsJobIds: z.array(idSchema).default([]),
  localePackId: idSchema.optional(),
  localePack: localePackSchema.optional(),
  localizedShots: z.array(renderShotSchema).optional(),
  mode: providerModeSchema.optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const localePackRecordSchema = z.object({
  localePackId: idSchema,
  projectId: idSchema,
  locale: localeSchema,
  version: z.number().int().positive(),
  pack: localePackSchema,
  sourceLocalizationRunId: idSchema.optional(),
  contentHash: sha256Schema,
  createdAt: isoTimestampSchema,
});

export const asyncLocalizationAcceptedSchema = z.object({
  localizationRunId: idSchema,
  status: localizationRunStatusSchema,
  statusUrl: z.string().startsWith('/v1/localizations/'),
  replayed: z.boolean().default(false),
});

export const campaignCreativeSchema = z.object({
  creativeId: idSchema,
  projectId: idSchema,
  locale: localeSchema,
  compositionId: z.enum(['Trailer30', 'Teaser15Vertical', 'Bumper6', 'MotionPoster']),
  aspectRatio: aspectRatioSchema,
  renderId: idSchema,
  mediaUri: z.url(),
  hook: z.string().min(1).max(1_000),
  cta: z.string().min(1).max(500),
  coverUri: z.url().optional(),
  platforms: z.array(experimentPlatformSchema).min(1).max(4),
});

export const campaignPlanSchema = z.object({
  campaignId: idSchema,
  projectId: idSchema,
  sharedShotIds: z.array(idSchema).min(1),
  variants: z.array(renderManifestSchema).min(8),
});

export const experimentRecordSchema = z.object({
  experimentId: idSchema,
  projectId: idSchema,
  creativeId: idSchema,
  episode: z.string().min(1).max(200),
  language: localeSchema,
  platform: experimentPlatformSchema,
  hook: z.string().min(1).max(1_000),
  coverUri: z.url().optional(),
  spend: nonNegativeMoneySchema.default(0),
  retention3s: z.number().min(0).max(1).default(0),
  retention15s: z.number().min(0).max(1).default(0),
  ctr: z.number().min(0).max(1).default(0),
  conversion: z.number().min(0).max(1).default(0),
  roas: z.number().nonnegative().default(0),
  recommendation: z.string().min(1).max(4_000),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const publishRequestSchema = z
  .object({
    publishId: idSchema,
    projectId: idSchema,
    episode: z.string().min(1).max(200),
    designPack: designPackManifestSchema,
    localePacks: z.array(localePackSchema).length(2),
    creatives: z.array(campaignCreativeSchema).min(8).max(100),
    delivery: z.literal('package_export').default('package_export'),
  })
  .superRefine((value, context) => {
    const locales = new Set(value.localePacks.map((pack) => pack.locale));
    if (!locales.has('zh-CN') || !locales.has('en-US')) {
      context.addIssue({ code: 'custom', path: ['localePacks'], message: 'must contain zh-CN and en-US' });
    }
    for (const [index, creative] of value.creatives.entries()) {
      if (creative.projectId !== value.projectId) {
        context.addIssue({ code: 'custom', path: ['creatives', index, 'projectId'], message: 'must match projectId' });
      }
    }
  });

export const publishRecordSchema = z.object({
  publishId: idSchema,
  request: publishRequestSchema,
  status: publishStatusSchema,
  packageUri: z.url().optional(),
  packageHash: sha256Schema.optional(),
  packageBytes: z.number().int().positive().optional(),
  experimentIds: z.array(idSchema).default([]),
  feishuWriteback: z.enum(['sent', 'mock_outbox', 'unconfigured']).optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const jobRecordSchema = z.object({
  jobId: idSchema,
  projectId: idSchema,
  shotId: idSchema.optional(),
  capability: capabilitySchema,
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  mode: providerModeSchema,
  status: jobStatusSchema,
  attempt: z.number().int().positive(),
  estimatedCostCny: nonNegativeMoneySchema.optional(),
  actualCostCny: nonNegativeMoneySchema.optional(),
  latencyMs: z.number().int().nonnegative().optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
  inputHash: sha256Schema,
  outputAssetIds: z.array(idSchema),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const assetRecordSchema = z.object({
  assetId: idSchema,
  projectId: idSchema,
  shotId: idSchema.optional(),
  type: assetTypeSchema,
  version: z.number().int().positive(),
  parentAssetId: idSchema.optional(),
  uri: z.url(),
  thumbnailUri: z.url().optional(),
  provider: z.string().min(1).max(200),
  model: z.string().min(1).max(200),
  seed: z.string().max(200).optional(),
  source: z.string().min(1).max(2_000),
  license: z.string().min(1).max(2_000),
  contentHash: sha256Schema,
  status: assetStatusSchema,
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const qcScoresSchema = z.object({
  character: z.number().min(0).max(1),
  clothing: z.number().min(0).max(1),
  background: z.number().min(0).max(1),
  action: z.number().min(0).max(1),
  flicker: z.number().min(0).max(1),
  lipsync: z.number().min(0).max(1),
  subtitle: z.number().min(0).max(1),
  brand: z.number().min(0).max(1),
  safeArea: z.number().min(0).max(1),
  audio: z.number().min(0).max(1),
  compliance: z.number().min(0).max(1),
});

export const qcIntervalSchema = z.object({
  startSec: z.number().finite().nonnegative(),
  endSec: z.number().finite().nonnegative(),
  durationSec: z.number().finite().nonnegative(),
});

export const technicalQcCheckSchema = z.object({
  code: z.string().min(1).max(120),
  passed: z.boolean(),
  severity: z.enum(['info', 'warning', 'error']),
  reason: z.string().min(1).max(1_000),
  actual: z.union([z.string(), z.number(), z.boolean()]).optional(),
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const technicalQcExpectationSchema = z.object({
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  fps: z.number().positive().max(120).optional(),
  durationSec: z.number().positive().max(7_200).optional(),
  durationToleranceSec: z.number().nonnegative().max(10).default(0.35),
  requireAudio: z.boolean().default(false),
  allowedVideoCodecs: z.array(z.string().min(1)).min(1).default(['h264']),
  allowedAudioCodecs: z.array(z.string().min(1)).min(1).default(['aac', 'mp3']),
  allowedPixelFormats: z.array(z.string().min(1)).min(1).default(['yuv420p']),
  colorSpace: z.string().min(1).optional(),
  maxBlackDurationSec: z.number().nonnegative().max(60).default(0.75),
  maxFreezeDurationSec: z.number().nonnegative().max(60).default(1.5),
  maxSilenceDurationSec: z.number().nonnegative().max(600).default(2),
  minIntegratedLufs: z.number().min(-100).max(0).optional(),
  maxIntegratedLufs: z.number().min(-100).max(0).optional(),
  maxTruePeakDbtp: z.number().min(-100).max(20).optional(),
  maxBrightnessJump: z.number().positive().max(255).default(70),
  subtitleCues: z
    .array(
      z.object({
        lineId: idSchema,
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive(),
      }),
    )
    .default([]),
});

export const technicalQcReportSchema = z.object({
  passed: z.boolean(),
  probe: z.object({
    durationSec: z.number().finite().nonnegative(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    fps: z.number().finite().nonnegative(),
    videoCodec: z.string().min(1),
    pixelFormat: z.string().min(1),
    colorRange: z.string().min(1).optional(),
    colorSpace: z.string().min(1).optional(),
    audioCodec: z.string().min(1).optional(),
    sampleRate: z.number().int().nonnegative().optional(),
    channels: z.number().int().nonnegative().optional(),
    bitRate: z.number().int().nonnegative().optional(),
  }),
  blackSegments: z.array(qcIntervalSchema),
  freezeSegments: z.array(qcIntervalSchema),
  silenceSegments: z.array(qcIntervalSchema),
  integratedLufs: z.number().finite().optional(),
  truePeakDbtp: z.number().finite().optional(),
  maxBrightnessJump: z.number().finite().nonnegative().optional(),
  checks: z.array(technicalQcCheckSchema).min(1),
  analyzedAt: isoTimestampSchema,
});

export const qcRunRequestSchema = z.object({
  projectId: idSchema,
  shotId: idSchema.optional(),
  sourceAssetId: idSchema.optional(),
  sourceJobId: idSchema.optional(),
  sourceRenderId: idSchema.optional(),
  mediaUri: z.url(),
  mediaType: z.enum(['image', 'video']),
  expectedDescription: z.string().min(1).max(10_000),
  criteria: z.array(z.string().min(1).max(500)).min(1).max(50),
  technical: technicalQcExpectationSchema.prefault({}),
  route: z.enum(['primary', 'fallback']).default('primary'),
  qualityAttempt: z.number().int().min(1).max(100).default(1),
  autoRemediate: z.boolean().default(true),
  remediation: z.enum(['generation', 'remotion']).default('generation'),
});

export const qcRunRecordSchema = z.object({
  qcRunId: idSchema,
  request: qcRunRequestSchema,
  status: qcRunStatusSchema,
  technicalReport: technicalQcReportSchema.optional(),
  semanticReport: z
    .object({
      scores: qcScoresSchema,
      decision: qcDecisionSchema,
      reason: z.string().min(1).max(4_000),
      retryPatch: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  decision: qcDecisionSchema.optional(),
  reason: z.string().min(1).max(4_000).optional(),
  retryPatch: z.record(z.string(), z.unknown()).optional(),
  vlmJobId: idSchema.optional(),
  remediationJobId: idSchema.optional(),
  remediationRenderId: idSchema.optional(),
  qcRecordId: idSchema.optional(),
  gateId: idSchema.optional(),
  reviewCard: z.record(z.string(), z.unknown()).optional(),
  reviewDelivery: z.enum(['mock_outbox', 'sent', 'unconfigured']).optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const asyncQcAcceptedSchema = z.object({
  qcRunId: idSchema,
  status: z.enum([
    'queued',
    'running',
    'waiting_provider',
    'waiting_human',
    'succeeded',
    'failed',
    'cancelled',
  ]),
  statusUrl: z.string().startsWith('/v1/qc/runs/'),
  replayed: z.boolean().default(false),
});

export const qcRecordSchema = z.object({
  qcId: idSchema,
  qcRunId: idSchema.optional(),
  projectId: idSchema,
  shotId: idSchema.optional(),
  scores: qcScoresSchema,
  decision: qcDecisionSchema,
  reason: z.string().min(1).max(4_000),
  retryPatch: z.record(z.string(), z.unknown()).optional(),
  technicalReport: technicalQcReportSchema.optional(),
  semanticProviderJobId: idSchema.optional(),
  createdAt: isoTimestampSchema,
});

export const renderRecordSchema = z.object({
  renderId: idSchema,
  projectId: idSchema,
  manifest: renderManifestSchema,
  renderMode: renderModeSchema,
  status: renderStatusSchema,
  manifestHash: sha256Schema,
  designPackVersion: z.string().min(1).max(80),
  codeVersion: z.string().min(1).max(200),
  outputUri: z.url().optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
  createdAt: isoTimestampSchema,
  updatedAt: isoTimestampSchema,
});

export const asyncRenderAcceptedSchema = z.object({
  renderId: idSchema,
  status: z.enum(['queued', 'succeeded']),
  mode: renderModeSchema,
  statusUrl: z.string().startsWith('/v1/renders/'),
  replayed: z.boolean().default(false),
  cached: z.boolean().default(false),
});

export const feishuCardActionSchema = z.object({
  action: feishuCardActionNameSchema,
  projectId: idSchema,
  targetType: z.enum(['story', 'design', 'shot', 'asset', 'job', 'render', 'release']),
  targetId: idSchema,
  expectedVersion: z.number().int().positive(),
  actorOpenId: idSchema,
  eventId: idSchema,
});

export const humanGateSchema = z.object({
  gateId: idSchema,
  workflowId: idSchema,
  projectId: idSchema,
  node: z.string().min(1).max(200),
  targetType: feishuCardActionSchema.shape.targetType,
  targetId: idSchema,
  expectedTargetVersion: z.number().int().positive(),
  status: z.enum(['waiting', 'resolved', 'cancelled']),
  resolution: feishuCardActionNameSchema.optional(),
  actorOpenId: idSchema.optional(),
  eventId: idSchema.optional(),
  version: z.number().int().positive(),
  createdAt: isoTimestampSchema,
  resolvedAt: isoTimestampSchema.optional(),
});

export const providerCapabilitySchema = z.enum(['llm', 'image', 'video', 'tts', 'vlm']);
export const providerRouteSchema = z.enum(['primary', 'fallback']);
export const providerExecutionStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

const providerRequestBase = {
  projectId: idSchema,
  route: providerRouteSchema.default('primary'),
  generationNonce: z.number().int().nonnegative().optional(),
};

export const llmProviderRequestSchema = z.object({
  ...providerRequestBase,
  capability: z.literal('llm'),
  operation: z.enum(['script', 'translate', 'marketing_copy']),
  prompt: z.string().min(1).max(100_000),
  locale: localeSchema,
  imageUris: z.array(z.url()).max(20).default([]),
  outputSchema: z.record(z.string(), z.unknown()).optional(),
  maxOutputTokens: z.number().int().positive().max(32_000).default(4_000),
});

export const imageProviderRequestSchema = z.object({
  ...providerRequestBase,
  capability: z.literal('image'),
  shotId: idSchema.optional(),
  prompt: z.string().min(1).max(20_000),
  negativePrompt: z.string().max(10_000).optional(),
  referenceUris: z.array(z.url()).max(10).default([]),
  width: z.number().int().min(256).max(4_096),
  height: z.number().int().min(256).max(4_096),
  count: z.number().int().min(1).max(4).default(1),
  seed: z.number().int().nonnegative().max(4_294_967_295).optional(),
});

export const videoProviderRequestSchema = z.object({
  ...providerRequestBase,
  capability: z.literal('video'),
  shotId: idSchema,
  prompt: z.string().min(1).max(20_000),
  referenceImageUri: z.url().optional(),
  lastFrameUri: z.url().optional(),
  durationSec: z.number().int().min(1).max(30),
  aspectRatio: aspectRatioSchema,
  seed: z.number().int().nonnegative().max(4_294_967_295).optional(),
});

export const ttsProviderRequestSchema = z.object({
  ...providerRequestBase,
  capability: z.literal('tts'),
  lineId: idSchema,
  text: z.string().min(1).max(40_000),
  locale: localeSchema,
  voiceId: idSchema,
  outputFormat: z.enum(['mp3_44100_128', 'pcm_24000', 'wav_44100']).default('mp3_44100_128'),
  seed: z.number().int().nonnegative().max(4_294_967_295).optional(),
});

export const vlmProviderRequestSchema = z.object({
  ...providerRequestBase,
  capability: z.literal('vlm'),
  shotId: idSchema.optional(),
  mediaUri: z.url(),
  mediaType: z.enum(['image', 'video']),
  criteria: z.array(z.string().min(1).max(500)).min(1).max(50),
  expectedDescription: z.string().min(1).max(10_000),
});

export const providerRequestSchema = z.discriminatedUnion('capability', [
  llmProviderRequestSchema,
  imageProviderRequestSchema,
  videoProviderRequestSchema,
  ttsProviderRequestSchema,
  vlmProviderRequestSchema,
]);

export const generatedImageSchema = z.object({
  uri: z.url(),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  seed: z.number().int().nonnegative().optional(),
});

export const generatedVideoSchema = z.object({
  uri: z.url(),
  mimeType: z.literal('video/mp4'),
  durationSec: z.number().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export const generatedAudioSchema = z.object({
  uri: z.url(),
  mimeType: z.enum(['audio/mpeg', 'audio/pcm', 'audio/wav']),
  durationMs: z.number().int().positive().optional(),
  characterCost: z.number().int().nonnegative().optional(),
});

export const llmProviderOutputSchema = z.object({
  text: z.string(),
  structured: z.record(z.string(), z.unknown()).optional(),
});

export const vlmProviderOutputSchema = z.object({
  scores: qcScoresSchema,
  decision: qcDecisionSchema,
  reason: z.string().min(1).max(4_000),
  retryPatch: z.record(z.string(), z.unknown()).optional(),
});

export const providerJobStateSchema = z.object({
  status: providerExecutionStatusSchema,
  progress: z.number().min(0).max(1).optional(),
  output: z.unknown().optional(),
  actualCostCny: nonNegativeMoneySchema.optional(),
  errorCode: z.string().min(1).max(200).optional(),
  errorMessage: z.string().min(1).max(4_000).optional(),
});

export const asyncJobAcceptedSchema = z.object({
  jobId: idSchema,
  status: z.enum(['queued', 'waiting_human']),
  mode: providerModeSchema,
  provider: z.string().min(1),
  route: providerRouteSchema,
  estimatedCostCny: nonNegativeMoneySchema,
  statusUrl: z.string().startsWith('/v1/jobs/'),
  warning: z.string().optional(),
  replayed: z.boolean().default(false),
});

export const providerCallbackSchema = z.object({
  eventId: idSchema,
  provider: z.string().min(1).max(200),
  externalJobId: z.string().min(1).max(500),
  state: providerJobStateSchema,
});

export const contractSchemas = {
  ProjectSpec: projectSpecSchema,
  EpisodeSpec: episodeSpecSchema,
  CharacterSpec: characterSpecSchema,
  SceneSpec: sceneSpecSchema,
  PropSpec: propSpecSchema,
  CreativeEntity: creativeEntitySchema,
  ContinuitySnapshot: continuitySnapshotSchema,
  FramePromptSpec: framePromptSpecSchema,
  CreativeProjectBundle: creativeProjectBundleSchema,
  ShotSpec: shotSpecSchema,
  DesignPackManifest: designPackManifestSchema,
  LocalePack: localePackSchema,
  RenderManifest: renderManifestSchema,
  RenderSubmission: renderSubmissionSchema,
  LocalizedTextPack: localizedTextPackSchema,
  LocalizationRequest: localizationRequestSchema,
  LocalizationRunRecord: localizationRunRecordSchema,
  LocalePackRecord: localePackRecordSchema,
  AsyncLocalizationAccepted: asyncLocalizationAcceptedSchema,
  CampaignCreative: campaignCreativeSchema,
  CampaignPlan: campaignPlanSchema,
  ExperimentRecord: experimentRecordSchema,
  PublishRequest: publishRequestSchema,
  PublishRecord: publishRecordSchema,
  JobRecord: jobRecordSchema,
  AssetRecord: assetRecordSchema,
  QCRecord: qcRecordSchema,
  QCRunRequest: qcRunRequestSchema,
  QCRunRecord: qcRunRecordSchema,
  AsyncQcAccepted: asyncQcAcceptedSchema,
  RenderRecord: renderRecordSchema,
  AsyncRenderAccepted: asyncRenderAcceptedSchema,
  FeishuCardAction: feishuCardActionSchema,
  HumanGate: humanGateSchema,
  ProviderRequest: providerRequestSchema,
  ProviderJobState: providerJobStateSchema,
  ProviderCallback: providerCallbackSchema,
  AsyncJobAccepted: asyncJobAcceptedSchema,
} as const;

export type Locale = z.infer<typeof localeSchema>;
export type AspectRatio = z.infer<typeof aspectRatioSchema>;
export type ProjectStatus = z.infer<typeof projectStatusSchema>;
export type ShotStatus = z.infer<typeof shotStatusSchema>;
export type AssetStatus = z.infer<typeof assetStatusSchema>;
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;
export type CreativeEntityStatus = z.infer<typeof creativeEntityStatusSchema>;
export type CreativeEntityKind = z.infer<typeof creativeEntityKindSchema>;
export type CreationMode = z.infer<typeof creationModeSchema>;
export type FrameType = z.infer<typeof frameTypeSchema>;
export type JobStatus = z.infer<typeof jobStatusSchema>;
export type RenderStatus = z.infer<typeof renderStatusSchema>;
export type RenderMode = z.infer<typeof renderModeSchema>;
export type ProviderMode = z.infer<typeof providerModeSchema>;
export type QcRunStatus = z.infer<typeof qcRunStatusSchema>;
export type LocalizationRunStatus = z.infer<typeof localizationRunStatusSchema>;
export type PublishStatus = z.infer<typeof publishStatusSchema>;
export type ExperimentPlatform = z.infer<typeof experimentPlatformSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type CompositionId = z.infer<typeof compositionIdSchema>;
export type ProjectSpec = z.infer<typeof projectSpecSchema>;
export type CreativeSource = z.infer<typeof creativeSourceSchema>;
export type EpisodeSpec = z.infer<typeof episodeSpecSchema>;
export type CharacterSpec = z.infer<typeof characterSpecSchema>;
export type SceneSpec = z.infer<typeof sceneSpecSchema>;
export type PropSpec = z.infer<typeof propSpecSchema>;
export type CreativeEntity = z.infer<typeof creativeEntitySchema>;
export type ContinuitySnapshot = z.infer<typeof continuitySnapshotSchema>;
export type FramePromptSpec = z.infer<typeof framePromptSpecSchema>;
export type CreativeProjectBundle = z.infer<typeof creativeProjectBundleSchema>;
export type ShotSpec = z.infer<typeof shotSpecSchema>;
export type DesignPackManifest = z.infer<typeof designPackManifestSchema>;
export type LocalePack = z.infer<typeof localePackSchema>;
export type RenderManifest = z.infer<typeof renderManifestSchema>;
export type RenderSubmission = z.infer<typeof renderSubmissionSchema>;
export type LocalizedTextPack = z.infer<typeof localizedTextPackSchema>;
export type LocalizationRequest = z.infer<typeof localizationRequestSchema>;
export type LocalizationRunRecord = z.infer<typeof localizationRunRecordSchema>;
export type LocalePackRecord = z.infer<typeof localePackRecordSchema>;
export type AsyncLocalizationAccepted = z.infer<typeof asyncLocalizationAcceptedSchema>;
export type CampaignCreative = z.infer<typeof campaignCreativeSchema>;
export type CampaignPlan = z.infer<typeof campaignPlanSchema>;
export type ExperimentRecord = z.infer<typeof experimentRecordSchema>;
export type PublishRequest = z.infer<typeof publishRequestSchema>;
export type PublishRecord = z.infer<typeof publishRecordSchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;
export type AssetRecord = z.infer<typeof assetRecordSchema>;
export type QCRecord = z.infer<typeof qcRecordSchema>;
export type TechnicalQcExpectation = z.infer<typeof technicalQcExpectationSchema>;
export type TechnicalQcReport = z.infer<typeof technicalQcReportSchema>;
export type QcRunRequest = z.infer<typeof qcRunRequestSchema>;
export type QcRunRecord = z.infer<typeof qcRunRecordSchema>;
export type AsyncQcAccepted = z.infer<typeof asyncQcAcceptedSchema>;
export type RenderRecord = z.infer<typeof renderRecordSchema>;
export type AsyncRenderAccepted = z.infer<typeof asyncRenderAcceptedSchema>;
export type FeishuCardActionName = z.infer<typeof feishuCardActionNameSchema>;
export type FeishuCardAction = z.infer<typeof feishuCardActionSchema>;
export type HumanGate = z.infer<typeof humanGateSchema>;
export type ProviderCapability = z.infer<typeof providerCapabilitySchema>;
export type ProviderRoute = z.infer<typeof providerRouteSchema>;
export type ProviderExecutionStatus = z.infer<typeof providerExecutionStatusSchema>;
export type LlmProviderRequest = z.infer<typeof llmProviderRequestSchema>;
export type ImageProviderRequest = z.infer<typeof imageProviderRequestSchema>;
export type VideoProviderRequest = z.infer<typeof videoProviderRequestSchema>;
export type TtsProviderRequest = z.infer<typeof ttsProviderRequestSchema>;
export type VlmProviderRequest = z.infer<typeof vlmProviderRequestSchema>;
export type ProviderRequest = z.infer<typeof providerRequestSchema>;
export type GeneratedImage = z.infer<typeof generatedImageSchema>;
export type GeneratedVideo = z.infer<typeof generatedVideoSchema>;
export type GeneratedAudio = z.infer<typeof generatedAudioSchema>;
export type LlmProviderOutput = z.infer<typeof llmProviderOutputSchema>;
export type VlmProviderOutput = z.infer<typeof vlmProviderOutputSchema>;
export type ProviderJobState = z.infer<typeof providerJobStateSchema>;
export type AsyncJobAccepted = z.infer<typeof asyncJobAcceptedSchema>;
export type ProviderCallback = z.infer<typeof providerCallbackSchema>;
