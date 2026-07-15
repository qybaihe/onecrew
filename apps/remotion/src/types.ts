import { renderManifestSchema, renderModeSchema } from '@onecrew/contracts';
import {
  brandTokensSchema,
  motionTokensSchema,
  promoSpecSchema,
} from '@onecrew/design-adapter/schemas';
import { z } from 'zod';

export const resolvedDesignPackSchema = z.object({
  brandTokens: brandTokensSchema,
  motionTokens: motionTokensSchema,
  promoSpec: promoSpecSchema,
  logoDataUri: z.string().startsWith('data:image/svg+xml;base64,'),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const remotionInputPropsSchema = z.object({
  manifest: renderManifestSchema,
  design: resolvedDesignPackSchema,
  renderMode: renderModeSchema,
});

export type ResolvedDesignPack = z.infer<typeof resolvedDesignPackSchema>;
export type RemotionInputProps = z.infer<typeof remotionInputPropsSchema>;

export interface RenderedMedia {
  bytes: Uint8Array;
  contentType: 'video/mp4';
  extension: 'mp4';
  width: number;
  height: number;
  durationInFrames: number;
}

export interface RemotionRenderEngine {
  render(
    manifest: z.input<typeof renderManifestSchema>,
    mode: z.input<typeof renderModeSchema>,
    options?: { signal?: AbortSignal; onProgress?: (progress: number) => void },
  ): Promise<RenderedMedia>;
}
