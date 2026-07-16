import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  assetRecordSchema,
  creativeProjectBundleSchema,
  type AssetRecord,
  type CreativeEntity,
  type CreativeProjectBundle,
  type FramePromptSpec,
  type ShotSpec,
} from '@onecrew/contracts';
import AdmZip from 'adm-zip';
import { z } from 'zod';

import { normalizeArchivePath, type CreativeMediaStore } from './local-mini-drama.js';

export interface CreativeMediaReader {
  get(uri: string): Promise<{ bytes: Uint8Array; contentType: string; key: string }>;
}

export interface ExportedCreativeArchive {
  buffer: Buffer;
  filename: string;
  mediaFiles: number;
}

interface PlannedAssetFile {
  asset: AssetRecord;
  archivePath: string;
}

const oneCrewArchiveManifestSchema = z.object({
  format: z.literal('onecrew-creative-project'),
  version: z.literal('1.0'),
  exportedAt: z.iso.datetime({ offset: true }),
  bundle: creativeProjectBundleSchema,
  assetFiles: z.array(z.object({
    asset: assetRecordSchema,
    archivePath: z.string().min(1).max(2_000),
    archiveSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })),
});

export type OneCrewArchiveManifest = z.infer<typeof oneCrewArchiveManifestSchema>;

export interface ParsedOneCrewArchive {
  manifest: OneCrewArchiveManifest;
  files: Map<string, Buffer>;
}

function safeFilename(value: string): string {
  const printable = [...value.normalize('NFKC')].map((character) => character.charCodeAt(0) < 32 ? '-' : character).join('');
  const normalized = printable.replace(/[\\/:*?"<>|]/g, '-').trim();
  return normalized.slice(0, 120) || 'onecrew-project';
}

function assetExtension(asset: AssetRecord, contentType?: string): string {
  const uriExtension = path.posix.extname(new URL(asset.uri).pathname).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(uriExtension)) return uriExtension;
  const byContentType: Record<string, string> = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'video/mp4': '.mp4',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
  };
  if (contentType && byContentType[contentType]) return byContentType[contentType];
  if (asset.type === 'video') return '.mp4';
  if (asset.type === 'audio') return '.wav';
  return '.png';
}

function plannedPath(asset: AssetRecord): string {
  return `media/assets/${asset.assetId}${assetExtension(asset)}`;
}

function sortAssets(records: AssetRecord[]): AssetRecord[] {
  return [...records].sort((left, right) =>
    left.version - right.version || left.createdAt.localeCompare(right.createdAt) || left.assetId.localeCompare(right.assetId));
}

function latest(records: AssetRecord[]): AssetRecord | undefined {
  return sortAssets(records).at(-1);
}

function assetsForIds(ids: string[], assetsById: Map<string, AssetRecord>): AssetRecord[] {
  return ids.flatMap((id) => {
    const asset = assetsById.get(id);
    return asset ? [asset] : [];
  });
}

function entityImageFiles(entity: CreativeEntity, assetsById: Map<string, AssetRecord>) {
  const primary = entity.referenceAssetIds[0] ? assetsById.get(entity.referenceAssetIds[0]) : undefined;
  return {
    image_file: primary ? plannedPath(primary) : null,
    extra_image_files: assetsForIds(entity.extraAssetIds, assetsById).map(plannedPath),
  };
}

function compatibleFramePrompt(frame: FramePromptSpec) {
  return {
    frame_type: frame.frameType,
    prompt: frame.prompt,
    description: frame.description ?? null,
    layout: frame.layout ?? null,
  };
}

