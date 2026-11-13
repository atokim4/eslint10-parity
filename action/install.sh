#!/usr/bin/env bash
# Installs a checkout's dependencies the way its lockfile asks for. $1: "auto" or a command to run as is.
set -euo pipefail
cmd="${1:-auto}"
if [ "$cmd" != "auto" ]; then
  bash -c "$cmd"
  exit 0
fi
if [ -f pnpm-lock.yaml ]; then
  corepack enable >/dev/null 2>&1 || true
  pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  corepack enable >/dev/null 2>&1 || true
  if [ -f .yarnrc.yml ]; then yarn install --immutable; else yarn install --frozen-lockfile; fi
elif [ -f bun.lock ] || [ -f bun.lockb ]; then
  bun install --frozen-lockfile
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install --no-package-lock
fi
