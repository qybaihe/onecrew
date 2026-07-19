---
slug: regional-localization-agent
status: approved
intent: clear
review_required: false
pending-action: execute
approach: Insert a new RegionalCulturePlanner agent before story planning (brief+region→culture pack JSON), make CreativeStoryPlanner consume the pack, then run a minimal Mock pipeline (culture→1 episode+10 shots→10 images→10 videos→zh TTS→~10s PipelineSmoke render→QC), and document the flow in docs/regional-localization-demo.md.
---

# Draft: regional-localization-agent

## Components (topology ledger)

| id | outcome | status | evidence path |
| --- | --- | --- | --- |
| C1 contracts | regionalCulturePack schema + regionalCulturePackRequest schema + new llm operation value 'regional_culture' | active | packages/contracts/src/index.ts |
| C2 prompt builder | buildRegionalCultureRequest in @onecrew/creative producing LlmProviderRequest | active | packages/creative/src/regional-culture.ts |
| C3 orchestrator | RegionalCulturePlanner (submit/preview) in @onecrew/workflows | active | packages/workflows/src/regional-culture-planner.ts |
| C4 story planner integration | CreativeStoryPlanner accepts optional regionalCulturePackJobId; buildCreativeStoryPlanRequest injects culture pack into prompt | active | packages/workflows/src/creative-story-planner.ts + packages/creative/src/story-plan.ts |
| C5 api routes | POST/GET /v1/creative/projects/:id/regional-culture-packs wired | active | apps/api/src/creative-routes.ts + apps/api/src/app.ts + apps/worker wiring |
| C6 demo script | scripts/demo-regional-localization.mjs runs the minimal chain end-to-end in Mock mode | active | scripts/demo-regional-localization.mjs |
| C7 docs | docs/regional-localization-demo.md with steps + rationale + Claimed-by-the-Dragon analysis | active | docs/regional-localization-demo.md |

## Open assumptions (announced defaults)

| assumption | adopted default | rationale | reversible? |
| --- | --- | --- | --- |
| default region for live demo | america | user confirmed; russia/uk remain parameterised | yes |
| video length for demo | ~10s via PipelineSmoke composition | only built-in comp that supports 1-15s; Teaser15Vertical is fixed 15s | yes |
| LLM prompt language | Chinese system+user, JSON values may contain English | matches buildCreativeStoryPlanRequest convention | yes |
| test strategy | tests-after (unit + integration) | repo already has strong Mock infra; TDD would slow demo path | yes |
| apply() for culture pack | not implemented; culture pack stays as Job artifact referenced by id | keeps single source of truth; story-planner reads Job output directly | yes |

## Findings (cited - path:lines)

- No `Agent` abstraction in repo; pattern is `Orchestrator class + ProviderOrchestrator + ProviderGateway + capability adapter` (packages/workflows/src/*.ts, packages/providers/src/gateway.ts:100-155, registry.ts:23-30).
- Existing story planner: `CreativeStoryPlanner.submit` calls `buildCreativeStoryPlanRequest` and submits to ProviderOrchestrator (packages/workflows/src/creative-story-planner.ts:39-53; packages/creative/src/story-plan.ts:54-96).
- LLM request contract: `llmProviderRequestSchema` has `operation: z.enum(['script','translate','marketing_copy'])` (packages/contracts/src/index.ts:1062-1071).
- Existing localization orchestrator is translation-only, not cultural (packages/workflows/src/localization-orchestrator.ts).
- Demo script lives at apps/remotion/scripts/stage7-process-smoke.ts (not root scripts/); no 10s composition exists; PipelineSmoke supports 1-15s (apps/remotion/src/manifest.ts:229-234).
- API creative routes are wired via `CreativeRouteOptions.storyPlanner` (apps/api/src/creative-routes.ts:72); new endpoints follow same pattern.
- Successful overseas case "Claimed by the Dragon" (ReelShort 2026): dragon curse + fated-mate trope + US middle-aged female audience + vertical cliffhanger structure (web research).

## Decisions (with rationale)

- Fork 1: insert regional agent BEFORE story planning, not after — user explicitly chose; matches "一开始就为该地区写戏" intent.
- Fork 2: run minimal chain (1 episode + 10 shots + 1 short video) not full demo:mock-e2e — user explicitly chose; keeps new agent visible, 10-15 min runtime.
- Fork 3: deliverable is pure Markdown doc at docs/regional-localization-demo.md — user explicitly chose; we will still cite outputs/ paths in prose but not embed images.
- Add new LLM operation enum value 'regional_culture' rather than reuse 'script' — keeps provider logs/budget distinguishable; adapters currently ignore operation so no adapter change needed.
- Culture pack NOT persisted as CreativeEntity — it is a transient Job output referenced by jobId from story plan request; avoids polluting entity repository and matches "preview/apply" mental model.

## Scope IN

- C1-C7 above (contracts, prompt builder, orchestrator, story planner integration, api routes, demo script, docs).
- Unit tests for buildRegionalCultureRequest + story-plan prompt injection; integration test for new API endpoints (idempotency + happy/failure).
- Demo run in Mock mode producing outputs/regional-demo-america-<ts>/ with ~10s MP4 + process-proof.json.

## Scope OUT (Must NOT have)

- Do NOT modify production-workflow.ts LangGraph (no new stage node).
- Do NOT touch LocalizationOrchestrator (still translation-only).
- Do NOT implement apply() for culture pack.
- Do NOT run english localization / promo renders / publish ZIP.
- Do NOT integrate Feishu or Base.
- Do NOT scrape real ReelShort catalogues; culture pack comes from LLM knowledge with Claimed-by-the-Dragon as prompt-cited case.
- Do NOT run live demo for russia or uk; only america is exercised end-to-end.
- Do NOT modify apps/remotion compositions or add a new one.

## Open questions

(none — all forks resolved with user)

## Approval gate

status: approved (user said "批准 写好计划后直接执行" on 2026-07-19)
pending action: write .omo/plans/regional-localization-agent.md then execute todos.
