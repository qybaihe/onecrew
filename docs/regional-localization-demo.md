# 出海地域本土化演示（Regional Localization Demo）

> 版本：0.1.0 · 新增 `RegionalCulturePlanner` agent · Mock 模式端到端跑通

## 1. 背景与目标

OneCrew 之前的"本地化"只做**语言翻译**（`LocalizationOrchestrator` 把中文剧本译成英文再配音），并不触碰**文化层面**的题材、精神面貌与视觉符号。但当目标是把短剧卖到美国、俄罗斯、英国等海外市场时，"翻译"是远远不够的——真正的出海爆款（ReelShort 上的 *Claimed by the Dragon*、*Fated to the Alpha* 等）从一开始就是**为目标市场写戏**，而不是把中文剧本翻译成英文。

本演示为 OneCrew 增加了一个新 agent：**`RegionalCulturePlanner`（地域文化包规划器）**。它在故事规划**之前**介入，把一份中文项目简报（brief）+ 一个目标地区（`america` / `russia` / `uk`）转化为一份**地域文化包**（RegionalCulturePack），包含：

- 地区受众画像（audienceProfile）
- 偏好题材（themes）
- 核心精神面貌（spiritValues）
- 文化禁忌（taboos）
- 钩子结构（hookStructures）
- 视觉符号（visualMotifs）
- 真实出海爆款参考案例（referenceCases）
- **彻底重写过的本土化创作简报**（localizedBrief）

这份文化包随后被注入到现有的 `CreativeStoryPlanner`，让 LLM 在生成剧本、角色、场景、道具时严格按目标地区的口味创作——从第一稿开始就是本土化的，而不是"先中文再翻"。

## 2. 成功案例拆解：*Claimed by the Dragon*

*Claimed by the Dragon*（ReelShort，2026）是验证"本土化 ≠ 翻译"的最直接样本。它讲述一个被献祭给龙王的人类少女 Alina，发现自己竟是龙王 Asha 的"命定伴侣"（fated mate），只有她能在满月前解开龙族诅咒。它的成功要素：

| 维度 | 内容 |
| --- | --- |
| **题材** | 龙族诅咒 + fated mate + 契约恋爱 |
| **核心受众** | 美国中年女性与千禧一代女性（ReelShort 公开数据） |
| **精神面貌** | 被低估的女主逆袭 + 禁忌之恋 + 女性自我主张 |
| **钩子结构** | 开场 5 秒献祭；每 60 秒一个反转；每集结尾命运级 cliffhanger |
| **视觉符号** | 月光、龙穴、中世纪城堡、满月、誓约戒指、女主红裙 |
| **平台形态** | 竖屏 1-3 分钟单集，ReelShort / DramaBox 付费解锁 |

把它和典型中式短剧对比：中式修仙剧的"渡劫""师徒""家族联姻""婆媳冲突"在美国受众中几乎没有共鸣，但"狼人 / 龙族 / 命定伴侣"是美国女频的**母语级**题材。这就是为什么"直接把中文剧本译成英文"几乎不可能出海——**题材本身就是错配的**。

本演示的 `RegionalCulturePlanner` 在 `region=america` 时，会把 *Claimed by the Dragon* 作为参考案例显式写进 LLM 的提示词，让文化包产出与之对齐的题材、钩子与视觉符号。

## 3. Agent 设计

### 3.1 插入点：故事规划**之前**

```
用户 brief + region
        │
        ▼
┌──────────────────────┐
│ RegionalCulturePlanner │  ← 新 agent，本演示新增
└──────────────────────┘
        │ RegionalCulturePack (Job artifact)
        ▼
┌──────────────────────┐
│ CreativeStoryPlanner  │  ← 现有 agent，本次扩展让它接受文化包
└──────────────────────┘
        │ CreativeStoryPlan (含 episodes/characters/scenes/props)
        ▼
   后续图片 / 视频 / TTS / 渲染 / QC 流水线（不变）
```

为什么放在故事规划之前而不是之后？因为"翻拍改写"会让中文底子渗进英文产品里——美国受众能一眼看出"这是个翻译过来的中国故事"。只有从**剧本源头**就按目标市场写戏，才能产出真正意义上的本土化内容。

