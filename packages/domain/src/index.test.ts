import { describe, expect, it } from 'vitest';

import {
  assertExpectedVersion,
  assertTransition,
  canTransition,
  canonicalJson,
  createIdempotencyKey,
  createInputHash,
  InvalidStateTransitionError,
  VersionConflictError,
} from './index.js';

describe('domain state machines', () => {
  it('allows the human pause/resume job path', () => {
    expect(canTransition('job', 'running', 'waiting_human')).toBe(true);
    expect(canTransition('job', 'waiting_human', 'queued')).toBe(true);
  });

  it('rejects transitions out of terminal job states', () => {
    expect(() => assertTransition('job', 'succeeded', 'running')).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('allows failed work to be retried without mutating terminal success', () => {
    expect(canTransition('shot', 'failed', 'generating')).toBe(true);
    expect(canTransition('render', 'failed', 'queued')).toBe(true);
    expect(canTransition('render', 'succeeded', 'queued')).toBe(false);
    expect(canTransition('qc_run', 'waiting_provider', 'running')).toBe(true);
    expect(canTransition('qc_run', 'succeeded', 'queued')).toBe(false);
    expect(canTransition('localization_run', 'waiting_provider', 'succeeded')).toBe(true);
    expect(canTransition('localization_run', 'succeeded', 'queued')).toBe(false);
  });

  it('enforces optimistic versions', () => {
    expect(() => assertExpectedVersion(2, 3)).toThrow(VersionConflictError);
    expect(() => assertExpectedVersion(3, 3)).not.toThrow();
  });
});

describe('canonical hashing and idempotency', () => {
  it('is stable across object key order', () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(createInputHash({ b: 2, a: 1 })).toBe(createInputHash({ a: 1, b: 2 }));
  });

  it('scopes idempotency keys', () => {
    expect(createIdempotencyKey('project:create', { name: 'demo' })).toMatch(
      /^project:create:[a-f0-9]{64}$/,
    );
  });

  it('rejects non-JSON values instead of hashing ambiguous data', () => {
    expect(() => createInputHash({ createdAt: new Date() })).toThrow(/plain JSON object/);
  });
});
