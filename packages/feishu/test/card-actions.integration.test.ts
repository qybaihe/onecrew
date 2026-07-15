import { loadEnv } from '@onecrew/config';
import { projectSpecSchema, type FeishuCardActionName } from '@onecrew/contracts';
import { auditLogs, createDatabase, createRepositories } from '@onecrew/db';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CardActionService,
  type CardActionRuntime,
  UnauthorizedFeishuActorError,
} from '../src/action-service.js';

const env = loadEnv({ ...process.env, NODE_ENV: 'test' });
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const projectId = `prj_feishu_${suffix}`;
const actorOpenId = 'ou_authorized_operator';
const firstClient = createDatabase(env.DATABASE_URL);
const firstRepositories = createRepositories(firstClient.db);

await firstRepositories.projects.create(
  projectSpecSchema.parse({
    projectId,
    nameZh: '飞书动作集成测试',
    nameEn: 'Feishu Action Integration',
    synopsis: '验证跨连接人工闸门、四动作、操作者与幂等。',
    audience: '开发测试',
    genres: ['test'],
    ownerOpenId: actorOpenId,
    locales: ['zh-CN', 'en-US'],
    aspectRatios: ['16:9'],
    budgetLimitCny: 1,
    status: 'waiting_human',
  }),
);

const actions: FeishuCardActionName[] = ['approve', 'regenerate', 'switch_provider', 'manual'];
for (const [index, action] of actions.entries()) {
  await firstRepositories.humanGates.open({
    gateId: `gate_${action}_${suffix}`,
    workflowId: `workflow_${suffix}`,
    projectId,
    node: 'human_approve_release',
    targetType: 'job',
    targetId: `job_target_${index}_${suffix}`,
    expectedTargetVersion: 1,
  });
}
await firstClient.close();

const client = createDatabase(env.DATABASE_URL);
const repositories = createRepositories(client.db);
const calls = new Map<FeishuCardActionName, number>();
const count = (action: FeishuCardActionName) => calls.set(action, (calls.get(action) ?? 0) + 1);
const runtime: CardActionRuntime = {
  async approve() {
    count('approve');
    return { outcome: 'resumed' };
  },
  async regenerate() {
    count('regenerate');
    return { outcome: 'regeneration_queued', providerRoute: 'current' };
  },
  async switchProvider() {
    count('switch_provider');
    return { outcome: 'regeneration_queued', providerRoute: 'fallback' };
  },
  async manual() {
    count('manual');
    return { outcome: 'manual_required' };
  },
};
const service = new CardActionService({
  idempotency: repositories.idempotency,
  audit: repositories.audit,
  humanGates: repositories.humanGates,
  runtime,
  authorize: async (actor, project) => actor === actorOpenId && project === projectId,
});

afterAll(async () => {
  await client.close();
});

describe('persistent Feishu card actions', () => {
  it('resumes gates created through a previous database connection and handles all four actions once', async () => {
    for (const [index, action] of actions.entries()) {
      const input = {
        action,
        projectId,
        targetType: 'job' as const,
        targetId: `job_target_${index}_${suffix}`,
        expectedVersion: 1,
        actorOpenId,
        eventId: `evt_${action}_${suffix}`,
      };
      const first = await service.handle(input);
      const replay = await service.handle(input);
      expect(replay).toEqual(first);
      expect(calls.get(action)).toBe(1);

      const gate = await repositories.humanGates.get(`gate_${action}_${suffix}`);
      expect(gate.status).toBe(action === 'manual' ? 'cancelled' : 'resolved');
      expect(gate.resolution).toBe(action);
      expect(gate.actorOpenId).toBe(actorOpenId);
    }

    const auditEntries = await client.db.select().from(auditLogs);
    const accepted = auditEntries.filter((entry) => entry.projectId === projectId);
    expect(accepted.filter((entry) => entry.outcome === 'accepted')).toHaveLength(4);
  });

  it('rejects unauthorized operators without resolving the gate', async () => {
    const gateId = `gate_unauthorized_${suffix}`;
    await repositories.humanGates.open({
      gateId,
      workflowId: `workflow_${suffix}`,
      projectId,
      node: 'human_approve_story',
      targetType: 'story',
      targetId: `story_${suffix}`,
      expectedTargetVersion: 1,
    });

    await expect(
      service.handle({
        action: 'approve',
        projectId,
        targetType: 'story',
        targetId: `story_${suffix}`,
        expectedVersion: 1,
        actorOpenId: 'ou_not_allowed',
        eventId: `evt_unauthorized_${suffix}`,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedFeishuActorError);
    await expect(repositories.humanGates.get(gateId)).resolves.toMatchObject({ status: 'waiting' });
  });

  it('rejects stale target versions and releases the idempotency reservation for a corrected event', async () => {
    const gateId = `gate_version_${suffix}`;
    const targetId = `render_version_${suffix}`;
    await repositories.humanGates.open({
      gateId,
      workflowId: `workflow_${suffix}`,
      projectId,
      node: 'human_approve_release',
      targetType: 'render',
      targetId,
      expectedTargetVersion: 2,
    });

    await expect(
      service.handle({
        action: 'approve',
        projectId,
        targetType: 'render',
        targetId,
        expectedVersion: 1,
        actorOpenId,
        eventId: `evt_version_stale_${suffix}`,
      }),
    ).rejects.toThrow(/does not match gate/);
    await expect(repositories.humanGates.get(gateId)).resolves.toMatchObject({ status: 'waiting' });

    await expect(
      service.handle({
        action: 'approve',
        projectId,
        targetType: 'render',
        targetId,
        expectedVersion: 2,
        actorOpenId,
        eventId: `evt_version_correct_${suffix}`,
      }),
    ).resolves.toMatchObject({ outcome: 'resumed' });
  });
});
