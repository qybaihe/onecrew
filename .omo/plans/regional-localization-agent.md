# regional-localization-agent - Work Plan

## TL;DR (For humans)

**What you'll get:** A new "regional culture" agent that turns a plain brief plus a target market (America, Russia, or UK) into a concrete localisation playbook, and makes the existing story planner write episodes that are local from the first draft. You also get a one-command demo that produces a ~10-second localised short-drama clip in Mock mode, plus a step-by-step Chinese guide that explains the flow and dissects why *Claimed by the Dragon* works overseas.

**Why this approach:** The culture pack is generated *before* the script, not bolted on as translation afterwards — that is how hits like *Claimed by the Dragon* are actually built. The pack itself travels as a Job artifact referenced by ID, so we never pollute the project's persistent entities with throwaway research.

**What it will NOT do:** It will not translate existing Chinese episodes, will not touch the LangGraph pipeline or Feishu, and will not run the demo for Russia or UK — only America is exercised end-to-end.

**Effort:** Medium
**Risk:** Low - the change follows an existing, well-tested orchestrator pattern and runs entirely in Mock mode.
**Decisions to sanity-check:** (1) the culture pack is transient, not a saved entity; (2) only America gets a live demo run; (3) video length target is ~10s via the existing PipelineSmoke composition.

Your next move: already approved — execution begins now. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, low risk; adds RegionalCulturePlanner agent, minimal america demo, and docs/regional-localization-demo.md.

## Scope

### Must have

- C1 contracts: add `'regional_culture'` to `llmProviderRequestSchema.operation` enum; add `regionalCulturePackSchema`, `regionalCulturePackRequestSchema`, `RegionalCulturePack`/`RegionalCulturePackRequest` types and register them in `contractSchemas` — all in `packages/contracts/src/index.ts`. Also export JSON Schema file `packages/contracts/schemas/RegionalCulturePack.schema.json` if the contracts:generate script picks it up automatically (verify by running the generator).
- C2 prompt builder: new file `packages/creative/src/regional-culture.ts` exporting `buildRegionalCultureRequest(input: { project; request: RegionalCulturePackRequest }): LlmProviderRequest`. Re-export from `packages/creative/src/index.ts`.
- C3 orchestrator: new file `packages/workflows/src/regional-culture-planner.ts` exporting `RegionalCulturePlanner` with `submit(projectId, input, idempotencyKey)` and `preview(projectId, jobId)`. Re-export from `packages/workflows/src/index.ts`.
- C4 story planner integration: extend `creativeStoryPlanRequestSchema` with optional `regionalCulturePackJobId?: string`; extend `CreativeStoryPlanner.submit` to fetch the culture-pack Job and pass the parsed pack to `buildCreativeStoryPlanRequest`; extend `buildCreativeStoryPlanRequest` signature to accept optional `culturePack?: RegionalCulturePack` and inject a culture-pack section into the prompt when present.
- C5 api routes: add `POST /v1/creative/projects/:projectId/regional-culture-packs` and `GET /v1/creative/projects/:projectId/regional-culture-packs/:jobId` to `apps/api/src/creative-routes.ts`; add `regionalCulturePlanner?: Pick<RegionalCulturePlanner,'submit'|'preview'>` to `CreativeRouteOptions`; wire instance in `apps/api/src/server.ts`; add `RegionalCulturePlannerNotConfiguredError` mirroring the story-planner error.
- C6 demo script: new file `scripts/demo-regional-localization.mjs` that runs culture-pack → story-plan → apply → 10 image jobs → 10 video jobs → zh TTS per line → 1 PipelineSmoke render (~10s) → QC run; writes evidence under `outputs/regional-demo-america-<ts>/`. Must accept `--region america|russia|uk` (default `america`) and `--output <dir>` (default `outputs/regional-demo-<region>-<ts>`).
- C7 docs: new file `docs/regional-localization-demo.md` covering background, Claimed-by-the-Dragon case analysis, agent design, three-region cultural differences, step-by-step usage, localization rationale, evidence paths, honest boundary.
- Tests: unit tests for `buildRegionalCultureRequest` and the extended `buildCreativeStoryPlanRequest`; integration tests for the two new endpoints (happy + idempotent replay + 409 on mismatched idempotency + 4xx on unknown culture-pack job).

