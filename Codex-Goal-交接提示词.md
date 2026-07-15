# Codex Goal 模式交接提示词

下面内容可以直接复制到新的 Codex 任务中使用。它的目标是启动 Goal 模式，从空工作区开始实现 OneCrew，而不是再次输出一份概念方案。

---

请进入 Codex Goal 模式，创建并持续执行下面这个 Goal。不要设置 token budget，除非我之后明确指定。

## Goal Objective

在 `/Users/baihe/Documents/飞书山海星辰` 中，从零实现并验证“星轨 OneCrew”：一个由飞书控制、API 驱动、只支持中文和英文、以 Open Design 作为设计系统输入、以 Remotion 作为唯一正式成片渲染器的 AI 短剧生产和宣传片系统。

系统必须完成：项目立项、剧本与分镜、设计系统编译、图片/视频/配音 API 适配、资产版本管理、生成任务、自动质检、中英双语本地化、Remotion 正片和宣传片渲染、飞书审批与四个动作、发布或发布包导出、实验数据回写的端到端闭环。

## 唯一设计基线

第一步必须完整读取：

`/Users/baihe/Documents/飞书山海星辰/OneCrew-完整系统方案.md`

把它视为产品、架构、数据契约、飞书表结构、API、实施阶段和 Definition of Done 的唯一设计基线。不要重新发散成新的方案，不要另建一套平行工作台、状态系统或渲染器。

如实现事实要求修改设计，先在该 Markdown 中记录新的架构决策、原因和影响，再修改代码。不得静默偏离。

## 启动动作

1. 创建 Goal，objective 使用上面的 Goal Objective。
2. 检查工作区、Git 状态、现有文件、可用运行时和本机依赖。
3. 如果仓库为空，初始化 TypeScript `pnpm` monorepo；如果已经存在代码，先审计并复用，不破坏用户已有改动。
4. 建立一份可持续更新的实施计划，阶段应与蓝图第 18 节保持一致；任意时刻只保留一个 `in_progress` 步骤。
5. 先实现可运行的纵向切片，再扩大覆盖；不要先堆大量空壳目录。
6. 每个阶段都运行相称的测试并保存可复现证据。
7. 只在 Definition of Done 全部满足且没有必需工作剩余时，将 Goal 标记为 complete。

## 已锁定的产品约束

- 飞书是唯一业务控制面板，不是文件服务器，也不存 API Key。
- 六张多维表格固定为：项目、分镜、资产、生成任务、质检、出海实验。
- 飞书卡片固定只有：通过、重生成、切换模型、转人工处理。
- Remotion 是唯一正式视频包装和 MP4 渲染器。
- Open Design 只负责导入/生成 `DESIGN.md`，并编译 `brand.tokens.json`、`motion.tokens.json`、`promo.spec.json` 和设计资产。
- 不把 Open Design/HyperFrames 作为第二套正式渲染链路。
- 只支持 `zh-CN` 和 `en-US`。
- 中文是内容母版，英文通过 Locale Pack 本地化并复用镜头资产。
- 每种外部能力只保留一个首选 Provider 和一个备用 Provider。
- 所有厂商调用都必须经过统一 Provider Adapter。
- 外部凭证缺失时允许 Mock E2E，但必须明确标为 `mock`；严禁把 Mock 描述成真实 API 已打通。
- FFmpeg 是媒体基础设施；MuseTalk 仅用于必要的对白近景，不扩张成主流程。
- 不新增 ComfyUI、Postiz、VideoLingo 或第二个通用工作流平台，除非有经过验证且无法由现有架构解决的硬性需求，并先更新架构决策。

## 推荐工程基线

使用以下基线，除非本机事实证明其中一项不可行：

- `pnpm` + Turborepo + TypeScript。
- Fastify REST/Webhook API。
- LangGraph.js 工作流。
- BullMQ + Redis 异步任务。
- PostgreSQL + Drizzle ORM。
- MinIO/S3 兼容对象存储。
- Remotion + `@remotion/renderer`。
- FFmpeg/ffprobe 技术质检。
- Vitest + Playwright。
- Docker Compose 本地基础设施。

推荐目录、核心数据契约、接口、Composition 和表字段全部按蓝图执行。

## 实施优先级

### P0：必须形成纵向闭环