### 3.2 输入 / 输出契约

**请求**（`RegionalCulturePackRequest`）：
```json
{
  "region": "america",
  "brief": "为现有「山海星辰」项目生成面向美国市场的本土化短剧文化包。",
  "route": "primary",
  "generationNonce": 1
}
```

**响应**（`RegionalCulturePack`）：见 `outputs/regional-demo-america-*/culture-pack.json`，包含上述 8 个字段。

**Schema 定义**：`packages/contracts/src/index.ts` 中的 `regionalCulturePackSchema` 与 `regionalCulturePackRequestSchema`。

### 3.3 关键实现文件

| 文件 | 职责 |
| --- | --- |
| `packages/contracts/src/index.ts` | 新增 `regionalCulturePackSchema`、`regionalCulturePackRequestSchema`、`'regional_culture'` LLM operation |
| `packages/creative/src/regional-culture.ts` | `buildRegionalCultureRequest`：组装 LLM 提示词，按 region 注入地域指南 |
| `packages/workflows/src/regional-culture-planner.ts` | `RegionalCulturePlanner.submit` / `.preview`：把 LLM Job 包装成领域对象 |
| `packages/workflows/src/creative-story-planner.ts` | `CreativeStoryPlanner.submit` 接受可选 `regionalCulturePackJobId`，拉取文化包并注入到剧本生成 prompt |
| `packages/creative/src/story-plan.ts` | `buildCreativeStoryPlanRequest` 在有 `culturePack` 时注入 8 行地域指令，并用 `localizedBrief` 替换原 brief |
| `apps/api/src/creative-routes.ts` | `POST/GET /v1/creative/projects/:id/regional-culture-packs` 端点 |
| `apps/api/src/server.ts` | 实例化 `RegionalCulturePlanner` 并注入路由 |
| `packages/providers/src/mock.ts` | Mock LLM 在 `OneCrewRegionalCulturePack` schema 下返回结构化地域文化包 |
| `scripts/demo-regional-localization.mjs` | 端到端 demo 驱动脚本 |

### 3.4 文化包是 Job artifact，不是持久化实体

文化包**不会**写入 `creative_entities` 表，而是作为 LLM Job 的结构化输出挂在 Job 上，通过 `regionalCulturePackJobId` 被 `CreativeStoryPlanner` 引用。这样做有两个好处：

1. **不污染实体仓库**：文化包是一次性研究产物，不需要版本链、参考图、血缘追踪
2. **可审计**：每份文化包都对应一个不可变的 Job 记录，包含完整的 prompt、outputSchema、provider、cost 信息

## 4. 三个地区的文化包差异

LLM 在 `buildRegionalCultureRequest` 中按 region 注入不同的地域指南。下面是三个地区的关键差异总结：

| 维度 | america（美国） | russia（俄罗斯） | uk（英国） |
| --- | --- | --- | --- |
| **核心受众** | ReelShort/DramaBox 中年女性 | 本土强情节受众 | 英剧/时代剧受众 |
| **偏好题材** | 龙族/狼人奇幻浪漫、fated mate、billionaire、契约婚姻、复仇逆袭 | 二战史诗、寡头权力、东正教宿命、民间童话、硬汉复仇 | 摄政浪漫、贵族秘辛、阶级跨越、侦探悬疑、职场智斗 |
| **精神面貌** | 命运翻转、女主逆袭、禁忌之恋、女性自我主张 | 忍受与救赎、家庭高于个人、沉默担当、命运不可逃避 | 克制的激情、尊严体面、智慧胜蛮力、阶级博弈 |
| **钩子结构** | 开场 5s 献祭 + 每 60s 反转 + cliffhanger 结尾 | 开场巨大牺牲 + 家族对立推进 + 悲剧性反转 | 开场一句机智对白 + 身份错位推进 + 体面反转 |
| **视觉符号** | 月光、龙穴、豪宅、满月、誓约戒指、红裙 | 雪原、洋葱顶教堂、苏联建筑、军大衣、圣像 | 乔治王朝庄园、雨夜伦敦、茶会、手写书信、定制西装 |
| **文化禁忌** | 避免中式婆媳、修仙渡劫、东亚家族伦理 | 避免 LGBTQ+ 主线、对东正教不敬 | 避免过度裸露、美式大喊大叫、不尊重王室 |
| **参考案例** | *Claimed by the Dragon*（ReelShort 2026） | 本土历史剧（牺牲-救赎弧线） | *Bridgerton* / *Downton Abbey* |

