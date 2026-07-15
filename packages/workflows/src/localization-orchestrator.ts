import {
  asyncLocalizationAcceptedSchema,
  generatedAudioSchema,
  llmProviderOutputSchema,
  localizationRequestSchema,
  localizedTextPackSchema,
  type AsyncLocalizationAccepted,
  type LocalizationRequest,
  type LocalizationRunRecord,
  type LocalizedTextPack,
  type ProviderMode,
} from '@onecrew/contracts';
import { IdempotencyConflictError, type createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { buildLocalizedTimeline, createMockEnglishDraft } from '@onecrew/localization';

import type { LocalizationJobQueue } from './localization-queue.js';
import type { ProviderOrchestrator } from './provider-orchestrator.js';

type Repositories = ReturnType<typeof createRepositories>;

export interface LocalizationOrchestratorOptions {
  providerPollMs: number;
  providerTimeoutMs: number;
  cancelPollMs: number;
}

function accepted(record: LocalizationRunRecord, replayed: boolean): AsyncLocalizationAccepted {
  return asyncLocalizationAcceptedSchema.parse({
    localizationRunId: record.localizationRunId,
    status: record.status,
    statusUrl: `/v1/localizations/${record.localizationRunId}`,
    replayed,
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Cancelled'));
    const timer = setTimeout(resolve, ms);
    timer.unref();
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('Cancelled'));
    }, { once: true });
  });
}

const translationOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'cta', 'marketingCopy', 'lines'],
  properties: {
    title: { type: 'string' },
    cta: { type: 'string' },
    marketingCopy: { type: 'array', items: { type: 'string' }, minItems: 1 },
    lines: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['sourceLineId', 'speaker', 'text', 'translationNotes'],
        properties: {
          sourceLineId: { type: 'string' },
          speaker: { type: 'string' },
          text: { type: 'string' },
          translationNotes: { type: 'string' },
        },
      },
    },
  },
} as const;

export class LocalizationOrchestrator {
  constructor(
    private readonly repositories: Repositories,
    private readonly queue: LocalizationJobQueue,
    private readonly provider: Pick<ProviderOrchestrator, 'submit' | 'get' | 'regenerate' | 'cancel'>,
    private readonly options: LocalizationOrchestratorOptions,
  ) {}

  async submit(input: LocalizationRequest, idempotencyKey: string): Promise<AsyncLocalizationAccepted> {
    const request = localizationRequestSchema.parse(input);
    if (!idempotencyKey.trim()) throw new Error('Idempotency-Key header is required');
    const requestHash = createInputHash(request);
    const scope = `localization-submit:${request.projectId}`;
    const existing = await this.repositories.localizationRuns.getByIdempotency(request.projectId, idempotencyKey);
    if (existing) {
      if (createInputHash(existing.value.request) !== requestHash) {
        throw new IdempotencyConflictError(scope, idempotencyKey);
      }
      if (existing.value.status === 'queued') await this.queue.enqueue(existing.value.localizationRunId);
      return accepted(existing.value, true);
    }
    const reservation = await this.repositories.idempotency.reserve(scope, idempotencyKey, requestHash);
    if (reservation.state === 'replayed') return asyncLocalizationAcceptedSchema.parse(reservation.response);
    if (reservation.state === 'in_progress') throw new Error(`Localization submission is in progress: ${idempotencyKey}`);
    let persisted = false;
    try {
      const now = new Date().toISOString();
      const record: LocalizationRunRecord = {
        localizationRunId: `loc_${Date.now().toString(36)}_${requestHash.slice(0, 20)}`,
        request,
        status: 'queued',
        ttsJobIds: [],
        createdAt: now,
        updatedAt: now,
      };
      await this.repositories.localizationRuns.create(record, idempotencyKey);
      persisted = true;
      await this.queue.enqueue(record.localizationRunId);
      const response = accepted(record, false);
      await this.repositories.idempotency.complete(scope, idempotencyKey, requestHash, {
        response,
        resourceType: 'localization_run',
        resourceId: record.localizationRunId,
      });
      return response;
    } catch (error) {
      if (!persisted) await this.repositories.idempotency.release(scope, idempotencyKey, requestHash);
      throw error;
    }
  }

  async get(localizationRunId: string) {
    return this.repositories.localizationRuns.get(localizationRunId);
  }

  async cancel(localizationRunId: string): Promise<{ status: 'cancelled' | 'already_terminal' }> {
    const current = await this.repositories.localizationRuns.get(localizationRunId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { status: 'already_terminal' };
    }
    await this.queue.cancel(localizationRunId);
    const jobIds = [current.value.translationJobId, ...current.value.ttsJobIds].filter(Boolean) as string[];
    await Promise.all(jobIds.map((jobId) => this.provider.cancel(jobId).catch(() => undefined)));
    await this.repositories.localizationRuns.transition(localizationRunId, current.version, 'cancelled', {
      errorCode: 'LOCALIZATION_CANCELLED',
      errorMessage: 'Localization cancelled by request',
    });
    return { status: 'cancelled' };
  }

