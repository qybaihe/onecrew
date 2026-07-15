# 本地部署与运维

## 启动与进程

要求 Node.js 22+、pnpm 10.13+、Docker Desktop、FFmpeg/ffprobe。最快启动：

```bash
bash scripts/bootstrap-local.sh
```

脚本创建本地 `.env`、安装锁定依赖、启动 PostgreSQL/Redis/MinIO，先生成契约并构建 workspace，再应用 migration/seed、编译 Design Pack，随后用 Turbo 同时运行 API、Worker 和只读 Preview。飞书仍是唯一业务控制面，Preview 不允许修改业务状态。

生产式本地分进程运行：

```bash
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm build
pnpm start:api
# 第二终端
pnpm start:worker
```

本地低资源 Final 演示可在 `.env` 设置 `REMOTION_FINAL_MAX_DIMENSION=640`。生产交付留空，按 Manifest 正式分辨率渲染。

## 健康与观测

- `GET /healthz`：API 存活。
- `GET /readyz`：实际探测 PostgreSQL、Redis、MinIO，异常返回 503。
- `pnpm infra:status`：三项容器健康状态。
- `pnpm infra:logs`：基础设施日志。
- Worker 只记录 Job/Render/QC/Localization ID、终态和受控摘要，不记录凭证与完整提示词。

BullMQ 可恢复排队任务；领域状态、幂等记录、人工闸门和 LangGraph checkpoint 位于 PostgreSQL。Worker 重启后，客户端可继续通过状态 URL 轮询。对象存储 URI 只允许受控 bucket，飞书不承担大文件存储。

## 常见恢复

- API 503：先运行 `pnpm infra:status`，再看 `pnpm infra:logs`，恢复依赖后重试 `/readyz`。
- Job 长时间排队：确认独立 Worker 已输出 `onecrew_worker_ready`；不要在 API 进程内执行媒体任务。
- 相同幂等键 409：原请求与新请求不同，应使用新键或恢复原请求，不能覆盖已有记录。
- Provider Real 启动失败：运行 `pnpm providers:check`；Real 模式对缺失凭证、模型 ID、回调密钥和正价格失败关闭。
- QC 进入人工：从飞书四动作处理；无真实飞书配置时从持久化 `reviewCard`/`mock_outbox` 做集成演示。
- Render 失败：读取持久化 `errorCode/errorMessage`，修复 Manifest 或运行时后以新 `renderId` 提交；相同语义输入会命中成功缓存。

## 数据与清理

PostgreSQL 是业务真相，MinIO 是媒体真相，Redis 只用于队列。备份至少包含 PostgreSQL dump 和受控 bucket。停止基础设施：

```bash
pnpm infra:down
```

不要在生产或保留数据的本地环境使用 `down -v`。空数据库复现、演示命令和验收输出见 [决赛演示](./demo.md)。
