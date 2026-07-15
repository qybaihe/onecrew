import { describe, expect, it, vi } from 'vitest';

import { FeishuClient } from './client.js';

describe('FeishuClient interactive cards', () => {
  it('sends an interactive message with the receiver type and nested card JSON', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', tenant_access_token: 'tenant', expire: 7_200 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 0, msg: 'ok', data: { message_id: 'om_fixture' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = new FeishuClient({
      appId: 'cli_fixture',
      appSecret: 'secret_fixture',
      apiBaseUrl: 'https://feishu.invalid/open-apis',
      fetch: fetchMock,
    });
    const card = { schema: '2.0', body: { elements: [] } };

    await expect(client.sendInteractiveCard('oc_fixture', 'chat_id', card)).resolves.toEqual({
      messageId: 'om_fixture',
    });
    const [url, init] = fetchMock.mock.calls[1] ?? [];
    expect(url).toBe('https://feishu.invalid/open-apis/im/v1/messages?receive_id_type=chat_id');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ receive_id: 'oc_fixture', msg_type: 'interactive' });
    expect(JSON.parse(String(body.content))).toEqual(card);
  });
});