  async execute(localizationRunId: string): Promise<{ localizationRunId: string; status: LocalizationRunRecord['status'] }> {
    let current = await this.repositories.localizationRuns.get(localizationRunId);
    if (current.value.status === 'succeeded' || current.value.status === 'cancelled') {
      return { localizationRunId, status: current.value.status };
    }
    if (current.value.status === 'failed') {
      current = await this.repositories.localizationRuns.transition(localizationRunId, current.version, 'queued', {
        errorCode: undefined,
        errorMessage: undefined,
      });
    }
    if (current.value.status !== 'queued') throw new Error(`Localization ${localizationRunId} cannot execute from ${current.value.status}`);
    current = await this.repositories.localizationRuns.transition(localizationRunId, current.version, 'running');
    const controller = new AbortController();
    const activeJobs = new Set<string>();
    let checking = false;
    const timer = setInterval(() => {
      if (checking) return;
      checking = true;
      void this.repositories.localizationRuns.get(localizationRunId).then(async (latest) => {
        if (latest.value.status !== 'cancelled') return;
        controller.abort();
        await Promise.all([...activeJobs].map((jobId) => this.provider.cancel(jobId).catch(() => undefined)));
      }).catch(() => undefined).finally(() => { checking = false; });
    }, this.options.cancelPollMs);
    timer.unref();

    try {
      const draft = createMockEnglishDraft(current.value.request.sourceLocalePack);
      const translation = await this.provider.submit(
        {
          capability: 'llm',
          projectId: current.value.request.projectId,
          route: current.value.request.route,
          operation: 'translate',
          locale: 'en-US',
          imageUris: [],
          maxOutputTokens: 8_000,
          outputSchema: translationOutputSchema,
          prompt: [
            'Semantically localize the zh-CN master into concise idiomatic en-US.',
            'Preserve character relationships, story function and emotion; adapt sentence length for speech and subtitles.',
            `SOURCE_JSON=${JSON.stringify(current.value.request.sourceLocalePack)}`,
            'The final line is an approved translation-memory draft for deterministic Mock mode; improve it when using a real model.',
            `ONECREW_MOCK_OUTPUT_JSON=${JSON.stringify(draft)}`,
          ].join('\n'),
        },
        `localization-translate-${localizationRunId}`,
      );
      activeJobs.add(translation.jobId);
      current = await this.repositories.localizationRuns.transition(localizationRunId, current.version, 'waiting_provider', {
        translationJobId: translation.jobId,
        mode: translation.mode,
      });
      const translationResult = await this.waitWithFallback(
        translation.jobId,
        current.value.request.route,
        `localization-translate-fallback-${localizationRunId}`,
        controller.signal,
        activeJobs,
      );
      if (translationResult.jobId !== translation.jobId) {
        current = await this.repositories.localizationRuns.patch(localizationRunId, current.version, {
          translationJobId: translationResult.jobId,
        });
      }
      const translated = this.parseTranslation(translationResult.output);

      const ttsAccepted = await Promise.all(
        translated.lines.map((line, index) => {
          const source = current.value.request.sourceLocalePack.lines.find((item) => item.lineId === line.sourceLineId);
          if (!source) throw new Error(`Translation references unknown source line ${line.sourceLineId}`);
          return this.provider.submit(
            {
              capability: 'tts',
              projectId: current.value.request.projectId,
              route: current.value.request.route,
              lineId: `tts_${localizationRunId}_${index + 1}`,
              text: line.text,
              locale: 'en-US',
              voiceId: current.value.request.targetVoiceBySourceVoice[source.voiceId]!,
              outputFormat: 'wav_44100',
            },
            `localization-tts-${localizationRunId}-${source.lineId}`,
          );
        }),
      );
      for (const acceptedJob of ttsAccepted) activeJobs.add(acceptedJob.jobId);
      current = await this.repositories.localizationRuns.patch(localizationRunId, current.version, {
        ttsJobIds: ttsAccepted.map((job) => job.jobId),
      });
      const ttsResults = await Promise.all(
        ttsAccepted.map((job, index) =>
          this.waitWithFallback(
            job.jobId,
            current.value.request.route,
            `localization-tts-fallback-${localizationRunId}-${index + 1}`,
            controller.signal,
            activeJobs,
          ),
        ),
      );
      const actualTtsJobIds = ttsResults.map((result) => result.jobId);
      if (actualTtsJobIds.some((jobId, index) => jobId !== ttsAccepted[index]?.jobId)) {
        current = await this.repositories.localizationRuns.patch(localizationRunId, current.version, {
          ttsJobIds: actualTtsJobIds,
        });
      }
      const modes = new Set<ProviderMode>([translationResult.mode, ...ttsResults.map((result) => result.mode)]);
      const mode: ProviderMode = modes.size === 1 ? [...modes][0]! : 'sandbox';
      const timeline = buildLocalizedTimeline(
        current.value.request,
        translated,
        translated.lines.map((line, index) => {
          const output = generatedAudioSchema.parse(ttsResults[index]?.output);
          if (!output.durationMs) throw new Error(`TTS Provider did not return duration for ${line.sourceLineId}`);
          return { sourceLineId: line.sourceLineId, output: { ...output, durationMs: output.durationMs } };
        }),
        mode,
      );
      const latestPack = await this.repositories.localePacks.latest(current.value.request.projectId, 'en-US');
      const version = (latestPack?.version ?? 0) + 1;
      const pack = { ...timeline.localePack, version };
      const contentHash = createInputHash({ pack, shots: timeline.localizedShots });
      const localePackId = `locale_en_${contentHash.slice(0, 24)}`;
      await this.repositories.localePacks.create({
        localePackId,
        projectId: current.value.request.projectId,
        locale: 'en-US',
        version,
        pack,
        sourceLocalizationRunId: localizationRunId,
        contentHash,
        createdAt: new Date().toISOString(),
      });
      current = await this.repositories.localizationRuns.transition(localizationRunId, current.version, 'succeeded', {
        localePackId,
        localePack: pack,
        localizedShots: timeline.localizedShots,
        mode,
      });
      await this.repositories.audit.record({
        auditId: `audit_${createInputHash({ localizationRunId, status: 'succeeded' }).slice(0, 32)}`,
        source: 'workflow',
        eventId: `localization_${createInputHash({ localizationRunId }).slice(0, 32)}`,
        projectId: current.value.request.projectId,
        action: 'localization_completed',
        outcome: 'accepted',
        targetType: 'locale_pack',
        targetId: localePackId,
        details: {
          sourceLocale: 'zh-CN',
          targetLocale: 'en-US',
          mode,
          sharedShotIds: timeline.localizedShots.map((shot) => shot.shotId),
          translationJobId: translation.jobId,
          ttsJobIds: actualTtsJobIds,
        },
      });
      return { localizationRunId, status: current.value.status };
    } catch (error) {
      const latest = await this.repositories.localizationRuns.get(localizationRunId);
      if (latest.value.status === 'cancelled') return { localizationRunId, status: 'cancelled' };
      if (latest.value.status === 'running' || latest.value.status === 'waiting_provider') {
        const failed = await this.repositories.localizationRuns.transition(localizationRunId, latest.version, 'failed', {
          errorCode: 'LOCALIZATION_EXECUTION_ERROR',
          errorMessage: error instanceof Error ? error.message : 'Unknown localization error',
        });
        return { localizationRunId, status: failed.value.status };
      }
      throw error;
    } finally {
      clearInterval(timer);
    }
  }

