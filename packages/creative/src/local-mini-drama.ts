import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  creativeProjectBundleSchema,
  type AssetRecord,
  type CharacterSpec,
  type ContinuitySnapshot,
  type CreativeEntity,
  type CreativeProjectBundle,
  type CreativeSource,
  type FramePromptSpec,
  type SceneSpec,
  type ShotSpec,
} from '@onecrew/contracts';
import AdmZip from 'adm-zip';
import { z } from 'zod';

const flexibleStringSchema = z.union([z.string(), z.number(), z.boolean()]).transform(String);
const optionalFlexibleStringSchema = flexibleStringSchema.optional().nullable();

const rawImageGenerationSchema = z
  .object({
    original_id: z.union([z.string(), z.number()]).optional().nullable(),
    provider: optionalFlexibleStringSchema,
    prompt: optionalFlexibleStringSchema,
    negative_prompt: optionalFlexibleStringSchema,
    model: optionalFlexibleStringSchema,
    frame_type: optionalFlexibleStringSchema,
    zip_file: optionalFlexibleStringSchema,
    file: optionalFlexibleStringSchema,
  })
  .passthrough();

const rawFramePromptSchema = z
  .object({
    frame_type: optionalFlexibleStringSchema,
    prompt: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    layout: optionalFlexibleStringSchema,
  })
  .passthrough();

const rawStoryboardSchema = z
  .object({
    storyboard_number: z.coerce.number().int().optional().nullable(),
    title: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    location: optionalFlexibleStringSchema,
    time: optionalFlexibleStringSchema,
    dialogue: optionalFlexibleStringSchema,
    narration: optionalFlexibleStringSchema,
    action: optionalFlexibleStringSchema,
    atmosphere: optionalFlexibleStringSchema,
    result: optionalFlexibleStringSchema,
    shot_type: optionalFlexibleStringSchema,
    angle: optionalFlexibleStringSchema,
    angle_h: optionalFlexibleStringSchema,
    angle_v: optionalFlexibleStringSchema,
    angle_s: optionalFlexibleStringSchema,
    movement: optionalFlexibleStringSchema,
    lighting_style: optionalFlexibleStringSchema,
    depth_of_field: optionalFlexibleStringSchema,
    image_prompt: optionalFlexibleStringSchema,
    polished_prompt: optionalFlexibleStringSchema,
    video_prompt: optionalFlexibleStringSchema,
    duration: z.coerce.number().optional().nullable(),
    emotion: optionalFlexibleStringSchema,
    emotion_intensity: z.coerce.number().optional().nullable(),
    segment_index: z.coerce.number().int().optional().nullable(),
    segment_title: optionalFlexibleStringSchema,
    continuity_snapshot: z.unknown().optional().nullable(),
    creation_mode: optionalFlexibleStringSchema,
    universal_segment_text: optionalFlexibleStringSchema,
    layout_description: optionalFlexibleStringSchema,
    character_indices: z.array(z.coerce.number().int()).optional().default([]),
    scene_index: z.coerce.number().int().optional().nullable(),
    prop_indices: z.array(z.coerce.number().int()).optional().default([]),
    image_file: optionalFlexibleStringSchema,
    video_file: optionalFlexibleStringSchema,
    audio_file: optionalFlexibleStringSchema,
    narration_audio_file: optionalFlexibleStringSchema,
    first_frame_image_original_id: z.union([z.string(), z.number()]).optional().nullable(),
    last_frame_image_original_id: z.union([z.string(), z.number()]).optional().nullable(),
    image_generations: z.array(rawImageGenerationSchema).optional().default([]),
    frame_prompts: z.array(rawFramePromptSchema).optional().default([]),
  })
  .passthrough();

const rawEpisodeSchema = z
  .object({
    episode_number: z.coerce.number().int().optional().nullable(),
    title: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    script_content: optionalFlexibleStringSchema,
    duration: z.coerce.number().optional().nullable(),
    storyboards: z.array(rawStoryboardSchema).optional().default([]),
  })
  .passthrough();

