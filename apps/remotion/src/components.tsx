import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  createContext,
  type CSSProperties,
  type PropsWithChildren,
  useContext,
} from 'react';

import type { RemotionInputProps } from './types.js';

type Design = RemotionInputProps['design'];

const BrandContext = createContext<Design | null>(null);

function useBrand(): Design {
  const brand = useContext(BrandContext);
  if (!brand) throw new Error('OneCrew Remotion component must be inside BrandProvider');
  return brand;
}

export function BrandProvider({
  design,
  children,
}: PropsWithChildren<{ design: Design }>) {
  const tokens = design.brandTokens;
  const fontFamily = [tokens.typography.zhFamily, ...tokens.typography.fallback]
    .map((font) => (font.includes(' ') ? `"${font}"` : font))
    .join(', ');
  return (
    <BrandContext.Provider value={design}>
      <AbsoluteFill
        style={{
          backgroundColor: tokens.colors.background,
          color: tokens.colors.text,
          fontFamily,
          overflow: 'hidden',
        }}
      >
        {children}
      </AbsoluteFill>
    </BrandContext.Provider>
  );
}

export function SafeArea({ children }: PropsWithChildren) {
  const { brandTokens } = useBrand();
  return (
    <AbsoluteFill
      style={{
        paddingLeft: `${brandTokens.spacing.safeHorizontalPercent}%`,
        paddingRight: `${brandTokens.spacing.safeHorizontalPercent}%`,
        paddingTop: `${brandTokens.spacing.safeVerticalPercent}%`,
        paddingBottom: `${brandTokens.spacing.safeVerticalPercent}%`,
        pointerEvents: 'none',
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

function mockPalette(uri: string): [string, string, string] {
  let value = 0;
  for (const char of uri) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  const hue = value % 360;
  return [`hsl(${hue} 52% 18%)`, `hsl(${(hue + 42) % 360} 64% 31%)`, `hsl(${(hue + 178) % 360} 70% 18%)`];
}

function SyntheticShot({ uri, shotId }: { uri: string; shotId: string }) {
  const frame = useCurrentFrame();
  const [a, b, c] = mockPalette(uri);
  const drift = Math.sin(frame / 28) * 4;
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${42 + drift}% ${38 - drift / 2}%, ${b}, transparent 34%), linear-gradient(135deg, ${a}, ${c})`,
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: '14%',
          border: '2px solid rgba(255,255,255,0.13)',
          transform: `translateX(${drift}px) rotate(-2deg)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: '6%',
          top: '7%',
          color: 'rgba(255,255,255,0.34)',
          fontSize: 18,
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        MOCK · {shotId}
      </div>
    </AbsoluteFill>
  );
}

export function SmartCrop({
  crop,
  children,
}: PropsWithChildren<{ crop?: { x: number; y: number; scale: number } }>) {
  const normalized = crop ?? { x: 0.5, y: 0.5, scale: 1 };
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          transform: `scale(${normalized.scale})`,
          transformOrigin: `${normalized.x * 100}% ${normalized.y * 100}%`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function ShotMedia({
  shot,
}: {
  shot: RemotionInputProps['manifest']['shots'][number];
}) {
  const parsed = new URL(shot.videoUri);
  return (
    <SmartCrop {...(shot.crop ? { crop: shot.crop } : {})}>
      {parsed.protocol === 'mock:' ? (
        <SyntheticShot uri={shot.videoUri} shotId={shot.shotId} />
      ) : (
        <OffthreadVideo
          src={shot.videoUri}
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}
    </SmartCrop>
  );
}

export function ShotSequence({
  manifest,
  durationInFrames,
  promo = false,
}: {
  manifest: RemotionInputProps['manifest'];
  durationInFrames: number;
  promo?: boolean;
}) {
  const shots = manifest.shots;
  if (!promo) {
    return shots.map((shot) => (
      <Sequence
        key={shot.shotId}
        from={shot.inFrame}
        durationInFrames={shot.outFrame - shot.inFrame}
        premountFor={30}
      >
        <ShotMedia shot={shot} />
      </Sequence>
    ));
  }
  const contentDuration = Math.max(1, Math.floor(durationInFrames * 0.82));
  const segment = Math.max(1, Math.ceil(contentDuration / Math.min(shots.length, 5)));
  return Array.from({ length: Math.min(shots.length, 5) }, (_, index) => {
    const from = index * segment;
    const duration = Math.min(segment, contentDuration - from);
    if (duration <= 0) return null;
    const shot = shots[(index * 2) % shots.length];
    if (!shot) return null;
    return (
      <Sequence key={`${shot.shotId}_${index}`} from={from} durationInFrames={duration} premountFor={15}>
        <ShotMedia shot={shot} />
      </Sequence>
    );
  });
}

function activeLine(
  manifest: RemotionInputProps['manifest'],
  frame: number,
) {
  const milliseconds = (frame / manifest.fps) * 1_000;
  return manifest.localePack.lines.find(
    (line) => milliseconds >= line.startMs && milliseconds < line.endMs,
  );
}

export function SubtitleTrack({ manifest }: { manifest: RemotionInputProps['manifest'] }) {
  const frame = useCurrentFrame();
  const line = activeLine(manifest, frame);
  const { brandTokens } = useBrand();
  if (!line) return null;
  return (
    <SafeArea>
      <div
        style={{
          position: 'absolute',
          left: '7%',
          right: '7%',
          bottom: '2%',
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            maxWidth: '86%',
            padding: '16px 28px',
            borderRadius: 8,
            background: `${brandTokens.colors.background}E8`,
            boxShadow: `inset 4px 0 0 ${brandTokens.colors.primary}`,
            fontSize: brandTokens.typography.subtitleSizePx,
            lineHeight: brandTokens.typography.lineHeight,
            fontWeight: 600,
            textAlign: 'center',
          }}
        >
          {line.text}
        </div>
      </div>
    </SafeArea>
  );
}

export function DialogueTrack({ manifest }: { manifest: RemotionInputProps['manifest'] }) {
  return manifest.localePack.lines.flatMap((line) => {
    if (!line.audioUri) return [];
    const parsed = new URL(line.audioUri);
    if (parsed.protocol === 'mock:') return [];
    const from = Math.max(0, Math.round((line.startMs / 1_000) * manifest.fps));
    const durationInFrames = Math.max(
      1,
      Math.round(((line.audioDurationMs ?? line.endMs - line.startMs) / 1_000) * manifest.fps),
    );
    return [
      <Sequence key={`dialogue_${line.lineId}`} from={from} durationInFrames={durationInFrames}>
        <Audio src={line.audioUri} volume={1} />
      </Sequence>,
    ];
  });
}

export function SpeakerLowerThird({ manifest }: { manifest: RemotionInputProps['manifest'] }) {
  const frame = useCurrentFrame();
  const line = activeLine(manifest, frame);
  const { brandTokens, motionTokens } = useBrand();
  if (!line) return null;
  const opacity = interpolate(frame % 180, [0, motionTokens.durationFrames.normal], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <SafeArea>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: '18%',
          padding: '10px 20px 10px 24px',
          background: `${brandTokens.colors.surface}E6`,
          borderLeft: `6px solid ${brandTokens.colors.primary}`,
          color: brandTokens.colors.text,
          fontSize: 25,
          fontWeight: 700,
          opacity,
        }}
      >
        {line.speaker}
      </div>
    </SafeArea>
  );
}

export function EpisodeTitle({ title }: { title: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { brandTokens } = useBrand();
  const opacity = interpolate(frame, [0, 12, fps * 2.3, fps * 3], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', opacity }}>
      <div style={{ fontFamily: brandTokens.typography.displayFamily, fontSize: 92, fontWeight: 700 }}>
        {title}
      </div>
      <div style={{ width: 180, height: 4, marginTop: 24, background: brandTokens.colors.primary }} />
    </AbsoluteFill>
  );
}

export function ChapterCard({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { brandTokens } = useBrand();
  const slide = interpolate(frame, [0, 18], [40, 0], { extrapolateRight: 'clamp' });
  return (
    <SafeArea>
      <div
        style={{
          alignSelf: 'flex-start',
          marginTop: '8%',
          color: brandTokens.colors.secondary,
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: 3,
          transform: `translateY(${slide}px)`,
        }}
      >
        {text}
      </div>
    </SafeArea>
  );
}

export function LogoReveal({ compact = false }: { compact?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const design = useBrand();
  const scale = spring({ frame, fps, from: 1.02, to: 1, config: { damping: 18, stiffness: 90 } });
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, opacity, transform: `scale(${scale})` }}>
      <Img src={design.logoDataUri} style={{ width: compact ? 74 : 112, height: compact ? 74 : 112 }} />
      <div>
        <div style={{ fontSize: compact ? 34 : 52, fontWeight: 700 }}>{design.brandTokens.brand.nameZh}</div>
        <div style={{ color: design.brandTokens.colors.muted, fontSize: compact ? 18 : 24, letterSpacing: 4 }}>
          {design.brandTokens.brand.nameEn.toUpperCase()}
        </div>
      </div>
    </div>
  );
}

export function CTAEndCard({ title, cta }: { title: string; cta: string }) {
  const { brandTokens } = useBrand();
  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        gap: 42,
        background: `radial-gradient(circle at 50% 35%, ${brandTokens.colors.surface}, ${brandTokens.colors.background} 62%)`,
      }}
    >
      <LogoReveal />
      <div style={{ fontSize: 52, fontWeight: 700 }}>{title}</div>
      <div
        style={{
          padding: '18px 34px',
          background: brandTokens.colors.secondary,
          color: brandTokens.colors.background,
          fontSize: 32,
          fontWeight: 700,
          borderRadius: 6,
        }}
      >
        {cta}
      </div>
    </AbsoluteFill>
  );
}