### Must NOT have (guardrails, anti-slop, scope boundaries)

- Do NOT modify `packages/workflows/src/production-workflow.ts` (no new LangGraph stage).
- Do NOT modify `LocalizationOrchestrator` or any localization-routes file.
- Do NOT add an `apply()` method to `RegionalCulturePlanner`.
- Do NOT modify any Remotion composition or add a new composition; reuse `PipelineSmoke`.
- Do NOT change provider adapters (`mock.ts`, `opencode-go.ts`, etc.) — the new operation value passes through unchanged.
- Do NOT run the english localization, promo renders, publish ZIP, or Feishu writes as part of the demo.
- Do NOT scrape external sites for cultural data — the culture pack is LLM-generated from prompt-embedded knowledge.
- Do NOT execute the live demo for `russia` or `uk`; only `america` evidence is produced in this plan.
- Do NOT modify `apps/remotion/scripts/stage7-process-smoke.ts` or `pnpm demo:mock-e2e`.
- Do NOT introduce new environment variables.
- Do NOT add Feishu/Base fields.

## Verification strategy
> Zero human intervention - all verification is agent-executed.

- Test decision: **tests-after** (vitest for unit, supertest-style integration using the existing `creative-routes.test.ts` harness). Framework: `pnpm test:unit` and `pnpm test:integration`.
- Type safety: `pnpm typecheck` must stay clean across all touched workspaces (`contracts`, `creative`, `workflows`, `api`).
- Lint: `pnpm lint` clean.
- Build: `pnpm build` exit 0.
- Live demo evidence: run `node scripts/demo-regional-localization.mjs --region america` after API + Worker are up; capture `outputs/regional-demo-america-<ts>/process-proof.json` and the rendered MP4; verify with `ffprobe` that the MP4 is H.264/AAC, 30fps, duration in [8s, 12s].
- Evidence: `.omo/evidence/regional-localization-agent/` (one sub-directory per todo: `task-N-*.{log,json,txt}`); live demo evidence under `outputs/regional-demo-america-<ts>/`.

## Execution strategy

### Parallel execution waves

- **Wave 1 (foundation, sequential)**: Todo 1 (contracts) — everything depends on the schemas.
- **Wave 2 (parallel builders)**: Todo 2 (prompt builder), Todo 3 (orchestrator) — both depend on contracts, independent of each other.
- **Wave 3 (integration, sequential)**: Todo 4 (story planner integration) — depends on Wave 2 outputs.
- **Wave 4 (api + wiring)**: Todo 5 (api routes + server wiring) — depends on Todo 3+4.
- **Wave 5 (quality gates, parallel)**: Todo 6 (unit tests), Todo 7 (integration tests) — depend on Todos 2-5.
- **Wave 6 (demo)**: Todo 8 (demo script) → Todo 9 (run demo + capture evidence). Depends on Todos 1-5; tests can run in parallel.
- **Wave 7 (docs)**: Todo 10 (docs/regional-localization-demo.md) — depends on Todo 9 evidence.

### Dependency matrix

| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 contracts | — | 2,3,4,5,6,7,8,9,10 | — |
| 2 prompt builder | 1 | 4,6,8,9,10 | 3 |
| 3 orchestrator | 1 | 5,7,8,9,10 | 2 |
| 4 story planner integration | 1,2 | 5,6,7,8,9,10 | 3 |
| 5 api routes + wiring | 3,4 | 7,8,9,10 | 6 |
| 6 unit tests | 2,4 | 10 | 3,5,7 |
| 7 integration tests | 3,5 | 10 | 6 |
| 8 demo script | 4,5 | 9,10 | 6,7 |
| 9 run demo + evidence | 8 | 10 | — |
| 10 docs | 9 | — | — |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

