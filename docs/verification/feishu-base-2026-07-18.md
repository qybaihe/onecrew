# Feishu Base verification - 2026-07-18

## Scope

The local, Git-ignored `.env` provided a Feishu custom-app credential and Base token. No credential, token, table ID, or record content is included in this report.

## Command

```bash
pnpm feishu:setup
```

## Result

- The setup report returned `mode: real`.
- The app obtained tenant access and discovered the configured Base.
- All six control-plane tables were present: Project, Shot, Asset, Generation Job, QC, and Overseas Experiment.
- Every locked field in `packages/feishu/src/base-schema.ts` matched the real table schema.
- No table or field was created or changed during verification.

The repository regression also passed 15 Feishu unit tests, three persistent card-action integration tests, and five API route tests. These cover signature and replay checks, AES-256-CBC payloads, URL verification envelopes, Card 2.0 callback normalization, actor authorization, optimistic target versions, event idempotency, all four recovery actions, and audit persistence.

## Remaining live checks

- Register both public callback URLs and complete the live URL verification challenge.
- Deliver an interactive approval card to the configured recipient.
- Click Approve, Regenerate, Switch provider, and Manual in the real tenant, then verify `audit_logs` and `human_gates`.

This result proves live Base access and schema compatibility. It does not claim that the callback and interactive-card loop has completed in the real tenant.
