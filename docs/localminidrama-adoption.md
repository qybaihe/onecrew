# LocalMiniDrama 能力吸收账本

> 本文件是 OneCrew 的内部工程迁移账本。目标不是把上游仓库作为子系统运行，而是把其创作能力迁入 OneCrew 技术栈，并在生产编排、审计、质检、本地化和正式渲染方面达到更高完成度。

## 基线与许可证

- 上游：`xuanyustudio/LocalMiniDrama`
- 审计提交：`92c66dd75688d83aac3ccc31bb51378613122cbc`
- 上游版本：`1.2.8`，工程导出格式：`1.4`
- 许可证：MIT；实质移植的代码必须保留版权和许可声明。
- OneCrew 技术边界：TypeScript、Fastify、PostgreSQL/Drizzle、Redis/BullMQ、MinIO/S3、React、Remotion。

状态约定：`未开始`、`设计完成`、`实现中`、`已验证`、`不引入`。

## 产品能力矩阵

| 能力 | 上游实现 | OneCrew 目标实现 | 状态 |
|---|---|---|---|
| 项目管理 | Drama 列表、详情、软删除 | ProjectSpec + 创作项目 API + React 项目页 | 已验证 |
| 多剧集 | episodes、分集剧本和时长 | EpisodeSpec + PostgreSQL episodes | 已验证 |
| 故事生成 | 多集故事 JSON 生成 | Provider Gateway 的结构化故事规划 | 已验证 |
| 剧本编辑 | 分集 script_content 编辑 | React 剧本编辑器 + 版本/审计 | 已验证 |
| 角色提取与生成 | 角色描述、形象、多图、四视图 | CharacterSpec + 角色身份锚点 + 版本化资产 | 结构化设定/编辑/绑定已验证，资产生成实现中 |
| 角色阶段造型 | stages、服装和身份锚点 | CharacterSpec.stages + 连续性约束 | 已验证 |
| 场景提取与生成 | 场景库、时间、提示词、多图 | SceneSpec + 项目/全局素材检索 | 结构化设定/编辑/绑定已验证，资产生成实现中 |
| 道具提取与生成 | 道具库、提示词、多图 | PropSpec + 镜头关系 | 结构化设定/编辑/绑定已验证，资产生成未开始 |
| 全局素材库 | 角色/场景/道具复用与去重 | PostgreSQL 检索 + S3 资产版本复用 | 未开始 |
| 结构化分镜 | 景别、角度、运镜、灯光、景深 | 扩展 ShotSpec 与 JSON Schema | 已验证 |
| 经典/全能模式 | classic/universal segment | ShotSpec.creationMode + Provider 请求构建 | 实现中 |
| 首尾帧提示词 | frame_prompts | FramePromptSpec + 首尾帧资产绑定 | 已验证 |
| 分镜图片历史 | image_generations 完整历史 | AssetRecord 父版本链 + 镜头绑定 | 已验证 |
| 视频生成历史 | video_generations | JobRecord + AssetRecord 版本链 | 已验证 |
| 连续性快照 | continuity_snapshot | ContinuitySnapshot + QC 检查 | 生成请求与 QC 已验证 |
| 尾帧衔接 | 上一镜尾帧作为下一镜参考 | ShotSpec 首尾帧关系 + Provider reference assets | 生成请求已验证 |
| 四宫格/多参考图 | sharp 切图、`@图片N` | Media 预处理 + Provider 多参考图契约 | 未开始 |
| 图片/视频提示词编辑 | 分镜级编辑 | React 分镜编辑器 + 乐观版本 + 审计 | 已验证 |
| 分镜编辑后重建 | 单镜重新生成 | 编辑结果提交 Provider Job 并保留父资产 | 已验证 |
| TTS 与旁白 | 对白、旁白、本地音频 | 中英 Locale Pack + TTS Job + 旁白字段 | 实现中 |
| 批量生成 | 缺失项跳过、并发、停止和重试 | PostgreSQL 持久批次 + BullMQ 幂等子 Job + 取消/重试/成本 | 已验证 |
| 工作流分组 | 框选分镜、组合步骤、整组重跑 | Creative Workflow Group + LangGraph/BullMQ | 未开始 |
| 列表编辑视图 | FilmCreate | React 创作工作台列表模式 | 已验证 |
| 画布视图 | Vue Flow DramaCanvas | React Flow 创作画布；不含审批动作 | 已验证 |
| 工程 ZIP 导入 | project.json + media，格式 1.4 | LocalMiniDrama ZIP Adapter + MinIO 导入 | 已验证 |
| 工程 ZIP 导出 | 全量数据和媒体打包 | OneCrew Creative Bundle + 兼容导出 + 媒体 SHA-256 | 已验证 |
| AI 配置 | 本地页面和 SQLite 明文配置 | 不复制 UI；环境/Secret Manager + Provider Adapter | 不引入 |
| 多 Provider | 通义、火山、可灵、Gemini、Vidu 等 | 每能力主备两条路由，按需求移植适配 | 实现中 |
| 本地 SQLite | better-sqlite3 | PostgreSQL + Drizzle，保持审计和并发能力 | 不引入 |
| Electron 桌面壳 | Windows EXE | 先交付 Web/Docker；桌面壳不是核心依赖 | 不引入 |
| FFmpeg 视频拼接 | 镜头顺序合并 | 仅媒体预处理/QC；正式渲染仍为 Remotion | 不引入 |
| 审批工作台 | 上游没有完整企业审批 | 飞书卡片四动作，不新建网页审批台 | 已验证 |
| 中英本地化 | 非核心能力 | Locale Pack、TTS 时长适配和英文成片 | 已验证 |
| 自动 QC | 基础生成状态 | FFmpeg 技术 QC + VLM 语义 QC + 人工门 | 已验证 |
| 宣传物料 | 单集视频为主 | 预告、竖版、贴片、动态海报、静态海报 | 已验证 |

