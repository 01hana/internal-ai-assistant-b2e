#!/usr/bin/env bash
# 本機 Agentic SDD 的安全入口；workflow state 由 Spec Kit 管理。
set -euo pipefail

workflow='.specify/workflows/agentic-sdd-local/workflow.yml'

usage() {
  cat <<'EOF'
用法：
  scripts/agentic-sdd.sh start --spec "功能描述" [--scope full]
  scripts/agentic-sdd.sh resume <run-id>
  scripts/agentic-sdd.sh status [run-id]

注意：此入口不會自動部署，也不會繞過人工 Gate。詳細流程見 docs/agentic-sdd-workflow.md。
EOF
}

case "${1:-}" in
  start)
    shift
    spec=''
    scope='full'
    while (($#)); do
      case "$1" in
        --spec) spec="${2:?--spec 需要功能描述}"; shift 2 ;;
        --scope) scope="${2:?--scope 需要範圍}"; shift 2 ;;
        *) printf '未知參數：%s\n' "$1" >&2; usage >&2; exit 2 ;;
      esac
    done
    [[ -n "$spec" ]] || { printf '%s\n' '必須提供 --spec。' >&2; usage >&2; exit 2; }
    exec specify workflow run "$workflow" --input "spec=$spec" --input "scope=$scope"
    ;;
  resume)
    [[ $# -eq 2 ]] || { usage >&2; exit 2; }
    exec specify workflow resume "$2"
    ;;
  status)
    shift
    exec specify workflow status "$@"
    ;;
  -h|--help|help|'') usage ;;
  *) printf '未知子命令：%s\n' "$1" >&2; usage >&2; exit 2 ;;
esac
