import { createCipheriv, createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  calculateFeishuSignature,
  normalizeFeishuCardAction,
  parseFeishuWebhook,
} from './webhook.js';

function encryptPayload(plaintext: string, encryptKey: string): string {
  const key = createHash('sha256').update(encryptKey, 'utf8').digest();
  const iv = Buffer.from('0123456789abcdef');
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64');
}

describe('Feishu webhook security', () => {
  const encryptKey = 'onecrew-test-encrypt-key';
  const verificationToken = 'onecrew-test-verification-token';
  const timestamp = '1784102400';
  const nowMs = Number(timestamp) * 1_000;

  it('validates the official timestamp + nonce + Encrypt Key + raw body signature', () => {
    const rawBody = JSON.stringify({
      type: 'url_verification',
      challenge: 'challenge_demo',
      token: verificationToken,
    });
    const nonce = 'nonce_demo';
    const signature = calculateFeishuSignature(timestamp, nonce, encryptKey, rawBody);

    expect(
      parseFeishuWebhook(
        rawBody,
        { timestamp, nonce, signature },
        { encryptKey, verificationToken, nowMs },
      ),
    ).toMatchObject({ challenge: 'challenge_demo' });
  });

  it('rejects invalid signatures and stale replay timestamps', () => {
    const rawBody = JSON.stringify({ token: verificationToken });
    expect(() =>
      parseFeishuWebhook(
        rawBody,
        { timestamp, nonce: 'nonce', signature: '0'.repeat(64) },
        { encryptKey, verificationToken, nowMs },
      ),
    ).toThrow(/signature/);

    const signature = calculateFeishuSignature(timestamp, 'nonce', encryptKey, rawBody);
    expect(() =>
      parseFeishuWebhook(
        rawBody,
        { timestamp, nonce: 'nonce', signature },
        { encryptKey, verificationToken, nowMs: nowMs + 301_000 },
      ),
    ).toThrow(/replay window/);
  });

  it('decrypts AES-256-CBC payloads and checks the token after decryption', () => {
    const plaintext = JSON.stringify({
      type: 'url_verification',
      challenge: 'encrypted_challenge',
      token: verificationToken,
    });
    const rawBody = JSON.stringify({ encrypt: encryptPayload(plaintext, encryptKey) });
    const nonce = 'encrypted_nonce';
    const signature = calculateFeishuSignature(timestamp, nonce, encryptKey, rawBody);

    expect(
      parseFeishuWebhook(
        rawBody,
        { timestamp, nonce, signature },
        { encryptKey, verificationToken, nowMs },
      ),
    ).toMatchObject({ challenge: 'encrypted_challenge' });
  });

  it('accepts the encrypted URL verification envelope without signature headers', () => {
    const plaintext = JSON.stringify({
      challenge: 'unsigned_encrypted_challenge',
      token: verificationToken,
    });
    const rawBody = JSON.stringify({ encrypt: encryptPayload(plaintext, encryptKey) });

    expect(
      parseFeishuWebhook(rawBody, {}, { encryptKey, verificationToken, nowMs }),
    ).toMatchObject({ challenge: 'unsigned_encrypted_challenge' });
  });

  it('still rejects unsigned encrypted non-verification callbacks', () => {
    const plaintext = JSON.stringify({
      header: { token: verificationToken },
      event: { action: { value: { action: 'approve' } } },
    });
    const rawBody = JSON.stringify({ encrypt: encryptPayload(plaintext, encryptKey) });

    expect(() =>
      parseFeishuWebhook(rawBody, {}, { encryptKey, verificationToken, nowMs }),
    ).toThrow(/signature headers/);
  });
});

describe('card callback normalization', () => {
  it('normalizes Feishu v2 callback data into the locked action contract', () => {
    expect(
      normalizeFeishuCardAction({
        header: { event_id: 'evt_card_001' },
        event: {
          operator: { operator_id: { open_id: 'ou_actor_001' } },
          action: {
            value: {
              action: 'switch_provider',
              project_id: 'prj_demo',
              target_type: 'render',
              target_id: 'render_demo',
              expected_version: 3,
            },
          },
        },
      }),
    ).toEqual({
      action: 'switch_provider',
      projectId: 'prj_demo',
      targetType: 'render',
      targetId: 'render_demo',
      expectedVersion: 3,
      actorOpenId: 'ou_actor_001',
      eventId: 'evt_card_001',
    });
  });
});
