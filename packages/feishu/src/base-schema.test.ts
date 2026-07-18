import { describe, expect, it } from 'vitest';

import { oneCrewFeishuTables } from './base-schema.js';
import { buildApprovalCard } from './cards.js';

describe('locked Feishu control plane schema', () => {
  it('contains exactly the six blueprint tables', () => {
    expect(oneCrewFeishuTables.map((table) => table.name)).toEqual([
      '项目',
      '分镜',
      '资产',
      '生成任务',
      '质检',
      '出海实验',
    ]);
  });

  it('contains only zh-CN and en-US in the experiment language field', () => {
    const experiments = oneCrewFeishuTables.find((table) => table.name === '出海实验');
    const language = experiments?.fields.find((field) => field.fieldName === 'language');
    expect(language?.options).toEqual(['zh-CN', 'en-US']);
  });

  it('builds cards with exactly the four locked actions', () => {
    const card = buildApprovalCard({
      title: '终审',
      summary: '请审批中英正片。',
      projectId: 'prj_demo',
      targetType: 'render',
      targetId: 'render_demo',
      expectedVersion: 3,
    });
    const body = card.body as {
      elements: Array<{
        columns?: Array<{
          elements?: Array<{
            behaviors?: Array<{ type: string; value: { action: string } }>;
          }>;
        }>;
      }>;
    };
    const actions = body.elements.flatMap((element) =>
      (element.columns ?? []).flatMap((column) =>
        (column.elements ?? []).flatMap((button) =>
          (button.behaviors ?? [])
            .filter((behavior) => behavior.type === 'callback')
            .map((behavior) => behavior.value.action),
        ),
      ),
    );
    expect(actions).toEqual(['approve', 'regenerate', 'switch_provider', 'manual']);
  });
});