## 第一条纵向切片验收条件

1. `CreativeProjectBundle`、`EpisodeSpec`、`CharacterSpec`、`SceneSpec`、`PropSpec`、`FramePromptSpec` 均有 Zod 契约和生成的 JSON Schema。
2. `ShotSpec` 能无损表达上游结构化分镜、首尾帧和连续性字段，同时兼容已有 OneCrew 数据。
3. PostgreSQL 能持久化剧集、创作实体和帧提示词，并保持项目/镜头级联关系、唯一约束与版本字段。
4. LocalMiniDrama `project.json` 1.4 能转为 OneCrew Creative Bundle；未知字段不会污染核心契约，错误输入有明确验证错误。
5. 导入 API 支持 JSON 和 ZIP，媒体进入 S3/MinIO，导入记录来源提交、格式版本、哈希和许可证。
6. 单元测试覆盖字段映射、跨数组索引关系、场景去重、首尾帧绑定和恶意 ZIP 路径拒绝。
7. 集成测试证明导入事务可落库并可完整读回。

## 第二条纵向切片：编辑与可移植工程

1. 项目详情同时返回项目、剧集、创作实体、分镜和帧提示词的当前版本。
2. 剧集、角色/场景/道具和分镜 PATCH 使用乐观锁；过期请求返回 409，成功请求与操作人写入 `audit_logs`。
3. React 界面可编辑剧本、分镜动作、镜头、对白/旁白、图像/视频/负向提示词与连续性备注，也可编辑角色/场景/道具并绑定项目资产；所有编辑器明确显示版本和保存状态。
4. OneCrew 原生 ZIP 包含完整 `CreativeProjectBundle`、资产记录与受控媒体；每个媒体都有独立 SHA-256。
5. 原生 ZIP 可重新导入，并拒绝路径穿越、重复路径、未声明文件、缺失文件、超限解压与哈希篡改。
6. 兼容导出能往返读回结构化镜头、图片历史、首尾帧提示词和媒体。
7. 真实浏览器验证剧本/分镜/素材设定保存、版本资产绑定、版本增长、409 冲突和含 3 个 MinIO 媒体的工程下载；桌面与 `390 × 844` 布局通过，干净会话控制台无错误。

## 第三条纵向切片：连续性单镜生成

1. 生成 API 必须使用已持久化的分镜版本；过期版本返回 409，缺失幂等键失败关闭。
2. 图片请求带入上一镜尾帧、本镜首帧、分镜参考、相关角色/场景/道具参考和结构化连续性约束。
3. 视频请求优先使用该分镜最新图片版本，并在有显式尾帧时同时提交尾帧。
4. Provider 成功输出自动写入项目/分镜资产；重生成递增版本并使用 `parentAssetId` 连接前一版。
5. React 创作台只允许对已保存分镜发起生成，跟踪异步 Job，区分 Mock/Real，并在成功后刷新资产库。
6. 单元测试覆盖参考顺序、尺寸、连续性提示词、最新图片版本、尾帧、时长和路由；API 测试覆盖成功提交与过期版本。
7. 本地 Worker 实跑证明图片和视频 Job 成功、视频请求引用新生成的图片版本，桌面和 `390 × 844` 界面无横向溢出、控制台无错误。

