import {
  budgetAllocationDraftSchema,
  buildBudgetAllocationRequest,
  materializeBudgetAllocationPlan,
  readBudgetAllocationContext,
} from '@onecrew/creative';
import {
  budgetAllocationRequestSchema,
  llmProviderOutputSchema,
  type AsyncJobAccepted,
  type BudgetAllocationPlan,
  type BudgetAllocationRequest,
  type JobRecord,
} from '@onecrew/contracts';
import type { CreativeRepository } from '@onecrew/db';

import type { ProviderOrchestrator } from './provider-orchestrator.js';

export interface BudgetAllocationPlanPreview {
  job: JobRecord;
  plan?: BudgetAllocationPlan;
}

export class BudgetAllocationPlanNotReadyError extends Error {
  constructor(
    readonly jobId: string,
    readonly status: JobRecord['status'],
  ) {
    super(`Budget allocation plan ${jobId} is not ready: ${status}`);
    this.name = 'BudgetAllocationPlanNotReadyError';
  }
}

export class BudgetAllocationPlannerOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetAllocationPlannerOutputError';
  }
}

export class BudgetAllocationPlanner {
  constructor(
    private readonly repository: Pick<CreativeRepository, 'getBundle'>,
    private readonly provider: Pick<ProviderOrchestrator, 'submit' | 'get'>,
  ) {}

  async submit(
    projectId: string,
    input: BudgetAllocationRequest,
    idempotencyKey: string,
  ): Promise<AsyncJobAccepted> {
    const request = budgetAllocationRequestSchema.parse(input);
    const bundle = await this.repository.getBundle(projectId);
    return this.provider.submit(
      buildBudgetAllocationRequest({ project: bundle.project, request }),
      idempotencyKey,
    );
  }

  async preview(projectId: string, jobId: string): Promise<BudgetAllocationPlanPreview> {
    const current = await this.provider.get(jobId);
    if (current.job.value.projectId !== projectId || current.run.request.capability !== 'llm') {
      throw new BudgetAllocationPlannerOutputError(
        `Job ${jobId} is not a budget allocation plan for project ${projectId}`,
      );
    }
    if (
      current.run.request.operation !== 'budget_allocation'
      || current.run.request.outputSchema?.title !== 'OneCrewBudgetAllocationDraft'
    ) {
      throw new BudgetAllocationPlannerOutputError(
        `Job ${jobId} does not use the budget allocation contract`,
      );
    }
    if (current.job.value.status !== 'succeeded') return { job: current.job.value };
    if (current.output === undefined) {
      throw new BudgetAllocationPlannerOutputError(
        `Budget allocation output is missing for Job ${jobId}`,
      );
    }
    const output = llmProviderOutputSchema.parse(current.output);
    if (!output.structured) {
      throw new BudgetAllocationPlannerOutputError(
        `Budget allocation Job ${jobId} has no structured output`,
      );
    }
    try {
      const draft = budgetAllocationDraftSchema.parse(output.structured);
      const request = readBudgetAllocationContext(current.run.request.prompt);
      return { job: current.job.value, plan: materializeBudgetAllocationPlan(request, draft) };
    } catch (error) {
      throw new BudgetAllocationPlannerOutputError(
        `Budget allocation Job ${jobId} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
