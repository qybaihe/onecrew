# Episode quality-gate verification — 2026-07-17

## Scope

This verification closes the single-clip repetition defect in the formal 60–90 second episode path. A formal episode now requires multiple independently generated shot assets, separate source trimming, sufficient scripted dialogue and full-episode technical QC. The isolated `PipelineSmoke` composition remains available for 1–15 second infrastructure checks and cannot be submitted as a formal episode.

## Fail-closed behavior

- `EpisodeMaster` and `EpisodeLocalized` reject non-contiguous timelines, fewer than the required distinct videos, excessive duplicate use, one source occupying more than 35% of the runtime, dialogue coverage below 12%, insufficient dialogue-shot coverage and excessive dialogue gaps before queueing.
- Timeline `inFrame/outFrame` and media `sourceStartFrame/sourceEndFrame` are independent. Source media is never looped to fill an episode shot and may not be stretched beyond the configured 25% tolerance.
- Full-episode QC checks repeated-frame variation, scene changes, freeze, silence and subtitle bounds. The declared four-second branded end-card tail can be excluded from freeze scoring without excluding freezes in the narrative body.
- Production publishing requires QC status `succeeded`; `waiting_human`, failed or cancelled runs stop the process.

## Commands

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
pnpm readme:check

PROVIDER_MODE=mock pnpm --filter @onecrew/api dev
PROVIDER_MODE=mock pnpm --filter @onecrew/worker dev
ONECREW_RENDER_MODE=preview \
ONECREW_SMOKE_VERSION=episode_quality_gates_v4 \
pnpm --filter @onecrew/remotion render:stage7-smoke \
  ../../outputs/episode-quality-gates-e2e-v4
```

## Results

- Workspace build: 18/18 packages passed.
- Typecheck: 32/32 tasks passed.
- Lint: 18/18 packages passed.
- Unit tests: 32/32 tasks passed.
- Integration tests: 32/32 tasks passed, including real H.264 `PipelineSmoke`, repeated-loop rejection and intentional end-card-tail handling.
- Full HTTP/queue/worker E2E generated 10 independent image jobs, 10 independent video jobs and 10 TTS lines.
- Chinese `EpisodeMaster`: 60.053333 seconds, 640×360 preview, 3,732,045 bytes.
- English `EpisodeLocalized`: 60.416000 seconds, 640×360 preview, 3,765,921 bytes.
- Full Chinese episode QC: `succeeded`, 10 scene changes, 60 sampled frames, `visualVariationRatio=1`, zero failed checks.
- Publish package: `succeeded`, 2,625,873 bytes; 12 experiments persisted.

The previous repeated-shot artifact at `output/real-e2e/process-20260717-0154/zh-CN.EpisodeMaster.preview.mp4` fails the new visual-variation gate: 60 sampled frames produced `visualVariationRatio=0.85`, below the required `0.9`.

Primary evidence is stored in:

- `outputs/episode-quality-gates-e2e-v4/process-proof.json`
- `outputs/episode-quality-gates-e2e-v4/zh-CN.EpisodeMaster.preview.mp4`
- `outputs/episode-quality-gates-e2e-v4/en-US.EpisodeLocalized.preview.mp4`
- `outputs/episode-quality-gates-e2e-v4/onecrew-publish-package.zip`
