# 决赛 Mock E2E 演示

## 演示范围

固定数据为 1 个“山海星辰”IP、林遥/岳岚 2 个角色、10 个 6 秒镜头。Mock 模式明确显示 `MOCK · shot_id`，不会把占位镜头或确定性音频描述为真实厂商生成。

## 复现步骤

首次运行：

```bash
bash scripts/bootstrap-local.sh
```

如果用分进程方式，启动 API 与 Worker；低资源演示 Worker 设置输出缩放：

```bash
pnpm start:api
# 第二终端
REMOTION_FINAL_MAX_DIMENSION=640 pnpm start:worker
```

API 和 Worker ready 后，在第三终端执行：

```bash
pnpm demo:mock-e2e
```

脚本通过 HTTP 调用真实 API 和独立 BullMQ Worker，依次完成 LLM 剧本计划、10 个参考图 Job、10 个视频 Job、中文 TTS、英文结构化翻译与 TTS、TTS 时长驱动时间线、2 支正片、8 支双语宣发 Final、FFmpeg/VLM QC、2 张静态海报、发布 ZIP 和 12 条实验记录。相同版本重跑会验证幂等与缓存。

## 预期输出

输出目录：`outputs/stage8-mock-e2e`。

- `zh-CN.EpisodeMaster.final.mp4`：约 60.05s。
- `en-US.EpisodeLocalized.final.mp4`：约 60.42s。
- 中英文 `Trailer30`、`Teaser15Vertical`、`Bumper6`、`MotionPoster`。
- `zh-CN.poster.jpg`、`en-US.poster.jpg`。
- `onecrew-publish-package.zip`。
- `process-proof.json`：Job、Localization、Render、QC、Publish、实验与 ffprobe 证据。
- `contact-sheet.jpg`：中英文正片/宣发抽帧视觉证据。

成功标准：10 个 MP4 均为 H.264/AAC、30fps、有音轨、时长符合规格；英文时间线仍使用中文母版的 10 个镜头 URI；QC 技术检查与 Mock VLM 均 `pass`；ZIP 完整性通过；发布记录含 12 个实验 ID。

QC 故障、一次自动重生成、第二次失败升级、切换模型和转人工的独立可复现实验见 [阶段 6 证据](./verification/stage-6.md)。

## 诚实边界

- 已实测：本机 PostgreSQL/Redis/MinIO、API、Worker、队列、Remotion、FFmpeg、ZIP、浏览器 Preview 与所有 Mock Adapter。
- 仅 Mock：LLM、图片、视频、TTS、VLM 的外部能力结果；Mock TTS 会生成真实 WAV 以验证媒体链路。
- 未实测：真实 OpenAI/火山/ElevenLabs 调用、真实飞书 Base/卡片、真实平台发布；原因是当前没有用户提供的有效凭证或授权。
