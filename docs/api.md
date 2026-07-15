# OneCrew API

本页只列当前已实现并测试的阶段 0～8 与创作领域 API，不以占位成功响应冒充完成。

本地基址：`http://127.0.0.1:3000`。

## 健康与就绪

```text
GET /healthz
GET /readyz
```

`healthz` 只表示进程存活。`readyz` 实际探测 PostgreSQL、Redis 和 S3/MinIO；任一依赖不可用返回 503。

## 创作项目与工程导入

```text
GET  /v1/creative/projects
GET  /v1/creative/projects/:projectId
POST /v1/creative/imports/local-mini-drama/json
POST /v1/creative/imports/local-mini-drama/zip
POST /v1/creative/imports/onecrew/zip
PATCH /v1/creative/episodes/:episodeId
PATCH /v1/creative/entities/:entityId
PATCH /v1/creative/shots/:shotId
POST  /v1/creative/shots/:shotId/generations
POST  /v1/creative/projects/:projectId/generation-batches
GET   /v1/creative/projects/:projectId/generation-batches/latest
GET   /v1/creative/generation-batches/:batchId
POST  /v1/creative/generation-batches/:batchId/cancel
POST  /v1/creative/generation-batches/:batchId/retry
GET  /v1/creative/projects/:projectId/exports/onecrew.zip
GET  /v1/creative/projects/:projectId/exports/compatible.zip
```

列表接口返回已包含剧集的创作项目。项目详情返回完整 `CreativeProjectBundle`、该项目的版本化 `AssetRecord` 和 `versions`。`versions` 包含项目、剧集、角色/场景/道具、分镜与帧提示词当前版本，供界面执行乐观并发控制。

JSON 导入用于迁移结构化工程数据：

```bash
curl --request POST http://127.0.0.1:3000/v1/creative/imports/local-mini-drama/json \
  --header 'Content-Type: application/json' \
  --data '{
    "projectId": "prj_import_demo",
    "ownerOpenId": "ou_local_operator",
    "nameEn": "Imported Demo",
    "project": { "format_version": "1.4", "drama": { "title": "导入示例" } }
  }'
```

ZIP 导入接收 `application/zip` 原始请求体，工程选项通过 query 参数传入：

```bash
curl --request POST \
  'http://127.0.0.1:3000/v1/creative/imports/local-mini-drama/zip?projectId=prj_zip_demo&ownerOpenId=ou_local_operator' \
  --header 'Content-Type: application/zip' \
  --data-binary '@project.zip'
```

ZIP 根目录必须包含 `project.json`。导入器限制条目数量、单文件大小和总解压大小，拒绝绝对路径、路径穿越与缺失的声明媒体；校验通过后，业务数据在一个 PostgreSQL 事务中写入，媒体进入受控 S3/MinIO，并生成含来源、哈希、许可证和绑定关系的 `AssetRecord`。项目 ID 冲突返回 409，不会覆盖已有项目。

OneCrew 原生工程导入同样接收 `application/zip` 原始请求体：

```bash
curl --request POST \
  http://127.0.0.1:3000/v1/creative/imports/onecrew/zip \
  --header 'Content-Type: application/zip' \
  --data-binary '@my-project.onecrew.zip'
```

原生包必须包含 `onecrew-project.json`。导入会校验声明文件、唯一路径、解压限额和每个媒体的 SHA-256，并拒绝任何未声明文件。原生导入保留工程 ID，如数据库中已存在同 ID 项目则返回 409。

### 编辑剧集、素材设定和分镜

三个 PATCH 端点都要求当前 `expectedVersion`、每次操作唯一的 `editId` 和 `actorOpenId`。剧集例子：

```bash
curl --request PATCH \
  http://127.0.0.1:3000/v1/creative/episodes/episode_demo_01 \
  --header 'Content-Type: application/json' \
  --data '{
    "expectedVersion": 1,
    "editId": "studio_edit_episode_001",
    "actorOpenId": "ou_local_studio",
    "patch": {
      "title": "第一集：星门开启",
      "scriptContent": "角色跨过星门。",
      "durationSec": 36
    }
  }'
```

