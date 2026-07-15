import { describe, expect, it, vi } from 'vitest';
import { createInputHash } from '@onecrew/domain';

import { FeishuRecordSync, type RecordLink, type RecordLinkStore } from './record-sync.js';

class MemoryLinks implements RecordLinkStore {
  readonly values = new Map<string, RecordLink>();

  async get(entityType: string, entityId: string): Promise<RecordLink | undefined> {
    return this.values.get(`${entityType}/${entityId}`);
  }

  async getByRemote(appToken: string, tableId: string, recordId: string): Promise<RecordLink | undefined> {
    return [...this.values.values()].find(
      (link) => link.appToken === appToken && link.tableId === tableId && link.recordId === recordId,
    );
  }

  async upsert(input: Omit<RecordLink, 'fieldHash'> & { fields: Record<string, unknown> }): Promise<RecordLink> {
    const link = { ...input, fieldHash: createInputHash(input.fields) };
    this.values.set(`${input.entityType}/${input.entityId}`, link);
    return link;
  }
}

describe('bidirectional Feishu record sync', () => {
  it('creates, updates, and suppresses unchanged outbound records', async () => {
    const links = new MemoryLinks();
    const client = {
      createRecord: vi.fn(async () => ({ record_id: 'rec_1', revision: 1 })),
      updateRecord: vi.fn(async () => ({ record_id: 'rec_1', revision: 2 })),
    };
    const sync = new FeishuRecordSync(client, links);
    const base = {
      entityType: 'project',
      entityId: 'prj_demo',
      appToken: 'app_demo',
      tableId: 'tbl_project',
      localVersion: 1,
      fields: { project_id: 'prj_demo', status: 'draft' },
    };

    await expect(sync.push(base)).resolves.toBe('created');
    await expect(
      sync.push({ ...base, localVersion: 2, fields: { ...base.fields, status: 'running' } }),
    ).resolves.toBe('updated');
    await expect(
      sync.push({ ...base, localVersion: 2, fields: { ...base.fields, status: 'running' } }),
    ).resolves.toBe('unchanged');
    expect(client.createRecord).toHaveBeenCalledTimes(1);
    expect(client.updateRecord).toHaveBeenCalledTimes(1);
  });

  it('applies only newer inbound revisions for known records', async () => {
    const links = new MemoryLinks();
    await links.upsert({
      entityType: 'project',
      entityId: 'prj_demo',
      appToken: 'app_demo',
      tableId: 'tbl_project',
      recordId: 'rec_1',
      localVersion: 1,
      remoteRevision: 2,
      fields: { status: 'draft' },
    });
    const sync = new FeishuRecordSync(
      {
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
      },
      links,
    );
    const apply = vi.fn(async () => 2);

    await expect(
      sync.pull(
        {
          appToken: 'app_demo',
          tableId: 'tbl_project',
          recordId: 'rec_1',
          revision: 2,
          fields: { status: 'running' },
        },
        apply,
      ),
    ).resolves.toBe('ignored');
    await expect(
      sync.pull(
        {
          appToken: 'app_demo',
          tableId: 'tbl_project',
          recordId: 'rec_1',
          revision: 3,
          fields: { status: 'running' },
        },
        apply,
      ),
    ).resolves.toBe('applied');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
