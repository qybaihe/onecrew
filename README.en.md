# OneCrew

[![CI](https://github.com/qybaihe/onecrew/actions/workflows/ci.yml/badge.svg)](https://github.com/qybaihe/onecrew/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.13-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)

English · [简体中文](./README.md)

<!-- README_SYNC:0.1.0 -->

OneCrew is a Feishu-controlled, API-driven production system for bilingual Chinese and English AI short dramas and promotional media. It organizes project setup, scripts and storyboards, visual rules, media generation, asset versioning, automated quality control, localization, final rendering, human approval, and publish-package export into a recoverable and auditable pipeline.

Remotion is the only final video renderer. PostgreSQL stores business state, S3/MinIO stores controlled media, and Redis/BullMQ runs asynchronous jobs. Feishu is the only approval control plane, while the local Studio handles project browsing, asset organization, the storyboard canvas, project import, and final review.

> Current version: `0.1.0`. Stages 0–8 have been implemented and verified through a local deterministic Mock end-to-end run. Real model providers, a real Feishu tenant, and direct platform publishing require the operator's own credentials and authorization. Mock results are never presented as real provider output.

## Features

| Area | Capability | Status |
| --- | --- | --- |
| Projects and scripts | Multiple projects and episodes, script plans, character/scene/prop libraries, and structured storyboards | Implemented |
| Creative Studio | Script editing, storyboard list/canvas, character/scene/prop editing, asset binding, and final review | Implemented and browser-verified |
| Single-shot generation | Generate images/videos from saved shots with entity references, previous-shot tail frames, continuity constraints, and asset version write-back | Mock browser-verified; Real requires credentials |
| Batch generation | Fill only missing images/videos with durable batch progress, stop, refresh, and failed-item retry controls | Mock browser-verified |
| Continuity QC | Compile saved character, scene, prop, camera-axis, and tail-frame continuity into the existing FFmpeg/VLM/Feishu review pipeline | Implemented and browser-verified |
| Project import/export | Import structured JSON or ZIP archives with media; export portable OneCrew archives with SHA-256 integrity data | Implemented and tested |
| Concurrent editing | Optimistic episode/entity/shot versions, 409 conflict protection, and accepted-edit auditing | Implemented and tested |
| Design system | Parse Open Design / `DESIGN.md` and compile immutable Design Packs | Implemented |
| Provider Gateway | Primary/Fallback routing for LLM, VLM, image, video, and TTS providers | Mock verified; Real adapters implemented |
| Job system | BullMQ queues, idempotency, budget gates, retries, cancellation, and signed callbacks | Implemented and tested |
| Asset management | Source, provider, model, seed, hash, license, and parent-child version chains | Implemented and tested |
| Final rendering | Chinese/English episodes, 30s trailers, 15s vertical teasers, 6s bumpers, motion posters | Verified locally |
| Automated QC | FFmpeg/ffprobe technical checks, VLM semantic checks, and one automatic repair | Implemented and tested |
| Human recovery | Feishu `Approve / Regenerate / Switch provider / Manual` actions | Mock/integration verified |
| Localization | Structured English translation, per-line TTS, duration-driven timing, and subtitles | Implemented and tested |
| Publishing | Bilingual media manifest, Locale Packs, experiment seeds, licenses, and ZIP export | Implemented and tested |
| Experiment write-back | PostgreSQL experiment ledger; optional Feishu Base write-back | Local path verified; real Feishu pending authorization |

## How it works

```mermaid
flowchart LR
  L["Local Creative Studio"] --> B["Fastify API"]
  A["Feishu / HTTP API"] --> B
  B --> C["PostgreSQL"]
  B --> D["Redis / BullMQ"]
  D --> E["Worker"]
  E --> F["Provider Gateway"]
  F --> G["LLM / Image / Video / TTS / VLM"]
  E --> H["S3 / MinIO Asset Store"]
  E --> I["Remotion Final Renderer"]
  I --> J["FFmpeg + VLM QC"]
  J --> K["Bilingual Publish Package / Experiment Ledger"]
  J -->|Human decision required| A
```

Production work runs as asynchronous Jobs. A client submits a request and receives a `job_id` plus a status URL. The Worker performs generation, rendering, QC, localization, and publishing. Recoverable state, idempotency records, human gates, and LangGraph checkpoints are persisted in PostgreSQL so API or Worker restarts do not discard business state.

## Requirements

- Node.js `>= 22.13.0`
- pnpm `>= 10.13.0`; the repository pins `10.13.1`
- Docker Desktop or a compatible Docker Engine with Compose
- FFmpeg and ffprobe
- macOS or Linux; CI runs on Ubuntu

On macOS, install the command-line dependencies with Homebrew:

```bash
brew install node pnpm ffmpeg
```

Install and start Docker Desktop separately.

## Quick start

Clone the repository and run the bootstrap script:

```bash
git clone https://github.com/qybaihe/onecrew.git
cd onecrew
bash scripts/bootstrap-local.sh
```

On the first run, the script:

1. creates an untracked `.env` from `.env.example`;
2. installs the locked pnpm dependencies;
3. starts PostgreSQL, Redis, and MinIO;
4. generates contracts and builds the complete workspace;
5. applies database migrations and seed data;
6. compiles the demo Design Pack and validates provider routes;
7. starts the API, Worker, and Preview app together in foreground development mode.

After startup:

| URL | Purpose |
| --- | --- |
| `http://127.0.0.1:3000/healthz` | API liveness |
| `http://127.0.0.1:3000/readyz` | PostgreSQL, Redis, and MinIO readiness |
| `http://127.0.0.1:4173` | Creative Studio, storyboard canvas, and Remotion Player review page |
| `http://127.0.0.1:59001` | Local MinIO administration console |

Verify the environment:

```bash
curl http://127.0.0.1:3000/healthz
curl http://127.0.0.1:3000/readyz
pnpm infra:status
```

Stop the local infrastructure with:

```bash
pnpm infra:down
```

## Using the Creative Studio

Open `http://127.0.0.1:4173/#studio` to work with a project:

1. switch the active project in the top bar, or import a `.onecrew.zip` / compatible ZIP archive;
2. choose an episode and edit its title, summary, full script, and duration in the left rail;
3. switch between the storyboard list and React Flow canvas, then select a shot;
4. edit shot action, camera language, dialogue, narration, image/video prompts, negative prompt, and continuity notes;
5. select a character, scene, or prop in the right-hand library; edit its common and type-specific fields, then bind versioned assets from the current project as references;
6. save with the version shown in the editor. If another editor saved first, the stale update receives HTTP 409 and the Studio reloads the current server version instead of silently overwriting it;
7. after saving the shot, click **Generate storyboard image** or **Generate video**. The Studio follows the asynchronous Job; image requests preserve entity references, the previous shot's tail frame, and continuity notes, while video requests prefer the newest image version for the current shot. Successful outputs enter the asset library and link to the previous version through `parentAssetId`;
8. read the visible `MOCK` or real-provider label. Mock mode is for local development and does not create real media. Real generation requires configured provider credentials and positive prices. Jobs that exceed the project budget enter the human gate instead of spending past the limit;
9. use **Fill missing storyboard images/videos** above the shot list to process only shots without the corresponding asset. Batch records live in PostgreSQL, so the latest progress returns after a page reload. You can stop unfinished Jobs or retry only failed/cancelled items;
10. click **Run continuity QC** for an image or video already materialized in controlled MinIO/S3. OneCrew derives character identity, clothing, scene, prop, lighting, camera-axis, previous-tail-frame, and temporal-stability checks from the saved shot, then reuses the existing technical QC, VLM, and Feishu human gate. Mock placeholder URIs are never presented as checked media;
11. click **Export OneCrew Project** to download a complete, re-importable ZIP containing the project, episodes, entities, shots, frame prompts, versioned asset metadata, media, and a SHA-256 for every media file.

The Studio edits content and assets only. Approval, provider switching, and manual handoff still enter through the Feishu control plane so there is only one release-authority path.

## Split-process development

For a production-like local workflow, prepare infrastructure and data first:

```bash
cp .env.example .env
pnpm install
pnpm infra:up
pnpm contracts:generate
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm design:compile
```

Then use three terminals:

```bash
# Terminal 1: API
pnpm start:api

# Terminal 2: Worker
pnpm start:worker

# Terminal 3: Creative Studio and review app
pnpm preview:dev
```

Media rendering can use significant memory. For a low-resource local demo, cap the Final output dimension:

```bash
REMOTION_FINAL_MAX_DIMENSION=640 pnpm start:worker
```

Leave this variable empty for production delivery so Final renders use the dimensions declared by the Manifest.

## Run the complete Mock E2E

`PROVIDER_MODE=mock` is the default and never calls billable external APIs. Once the API and Worker are ready, run:

```bash
pnpm demo:mock-e2e
```

The command uses the real HTTP API and an independent Worker to complete:

- one LLM script-plan Job;
- ten image Jobs and ten video Jobs;
- Chinese TTS, structured English translation, and English TTS;
- Chinese and English episodes plus eight bilingual promotional videos;
- FFmpeg technical QC and Mock VLM semantic QC;
- Chinese and English static posters;
- a publish ZIP and twelve experiment records;
- idempotency and cache verification on a same-version rerun.

Local output is written to `outputs/stage8-mock-e2e/`. This directory contains reproducible runtime evidence and is intentionally excluded from Git.

See [docs/demo.md](./docs/demo.md) for the complete walkthrough and [docs/verification/stage-8.md](./docs/verification/stage-8.md) for the latest verification evidence.

## API overview

The local API base URL is `http://127.0.0.1:3000`.

| Purpose | Endpoint |
| --- | --- |
| Health | `GET /healthz`, `GET /readyz` |
| Creative projects | `GET /v1/creative/projects`, `GET /v1/creative/projects/:projectId` |
| Script/shot editing | `PATCH /v1/creative/episodes/:episodeId`, `PATCH /v1/creative/shots/:shotId` |
| Single-shot image/video generation | `POST /v1/creative/shots/:shotId/generations` |
| Batch generation | `POST /v1/creative/projects/:projectId/generation-batches`; query/stop/retry under `/v1/creative/generation-batches/:batchId/...` |
| Per-shot continuity QC | `POST /v1/creative/shots/:shotId/continuity-qc`; read status through `GET /v1/qc/runs/:qcRunId` |
| Project import | `POST /v1/creative/imports/...` for structured JSON, OneCrew ZIP, and compatible ZIP archives |
| Project export | `GET /v1/creative/projects/:projectId/exports/onecrew.zip` |
| Script plan | `POST /v1/projects/:projectId/plan` |
| Image generation | `POST /v1/images/generate` |
| Video generation | `POST /v1/shots/generate` |
| Speech synthesis | `POST /v1/audio/synthesize` |
| Job status/cancel | `GET /v1/jobs/:jobId`, `POST /v1/jobs/:jobId/cancel` |
| Provider callback | `POST /v1/providers/callback` |
| Remotion render | `POST /v1/renders`, `GET /v1/renders/:renderId` |
| Automated QC | `POST /v1/qc/run`, `GET /v1/qc/runs/:qcRunId` |
| Localization | `POST /v1/localizations` |
| Publish package | `POST /v1/publishes` |
| Experiment ledger | `GET /v1/projects/:projectId/experiments` |
| Feishu events | `POST /v1/feishu/events`, `POST /v1/feishu/card-actions` |

Write endpoints require `Content-Type: application/json` and a non-empty `Idempotency-Key`. Asynchronous submissions return HTTP 202 plus a status URL. Reusing the same key with an identical request replays the existing Job; reusing it with a different request returns 409.

Request and response examples are documented in [docs/api.md](./docs/api.md).

## Configuration

Every environment variable is documented in [.env.example](./.env.example). Never commit a real `.env` file.

### Local infrastructure

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Local PostgreSQL on `55432` | Business state, Jobs, assets, experiments |
| `REDIS_URL` | Local Redis on `56379` | BullMQ queues |
| `S3_ENDPOINT` | Local MinIO on `59000` | Controlled media storage |
| `S3_BUCKET` | `onecrew` | Media bucket |
| `FFMPEG_PATH` | `ffmpeg` | Technical QC and media processing |
| `FFPROBE_PATH` | `ffprobe` | Media probing |

### Provider mode

```dotenv
PROVIDER_MODE=mock
```

Mock mode is intended for development, CI, and demonstrations. Before switching to `real`, configure the relevant API keys, model IDs, callback secret, and positive pricing values. Missing required configuration fails closed and never silently falls back to Mock.

Real provider variables:

- LLM/VLM: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_VLM_MODEL`
- Image/video: `VOLCENGINE_ARK_API_KEY`, `SEEDREAM_MODEL`, `SEEDANCE_MODEL`
- TTS: `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL`
- Signed callbacks: `PROVIDER_CALLBACK_SECRET`

Validate the configuration with:

```bash
pnpm providers:check
```

See [docs/provider-setup.md](./docs/provider-setup.md) for details.

### Feishu

A real Feishu environment requires a custom app, an authorized Base, and the following variables:

- `FEISHU_APP_ID`
- `FEISHU_APP_SECRET`
- `FEISHU_BASE_APP_TOKEN`
- `FEISHU_VERIFICATION_TOKEN`
- `FEISHU_ENCRYPT_KEY`
- `FEISHU_ALLOWED_OPEN_IDS`

After configuration, run:

```bash
pnpm feishu:setup
```

Table definitions, minimum permissions, event subscriptions, and callback security are covered in [docs/feishu-setup.md](./docs/feishu-setup.md).

## Development commands

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Run every workspace with a dev task in parallel |
| `pnpm start:api` | Start the API process |
| `pnpm start:worker` | Start the asynchronous Worker |
| `pnpm preview:dev` | Start the Creative Studio, storyboard canvas, and review app |
| `pnpm remotion:studio` | Open Remotion Studio |
| `pnpm remotion:demo` | Render the fixed demo Compositions |
| `pnpm remotion:final-smoke` | Run the Final-render smoke test |
| `pnpm demo:mock-e2e` | Run the complete Mock production loop |
| `pnpm contracts:generate` | Regenerate JSON Schemas |
| `pnpm db:generate` | Generate a Drizzle migration |
| `pnpm db:check` | Validate schema and migration state |
| `pnpm db:migrate` | Apply database migrations |
| `pnpm db:seed` | Insert idempotent demo data |
| `pnpm design:compile` | Compile the demo Design Pack |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type-check the complete workspace |
| `pnpm test:unit` | Run unit tests |
| `pnpm test:integration` | Run tests using PostgreSQL, Redis, and MinIO |
| `pnpm build` | Build all 17 packages/apps |
| `pnpm readme:check` | Verify bilingual README synchronization and critical commands |

Recommended pre-commit checks:

```bash
pnpm readme:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
```

## Repository layout

```text
apps/
  api/                 Fastify API, health checks, and HTTP routes
  worker/              BullMQ consumers for generation/render/QC/publishing
  remotion/            Compositions, components, Player, and Final Renderer
  preview/             React Creative Studio, storyboard canvas, and Remotion review UI
packages/
  config/              Zod environment contract
  contracts/           Shared contracts and JSON Schemas
  creative/            Creative domain model, project import/export, media materialization
  domain/              State machines, versions, and input hashes
  db/                  Drizzle schema, migrations, seed, repositories
  design-adapter/      Open Design parsing and Design Pack compilation
  providers/           Mock/Real provider adapters and routing
  media/               S3/MinIO media-write boundary
  feishu/              Base, cards, events, and four actions
  localization/        Chinese/English Locale Packs and TTS timing
  publishing/          Publish ZIP and experiment seeds
  qc/                  FFmpeg/VLM quality control
  workflows/           Jobs, budgets, recovery, and LangGraph orchestration
design-packs/           Reproducible design inputs and license manifests
infra/                  Local Docker Compose stack
scripts/                Bootstrap, verification, and maintenance scripts
docs/                   API, operations, configuration, and verification docs
```

## Data and asset rules

- PostgreSQL is the source of truth for business state; MinIO/S3 is the source of truth for media; Redis only carries queues.
- Every media-generation Job creates or reuses an `AssetRecord`.
- Asset records include source, provider, model, seed, content hash, and license.
- Cached Jobs reuse the original asset ID. Regeneration creates a new version connected to the previous version through `parentAssetId`.
- Feishu stores control data and controlled links, not large media files.
- Episode, character/scene/prop, and shot edits use optimistic versions; accepted changes and the actor are written to the audit log.
- OneCrew project ZIPs preserve the full creative contract and media. Import rejects traversal, duplicate or undeclared entries, expansion-limit violations, and media hash mismatches.
- The Studio can organize creative data and media, but it does not expose approval, release, or provider-switch actions. Those actions enter only through the Feishu control plane.

## Tests and current completion

Latest complete local regression (2026-07-15):

- lint, typecheck, and build passed across all 17 workspaces;
- 85 unit tests passed;
- 33 integration tests passed;
- a fresh database applied 9 migrations and produced 22 business tables plus 10 demo shots;
- JSON and ZIP project imports passed API smoke tests; ZIP media was written to local MinIO and bound to versioned assets; a OneCrew export containing three real MinIO assets passed browser-download and ZIP-integrity checks;
- the Creative Studio was verified at desktop and `390 × 844` mobile viewports, including project switching, script/shot saves, character/scene/prop editing, versioned-asset binding, single-shot and batch image/video generation, durable batch recovery/stop/retry, continuity QC, version-chain write-back, version conflicts, canvas, export, and final review, with no errors or warnings in a clean browser session;
- all 10 Final MP4 files were H.264/AAC at 30 fps;
- the general QC suite passed all 15 technical checks and its Mock VLM decision; per-shot continuity QC also passed a full run against a decodable MinIO image, while an invalid input was verified to open the durable human gate;
- the publish ZIP passed integrity checks for 14 entries, including eight bilingual promotional videos and twelve experiment seeds.

CI is defined in [.github/workflows/ci.yml](./.github/workflows/ci.yml). Every push and pull request starts infrastructure from `.env.example` and runs the complete verification suite.

## Troubleshooting

### `/readyz` returns 503

```bash
pnpm infra:status
pnpm infra:logs
```

Confirm Docker is running and PostgreSQL, Redis, and MinIO are healthy.

### A Job remains `queued`

Confirm that the independent Worker is running and has logged `onecrew_worker_ready`:

```bash
pnpm start:worker
```

### Real provider mode fails during startup

```bash
pnpm providers:check
```

Real mode requires complete credentials, model IDs, a callback secret, and pricing configuration. Missing values fail by design.

### Remotion uses too many local resources

For local demonstrations, run:

```bash
REMOTION_FINAL_MAX_DIMENSION=640 pnpm start:worker
```

Keep `RENDER_QUEUE_CONCURRENCY=1`. Do not use the dimension cap for production delivery.

### Reusing an idempotency key returns 409

One idempotency key represents exactly one request. Use a new key after changing the request body; do not overwrite an existing Job.

More recovery procedures are available in [docs/operations.md](./docs/operations.md).

## Security and honest boundaries

- `.env`, runtime output, dependencies, browser traces, and local media are excluded from Git.
- API logs redact Authorization, API keys, tokens, secrets, passwords, and cookies.
- Provider callbacks use timestamped HMAC-SHA256 signatures and reject replayed or modified payloads.
- `PROVIDER_MODE=real` fails closed on incomplete configuration.
- OpenAI, Volcengine, ElevenLabs, and a real Feishu tenant have not been live-tested without user-supplied credentials.
- The currently audited delivery path is ZIP export; direct platform publishing is not claimed as available.
- Mock media carries a visible `MOCK · shot_id` label.

## Keeping the README current

The Chinese `README.md` and English `README.en.md` are the project entry points. Future changes must follow these rules:

1. update both READMEs when startup commands are added, removed, or renamed;
2. update the matching sections when environment variables, ports, APIs, directories, or capability status change;
3. update the `README_SYNC` marker in both files when the package version changes;
4. complete the README checklist in every pull request;
5. keep `pnpm readme:check` in CI so language links, versions, and critical commands cannot silently drift.

Detailed design and operational references live under [`docs/`](./docs/). The README only describes current facts needed to start, develop, and verify the project.

## Documentation

- [API usage](./docs/api.md)
- [Local operations](./docs/operations.md)
- [Complete Mock demo](./docs/demo.md)
- [Feishu setup](./docs/feishu-setup.md)
- [Provider setup](./docs/provider-setup.md)
- [Design Packs](./docs/design-pack.md)
- [Remotion rendering](./docs/remotion.md)
- [Automated QC](./docs/qc.md)
- [Localization and publishing](./docs/localization-publishing.md)
- [Dependencies and licenses](./docs/dependency-licenses.md)
- [Verification records](./docs/verification/)
