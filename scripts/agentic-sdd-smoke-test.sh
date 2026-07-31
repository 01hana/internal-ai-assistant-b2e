#!/usr/bin/env bash
# 只驗證 workflow YAML、腳本語法與本機 CLI 能力；不執行任何 Feature。
set -euo pipefail

workflow='.specify/workflows/agentic-sdd-local/workflow.yml'
bash -n scripts/quality-gate.sh scripts/agentic-sdd.sh scripts/agentic-sdd-smoke-test.sh
workflow_info="$(specify workflow info "$workflow")"
printf '%s\n' "$workflow_info" | grep -q '本機 Agentic SDD 閉環'
printf '%s\n' "$workflow_info" | grep -q 'quality-gate'
printf '%s\n' "Workflow YAML 結構檢查通過：$workflow"
printf '%s\n' 'Agentic SDD smoke test 通過。'