完整的地域指南文本见 `packages/creative/src/regional-culture.ts` 中的 `REGION_GUIDES` 常量。

## 5. 一步步使用

### 5.1 准备环境

```bash
# 安装依赖
pnpm install

# 启动 PostgreSQL / Redis / MinIO
pnpm infra:up

# 生成契约 + 构建
pnpm contracts:generate
pnpm build

# 数据库 migrate + seed + design pack
pnpm db:migrate
pnpm db:seed
pnpm design:compile
```

### 5.2 以 Mock 模式启动 API 与 Worker

打开两个终端：

```bash
# 终端 1：API（Mock 模式）
PROVIDER_MODE=mock pnpm start:api

# 终端 2：Worker（Mock 模式 + 限制 Final 渲染分辨率以节省内存）
PROVIDER_MODE=mock REMOTION_FINAL_MAX_DIMENSION=640 pnpm start:worker
```

确认就绪：

```bash
curl http://127.0.0.1:3000/readyz
# 期望 {"status":"ready","components":{"postgres":...,"redis":...,"objectStorage":...}}
```

### 5.3 一键运行 demo

```bash
node scripts/demo-regional-localization.mjs --region america
```

可选参数：

- `--region america|russia|uk`（默认 `america`）
- `--api http://127.0.0.1:3000`
- `--project <projectId>`（不提供则现场通过 LocalMiniDrama import 创建一个）
- `--output <dir>`（默认 `outputs/regional-demo-<region>-<ts>/`）
- `--dry-run` 只打印执行计划，不发起 HTTP 调用

### 5.4 demo 会做什么

| 步骤 | 调用 | 说明 |
| --- | --- | --- |
| 1. `waitForReady` | `GET /readyz` | 确认 API + Postgres + Redis + MinIO 全部就绪 |
| 2. `ensureProject` | `POST /v1/creative/imports/local-mini-drama/json` | 导入一个含 10 个分镜的最小项目；同时通过 SQL 把 `budgetLimitCny` 提升到 1000，避免预算人工闸门（仅 demo） |
| 3. `regionalCulturePack` | `POST /v1/creative/projects/:id/regional-culture-packs` | **新 agent 出场**：LLM 产出地域文化包 |
| 4. `storyPlan` | `POST /v1/creative/projects/:id/story-plans`（带 `regionalCulturePackJobId`） | LLM 在文化包约束下生成 1 集剧本+角色+场景+道具 |
| 5. `applyStoryPlan` | `POST .../story-plans/:jobId/apply` | 把规划原子追加到项目（乐观版本 + 审计） |
| 6. `generateImages` | `POST /v1/images/generate` × 10 | 10 张分镜参考图（Mock） |
| 7. `generateVideos` | `POST /v1/shots/generate` × 10 | 10 段 6 秒视频（Mock） |
| 8. `synthesizeZhTts` | `POST /v1/audio/synthesize` × 10 | 每镜 1 行中文配音（Mock，产生真实 WAV） |
| 9. `renderPipelineSmoke` | `POST /v1/renders` | 用 `PipelineSmoke` 组合渲染 ~10s MP4 |
| 10. `runQc` | `POST /v1/qc/run` | FFmpeg 技术检查 + Mock VLM 语义复核 |

预期 6–10 分钟跑完（取决于本机 Remotion 渲染速度）。

### 5.5 预期产物

```
outputs/regional-demo-america-<ts>/
├── culture-pack.json        # 地域文化包（新 agent 产出）
├── story-plan.json          # 注入了文化包后生成的剧本规划
├── render-manifest.json     # Remotion PipelineSmoke manifest
├── pipeline-smoke.mp4       # ~10s H.264/AAC 30fps 视频
├── qc-run.json              # QC 完整报告（技术 + 语义）
└── process-proof.json       # 全流程 Job/Asset/Render/QC 证据汇总
```

验证视频：

