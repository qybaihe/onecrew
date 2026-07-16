# 直接依赖与许可证记录

更新时间：2026-07-15。

本文件记录 OneCrew 当前实际引入的直接依赖和本地基础设施镜像。版本升级前必须重新核对官方仓库、运行时支持范围和许可证。

| 组件 | 固定版本 | 用途 | 许可证/依据 |
|---|---:|---|---|
| Node.js | `>=22.13` | 服务端运行时 | Node.js 项目许可证 |
| pnpm | `10.13.1` | workspace 包管理 | MIT |
| Turborepo | `2.10.5` | monorepo 任务编排 | MIT |
| TypeScript | `6.0.3` | 类型检查与编译 | Apache-2.0；暂不采用 7.x，因为当前 typescript-eslint peer range 为 `<6.1` |
| Fastify | `5.10.0` | REST 与健康检查 | MIT；[官方仓库](https://github.com/fastify/fastify) |
| Zod | `4.4.3` | 环境与边界校验 | MIT |
| pg | `8.22.0` | PostgreSQL 健康探测 | MIT |
| ioredis | `5.11.1` | Redis 健康探测，后续供 BullMQ 复用 | MIT |
| Drizzle ORM / Kit | `0.45.2` / `0.31.10` | PostgreSQL schema、repository 与 migration | Apache-2.0 / MIT；[官方仓库](https://github.com/drizzle-team/drizzle-orm) |
| AWS SDK for JavaScript S3 Client | `3.1087.0` | 只向受控 S3/MinIO bucket 写入 Provider 媒体 | Apache-2.0；[官方仓库](https://github.com/aws/aws-sdk-js-v3) |
| BullMQ | `5.80.3` | Redis 持久队列、重试、限流和可取消 Job | MIT；[官方文档](https://docs.bullmq.io/) |
| LangGraph.js / Core | `1.4.8` / `1.2.3` | 生产流程图、人工中断与恢复 | MIT；[官方仓库](https://github.com/langchain-ai/langgraphjs) |
| LangGraph PostgreSQL Checkpointer | `1.0.4` | 跨进程工作流 checkpoint | MIT；与 LangGraph.js 同仓库 |
| Open Design format | `DESIGN.md` 9-section contract（参考 Open Design 0.8+） | 设计输入格式，不引入其渲染器 | Open Design 框架 Apache-2.0；每个导入设计系统/素材仍需单独核对来源；[官方仓库](https://github.com/nexu-io/open-design) |
| Remotion / Renderer / Bundler / Player | `4.0.489` | 六 Composition、Player 和唯一服务端 MP4 渲染链路 | 定制 Remotion License：个人、非营利组织、评估用途及最多 3 名员工的营利组织可免费使用；其他商业实体需 Company License。上线前必须根据实际法律实体复核；[官方许可](https://www.remotion.dev/license) |
| FFmpeg / ffprobe | 本机 `7.1.1` | QC 解码、探测、黑屏/冻结/音频分析和 VLM 审片帧；不作为正式成片渲染器 | FFmpeg 本体可按 LGPL 使用，但当前 Homebrew 二进制编译参数包含 `--enable-gpl` 和 libx264，因此该实际组合按 GPLv2+ 处理；分发前必须按部署二进制重新核对；[官方法律说明](https://ffmpeg.org/legal.html) |
| React / React DOM | `19.2.7` | Remotion Composition、创作台和 Player 界面 | MIT；[官方仓库](https://github.com/facebook/react) |
| React Flow | `12.11.2` | 创作台分镜关系画布 | MIT；[官方仓库](https://github.com/xyflow/xyflow) |
| Vite / React Plugin | `8.1.4` / `6.0.3` | 创作台与审片页构建、本地开发服务器 | MIT；[官方仓库](https://github.com/vitejs/vite) |
| adm-zip | `0.5.16` | 读取并校验创作工程 ZIP；媒体写入仍经过受控 S3/MinIO 边界 | MIT；[官方仓库](https://github.com/cthackers/adm-zip) |
| fflate | `0.8.3` | 在内存中构建确定性发布 ZIP | MIT；[官方仓库](https://github.com/101arrowz/fflate) |
| Vitest | `4.1.10` | 单元与集成测试 | MIT；[官方仓库](https://github.com/vitest-dev/vitest) |
| ESLint / typescript-eslint | `10.7.0` / `8.64.0` | 静态检查 | MIT |
| PostgreSQL | `17.5-alpine` | 本地运行真相 | PostgreSQL License |
| Redis | `7.2.10-alpine` | 本地队列与缓存 | BSD-3-Clause 系列；固定 7.2 以避免后续版本许可变化被静默带入 |
| MinIO | `RELEASE.2025-06-13T11-33-47Z` | 本地 S3 兼容媒体真相 | AGPLv3 或商业许可；仅作为本地开发基础设施，产品化部署前必须进行合规复核；[官方容器文档](https://min.io/docs/minio/container/index.html) |

Docker Compose 的就绪顺序遵循官方 `healthcheck`/`service_healthy` 模型；当前阶段 API 由本机启动，因此 Compose 只负责三项基础设施。

`msgpackr-extract` 是传递依赖的可选原生加速器。pnpm 明确忽略其安装脚本，当前 BullMQ 集成测试在纯 JavaScript 回退路径通过，避免为非必要性能优化扩大供应链执行面。

`<Player acknowledgeRemotionLicense />` 只表示工程已显式阅读上述条款，不代表已自动获得任何需付费的 Company License。

创作工程兼容适配涉及的上游版权声明见仓库根目录 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。
