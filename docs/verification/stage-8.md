# 阶段 8 验证记录

验证日期：2026-07-15（Asia/Shanghai）。

## 固定数据与空库复现

- Seed：`prj_shanhai_demo`，2 个角色，10 个连续镜头，每镜头 6 秒。
- 临时空数据库从 0 应用 7 个 migration 成功，得到 18 张 public 表、1 个项目、10 个镜头；验证后删除临时库。
- Docker Compose 中 PostgreSQL 17.5、Redis 7.2.10、MinIO 固定版本均保持 healthy。

## Final Mock E2E v5

`pnpm demo:mock-e2e` 通过运行中的 API 与独立 Worker 先执行 1 个 LLM 剧本计划 Job、10 个图片 Job 和 10 个视频 Job，再生成 `outputs/stage8-mock-e2e`。每个媒体 Job 自动登记 `AssetRecord`；本次产生 10 个图片、10 个视频和 20 个中英音频资产，均记录来源、Provider、模型、哈希和许可证。缓存 Job 复用资产 ID，集成测试另验证重生成视频建立 `version=2` 与 `parentAssetId`：

| 输出 | 时长 | 视频 | 音频 |
|---|---:|---|---|
| 中文正片 | 60.05s | H.264 640×360 30fps | AAC 48kHz 双声道 |
| 英文正片 | 60.42s | H.264 640×360 30fps | AAC 48kHz 双声道 |
| 中英 30 秒预告 | 30.06s | H.264 640×360 | AAC |
| 中英 15 秒竖版 | 15.06s | H.264 360×640 | AAC |
| 中英 6 秒广告 | 6.06s | H.264 640×640 | AAC |
| 中英动态海报 | 6.06s | H.264 360×640 | AAC |

Final 在正式设计空间排版后由 Renderer 等比缩放，无 Preview 水印；抽帧确认中英文 Hook、字幕、Logo、CTA 与安全区生效。英文 Locale Pack 10 行，TTS 驱动时长 60.37s，`sameShotAssets=true`。

最终全仓回归：16 个 package 的 lint、typecheck、build 全部通过；69 个 unit 和 32 个 integration 用例通过。集成测试包含真实 Remotion 短片渲染、PostgreSQL repository、Redis 队列、MinIO、Provider HTTP 归一化、飞书动作、LangGraph 跨实例恢复、本地化发布和 QC 恢复。

QC `qc_mrm615z4_5d4d7c6cad52d6ac858c` 终态 `succeeded/pass`：解码、尺寸、fps、时长、编码、像素格式、黑屏、冻结、亮度、音轨、静音和字幕边界 15 项全部通过，Mock VLM 为 `pass`。

发布 `publish_stage8_mock_e2e_v5` 成功；ZIP 为 2,938,145 字节，SHA-256 `2311ac1f8e3f6bb896b0a29bff791d2f2ef133b0b1e2b283f5cf8bcd5d1824dd`，`unzip -t` 对 14 个条目全部通过，含 8 个双语宣发 MP4、2 个 Locale Pack、Manifest、12 条实验种子、README、LICENSES。飞书无凭证，回写状态明确为 `mock_outbox`。

## 恢复与失败证据

- 阶段 4：预算、缓存、超时、重试、取消与回调签名测试。
- 阶段 6：注入黑屏/冻结/静音，第一次自动重生成；第二次失败升级操作卡；飞书事件选择备用模型后恢复成功；另有转人工和四动作集成测试。
- 阶段 8：相同 E2E 版本重跑命中 Provider/Render/Publish/QC 幂等与语义缓存。

完整机器证据：[process-proof.json](../../outputs/stage8-mock-e2e/process-proof.json)，视觉证据：[contact-sheet.jpg](../../outputs/stage8-mock-e2e/contact-sheet.jpg)。

## 未验证能力

当前环境未提供真实飞书与模型凭证，故 P1 仅完成真实 Adapter、配置失败关闭、契约和 Mock/Sandbox 验证；没有伪造真实调用成功。真实平台直发同样未审计，交付采用明确的 ZIP 导出。
