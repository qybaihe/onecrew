import { feishuCardActionSchema, type FeishuCardAction, type HumanGate } from '@onecrew/contracts';
import type {
  AuditRepository,
  HumanGateRepository,
  IdempotencyRepository,
} from '@onecrew/db';
import { createInputHash } from '@onecrew/domain';

export class UnauthorizedFeishuActorError extends Error {
  constructor(readonly actorOpenId: string) {
    super(`Feishu actor is not authorized for this project: ${actorOpenId}`);
    this.name = 'UnauthorizedFeishuActorError';
  }
}

export class CardActionInProgressError extends Error {
  constructor(readonly eventId: string) {
    super(`Feishu card action is already in progress: ${eventId}`);
    this.name = 'CardActionInProgressError';
  }
}

export interface CardActionRuntime {
  approve(action: FeishuCardAction, gate: HumanGate): Promise<Record<string, unknown>>;
  regenerate(action: FeishuCardAction, gate: HumanGate): Promise<Record<string, unknown>>;
  switchProvider(action: FeishuCardAction, gate: HumanGate): Promise<Record<string, unknown>>;
  manual(action: FeishuCardAction, gate: HumanGate): Promise<Record<string, unknown>>;
}

export interface CardActionServiceOptions {
  idempotency: IdempotencyRepository;
  audit: AuditRepository;
  humanGates: HumanGateRepository;
  runtime: CardActionRuntime;
  authorize(actorOpenId: string, projectId: string): Promise<boolean>;
}

export class CardActionService {
  constructor(private readonly options: CardActionServiceOptions) {}

  async handle(input: FeishuCardAction): Promise<Record<string, unknown>> {
    const action = feishuCardActionSchema.parse(input);
    const requestHash = createInputHash(action);
    const auditId = `audit_${createInputHash({ eventId: action.eventId, action: action.action }).slice(0, 32)}`;

    if (!(await this.options.authorize(action.actorOpenId, action.projectId))) {
      await this.options.audit.record({
        auditId,
        source: 'feishu_card',
        eventId: action.eventId,
        projectId: action.projectId,
        actorOpenId: action.actorOpenId,
        action: action.action,
        targetType: action.targetType,
        targetId: action.targetId,
        expectedVersion: action.expectedVersion,
        outcome: 'rejected',
        details: { reason: 'unauthorized_actor' },
      });
      throw new UnauthorizedFeishuActorError(action.actorOpenId);
    }

    const reservation = await this.options.idempotency.reserve(
      'feishu:card-action',
      action.eventId,
      requestHash,
    );
    if (reservation.state === 'replayed') return reservation.response as Record<string, unknown>;
    if (reservation.state === 'in_progress') throw new CardActionInProgressError(action.eventId);

    try {
      const gate = await this.options.humanGates.findWaiting(
        action.projectId,
        action.targetType,
        action.targetId,
      );
      const response = await this.runAction(action, gate);
      const resolvedGate = await this.options.humanGates.resolve(gate.gateId, gate.version, action);
      await this.options.idempotency.complete('feishu:card-action', action.eventId, requestHash, {
        response,
        resourceType: action.targetType,
        resourceId: action.targetId,
      });
      await this.options.audit.record({
        auditId,
        source: 'feishu_card',
        eventId: action.eventId,
        projectId: action.projectId,
        actorOpenId: action.actorOpenId,
        action: action.action,
        targetType: action.targetType,
        targetId: action.targetId,
        expectedVersion: action.expectedVersion,
        outcome: 'accepted',
        details: { gateId: gate.gateId, gateVersion: resolvedGate.version },
      });
      return response;
    } catch (error) {
      await this.options.idempotency.release('feishu:card-action', action.eventId, requestHash);
      await this.options.audit.record({
        auditId,
        source: 'feishu_card',
        eventId: action.eventId,
        projectId: action.projectId,
        actorOpenId: action.actorOpenId,
        action: action.action,
        targetType: action.targetType,
        targetId: action.targetId,
        expectedVersion: action.expectedVersion,
        outcome: 'failed',
        details: { errorType: error instanceof Error ? error.name : 'UnknownError' },
      });
      throw error;
    }
  }

  private runAction(action: FeishuCardAction, gate: HumanGate): Promise<Record<string, unknown>> {
    switch (action.action) {
      case 'approve':
        return this.options.runtime.approve(action, gate);
      case 'regenerate':
        return this.options.runtime.regenerate(action, gate);
      case 'switch_provider':
        return this.options.runtime.switchProvider(action, gate);
      case 'manual':
        return this.options.runtime.manual(action, gate);
    }
  }
}
