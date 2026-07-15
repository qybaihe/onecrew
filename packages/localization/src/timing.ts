import {
  localizationRequestSchema,
  localizedTextPackSchema,
  localePackSchema,
  renderShotSchema,
  type GeneratedAudio,
  type LocalizationRequest,
  type LocalizedTextPack,
  type LocalePack,
  type ProviderMode,
  type RenderManifest,
} from '@onecrew/contracts';

export interface LocalizedAudio {
  sourceLineId: string;
  output: GeneratedAudio & { durationMs: number };
}

export interface LocalizedTimeline {
  localePack: LocalePack;
  localizedShots: RenderManifest['shots'];
}

function localizedLineId(index: number): string {
  return `line_en_${String(index + 1).padStart(3, '0')}`;
}

export function buildLocalizedTimeline(
  requestInput: LocalizationRequest,
  translatedInput: LocalizedTextPack,
  audioInputs: LocalizedAudio[],
  mode: ProviderMode,
): LocalizedTimeline {
  const request = localizationRequestSchema.parse(requestInput);
  const translated = localizedTextPackSchema.parse(translatedInput);
  const translatedById = new Map(translated.lines.map((line) => [line.sourceLineId, line]));
  const audioById = new Map(audioInputs.map((audio) => [audio.sourceLineId, audio.output]));
  const sourceLineIds = new Set(request.sourceLocalePack.lines.map((line) => line.lineId));
  if (translated.lines.length !== sourceLineIds.size || translated.lines.some((line) => !sourceLineIds.has(line.sourceLineId))) {
    throw new Error('Localized text must contain exactly one line for each source line ID');
  }
  if (audioInputs.length !== sourceLineIds.size || audioInputs.some((audio) => !sourceLineIds.has(audio.sourceLineId))) {
    throw new Error('Localized audio must contain exactly one result for each source line ID');
  }

  const sourceShots = [...request.sharedShots].sort((left, right) => left.inFrame - right.inFrame);
  const localizedShots: RenderManifest['shots'] = [];
  const localizedLines: LocalePack['lines'] = [];
  const adjustments: NonNullable<LocalePack['shotTimingAdjustments']> = [];
  let cursorFrame = sourceShots[0]?.inFrame ?? 0;

  for (const shot of sourceShots) {
    const shotLines = request.sourceLocalePack.lines
      .filter((line) => line.shotId === shot.shotId)
      .sort((left, right) => left.startMs - right.startMs);
    const sourceDurationFrames = shot.outFrame - shot.inFrame;
    const audioDurationMs = shotLines.reduce((total, line, index) => {
      const audio = audioById.get(line.lineId);
      if (!audio?.durationMs) throw new Error(`Missing TTS duration for ${line.lineId}`);
      return total + audio.durationMs + (index === shotLines.length - 1 ? 0 : request.lineGapMs);
    }, 0);
    const requiredFrames = Math.ceil(
      ((request.leadInMs + audioDurationMs + request.tailMs) / 1_000) * request.fps,
    );
    const localizedDurationFrames = Math.max(sourceDurationFrames, requiredFrames);
    const localizedStartFrame = cursorFrame;
    const localizedEndFrame = localizedStartFrame + localizedDurationFrames;
    localizedShots.push(
      renderShotSchema.parse({
        ...shot,
        inFrame: localizedStartFrame,
        outFrame: localizedEndFrame,
      }),
    );
    adjustments.push({
      shotId: shot.shotId,
      sourceStartFrame: shot.inFrame,
      sourceEndFrame: shot.outFrame,
      localizedStartFrame,
      localizedEndFrame,
    });

    let lineCursorMs = (localizedStartFrame / request.fps) * 1_000 + request.leadInMs;
    for (const sourceLine of shotLines) {
      const localized = translatedById.get(sourceLine.lineId);
      const audio = audioById.get(sourceLine.lineId);
      if (!localized || !audio?.durationMs) throw new Error(`Incomplete localization for ${sourceLine.lineId}`);
      localizedLines.push({
        lineId: localizedLineId(localizedLines.length),
        sourceLineId: sourceLine.lineId,
        shotId: sourceLine.shotId,
        speaker: localized.speaker,
        text: localized.text,
        startMs: Math.round(lineCursorMs),
        endMs: Math.round(lineCursorMs + audio.durationMs),
        voiceId: request.targetVoiceBySourceVoice[sourceLine.voiceId]!,
        audioUri: audio.uri,
        audioDurationMs: audio.durationMs,
        translationNotes:
          localized.translationNotes ??
          (mode === 'mock' ? 'Deterministic Mock localization; requires human language review.' : 'Semantic localization'),
      });
      lineCursorMs += audio.durationMs + request.lineGapMs;
    }
    cursorFrame = localizedEndFrame;
  }

  return {
    localePack: localePackSchema.parse({
      projectId: request.projectId,
      locale: 'en-US',
      version: 1,
      sourceLocale: 'zh-CN',
      translationMode: mode,
      title: translated.title,
      lines: localizedLines,
      cta: translated.cta,
      marketingCopy: translated.marketingCopy,
      shotTimingAdjustments: adjustments,
    }),
    localizedShots,
  };
}