角色、场景和道具共用素材设定端点。补丁会按实体的实际类型校验，并可绑定当前项目的版本化资产。场景例子：

```bash
curl --request PATCH \
  http://127.0.0.1:3000/v1/creative/entities/scene_demo_01 \
  --header 'Content-Type: application/json' \
  --data '{
    "expectedVersion": 1,
    "editId": "studio_edit_scene_001",
    "actorOpenId": "ou_local_studio",
    "patch": {
      "name": "远古星门",
      "description": "悬浮在星海边界的巨型建筑。",
      "location": "星海边界",
      "timeOfDay": "深夜",
      "atmosphere": "静谧、宏大",
      "referenceAssetIds": ["asset_scene_reference_01"]
    }
  }'
```

分镜例子：

```bash
curl --request PATCH \
  http://127.0.0.1:3000/v1/creative/shots/shot_demo_001 \
  --header 'Content-Type: application/json' \
  --data '{
    "expectedVersion": 1,
    "editId": "studio_edit_shot_001",
    "actorOpenId": "ou_local_studio",
    "patch": {
      "action": "角色穿过星门，光线沿披风边缘流动。",
      "camera": "低机位缓慢跟拍",
      "continuity": {
        "characters": {},
        "notes": "保持角色朝向和银白边缘光。"
      }
    }
  }'
```

成功响应返回新记录和增加后的 `version`，并在同一数据库事务写入审计日志。过期版本返回 HTTP 409 和当前实际版本信息。

### 从已保存分镜生成图片或视频

该端点使用数据库中的当前分镜，不接受客户端私自传入的提示词。请先保存分镜，再提交生成：

```bash
curl --request POST \
  http://127.0.0.1:3000/v1/creative/shots/shot_demo_001/generations \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: studio-shot-demo-001-image-1' \
  --data '{
    "expectedVersion": 1,
    "kind": "image",
    "route": "primary",
    "generationNonce": 1
  }'
```

`kind` 支持 `image` 和 `video`。图片请求会按顺序收集上一镜尾帧、本镜首帧、分镜参考和角色/场景/道具参考，并附加连续性约束；视频请求优先使用本镜最新图片版本作为参考首帧。成功输出由 Worker 写入 `AssetRecord`，重新生成会增加版本并使用 `parentAssetId` 保留血缘。

提交成功返回 HTTP 202 和 `status_url`。`expectedVersion` 过期返回 409，缺少幂等键返回 400，Provider 未配置返回 503。Mock 响应会明确标记 `mode: "mock"`；请通过 `GET /v1/jobs/:jobId` 跟踪最终状态。

### 对已保存分镜运行连续性 QC

该入口不接受客户端自定义检查词，而是从数据库中的分镜、角色、场景、道具和连续性快照生成可审计检查项，再复用统一 QC Orchestrator：

```bash
curl --request POST \
  http://127.0.0.1:3000/v1/creative/shots/shot_demo_001/continuity-qc \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: shot-demo-001-continuity-qc-1' \
  --data '{
    "expectedVersion": 1,
    "assetId": "asset_demo_001_v2",
    "route": "primary",
    "qualityAttempt": 1,
    "autoRemediate": true
  }'
```

`assetId` 可省略；服务会选择该镜头最新、未归档且已经写入受控 S3/MinIO 的图片或视频。显式资产必须属于同一项目和镜头。`mock://` 等占位 URI 会返回 400，不会伪装为完成了媒体检查。

服务自动检查画面动作、镜头语言、角色身份/外观/服装、场景与光照、道具关系、上一镜尾帧衔接、镜头轴线和连续性备注；视频额外检查闪烁、形变、身份/背景跳变和对白表演。图片与视频使用各自的 codec、pixel format 和时长技术期望，避免用 H.264 规则误判 PNG/JPEG。

响应为 HTTP 202，包含 `qc_run_id`、实际 `source_asset_id`、资产版本和媒体类型。后续使用 `GET /v1/qc/runs/:qcRunId` 读取技术报告、VLM 决策、修复结果或人工闸门。自动修复和飞书复核仍由统一 QC 流程处理，创作台没有第二套审批入口。

