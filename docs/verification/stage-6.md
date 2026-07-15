# Stage 6 验证记录：自动 QC 与有界恢复

验证日期：2026-07-15（Asia/Shanghai）。

## 已实现

- 新增持久 `qc_runs`、QC 状态机、幂等提交、BullMQ 队列、API 状态/取消端点与第 `0005` 号迁移。
- FFmpeg/ffprobe 检查解码、媒体参数、黑屏、冻结、亮度、静音、响度、峰值和字幕时间边界；所有子进程有参数隔离、超时、输出上限和 AbortSignal。
- VLM 只能通过 Provider Gateway，输出经严格 JSON Schema；Primary 持续失败才切 Fallback，双路失败转人工。
- 内容质量只自动修复一次；第二次升级四动作飞书卡片。Remotion-only 修复增加 `renderRevision` 绕过语义缓存，但保留来源 Manifest。
- 飞书 Client 已实现 `POST /im/v1/messages` 交互卡发送；无凭证时明确保存为 `mock_outbox`。

## 真实媒体检测

`packages/qc/test/technical-qc.integration.test.ts` 用本机 FFmpeg 生成两段 320×180、30fps、H.264/AAC、BT.709 MP4：

- 健康 `testsrc2 + sine` 片段：全部技术检查通过。
- 故障 `black + anullsrc` 片段：检测到 `black_frames`、`freeze_frames`、`silence`，实测最长区间分别约 1.967s、2.000s、2.005s。
- 另启动无限 FFmpeg 流并通过 AbortSignal 在 100ms 后终止，断言子进程返回 cancelled 而非遗留后台进程。

测试结果：3 tests passed。

## PostgreSQL + Redis 集成恢复

`packages/workflows/test/qc-orchestrator.integration.test.ts` 使用真实 PostgreSQL/Redis、Mock Primary/Fallback Provider 和注入失败技术报告，证明：

1. 第一次质量失败自动创建 replacement Job 并成功执行。
2. `qualityAttempt=2` 进入 `waiting_human`，原因包含三个失败代码和自动重试已达上限。
3. 持久卡片只有 `approve/regenerate/switch_provider/manual` 四个动作。
4. `switch_provider` 创建 fallback replacement Job，QC Run 终态恢复为 `succeeded`。

整个 workflows 集成套件：4 files、7 tests passed。

## API + Worker 进程级证明

使用实际构建后的 API 和 Worker、受控 MinIO 对象 `s3://onecrew/qc-smoke/injected-black-freeze-silence.mp4`、本机 FFmpeg `7.1.1` 完成：

- Source Job：`job_mrm3t9io_54d77d40266c8f8f`，Mock Video Primary succeeded。
- 第一次 QC：`qc_mrm3tj58_a39ab8af14c30c709fd1`，真实 FFmpeg 检测失败后自动创建 `job_mrm3tjtd_b66a1eed2d2dfac5` 并 succeeded。
- 第二次 QC：`qc_mrm3vfe8_ae4d2c5621064acdb9a1`，状态 `waiting_human`，卡片 delivery 为 `mock_outbox`；原因明确列出 1.967s 黑屏超过 0.750s、2.000s 冻结超过 1.500s、2.005s 静音超过 2.000s。
- 通过真实 `/v1/feishu/card-actions` 本地安全路径提交 `switch_provider`，事件 `evt_stage6_process_switch_v1`；创建 fallback Job `job_mrm3vq9d_245e495828b3062a`，Provider/route 为 `mock-video-fallback/fallback`，最终 succeeded；QC Run 版本 7、状态 succeeded。

精简机器证据保存在 `output/qc-smoke/process-proof.json`，故障 MP4 保存在同目录。

## 回归

- Feishu 单元：5 files、13 tests passed，其中 Client 测试验证 receiver query、interactive 消息和双层 JSON card body。
- API 单元：5 files、14 tests passed，覆盖 QC 幂等、状态和取消 wire shape。
- QC 单元：3 tests passed；QC 媒体集成：3 tests passed。
- `drizzle-kit check` 成功；`0005` 已应用到本地 PostgreSQL。

## 明确边界

- 当前没有飞书租户与真实模型凭证，因此真实消息投递和真实 VLM 响应仍为未验证；代码、严格配置与 HTTP fixture 已验证。
- 本次进程级 VLM 使用 deterministic Mock，所有结果明确标记 Mock，不消耗外部额度。
- 当前 Homebrew FFmpeg 包含 `--enable-gpl`/libx264，产品分发须按 GPLv2+ 组合审查；它不取代 Remotion 的唯一正式成片职责。
