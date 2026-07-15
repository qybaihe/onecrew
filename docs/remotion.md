# Remotion 渲染系统

OneCrew 只使用 Remotion 生成正式 MP4。Open Design Adapter 只编译 Design Pack，FFmpeg 只作为编解码和 QC 媒体基础设施，两者都不是平行渲染器。服务端实现遵循 Remotion 官方的 [bundle](https://www.remotion.dev/docs/bundle)、[selectComposition](https://www.remotion.dev/docs/renderer/select-composition) 和 [renderMedia](https://www.remotion.dev/docs/renderer/render-media) 边界。

## 六个固定 Composition

| ID | 用途 | 允许画幅 | 默认时长 |
|---|---|---|---:|
| `EpisodeMaster` | 中文母版正片 | 16:9 / 9:16 | 60～90s |
| `EpisodeLocalized` | 英文本地化正片 | 16:9 / 9:16 | 英文音轨驱动，60～90s |
| `Trailer30` | 剧情预告 | 16:9 / 9:16 | 30s |
| `Teaser15Vertical` | 竖版预热 | 9:16 | 15s |
| `Bumper6` | 投放广告 | 9:16 / 1:1 | 6s |
| `MotionPoster` | 动态海报 | 9:16 / 1:1 | Design Pack 定义，示例 6s |

项目不复制 Composition。每次差异只来自 `RenderManifest`、已解析 Design Pack 和 `preview | final` 模式。`calculateMetadata` 再次校验 locale、画幅、分辨率、字幕引用和时长，防止前端或 API 绕过契约。

公共组件完整实现 `BrandProvider` 、`SafeArea`、`ShotSequence`、`SmartCrop`、`SubtitleTrack`、`SpeakerLowerThird`、`EpisodeTitle`、`ChapterCard`、`LogoReveal`、`CTAEndCard`、`KineticHook`、`AudioBed`、`AudioDucking`、`ProgressIndicator` 和 `QCWatermark`。

## Preview 与 Final

- Preview：长边最多 640px、CRF 30、`superfast`、带 `ONECREW · PREVIEW` 水印。
- Final：Manifest 目标分辨率、CRF 18、`medium`、无审片水印。
- 两者均为 H.264/AAC、30fps（示例）、`yuv420p` limited-range BT.709。
- 渲染记录保存语义 Manifest hash、Design Pack version、code version 和输出 S3 URI。
- 缓存键不包含 `renderId`，但包含渲染模式和代码版本；内容变化才会重新渲染。

Renderer 在 Worker 启动时只 bundle 一次，每次使用同一份 `inputProps` 调用 `selectComposition` 和 `renderMedia`。临时目录会在成功、失败或取消后清理；运行中取消使用 Remotion 官方 [cancel signal](https://www.remotion.dev/docs/renderer/make-cancel-signal)。

## Player 预览

```bash
pnpm preview:dev
# http://127.0.0.1:4173
```

`apps/preview` 是响应式、可键盘操作的只读 [Remotion Player](https://www.remotion.dev/docs/player) 审片页。它可切换六种 Composition，但不保存项目状态、不接收密钥、不提供审批动作。飞书仍是唯一业务控制面。

Remotion 参数化原则参考官方 [Parameterized rendering](https://www.remotion.dev/docs/parameterized-rendering)；OneCrew 额外通过 Zod 和 Design Pack 不可变 URI 缩小了任意 props 的安全面。

## 本地渲染

```bash
# 六个低分辨率审片版
pnpm remotion:demo

# 一个 1080×1080 无审片水印的 Final 烟雾测试
pnpm remotion:final-smoke

# 官方 Studio
pnpm remotion:studio
```

输出默认写入 `outputs/remotion-stage5`。示例镜头 URI 为 `mock://`，画面会明确显示 `MOCK · shot_id`；这些证据验证渲染链路和 Design Pack，不冒充真实生成视频。

Final 默认按 Manifest 的正式分辨率渲染。资源受限的本地演示可设置 `REMOTION_FINAL_MAX_DIMENSION=640`：Composition 仍在 1920×1080/1080×1920 设计空间排版，只在 Renderer 输出阶段等比缩放，因此不会造成固定像素字号和安全区漂移，也不会出现 Preview 水印。

## 授权

当前固定 Remotion `4.0.489`。官方条款允许个人、非营利组织、评估用途以及最多 3 名员工的营利组织免费使用；其他营利组织需购买 Company License。代码中的授权确认只是消除已阅读警告，不代替购买。部署前请核对 [Remotion License](https://www.remotion.dev/license) 和实际组织规模。