function compatibleStoryboard(
  shot: ShotSpec,
  allAssets: AssetRecord[],
  assetsById: Map<string, AssetRecord>,
  characterIndex: Map<string, number>,
  sceneIndex: Map<string, number>,
  propIndex: Map<string, number>,
  framePrompts: FramePromptSpec[],
) {
  const shotAssets = sortAssets(allAssets.filter((asset) => asset.shotId === shot.shotId));
  const imageAssets = shotAssets.filter((asset) => asset.type === 'image');
  const videoAsset = latest(shotAssets.filter((asset) => asset.type === 'video'));
  const audioAssets = shotAssets.filter((asset) => asset.type === 'audio');
  const narrationAudio = latest(audioAssets.filter((asset) => asset.creativeRole?.includes('narration')));
  const dialogueAudio = latest(audioAssets.filter((asset) => asset.assetId !== narrationAudio?.assetId));
  const firstAsset = shot.firstFrameAssetId ? assetsById.get(shot.firstFrameAssetId) : undefined;
  const lastAsset = shot.lastFrameAssetId ? assetsById.get(shot.lastFrameAssetId) : undefined;
  const mainImage = firstAsset ?? latest(imageAssets);
  return {
    storyboard_number: shot.sequence,
    title: shot.title ?? null,
    description: shot.description ?? null,
    location: shot.location ?? null,
    time: shot.timeOfDay ?? null,
    dialogue: shot.dialogueZh ?? null,
    narration: shot.narrationZh ?? null,
    action: shot.action,
    atmosphere: shot.atmosphere ?? null,
    result: shot.result ?? null,
    shot_type: shot.shotType ?? null,
    angle: shot.camera,
    angle_h: shot.cameraAngle?.horizontal ?? null,
    angle_v: shot.cameraAngle?.vertical ?? null,
    angle_s: shot.cameraAngle?.side ?? null,
    movement: shot.movement ?? null,
    lighting_style: shot.lightingStyle ?? null,
    depth_of_field: shot.depthOfField ?? null,
    image_prompt: shot.imagePrompt ?? shot.prompt,
    polished_prompt: shot.polishedPrompt ?? null,
    video_prompt: shot.videoPrompt ?? null,
    duration: shot.durationSec,
    emotion: shot.emotion ?? null,
    emotion_intensity: shot.emotionIntensity ?? null,
    segment_index: shot.segmentIndex ?? 0,
    segment_title: shot.segmentTitle ?? null,
    continuity_snapshot: shot.continuity ? JSON.stringify(shot.continuity) : null,
    creation_mode: shot.creationMode ?? 'classic',
    universal_segment_text: shot.universalSegmentText ?? null,
    layout_description: shot.layoutDescription ?? null,
    first_frame_image_original_id: firstAsset?.assetId ?? null,
    last_frame_image_original_id: lastAsset?.assetId ?? null,
    character_indices: shot.characters.flatMap((id) => characterIndex.has(id) ? [characterIndex.get(id)!] : []),
    scene_index: sceneIndex.get(shot.sceneId) ?? null,
    prop_indices: (shot.propIds ?? []).flatMap((id) => propIndex.has(id) ? [propIndex.get(id)!] : []),
    image_file: mainImage ? plannedPath(mainImage) : null,
    video_file: videoAsset ? plannedPath(videoAsset) : null,
    audio_file: dialogueAudio ? plannedPath(dialogueAudio) : null,
    narration_audio_file: narrationAudio ? plannedPath(narrationAudio) : null,
    image_generations: imageAssets.map((asset) => ({
      original_id: asset.assetId,
      provider: asset.provider,
      prompt: asset.creativeRole?.includes('first')
        ? framePrompts.find((frame) => frame.frameType === 'first')?.prompt ?? null
        : asset.creativeRole?.includes('last')
          ? framePrompts.find((frame) => frame.frameType === 'last')?.prompt ?? null
          : shot.imagePrompt ?? shot.prompt,
      model: asset.model,
      frame_type: asset.assetId === firstAsset?.assetId ? 'first' : asset.assetId === lastAsset?.assetId ? 'last' : null,
      status: asset.status === 'rejected' ? 'failed' : 'completed',
      created_at: asset.createdAt,
      updated_at: asset.updatedAt,
      zip_file: plannedPath(asset),
    })),
    frame_prompts: framePrompts.map(compatibleFramePrompt),
  };
}