export function KineticHook({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { brandTokens } = useBrand();
  const entrance = spring({ frame, fps, from: 1.12, to: 1, config: { damping: 16, stiffness: 120 } });
  const style: CSSProperties = {
    position: 'absolute',
    left: '7%',
    right: '7%',
    top: '11%',
    fontSize: 58,
    lineHeight: 1.08,
    fontWeight: 700,
    textShadow: `0 4px 30px ${brandTokens.colors.background}`,
    transform: `scale(${entrance})`,
    transformOrigin: 'left center',
  };
  return <div style={style}>{text}</div>;
}

export function AudioDucking({ frame, duration }: { frame: number; duration: number }): number {
  const edge = 20;
  return interpolate(frame, [0, edge, Math.max(edge, duration - edge), duration], [0, 0.32, 0.32, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

export function AudioBed({
  uri,
  durationInFrames,
  manifest,
}: {
  uri?: string;
  durationInFrames: number;
  manifest?: RemotionInputProps['manifest'];
}) {
  const frame = useCurrentFrame();
  if (!uri || new URL(uri).protocol === 'mock:') return null;
  const envelope = AudioDucking({ frame, duration: durationInFrames });
  const dialogueIsActive = manifest ? activeLine(manifest, frame) !== undefined : false;
  return <Audio src={uri} volume={dialogueIsActive ? Math.min(envelope, 0.1) : envelope} />;
}

export function ProgressIndicator() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { brandTokens } = useBrand();
  const progress = Math.min(1, (frame + 1) / durationInFrames);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 5, background: 'rgba(255,255,255,0.1)' }}>
      <div style={{ height: '100%', width: `${progress * 100}%`, background: brandTokens.colors.primary }} />
    </div>
  );
}

export function QCWatermark({ mode }: { mode: RemotionInputProps['renderMode'] }) {
  if (mode !== 'preview') return null;
  return (
    <div
      style={{
        position: 'absolute',
        right: 24,
        bottom: 24,
        border: '1px solid rgba(255,255,255,0.55)',
        color: 'rgba(255,255,255,0.75)',
        padding: '7px 12px',
        fontSize: 16,
        fontWeight: 700,
        letterSpacing: 2,
      }}
    >
      ONECREW · PREVIEW
    </div>
  );
}