- [ ] 1. Contracts: add regional culture pack schemas and new LLM operation
  What to do / Must NOT do: In `packages/contracts/src/index.ts` (a) extend the `operation` enum inside `llmProviderRequestSchema` to `z.enum(['script','translate','marketing_copy','regional_culture'])`; (b) add `regionalCulturePackRegionSchema = z.enum(['america','russia','uk'])`; (c) add `regionalCulturePackRequestSchema = z.object({ region: regionalCulturePackRegionSchema, brief: z.string().min(1).max(20_000), route: providerRouteSchema.default('primary'), generationNonce: z.number().int().nonnegative() })`; (d) add `regionalCulturePackSchema = z.object({ region: regionalCulturePackRegionSchema, regionLabel: z.string().min(1).max(200), audienceProfile: z.string().min(1).max(4_000), themes: z.array(z.string().min(1).max(500)).min(3).max(12), spiritValues: z.array(z.string().min(1).max(500)).min(3).max(12), taboos: z.array(z.string().min(1).max(500)).max(12), hookStructures: z.array(z.string().min(1).max(500)).min(2).max(8), visualMotifs: z.array(z.string().min(1).max(500)).min(3).max(12), referenceCases: z.array(z.object({ title: z.string().min(1).max(300), whyItWorks: z.string().min(1).max(2_000) })).min(1).max(6), localizedBrief: z.string().min(1).max(20_000) })`; (e) register both schemas in `contractSchemas` as `RegionalCulturePack` and `RegionalCulturePackRequest`; (f) export inferred types `RegionalCulturePack`, `RegionalCulturePackRequest`, `RegionalCulturePackRegion`. Must NOT touch any other schema. Must NOT modify provider adapters.
  Parallelization: Wave 1 | Blocked by: — | Blocks: 2,3,4,5,6,7,8,9,10
  References: `packages/contracts/src/index.ts:1062-1071` (llm schema), `:1330-1371` (creative story plan schemas as model), `:1389-1414` (contractSchemas registration), `:1504` (type exports pattern)
  Acceptance criteria: `pnpm --filter @onecrew/contracts build` exit 0; `pnpm --filter @onecrew/contracts typecheck` exit 0; `node -e "const c=require('./packages/contracts/dist/index.js'); console.log(c.regionalCulturePackSchema.safeParse({region:'america',regionLabel:'x',audienceProfile:'y',themes:['a','b','c'],spiritValues:['a','b','c'],taboos:[],hookStructures:['h1','h2'],visualMotifs:['m1','m2','m3'],referenceCases:[{title:'t',whyItWorks:'w'}],localizedBrief:'b'}).success)"` prints `true`.
  QA scenarios: happy = `pnpm --filter @onecrew/contracts build && pnpm --filter @onecrew/contracts test` (if present); failure = `node -e` snippet above with `region:'france'` must print `false`. Evidence: `.omo/evidence/regional-localization-agent/task-1-build.log`, `task-1-schema-check.txt`
  Commit: Y | feat(contracts): add regional culture pack schemas and regional_culture LLM operation