export function convertToLocalMiniDramaProject(
  inputBundle: CreativeProjectBundle,
  inputAssets: AssetRecord[],
  exportedAt = new Date().toISOString(),
): Record<string, unknown> {
  const bundle = creativeProjectBundleSchema.parse(inputBundle);
  const assets = inputAssets.map((asset) => assetRecordSchema.parse(asset));
  const assetsById = new Map(assets.map((asset) => [asset.assetId, asset]));
  const characters = bundle.entities.filter((entity) => entity.kind === 'character');
  const scenes = bundle.entities.filter((entity) => entity.kind === 'scene');
  const props = bundle.entities.filter((entity) => entity.kind === 'prop');
  const characterIndex = new Map(characters.map((entity, index) => [entity.entityId, index]));
  const sceneIndex = new Map(scenes.map((entity, index) => [entity.entityId, index]));
  const propIndex = new Map(props.map((entity, index) => [entity.entityId, index]));
  const episodeIndex = new Map(bundle.episodes.map((episode, index) => [episode.episodeId, index]));
  return {
    version: '1.4',
    exported_at: exportedAt,
    drama: {
      title: bundle.project.nameZh,
      description: bundle.project.synopsis,
      genre: bundle.project.genres.join(','),
      style: bundle.project.style ?? null,
      status: bundle.project.status,
      tags: JSON.stringify(bundle.project.tags ?? []),
      metadata: { aspect_ratio: bundle.project.aspectRatios[0] },
    },
    episodes: bundle.episodes.map((episode) => ({
      episode_number: episode.episodeNumber,
      title: episode.title,
      description: episode.description ?? null,
      script_content: episode.scriptContent,
      duration: episode.durationSec,
      storyboards: bundle.shots
        .filter((shot) => shot.episodeId === episode.episodeId)
        .sort((left, right) => left.sequence - right.sequence)
        .map((shot) => compatibleStoryboard(
          shot,
          assets,
          assetsById,
          characterIndex,
          sceneIndex,
          propIndex,
          bundle.framePrompts.filter((frame) => frame.shotId === shot.shotId),
        )),
    })),
    characters: characters.map((character) => ({
      name: character.name,
      role: character.role ?? null,
      description: character.description ?? null,
      personality: character.personality ?? null,
      appearance: character.appearance ?? null,
      voice_style: character.voiceStyle ?? null,
      polished_prompt: character.polishedPrompt ?? null,
      identity_anchors: character.identityAnchors,
      style_tokens: character.styleTokens,
      color_palette: character.colorPalette,
      stages: character.stages,
      ...entityImageFiles(character, assetsById),
    })),
    scenes: scenes.map((scene) => ({
      location: scene.location,
      time: scene.timeOfDay ?? null,
      prompt: scene.prompt ?? null,
      polished_prompt: scene.polishedPrompt ?? null,
      episode_index: scene.episodeId ? episodeIndex.get(scene.episodeId) ?? null : null,
      ...entityImageFiles(scene, assetsById),
    })),
    props: props.map((prop) => ({
      name: prop.name,
      type: prop.category ?? null,
      description: prop.description ?? null,
      prompt: prop.prompt ?? null,
      episode_index: prop.episodeId ? episodeIndex.get(prop.episodeId) ?? null : null,
      ...entityImageFiles(prop, assetsById),
    })),
  };
}

async function readAssetFiles(assets: AssetRecord[], reader: CreativeMediaReader): Promise<Array<PlannedAssetFile & { bytes: Uint8Array }>> {
  const seen = new Set<string>();
  const output: Array<PlannedAssetFile & { bytes: Uint8Array }> = [];
  for (const asset of assets) {
    const archivePath = plannedPath(asset);
    if (seen.has(archivePath)) continue;
    const media = await reader.get(asset.uri);
    seen.add(archivePath);
    output.push({ asset, archivePath, bytes: media.bytes });
  }
  return output;
}

export async function exportLocalMiniDramaArchive(
  inputBundle: CreativeProjectBundle,
  inputAssets: AssetRecord[],
  reader: CreativeMediaReader,
): Promise<ExportedCreativeArchive> {
  const bundle = creativeProjectBundleSchema.parse(inputBundle);
  const assets = inputAssets.map((asset) => assetRecordSchema.parse(asset));
  const project = convertToLocalMiniDramaProject(bundle, assets);
  const files = await readAssetFiles(assets, reader);
  const zip = new AdmZip();
  zip.addFile('project.json', Buffer.from(JSON.stringify(project, null, 2), 'utf8'));
  for (const file of files) zip.addFile(file.archivePath, Buffer.from(file.bytes));
  return { buffer: zip.toBuffer(), filename: `${safeFilename(bundle.project.nameZh)}.zip`, mediaFiles: files.length };
}

