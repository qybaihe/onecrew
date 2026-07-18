# 飞书控制面板配置

OneCrew 只把飞书用作业务控制面板。媒体二进制、API Key、Job 队列和工作流游标不得写入飞书。

## 需要准备

1. 企业自建飞书应用。
2. 一份应用有编辑权限的多维表格 Base，并取得 `app_token`。
3. 应用凭证 `App ID` / `App Secret`。
4. 事件与回调页的 `Verification Token`。
5. 推荐配置 `Encrypt Key`，以启用原始请求签名校验和 AES-256-CBC 加密传输。
6. 明确允许审批的操作者 `open_id` 列表。

真实值只放入本机 `.env` 或 Secret Manager：

```dotenv
FEISHU_APP_ID=...
FEISHU_APP_SECRET=...
FEISHU_BASE_APP_TOKEN=...
FEISHU_VERIFICATION_TOKEN=...
FEISHU_ENCRYPT_KEY=...
FEISHU_ALLOWED_OPEN_IDS=ou_xxx,ou_yyy
FEISHU_QC_RECEIVE_ID=oc_xxx
FEISHU_QC_RECEIVE_ID_TYPE=chat_id
```

不要把真实值写入 `.env.example`、飞书表格、日志或 Git。

## 权限

按最小权限原则申请多维表格相关应用身份权限：

- 查看、评论和导出多维表格。
- 查看、评论、编辑和管理多维表格。
- 新增/更新数据表、字段和记录所需的对应细分权限。

使用 `tenant_access_token` 时，还必须把应用本身加入目标 Base 的可编辑范围。官方 API 即使 HTTP 为 200，也可能用非零业务 `code` 表示失败；OneCrew Client 会同时检查 HTTP 状态和业务 `code`。

官方依据：

- [获取访问凭证](https://open.feishu.cn/document/server-docs/api-call-guide/calling-process/get-access-token)
- [多维表格服务端 API 概述](https://open.feishu.cn/document/server-docs/docs/bitable-v1/bitable-overview)
- [新增字段](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-field/create)
- [接收事件与签名校验](https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-configuration-case)

## 创建或校验六表

```bash
pnpm feishu:setup
```

- 缺少任一 `App ID`、`App Secret` 或 Base `app_token` 时，只输出 `dry-run` 六表报告，不发网络请求。
- 凭证齐全时，脚本列出现有表，按 `项目 -> 分镜 -> 资产 -> 生成任务 -> 质检 -> 出海实验` 的依赖顺序创建缺失表，再逐字段校验。
- 同名字段类型不一致时失败关闭，不静默改列或丢数据。
- 对已有正确表和字段重复执行是幂等的。

六张表和字段定义只来自 `packages/feishu/src/base-schema.ts`，与蓝图第 11 节一致。

`FEISHU_QC_RECEIVE_ID` 可配置群聊或用户接收 QC 升级卡片，类型由 `FEISHU_QC_RECEIVE_ID_TYPE` 指定。凭证和接收目标齐全时 Client 调用 `POST /im/v1/messages` 发送 `interactive` 消息；未配置时卡片仍完整持久化为 `mock_outbox`，绝不假装已发送。

## 回调地址

配置：

```text
POST https://<public-host>/v1/feishu/events
POST https://<public-host>/v1/feishu/card-actions
```

事件端点支持 URL verification challenge；卡片端点只接受四个动作：

- 通过 `approve`
- 重生成 `regenerate`
- 切换模型 `switch_provider`
- 转人工处理 `manual`

安全处理顺序：

1. 保留 HTTP 原始 JSON 字符串。
2. 有 Encrypt Key 时校验 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce`、`X-Lark-Signature`。
3. 拒绝超过 5 分钟的请求时间戳。
4. 如有 `encrypt`，按官方 AES-256-CBC 规则解密。
5. 校验 Verification Token。
6. 解析卡片动作后校验操作者、目标、目标版本和事件幂等键。
7. 把 accepted/rejected/failed 结果写入 PostgreSQL `audit_logs`。

缺少 `FEISHU_VERIFICATION_TOKEN` 时，两个路由返回 HTTP 503，不接受匿名回调。

## 真实租户检查

2026-07-18 已使用本机 Secret 配置运行 `pnpm feishu:setup`，报告为 `mode: real`。真实租户中的 `项目 / 分镜 / 资产 / 生成任务 / 质检 / 出海实验` 六表及全部字段均校验通过，未创建或修改字段；验证记录不包含 App ID、Secret、Base token 或表 ID。

这证明应用取 token、Base 访问权限、表发现和字段契约可用。以下实租户闭环仍需执行：

1. 在飞书后台配置 URL，观察事件与卡片回调 challenge 通过。
2. 用测试项目投递一张 Card 2.0 审批卡，分别演示四动作。
3. 查询 `audit_logs` 和 `human_gates`，确认操作者、版本、事件 ID 和结果已持久化。
4. 不输出或截图包含 App Secret、Encrypt Key、Verification Token 的页面。

脱敏验证结果见 [2026-07-18 飞书 Base 验证记录](./verification/feishu-base-2026-07-18.md)。