  private parseTranslation(output: unknown): LocalizedTextPack {
    const parsed = llmProviderOutputSchema.parse(output);
    return localizedTextPackSchema.parse(parsed.structured ?? JSON.parse(parsed.text));
  }

  private async waitWithFallback(
    jobId: string,
    route: 'primary' | 'fallback',
    idempotencyKey: string,
    signal: AbortSignal,
    activeJobs: Set<string>,
  ): Promise<{ jobId: string; output: unknown; mode: ProviderMode }> {
    try {
      const result = await this.waitForJob(jobId, signal);
      activeJobs.delete(jobId);
      return { jobId, ...result };
    } catch (error) {
      activeJobs.delete(jobId);
      if (route === 'fallback' || signal.aborted) throw error;
      const fallback = await this.provider.regenerate(jobId, 'fallback', idempotencyKey);
      activeJobs.add(fallback.jobId);
      const result = await this.waitForJob(fallback.jobId, signal);
      activeJobs.delete(fallback.jobId);
      return { jobId: fallback.jobId, ...result };
    }
  }

  private async waitForJob(jobId: string, signal: AbortSignal): Promise<{ output: unknown; mode: ProviderMode }> {
    const deadline = Date.now() + this.options.providerTimeoutMs;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error('Localization was cancelled');
      const state = await this.provider.get(jobId);
      if (state.job.value.status === 'succeeded') {
        if (!('output' in state)) throw new Error(`Provider output is missing for ${jobId}`);
        return { output: state.output, mode: state.job.value.mode };
      }
      if (state.job.value.status === 'failed') {
        throw new Error(state.job.value.errorMessage ?? state.job.value.errorCode ?? `Provider job ${jobId} failed`);
      }
      if (state.job.value.status === 'cancelled') throw new Error(`Provider job ${jobId} was cancelled`);
      await delay(this.options.providerPollMs, signal);
    }
    throw new Error(`Provider job ${jobId} timed out after ${this.options.providerTimeoutMs}ms`);
  }
}
