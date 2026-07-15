#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

pnpm install --frozen-lockfile=false
pnpm infra:up
pnpm contracts:generate
pnpm build
pnpm db:migrate
pnpm db:seed
pnpm design:compile
pnpm providers:check

exec pnpm dev
