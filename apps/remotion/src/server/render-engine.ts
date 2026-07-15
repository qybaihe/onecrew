import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';
import { renderModeSchema, type RenderManifest, type RenderMode } from '@onecrew/contracts';

import { calculateMaxDimensionScale, calculatePreviewScale, validateRenderManifest } from '../manifest.js';
import { remotionInputPropsSchema, type RemotionRenderEngine, type RenderedMedia } from '../types.js';
import { resolveDesignPack } from './design-resolver.js';

export interface ServerRemotionEngineOptions {
  entryPoint?: string;
  designPacksRoot?: string;
  browserExecutable?: string;
  concurrency?: number | string;
  mediaUriResolver?: (uri: string) => Promise<string>;
  finalMaxDimension?: number;
}

function workspaceRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

export function defaultRemotionEntryPoint(): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return directory.includes(`${path.sep}dist${path.sep}`)
    ? path.resolve(directory, '../entry.js')
    : path.resolve(directory, '../entry.tsx');
}

export class ServerRemotionEngine implements RemotionRenderEngine {
  private bundlePromise: Promise<string> | undefined;
  private readonly entryPoint: string;
  private readonly designPacksRoot: string;

  constructor(private readonly options: ServerRemotionEngineOptions = {}) {
    this.entryPoint = options.entryPoint ?? defaultRemotionEntryPoint();
    this.designPacksRoot = options.designPacksRoot ?? path.join(workspaceRoot(), 'design-packs');
  }

  async prepare(): Promise<string> {
    this.bundlePromise ??= bundle({
      entryPoint: this.entryPoint,
      webpackOverride: (config) => ({
        ...config,
        resolve: {
          ...config.resolve,
          extensionAlias: {
            ...config.resolve?.extensionAlias,
            '.js': ['.ts', '.tsx', '.js'],
          },
        },
      }),
    });
    return this.bundlePromise;
  }

  async render(
    manifestInput: RenderManifest,
    modeInput: RenderMode,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {},
  ): Promise<RenderedMedia> {
    const sourceManifest = validateRenderManifest(manifestInput);
    const manifest = this.options.mediaUriResolver
      ? validateRenderManifest({
          ...sourceManifest,
          ...(sourceManifest.musicUri
            ? { musicUri: await this.options.mediaUriResolver(sourceManifest.musicUri) }
            : {}),
          localePack: {
            ...sourceManifest.localePack,
            lines: await Promise.all(
              sourceManifest.localePack.lines.map(async (line) => ({
                ...line,
                ...(line.audioUri
                  ? { audioUri: await this.options.mediaUriResolver!(line.audioUri) }
                  : {}),
              })),
            ),
          },
        })
      : sourceManifest;
    const renderMode = renderModeSchema.parse(modeInput);
    const design = await resolveDesignPack(this.designPacksRoot, manifest.designPack);
    const inputProps = remotionInputPropsSchema.parse({ manifest, design, renderMode });
    const serveUrl = await this.prepare();
    const composition = await selectComposition({
      serveUrl,
      id: manifest.compositionId,
      inputProps,
      logLevel: 'warn',
      ...(this.options.browserExecutable ? { browserExecutable: this.options.browserExecutable } : {}),
    });
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'onecrew-remotion-'));
    const outputLocation = path.join(tempDirectory, `${manifest.renderId}.mp4`);
    const { cancelSignal, cancel } = makeCancelSignal();
    const abort = () => cancel();
    options.signal?.addEventListener('abort', abort, { once: true });
    try {
      const scale =
        renderMode === 'preview'
          ? calculatePreviewScale(composition.width, composition.height)
          : this.options.finalMaxDimension
            ? calculateMaxDimensionScale(
                composition.width,
                composition.height,
                this.options.finalMaxDimension,
              )
            : 1;
      await renderMedia({
        composition,
        serveUrl,
        codec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        colorSpace: 'bt709',
        outputLocation,
        inputProps,
        scale,
        crf: renderMode === 'preview' ? 30 : 18,
        x264Preset: renderMode === 'preview' ? 'superfast' : 'medium',
        concurrency: this.options.concurrency ?? '50%',
        cancelSignal,
        overwrite: false,
        logLevel: 'warn',
        onProgress: ({ progress }) => options.onProgress?.(progress),
        ...(this.options.browserExecutable ? { browserExecutable: this.options.browserExecutable } : {}),
      });
      return {
        bytes: await readFile(outputLocation),
        contentType: 'video/mp4',
        extension: 'mp4',
        width: Math.round(composition.width * scale),
        height: Math.round(composition.height * scale),
        durationInFrames: composition.durationInFrames,
      };
    } finally {
      options.signal?.removeEventListener('abort', abort);
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }
}
