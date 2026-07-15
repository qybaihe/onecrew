# 阶段 5 验证记录

验证日期：2026-07-15（Asia/Shanghai）

## 实际渲染结果

`pnpm remotion:demo` 实际 bundle Remotion 并生成六个 MP4：

| Composition | 输出 | 尺寸 | 帧数 | 文件字节 |
|---|---|---:|---:|---:|
| `EpisodeMaster` | `EpisodeMaster.preview.mp4` | 640×360 | 1800 | 2,929,898 |
| `EpisodeLocalized` | `EpisodeLocalized.preview.mp4` | 640×360 | 1800 | 2,934,032 |
| `Trailer30` | `Trailer30.preview.mp4` | 640×360 | 900 | 1,431,161 |
| `Teaser15Vertical` | `Teaser15Vertical.preview.mp4` | 360×640 | 450 | 725,699 |
| `Bumper6` | `Bumper6.preview.mp4` | 640×640 | 180 | 338,509 |
| `MotionPoster` | `MotionPoster.preview.mp4` | 360×640 | 180 | 314,471 |

`pnpm remotion:final-smoke` 另外生成 `Bumper6.final.mp4`：1080×1080、180 帧、799,493 字节，抽帧确认没有 `ONECREW · PREVIEW` 水印。

`ffprobe` 对全部七个输出确认：

- H.264 视频，30/1 fps，`yuv420p`、TV range、BT.709。
- AAC 双声道，48 kHz。
- 实际容器时长分别约 60.05s、60.05s、30.06s、15.06s、6.06s、6.06s；Final 6.06s。
- 文件可解码；接触表和单帧检查确认 Design Pack 色彩、Logo、CTA、字幕安全区和 Preview 水印已生效。

输出与报告位于 `outputs/remotion-stage5`，视觉接触表为 `contact-sheet.png`。

## API/Worker/MinIO 进程级闭环

1. 启动编译后 API 与独立 Worker。
2. `POST /v1/renders` 提交 `render_demo_Bumper6`，返回 HTTP 202、`queued`。
3. BullMQ Worker 调用真实 `ServerRemotionEngine`，状态到达 `succeeded`。
4. 数据库记录 `manifestHash=b5d0c4...d75f`、Design Pack `1.0.0`、code `0.1.0-dev`。
5. 对象写入 `s3://onecrew/renders/prj_shanhai_demo/render_demo_Bumper6/preview.mp4`。
6. 从 MinIO 重新下载后，`ffprobe` 确认 640×640、H.264/AAC、30fps、6.06s。
7. 相同幂等键再次提交返回 HTTP 200、`succeeded`、`replayed=true`、`cached=true`。

真实 PostgreSQL + Redis 集成测还验证了新 `renderId` 的相同语义 Manifest 命中缓存，渲染引擎只调用一次；另一个运行中渲染在持久状态转为 `cancelled` 后确实收到 AbortSignal，没有产生输出 URI。

## Player 浏览器验证

对生产 Vite build 启动本地服务后，使用 Chromium 实际完成：

- 读取六个可键盘操作的 Composition 选项。
- 从 `EpisodeMaster/zh-CN` 切换到 `EpisodeLocalized/en-US`，标题、locale 和 Composition ID 同步更新。
- 切换到 `Bumper6/1:1` 后点击 Player 播放，进度从 0:00 到 0:01。
- 修复并重验 Remotion 授权提示和 favicon 404，最终页面没有新的 browser console 错误或警告。

截图位于 `output/playwright/stage5-preview-bumper.png`。

## 自动验证

- Remotion unit：Manifest、时长、画幅、locale 与 Preview scale。
- Remotion integration：真实 bundle + Renderer 生成 6 秒 Bumper，检查 MP4 header、尺寸和大小。
- Preview unit/build：六个固定选项唯一，Vite 生产构建成功。
- API unit：提交、查询、取消、契约错误、缺少幂等键和冲突映射。
- Workflow integration：真实 PostgreSQL/Redis 下入队、消费、对象写入、幂等重放和语义缓存。
- 全仓 `lint` 、`typecheck` 、unit、integration 和 build 对 13 个 package 全部通过。
- 在临时空 PostgreSQL 数据库上从 0 应用全部 migration 和 seed，得到 13 张 public 表、`renders.render_mode` 默认值与 1 个种子项目；验证后删除临时库。

## 诚实边界

- 当前六个示例成片使用明确标识的 `mock://` 镜头，验证的是 Remotion、Design Pack、字幕和队列链路，不是真实 Video Provider 媒体。
- 中英文 TTS 真实时长驱动、系统 QC 和发布包属于阶段 6～7。
- Remotion 使用自定义许可证；超过免费条件的商业部署需在上线前购买 Company License。
