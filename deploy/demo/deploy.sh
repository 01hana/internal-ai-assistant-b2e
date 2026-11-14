#!/usr/bin/env bash
# Assistant Backend 分階段部署腳本（在公司 Linux 主機上執行）
# 依 README.md 與 CONFIGURATION-AND-PROVISIONING-PREPARATION.md 的順序，
# 每一步都會檢查前一步，失敗就停止（fail closed）。不會執行 down -v、db push、migrate reset。
#
# 用法：
#   ./deploy.sh preflight  <compose.env>                 # 主機與設定檢查，不改任何東西
#   ./deploy.sh load       <compose.env> <images.tar> [sha256]  # 校驗並載入 image
#   ./deploy.sh db         <compose.env>                 # 啟動 PostgreSQL 並執行 migration
#   ./deploy.sh edge       <compose.env>                 # 啟動 connector、connector-tls、bridge
#   ./deploy.sh provision  <compose.env>                 # 先唯讀檢查，再建立 Customer、TrustProfile、簽章金鑰、工具政策
#   ./deploy.sh app        <compose.env>                 # 啟動 gateway → 啟用簽章金鑰 → 啟動 core
#   ./deploy.sh status     <compose.env>                 # 查看本專案容器狀態與最近日誌
#   ./deploy.sh stop       <compose.env>                 # 只停止本專案容器，保留資料與日誌
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-}"; ENV_FILE="${2:-}"
APP_IMAGES=(internal-ai-assistant-core:%s internal-ai-assistant-gateway:%s-amd64 internal-ai-assistant-identity-bridge:%s-amd64 assistant-shinmone-runtime:%s-amd64)

