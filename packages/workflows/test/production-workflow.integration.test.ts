import { loadEnv } from '@onecrew/config';
import {
  projectSpecSchema,
  type FeishuCardActionName,
  type HumanGate,
} from '@onecrew/contracts';
import { createDatabase, createRepositories } from '@onecrew/db';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ProductionWorkflow } from '../src/production-workflow.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const database = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(database.db);
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const interruptSchema = z.object({
  gateId: z.string(),
  workflowId: z.string(),
  node: z.string(),
  targetType: z.enum(['story', 'design', 'release']),
  targetId: z.string(),
  expectedVersion: z.number().int().positive(),
});

async function currentGate(snapshot: { interrupts: unknown[] }): Promise<HumanGate> {
  const payload = interruptSchema.parse(snapshot.interrupts[0]);
  return repositories.humanGates.get(payload.gateId);
}

async function resolveGate(gate: HumanGate, action: FeishuCardActionName, eventId: string) {
  return repositories.humanGates.resolve(gate.gateId, gate.version, {
    action,
    projectId: gate.projectId,
    targetType: gate.targetType,
    targetId: gate.targetId,
    expectedVersion: gate.expectedTargetVersion,
    actorOpenId: 'ou_workflow_test',
    eventId,
  });
}

afterAll(async () => {
  await database.close();
});

describe('PostgreSQL-checkpointed LangGraph production workflow', () => {
  it('persists three human interrupts, resumes across instances and routes fallback regeneration', async () => {
    const projectId = `prj_workflow_${suffix}`;
    const workflowId = `workflow_${suffix}`;
    await repositories.projects.create(
      projectSpecSchema.parse({
        projectId,
        nameZh: '跨进程工作流',
        nameEn: 'Durable Workflow',
        synopsis: 'LangGraph PostgreSQL checkpoint integration proof.',
        audience: 'test',
        genres: ['test'],
        ownerOpenId: 'ou_workflow_test',
        locales: ['zh-CN', 'en-US'],
        aspectRatios: ['16:9', '9:16'],
        budgetLimitCny: 10,
        status: 'draft',
      }),
    );

    const firstRuns: string[] = [];
    const first = await ProductionWorkflow.create({
      repositories,
      databaseUrl: env.DATABASE_URL,
      stageHandler: async (stage, context) => {
        firstRuns.push(`${stage}:${context.route}:${context.run}`);
      },
    });
    const storyPause = await first.start({ workflowId, projectId });
    expect(storyPause).toMatchObject({
      state: { currentStage: 'human_approve_story', status: 'waiting_human' },
      next: ['human_approve_story'],
    });
    expect(firstRuns).toEqual(['project_intake:primary:1', 'story_plan:primary:1']);
    const storyGate = await currentGate(storyPause);
    expect(storyGate).toMatchObject({ node: 'human_approve_story', status: 'waiting' });
    await first.close();

    const secondRuns: string[] = [];
    const second = await ProductionWorkflow.create({
      repositories,
      databaseUrl: env.DATABASE_URL,
      stageHandler: async (stage, context) => {
        secondRuns.push(`${stage}:${context.route}:${context.run}`);
      },
    });
    await expect(second.get(workflowId)).resolves.toMatchObject({
      state: { currentStage: 'human_approve_story' },
      next: ['human_approve_story'],
    });
    const designPause = await second.resume(workflowId, 'approve');
    await resolveGate(storyGate, 'approve', `evt_story_${suffix}`);
    expect(designPause).toMatchObject({
      state: { currentStage: 'human_approve_design', status: 'waiting_human' },
      next: ['human_approve_design'],
    });
    const firstDesignGate = await currentGate(designPause);

    const regeneratedDesignPause = await second.resume(workflowId, 'switch_provider');
    await resolveGate(firstDesignGate, 'switch_provider', `evt_design_switch_${suffix}`);
    expect(regeneratedDesignPause).toMatchObject({
      state: {
        currentStage: 'human_approve_design',
        preferredRoute: 'fallback',
        stageRuns: { design_compile: 2 },
      },
      next: ['human_approve_design'],
    });
    const secondDesignGate = await currentGate(regeneratedDesignPause);
    expect(secondDesignGate.gateId).not.toBe(firstDesignGate.gateId);

    const releasePause = await second.resume(workflowId, 'approve');
    await resolveGate(secondDesignGate, 'approve', `evt_design_approve_${suffix}`);
    expect(releasePause).toMatchObject({
      state: { currentStage: 'human_approve_release', status: 'waiting_human' },
      next: ['human_approve_release'],
    });
    expect(secondRuns).toContain('design_compile:fallback:2');
    const releaseGate = await currentGate(releasePause);
    await second.close();

    const thirdRuns: string[] = [];
    const third = await ProductionWorkflow.create({
      repositories,
      databaseUrl: env.DATABASE_URL,
      stageHandler: async (stage, context) => {
        thirdRuns.push(`${stage}:${context.route}:${context.run}`);
      },
    });
    const completed = await third.resume(workflowId, 'approve');
    await resolveGate(releaseGate, 'approve', `evt_release_${suffix}`);
    expect(completed).toMatchObject({
      state: { currentStage: 'metrics_sync', status: 'done', preferredRoute: 'fallback' },
      next: [],
      interrupts: [],
    });
    expect(completed.state.completedStages).toHaveLength(12);
    expect(thirdRuns).toEqual(['publish:fallback:1', 'metrics_sync:fallback:1']);
    await third.close();
  });
});
