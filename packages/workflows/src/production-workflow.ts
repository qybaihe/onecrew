import {
  Command,
  END,
  START,
  StateGraph,
  StateSchema,
  interrupt,
  type StateSnapshot,
} from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { type FeishuCardActionName, type HumanGate } from '@onecrew/contracts';
import type { createRepositories } from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';
import { z } from 'zod';

type Repositories = ReturnType<typeof createRepositories>;

export const productionStageSchema = z.enum([
  'project_intake',
  'story_plan',
  'human_approve_story',
  'design_compile',
  'human_approve_design',
  'asset_generation',
  'shot_generation',
  'quality_control',
  'zh_render',
  'en_localization',
  'en_render',
  'campaign_render',
  'human_approve_release',
  'publish',
  'metrics_sync',
]);

export type ProductionStage = z.infer<typeof productionStageSchema>;

const automaticStageSchema = productionStageSchema.exclude([
  'human_approve_story',
  'human_approve_design',
  'human_approve_release',
]);
export type AutomaticProductionStage = z.infer<typeof automaticStageSchema>;

const workflowActionSchema = z.enum(['approve', 'regenerate', 'switch_provider', 'manual']);
const workflowStatusSchema = z.enum(['running', 'waiting_human', 'manual', 'done']);
const workflowIdSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);

const ProductionState = new StateSchema({
  workflowId: workflowIdSchema,
  projectId: workflowIdSchema,
  currentStage: productionStageSchema,
  completedStages: z.array(automaticStageSchema).default(() => []),
  stageRuns: z.record(z.string(), z.number().int().nonnegative()).default(() => ({})),
  preferredRoute: z.enum(['primary', 'fallback']).default('primary'),
  lastAction: z.union([workflowActionSchema, z.undefined()]),
  status: workflowStatusSchema.default('running'),
  lastGateId: z.union([workflowIdSchema, z.undefined()]),
});

export type ProductionWorkflowState = typeof ProductionState.State;

export interface ProductionStageContext {
  workflowId: string;
  projectId: string;
  route: 'primary' | 'fallback';
  run: number;
}

export type ProductionStageHandler = (
  stage: AutomaticProductionStage,
  context: ProductionStageContext,
) => Promise<void>;

export interface ProductionWorkflowOptions {
  repositories: Repositories;
  databaseUrl: string;
  stageHandler?: ProductionStageHandler;
  checkpointSchema?: string;
}

export interface ProductionWorkflowSnapshot {
  state: ProductionWorkflowState;
  next: string[];
  interrupts: unknown[];
}

const stageAfter: Record<AutomaticProductionStage, ProductionStage | typeof END> = {
  project_intake: 'story_plan',
  story_plan: 'human_approve_story',
  design_compile: 'human_approve_design',
  asset_generation: 'shot_generation',
  shot_generation: 'quality_control',
  quality_control: 'zh_render',
  zh_render: 'en_localization',
  en_localization: 'en_render',
  en_render: 'campaign_render',
  campaign_render: 'human_approve_release',
  publish: 'metrics_sync',
  metrics_sync: END,
};

function gateTarget(
  state: ProductionWorkflowState,
  node: 'human_approve_story' | 'human_approve_design' | 'human_approve_release',
): Pick<HumanGate, 'targetType' | 'targetId'> & { attempt: number } {
  const sourceStage =
    node === 'human_approve_story'
      ? 'story_plan'
      : node === 'human_approve_design'
        ? 'design_compile'
        : 'campaign_render';
  const attempt = state.stageRuns[sourceStage] ?? 1;
  const targetType =
    node === 'human_approve_story' ? 'story' : node === 'human_approve_design' ? 'design' : 'release';
  return {
    targetType,
    targetId: `${targetType}_${createInputHash({ workflowId: state.workflowId, attempt }).slice(0, 24)}_${attempt}`,
    attempt,
  };
}

function gateId(workflowId: string, node: string, attempt: number): string {
  return `gate_${createInputHash({ workflowId, node, attempt }).slice(0, 40)}`;
}

function graphConfig(workflowId: string) {
  return { configurable: { thread_id: workflowId } };
}

