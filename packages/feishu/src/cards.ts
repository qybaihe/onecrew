import type { FeishuCardActionName } from '@onecrew/contracts';

export interface ApprovalCardInput {
  title: string;
  summary: string;
  projectId: string;
  targetType: 'story' | 'design' | 'shot' | 'asset' | 'job' | 'render' | 'release';
  targetId: string;
  expectedVersion: number;
}

const buttons: ReadonlyArray<{
  action: FeishuCardActionName;
  label: string;
  type?: 'primary_filled' | 'danger';
}> = [
  { action: 'approve', label: '通过', type: 'primary_filled' },
  { action: 'regenerate', label: '重生成' },
  { action: 'switch_provider', label: '切换模型' },
  { action: 'manual', label: '转人工处理', type: 'danger' },
];

export function buildApprovalCard(input: ApprovalCardInput): Record<string, unknown> {
  const actions = buttons.map((button) => ({
    tag: 'button',
    text: { tag: 'plain_text', content: button.label },
    type: button.type ?? 'default',
    width: 'fill',
    behaviors: [
      {
        type: 'callback',
        value: {
          action: button.action,
          project_id: input.projectId,
          target_type: input.targetType,
          target_id: input.targetId,
          expected_version: input.expectedVersion,
        },
      },
    ],
  }));

  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { title: { tag: 'plain_text', content: input.title }, template: 'blue' },
    body: {
      direction: 'vertical',
      vertical_spacing: 'medium',
      elements: [
        { tag: 'markdown', content: input.summary },
        {
          tag: 'column_set',
          flex_mode: 'flow',
          horizontal_spacing: 'small',
          columns: actions.map((action) => ({
            tag: 'column',
            width: 'weighted',
            weight: 1,
            elements: [action],
          })),
        },
      ],
    },
  };
}