die()  { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✓ $*"; }
warn() { echo "! $*"; }

[ -n "$CMD" ] && [ -n "$ENV_FILE" ] || { sed -n '2,15p' "$0"; exit 1; }
[ -f "$ENV_FILE" ] || die "找不到 compose.env：$ENV_FILE"
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

# 只讀取需要的變數，不 source 整個檔案
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
TAG="$(envval DEMO_IMAGE_TAG)"
CONFIG_DIR="$(envval DEMO_CONFIG_DIR)"; SECRET_DIR="$(envval DEMO_SECRET_DIR)"; PACK_DIR="$(envval DEMO_CAPABILITY_PACK_DIR)"

PROXY_NET="$(envval DEMO_COMPANY_PROXY_NETWORK)"
dc() {
  local files=(-f "$DIR/compose.yaml" -f "$DIR/compose.images.yaml")
  [ -n "$PROXY_NET" ] && files+=(-f "$DIR/compose.company-nginx.yaml")
  docker compose --env-file "$ENV_FILE" "${files[@]}" "$@"
}

wait_healthy() { # 服務名稱, 秒數
  local svc="$1" limit="${2:-180}" t=0 id st
  id="$(dc ps -q "$svc")"; [ -n "$id" ] || die "$svc 沒有在執行"
  while :; do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id")"
    [ "$st" = healthy ] && { ok "$svc healthy"; return; }
    [ "$st" = unhealthy ] || [ "$st" = exited ] && { dc logs --tail 100 "$svc"; die "$svc 狀態為 $st"; }
    [ "$t" -ge "$limit" ] && { dc logs --tail 100 "$svc"; die "$svc 在 ${limit}s 內未 healthy（目前 $st）"; }
    sleep 5; t=$((t+5))
  done
}

provision() { # check | prepare | activate-key
  local plan_file plan
  plan_file="$(dirname "$CONFIG_DIR")/public/identity-plan.json"
  [ -s "$plan_file" ] || die "找不到 $plan_file，請先執行 host-config.sh"
  [ -s "$DIR/provision/provision.cjs" ] || die "找不到 $DIR/provision/provision.cjs"
  [ -s "$DIR/provision/tool-catalog.json" ] || die "找不到 $DIR/provision/tool-catalog.json，請在開發機執行 deploy/demo/prepare-delivery.sh 後再交付"
  plan="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1])),separators=(",",":")))' "$plan_file")"
  dc run --rm --no-deps -T -v "$DIR/provision:/provision:ro" -e PROVISION_PLAN_JSON="$plan" \
    gateway node /provision/provision.cjs "$1"
}

check_images() {
  local tpl ref arch
  for tpl in "${APP_IMAGES[@]}"; do
    ref="$(printf "$tpl" "$TAG")"
    arch="$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}' 2>/dev/null)" || die "尚未載入 image：$ref"
    [ "$arch" = linux/amd64 ] || die "$ref 架構是 $arch，不是 linux/amd64"
    ok "$ref ($arch)"
  done
}

preflight() {
  local fail=0 f p
  echo "== 主機"
  [ "$(uname -m)" = x86_64 ] && ok "CPU 架構 x86_64" || { warn "CPU 架構是 $(uname -m)，image 為 amd64"; fail=1; }
  docker info >/dev/null 2>&1 && ok "Docker Engine 可用" || die "無法連線 Docker Engine（權限或服務未啟動）"
  docker compose version >/dev/null 2>&1 && ok "$(docker compose version)" || die "缺少 docker compose v2"

  echo "== compose.env"
  if grep -nE '=(REPLACE_WITH_|/absolute/path/)' "$ENV_FILE"; then warn "上列仍是範本值"; fail=1; else ok "沒有範本佔位值"; fi
  for v in DEMO_IMAGE_TAG DEMO_POSTGRES_IMAGE DEMO_CADDY_IMAGE DEMO_CONFIG_DIR DEMO_SECRET_DIR DEMO_CAPABILITY_PACK_DIR DEMO_POSTGRES_USER DEMO_POSTGRES_DB DEMO_CONNECTOR_TLS_HOST DEMO_BACKEND_SUBNET DEMO_GATEWAY_HOST_PORT DEMO_BRIDGE_HOST_PORT; do
    [ -n "$(envval $v)" ] || { warn "$v 未設定"; fail=1; }
  done

  echo "== 服務設定檔（$CONFIG_DIR）"
  for f in database core gateway bridge connector; do
    p="$CONFIG_DIR/$f.env"
    if [ ! -f "$p" ]; then warn "缺少 $p"; fail=1; continue; fi
    grep -qE '=REPLACE_WITH_' "$p" && { warn "$f.env 含範本值"; fail=1; }
    local empty; empty="$({ grep -E '^[A-Z0-9_]+=$' "$p" || true; } | cut -d= -f1 | tr '\n' ' ')"
    [ -n "$empty" ] && warn "$f.env 空值（確認是否允許）：$empty"
    [ "$(stat -c %a "$p")" = 600 ] || warn "$f.env 權限是 $(stat -c %a "$p")，建議 600"
  done
  grep -qE '^OPENAI_API_KEY=.+' "$CONFIG_DIR/core.env" 2>/dev/null || { warn "core.env 的 OPENAI_API_KEY 尚未填入"; fail=1; }
  [ -s "$PACK_DIR/shinmone-scm-kpistats.json" ] || { warn "Active Pack 尚未上傳到 $PACK_DIR"; fail=1; }
  grep -qE '^GATEWAY_SIGNING_KEY_REFERENCE=file://' "$CONFIG_DIR/gateway.env" 2>/dev/null || { warn "gateway.env 的 GATEWAY_SIGNING_KEY_REFERENCE 必須是 file:///run/secrets/gateway_signing_key"; fail=1; }

  echo "== Secrets（$SECRET_DIR，只檢查是否存在）"
  for f in postgres-password trusted-ca.pem gateway-signing-key.pem bridge-signing-key.pem bridge-binding-key.pem core-connector-key.pem connector-tls.crt connector-tls.key; do
    [ -s "$SECRET_DIR/$f" ] && ok "$f" || { warn "缺少或空白：$f"; fail=1; }
  done
  [ -d "$PACK_DIR" ] && ok "Active Pack 目錄存在" || { warn "找不到 Active Pack 目錄 $PACK_DIR"; fail=1; }

  echo "== Port 與網段"
  for p in "$(envval DEMO_GATEWAY_HOST_PORT)" "$(envval DEMO_BRIDGE_HOST_PORT)"; do
    [ -z "$p" ] && continue
    if ss -ltn "( sport = :$p )" 2>/dev/null | grep -q LISTEN; then
      dc ps --format '{{.Publishers}}' 2>/dev/null | grep -q ":$p->" && ok "127.0.0.1:$p 由本專案使用中" || { warn "Port $p 已被其他程式占用"; fail=1; }
    else ok "Port $p 可用"; fi
  done
  local sub; sub="$(envval DEMO_BACKEND_SUBNET)"
  if [ -n "$sub" ]; then
    local overlap
    overlap="$(ip -4 route show 2>/dev/null | python3 -c '
import ipaddress, sys
want = ipaddress.ip_network(sys.argv[1], strict=False)
for line in sys.stdin:
    dst = line.split()[0] if line.strip() else ""
    if dst == "default": continue
    try: net = ipaddress.ip_network(dst, strict=False)
    except ValueError: continue
    if net.overlaps(want): print(line.strip())
' "$sub")"
    if [ -n "$overlap" ]; then
      if dc ps -q 2>/dev/null | grep -q . && echo "$overlap" | grep -q "br-"; then ok "網段 $sub 由本專案使用中"
      else warn "DEMO_BACKEND_SUBNET $sub 與以下路由重疊："; echo "$overlap" | sed 's/^/    /'; fail=1; fi
    else ok "網段 $sub 沒有衝突"; fi
  fi

  if [ -n "$PROXY_NET" ]; then
    docker network inspect "$PROXY_NET" >/dev/null 2>&1 && ok "公司反向代理網路 $PROXY_NET 存在" || { warn "找不到 Docker 網路 $PROXY_NET"; fail=1; }
  fi

  echo "== Compose 語法"
  if dc config --quiet; then ok "compose 設定可解析"; else fail=1; fi

  [ "$fail" = 0 ] && ok "Preflight 通過" || die "Preflight 未通過，請修正上列項目"
}

case "$CMD" in
  preflight) preflight ;;
  load)
    TAR="${3:-}"; SUM="${4:-}"; [ -f "$TAR" ] || die "找不到 image 檔：$TAR"
    if [ -n "$SUM" ]; then
      [ "$(sha256sum "$TAR" | cut -c1-64)" = "$(cut -c1-64 "$SUM")" ] && ok "SHA-256 校驗通過" || die "SHA-256 不符，停止"
    else warn "未提供 .sha256，略過完整性校驗"; fi
    docker load -i "$TAR"
    check_images ;;
  db)
    check_images
    dc up -d --pull never --no-build postgres
    wait_healthy postgres 120
    echo "執行 migration（prisma migrate deploy）…"
    dc up -d --pull never --no-build --no-deps migrate
    MID="$(dc ps -aq migrate)"; [ -n "$MID" ] || die "migration 容器未建立"
    CODE="$(docker wait "$MID")"; dc logs --tail 50 migrate
    [ "$CODE" = 0 ] || die "migration 結束碼 $CODE，請先檢查日誌再處理，不要用 db push 或 migrate reset"
    ok "migration 完成"
    echo "下一步：./deploy.sh edge $ENV_FILE" ;;
  edge)
    check_images
    dc up -d --pull never --no-build --no-deps connector
    wait_healthy connector 120
    dc up -d --pull never --no-build --no-deps connector-tls
    wait_healthy connector-tls 60
    dc up -d --pull never --no-build --no-deps bridge
    wait_healthy bridge 120
    echo "下一步：./deploy.sh provision $ENV_FILE" ;;
  provision)
    check_images
    echo "== 唯讀檢查"; provision check || die "檢查失敗，未寫入任何資料"
    echo; echo "== 寫入"; provision prepare ;;
  app)
    check_images
    dc up -d --pull never --no-build --no-deps gateway
    wait_healthy gateway 120
    provision activate-key || die "Gateway 簽章金鑰啟用失敗，Core 未啟動"
    dc up -d --pull never --no-build --no-deps core
    wait_healthy core 240
    dc ps
    ok "所有服務已啟動。Compose healthy 不等於業務與安全驗收通過，請接著做 E2E 測試。" ;;
  status) dc ps; dc logs --tail 100 ;;
  stop)   dc stop ;;
  *) die "未知指令：$CMD" ;;
esac
