# Provider Gateway 配置

OneCrew 的所有模型调用都先经过 `packages/providers` Registry，再由 `apps/worker` 从 BullMQ 消费。业务代码不能直接绑定模型名，也不能把 Provider 返回的任意 URL 当作可信存储。

## 路由矩阵

每项能力必须同时存在 Primary 和 Fallback；Registry 缺少或重复任一路由会启动失败。

| 能力 | Real Primary | Fallback | 当前验证状态 |
|---|---|---|---|
| LLM 剧本/翻译/营销文案 | OpenCode Go `glm-5.2` Chat Completions | deterministic Mock LLM | 2026-07-16 真实烟雾测试通过 |
| 图片 | Agnes Image 2.1 Flash | deterministic Mock Image | 2026-07-16 真实烟雾测试通过 |
| 视频 | Agnes Video V2.0 异步任务 | deterministic Mock Video | 2026-07-16 真实烟雾测试通过 |
| TTS | Xiaomi MiMo V2.5 TTS | deterministic Mock TTS | 2026-07-16 真实烟雾测试通过 |
| VLM 质检 | OpenCode Go `minimax-m3` Messages | deterministic Mock VLM | 2026-07-16 真实图片理解测试通过 |

Mock Primary/Fallback 十条路由全部是确定性实现，输出标记 `mode=mock`、`verification=mock_verified`。当前 Real Primary 标记 `mode=real`、`verification=real_smoke_verified`；该标记表示 Adapter 与对应端点已完成最小真实调用，不表示完整短剧生产 E2E 或长期可用性 SLA 已验证。

官方接口依据：

- [OpenCode Go](https://opencode.ai/docs/go/)
- [Agnes Image 2.1 Flash](https://agnes-ai.com/zh-Hans/docs/agnes-image-21-flash)
- [Agnes Video V2.0](https://agnes-ai.com/zh-Hans/docs/agnes-video-v20)
- [Xiaomi MiMo V2.5 TTS](https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5)

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

## 当前 Real Profile

```dotenv
PROVIDER_MODE=real
PROVIDER_PROFILE=opencode-agnes-mimo
```

协议不能混用：

- `glm-5.2` 调用 `POST https://opencode.ai/zen/go/v1/chat/completions`。
- `minimax-m3` 调用 `POST https://opencode.ai/zen/go/v1/messages`；QC 视频先由 Worker 抽帧为受控 JPEG 联系表，再作为图片输入。
- Agnes Image 调用同步 `POST /v1/images/generations`；即使厂商返回临时 URL，Adapter 也会下载并写入 OneCrew S3/MinIO。
- Agnes Video 调用 `POST /v1/videos` 后以 `video_id` 轮询 `/agnesapi`；完成后 MP4 写入 OneCrew S3/MinIO。
- MiMo TTS 调用 `POST /v1/chat/completions`，读取 Base64 音频并写入 OneCrew S3/MinIO。OneCrew 的逻辑 voice ID 会在中英文预置音色表中做确定性选择。

需要填写：

- `OPENCODE_GO_API_KEY`、`OPENCODE_GO_LLM_MODEL`、`OPENCODE_GO_VLM_MODEL`。
- `AGNES_API_KEY`、`AGNES_IMAGE_MODEL`、`AGNES_VIDEO_MODEL`。
- `MIMO_API_KEY`、`MIMO_TTS_MODEL`、`MIMO_TTS_ZH_VOICES`、`MIMO_TTS_EN_VOICES`。
- `PROVIDER_CALLBACK_SECRET`。

OpenCode Go 使用订阅额度，Agnes Image/Video 当前文档价格为 0，MiMo V2.5 TTS 为限时免费，因此本 Profile 允许显式的零边际成本。启用 OpenCode Zen 余额回退或厂商恢复计费前，必须更新对应 `*_CNY_*` 变量。

## Real 模式失败关闭

旧的 `openai-volcengine-elevenlabs` Profile 仍可选择；切换到该 Profile 时必须同时填写：

- `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_VLM_MODEL` 和输入/输出人民币单价。
- `VOLCENGINE_ARK_API_KEY`、`SEEDREAM_MODEL`、`SEEDANCE_MODEL` 和图片/视频人民币单价。
- `ELEVENLABS_API_KEY`、`ELEVENLABS_MODEL` 和千字符人民币单价。
- `PROVIDER_CALLBACK_SECRET`。
- 可选自定义的三项 `*_BASE_URL` 只能指向明确受信任的服务。

当前 Profile 缺少任一 Key、模型 ID 或回调密钥时，`PROVIDER_MODE=real` 的环境解析会直接失败。旧 Profile 还要求所有单价为正数。Provider Key 只放本机 `.env` 或 Secret Manager；不得放入飞书、请求 JSON、数据库业务字段或日志。

## 执行保证

- 请求边界由共享 Zod 契约严格校验。
- HTTP Adapter 设置超时；Gateway 只对可重试错误做有上限的指数退避。
- BullMQ 使用持久 Job ID、三次队列尝试、指数退避、并发和全局限流。
- `Idempotency-Key` 相同但请求不同会返回冲突；完全相同则复用原 Job。
- Provider 缓存以规范化输入哈希、Provider、模型和模式为键；明确重生成会增加 `generationNonce` 绕过缓存。
- 预算估计超过硬上限时 Job 进入 `waiting_human`，飞书批准后才排队。
- 外部任务 ID 在提交后立即持久化；回调使用 HMAC-SHA256、五分钟重放窗口和事件幂等表。
- 二进制媒体只写入配置的 S3 bucket；对象 key 会拒绝绝对路径、反斜杠和 `..`。

## 真实烟雾测试

本机凭证文件被 `.gitignore` 排除。配置完成后先运行：

```bash
pnpm providers:check
```

该命令只做脱敏配置检查，不发网络请求。然后显式运行：

```bash
pnpm providers:smoke-real
```

该命令会提交一个短 JSON 对话、一张最小图片理解、一张测试图、一句配音和一秒测试视频，可能占用订阅额度或产生费用。2026-07-16 的验证结果为五项全部 `succeeded`，并确认图片、WAV 与 MP4 均能被 Adapter 物化为受控媒体。

后续更换 Key、模型或 Base URL 时，应重新执行：

1. 在隔离环境设置 `PROVIDER_MODE=real` 和 Secret Manager 注入的凭证。
2. 运行 `pnpm providers:check`，确认五条 Primary 与所选 Profile 一致。
3. 同时启动 `pnpm start:api` 与 `pnpm start:worker`。
4. 每项能力提交一个最小请求，轮询 Job 到终态。
5. 核对 Provider 控制台、`provider_job_runs`、`jobs.actual_cost_cny` 和受控 S3 对象。
6. 只有真实响应、成本和媒体都验证后，才更新验证记录；失败时保留错误码，不以 Mock 结果替代。

## 已知协议限制

- Agnes Video V2.0 当前文档没有提供取消端点。OneCrew 不会伪造远端取消成功；正在运行的远端任务只能等待终态。
- OpenCode Go 与免费厂商的订阅/限免模式无法提供精确单次人民币账单；边际成本为 0 时，OneCrew 的预算闸门不能代替供应商控制台的额度上限。
- Real 烟雾测试只证明最小请求路径成功。完整故事规划、批量镜头生成、双语配音、QC、Remotion 和发布链仍需另行运行真实 E2E。
