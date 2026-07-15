import { createHash } from 'node:crypto';

import {
  assetStatusSchema,
  jobStatusSchema,
  localizationRunStatusSchema,
  projectStatusSchema,
  qcRunStatusSchema,
  renderStatusSchema,
  shotStatusSchema,
  type AssetStatus,
  type JobStatus,
  type LocalizationRunStatus,
  type ProjectStatus,
  type QcRunStatus,
  type RenderStatus,
  type ShotStatus,
} from '@onecrew/contracts';

export type StateMachineKind = 'project' | 'shot' | 'asset' | 'job' | 'render' | 'qc_run' | 'localization_run';

export interface StatusByKind {
  project: ProjectStatus;
  shot: ShotStatus;
  asset: AssetStatus;
  job: JobStatus;
  render: RenderStatus;
  qc_run: QcRunStatus;
  localization_run: LocalizationRunStatus;
}

const schemasByKind = {
  project: projectStatusSchema,
  shot: shotStatusSchema,
  asset: assetStatusSchema,
  job: jobStatusSchema,
  render: renderStatusSchema,
  qc_run: qcRunStatusSchema,
  localization_run: localizationRunStatusSchema,
} as const;

const transitionTable: {
  [Kind in StateMachineKind]: Record<StatusByKind[Kind], readonly StatusByKind[Kind][]>;
} = {
  project: {
    draft: ['running', 'failed'],
    running: ['waiting_human', 'done', 'failed'],
    waiting_human: ['running', 'failed'],
    done: [],
    failed: ['running'],
  },
  shot: {
    planned: ['generating', 'failed'],
    generating: ['qc', 'failed'],
    qc: ['approved', 'generating', 'failed'],
    approved: [],
    failed: ['generating'],
  },
  asset: {
    draft: ['approved', 'rejected', 'archived'],
    approved: ['archived'],
    rejected: ['draft', 'archived'],
    archived: [],
  },
  job: {
    queued: ['running', 'cancelled'],
    running: ['waiting_human', 'succeeded', 'failed', 'cancelled'],
    waiting_human: ['queued', 'cancelled'],
    succeeded: [],
    failed: ['queued', 'cancelled'],
    cancelled: [],
  },
  render: {
    queued: ['running', 'cancelled'],
    running: ['succeeded', 'failed', 'cancelled'],
    succeeded: [],
    failed: ['queued', 'cancelled'],
    cancelled: [],
  },
  qc_run: {
    queued: ['running', 'cancelled'],
    running: ['waiting_provider', 'waiting_human', 'succeeded', 'failed', 'cancelled'],
    waiting_provider: ['running', 'waiting_human', 'succeeded', 'failed', 'cancelled'],
    waiting_human: ['queued', 'succeeded', 'cancelled'],
    succeeded: [],
    failed: ['queued', 'cancelled'],
    cancelled: [],
  },
  localization_run: {
    queued: ['running', 'cancelled'],
    running: ['waiting_provider', 'succeeded', 'failed', 'cancelled'],
    waiting_provider: ['succeeded', 'failed', 'cancelled'],
    succeeded: [],
    failed: ['queued', 'cancelled'],
    cancelled: [],
  },
};

export class InvalidStateTransitionError extends Error {
  constructor(
    readonly kind: StateMachineKind,
    readonly current: string,
    readonly next: string,
  ) {
    super(`Invalid ${kind} state transition: ${current} -> ${next}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class VersionConflictError extends Error {
  constructor(
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(`Version conflict: expected ${expectedVersion}, actual ${actualVersion}`);
    this.name = 'VersionConflictError';
  }
}

export function canTransition<Kind extends StateMachineKind>(
  kind: Kind,
  current: StatusByKind[Kind],
  next: StatusByKind[Kind],
): boolean {
  const parsedCurrent = schemasByKind[kind].parse(current) as StatusByKind[Kind];
  const parsedNext = schemasByKind[kind].parse(next) as StatusByKind[Kind];
  const allowed = transitionTable[kind][parsedCurrent] as readonly StatusByKind[Kind][];
  return allowed.includes(parsedNext);
}

export function assertTransition<Kind extends StateMachineKind>(
  kind: Kind,
  current: StatusByKind[Kind],
  next: StatusByKind[Kind],
): void {
  if (!canTransition(kind, current, next)) {
    throw new InvalidStateTransitionError(kind, current, next);
  }
}

export function assertExpectedVersion(expectedVersion: number, actualVersion: number): void {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new RangeError('expectedVersion must be a positive integer');
  }
  if (expectedVersion !== actualVersion) {
    throw new VersionConflictError(expectedVersion, actualVersion);
  }
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | { [key: string]: CanonicalJson };

function normalizeJson(value: unknown, path = '$'): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizeJson(entry, `${path}[${index}]`));
  }
  if (typeof value === 'object' && value !== null) {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} is not a plain JSON object`);
    }

    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry, `${path}.${key}`)]),
    );
  }

  throw new TypeError(`${path} is not JSON serializable`);
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value));
}

export function createInputHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function createIdempotencyKey(scope: string, value: unknown): string {
  if (!scope.trim()) {
    throw new TypeError('idempotency scope must not be empty');
  }
  return `${scope}:${createInputHash(value)}`;
}

export { transitionTable };
