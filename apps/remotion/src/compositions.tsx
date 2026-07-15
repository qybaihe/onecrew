import { AbsoluteFill, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

import {
  AudioBed,
  BrandProvider,
  ChapterCard,
  CTAEndCard,
  DialogueTrack,
  EpisodeTitle,
  KineticHook,
  LogoReveal,
  ProgressIndicator,
  QCWatermark,
  SafeArea,
  ShotSequence,
  SpeakerLowerThird,
  SubtitleTrack,
} from './components.js';
import { remotionInputPropsSchema, type RemotionInputProps } from './types.js';

function parsed(input: RemotionInputProps): RemotionInputProps {
  return remotionInputPropsSchema.parse(input);
}

function EpisodeComposition(input: RemotionInputProps) {
  const props = parsed(input);
  const { durationInFrames, fps } = useVideoConfig();
  const endFrames = fps * 4;
  return (
    <BrandProvider design={props.design}>
      <ShotSequence manifest={props.manifest} durationInFrames={durationInFrames} />
      <Sequence from={0} durationInFrames={fps * 3}>
        <EpisodeTitle title={props.manifest.localePack.title} />
      </Sequence>
      <Sequence from={fps * 8} durationInFrames={fps * 3}>
        <ChapterCard text={props.manifest.locale === 'zh-CN' ? '第一章 · 星门余烬' : 'CHAPTER I · EMBERS'} />
      </Sequence>
      <SubtitleTrack manifest={props.manifest} />
      <DialogueTrack manifest={props.manifest} />
      <SpeakerLowerThird manifest={props.manifest} />
      <AudioBed
        {...(props.manifest.musicUri ? { uri: props.manifest.musicUri } : {})}
        durationInFrames={durationInFrames}
        manifest={props.manifest}
      />
      <Sequence from={durationInFrames - endFrames} durationInFrames={endFrames}>
        <CTAEndCard title={props.manifest.localePack.title} cta={props.manifest.localePack.cta} />
      </Sequence>
      <ProgressIndicator />
      <QCWatermark mode={props.renderMode} />
    </BrandProvider>
  );
}

export function EpisodeMaster(input: RemotionInputProps) {
  return <EpisodeComposition {...input} />;
}

export function EpisodeLocalized(input: RemotionInputProps) {
  return <EpisodeComposition {...input} />;
}

function PromoComposition({
  input,
  endCardSeconds,
  showProgress = false,
}: {
  input: RemotionInputProps;
  endCardSeconds: number;
  showProgress?: boolean;
}) {
  const props = parsed(input);
  const { durationInFrames, fps } = useVideoConfig();
  const endCardFrames = Math.round(endCardSeconds * fps);
  const hook = props.manifest.localePack.marketingCopy[0] ?? props.manifest.localePack.title;
  return (
    <BrandProvider design={props.design}>
      <ShotSequence manifest={props.manifest} durationInFrames={durationInFrames} promo />
      <Sequence from={0} durationInFrames={Math.min(durationInFrames, fps * 4)}>
        <KineticHook text={hook} />
      </Sequence>
      <Sequence from={durationInFrames - endCardFrames} durationInFrames={endCardFrames}>
        <CTAEndCard title={props.manifest.localePack.title} cta={props.manifest.localePack.cta} />
      </Sequence>
      <AudioBed
        {...(props.manifest.musicUri ? { uri: props.manifest.musicUri } : {})}
        durationInFrames={durationInFrames}
        manifest={props.manifest}
      />
      <DialogueTrack manifest={props.manifest} />
      {showProgress ? <ProgressIndicator /> : null}
      <QCWatermark mode={props.renderMode} />
    </BrandProvider>
  );
}

export function Trailer30(input: RemotionInputProps) {
  return <PromoComposition input={input} endCardSeconds={5} showProgress />;
}

export function Teaser15Vertical(input: RemotionInputProps) {
  return <PromoComposition input={input} endCardSeconds={3} showProgress />;
}

export function Bumper6(input: RemotionInputProps) {
  return <PromoComposition input={input} endCardSeconds={2} />;
}

export function MotionPoster(input: RemotionInputProps) {
  const props = parsed(input);
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [0, durationInFrames], [1, 1.08], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <BrandProvider design={props.design}>
      <AbsoluteFill style={{ transform: `scale(${scale})` }}>
        <ShotSequence manifest={props.manifest} durationInFrames={durationInFrames} promo />
      </AbsoluteFill>
      <SafeArea>
        <div style={{ position: 'absolute', left: 0, top: 0 }}>
          <LogoReveal compact />
        </div>
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: '8%' }}>
          <KineticHook text={props.manifest.localePack.title} />
        </div>
      </SafeArea>
      <QCWatermark mode={props.renderMode} />
    </BrandProvider>
  );
}
