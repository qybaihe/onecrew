# OneCrew 自动质检与恢复

OneCrew 的完整 QC 是两层持久化流程，不是一次模型请求：确定性 FFmpeg/ffprobe 技术检测负责可测的媒体事实，VLM 负责 ShotSpec 与不可变 Design Pack 对照下的语义一致性。所有正式 MP4 仍只由 Remotion 产生；FFmpeg 只做媒体检查、审片接触表和编解码基础设施。

## 技术层

`packages/qc` 以参数数组启动子进程，不经过 shell，并设置超时、输出上限和 AbortSignal。检查项包括：

- 完整解码、视频/音频流存在性、分辨率、帧率、时长、码率、codec、pixel format、色彩空间。
- `blackdetect` 黑屏、`freezedetect` 冻结、`signalstats` 抽样亮度突变。
- `silencedetect` 静音、`ebur128` 集成响度与 true peak。
- 字幕 cue 的起止顺序和媒体时长边界；安全区、品牌、字幕视觉和口型由语义层打分。

实现依据为 FFmpeg 官方 [Filters Documentation](https://ffmpeg.org/ffmpeg-filters.html) 和 [ffprobe Documentation](https://ffmpeg.org/ffprobe.html)。报告保留每项 `code/passed/severity/reason/actual/expected`，失败原因会给出实测值和阈值。

## 语义层

Worker 从受控 S3/MinIO 下载源媒体。图片会归一化为 JPEG；视频会生成最多 3×3 抽帧接触表，并以 data URL 送入 VLM，外部 Provider 不获得 MinIO 凭证。VLM 必须返回共享 Schema 约束的 JSON：11 项 0～1 分数、`pass/regenerate/switch_model/manual`、原因和可选修复 patch。检查提示由请求中的 ShotSpec/Design Pack 期望描述及 character、clothing、scene、props、action、subtitles、locale、brand、lipsync、artifacts、compliance 项组成。

Primary 失败会等待队列有界重试；持续失败后只切换一次 Fallback。两者都不可用时生成 `manual` 严格失败结果，不伪造通过。当前 Real OpenAI Adapter 只支持图片输入，因此视频先由上述受控接触表转换为图片审片输入。

## 决策矩阵

| 条件 | 动作 |
|---|---|
| 技术与语义都通过 | QC `succeeded/pass` |
| 首次内容或技术质量失败 | 一次自动重生成；`generationNonce` 绕过 Provider 缓存 |
| `remediation=remotion` 且设计/文字/字幕/画幅问题 | 克隆 Manifest、增加 `renderRevision`，只排队 Remotion 重渲染 |
| 第二次同类质量失败 | `waiting_human`，发送或保存四动作卡片 |
| compliance 分数低于 0.7 或 VLM 要求 manual | 直接人工门禁，不自动绕过 |
| Primary 持续不可用 | Fallback |
| Primary 与 Fallback 都不可用 | 人工门禁，原因带 `provider_unavailable` |
| 预算硬上限 | 延用 Provider 预算门禁，批准前不执行 |

人工卡片严格只有通过、重生成、切换模型、转人工处理四项。卡片保存 QC Run、可执行失败原因、失败代码和修复 patch，不包含 Provider 密钥或原始内部提示词。卡片回调仍需飞书 Token/签名、操作者 allowlist、目标版本和事件幂等。

## 队列、状态和取消

QC 独立使用 `onecrew-qc-runs` BullMQ 队列，持久状态为：

```text
queued -> running -> waiting_provider -> succeeded
                         |                  ^
                         +-> waiting_human -+
                         +-> failed/cancelled
```

失败队列尝试使用指数退避且有上限。取消排队任务会移除 Job；取消运行任务会在数据库轮询后中断 FFmpeg 并取消活动 Provider Job。进程重启后可从 PostgreSQL 状态和幂等键安全重放。

## 配置

```dotenv
QC_QUEUE_CONCURRENCY=1
QC_PROVIDER_POLL_MS=500
QC_PROVIDER_TIMEOUT_MS=600000
QC_PROVIDER_FAILURE_GRACE_MS=5000
QC_CANCEL_POLL_MS=500
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
FEISHU_QC_RECEIVE_ID=
FEISHU_QC_RECEIVE_ID_TYPE=open_id
```

本机验证的 FFmpeg/ffprobe 为 `7.1.1`。实际 Homebrew 构建带 GPL 与 libx264；生产分发边界见 [依赖许可证](./dependency-licenses.md)。

## 复现

```bash
pnpm --filter @onecrew/qc test:unit
pnpm --filter @onecrew/qc test:integration
pnpm --filter @onecrew/workflows test:integration
pnpm --filter @onecrew/api test:unit
```

真实失败媒体、API/Worker 进程级恢复证据见 [Stage 6 验证记录](./verification/stage-6.md)。真实飞书租户和真实 VLM 因当前没有凭证，保持 `config-ready/unverified`，不会用 Mock 结果冒充。
