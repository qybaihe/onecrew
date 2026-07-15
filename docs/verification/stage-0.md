# 阶段 0 验证记录

验证日期：2026-07-15（Asia/Shanghai）
工作区：`/Users/baihe/Documents/飞书山海星辰`

## 环境事实

- Node.js：`v26.4.0`（工程最低版本为 Node.js 22.13）。
- pnpm：`10.13.1`。
- Docker Engine：`28.3.2`，Docker Compose：`2.39.1`。
- FFmpeg / ffprobe：`7.1.1`。
- 本机已有 PostgreSQL 与 Redis 客户端；服务端由 Compose 提供。

## 已执行命令

```text
pnpm install                     PASS
pnpm infra:config                PASS
pnpm infra:up                    PASS
pnpm lint                        PASS (2/2 workspace tasks)
pnpm typecheck                   PASS (3/3 workspace tasks)
pnpm test:unit                   PASS (2 files, 6 tests)
pnpm test:integration            PASS (3 infrastructure probes)
pnpm build                       PASS (2/2 workspace tasks)
```

## 实际基础设施

固定镜像：

- `postgres:17.5-alpine`
- `redis:7.2.10-alpine`
- `quay.io/minio/minio:RELEASE.2025-06-13T11-33-47Z`

`docker compose up -d --wait` 返回三个容器均为 `healthy`。集成测试不是 mock：它们分别执行 PostgreSQL `select 1`、Redis `PING` 和 MinIO `/minio/health/ready` 请求。

## API smoke

使用 `pnpm start:api` 启动编译后的 `dist/server.js`：

```json
GET /healthz -> 200
{"status":"ok","service":"onecrew-api","version":"0.1.0-dev"}
```

```json
GET /readyz -> 200
{
  "status": "ready",
  "components": {
    "postgres": { "status": "up" },
    "redis": { "status": "up" },
    "objectStorage": { "status": "up" }
  }
}
```

同一路由的单元测试还验证：任一依赖失败时 `/readyz` 返回 HTTP 503，且响应不会泄露上游错误详情。

## 已知边界

- 这是阶段 0 的本地开发基础设施证据，不代表飞书或任何真实生成 Provider 已接通。
- CI 工作流已生成，但尚无远端 GitHub Actions run；本地执行覆盖了相同的 lint、typecheck、unit、integration、build 主链。
- MinIO 使用 AGPLv3/商业双许可；本地开发可用，生产部署前必须复核，详见 `docs/dependency-licenses.md`。