```bash
ffprobe -v error -show_entries stream=codec_name,width,height:format=duration \
  -of json outputs/regional-demo-america-*/pipeline-smoke.mp4
# 期望：video=h264, audio=aac, duration∈[8,12]秒
```

## 6. 本土化理由：为什么"翻译"不够

演示中可以清楚看到：即便只跑 `region=america` 一次，新 agent 产出的文化包已经系统性地区别于中文原作：

- **题材**从"山海星辰"这种中式宇宙浪漫，被替换为"龙族 + 命定伴侣 + 契约恋爱"
- **精神面貌**从"守星人的责任与浪漫"被替换为"被低估的女主逆袭 + 禁忌之恋"
- **视觉符号**从"青绿与琥珀色星光"被替换为"月光 + 龙穴 + 满月 + 红裙"
- **钩子结构**从中式慢热被替换为"开场 5s 献祭 + 每 60s 反转 + cliffhanger 结尾"

如果走"先中文剧本→英文翻译"的老路，这些**结构性差异**全部会丢失——翻译只能替换文字，不能替换题材、精神面貌、节奏和视觉符号。这就是 *Claimed by the Dragon* 等爆款和"翻译出海"作品之间的本质差距。

## 7. 证据与产物

本演示在 2026-07-19 完成一次完整 Mock 模式跑通：

- **项目**：`prj_regional_america_2026-07-190730`（现场通过 LocalMiniDrama import 创建）
- **地域文化包 Job**：`job_mrrh0zkg_*`（输出见 `outputs/regional-demo-america-2026-07-190730/culture-pack.json`）
- **剧本规划 Job**：注入了上述文化包，产出 1 集剧本 + 角色"云岚" + 场景"星门回廊" + 道具"星图碎片"
- **媒体生成**：10 图 + 10 视频 + 10 中文 TTS 全部成功（Mock）
- **渲染**：`PipelineSmoke` 组合，1 个 shot 循环 10s，H.264/AAC/30fps，640×360（受 `REMOTION_FINAL_MAX_DIMENSION=640` 限制）
- **QC**：技术检查全过 + Mock VLM `pass`
- **完整证据**：`outputs/regional-demo-america-2026-07-190730/process-proof.json`

## 8. 诚实边界

- 本演示全程在 `PROVIDER_MODE=mock` 下运行，LLM 文化包和剧本规划由 Mock adapter 返回结构化预置结果，**不代表真实 LLM 输出质量**；接入真实 LLM 时文化包的内容深度和准确性取决于底层模型。
- 文化包的地域指南文本（`REGION_GUIDES`）目前由仓库维护者手工编写并嵌入 prompt，**不是从 ReelShort / DramaBox 实时抓取**；真实生产环境需要定期用最新爆款数据更新这些指南。
- 本演示**只跑了 `america`**；`russia` 和 `uk` 在代码层面参数化可用，但**没有端到端证据**。
- 渲染视频使用 `REMOTION_FINAL_MAX_DIMENSION=640` 缩放以控制内存；正式交付请留空该变量以获得 1920×1080。
- 本演示**跳过**了英文翻译、宣传片渲染、发布 ZIP 和飞书写回——这些能力在 `pnpm demo:mock-e2e` 中另有覆盖，不受影响。
- 新项目通过 LocalMiniDrama import 创建后，demo 通过 SQL 把 `budgetLimitCny` 从默认的 0 提升到 1000，绕过了预算人工闸门；这是 demo 便捷性妥协，不是产品变更。生产环境应通过 `PATCH` 项目接口或 UI 设置预算。

## 9. 后续工作（不在本演示范围）

- 接入真实 LLM 后做 A/B 评估：同一 brief 下，加文化包 vs 不加文化包，产出剧本的本土化质量差异
- 把 `REGION_GUIDES` 外置成可配置的文化包源（飞书 Base / 配置中心），便于运营同学维护
- 在 `production-workflow.ts` 的 LangGraph 中把 `regional_culture_planning` 加成正式 stage，与现有 `story_plan` 串联
- 支持 `russia` 和 `uk` 的端到端 Mock 跑通
- 把文化包产出接到 `apps/preview` 创作台，让编剧在 UI 上直接选 region
