import type {
  AssetRecord,
  CreativeEntity,
  EpisodeSpec,
  FramePromptSpec,
  JobRecord,
  ProjectSpec,
  QCRecord,
  QcRunRecord,
  QcRunRequest,
  RenderManifest,
  RenderRecord,
  ShotSpec,
  FeishuCardActionName,
  HumanGate,
  LocalizationRequest,
  LocalizationRunRecord,
  LocalePackRecord,
  PublishRecord,
  PublishRequest,
  ExperimentRecord,
  ProviderCallback,
  ProviderRequest,
  ProviderRoute,
} from '@onecrew/contracts';
import {
  bigint,
  char,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const projectStatusEnum = pgEnum('project_status', [
  'draft',
  'running',
  'waiting_human',
  'done',
  'failed',
]);
export const shotStatusEnum = pgEnum('shot_status', [
  'planned',
  'generating',
  'qc',
  'approved',
  'failed',
]);
export const assetStatusEnum = pgEnum('asset_status', ['draft', 'approved', 'rejected', 'archived']);
export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'waiting_human',
  'succeeded',
  'failed',
  'cancelled',
]);
export const renderStatusEnum = pgEnum('render_status', [
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);
export const providerModeEnum = pgEnum('provider_mode', ['mock', 'sandbox', 'real']);
export const qcDecisionEnum = pgEnum('qc_decision', [
  'pass',
  'regenerate',
  'switch_model',
  'manual',
]);
export const qcRunStatusEnum = pgEnum('qc_run_status', [
  'queued',
  'running',
  'waiting_provider',
  'waiting_human',
  'succeeded',
  'failed',
  'cancelled',
]);
export const localizationRunStatusEnum = pgEnum('localization_run_status', [
  'queued',
  'running',
  'waiting_provider',
  'succeeded',
  'failed',
  'cancelled',
]);
export const publishStatusEnum = pgEnum('publish_status', ['building', 'succeeded', 'failed']);
export const humanGateStatusEnum = pgEnum('human_gate_status', [
  'waiting',
  'resolved',
  'cancelled',
]);
export const auditOutcomeEnum = pgEnum('audit_outcome', ['accepted', 'rejected', 'failed']);
export const episodeStatusEnum = pgEnum('episode_status', [
  'draft',
  'planning',
  'ready',
  'rendered',
  'archived',
]);
export const creativeEntityKindEnum = pgEnum('creative_entity_kind', ['character', 'scene', 'prop']);
export const creativeEntityStatusEnum = pgEnum('creative_entity_status', ['draft', 'ready', 'archived']);
export const frameTypeEnum = pgEnum('frame_type', ['first', 'last', 'key']);

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const projects = pgTable(
  'projects',
  {
    projectId: text('project_id').primaryKey(),
    spec: jsonb('spec').$type<ProjectSpec>().notNull(),
    status: projectStatusEnum('status').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [index('projects_status_idx').on(table.status)],
);

export const episodes = pgTable(
  'episodes',
  {
    episodeId: text('episode_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    episodeNumber: integer('episode_number').notNull(),
    spec: jsonb('spec').$type<EpisodeSpec>().notNull(),
    status: episodeStatusEnum('status').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('episodes_project_number_uidx').on(table.projectId, table.episodeNumber),
    index('episodes_project_status_idx').on(table.projectId, table.status),
  ],
);

export const creativeEntities = pgTable(
  'creative_entities',
  {
    entityId: text('entity_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    episodeId: text('episode_id').references(() => episodes.episodeId, { onDelete: 'set null' }),
    kind: creativeEntityKindEnum('kind').notNull(),
    name: text('name').notNull(),
    spec: jsonb('spec').$type<CreativeEntity>().notNull(),
    status: creativeEntityStatusEnum('status').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index('creative_entities_project_kind_idx').on(table.projectId, table.kind),
    index('creative_entities_episode_idx').on(table.episodeId),
  ],
);

export const shots = pgTable(
  'shots',
  {
    shotId: text('shot_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    spec: jsonb('spec').$type<ShotSpec>().notNull(),
    status: shotStatusEnum('status').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('shots_project_sequence_uidx').on(table.projectId, table.sequence),
    index('shots_project_status_idx').on(table.projectId, table.status),
  ],
);

export const framePrompts = pgTable(
  'frame_prompts',
  {
    framePromptId: text('frame_prompt_id').primaryKey(),
    shotId: text('shot_id')
      .notNull()
      .references(() => shots.shotId, { onDelete: 'cascade' }),
    frameType: frameTypeEnum('frame_type').notNull(),
    spec: jsonb('spec').$type<FramePromptSpec>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [index('frame_prompts_shot_type_idx').on(table.shotId, table.frameType)],
);

export const assets = pgTable(
  'assets',
  {
    assetId: text('asset_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    shotId: text('shot_id').references(() => shots.shotId, { onDelete: 'set null' }),
    parentAssetId: text('parent_asset_id'),
    type: text('type').notNull(),
    assetVersion: integer('asset_version').notNull(),
    record: jsonb('record').$type<AssetRecord>().notNull(),
    status: assetStatusEnum('status').notNull(),
    rowVersion: integer('row_version').notNull().default(1),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('assets_version_uidx').on(table.assetId, table.assetVersion),
    index('assets_project_type_idx').on(table.projectId, table.type),
    index('assets_parent_idx').on(table.parentAssetId),
    index('assets_hash_idx').on(table.contentHash),
  ],
);

export const jobs = pgTable(
  'jobs',
  {
    jobId: text('job_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    shotId: text('shot_id').references(() => shots.shotId, { onDelete: 'set null' }),
    capability: text('capability').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    mode: providerModeEnum('mode').notNull(),
    status: jobStatusEnum('status').notNull(),
    attempt: integer('attempt').notNull(),
    estimatedCostCny: numeric('estimated_cost_cny', { precision: 14, scale: 4 }),
    actualCostCny: numeric('actual_cost_cny', { precision: 14, scale: 4 }),
    inputHash: char('input_hash', { length: 64 }).notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    record: jsonb('record').$type<JobRecord>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('jobs_project_idempotency_uidx').on(table.projectId, table.idempotencyKey),
    index('jobs_project_status_idx').on(table.projectId, table.status),
    index('jobs_shot_idx').on(table.shotId),
  ],
);

export const qcRecords = pgTable(
  'qc_records',
  {
    qcId: text('qc_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    shotId: text('shot_id').references(() => shots.shotId, { onDelete: 'set null' }),
    decision: qcDecisionEnum('decision').notNull(),
    record: jsonb('record').$type<QCRecord>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('qc_project_created_idx').on(table.projectId, table.createdAt),
    index('qc_shot_idx').on(table.shotId),
  ],
);

export const qcRuns = pgTable(
  'qc_runs',
  {
    qcRunId: text('qc_run_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    shotId: text('shot_id').references(() => shots.shotId, { onDelete: 'set null' }),
    sourceJobId: text('source_job_id').references(() => jobs.jobId, { onDelete: 'set null' }),
    status: qcRunStatusEnum('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    request: jsonb('request').$type<QcRunRequest>().notNull(),
    record: jsonb('record').$type<QcRunRecord>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('qc_runs_project_idempotency_uidx').on(table.projectId, table.idempotencyKey),
    index('qc_runs_project_status_idx').on(table.projectId, table.status),
    index('qc_runs_shot_idx').on(table.shotId),
    index('qc_runs_source_job_idx').on(table.sourceJobId),
  ],
);

export const renders = pgTable(
  'renders',
  {
    renderId: text('render_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    compositionId: text('composition_id').notNull(),
    locale: text('locale').notNull(),
    aspectRatio: text('aspect_ratio').notNull(),
    manifest: jsonb('manifest').$type<RenderManifest>().notNull(),
    renderMode: text('render_mode').notNull().default('preview'),
    record: jsonb('record').$type<RenderRecord>().notNull(),
    manifestHash: char('manifest_hash', { length: 64 }).notNull(),
    designPackVersion: text('design_pack_version').notNull(),
    codeVersion: text('code_version').notNull(),
    status: renderStatusEnum('status').notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    index('renders_project_status_idx').on(table.projectId, table.status),
    index('renders_manifest_hash_idx').on(table.manifestHash, table.renderMode, table.codeVersion),
  ],
);

export const localizationRuns = pgTable(
  'localization_runs',
  {
    localizationRunId: text('localization_run_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    status: localizationRunStatusEnum('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    request: jsonb('request').$type<LocalizationRequest>().notNull(),
    record: jsonb('record').$type<LocalizationRunRecord>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('localization_runs_project_idempotency_uidx').on(table.projectId, table.idempotencyKey),
    index('localization_runs_project_status_idx').on(table.projectId, table.status),
  ],
);

export const localePacks = pgTable(
  'locale_packs',
  {
    localePackId: text('locale_pack_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    packVersion: integer('pack_version').notNull(),
    contentHash: char('content_hash', { length: 64 }).notNull(),
    record: jsonb('record').$type<LocalePackRecord>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('locale_packs_project_locale_version_uidx').on(table.projectId, table.locale, table.packVersion),
    index('locale_packs_project_locale_idx').on(table.projectId, table.locale),
    index('locale_packs_hash_idx').on(table.contentHash),
  ],
);

export const publishes = pgTable(
  'publishes',
  {
    publishId: text('publish_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    status: publishStatusEnum('status').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    request: jsonb('request').$type<PublishRequest>().notNull(),
    record: jsonb('record').$type<PublishRecord>().notNull(),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('publishes_project_idempotency_uidx').on(table.projectId, table.idempotencyKey),
    index('publishes_project_status_idx').on(table.projectId, table.status),
  ],
);

export const experiments = pgTable(
  'experiments',
  {
    experimentId: text('experiment_id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    creativeId: text('creative_id').notNull(),
    language: text('language').notNull(),
    platform: text('platform').notNull(),
    record: jsonb('record').$type<ExperimentRecord>().notNull(),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('experiments_creative_platform_uidx').on(table.creativeId, table.platform),
    index('experiments_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: char('request_hash', { length: 64 }).notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    response: jsonb('response').$type<unknown>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    sequence: bigint('sequence', { mode: 'number' }).generatedAlwaysAsIdentity(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.key], name: 'idempotency_keys_pk' }),
    uniqueIndex('idempotency_sequence_uidx').on(table.sequence),
    index('idempotency_expiry_idx').on(table.expiresAt),
  ],
);

export const humanGates = pgTable(
  'human_gates',
  {
    gateId: text('gate_id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.projectId, { onDelete: 'cascade' }),
    node: text('node').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    expectedTargetVersion: integer('expected_target_version').notNull(),
    status: humanGateStatusEnum('status').notNull(),
    resolution: text('resolution').$type<FeishuCardActionName>(),
    actorOpenId: text('actor_open_id'),
    eventId: text('event_id'),
    state: jsonb('state').$type<HumanGate>().notNull(),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('human_gates_event_uidx').on(table.eventId),
    index('human_gates_workflow_status_idx').on(table.workflowId, table.status),
    index('human_gates_target_idx').on(table.targetType, table.targetId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    auditId: text('audit_id').primaryKey(),
    source: text('source').notNull(),
    eventId: text('event_id').notNull(),
    projectId: text('project_id'),
    actorOpenId: text('actor_open_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    expectedVersion: integer('expected_version'),
    outcome: auditOutcomeEnum('outcome').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('audit_source_event_action_uidx').on(table.source, table.eventId, table.action),
    index('audit_project_created_idx').on(table.projectId, table.createdAt),
  ],
);

export const feishuRecordLinks = pgTable(
  'feishu_record_links',
  {
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    appToken: text('app_token').notNull(),
    tableId: text('table_id').notNull(),
    recordId: text('record_id').notNull(),
    localVersion: integer('local_version').notNull(),
    remoteRevision: integer('remote_revision'),
    fieldHash: char('field_hash', { length: 64 }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.entityType, table.entityId], name: 'feishu_record_links_pk' }),
    uniqueIndex('feishu_record_uidx').on(table.appToken, table.tableId, table.recordId),
  ],
);

export const providerJobRuns = pgTable(
  'provider_job_runs',
  {
    jobId: text('job_id')
      .primaryKey()
      .references(() => jobs.jobId, { onDelete: 'cascade' }),
    route: text('route').$type<ProviderRoute>().notNull(),
    request: jsonb('request').$type<ProviderRequest>().notNull(),
    queueJobId: text('queue_job_id'),
    externalJobId: text('external_job_id'),
    callbackUrl: text('callback_url'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('provider_job_runs_external_uidx').on(table.externalJobId),
    index('provider_job_runs_queue_idx').on(table.queueJobId),
  ],
);

export const providerCache = pgTable(
  'provider_cache',
  {
    inputHash: char('input_hash', { length: 64 }).notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    mode: providerModeEnum('mode').notNull(),
    output: jsonb('output').$type<unknown>().notNull(),
    actualCostCny: numeric('actual_cost_cny', { precision: 14, scale: 4 }).notNull(),
    sourceJobId: text('source_job_id')
      .notNull()
      .references(() => jobs.jobId, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.inputHash, table.provider, table.model, table.mode],
      name: 'provider_cache_pk',
    }),
    index('provider_cache_expiry_idx').on(table.expiresAt),
  ],
);

export const providerCallbacks = pgTable(
  'provider_callbacks',
  {
    eventId: text('event_id').primaryKey(),
    provider: text('provider').notNull(),
    externalJobId: text('external_job_id').notNull(),
    bodyHash: char('body_hash', { length: 64 }).notNull(),
    callback: jsonb('callback').$type<ProviderCallback>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('provider_callbacks_external_idx').on(table.provider, table.externalJobId)],
);