### 批量补齐、停止与重试

批次不是浏览器中的临时循环。批次本身持久化到 PostgreSQL，每个分镜仍是独立的 Provider Job，因此保留幂等、预算闸门、取消、成本和资产版本链：

```bash
curl --request POST \
  http://127.0.0.1:3000/v1/creative/projects/prj_demo/generation-batches \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: prj-demo-missing-images-1' \
  --data '{
    "kind": "image",
    "expectedVersions": {
      "shot_demo_001": 1,
      "shot_demo_002": 1
    },
    "missingOnly": true,
    "route": "primary",
    "generationNonce": 1,
    "concurrency": 3
  }'
```

`shotIds` 可选；省略时处理项目全部分镜。`missingOnly: true` 会把已有对应图片/视频资产的分镜标记为 `skipped`。所有待处理分镜都必须在 `expectedVersions` 中携带当前版本；任一版本过期，整个批次拒绝提交。`concurrency` 可设为 1～10，用于限制同时提交的数量。

查询与恢复最新批次：

```text
GET /v1/creative/generation-batches/:batchId
GET /v1/creative/projects/:projectId/generation-batches/latest
```

停止会取消仍处于 `queued` / `running` / `waiting_human` 的子 Job，不回滚已成功的资产：

```bash
curl --request POST http://127.0.0.1:3000/v1/creative/generation-batches/batch_xxx/cancel
```

重试只处理 `submission_failed` / `failed` / `cancelled` 项，并创建新 Job；成功项和已跳过项不会重复计费：

```bash
curl --request POST \
  http://127.0.0.1:3000/v1/creative/generation-batches/batch_xxx/retry \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: batch-xxx-retry-1' \
  --data '{"route":"primary"}'
```

### 导出工程

```bash
curl --fail --location \
  http://127.0.0.1:3000/v1/creative/projects/prj_demo/exports/onecrew.zip \
  --output prj_demo.onecrew.zip
```

原生导出包含完整创作契约、版本化资产元数据与受控媒体。`compatible.zip` 端点用于需要 1.4 格式互操的迁移工具。

## Provider 异步任务

```text
POST /v1/projects/:projectId/plan
POST /v1/images/generate
POST /v1/shots/generate
POST /v1/audio/synthesize
GET  /v1/jobs/:jobId
POST /v1/jobs/:jobId/cancel
POST /v1/providers/callback
```

四个提交端点都要求 `Content-Type: application/json` 和非空 `Idempotency-Key`。例如：

```bash
curl --request POST http://127.0.0.1:3000/v1/projects/prj_shanhai_demo/plan \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: demo-plan-001' \
  --data '{
    "operation": "script",
    "prompt": "为山海星辰生成两场结构化短剧大纲",
    "locale": "zh-CN",
    "imageUris": [],
    "maxOutputTokens": 500
  }'
```

成功提交返回 HTTP 202：

```json
{
  "job_id": "job_xxx",
  "status": "queued",
  "mode": "mock",
  "provider": "mock-llm-primary",
  "route": "primary",
  "estimated_cost_cny": 0.0002,
  "status_url": "/v1/jobs/job_xxx",
  "replayed": false
}
```

`status` 表示本次异步提交已排队或等待人工预算批准，不是任务最终结果。最终状态从 `status_url` 读取。复用相同幂等键和相同请求会返回原 Job 且 `replayed=true`；复用相同键但修改请求返回 409。

取消只对未终态 Job 生效。已经 `succeeded` 或 `cancelled` 会返回 `already_terminal`。

Provider 回调必须带：

```text
X-OneCrew-Timestamp: Unix 秒
X-OneCrew-Signature: hex(HMAC-SHA256(secret, timestamp + "." + rawBody))
```

缺少 `PROVIDER_CALLBACK_SECRET` 时回调端点失败关闭；重复事件 ID 幂等接收，篡改正文或超过五分钟的请求会被拒绝。

## 飞书控制面

```text
POST /v1/feishu/events
POST /v1/feishu/card-actions
```

安全规则、六表配置和四动作字段见 [飞书配置](./feishu-setup.md)。非预算审批会用持久 LangGraph 检查点恢复工作流；预算审批会把对应 Job 从 `waiting_human` 转回队列。

