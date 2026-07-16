import {
  buildCreativeStoryPlanRequest,
  CreativeStoryPlanValidationError,
  materializeCreativeStoryPlan,
} from '@onecrew/creative';
import {
  creativeStoryPlanRequestSchema,
  creativeStoryPlanSchema,
  llmProviderOutputSchema,
  type AsyncJobAccepted,
  type CreativeStoryPlan,
  type CreativeStoryPlanApplyResult,
  type CreativeStoryPlanRequest,
  type JobRecord,
} from '@onecrew/contracts';
import type { CreativeRepository } from '@onecrew/db';

import type { ProviderOrchestrator } from './provider-orchestrator.js';

export interface CreativeStoryPlanPreview {
  job: JobRecord;
  plan?: CreativeStoryPlan;
}

export class CreativeStoryPlanNotReadyError extends Error {
  constructor(readonly jobId: string, readonly status: JobRecord['status']) {
    super(`Creative story plan ${jobId} is not ready: ${status}`);
    this.name = 'CreativeStoryPlanNotReadyError';
  }
}

export class CreativeStoryPlanOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreativeStoryPlanOutputError';
  }
}

export class CreativeStoryPlanner {
  constructor(
    private readonly repository: Pick<CreativeRepository, 'getBundle' | 'appendStoryPlan'>,
    private readonly provider: Pick<ProviderOrchestrator, 'submit' | 'get'>,
  ) {}

  async submit(
    projectId: string,
    input: CreativeStoryPlanRequest,
    idempotencyKey: string,
  ): Promise<AsyncJobAccepted> {
    const request = creativeStoryPlanRequestSchema.parse(input);
    const bundle = await this.repository.getBundle(projectId);
    return this.provider.submit(buildCreativeStoryPlanRequest({ bundle, request }), idempotencyKey);
  }

  async preview(projectId: string, jobId: string): Promise<CreativeStoryPlanPreview> {
    const current = await this.provider.get(jobId);
    if (current.job.value.projectId !== projectId || current.run.request.capability !== 'llm') {
      throw new CreativeStoryPlanOutputError(`Job ${jobId} is not a story plan for project ${projectId}`);
    }
    if (current.run.request.outputSchema?.title !== 'OneCrewCreativeStoryPlan') {
      throw new CreativeStoryPlanOutputError(`Job ${jobId} does not use the creative story plan contract`);
    }
    if (current.job.value.status !== 'succeeded') return { job: current.job.value };
    if (current.output === undefined) {
      throw new CreativeStoryPlanOutputError(`Story plan output is missing for Job ${jobId}`);
    }
    const output = llmProviderOutputSchema.parse(current.output);
    if (!output.structured) throw new CreativeStoryPlanOutputError(`Story plan Job ${jobId} has no structured output`);
    const plan = creativeStoryPlanSchema.parse(output.structured);
    const expectedCount = Number(current.run.request.prompt.match(/必须输出\s+(\d+)\s+集/)?.[1] ?? 0);
    if (expectedCount > 0 && plan.episodes.length !== expectedCount) {
      throw new CreativeStoryPlanValidationError(
        `Story plan Job ${jobId} returned ${plan.episodes.length} episodes; expected ${expectedCount}`,
      );
    }
    return { job: current.job.value, plan };
  }

  async apply(
    projectId: string,
    jobId: string,
    expectedProjectVersion: number,
    actorOpenId: string,
  ): Promise<CreativeStoryPlanApplyResult> {
    const preview = await this.preview(projectId, jobId);
    if (preview.job.status !== 'succeeded' || !preview.plan) {
      throw new CreativeStoryPlanNotReadyError(jobId, preview.job.status);
    }
    const bundle = await this.repository.getBundle(projectId);
    const materialized = materializeCreativeStoryPlan({ bundle, plan: preview.plan, jobId });
    return this.repository.appendStoryPlan({
      projectId,
      jobId,
      expectedProjectVersion,
      actorOpenId,
      episodes: materialized.episodes,
      entities: materialized.entities,
    });
  }
}