function parseState(value: unknown): ProductionWorkflowState {
  return z
    .object({
      workflowId: workflowIdSchema,
      projectId: workflowIdSchema,
      currentStage: productionStageSchema,
      completedStages: z.array(automaticStageSchema),
      stageRuns: z.record(z.string(), z.number().int().nonnegative()),
      preferredRoute: z.enum(['primary', 'fallback']),
      lastAction: z.union([workflowActionSchema, z.undefined()]),
      status: workflowStatusSchema,
      lastGateId: z.union([workflowIdSchema, z.undefined()]),
    })
    .parse(value);
}

export class ProductionWorkflow {
  private constructor(
    private readonly repositories: Repositories,
    private readonly checkpointer: PostgresSaver,
    private readonly graph: ReturnType<ProductionWorkflow['compileGraph']>,
  ) {}

  static async create(options: ProductionWorkflowOptions): Promise<ProductionWorkflow> {
    const checkpointer = PostgresSaver.fromConnString(options.databaseUrl, {
      schema: options.checkpointSchema ?? 'public',
    });
    await checkpointer.setup();
    const placeholder = Object.create(ProductionWorkflow.prototype) as ProductionWorkflow;
    const graph = placeholder.compileGraph(
      options.repositories,
      checkpointer,
      options.stageHandler ?? (async () => undefined),
    );
    return new ProductionWorkflow(options.repositories, checkpointer, graph);
  }

  async start(input: { workflowId: string; projectId: string }): Promise<ProductionWorkflowSnapshot> {
    const workflowId = workflowIdSchema.parse(input.workflowId);
    const projectId = workflowIdSchema.parse(input.projectId);
    await this.repositories.projects.get(projectId);
    await this.graph.invoke(
      {
        workflowId,
        projectId,
        currentStage: 'project_intake',
        completedStages: [],
        stageRuns: {},
        preferredRoute: 'primary',
        lastAction: undefined,
        status: 'running',
        lastGateId: undefined,
      },
      graphConfig(workflowId),
    );
    return this.get(workflowId);
  }

  async resume(
    workflowIdInput: string,
    actionInput: FeishuCardActionName,
  ): Promise<ProductionWorkflowSnapshot> {
    const workflowId = workflowIdSchema.parse(workflowIdInput);
    const action = workflowActionSchema.parse(actionInput);
    const before = await this.get(workflowId);
    if (before.interrupts.length === 0) {
      throw new Error(`Workflow ${workflowId} is not waiting at an interrupt`);
    }
    await this.graph.invoke(new Command({ resume: action }), graphConfig(workflowId));
    return this.get(workflowId);
  }

  async get(workflowIdInput: string): Promise<ProductionWorkflowSnapshot> {
    const workflowId = workflowIdSchema.parse(workflowIdInput);
    const snapshot = await this.graph.getState(graphConfig(workflowId));
    return this.snapshot(snapshot);
  }

  async close(): Promise<void> {
    await this.checkpointer.end();
  }

  private snapshot(snapshot: StateSnapshot): ProductionWorkflowSnapshot {
    return {
      state: parseState(snapshot.values),
      next: [...snapshot.next],
      interrupts: snapshot.tasks.flatMap((task) => task.interrupts.map((item) => item.value)),
    };
  }