- [ ] 2. Prompt builder: buildRegionalCultureRequest in @onecrew/creative
  What to do / Must NOT do: Create `packages/creative/src/regional-culture.ts` exporting (a) `regionalCulturePackOutputSchema()` returning `{...z.toJSONSchema(regionalCulturePackSchema, { target: 'draft-2020-12' }), title: 'OneCrewRegionalCulturePack'}`; (b) `buildRegionalCultureRequest(input: { project: Pick<ProjectSpec,'projectId'|'nameZh'|'nameEn'|'synopsis'|'audience'|'genres'>; request: RegionalCulturePackRequest }): LlmProviderRequest` — prompt MUST instruct the LLM to act as an overseas short-drama localization strategist, to ground recommendations in the requested `region` (`america` → US middle-aged female vertical-drama audience, werewolf/dragon/billionaire/fated-mate tropes, cliffhanger-per-60-seconds; `russia` → melodrama, family honor, strong male leads, fairy-tale motifs; `uk` → period romance, witty banter, class tension, restrained emotion), to cite `Claimed by the Dragon` as the worked example when region is `america`, and to produce a `localizedBrief` rewritten in the target market's voice. `capability:'llm'`, `operation:'regional_culture'`, `locale:'zh-CN'`, `imageUris: []`, `outputSchema: regionalCulturePackOutputSchema()`, `maxOutputTokens: 8_000`. Re-export from `packages/creative/src/index.ts`. Must NOT call the LLM directly; must NOT persist anything.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 4,6,8,9,10
  References: `packages/creative/src/story-plan.ts:47-96` (builder pattern to mirror), `packages/contracts/src/index.ts` (new schemas from Todo 1), web research on Claimed by the Dragon (in this plan's draft findings)
  Acceptance criteria: `pnpm --filter @onecrew/creative build` exit 0; `pnpm --filter @onecrew/creative typecheck` exit 0; `node -e "const m=require('./packages/creative/dist/regional-culture.js'); const r=m.buildRegionalCultureRequest({project:{projectId:'p',nameZh:'n',nameEn:'n',synopsis:'s',audience:'a',genres:['g']},request:{region:'america',brief:'b',route:'primary',generationNonce:1}}); if(r.operation!=='regional_culture') throw new Error('op'); if(!r.prompt.includes('Claimed by the Dragon')) throw new Error('case'); console.log('ok')"` prints `ok`.
  QA scenarios: happy = build returns LlmProviderRequest passing `llmProviderRequestSchema.parse`; failure = builder with `region:'russia'` must NOT include the string `Claimed by the Dragon` (it is US-specific). Evidence: `.omo/evidence/regional-localization-agent/task-2-build.log`, `task-2-prompt-america.txt`, `task-2-prompt-russia.txt`
  Commit: Y | feat(creative): add buildRegionalCultureRequest prompt builder

- [ ] 3. Orchestrator: RegionalCulturePlanner in @onecrew/workflows
  What to do / Must NOT do: Create `packages/workflows/src/regional-culture-planner.ts` mirroring `creative-story-planner.ts`. Class `RegionalCulturePlanner` with constructor `(repository: Pick<CreativeRepository,'getBundle'>, provider: Pick<ProviderOrchestrator,'submit'|'get'>)`. Methods: (a) `submit(projectId, input, idempotencyKey)` — validate with `regionalCulturePackRequestSchema`, fetch bundle, call `provider.submit(buildRegionalCultureRequest({ project: bundle.project, request }), idempotencyKey)`; (b) `preview(projectId, jobId)` — fetch Job, assert `job.value.projectId === projectId`, `run.request.capability === 'llm'`, `run.request.outputSchema?.title === 'OneCrewRegionalCulturePack'`; if status !== 'succeeded' return `{ job }`; else parse `llmProviderOutputSchema`, require `structured`, parse `regionalCulturePackSchema`, return `{ job, pack }`. Export errors `RegionalCulturePackNotReadyError`, `RegionalCulturePlannerOutputError`. Re-export from `packages/workflows/src/index.ts`. Must NOT add apply(); must NOT touch the provider gateway or registry.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 5,7,8,9,10
  References: `packages/workflows/src/creative-story-planner.ts:1-100` (template), `packages/workflows/src/index.ts` (export list), `packages/creative/src/regional-culture.ts` (Todo 2 builder)
  Acceptance criteria: `pnpm --filter @onecrew/workflows build` exit 0; `pnpm --filter @onecrew/workflows typecheck` exit 0; class compiles with both methods and errors exported.
  QA scenarios: happy = import and instantiate with stubbed repository+provider, call submit with valid input, assert provider.submit called with request matching `llmProviderRequestSchema`; failure = preview on a Job whose `outputSchema.title !== 'OneCrewRegionalCulturePack'` throws `RegionalCulturePlannerOutputError`. Evidence: `.omo/evidence/regional-localization-agent/task-3-build.log`
  Commit: Y | feat(workflows): add RegionalCulturePlanner orchestrator

- [ ] 4. Story planner integration: consume regional culture pack
  What to do / Must NOT do: (a) In `packages/contracts/src/index.ts`, extend `creativeStoryPlanRequestSchema` with `regionalCulturePackJobId: idSchema.optional()`. (b) In `packages/creative/src/story-plan.ts`, change `buildCreativeStoryPlanRequest(input)` so the input type accepts optional `culturePack?: RegionalCulturePack`; when present, inject a new prompt section after the project info block: `目标出海地区：${culturePack.regionLabel}`, `地区受众画像：${culturePack.audienceProfile}`, `偏好题材：${culturePack.themes.join('、')}`, `核心精神面貌：${culturePack.spiritValues.join('、')}`, `禁忌规避：${culturePack.taboos.join('、') || '无'}`, `钩子结构：${culturePack.hookStructures.join('、')}`, `视觉符号：${culturePack.visualMotifs.join('、')}`, `参考案例：${culturePack.referenceCases.map(c=>`${c.title}——${c.whyItWorks}`).join('；')}`, plus a directive `请严格按照以上地域文化包创作剧本、角色与场景，确保题材、精神面貌、视觉符号与参考案例一致，避免触碰禁忌。`, and replace the final `本次创作要求：${brief}` line with `本次创作要求（已按地域文化包本土化）：${culturePack.localizedBrief}`. (c) In `packages/workflows/src/creative-story-planner.ts`, in `submit`, if `request.regionalCulturePackJobId` is present, call `provider.get(regionalCulturePackJobId)`, assert it succeeded and its `run.request.outputSchema?.title === 'OneCrewRegionalCulturePack'`, parse the structured pack with `regionalCulturePackSchema`, and pass it as `culturePack` to `buildCreativeStoryPlanRequest`; otherwise call without pack. Throw `CreativeStoryPlanOutputError` on mismatch. Must NOT change materializeCreativeStoryPlan. Must NOT introduce new schemas beyond the one optional field.
  Parallelization: Wave 3 | Blocked by: 1,2 | Blocks: 5,6,7,8,9,10
  References: `packages/creative/src/story-plan.ts:54-96`, `packages/workflows/src/creative-story-planner.ts:45-53`, `packages/contracts/src/index.ts:1330-1335`
  Acceptance criteria: `pnpm --filter @onecrew/creative --filter @onecrew/workflows --filter @onecrew/contracts build` exit 0; typecheck clean; unit test (Todo 6) asserts prompt contains `目标出海地区：` iff pack is provided.
  QA scenarios: happy = with valid pack jobId, submit produces prompt including all eight culture-pack lines; failure = submit with `regionalCulturePackJobId` pointing to a non-culture-pack Job throws `CreativeStoryPlanOutputError`. Evidence: `.omo/evidence/regional-localization-agent/task-4-build.log`
  Commit: Y | feat(creative,workflows): inject regional culture pack into story planner

- [ ] 5. API routes + server wiring for regional culture packs
  What to do / Must NOT do: (a) In `apps/api/src/creative-routes.ts`: add `regionalCulturePlanner?: Pick<RegionalCulturePlanner,'submit'|'preview'>` to `CreativeRouteOptions`; add `RegionalCulturePlannerNotConfiguredError`; register `POST /v1/creative/projects/:projectId/regional-culture-packs` (body = `regionalCulturePackRequestSchema`, header `Idempotency-Key` required, response 202 with `AsyncJobAccepted`) and `GET /v1/creative/projects/:projectId/regional-culture-packs/:jobId` (response = preview result); map `RegionalCulturePlannerNotConfiguredError` to the same HTTP code as `CreativeStoryPlannerNotConfiguredError` in the error handler at the bottom of the file. (b) In `apps/api/src/server.ts`: import `RegionalCulturePlanner`, instantiate `const regionalCulturePlanner = new RegionalCulturePlanner(repositories.creative, providerOrchestrator);` next to the existing story planner (line ~73), and pass it via `regionalCulturePlanner` in the options object (line ~261). Must NOT modify any other route; must NOT add new auth or scopes.
  Parallelization: Wave 4 | Blocked by: 3,4 | Blocks: 7,8,9,10
  References: `apps/api/src/creative-routes.ts:55-79, 274-322, 723-726, 808-812`, `apps/api/src/server.ts:19, 73, 261`
  Acceptance criteria: `pnpm --filter @onecrew/api build` exit 0; typecheck clean; integration test (Todo 7) passes.
  QA scenarios: happy = POST returns 202 and GET eventually returns pack; failure = POST without `Idempotency-Key` returns 4xx; POST with mismatched idempotency key returns 409. Evidence: `.omo/evidence/regional-localization-agent/task-5-build.log`
  Commit: Y | feat(api): expose regional culture pack endpoints and wire planner

- [ ] 6. Unit tests for prompt builders
  What to do / Must NOT do: Add `packages/creative/src/regional-culture.test.ts` and extend `packages/creative/src/story-plan.test.ts` (create if absent). Cover: (a) america prompt mentions `Claimed by the Dragon`; (b) russia prompt does NOT mention `Claimed by the Dragon`; (c) uk prompt mentions period romance motifs; (d) output schema title is `OneCrewRegionalCulturePack`; (e) story-plan builder without pack omits the `目标出海地区：` line; (f) story-plan builder with pack includes all eight injected lines and uses `localizedBrief` instead of the raw `brief`. Must NOT use snapshot tests that bake in long Chinese strings verbatim — assert on substring presence instead.
  Parallelization: Wave 5 | Blocked by: 2,4 | Blocks: 10
  References: existing test pattern in `packages/creative/src/*.test.ts` (list to discover), `packages/creative/src/regional-culture.ts`, `packages/creative/src/story-plan.ts`
  Acceptance criteria: `pnpm --filter @onecrew/creative test:unit` exit 0 with new tests passing; coverage does not regress.
  QA scenarios: happy = all six assertions pass; failure = intentionally break one assertion locally, confirm vitest reports failure, then revert. Evidence: `.omo/evidence/regional-localization-agent/task-6-vitest.log`
  Commit: Y | test(creative): cover regional culture prompt builder and story-plan injection

- [ ] 7. Integration tests for regional culture pack endpoints
  What to do / Must NOT do: Extend `apps/api/src/creative-routes.test.ts` with a new `describe` block: (a) POST returns 202 with `jobId` and `statusUrl`; (b) replaying the same idempotency key + same body returns the same `jobId`; (c) same key + different body returns 409; (d) GET on unknown jobId returns 404; (e) GET after Job succeeds returns `{ pack }` whose `region` matches request. Use the existing stubbed planner pattern already in the file (line ~387). Must NOT spin up a real Worker; use stubs.
  Parallelization: Wave 5 | Blocked by: 3,5 | Blocks: 10
  References: `apps/api/src/creative-routes.test.ts:387` (existing storyPlanner stub), new routes added in Todo 5
  Acceptance criteria: `pnpm --filter @onecrew/api test:integration` (or whatever script runs `creative-routes.test.ts`) exit 0.
  QA scenarios: happy = five new cases pass; failure = remove the idempotency check and re-run to confirm 409 case fails, then restore. Evidence: `.omo/evidence/regional-localization-agent/task-7-integration.log`
  Commit: Y | test(api): cover regional culture pack endpoints

- [ ] 8. Demo script: scripts/demo-regional-localization.mjs
  What to do / Must NOT do: Create `scripts/demo-regional-localization.mjs` (ESM, Node >=22, uses global fetch). CLI flags: `--region america|russia|uk` (default `america`), `--output <dir>` (default `outputs/regional-demo-<region>-<YYYYMMDD-HHmmss>`), `--api http://127.0.0.1:3000`, `--project prj_shanhai_demo`. Steps (each step logs JSON to `<output>/process-proof.json` incrementally): (1) `waitForReady` GET `/readyz` until 200; (2) POST `/v1/creative/projects/:projectId/regional-culture-packs` with `{region, brief:'为现有山海星辰项目生成面向该地区的本土化短剧文化包。', route:'primary', generationNonce:Date.now()}` and `Idempotency-Key: regional-culture-<region>-<ts>`; poll GET until pack returned; persist `culture-pack.json`. (3) POST `/v1/creative/projects/:projectId/story-plans` with `{brief:'生成一集十镜头出海本土化短剧。', episodeCount:1, regionalCulturePackJobId:<jobId>, route:'primary', generationNonce:Date.now()}`; poll preview; then POST `/apply` with `{expectedProjectVersion:<from bundle>, actorOpenId:'demo_regional_localization'}`; persist `story-plan.json`. (4) Fetch the new bundle; find the newly added episode and its 10 shots (if the LLM returns fewer, fail loudly). For each shot: POST `/v1/images/generate` with prompt derived from shot record (fallback to shot.prompt), 1024x576, seed `8000+index`; then POST `/v1/shots/generate` with the image URI as reference, `durationSec:6`, `aspectRatio:'16:9'`, seed `9000+index`. (5) For each line of dialogue across the 10 shots, POST `/v1/audio/synthesize` (locale zh-CN, voice chosen from project voice map; if no voice map, use `voice_lin`). (6) Build a `PipelineSmoke` render manifest inline (mirror the structure used by `apps/remotion/scripts/stage7-process-smoke.ts` for fixture manifests but with the generated shot URIs) targeting ~10 seconds total (e.g. 10 shots × 30 frames @30fps); POST `/v1/renders`; poll until succeeded; download MP4 to `<output>/pipeline-smoke.mp4`. (7) POST `/v1/qc/run` for the render; persist QC verdict. (8) Write `process-proof.json` summarising every Job id, asset URI, duration, ffprobe output. Must NOT call `/v1/localizations`, `/v1/publishes`, or any Feishu endpoint. Must NOT require real provider credentials — must run cleanly under `PROVIDER_MODE=mock`.
  Parallelization: Wave 6 | Blocked by: 4,5 | Blocks: 9,10
  References: `apps/remotion/scripts/stage7-process-smoke.ts` (HTTP patterns, poll helpers, process-proof shape), `apps/remotion/src/fixtures.ts` (manifest shape), `apps/remotion/src/manifest.ts:229-234` (PipelineSmoke constraints), new endpoints from Todos 4+5
  Acceptance criteria: `node scripts/demo-regional-localization.mjs --help` exits 0; dry-run mode `--dry-run` prints the step plan without HTTP calls; script is executable with `node` directly.
  QA scenarios: happy = `--dry-run` prints 8 steps; failure = run against a stopped API and confirm the script exits non-zero with a clear error mentioning `/readyz`. Evidence: `.omo/evidence/regional-localization-agent/task-8-dryrun.log`
  Commit: Y | feat(scripts): add regional localization demo driver

- [ ] 9. Run the demo end-to-end in Mock mode and capture evidence
  What to do / Must NOT do: (a) Bring up infra with `pnpm infra:up`; wait for healthy. (b) Run migrations and seed if needed: `pnpm db:migrate && pnpm db:seed`. (c) Build the workspace: `pnpm build`. (d) Start API and Worker in background with logs under `.omo/evidence/regional-localization-agent/task-9-api.log` and `task-9-worker.log`; set `REMOTION_FINAL_MAX_DIMENSION=640` for the Worker to keep memory low. (e) Run `node scripts/demo-regional-localization.mjs --region america` with stdout/stderr captured to `.omo/evidence/regional-localization-agent/task-9-demo.log`. (f) Verify the output MP4 with `ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,duration -of json <mp4>`; assert video codec `h264`, audio codec `aac`, duration in `[8,12]` seconds. (g) Kill API/Worker cleanly. Must NOT use `PROVIDER_MODE=real`. Must NOT leave processes running on exit.
  Parallelization: Wave 6 | Blocked by: 8 | Blocks: 10
  References: `scripts/demo-regional-localization.mjs` (Todo 8), `package.json` scripts for infra/db, `docs/demo.md` for the run pattern
  Acceptance criteria: MP4 exists at `outputs/regional-demo-america-*/pipeline-smoke.mp4`; `process-proof.json` lists culture-pack job, story-plan job, 10 image jobs, 10 video jobs, ≥1 TTS job, 1 render, 1 QC run; QC verdict is `pass` (Mock VLM); ffprobe assertions hold.
  QA scenarios: happy = full run succeeds and evidence files are complete; failure = if any step fails, capture the partial `process-proof.json` and the failing HTTP response, mark the todo blocked, do NOT delete the partial evidence. Evidence: `outputs/regional-demo-america-*/**` plus `.omo/evidence/regional-localization-agent/task-9-*.log`
  Commit: N (outputs are gitignored evidence; only the script is committed in Todo 8)

- [ ] 10. Documentation: docs/regional-localization-demo.md
  What to do / Must NOT do: Write a pure-Markdown doc with sections in this order: (1) 背景与目标 — what this feature adds, why it matters for 出海; (2) 成功案例拆解：Claimed by the Dragon — audience, themes, hook structure, visual motifs, why it works in the US market (cite ReelShort + vertical-drama trend, no external images); (3) Agent 设计 — input/output schema, insertion point (before story planner), why culture-pack-as-Job-artifact rather than persisted entity; (4) 三个地区的文化包差异 — table comparing america / russia / uk across audienceProfile, themes, spiritValues, taboos, hookStructures, visualMotifs; (5) 一步步使用 — bootstrap, infra up, db migrate/seed, build, start api+worker, run `node scripts/demo-regional-localization.mjs --region america`, expected artifacts; (6) 本土化理由 — why translation-only is insufficient, with concrete contrast (e.g. 中式修仙 vs fated-mate werewolf); (7) 证据与产物 — list every artifact produced under `outputs/regional-demo-america-*/` and what each proves; (8) 诚实边界 — Mock providers, no real ReelShort scraping, culture pack quality depends on underlying LLM, russia/uk not exercised end-to-end in this demo. Reference exact file paths (e.g. `packages/workflows/src/regional-culture-planner.ts`). Must NOT embed base64 images; must NOT promise real-provider results.
  Parallelization: Wave 7 | Blocked by: 9 | Blocks: —
  References: evidence from Todo 9, source files from Todos 1-8, draft findings on Claimed by the Dragon
  Acceptance criteria: file exists; `pnpm readme:check` still passes; doc contains all eight section headings; every referenced file path exists in the repo.
  QA scenarios: happy = lint passes and a reviewer can follow section 5 to reproduce; failure = deliberately reference a non-existent path, run a link-check, confirm it is caught, then fix. Evidence: `.omo/evidence/regional-localization-agent/task-10-doc.md` (the doc itself)
  Commit: Y | docs(demo): add regional localization demo guide

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [ ] F1. Plan compliance audit — confirm every Must have item landed and every Must NOT item was respected; grep for accidental edits to `production-workflow.ts`, `LocalizationOrchestrator`, Remotion compositions, provider adapters. Evidence: `.omo/evidence/regional-localization-agent/f1-compliance.log`
- [ ] F2. Code quality review — `pnpm lint && pnpm typecheck && pnpm build` all exit 0; no `as any`, no `@ts-ignore`, no empty catch blocks introduced. Evidence: `.omo/evidence/regional-localization-agent/f2-quality.log`
- [ ] F3. Real manual QA — re-run `node scripts/demo-regional-localization.mjs --region america` from a clean checkout state (fresh `outputs/` dir) and confirm success; verify the rendered MP4 plays (`ffprobe` + manual open if available). Evidence: `.omo/evidence/regional-localization-agent/f3-rerun.log`
- [ ] F4. Scope fidelity — confirm only america was exercised; confirm no Feishu/Base writes occurred (check API log for `feishu` strings); confirm no publish ZIP was produced. Evidence: `.omo/evidence/regional-localization-agent/f4-scope.log`

## Commit strategy

One conventional commit per todo that has `Commit: Y`, in todo order, on the current branch. Do NOT create a new branch unless the user asks. Do NOT push. Final commit message list:

1. `feat(contracts): add regional culture pack schemas and regional_culture LLM operation`
2. `feat(creative): add buildRegionalCultureRequest prompt builder`
3. `feat(workflows): add RegionalCulturePlanner orchestrator`
4. `feat(creative,workflows): inject regional culture pack into story planner`
5. `feat(api): expose regional culture pack endpoints and wire planner`
6. `test(creative): cover regional culture prompt builder and story-plan injection`
7. `test(api): cover regional culture pack endpoints`
8. `feat(scripts): add regional localization demo driver`
9. (no commit — runtime evidence only)
10. `docs(demo): add regional localization demo guide`

## Success criteria

- All 10 todos completed; F1-F4 all APPROVE.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test:unit`, `pnpm test:integration` all exit 0.
- `outputs/regional-demo-america-*/pipeline-smoke.mp4` exists, is H.264/AAC, 30fps, duration in [8,12]s.
- `outputs/regional-demo-america-*/process-proof.json` lists: 1 culture-pack job, 1 story-plan job, 10 image jobs, 10 video jobs, ≥1 TTS job, 1 render, 1 QC run with verdict `pass`.
- `docs/regional-localization-demo.md` exists with all eight sections.
- No modifications to: `production-workflow.ts`, `LocalizationOrchestrator`, Remotion compositions, provider adapters, Feishu package.
- Demo ran only for `america`; no publish ZIP; no english localization.

