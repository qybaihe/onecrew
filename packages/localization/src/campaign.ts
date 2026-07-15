import {
  campaignPlanSchema,
  renderManifestSchema,
  type CampaignPlan,
  type DesignPackManifest,
  type LocalePack,
  type RenderManifest,
} from '@onecrew/contracts';

const variants = [
  { compositionId: 'Trailer30', aspectRatio: '16:9', width: 1920, height: 1080 },
  { compositionId: 'Teaser15Vertical', aspectRatio: '9:16', width: 1080, height: 1920 },
  { compositionId: 'Bumper6', aspectRatio: '1:1', width: 1080, height: 1080 },
  { compositionId: 'MotionPoster', aspectRatio: '9:16', width: 1080, height: 1920 },
] as const;

export interface CampaignPlanInput {
  campaignId: string;
  projectId: string;
  designPack: DesignPackManifest;
  zhLocalePack: LocalePack;
  enLocalePack: LocalePack;
  zhShots: RenderManifest['shots'];
  enShots: RenderManifest['shots'];
}

export function buildCampaignPlan(input: CampaignPlanInput): CampaignPlan {
  const manifests = [
    { localePack: input.zhLocalePack, shots: input.zhShots },
    { localePack: input.enLocalePack, shots: input.enShots },
  ].flatMap(({ localePack, shots }) =>
    variants.map((variant) =>
      renderManifestSchema.parse({
        renderId: `render_${input.campaignId}_${localePack.locale.replace('-', '_')}_${variant.compositionId}`,
        projectId: input.projectId,
        compositionId: variant.compositionId,
        locale: localePack.locale,
        aspectRatio: variant.aspectRatio,
        fps: 30,
        designPack: input.designPack,
        localePack,
        shots,
        output: { codec: 'h264', width: variant.width, height: variant.height },
      }),
    ),
  );
  return campaignPlanSchema.parse({
    campaignId: input.campaignId,
    projectId: input.projectId,
    sharedShotIds: input.zhShots.map((shot) => shot.shotId),
    variants: manifests,
  });
}

export function buildLocalizedEpisodeManifest(input: {
  renderId: string;
  projectId: string;
  designPack: DesignPackManifest;
  localePack: LocalePack;
  shots: RenderManifest['shots'];
}): RenderManifest {
  return renderManifestSchema.parse({
    ...input,
    compositionId: 'EpisodeLocalized',
    locale: 'en-US',
    aspectRatio: '16:9',
    fps: 30,
    output: { codec: 'h264', width: 1920, height: 1080 },
  });
}
