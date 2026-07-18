import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto';

import { feishuCardActionSchema, type FeishuCardAction } from '@onecrew/contracts';

export interface FeishuWebhookHeaders {
  timestamp?: string;
  nonce?: string;
  signature?: string;
}

export interface FeishuWebhookSecurity {
  verificationToken?: string;
  encryptKey?: string;
  maxClockSkewSec?: number;
  nowMs?: number;
}

export class FeishuWebhookSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeishuWebhookSecurityError';
  }
}

export function calculateFeishuSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  rawBody: string,
): string {
  return createHash('sha256').update(timestamp + nonce + encryptKey + rawBody, 'utf8').digest('hex');
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function decryptFeishuPayload(encrypted: string, encryptKey: string): string {
  const payload = Buffer.from(encrypted, 'base64');
  if (payload.length <= 16) throw new FeishuWebhookSecurityError('Encrypted Feishu payload is too short');
  const key = createHash('sha256').update(encryptKey, 'utf8').digest();
  const iv = payload.subarray(0, 16);
  const ciphertext = payload.subarray(16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function readToken(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.token === 'string') return payload.token;
  const header = payload.header;
  if (typeof header === 'object' && header !== null && 'token' in header && typeof header.token === 'string') {
    return header.token;
  }
  return undefined;
}

export function parseFeishuWebhook(
  rawBody: string,
  headers: FeishuWebhookHeaders,
  security: FeishuWebhookSecurity,
): Record<string, unknown> {
  let payload = JSON.parse(rawBody) as Record<string, unknown>;
  if (typeof payload.encrypt === 'string') {
    if (!security.encryptKey) {
      throw new FeishuWebhookSecurityError('Encrypted Feishu payload received without an Encrypt Key');
    }
    payload = JSON.parse(decryptFeishuPayload(payload.encrypt, security.encryptKey)) as Record<
      string,
      unknown
    >;
  }

  const isUrlVerification =
    typeof payload.challenge === 'string' &&
    (payload.type === 'url_verification' || typeof payload.token === 'string');
  const hasNoSignatureHeaders = !headers.timestamp && !headers.nonce && !headers.signature;

  if (security.encryptKey) {
    if (!(isUrlVerification && hasNoSignatureHeaders) && (!headers.timestamp || !headers.nonce || !headers.signature)) {
      throw new FeishuWebhookSecurityError('Missing Feishu signature headers');
    }
    if (!(isUrlVerification && hasNoSignatureHeaders)) {
      const timestampMs = Number(headers.timestamp) * 1_000;
      const nowMs = security.nowMs ?? Date.now();
      const maxSkewMs = (security.maxClockSkewSec ?? 300) * 1_000;
      if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > maxSkewMs) {
        throw new FeishuWebhookSecurityError('Feishu request timestamp is outside the replay window');
      }
      const expected = calculateFeishuSignature(
        headers.timestamp!,
        headers.nonce!,
        security.encryptKey,
        rawBody,
      );
      if (!secureEqual(expected, headers.signature!)) {
        throw new FeishuWebhookSecurityError('Invalid Feishu request signature');
      }
    }
  }

  if (security.verificationToken) {
    const receivedToken = readToken(payload);
    if (!receivedToken || !secureEqual(receivedToken, security.verificationToken)) {
      throw new FeishuWebhookSecurityError('Invalid Feishu verification token');
    }
  }
  return payload;
}

function getObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function normalizeFeishuCardAction(payload: Record<string, unknown>): FeishuCardAction {
  const direct = feishuCardActionSchema.safeParse(payload);
  if (direct.success) return direct.data;

  const event = getObject(payload.event);
  const header = getObject(payload.header);
  const actionContainer = getObject(event?.action ?? payload.action);
  const value = getObject(actionContainer?.value);
  const operator = getObject(event?.operator);
  const operatorId = getObject(operator?.operator_id);
  const actorOpenId =
    (typeof payload.open_id === 'string' ? payload.open_id : undefined) ??
    (typeof operator?.open_id === 'string' ? operator.open_id : undefined) ??
    (typeof operatorId?.open_id === 'string' ? operatorId.open_id : undefined);
  const eventId =
    (typeof header?.event_id === 'string' ? header.event_id : undefined) ??
    (typeof payload.event_id === 'string' ? payload.event_id : undefined);

  return feishuCardActionSchema.parse({
    action: value?.action,
    projectId: value?.project_id,
    targetType: value?.target_type,
    targetId: value?.target_id,
    expectedVersion: value?.expected_version,
    actorOpenId,
    eventId,
  });
}