const rawCharacterSchema = z
  .object({
    name: optionalFlexibleStringSchema,
    role: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    personality: optionalFlexibleStringSchema,
    appearance: optionalFlexibleStringSchema,
    voice_style: optionalFlexibleStringSchema,
    prompt: optionalFlexibleStringSchema,
    polished_prompt: optionalFlexibleStringSchema,
    negative_prompt: optionalFlexibleStringSchema,
    identity_anchors: z.unknown().optional().nullable(),
    style_tokens: z.unknown().optional().nullable(),
    color_palette: z.unknown().optional().nullable(),
    stages: z.unknown().optional().nullable(),
    seedance2_asset: optionalFlexibleStringSchema,
    image_file: optionalFlexibleStringSchema,
    extra_image_files: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const rawSceneSchema = z
  .object({
    episode_index: z.coerce.number().int().optional().nullable(),
    location: optionalFlexibleStringSchema,
    time: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    atmosphere: optionalFlexibleStringSchema,
    lighting_style: optionalFlexibleStringSchema,
    prompt: optionalFlexibleStringSchema,
    polished_prompt: optionalFlexibleStringSchema,
    negative_prompt: optionalFlexibleStringSchema,
    image_file: optionalFlexibleStringSchema,
    extra_image_files: z.array(z.string()).optional().default([]),
  })
  .passthrough();

const rawPropSchema = z
  .object({
    episode_index: z.coerce.number().int().optional().nullable(),
    name: optionalFlexibleStringSchema,
    type: optionalFlexibleStringSchema,
    description: optionalFlexibleStringSchema,
    prompt: optionalFlexibleStringSchema,
    polished_prompt: optionalFlexibleStringSchema,
    negative_prompt: optionalFlexibleStringSchema,
    image_file: optionalFlexibleStringSchema,
    extra_image_files: z.array(z.string()).optional().default([]),
  })
  .passthrough();

export const localMiniDramaProjectSchema = z
  .object({
    version: flexibleStringSchema,
    exported_at: z.string().optional(),
    drama: z
      .object({
        title: z.string().min(1),
        description: optionalFlexibleStringSchema,
        genre: optionalFlexibleStringSchema,
        style: optionalFlexibleStringSchema,
        status: optionalFlexibleStringSchema,
        tags: z.unknown().optional().nullable(),
        metadata: z.unknown().optional().nullable(),
      })
      .passthrough(),
    episodes: z.array(rawEpisodeSchema).optional().default([]),
    characters: z.array(rawCharacterSchema).optional().default([]),
    scenes: z.array(rawSceneSchema).optional().default([]),
    props: z.array(rawPropSchema).optional().default([]),
  })
  .passthrough();

export interface LocalMiniDramaConversionOptions {
  projectId?: string;
  ownerOpenId?: string;
  nameEn?: string;
  importedAt?: string;
  sourceReference?: string;
}

export interface LocalMiniDramaArchiveOptions extends LocalMiniDramaConversionOptions {
  maxEntries?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}

export interface ParsedLocalMiniDramaArchive {
  bundle: CreativeProjectBundle;
  files: ReadonlyMap<string, Buffer>;
}

export interface CreativeMediaStore {
  put(input: { key: string; bytes: Uint8Array; contentType: string }): Promise<{ uri: string }>;
}

export interface MaterializedCreativeArchive {
  bundle: CreativeProjectBundle;
  assets: AssetRecord[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function makeId(prefix: string, projectId: string, index: number): string {
  return `${prefix}_${hash(`${projectId}:${prefix}:${index}`).slice(0, 24)}`;
}

function optional(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).map((item) => item.trim()).filter(Boolean);
  } catch {
    // Plain comma-delimited text is a supported legacy representation.
  }
  return trimmed.split(/[,，;；|]/).map((item) => item.trim()).filter(Boolean);
}

function parseObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function validImportedAt(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.valueOf()) ? fallback : timestamp.toISOString();
}

function aspectRatios(metadataValue: unknown): Array<'16:9' | '9:16' | '1:1'> {
  const metadata = parseObject(metadataValue);
  const raw = metadata?.aspect_ratio ?? metadata?.aspectRatio ?? metadata?.ratio;
  if (raw === '9:16' || raw === '1:1' || raw === '16:9') return [raw];
  return ['16:9'];
}

function projectStatus(status: string | undefined): 'draft' | 'running' | 'done' | 'failed' {
  const normalized = status?.toLowerCase();
  if (normalized === 'completed' || normalized === 'done' || normalized === 'published') return 'done';
  if (normalized === 'running' || normalized === 'processing' || normalized === 'generating') return 'running';
  if (normalized === 'failed' || normalized === 'error') return 'failed';
  return 'draft';
}

function safeDuration(value: number | null | undefined, fallback: number): number {
  if (!value || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(value, 120);
}

function normalizeFrameType(value: string | undefined): 'first' | 'last' | 'key' {
  const normalized = value?.toLowerCase() ?? '';
  if (['last', 'tail', 'last_frame', 'storyboard_last'].includes(normalized)) return 'last';
  if (['first', 'first_frame', 'storyboard_first'].includes(normalized)) return 'first';
  return 'key';
}

function mediaContentType(sourcePath: string, mediaType: 'image' | 'video' | 'audio'): string {
  const extension = path.posix.extname(sourcePath).toLowerCase();
  const known: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
  };
  return known[extension] ?? `${mediaType}/octet-stream`;
}

export function normalizeArchivePath(input: string): string {
  if (input.includes('\0')) throw new Error('Archive entry contains a NUL byte');
  const slashed = input.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`Archive entry uses an absolute path: ${input}`);
  }
  const normalized = path.posix.normalize(slashed);
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`Archive entry escapes the archive root: ${input}`);
  }
  return normalized;
}