1. 基础工程、数据库、Redis、对象存储和健康检查。
2. Project、Shot、Asset、Job、QC、Render 契约和状态机。
3. 飞书六表创建/校验脚本、Webhook、卡片回调和审计。
4. LangGraph 的人工暂停、持久化和恢复。
5. Open Design Adapter 与一个可运行的 `shanhai-demo` Design Pack。
6. Provider Gateway 与完整 Mock Providers。
7. 六个 Remotion Composition、Player 预览和 Render API。
8. FFmpeg QC、结构化 VLM QC 和失败重试。
9. 中文母版、英文 Locale Pack、TTS 时长适配。
10. 从项目创建到中英成片、宣传物料和飞书回写的 Mock E2E。

### P1：真实 API 验证

在凭证存在且授权允许的情况下，依次验证：

1. 一个真实 LLM/VLM Provider。
2. 一个真实图片 Provider。
3. 一个真实视频 Provider。
4. 一个真实 TTS Provider。
5. 飞书真实 Base 和卡片事件。

每个真实烟雾测试都要控制成本、记录输入输出和费用，并避免提交敏感信息。若凭证不存在，完成适配代码、环境校验、契约测试和配置文档，把它列入“未实测”，继续完成所有不依赖凭证的工作，不要停在方案层。

### P2：决赛交付

- 一套 8～12 镜头的固定演示项目。
- 60～90 秒中文和英文正片。
- 中英文 30 秒预告、15 秒竖版、6 秒广告。
- 静态海报和动态海报。
- QC 失败、重生成、切换模型、转人工各至少一条可演示路径。
- 出海实验表回写或本地可复现的等价集成测试。
- README、API、飞书配置、Provider 配置、运维、演示脚本和已知限制。

## 实现纪律

- 先检查官方仓库、许可证和真实 API 文档，再引入依赖。
- 不复制来源和许可证不明的素材或模板。
- 保持 Provider、领域、工作流、飞书和渲染模块的边界。
- 不在业务代码中硬编码厂商参数或密钥。
- 使用 Zod/JSON Schema 校验所有跨边界数据。
- 所有异步任务必须支持幂等、超时、重试、取消、成本和错误追踪。
- 所有飞书动作必须校验签名、操作者、版本和幂等键。
- 所有资产记录父版本、来源、Provider、模型、哈希和许可证。
- 每次 Remotion 渲染记录 Manifest 哈希、Design Pack 版本和代码版本。
- 不使用破坏性 Git 命令，不覆盖用户已有改动。
- 对实际失败给出证据和修复，不用未验证的成功描述替代。
- 长时间运行时持续提供简短进度，但不要用进度消息冒充完成。

## 验证要求

每个阶段至少执行适用的：

- lint
- typecheck
- unit test
- integration test
- build
- Docker Compose 健康检查
- API smoke test
- Remotion 至少一帧、短片段和完整示例渲染
- Mock E2E
- 有凭证时的真实 Provider 最小 smoke test

对 Remotion 输出应至少检查：文件存在、可解码、分辨率、帧率、时长、音轨、字幕安全区和 Design Pack 生效情况。必要时抽帧做视觉检查，不能只看进程退出码。

## 阻塞处理

- 缺少外部 API Key 不是停止整体实现的理由：使用 Mock Provider 完成闭环，同时保留真实 Adapter 和配置检查。
- 缺少飞书凭证时，完成 Base schema、创建脚本、Webhook 签名、fixture 和集成测试，并明确真实租户未验证。
- 某 Provider 不可用时，先验证备用 Provider；不要改变上层契约。
- 只有需要用户提供新权限、付费凭证或不可替代的外部决策时才请求用户介入。
- 不得因为工作量大、运行慢或测试耗时就提前标记 complete。

## 完成条件

完整逐项核对蓝图第 20 节 `Definition of Done`。最终交付必须明确列出：

1. 已实现并验证的真实能力。
2. 仅通过 Mock/Sandbox 验证的能力。
3. 因凭证或外部审核尚未实测的能力。
4. 所有构建、测试、渲染和 E2E 结果。
5. 关键本地文件和运行入口。
6. 演示步骤。
7. 剩余已知限制。

只有目标真正完成且没有必需工作剩余时，调用 Goal 完成操作；如果 Goal 有显式 token budget，在完成时同时报告最终 token 使用量。

现在开始：先完整读取系统蓝图、创建 Goal、检查工作区，然后执行阶段 0，并持续推进到系统满足 Definition of Done。

---

## 使用提醒

- 下一轮如果希望 Codex 直接连续执行，请整段复制上面的提示词，不要只复制 Goal Objective。
- 不要在本轮提前创建 Goal；真正开始编码时再在新任务中粘贴。
- 如果届时已经拿到飞书 App、模型 API 或对象存储凭证，只需在新任务中补一句“凭证已经放入本机安全环境，请先做只读配置检查，不要输出密钥”。