  private compileGraph(
    repositories: Repositories,
    checkpointer: PostgresSaver,
    stageHandler: ProductionStageHandler,
  ) {
    const automaticNode = (stage: AutomaticProductionStage): typeof ProductionState.Node =>
      async (state) => {
        const run = (state.stageRuns[stage] ?? 0) + 1;
        await stageHandler(stage, {
          workflowId: state.workflowId,
          projectId: state.projectId,
          route: state.preferredRoute,
          run,
        });
        await repositories.audit.record({
          auditId: `audit_${createInputHash({ workflowId: state.workflowId, stage, run }).slice(0, 32)}`,
          source: 'workflow',
          eventId: `workflow_${createInputHash({ workflowId: state.workflowId, stage, run }).slice(0, 32)}`,
          projectId: state.projectId,
          action: stage,
          outcome: 'accepted',
          details: { workflowId: state.workflowId, run, route: state.preferredRoute },
        });
        const next = stageAfter[stage];
        return {
          currentStage: next === END ? stage : next,
          completedStages: Array.from(new Set([...state.completedStages, stage])),
          stageRuns: { ...state.stageRuns, [stage]: run },
          status:
            next === END
              ? 'done'
              : next.startsWith('human_approve_')
                ? 'waiting_human'
                : 'running',
        };
      };

    const humanNode = (
      node: 'human_approve_story' | 'human_approve_design' | 'human_approve_release',
      approveNext: ProductionStage,
    ): typeof ProductionState.Node =>
      async (state) => {
        const project = await repositories.projects.get(state.projectId);
        const target = gateTarget(state, node);
        const id = gateId(state.workflowId, node, target.attempt);
        await repositories.humanGates.open({
          gateId: id,
          workflowId: state.workflowId,
          projectId: state.projectId,
          node,
          targetType: target.targetType,
          targetId: target.targetId,
          expectedTargetVersion: project.version,
        });
        const action = workflowActionSchema.parse(
          interrupt({
            gateId: id,
            workflowId: state.workflowId,
            projectId: state.projectId,
            node,
            targetType: target.targetType,
            targetId: target.targetId,
            expectedVersion: project.version,
            actions: workflowActionSchema.options,
          }),
        );
        const regenerateStage =
          node === 'human_approve_story'
            ? 'story_plan'
            : node === 'human_approve_design'
              ? 'design_compile'
              : 'campaign_render';
        return {
          currentStage: action === 'approve' ? approveNext : regenerateStage,
          preferredRoute: action === 'switch_provider' ? 'fallback' : state.preferredRoute,
          lastAction: action,
          lastGateId: id,
          status: action === 'manual' ? 'manual' : 'running',
        };
      };

    const routeAfterHuman = (approveNext: ProductionStage, regenerateStage: ProductionStage) =>
      (state: ProductionWorkflowState): ProductionStage | typeof END => {
        if (state.lastAction === 'manual') return END;
        if (state.lastAction === 'regenerate' || state.lastAction === 'switch_provider') {
          return regenerateStage;
        }
        return approveNext;
      };

    return new StateGraph(ProductionState)
      .addNode('project_intake', automaticNode('project_intake'))
      .addNode('story_plan', automaticNode('story_plan'))
      .addNode('human_approve_story', humanNode('human_approve_story', 'design_compile'))
      .addNode('design_compile', automaticNode('design_compile'))
      .addNode('human_approve_design', humanNode('human_approve_design', 'asset_generation'))
      .addNode('asset_generation', automaticNode('asset_generation'))
      .addNode('shot_generation', automaticNode('shot_generation'))
      .addNode('quality_control', automaticNode('quality_control'))
      .addNode('zh_render', automaticNode('zh_render'))
      .addNode('en_localization', automaticNode('en_localization'))
      .addNode('en_render', automaticNode('en_render'))
      .addNode('campaign_render', automaticNode('campaign_render'))
      .addNode('human_approve_release', humanNode('human_approve_release', 'publish'))
      .addNode('publish', automaticNode('publish'))
      .addNode('metrics_sync', automaticNode('metrics_sync'))
      .addEdge(START, 'project_intake')
      .addEdge('project_intake', 'story_plan')
      .addEdge('story_plan', 'human_approve_story')
      .addConditionalEdges(
        'human_approve_story',
        routeAfterHuman('design_compile', 'story_plan'),
        ['design_compile', 'story_plan', END],
      )
      .addEdge('design_compile', 'human_approve_design')
      .addConditionalEdges(
        'human_approve_design',
        routeAfterHuman('asset_generation', 'design_compile'),
        ['asset_generation', 'design_compile', END],
      )
      .addEdge('asset_generation', 'shot_generation')
      .addEdge('shot_generation', 'quality_control')
      .addEdge('quality_control', 'zh_render')
      .addEdge('zh_render', 'en_localization')
      .addEdge('en_localization', 'en_render')
      .addEdge('en_render', 'campaign_render')
      .addEdge('campaign_render', 'human_approve_release')
      .addConditionalEdges(
        'human_approve_release',
        routeAfterHuman('publish', 'campaign_render'),
        ['publish', 'campaign_render', END],
      )
      .addEdge('publish', 'metrics_sync')
      .addEdge('metrics_sync', END)
      .compile({ checkpointer, name: 'onecrew-production-v1' });
  }
}