function sourceFor(rawVersion: string, importedAt: string, reference: string): CreativeSource {
  return {
    system: 'local-mini-drama',
    version: rawVersion,
    reference,
    license: 'MIT',
    importedAt,
  };
}

function mapContinuity(
  value: unknown,
  characterIds: string[],
  sourceShotId: string | undefined,
): ContinuitySnapshot | undefined {
  const parsed = parseObject(value);
  if (!parsed) return undefined;
  const rawCharacters = parseObject(parsed.characters);
  const characterStates: ContinuitySnapshot['characters'] = {};
  if (rawCharacters) {
    for (const [index, state] of Object.values(rawCharacters).entries()) {
      const characterId = characterIds[index];
      const record = parseObject(state);
      if (!characterId || !record) continue;
      characterStates[characterId] = {
        ...(typeof record.position === 'string' ? { position: record.position } : {}),
        ...(typeof record.clothing === 'string' ? { clothing: record.clothing } : {}),
        ...(typeof record.expression === 'string' ? { expression: record.expression } : {}),
        props: parseStringList(record.props),
      };
    }
  }
  const notes = JSON.stringify(parsed);
  return {
    ...(sourceShotId ? { sourceShotId } : {}),
    characters: characterStates,
    ...(typeof parsed.lighting === 'string' ? { lighting: parsed.lighting } : {}),
    notes: notes.length <= 4_000 ? notes : `${notes.slice(0, 3_997)}...`,
  };
}

