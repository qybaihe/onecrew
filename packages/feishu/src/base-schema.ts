export type OneCrewFeishuTableName = '项目' | '分镜' | '资产' | '生成任务' | '质检' | '出海实验';

export interface FeishuFieldDefinition {
  fieldName: string;
  type: 1 | 2 | 3 | 4 | 7 | 11 | 15 | 17 | 18;
  uiType?: 'Text' | 'Number' | 'Progress' | 'Rating' | 'Url';
  options?: readonly string[];
  relationTable?: OneCrewFeishuTableName;
  multiple?: boolean;
  description?: string;
}

export interface FeishuTableDefinition {
  name: OneCrewFeishuTableName;
  fields: readonly FeishuFieldDefinition[];
}

const text = (fieldName: string, description?: string): FeishuFieldDefinition => ({
  fieldName,
  type: 1,
  uiType: 'Text',
  ...(description ? { description } : {}),
});
const number = (fieldName: string): FeishuFieldDefinition => ({ fieldName, type: 2, uiType: 'Number' });
const select = (fieldName: string, options: readonly string[]): FeishuFieldDefinition => ({
  fieldName,
  type: 3,
  options,
});
const multiSelect = (fieldName: string, options: readonly string[]): FeishuFieldDefinition => ({
  fieldName,
  type: 4,
  options,
});
const relation = (
  fieldName: string,
  relationTable: OneCrewFeishuTableName,
  multiple = false,
): FeishuFieldDefinition => ({ fieldName, type: 18, relationTable, multiple });
const url = (fieldName: string): FeishuFieldDefinition => ({ fieldName, type: 15, uiType: 'Url' });
const rating = (fieldName: string): FeishuFieldDefinition => ({ fieldName, type: 2, uiType: 'Rating' });

export const oneCrewFeishuTables: readonly FeishuTableDefinition[] = [
  {
    name: '项目',
    fields: [
      text('project_id', 'OneCrew 系统唯一项目 ID'),
      text('IP'),
      text('name_en'),
      multiSelect('market', ['CN', 'Global']),
      number('budget'),
      number('cost_actual'),
      { fieldName: 'owner', type: 11, multiple: false },
      select('stage', ['剧本', '设计', '资产', '生成', '质检', '渲染', '发布']),
      select('status', ['draft', 'running', 'waiting_human', 'done', 'failed']),
      text('design_system_id'),
      text('design_version'),
      select('render_template', [
        'EpisodeMaster',
        'EpisodeLocalized',
        'Trailer30',
        'Teaser15Vertical',
        'Bumper6',
        'MotionPoster',
      ]),
      select('zh_status', ['draft', 'running', 'waiting_human', 'done', 'failed']),
      select('en_status', ['draft', 'running', 'waiting_human', 'done', 'failed']),
      multiSelect('aspect_ratio', ['16:9', '9:16', '1:1']),
    ],
  },
  {
    name: '分镜',
    fields: [
      text('shot_id'),
      relation('project_id', '项目'),
      number('sequence'),
      multiSelect('characters', []),
      text('scene'),
      text('action'),
      text('dialogue_zh'),
      number('duration_sec'),
      select('importance', ['normal', 'hero']),
      { fieldName: 'closeup_dialogue', type: 7 },
      select('status', ['planned', 'generating', 'qc', 'approved', 'failed']),
      url('current_video'),
      url('current_render'),
    ],
  },
  {
    name: '资产',
    fields: [
      text('asset_id'),
      relation('project_id', '项目'),
      relation('shot_id', '分镜'),
      select('type', [
        '角色',
        '场景',
        '道具',
        '图片',
        '视频',
        '音频',
        '字体',
        'Logo',
        'Design Pack',
        '模板',
        '海报',
      ]),
      number('version'),
      text('parent_asset_id'),
      url('uri'),
      { fieldName: 'thumbnail', type: 17 },
      text('provider'),
      text('model'),
      text('seed'),
      text('license'),
      select('status', ['draft', 'approved', 'rejected', 'archived']),
    ],
  },
  {
    name: '生成任务',
    fields: [
      text('job_id'),
      relation('project_id', '项目'),
      relation('shot_id', '分镜'),
      select('capability', [
        'plan',
        'design_compile',
        'image',
        'video',
        'tts',
        'lipsync',
        'qc',
        'remotion_preview',
        'remotion_final',
        'publish',
      ]),
      text('provider'),
      text('model'),
      select('mode', ['mock', 'sandbox', 'real']),
      select('status', ['queued', 'running', 'waiting_human', 'succeeded', 'failed', 'cancelled']),
      number('retries'),
      number('latency_ms'),
      number('cost_cny'),
      text('error_code'),
      text('error'),
      url('output'),
    ],
  },
  {
    name: '质检',
    fields: [
      text('qc_id'),
      text('qc_run_id'),
      relation('project_id', '项目'),
      relation('shot_id', '分镜'),
      rating('character'),
      rating('clothing'),
      rating('background'),
      rating('action'),
      rating('flicker'),
      rating('lipsync'),
      rating('subtitle'),
      rating('brand'),
      rating('safe_area'),
      rating('audio'),
      rating('compliance'),
      select('decision', ['pass', 'regenerate', 'switch_model', 'manual']),
      text('reason'),
      text('technical_failure_codes'),
      text('semantic_provider_job_id'),
      text('retry_patch'),
    ],
  },
  {
    name: '出海实验',
    fields: [
      text('experiment_id'),
      relation('project_id', '项目'),
      text('creative_id'),
      text('episode'),
      select('language', ['zh-CN', 'en-US']),
      select('platform', ['抖音', 'TikTok', 'YouTube', '其他']),
      text('hook'),
      url('cover'),
      number('spend'),
      number('retention_3s'),
      number('retention_15s'),
      number('ctr'),
      number('conversion'),
      number('roas'),
      text('recommendation'),
    ],
  },
] as const;

export interface FeishuApiField {
  field_name: string;
  type: number;
  ui_type?: string;
  property?: Record<string, unknown>;
  description?: string;
}

export function compileFeishuFields(
  definition: FeishuTableDefinition,
  tableIds: Partial<Record<OneCrewFeishuTableName, string>>,
): FeishuApiField[] {
  return definition.fields.map((field) => {
    const property: Record<string, unknown> = {};
    if (field.options && field.options.length > 0) {
      property.options = field.options.map((name) => ({ name }));
    }
    if (field.type === 11) property.multiple = field.multiple ?? false;
    if (field.relationTable) {
      const tableId = tableIds[field.relationTable];
      if (!tableId) throw new Error(`Missing table ID for relation target ${field.relationTable}`);
      property.table_id = tableId;
      property.multiple = field.multiple ?? false;
    }

    return {
      field_name: field.fieldName,
      type: field.type,
      ...(field.uiType ? { ui_type: field.uiType } : {}),
      ...(Object.keys(property).length > 0 ? { property } : {}),
      ...(field.description ? { description: field.description } : {}),
    };
  });
}
