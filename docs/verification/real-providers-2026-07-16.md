# Real Provider smoke verification — 2026-07-16

## Scope

The local, Git-ignored `.env` selected `PROVIDER_MODE=real` and `PROVIDER_PROFILE=opencode-agnes-mimo`. No secret value was printed, committed, or copied into this record.

## Commands

```bash
pnpm providers:check
pnpm providers:smoke-real
```

## Results

| Capability | Adapter | Model | Result |
|---|---|---|---|
| LLM | OpenCode Go Chat Completions | `glm-5.2` | succeeded with structured JSON |
| VLM | OpenCode Go Messages | `minimax-m3` | succeeded with an image input and normalized QC JSON |
| Image | Agnes Image 2.1 Flash | `agnes-image-2.1-flash` | succeeded; PNG downloaded and materialized by the Adapter |
| TTS | Xiaomi MiMo V2.5 TTS | `mimo-v2.5-tts` | succeeded; Base64 audio decoded as WAV and materialized by the Adapter |
| Video | Agnes Video V2.0 | `agnes-video-v2.0` | succeeded; asynchronous task polled to completion and MP4 materialized by the Adapter |

The sanitized smoke process reported these media sizes:

- PNG: 1,221,688 bytes.
- WAV: 53,804 bytes.
- MP4: 96,292 bytes.

The separate local HTTP contract suite also verified that controlled `s3://` image references are converted to Data URIs before Agnes image/video submission and that all returned media is written through `ProviderMediaSink`.

## Interpretation

This proves the minimum live request and normalization path for all five Primary capabilities. It does not yet prove a complete real short-drama E2E, a real Feishu tenant, provider availability over time, exact subscription accounting, or a documented Agnes remote-cancellation path.
