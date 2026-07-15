# 阶段 7 验证记录

验证日期：2026-07-15（Asia/Shanghai）。

## 自动与进程级结果

- Localization unit：2 个用例通过；TTS 映射、共享镜头、时长扩展和 8 个活动 Manifest 受契约校验。
- Publishing unit：确定性 ZIP 可解压且包含 Manifest/Locale/Experiment/License。
- Workflow integration：真实 PostgreSQL、Redis、MinIO 下 5 个文件、8 个用例通过；Mock LLM/TTS 写入实际 RIFF WAV，英文 10 行，发布包与 12 条实验记录落库。
- API unit：7 个文件、18 个用例通过，覆盖本地化/发布幂等、请求校验、状态与实验查询。
- 进程级 `stage7_process_v1`：API + 独立 Worker 生成 2 支约 60 秒正片、8 支双语宣发 Preview、2 张海报和 1,541,250 字节 ZIP。

英文时间线 `loc_mrm54lzt_5dea7564785c8bc98cba` 为 Mock 模式，10 个镜头 URI 与中文母版完全相同，实际 TTS 时长把总帧扩展为 1811 帧（60.37s）。所有 10 个 MP4 由 ffprobe 确认为 H.264/AAC、30fps；发布 `publish_stage7_process_v1` 成功并生成 12 条实验记录，飞书状态如实为 `mock_outbox`。

证据：`outputs/stage7-process-smoke/process-proof.json`。实现与边界见 [双语与发布](../localization-publishing.md)。

## 边界

翻译、TTS 和 VLM 是确定性 Mock；WAV、时间线、Remotion、ZIP、数据库和对象存储链路是真实运行。平台直发 API 未经审计，因此采用蓝图允许的发布包导出。真实飞书/Provider 因无凭证未实测。