## 第四条纵向切片：持久化批量生成

1. 批次状态和每个分镜子项持久化到 PostgreSQL，页面刷新后可读回项目最新批次。
2. 批次提交验证项目归属和每镜 `expectedVersion`；过期请求整批拒绝，不会混用新旧分镜。
3. `missingOnly` 跳过已有对应资产的镜头，1～10 的提交并发度可控，单项失败不会丢失其他项进度。
4. 每个子项复用 Provider Job 幂等、预算闸门、路由、成本和资产版本链，批次不建第二套任务运行时。
5. 停止只取消未完成项；重试只替换提交失败、执行失败或已取消项，已成功/已跳过项不重跑。
6. 实跑验证了“Worker 停止时提交 → 取消排队 Job → 重试新 Job → 恢复 Worker → 批次成功”，并证明输出资产从 v2 升为 v3。
7. React 创作台可补齐缺失图片/视频、刷新、停止和重试；桌面和 `390 × 844` 布局无溢出，控制台无错误。

## 第五条纵向切片：连续性 QC 闭环

1. 单镜 QC API 使用已持久化的分镜版本，过期版本返回 409，缺失幂等键失败关闭。
2. 请求构建器从角色身份/外观/服装、场景、道具、光照、镜头轴线、上一镜尾帧和连续性备注自动生成检查项；视频额外检查时序稳定和对白表演。
3. 只接受属于同一项目/镜头、已写入受控 S3/MinIO 的图片或视频；Mock 占位 URI 不被冒充为可检查媒体。
4. 图片和视频使用独立技术期望；PNG/JPEG/WebP 不套用 H.264/YUV420P 默认规则，视频仍检查 codec、pixel format 与镜头时长。
5. 复用现有 `QcOrchestrator`、BullMQ Worker、FFmpeg/ffprobe、VLM、QC Record 和飞书四动作人工闸门，不引入第二套 QC 或审批运行时。
6. 实跑验证了三条分支：损坏图片明确失败；可解码但技术规则不符时生成持久化人工闸门；修正媒体类型规则后技术检查全绿、Mock VLM 决策 `pass` 并持久化 QC Record。
7. React 创作台可对当前最新的受控媒体运行连续性 QC，并显示实际资产类型、版本和决策；桌面和 `390 × 844` 无横向溢出，干净会话控制台无错误或警告。

## 第六条纵向切片：结构化故事规划

1. 故事规划使用独立 `CreativeStoryPlan` JSON Schema，结构化返回指定数量的剧集、剧情/剧本、角色、场景与道具设定。
2. 请求携带当前项目和已有内容上下文，复用 Provider Gateway、Primary/Fallback 路由、幂等键、预算闸门与 BullMQ Worker，不增加第二套生成任务系统。
3. 生成结果先预览，不在 Provider Job 完成时自动修改工程；仅显式应用才进入数据库。
4. 应用时校验项目版本，在单个 PostgreSQL 事务中追加剧集与新设定、递增项目版本并写审计；不覆盖已有剧集，同类同名实体会复用。
5. 剧集和新实体使用由 Job 与内容派生的确定性 ID；相同 Job 重复应用回放原结果，不同 Job 使用过期版本返回 409。
6. 本地 Mock Worker 实跑生成 2 集、1 角色、1 场景与 1 道具；应用后项目从 v1 升到 v2，总集数从 1 变为 3。
7. React 创作台完整展示创作简报、集数、Mock/Real、剧集卡片和实体摘要，并提供单独的写入动作；桌面和 `390 × 844` 无横向溢出，控制台无错误或警告。

## 明确不复制的核心负担

- 不运行第二套后端、数据库、队列或桌面进程。
- 不增加网页审批、网页放行或网页模型切换入口。
- 不在数据库业务字段、飞书或日志中保存 Provider Key。
- 不允许导入器覆盖既有项目；冲突必须使用确定性新 ID 或显式拒绝。
- 不允许 ZIP 路径穿越、超大解压、符号链接或未声明媒体类型。
