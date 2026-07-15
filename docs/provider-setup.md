# Provider Gateway 配置

OneCrew 的所有模型调用都先经过 `packages/providers` Registry，再由 `apps/worker` 从 BullMQ 消费。业务代码不能直接绑定模型名，也不能把 Provider 返回的任意 URL 当作可信存储。

## 路由矩阵

每项能力必须同时存在 Primary 和 Fallback；Registry 缺少或重复任一路由会启动失败。

| 能力 | Real Primary | Fallback | 当前验证状态 |
|---|---|---|---|
| LLM 剧本/翻译/营销文案 | OpenAI Responses API | deterministic Mock LLM | Adapter fixture 已验证；真实未验证 |
| 图片 | 火山方舟 Seedream | deterministic Mock Image | Adapter fixture 已验证；真实未验证 |
| 视频 | 火山方舟 Seedance 异步任务 | deterministic Mock Video | Adapter fixture 已验证；真实未验证 |
| TTS | ElevenLabs Text-to-Speech | deterministic Mock TTS | Adapter fixture 已验证；真实未验证 |
| VLM 质检 | OpenAI Responses API 视觉输入 | deterministic Mock VLM | Adapter fixture 已验证；真实未验证 |

Mock Primary/Fallback 十条路由全部是确定性实现，输出标记 `mode=mock`、`verification=mock_verified`。Real Primary 标记 `mode=real`、`verification=config_ready_unverified`，在真实最小烟雾测试通过前不会写成“已验证”。

官方接口依据：

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [火山方舟图片生成 API](https://www.volcengine.com/docs/82379/1541523)
- [火山方舟视频生成任务 API](https://www.volcengine.com/docs/82379/2298881)
- [ElevenLabs Text-to-Speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert/)

## 零额度配置检查

默认 `.env.example` 是：

```dotenv
PROVIDER_MODE=mock
```

运行：

```bash
pnpm providers:check
```

该命令只解析配置和列出十条 Mock 路由，不发网络请求、不创建外部任务、不消耗额度。

## Real 模式失败关闭

切换前必须同时填写：

- `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_VLM_MODEL` 和输入/输出人民币单价。
- `VOLCENGINE_ARK_API_KEY`、`SEEDREAM_MODEL`、`SEEDANCE_MODEL` 和图片/视频人民币单价。
- `ELEVENLABS_API_KEY`、`ELEVENLABS_MODEL` 和千字符人民币单价。
- `PROVIDER_CALLBACK_SECRET`。
- 可选自定义的三项 `*_BASE_URL` 只能指向明确受信任的服务。

任一 Key、模型 ID、回调密钥缺失，或任一成本不是正数，`PROVIDER_MODE=real` 的环境解析会直接失败。Provider Key 只放本机 `.env` 或 Secret Manager；不得放入飞书、请求 JSON、数据库业务字段或日志。

## 执行保证

- 请求边界由共享 Zod 契约严格校验。
- HTTP Adapter 设置超时；Gateway 只对可重试错误做有上限的指数退避。
- BullMQ 使用持久 Job ID、三次队列尝试、指数退避、并发和全局限流。
- `Idempotency-Key` 相同但请求不同会返回冲突；完全相同则复用原 Job。
- Provider 缓存以规范化输入哈希、Provider、模型和模式为键；明确重生成会增加 `generationNonce` 绕过缓存。
- 预算估计超过硬上限时 Job 进入 `waiting_human`，飞书批准后才排队。
- 外部任务 ID 在提交后立即持久化；回调使用 HMAC-SHA256、五分钟重放窗口和事件幂等表。
- 二进制媒体只写入配置的 S3 bucket；对象 key 会拒绝绝对路径、反斜杠和 `..`。

## 有凭证后的真实烟雾测试

当前仓库没有真实 Provider 凭证，因此没有执行此步骤。拿到授权和预算后，每项能力只提交一个最小任务：

1. 在隔离环境设置 `PROVIDER_MODE=real` 和 Secret Manager 注入的凭证。
2. 运行 `pnpm providers:check`，确认五条 Primary 显示 `config_ready_unverified`。
3. 同时启动 `pnpm start:api` 与 `pnpm start:worker`。
4. 每项能力提交一个最小请求，轮询 Job 到终态。
5. 核对 Provider 控制台、`provider_job_runs`、`jobs.actual_cost_cny` 和受控 S3 对象。
6. 只有真实响应、成本和媒体都验证后，才更新验证记录；失败时保留错误码，不以 Mock 结果替代。
