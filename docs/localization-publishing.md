# 双语本地化、宣发与发布

## 中文母版与英文 Locale Pack

中文 `LocalePack` 是内容母版。`POST /v1/localizations` 只接受 `zh-CN -> en-US`，并要求每条中文声音都提供目标声音映射。工作流经过统一 Provider Gateway 执行结构化翻译和逐句 TTS，不允许模块直接调用厂商。

每个 TTS 输出必须有受控媒体 URI 和实际 `durationMs`。时间线按镜头顺序计算：镜头时长取原镜头时长与 `leadIn + 对白 + lineGap + tail` 的较大值；字幕的 `startMs/endMs` 与音频一致。`shotTimingAdjustments` 同时保留源帧和本地化帧范围。镜头只调整停留区间，`videoUri` 不变，因此英文不会重新生成整个项目。

Mock 模式会写入真实可解码 WAV，但文本是明确标记的确定性 Mock 翻译草稿，必须经过人工语言审校后才可对外发布。Sandbox/Real 模式沿用同一契约。

## 宣发规格

`buildCampaignPlan` 为两个 locale 各生成四个 Render Manifest：

| Composition | 时长 | 画幅 | 作用 |
|---|---:|---|---|
| `Trailer30` | 30s | 16:9 | 冲突、升级、悬念、CTA |
| `Teaser15Vertical` | 15s | 9:16 | 竖版高信息密度预告 |
| `Bumper6` | 6s | 1:1 | 核心承诺与短 CTA |
| `MotionPoster` | 6s | 9:16 | 循环动态海报；可抽帧为静态封面 |

Hook、CTA、封面和平台列表属于 Creative，不修改镜头资产。中英文各自使用 Locale Pack 文案和音轨。背景音乐存在时，Remotion 在对白活动区间自动降低音乐音量。

## 发布包

当前没有把未经本项目审计的平台发布 API 冒充为已接通；交付模式固定为 `package_export`。ZIP 使用 `fflate` 构建，时间戳固定以保证同输入可重复哈希，内容包括：

- `media/zh-CN`、`media/en-US` 的 8 个正式宣发 MP4；
- `manifest.json`；
- 两个 Locale Pack；
- `experiments/seed.json`；
- `README.md` 与 `LICENSES.md`。

ZIP 写入受控 S3/MinIO，`PublishRecord` 保存 SHA-256、字节数、实验 ID 和飞书回写状态。每个 Creative 按平台生成一条初始实验记录；真实飞书配置存在时写入固定“出海实验”表，否则保存在 PostgreSQL 并标记 `mock_outbox`。

复现命令和实际产物见 [决赛演示](./demo.md) 与 [阶段 7 证据](./verification/stage-7.md)。