## Remotion 异步渲染

```text
POST /v1/renders
GET  /v1/renders/:renderId
POST /v1/renders/:renderId/cancel
```

`POST /v1/renders` 要求 `Content-Type: application/json` 和非空 `Idempotency-Key`，请求体为：

```json
{
  "manifest": { "...": "符合 RenderManifest JSON Schema 的完整对象" },
  "mode": "preview"
}
```

`mode` 只能为 `preview` 或 `final`。首次提交返回 202 和 `status_url`；如语义 Manifest、渲染模式及代码版本全部命中成功缓存，则返回 200、`status=succeeded`、`cached=true`。渲染服务不使用 `renderId` 作为语义缓存内容，因此可将相同成片安全映射到新记录。

状态为 `queued -> running -> succeeded | failed | cancelled`。Worker 只有在 Remotion 完成、媒体已写入受控 S3/MinIO 后才转入 `succeeded`。取消排队任务会删除 BullMQ Job；取消运行中任务会通过数据库轮询触发 Remotion cancel signal。

可复现的本地 Manifest 来自 `@onecrew/remotion/fixtures`，六类实际 MP4 可用 `pnpm remotion:demo` 直接生成。详见 [Remotion 系统](./remotion.md)。

## 自动质检

```text
POST /v1/qc/run
GET  /v1/qc/runs/:qcRunId
POST /v1/qc/runs/:qcRunId/cancel
```

提交必须带非空 `Idempotency-Key`，请求同时声明受控 `mediaUri`、媒体类型、ShotSpec/Design Pack 期望描述、VLM 检查项、技术期望、质量尝试次数与修复类型。返回 HTTP 202 和独立 `qc_run_id`，不会把一次 VLM 调用冒充完整 QC。

Worker 先用 ffprobe/FFmpeg 做解码、流参数、黑屏、冻结、亮度突变、静音、响度/峰值和字幕时间边界检查，再通过 Provider Gateway 获取严格 JSON VLM 结果。两层结果和失败代码都持久化到 `qc_runs`/`qc_records`。

内容质量只允许一次自动修复；第二次同类失败、合规风险、双 Provider 不可用或缺少安全修复来源会进入 `waiting_human`，生成且持久化只有 `approve`、`regenerate`、`switch_provider`、`manual` 四个动作的卡片。飞书回调成功后仍遵循目标版本和事件幂等校验。完整策略见 [自动质检](./qc.md)。

## 双语本地化

```text
POST /v1/localizations
GET  /v1/localizations/:localizationRunId
POST /v1/localizations/:localizationRunId/cancel
```

提交中文 `LocalePack`、共享镜头、英语目标声音映射和节奏参数，要求非空 `Idempotency-Key`。Worker 通过 Provider Gateway 完成结构化翻译和逐句 TTS，再按 TTS 返回的真实 `durationMs` 计算英文字幕区间和镜头停留；输出仍引用同一组镜头媒体 URI。状态为 `queued -> running -> waiting_provider -> succeeded | failed | cancelled`。

## 发布包与实验台账

```text
POST /v1/publishes
GET  /v1/publishes/:publishId
GET  /v1/projects/:projectId/experiments
```

发布请求必须包含中英文 Locale Pack 和至少 8 个已渲染宣发 Creative。当前经审计的交付模式固定为 `package_export`：生成可校验 ZIP、媒体清单、Locale Pack、实验种子和许可证说明，并在本地 PostgreSQL 写入实验记录；存在真实飞书凭证时同步“出海实验”表，否则明确记录 `feishuWriteback=mock_outbox`。详见 [双语与发布](./localization-publishing.md)。

## 错误约定

- `400`：请求契约错误或缺少幂等键。
- `401`：Provider 回调签名失败。
- `403`：飞书操作者未授权。
- `404`：本地资源不存在。
- `409`：幂等冲突、版本冲突或动作处理中。
- `503`：必要配置或依赖未就绪。
- `500`：未分类服务端错误；响应不回显 Secret 或原始 Provider 错误正文。
