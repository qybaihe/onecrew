import {
  compileFeishuFields,
  oneCrewFeishuTables,
  type FeishuApiField,
  type OneCrewFeishuTableName,
} from './base-schema.js';
import type { FeishuFieldMeta, FeishuTableMeta } from './client.js';

export interface BaseAdminClient {
  listTables(appToken: string): Promise<FeishuTableMeta[]>;
  createTable(appToken: string, name: string, fields: FeishuApiField[]): Promise<FeishuTableMeta>;
  listFields(appToken: string, tableId: string): Promise<FeishuFieldMeta[]>;
  createField(appToken: string, tableId: string, field: FeishuApiField): Promise<FeishuFieldMeta>;
}

export interface BaseReconcileReport {
  mode: 'dry-run' | 'real';
  appToken?: string;
  tables: Array<{
    name: OneCrewFeishuTableName;
    tableId?: string;
    status: 'planned' | 'created' | 'validated' | 'updated';
    createdFields: string[];
    validatedFields: string[];
  }>;
}

export function buildBaseDryRunReport(): BaseReconcileReport {
  return {
    mode: 'dry-run',
    tables: oneCrewFeishuTables.map((table) => ({
      name: table.name,
      status: 'planned',
      createdFields: table.fields.map((field) => field.fieldName),
      validatedFields: [],
    })),
  };
}

export async function reconcileOneCrewBase(
  client: BaseAdminClient,
  appToken: string,
): Promise<BaseReconcileReport> {
  const existingTables = await client.listTables(appToken);
  const tableIds: Partial<Record<OneCrewFeishuTableName, string>> = Object.fromEntries(
    existingTables
      .filter((table) => oneCrewFeishuTables.some((definition) => definition.name === table.name))
      .map((table) => [table.name, table.table_id]),
  );
  const reports: BaseReconcileReport['tables'] = [];

  for (const definition of oneCrewFeishuTables) {
    let tableId = tableIds[definition.name];
    let created = false;
    if (!tableId) {
      const fields = compileFeishuFields(definition, tableIds);
      const table = await client.createTable(appToken, definition.name, fields);
      tableId = table.table_id;
      tableIds[definition.name] = tableId;
      created = true;
    }

    const expectedFields = compileFeishuFields(definition, tableIds);
    const actualFields = await client.listFields(appToken, tableId);
    const createdFields: string[] = [];
    const validatedFields: string[] = [];
    for (const expected of expectedFields) {
      const actual = actualFields.find((field) => field.field_name === expected.field_name);
      if (!actual) {
        await client.createField(appToken, tableId, expected);
        createdFields.push(expected.field_name);
        continue;
      }
      if (actual.type !== expected.type) {
        throw new Error(
          `Feishu Base field type mismatch: ${definition.name}.${expected.field_name} expected ${expected.type}, actual ${actual.type}`,
        );
      }
      validatedFields.push(expected.field_name);
    }

    reports.push({
      name: definition.name,
      tableId,
      status: created ? 'created' : createdFields.length > 0 ? 'updated' : 'validated',
      createdFields,
      validatedFields,
    });
  }

  return { mode: 'real', appToken, tables: reports };
}
