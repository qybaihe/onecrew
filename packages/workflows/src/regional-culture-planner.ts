import { buildRegionalCultureRequest } from '@onecrew/creative';
import {
  llmProviderOutputSchema,
  regionalCulturePackRequestSchema,
  regionalCulturePackSchema,
  type AsyncJobAccepted,
  type JobRecord,
  type RegionalCulturePack,
  type RegionalCulturePackRequest,
} from '@onecrew/contracts';
import type { CreativeRepository } from '@onecrew/db';

import type { ProviderOrchestrator } from './provider-orchestrator.js';

export interface RegionalCulturePackPreview {
  job: JobRecord;
  pack?: RegionalCulturePack;
}

export class RegionalCulturePackNotReadyError extends Error {
  constructor(
    readonly jobId: string,
    readonly status: JobRecord['status'],
  ) {
    super(`Regional culture pack ${jobId} is not ready: ${status}`);
    this.name = 'RegionalCulturePackNotReadyError';
  }
}

export class RegionalCulturePlannerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegionalCulturePlannerOutputError';
  }
}

export class RegionalCulturePlanner {
  constructor(
    private readonly repository: Pick<CreativeRepository, 'getBundle'>,
    private readonly provider: Pick<ProviderOrchestrator, 'submit' | 'get'>,
  ) {}

  async submit(
    projectId: string,
    input: RegionalCulturePackRequest,
    idempotencyKey: string,
  ): Promise<AsyncJobAccepted> {
    const request = regionalCulturePackRequestSchema.parse(input);
    const bundle = await this.repository.getBundle(projectId);
    return this.provider.submit(
      buildRegionalCultureRequest({ project: bundle.project, request }),
      idempotencyKey,
    );
  }

  async preview(projectId: string, jobId: string): Promise<RegionalCulturePackPreview> {
    const current = await this.provider.get(jobId);
    if (current.job.value.projectId !== projectId || current.run.request.capability !== 'llm') {
      throw new RegionalCulturePlannerOutputError(
        `Job ${jobId} is not a regional culture pack for project ${projectId}`,
      );
    }
    if (current.run.request.outputSchema?.title !== 'OneCrewRegionalCulturePack') {
      throw new RegionalCulturePlannerOutputError(
        `Job ${jobId} does not use the regional culture pack contract`,
      );
    }
    if (current.job.value.status !== 'succeeded') return { job: current.job.value };
    if (current.output === undefined) {
      throw new RegionalCulturePlannerOutputError(`Regional culture pack output is missing for Job ${jobId}`);
    }
    const output = llmProviderOutputSchema.parse(current.output);
    if (!output.structured) {
      throw new RegionalCulturePlannerOutputError(`Regional culture pack Job ${jobId} has no structured output`);
    }
    const pack = regionalCulturePackSchema.parse(output.structured);
    return { job: current.job.value, pack };
  }
}
