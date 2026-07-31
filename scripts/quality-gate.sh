#!/usr/bin/env bash
# 確定性唯讀驗證 Gate：不產生或修改任何專案程式碼。
set -euo pipefail

run_stage() {
  local stage="$1"
  shift
  printf '\n==> Quality Gate：%s\n' "$stage"
  if ! "$@"; then
    printf 'Quality Gate 失敗階段：%s\n' "$stage" >&2
    exit 1
  fi
}

run_stage 'lint' npm run lint
run_stage 'typecheck' npm run typecheck
run_stage 'unit test' npm run test:unit
run_stage 'integration test' npm run test:integration
run_stage 'contract test' npm run test:contract
run_stage 'E2E test' npm run test:e2e

printf '\nQuality Gate 通過。\n'
