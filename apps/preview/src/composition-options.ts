import type { CompositionId } from '@onecrew/contracts';

export interface CompositionOption {
  id: CompositionId;
  eyebrow: string;
  label: string;
  duration: string;
  format: string;
}

export const compositionOptions: readonly CompositionOption[] = [
  { id: 'EpisodeMaster', eyebrow: '中文母版', label: '正片', duration: '60s', format: '16:9' },
  { id: 'EpisodeLocalized', eyebrow: 'EN LOCALE', label: 'Episode', duration: '60s', format: '16:9' },
  { id: 'Trailer30', eyebrow: '剧情预告', label: 'Trailer', duration: '30s', format: '16:9' },
  { id: 'Teaser15Vertical', eyebrow: '竖版预热', label: 'Teaser', duration: '15s', format: '9:16' },
  { id: 'Bumper6', eyebrow: '投放广告', label: 'Bumper', duration: '6s', format: '1:1' },
  { id: 'MotionPoster', eyebrow: '动态海报', label: 'Poster', duration: '6s', format: '9:16' },
  { id: 'PipelineSmoke', eyebrow: '技术验链', label: 'Smoke', duration: '1–15s', format: '16:9' },
] as const;

export function optionFor(id: CompositionId): CompositionOption {
  const option = compositionOptions.find((item) => item.id === id);
  if (!option) throw new Error(`Unknown composition ${id}`);
  return option;
}
