import { createInputHash } from '@onecrew/domain';

export interface RecordLink {
  entityType: string;
  entityId: string;
  appToken: string;
  tableId: string;
  recordId: string;
  localVersion: number;
  remoteRevision?: number;
  fieldHash: string;
}

export interface RecordLinkStore {
  get(entityType: string, entityId: string): Promise<RecordLink | undefined>;
  getByRemote(appToken: string, tableId: string, recordId: string): Promise<RecordLink | undefined>;
  upsert(input: Omit<RecordLink, 'fieldHash'> & { fields: Record<string, unknown> }): Promise<RecordLink>;
}

export interface RecordClient {
  createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>,
    clientToken: string,
  ): Promise<{ record_id: string; revision?: number }>;
  updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    clientToken: string,
  ): Promise<{ record_id: string; revision?: number }>;
}

export class FeishuRecordSync {
  constructor(
    private readonly client: RecordClient,
    private readonly links: RecordLinkStore,
  ) {}

  async push(input: {
    entityType: string;
    entityId: string;
    appToken: string;
    tableId: string;
    localVersion: number;
    fields: Record<string, unknown>;
  }): Promise<'created' | 'updated' | 'unchanged'> {
    const existing = await this.links.get(input.entityType, input.entityId);
    const fieldHash = createInputHash(input.fields);
    if (existing && existing.fieldHash === fieldHash && existing.localVersion === input.localVersion) {
      return 'unchanged';
    }

    const clientToken = crypto.randomUUID();
    const remote = existing
      ? await this.client.updateRecord(
          input.appToken,
          input.tableId,
          existing.recordId,
          input.fields,
          clientToken,
        )
      : await this.client.createRecord(
          input.appToken,
          input.tableId,
          input.fields,
          clientToken,
        );
    await this.links.upsert({
      entityType: input.entityType,
      entityId: input.entityId,
      appToken: input.appToken,
      tableId: input.tableId,
      recordId: remote.record_id,
      localVersion: input.localVersion,
      ...(remote.revision === undefined ? {} : { remoteRevision: remote.revision }),
      fields: input.fields,
    });
    return existing ? 'updated' : 'created';
  }

  async pull(
    input: {
      appToken: string;
      tableId: string;
      recordId: string;
      revision?: number;
      fields: Record<string, unknown>;
    },
    apply: (link: RecordLink, fields: Record<string, unknown>) => Promise<number>,
  ): Promise<'applied' | 'ignored'> {
    const link = await this.links.getByRemote(input.appToken, input.tableId, input.recordId);
    if (!link) return 'ignored';
    if (input.revision !== undefined && link.remoteRevision !== undefined && input.revision <= link.remoteRevision) {
      return 'ignored';
    }
    const localVersion = await apply(link, input.fields);
    await this.links.upsert({
      ...link,
      localVersion,
      ...(input.revision === undefined ? {} : { remoteRevision: input.revision }),
      fields: input.fields,
    });
    return 'applied';
  }
}
