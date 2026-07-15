# 阶段 4 验证记录

验证日期：2026-07-15（Asia/Shanghai）

## 已实现边界

- 五类共享 Provider 请求/输出契约：LLM、Image、Video、TTS、VLM。
- 每类恰好一条 Primary 和一条 Fallback 路由；缺失或重复时失败关闭。
- 五类 deterministic Mock、五类真实 HTTP Adapter、统一超时/重试/限流/审计/成本接口。
- BullMQ 持久队列、Redis Worker、Job 幂等/取消/缓存/预算闸门和回调恢复。
- Provider Job/Run/Cache/Callback 的 PostgreSQL 表和 Drizzle 生成迁移。
- S3/MinIO 受控媒体写入。
- 蓝图 15 节点 LangGraph、三个人工中断和 PostgreSQL Checkpointer。
- 飞书四动作已连接预算 Job 或 LangGraph 恢复语义。

## 本地进程级冒烟

同时启动编译后的 API 和 Worker 后：

1. `GET /healthz` 返回 200。
2. `GET /readyz` 返回 200，PostgreSQL、Redis、objectStorage 三项均为 `up`。
3. 对 `prj_shanhai_demo` 提交 Mock LLM 任务，API 返回 HTTP 202：

```text
job_id: job_mrm16rxp_634dc6dab4b59c1f
mode: mock
provider: mock-llm-primary
estimated_cost_cny: 0.0002
```

4. 独立 Worker 从 Redis 消费后，Job 到达 `succeeded`，数据库记录：

```text
attempt: 1
actual_cost_cny: 0.0002
latency_ms: 6
external_job_id: mock_llm_634dc6dab4b59c1f3163
```

5. 相同幂等键返回同一 Job 且 `replayed=true`。
6. 新幂等键、完全相同输入创建第二个 Job，并从持久缓存完成：`actual_cost_cny=0`、`latency_ms=0`、无外部任务 ID。

## 自动验证覆盖

- Provider 单元测试覆盖五类 Mock、完整路由、重试策略和预算判定。
- Provider HTTP Adapter 集成测试用本地 fixture 覆盖五类真实响应形状，不请求外网。
- Media 集成测试对实际 MinIO 完成 put/get/delete。
- DB 集成测试覆盖 Provider Run、缓存和回调幂等。
- Workflow 集成测试对实际 PostgreSQL + Redis 跑通排队、幂等重放、缓存、硬预算闸门和签名回调。
- LangGraph 集成测试关闭并重建三个工作流实例，证明三个人工中断跨进程恢复；`switch_provider` 以 fallback 回跑 Design 节点并生成新 Gate，最终到达 `metrics_sync/done`。

完整回归命令：

```bash
pnpm providers:check
pnpm db:check
pnpm db:migrate
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

## 诚实边界

- 当前没有 OpenAI、火山方舟或 ElevenLabs 凭证，真实外部请求和真实成本尚未验证。
- `PROVIDER_MODE=real` 只表示配置准备就绪，真实烟雾测试通过前仍标记 `config_ready_unverified`。
- Real Primary 的 Fallback 当前是显式 `mode=mock` 的确定性 Provider；系统不会把 Fallback Mock 结果标成 Real。
- LangGraph 节点在阶段 4 只做编排；Remotion、完整 QC、本地化与发布节点会在阶段 5～7接入各自实现。