export async function exportOneCrewArchive(
  inputBundle: CreativeProjectBundle,
  inputAssets: AssetRecord[],
  reader: CreativeMediaReader,
): Promise<ExportedCreativeArchive> {
  const bundle = creativeProjectBundleSchema.parse(inputBundle);
  const assets = inputAssets.map((asset) => assetRecordSchema.parse(asset));
  const files = await readAssetFiles(assets, reader);
  const manifest = oneCrewArchiveManifestSchema.parse({
    format: 'onecrew-creative-project',
    version: '1.0',
    exportedAt: new Date().toISOString(),
    bundle,
    assetFiles: files.map(({ asset, archivePath, bytes }) => ({
      asset,
      archivePath,
      archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    })),
  });
  const zip = new AdmZip();
  zip.addFile('onecrew-project.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  for (const file of files) zip.addFile(file.archivePath, Buffer.from(file.bytes));
  return { buffer: zip.toBuffer(), filename: `${safeFilename(bundle.project.nameZh)}.onecrew.zip`, mediaFiles: files.length };
}

export function importOneCrewArchive(zipBuffer: Buffer): ParsedOneCrewArchive {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();
  if (entries.length > 5_000) throw new Error(`OneCrew archive has too many entries: ${entries.length}`);
  const files = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = normalizeArchivePath(entry.entryName);
    if (entry.header.size > 512 * 1024 * 1024) throw new Error(`OneCrew archive entry is too large: ${name}`);
    totalBytes += entry.header.size;
    if (totalBytes > 2 * 1024 * 1024 * 1024) throw new Error('OneCrew archive expands beyond the configured size limit');
    if (files.has(name)) throw new Error(`OneCrew archive contains a duplicate entry: ${name}`);
    files.set(name, entry.getData());
  }
  const manifestBytes = files.get('onecrew-project.json');
  if (!manifestBytes) throw new Error('OneCrew archive is missing onecrew-project.json');
  let raw: unknown;
  try {
    raw = JSON.parse(manifestBytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('OneCrew project manifest is invalid JSON', { cause: error });
  }
  const parsedManifest = oneCrewArchiveManifestSchema.parse(raw);
  const manifest = oneCrewArchiveManifestSchema.parse({
    ...parsedManifest,
    assetFiles: parsedManifest.assetFiles.map((file) => ({
      ...file,
      archivePath: normalizeArchivePath(file.archivePath),
    })),
  });
  const declaredPaths = new Set(manifest.assetFiles.map((file) => file.archivePath));
  if (declaredPaths.size !== manifest.assetFiles.length) {
    throw new Error('OneCrew archive manifest declares the same media path more than once');
  }
  for (const file of manifest.assetFiles) {
    const archivePath = file.archivePath;
    const bytes = files.get(archivePath);
    if (!bytes) throw new Error(`OneCrew archive is missing declared media file: ${archivePath}`);
    const actualHash = createHash('sha256').update(bytes).digest('hex');
    if (actualHash !== file.archiveSha256) {
      throw new Error(`OneCrew archive media hash mismatch: ${archivePath}`);
    }
  }
  files.delete('onecrew-project.json');
  for (const archivePath of files.keys()) {
    if (!declaredPaths.has(archivePath)) throw new Error(`OneCrew archive contains undeclared media file: ${archivePath}`);
  }
  return { manifest, files };
}

export async function materializeOneCrewArchive(
  input: ParsedOneCrewArchive,
  mediaStore: CreativeMediaStore,
): Promise<{ bundle: CreativeProjectBundle; assets: AssetRecord[] }> {
  const assets: AssetRecord[] = [];
  for (const file of input.manifest.assetFiles) {
    const bytes = input.files.get(file.archivePath);
    if (!bytes) throw new Error(`OneCrew archive is missing declared media file: ${file.archivePath}`);
    const extension = path.posix.extname(file.archivePath).toLowerCase();
    const objectKey = `creative-imports/${input.manifest.bundle.project.projectId}/${file.asset.assetId}${extension}`;
    const stored = await mediaStore.put({ key: objectKey, bytes, contentType: mediaContentType(file.archivePath, file.asset.type) });
    assets.push(assetRecordSchema.parse({ ...file.asset, uri: stored.uri }));
  }
  return { bundle: creativeProjectBundleSchema.parse(input.manifest.bundle), assets };
}

function mediaContentType(filePath: string, type: string): string {
  const extension = path.posix.extname(filePath).toLowerCase();
  const byExtension: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  };
  return byExtension[extension] ?? (type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/wav' : 'image/png');
}
