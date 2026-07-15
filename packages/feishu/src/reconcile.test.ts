import { describe, expect, it } from 'vitest';

import type { FeishuApiField } from './base-schema.js';
import type { FeishuFieldMeta, FeishuTableMeta } from './client.js';
import {
  buildBaseDryRunReport,
  reconcileOneCrewBase,
  type BaseAdminClient,
} from './reconcile.js';

class FakeBaseAdminClient implements BaseAdminClient {
  readonly tables: FeishuTableMeta[] = [];
  readonly fields = new Map<string, FeishuFieldMeta[]>();

  async listTables(): Promise<FeishuTableMeta[]> {
    return this.tables;
  }

  async createTable(_appToken: string, name: string, fields: FeishuApiField[]): Promise<FeishuTableMeta> {
    const table = { table_id: `tbl_${this.tables.length + 1}`, name };
    this.tables.push(table);
    this.fields.set(
      table.table_id,
      fields.map((field, index) => ({ ...field, field_id: `fld_${table.table_id}_${index}` })),
    );
    return table;
  }

  async listFields(_appToken: string, tableId: string): Promise<FeishuFieldMeta[]> {
    return this.fields.get(tableId) ?? [];
  }

  async createField(
    _appToken: string,
    tableId: string,
    field: FeishuApiField,
  ): Promise<FeishuFieldMeta> {
    const fields = this.fields.get(tableId) ?? [];
    const created = { ...field, field_id: `fld_${tableId}_${fields.length}` };
    fields.push(created);
    this.fields.set(tableId, fields);
    return created;
  }
}

describe('Feishu Base reconciliation', () => {
  it('provides a credential-free six-table dry run', () => {
    const report = buildBaseDryRunReport();
    expect(report.mode).toBe('dry-run');
    expect(report.tables).toHaveLength(6);
    expect(report.tables.every((table) => table.status === 'planned')).toBe(true);
  });

  it('creates all tables in dependency order and validates an idempotent second run', async () => {
    const client = new FakeBaseAdminClient();
    const first = await reconcileOneCrewBase(client, 'app_test');
    expect(first.tables).toHaveLength(6);
    expect(first.tables.every((table) => table.status === 'created')).toBe(true);

    const second = await reconcileOneCrewBase(client, 'app_test');
    expect(second.tables.every((table) => table.status === 'validated')).toBe(true);
    expect(client.tables).toHaveLength(6);
  });

  it('fails closed on an existing field with the wrong type', async () => {
    const client = new FakeBaseAdminClient();
    await reconcileOneCrewBase(client, 'app_test');
    const projectFields = client.fields.get('tbl_1');
    const projectId = projectFields?.find((field) => field.field_name === 'project_id');
    if (!projectId) throw new Error('project_id fixture was not created');
    projectId.type = 2;

    await expect(reconcileOneCrewBase(client, 'app_test')).rejects.toThrow(/field type mismatch/);
  });
});
