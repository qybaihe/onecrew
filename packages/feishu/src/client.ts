import type { FeishuApiField } from './base-schema.js';

interface FeishuResponse<T> {
  code: number;
  msg: string;
  data?: T;
  tenant_access_token?: string;
  expire?: number;
}

export interface FeishuTableMeta {
  table_id: string;
  name: string;
  revision?: number;
}

export interface FeishuFieldMeta extends FeishuApiField {
  field_id: string;
  is_primary?: boolean;
}

export type FeishuReceiveIdType = 'open_id' | 'user_id' | 'union_id' | 'email' | 'chat_id';

export class FeishuApiError extends Error {
  constructor(
    readonly code: number,
    readonly operation: string,
    message: string,
  ) {
    super(`Feishu API ${operation} failed (${code}): ${message}`);
    this.name = 'FeishuApiError';
  }
}

export interface FeishuClientOptions {
  appId: string;
  appSecret: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}

export class FeishuClient {
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token?: { value: string; expiresAtMs: number };

  constructor(private readonly options: FeishuClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://open.feishu.cn/open-apis';
    this.fetchImpl = options.fetch ?? fetch;
  }

  private async tenantAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAtMs - Date.now() > 60_000) return this.token.value;

    const response = await this.fetchImpl(`${this.apiBaseUrl}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.options.appId, app_secret: this.options.appSecret }),
    });
    const payload = (await response.json()) as FeishuResponse<never>;
    if (!response.ok || payload.code !== 0 || !payload.tenant_access_token) {
      throw new FeishuApiError(payload.code, 'tenant_access_token', payload.msg || response.statusText);
    }
    this.token = {
      value: payload.tenant_access_token,
      expiresAtMs: Date.now() + (payload.expire ?? 7_200) * 1_000,
    };
    return this.token.value;
  }

  private async request<T>(operation: string, path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.tenantAccessToken();
    const response = await this.fetchImpl(`${this.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
        ...init.headers,
      },
    });
    const payload = (await response.json()) as FeishuResponse<T>;
    if (!response.ok || payload.code !== 0 || payload.data === undefined) {
      throw new FeishuApiError(payload.code, operation, payload.msg || response.statusText);
    }
    return payload.data;
  }

  async listTables(appToken: string): Promise<FeishuTableMeta[]> {
    const items: FeishuTableMeta[] = [];
    let pageToken: string | undefined;
    do {
      const query = new URLSearchParams({ page_size: '100' });
      if (pageToken) query.set('page_token', pageToken);
      const data = await this.request<{
        items?: FeishuTableMeta[];
        has_more?: boolean;
        page_token?: string;
      }>('list tables', `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables?${query.toString()}`);
      items.push(...(data.items ?? []));
      pageToken = data.has_more ? data.page_token : undefined;
    } while (pageToken);
    return items;
  }

  async createTable(appToken: string, name: string, fields: FeishuApiField[]): Promise<FeishuTableMeta> {
    const data = await this.request<{ table: FeishuTableMeta }>(
      'create table',
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables`,
      {
        method: 'POST',
        body: JSON.stringify({
          table: { name, default_view_name: '默认视图', fields },
        }),
      },
    );
    return data.table;
  }

  async listFields(appToken: string, tableId: string): Promise<FeishuFieldMeta[]> {
    const data = await this.request<{ items?: FeishuFieldMeta[] }>(
      'list fields',
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields?page_size=100`,
    );
    return data.items ?? [];
  }

  async createField(appToken: string, tableId: string, field: FeishuApiField): Promise<FeishuFieldMeta> {
    const data = await this.request<{ field: FeishuFieldMeta }>(
      'create field',
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/fields`,
      { method: 'POST', body: JSON.stringify(field) },
    );
    return data.field;
  }

  async createRecord(
    appToken: string,
    tableId: string,
    fields: Record<string, unknown>,
    clientToken: string,
  ): Promise<{ record_id: string; revision?: number }> {
    const query = new URLSearchParams({ client_token: clientToken });
    const data = await this.request<{ record: { record_id: string; revision?: number } }>(
      'create record',
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?${query.toString()}`,
      { method: 'POST', body: JSON.stringify({ fields }) },
    );
    return data.record;
  }

  async updateRecord(
    appToken: string,
    tableId: string,
    recordId: string,
    fields: Record<string, unknown>,
    clientToken: string,
  ): Promise<{ record_id: string; revision?: number }> {
    const query = new URLSearchParams({ client_token: clientToken });
    const data = await this.request<{ record: { record_id: string; revision?: number } }>(
      'update record',
      `/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records/${encodeURIComponent(recordId)}?${query.toString()}`,
      { method: 'PUT', body: JSON.stringify({ fields }) },
    );
    return data.record;
  }

  async sendInteractiveCard(
    receiveId: string,
    receiveIdType: FeishuReceiveIdType,
    card: Record<string, unknown>,
  ): Promise<{ messageId: string }> {
    if (!receiveId.trim()) throw new Error('Feishu receiveId is required');
    const query = new URLSearchParams({ receive_id_type: receiveIdType });
    const data = await this.request<{ message_id: string }>(
      'send interactive card',
      `/im/v1/messages?${query.toString()}`,
      {
        method: 'POST',
        body: JSON.stringify({
          receive_id: receiveId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
      },
    );
    return { messageId: data.message_id };
  }
}