export function convertLocalMiniDramaProject(
  input: unknown,
  options: LocalMiniDramaConversionOptions = {},
): CreativeProjectBundle {
  const raw = localMiniDramaProjectSchema.parse(input);
  const importedAt = validImportedAt(options.importedAt ?? raw.exported_at, new Date().toISOString());
  const projectId = options.projectId ?? `prj_lmd_${hash(JSON.stringify(raw)).slice(0, 24)}`;
  const reference = options.sourceReference ?? 'xuanyustudio/LocalMiniDrama@92c66dd75688d83aac3ccc31bb51378613122cbc';
  const source = sourceFor(raw.version, importedAt, reference);
  const episodeRows = raw.episodes.length > 0 ? raw.episodes : [{ storyboards: [] }];
  const episodeIds = episodeRows.map((_episode, index) => makeId('episode', projectId, index));
  const characterIds = raw.characters.map((_character, index) => makeId('character', projectId, index));

  const characters: CharacterSpec[] = raw.characters.map((character, index) => {
    const stages = Array.isArray(character.stages)
      ? character.stages.flatMap((stage, stageIndex) => {
          const record = parseObject(stage);
          if (!record) return [];
          return [{
            stageId: makeId('stage', characterIds[index]!, stageIndex),
            name: String(record.name ?? `阶段 ${stageIndex + 1}`),
            ...(typeof record.description === 'string' ? { description: record.description } : {}),
            ...(typeof record.clothing === 'string' ? { clothing: record.clothing } : {}),
            referenceAssetIds: [],
          }];
        })
      : [];
    return {
      entityId: characterIds[index]!,
      projectId,
      kind: 'character',
      name: optional(character.name) ?? `角色 ${index + 1}`,
      ...(optional(character.description) ? { description: optional(character.description) } : {}),
      ...(optional(character.prompt) ? { prompt: optional(character.prompt) } : {}),
      ...(optional(character.polished_prompt) ? { polishedPrompt: optional(character.polished_prompt) } : {}),
      ...(optional(character.negative_prompt) ? { negativePrompt: optional(character.negative_prompt) } : {}),
      ...(optional(character.role) ? { role: optional(character.role) } : {}),
      ...(optional(character.personality) ? { personality: optional(character.personality) } : {}),
      ...(optional(character.appearance) ? { appearance: optional(character.appearance) } : {}),
      ...(optional(character.voice_style) ? { voiceStyle: optional(character.voice_style) } : {}),
      identityAnchors: parseStringList(character.identity_anchors),
      styleTokens: parseStringList(character.style_tokens),
      colorPalette: parseStringList(character.color_palette),
      stages,
      ...(optional(character.seedance2_asset) ? { providerAssetRef: optional(character.seedance2_asset) } : {}),
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: index,
      status: 'draft',
      source,
    };
  });

  const sceneIndexMap: string[] = [];
  const sceneByKey = new Map<string, SceneSpec>();
  for (const [index, scene] of raw.scenes.entries()) {
    const location = optional(scene.location) ?? `场景 ${index + 1}`;
    const key = `${location.trim()}|${optional(scene.time) ?? ''}`;
    const existing = sceneByKey.get(key);
    if (existing) {
      sceneIndexMap[index] = existing.entityId;
      continue;
    }
    const entityId = makeId('scene', projectId, index);
    const episodeId = scene.episode_index != null ? episodeIds[scene.episode_index] : undefined;
    const entity: SceneSpec = {
      entityId,
      projectId,
      ...(episodeId ? { episodeId } : {}),
      kind: 'scene',
      name: location,
      location,
      ...(optional(scene.description) ? { description: optional(scene.description) } : {}),
      ...(optional(scene.prompt) ? { prompt: optional(scene.prompt) } : {}),
      ...(optional(scene.polished_prompt) ? { polishedPrompt: optional(scene.polished_prompt) } : {}),
      ...(optional(scene.negative_prompt) ? { negativePrompt: optional(scene.negative_prompt) } : {}),
      ...(optional(scene.time) ? { timeOfDay: optional(scene.time) } : {}),
      ...(optional(scene.atmosphere) ? { atmosphere: optional(scene.atmosphere) } : {}),
      ...(optional(scene.lighting_style) ? { lightingStyle: optional(scene.lighting_style) } : {}),
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: sceneByKey.size,
      status: 'draft',
      source,
    };
    sceneByKey.set(key, entity);
    sceneIndexMap[index] = entityId;
  }
  if (sceneByKey.size === 0) {
    const entityId = makeId('scene', projectId, 0);
    sceneByKey.set('__default__', {
      entityId,
      projectId,
      kind: 'scene',
      name: '未指定场景',
      location: '未指定场景',
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: 0,
      status: 'draft',
      source,
    });
  }
  const scenes = [...sceneByKey.values()];

  const propIds = raw.props.map((_prop, index) => makeId('prop', projectId, index));
  const props: CreativeEntity[] = raw.props.map((prop, index) => {
    const episodeId = prop.episode_index != null ? episodeIds[prop.episode_index] : undefined;
    return {
      entityId: propIds[index]!,
      projectId,
      ...(episodeId ? { episodeId } : {}),
      kind: 'prop',
      name: optional(prop.name) ?? `道具 ${index + 1}`,
      ...(optional(prop.description) ? { description: optional(prop.description) } : {}),
      ...(optional(prop.prompt) ? { prompt: optional(prop.prompt) } : {}),
      ...(optional(prop.polished_prompt) ? { polishedPrompt: optional(prop.polished_prompt) } : {}),
      ...(optional(prop.negative_prompt) ? { negativePrompt: optional(prop.negative_prompt) } : {}),
      ...(optional(prop.type) ? { category: optional(prop.type) } : {}),
      referenceAssetIds: [],
      extraAssetIds: [],
      sortOrder: index,
      status: 'draft',
      source,
    };
  });

  const episodes = episodeRows.map((episode, index) => ({
    episodeId: episodeIds[index]!,
    projectId,
    episodeNumber: episode.episode_number && episode.episode_number > 0 ? episode.episode_number : index + 1,
    title: optional(episode.title) ?? `第 ${index + 1} 集`,
    ...(optional(episode.description) ? { description: optional(episode.description) } : {}),
    scriptContent: optional(episode.script_content) ?? '',
    durationSec: Math.max(0, episode.duration ?? 0),
    characterIds,
    sceneIds: scenes.filter((scene) => !scene.episodeId || scene.episodeId === episodeIds[index]).map((scene) => scene.entityId),
    propIds: props.filter((prop) => !prop.episodeId || prop.episodeId === episodeIds[index]).map((prop) => prop.entityId),
    status: 'draft' as const,
    source,
  }));

  const shots: ShotSpec[] = [];
  const framePrompts: FramePromptSpec[] = [];
  const mediaFiles: CreativeProjectBundle['mediaFiles'] = [];
  let globalSequence = 0;
  let previousShotId: string | undefined;
  for (const [episodeIndex, episode] of episodeRows.entries()) {
    for (const storyboard of episode.storyboards) {
      globalSequence += 1;
      const shotId = makeId('shot', projectId, globalSequence - 1);
      const linkedCharacters = storyboard.character_indices.flatMap((index) => characterIds[index] ? [characterIds[index]!] : []);
      const linkedProps = storyboard.prop_indices.flatMap((index) => propIds[index] ? [propIds[index]!] : []);
      const sceneId = storyboard.scene_index != null && sceneIndexMap[storyboard.scene_index]
        ? sceneIndexMap[storyboard.scene_index]!
        : scenes[0]!.entityId;
      const shotFramePromptIds: string[] = [];
      for (const [frameIndex, frame] of storyboard.frame_prompts.entries()) {
        const prompt = optional(frame.prompt);
        if (!prompt) continue;
        const framePromptId = makeId('frame', shotId, frameIndex);
        shotFramePromptIds.push(framePromptId);
        framePrompts.push({
          framePromptId,
          shotId,
          frameType: normalizeFrameType(optional(frame.frame_type)),
          prompt,
          ...(optional(frame.description) ? { description: optional(frame.description) } : {}),
          ...(optional(frame.layout) ? { layout: optional(frame.layout) } : {}),
          source,
        });
      }
      const action = optional(storyboard.action) ?? optional(storyboard.description) ?? optional(storyboard.title) ?? '待补充分镜动作';
      const prompt = optional(storyboard.image_prompt) ?? optional(storyboard.video_prompt) ?? action;
      const camera = [storyboard.shot_type, storyboard.angle, storyboard.movement].map(optional).filter(Boolean).join(' / ') || '未指定镜头';
      const shot: ShotSpec = {
        shotId,
        projectId,
        episodeId: episodeIds[episodeIndex]!,
        sequence: globalSequence,
        durationSec: safeDuration(storyboard.duration, 5),
        characters: linkedCharacters,
        sceneId,
        propIds: linkedProps,
        ...(optional(storyboard.title) ? { title: optional(storyboard.title) } : {}),
        ...(optional(storyboard.description) ? { description: optional(storyboard.description) } : {}),
        ...(optional(storyboard.location) ? { location: optional(storyboard.location) } : {}),
        ...(optional(storyboard.time) ? { timeOfDay: optional(storyboard.time) } : {}),
        action,
        camera,
        ...(optional(storyboard.dialogue) ? { dialogueZh: optional(storyboard.dialogue) } : {}),
        ...(optional(storyboard.narration) ? { narrationZh: optional(storyboard.narration) } : {}),
        ...(optional(storyboard.atmosphere) ? { atmosphere: optional(storyboard.atmosphere) } : {}),
        ...(optional(storyboard.result) ? { result: optional(storyboard.result) } : {}),
        ...(optional(storyboard.shot_type) ? { shotType: optional(storyboard.shot_type) } : {}),
        cameraAngle: {
          ...(optional(storyboard.angle_h) ? { horizontal: optional(storyboard.angle_h) } : {}),
          ...(optional(storyboard.angle_v) ? { vertical: optional(storyboard.angle_v) } : {}),
          ...(optional(storyboard.angle_s) ? { side: optional(storyboard.angle_s) } : {}),
        },
        ...(optional(storyboard.movement) ? { movement: optional(storyboard.movement) } : {}),
        ...(optional(storyboard.lighting_style) ? { lightingStyle: optional(storyboard.lighting_style) } : {}),
        ...(optional(storyboard.depth_of_field) ? { depthOfField: optional(storyboard.depth_of_field) } : {}),
        prompt,
        ...(optional(storyboard.image_prompt) ? { imagePrompt: optional(storyboard.image_prompt) } : {}),
        ...(optional(storyboard.polished_prompt) ? { polishedPrompt: optional(storyboard.polished_prompt) } : {}),
        ...(optional(storyboard.video_prompt) ? { videoPrompt: optional(storyboard.video_prompt) } : {}),
        referenceAssetIds: [],
        framePromptIds: shotFramePromptIds,
        ...(optional(storyboard.emotion) ? { emotion: optional(storyboard.emotion) } : {}),
        ...(storyboard.emotion_intensity != null
          ? { emotionIntensity: Math.min(1, Math.max(0, storyboard.emotion_intensity > 1 ? storyboard.emotion_intensity / 10 : storyboard.emotion_intensity)) }
          : {}),
        segmentIndex: Math.max(0, storyboard.segment_index ?? 0),
        ...(optional(storyboard.segment_title) ? { segmentTitle: optional(storyboard.segment_title) } : {}),
        ...(mapContinuity(storyboard.continuity_snapshot, linkedCharacters, previousShotId)
          ? { continuity: mapContinuity(storyboard.continuity_snapshot, linkedCharacters, previousShotId) }
          : {}),
        creationMode: storyboard.creation_mode === 'universal' ? 'universal' : 'classic',
        ...(optional(storyboard.universal_segment_text) ? { universalSegmentText: optional(storyboard.universal_segment_text) } : {}),
        ...(optional(storyboard.layout_description) ? { layoutDescription: optional(storyboard.layout_description) } : {}),
        source,
        importance: globalSequence === 1 ? 'hero' : 'normal',
        closeupDialogue: Boolean(optional(storyboard.dialogue) && /近景|特写|close/i.test(camera)),
        status: 'planned',
      };
      shots.push(shot);
      previousShotId = shotId;

      const pushShotMedia = (sourcePath: string | undefined, mediaType: 'image' | 'video' | 'audio', role: string, originalId?: string | number) => {
        if (!sourcePath) return;
        mediaFiles.push({ sourcePath: normalizeArchivePath(sourcePath), mediaType, ownerType: 'shot', ownerId: shotId, role, ...(originalId != null ? { originalId } : {}) });
      };
      pushShotMedia(optional(storyboard.image_file), 'image', 'storyboard-main');
      pushShotMedia(optional(storyboard.video_file), 'video', 'storyboard-video');
      pushShotMedia(optional(storyboard.audio_file), 'audio', 'dialogue-audio');
      pushShotMedia(optional(storyboard.narration_audio_file), 'audio', 'narration-audio');
      for (const generation of storyboard.image_generations) {
        pushShotMedia(optional(generation.zip_file) ?? optional(generation.file), 'image', `generation-${normalizeFrameType(optional(generation.frame_type))}`, generation.original_id ?? undefined);
      }
    }
  }

  const addEntityMedia = (
    rows: Array<{ image_file?: string | null | undefined; extra_image_files: string[] }>,
    ids: string[],
  ) => {
    for (const [index, row] of rows.entries()) {
      const ownerId = ids[index];
      if (!ownerId) continue;
      const primary = optional(row.image_file);
      if (primary) mediaFiles.push({ sourcePath: normalizeArchivePath(primary), mediaType: 'image', ownerType: 'entity', ownerId, role: 'primary' });
      for (const [extraIndex, extra] of row.extra_image_files.entries()) {
        mediaFiles.push({ sourcePath: normalizeArchivePath(extra), mediaType: 'image', ownerType: 'entity', ownerId, role: `extra-${extraIndex + 1}` });
      }
    }
  };
  addEntityMedia(raw.characters, characterIds);
  addEntityMedia(raw.scenes, sceneIndexMap);
  addEntityMedia(raw.props, propIds);

  const genres = parseStringList(raw.drama.genre);
  const tags = parseStringList(raw.drama.tags);
  return creativeProjectBundleSchema.parse({
    bundleVersion: '1.0',
    source,
    project: {
      projectId,
      nameZh: raw.drama.title,
      nameEn: options.nameEn ?? raw.drama.title,
      synopsis: optional(raw.drama.description) ?? raw.drama.title,
      audience: 'Imported creative project',
      genres: genres.length > 0 ? genres : ['短剧'],
      ownerOpenId: options.ownerOpenId ?? 'ou_import',
      locales: ['zh-CN', 'en-US'],
      aspectRatios: aspectRatios(raw.drama.metadata),
      budgetLimitCny: 0,
      ...(optional(raw.drama.style) ? { style: optional(raw.drama.style) } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      totalEpisodes: episodes.length,
      source,
      status: projectStatus(optional(raw.drama.status)),
    },
    episodes,
    entities: [...characters, ...scenes, ...props],
    shots,
    framePrompts,
    mediaFiles,
  });
}

export function importLocalMiniDramaArchive(
  zipBuffer: Buffer,
  options: LocalMiniDramaArchiveOptions = {},
): ParsedLocalMiniDramaArchive {
  const maxEntries = options.maxEntries ?? 5_000;
  const maxFileBytes = options.maxFileBytes ?? 512 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 2 * 1024 * 1024 * 1024;
  let zip: AdmZip;
  try {
    zip = new AdmZip(zipBuffer);
  } catch (error) {
    throw new Error(`Invalid LocalMiniDrama ZIP: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const entries = zip.getEntries();
  if (entries.length > maxEntries) throw new Error(`Archive has too many entries: ${entries.length}`);
  let totalBytes = 0;
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const name = normalizeArchivePath(entry.entryName);
    if (entry.isDirectory) continue;
    const size = entry.header.size;
    if (size > maxFileBytes) throw new Error(`Archive entry is too large: ${name}`);
    totalBytes += size;
    if (totalBytes > maxTotalBytes) throw new Error('Archive expands beyond the configured size limit');
    files.set(name, entry.getData());
  }
  const projectJson = files.get('project.json');
  if (!projectJson) throw new Error('LocalMiniDrama archive is missing project.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error(`LocalMiniDrama project.json is invalid: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  const bundle = convertLocalMiniDramaProject(parsed, options);
  for (const media of bundle.mediaFiles) {
    if (!files.has(media.sourcePath)) {
      throw new Error(`Archive is missing declared media file: ${media.sourcePath}`);
    }
  }
  files.delete('project.json');
  return { bundle, files };
}

export async function materializeCreativeArchive(
  input: ParsedLocalMiniDramaArchive,
  mediaStore: CreativeMediaStore,
): Promise<MaterializedCreativeArchive> {
  const bundle = structuredClone(input.bundle);
  const entities = new Map(bundle.entities.map((entity) => [entity.entityId, entity]));
  const shots = new Map(bundle.shots.map((shot) => [shot.shotId, shot]));
  const frames = new Map(bundle.framePrompts.map((frame) => [`${frame.shotId}:${frame.frameType}`, frame]));
  const assets: AssetRecord[] = [];
  const now = bundle.source.importedAt ?? new Date().toISOString();

  for (const media of bundle.mediaFiles) {
    const bytes = input.files.get(media.sourcePath);
    if (!bytes) throw new Error(`Archive is missing declared media file: ${media.sourcePath}`);
    const assetId = `asset_${hash(`${bundle.project.projectId}:${media.ownerType}:${media.ownerId}:${media.role}:${media.sourcePath}`).slice(0, 32)}`;
    const extension = path.posix.extname(media.sourcePath).toLowerCase();
    const safeExtension = /^\.[a-z0-9]{1,8}$/.test(extension) ? extension : '';
    const objectKey = `creative-imports/${bundle.project.projectId}/${assetId}${safeExtension}`;
    const stored = await mediaStore.put({
      key: objectKey,
      bytes,
      contentType: mediaContentType(media.sourcePath, media.mediaType),
    });
    const entity = media.ownerType === 'entity' ? entities.get(media.ownerId) : undefined;
    const type = entity && media.role === 'primary' ? entity.kind : media.mediaType;
    const asset: AssetRecord = {
      assetId,
      projectId: bundle.project.projectId,
      ...(media.ownerType === 'shot' ? { shotId: media.ownerId } : {}),
      type,
      version: 1,
      uri: stored.uri,
      provider: 'import',
      model: 'local-mini-drama-project-1.4',
      source: `${bundle.source.reference ?? 'LocalMiniDrama'}:${media.sourcePath}`,
      license: bundle.source.license ?? 'MIT',
      contentHash: hash(bytes.toString('base64')),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    assets.push(asset);

    if (entity) {
      if (media.role === 'primary') entity.referenceAssetIds = [...new Set([...entity.referenceAssetIds, assetId])];
      else entity.extraAssetIds = [...new Set([...entity.extraAssetIds, assetId])];
    }
    const shot = media.ownerType === 'shot' ? shots.get(media.ownerId) : undefined;
    if (shot) {
      shot.referenceAssetIds = [...new Set([...shot.referenceAssetIds, assetId])];
      if (media.role === 'storyboard-main' || media.role === 'generation-first') shot.firstFrameAssetId = assetId;
      if (media.role === 'generation-last') shot.lastFrameAssetId = assetId;
      const frameType = media.role === 'generation-first' ? 'first' : media.role === 'generation-last' ? 'last' : undefined;
      if (frameType) {
        const frame = frames.get(`${shot.shotId}:${frameType}`);
        if (frame) frame.boundAssetId = assetId;
      }
    }
  }

  return {
    bundle: creativeProjectBundleSchema.parse(bundle),
    assets,
  };
}
