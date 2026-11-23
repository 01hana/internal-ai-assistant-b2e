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
#   ./deploy.sh experience <compose.env>                 # 先唯讀檢查，再寫入並啟用 Assistant 體驗設定（開場、Quick Reply、延伸建議）
#   ./deploy.sh app        <compose.env>                 # 啟動 gateway → 啟用簽章金鑰 → 啟動 core → 啟動後台 API
#   ./deploy.sh admin-bootstrap <compose.env> --account <a> --name <n> --email <e>  # 建立第一個後台帳號（開發工程師），只在沒有任何後台使用者時可執行
#   ./deploy.sh upgrade    <compose.env> <images.tar> <sha256>  # 升級既有部署：備份 → 載入 → 切換 TAG → migration → 體驗設定 → core → gateway → 後台 API → edge
#   ./deploy.sh backup     <compose.env>                 # 備份資料庫到 backups/
#   ./deploy.sh status     <compose.env>                 # 查看本專案容器狀態與最近日誌
#   ./deploy.sh stop       <compose.env>                 # 只停止本專案容器，保留資料與日誌
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-}"; ENV_FILE="${2:-}"
APP_IMAGES=(internal-ai-assistant-core:%s internal-ai-assistant-gateway:%s-amd64 internal-ai-assistant-identity-bridge:%s-amd64 assistant-shinmone-runtime:%s-amd64)

die()  { echo "✗ $*" >&2; exit 1; }
ok()   { echo "✓ $*"; }
warn() { echo "! $*"; }

[ -n "$CMD" ] && [ -n "$ENV_FILE" ] || { sed -n '2,18p' "$0"; exit 1; }
[ -f "$ENV_FILE" ] || die "找不到 compose.env：$ENV_FILE"
ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"

# 只讀取需要的變數，不 source 整個檔案
envval() { { grep -E "^$1=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
TAG="$(envval DEMO_IMAGE_TAG)"
CONFIG_DIR="$(envval DEMO_CONFIG_DIR)"; SECRET_DIR="$(envval DEMO_SECRET_DIR)"; PACK_DIR="$(envval DEMO_CAPABILITY_PACK_DIR)"

PROXY_NET="$(envval DEMO_COMPANY_PROXY_NETWORK)"
# 後台 API 尚未準備好（網域、SMTP）時設 DEMO_ADMIN_ENABLED=false：只部署助理，略過 admin-api
ADMIN_ENABLED="$(envval DEMO_ADMIN_ENABLED)"; ADMIN_ENABLED="${ADMIN_ENABLED:-true}"
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
    [ "$t" -ge "$limit" ] && { dc logs --tail 100 "$svc"; die "$svc 在 ${limit}s 內未 healthy（目前 ${st}）"; }
    sleep 5; t=$((t+5))
  done
}

provision() { # check | prepare | activate-key
  local plan_file plan
  plan_file="$(dirname "$CONFIG_DIR")/public/identity-plan.json"
  [ -s "$plan_file" ] || die "找不到 ${plan_file}，請先執行 host-config.sh"
  [ -s "$DIR/provision/provision.cjs" ] || die "找不到 $DIR/provision/provision.cjs"
  [ -s "$DIR/provision/tool-catalog.json" ] || die "找不到 $DIR/provision/tool-catalog.json，請在開發機執行 deploy/demo/prepare-delivery.sh 後再交付"
  plan="$(python3 -c 'import json,sys;print(json.dumps(json.load(open(sys.argv[1])),separators=(",",":")))' "$plan_file")"
  dc run --rm --no-deps -T -v "$DIR/provision:/provision:ro" -e PROVISION_PLAN_JSON="$plan" \
    gateway node /provision/provision.cjs "$1"
}

experience() { # check | write
  local file="$DIR/provision/assistant-experience.json"
  [ -s "$file" ] || die "找不到 ${file}，請在開發機執行 deploy/demo/prepare-delivery.sh 後再交付"
  local args=(--file /provision/assistant-experience.json); [ "$1" = check ] && args+=(--check)
  # 在 Core image 內執行：以 core.env 的 DATABASE_URL 與已掛載的 Active Pack 驗證每個選項宣告的能力與參數
  dc run --rm --no-deps -T -v "$DIR/provision:/provision:ro" \
    core node dist/src/assistant-experience/provision-assistant-experience.cli.js "${args[@]}"
}

backup_db() { # label
  local dir="$DIR/backups" f
  mkdir -p "$dir"; chmod 700 "$dir"
  f="$dir/assistant-$(date +%Y%m%d-%H%M%S)-$1.sql.gz"
  ( umask 077; dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "$f" ) || die "資料庫備份失敗"
  [ "$(gzip -dc "$f" | head -c 100 | wc -c)" -gt 0 ] || die "備份檔是空的：$f"
  ok "資料庫已備份：${f}（$(du -h "$f" | cut -f1)）"
}

run_migration() {
  dc up -d --pull never --no-build postgres
  wait_healthy postgres 120
  echo "執行 migration（prisma migrate deploy）…"
  dc rm -f -s migrate >/dev/null 2>&1 || true
  dc up -d --pull never --no-build --no-deps migrate
  MID="$(dc ps -aq migrate)"; [ -n "$MID" ] || die "migration 容器未建立"
  CODE="$(docker wait "$MID")"; dc logs --tail 50 migrate
  [ "$CODE" = 0 ] || die "migration 結束碼 ${CODE}，請先檢查日誌再處理，不要用 db push 或 migrate reset"
  ok "migration 完成"
}

start_edge() {
  dc up -d --pull never --no-build --no-deps connector
  wait_healthy connector 120
  dc up -d --pull never --no-build --no-deps connector-tls
  wait_healthy connector-tls 60
  dc up -d --pull never --no-build --no-deps bridge
  wait_healthy bridge 120
}

start_admin() { # 需要 migration 完成、ADMIN_CUSTOMER_ID 已存在（provision 之後）
  if [ "$ADMIN_ENABLED" = false ]; then
    warn "略過後台 API（compose.env 的 DEMO_ADMIN_ENABLED=false）"
    return 0
  fi
  dc up -d --pull never --no-build --no-deps admin-api
  wait_healthy admin-api 120
}

check_images() {
  local tpl ref arch
  for tpl in "${APP_IMAGES[@]}"; do
    ref="$(printf "$tpl" "$TAG")"
    arch="$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}' 2>/dev/null)" || die "尚未載入 image：$ref"
    [ "$arch" = linux/amd64 ] || die "$ref 架構是 ${arch}，不是 linux/amd64"
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
  for v in DEMO_IMAGE_TAG DEMO_POSTGRES_IMAGE DEMO_CADDY_IMAGE DEMO_CONFIG_DIR DEMO_SECRET_DIR DEMO_CAPABILITY_PACK_DIR DEMO_POSTGRES_USER DEMO_POSTGRES_DB DEMO_CONNECTOR_TLS_HOST DEMO_BACKEND_SUBNET DEMO_GATEWAY_HOST_PORT DEMO_BRIDGE_HOST_PORT DEMO_ADMIN_HOST_PORT; do
    [ -n "$(envval $v)" ] || { warn "$v 未設定"; fail=1; }
  done

  echo "== 服務設定檔（${CONFIG_DIR}）"
  for f in database core gateway bridge connector admin; do
    p="$CONFIG_DIR/$f.env"
    if [ ! -f "$p" ]; then warn "缺少 $p"; fail=1; continue; fi
    grep -qE '=REPLACE_WITH_' "$p" && { warn "$f.env 含範本值"; fail=1; }
    local empty; empty="$({ grep -E '^[A-Z0-9_]+=$' "$p" || true; } | cut -d= -f1 | tr '\n' ' ')"
    [ -n "$empty" ] && warn "$f.env 空值（確認是否允許）：$empty"
    [ "$(stat -c %a "$p")" = 600 ] || warn "$f.env 權限是 $(stat -c %a "$p")，建議 600"
  done
  grep -qE '^OPENAI_API_KEY=.+' "$CONFIG_DIR/core.env" 2>/dev/null || { warn "core.env 的 OPENAI_API_KEY 尚未填入"; fail=1; }
  [ -s "$PACK_DIR/shinmone-scm-kpistats.json" ] || { warn "Active Pack 尚未上傳到 $PACK_DIR"; fail=1; }
  if [ "$ADMIN_ENABLED" = false ]; then
    warn "後台 API 未啟用（DEMO_ADMIN_ENABLED=false），略過 admin.env 內容檢查"
  else
  grep -qE '^ADMIN_WEB_ORIGIN=https://' "$CONFIG_DIR/admin.env" 2>/dev/null || { warn "admin.env 的 ADMIN_WEB_ORIGIN 必須是後台網站的 https:// 網址"; fail=1; }
  for v in ADMIN_CUSTOMER_ID ADMIN_MAIL_FROM ADMIN_SMTP_HOST ADMIN_SMTP_PORT; do
    grep -qE "^$v=.+" "$CONFIG_DIR/admin.env" 2>/dev/null || { warn "admin.env 的 $v 尚未填入"; fail=1; }
  done
  # Feature 016：後台的體驗設定編輯以同一份 Capability Pack 驗證
  [ "$(grep -E '^ASSISTANT_CAPABILITY_PACK_PATHS_JSON=' "$CONFIG_DIR/admin.env" 2>/dev/null)" = "$(grep -E '^ASSISTANT_CAPABILITY_PACK_PATHS_JSON=' "$CONFIG_DIR/core.env" 2>/dev/null)" ] \
    || { warn "admin.env 的 ASSISTANT_CAPABILITY_PACK_PATHS_JSON 必須與 core.env 相同"; fail=1; }
  fi
  grep -qE '^GATEWAY_SIGNING_KEY_REFERENCE=file://' "$CONFIG_DIR/gateway.env" 2>/dev/null || { warn "gateway.env 的 GATEWAY_SIGNING_KEY_REFERENCE 必須是 file:///run/secrets/gateway_signing_key"; fail=1; }

  echo "== Secrets（${SECRET_DIR}，只檢查是否存在）"
  for f in postgres-password trusted-ca.pem gateway-signing-key.pem bridge-signing-key.pem bridge-binding-key.pem core-connector-key.pem connector-tls.crt connector-tls.key; do
    [ -s "$SECRET_DIR/$f" ] && ok "$f" || { warn "缺少或空白：$f"; fail=1; }
  done
  [ -d "$PACK_DIR" ] && ok "Active Pack 目錄存在" || { warn "找不到 Active Pack 目錄 $PACK_DIR"; fail=1; }

  echo "== Port 與網段"
  for p in "$(envval DEMO_GATEWAY_HOST_PORT)" "$(envval DEMO_BRIDGE_HOST_PORT)" "$(envval DEMO_ADMIN_HOST_PORT)"; do
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
    run_migration
    echo "下一步：./deploy.sh edge $ENV_FILE" ;;
  edge)
    check_images
    start_edge
    echo "下一步：./deploy.sh provision $ENV_FILE" ;;
  provision)
    check_images
    echo "== 唯讀檢查"; provision check || die "檢查失敗，未寫入任何資料"
    echo; echo "== 寫入"; provision prepare ;;
  experience)
    check_images
    echo "== 唯讀檢查"; experience check || die "檢查失敗，未寫入任何資料"
    echo; echo "== 寫入並啟用"; experience write
    echo "已在執行中的 Core 會在下一次讀取時使用新設定；不需要重啟。" ;;
  app)
    check_images
    dc up -d --pull never --no-build --no-deps gateway
    wait_healthy gateway 120
    provision activate-key || die "Gateway 簽章金鑰啟用失敗，Core 未啟動"
    dc up -d --pull never --no-build --no-deps core
    wait_healthy core 240
    start_admin
    dc ps
    ok "所有服務已啟動。Compose healthy 不等於業務與安全驗收通過，請接著做 E2E 測試。" ;;
  admin-bootstrap)
    [ "$ADMIN_ENABLED" != false ] || die "後台 API 未啟用（DEMO_ADMIN_ENABLED=false）"
    check_images
    # 在後台 API 的 image 與 admin.env 內執行；邀請連結會寄出，並只在這個終端機顯示一次
    dc run --rm --no-deps -T admin-api node dist/src/admin/bootstrap/admin-bootstrap.cli.js "${@:3}" ;;
  backup) backup_db manual ;;
  upgrade)
    TAR="${3:-}"; SUM="${4:-}"
    [ -f "$TAR" ] && [ -f "$SUM" ] || die "用法：./deploy.sh upgrade <compose.env> <images.tar> <sha256>"
    # 從 tar 內的 manifest.json 讀 TAG（以 Core image 的 tag 為準），檔名不影響
    NEW_TAG="$(tar -xOf "$TAR" manifest.json 2>/dev/null | python3 -c '
import json, sys
tags = [t.split(":", 1)[1] for m in json.load(sys.stdin) for t in (m.get("RepoTags") or [])
        if t.startswith("internal-ai-assistant-core:")]
print(tags[0] if len(tags) == 1 else "")' 2>/dev/null || true)"
    [[ "$NEW_TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]] || die "無法從 $TAR 讀出 Core image 的 TAG"
    OLD_TAG="$TAG"
    [ "$NEW_TAG" != "$OLD_TAG" ] || die "新舊 TAG 相同（${NEW_TAG}）"
    [ -s "$DIR/provision/assistant-experience.json" ] || die "缺少 provision/assistant-experience.json（開發機執行 prepare-delivery.sh 後上傳）"
    # Feature 014 起 compose.yaml 含後台 API；缺少設定時整個 compose 專案都無法解析，先停在這裡（尚未改動任何東西）
    [ -s "$CONFIG_DIR/admin.env" ] && [ -n "$(envval DEMO_ADMIN_HOST_PORT)" ] || die "缺少 $CONFIG_DIR/admin.env 或 compose.env 的 DEMO_ADMIN_HOST_PORT（見 README「後台 API」），未做任何變更"
    echo "== 升級 $OLD_TAG → $NEW_TAG"
    [ "$(sha256sum "$TAR" | cut -c1-64)" = "$(cut -c1-64 "$SUM")" ] && ok "SHA-256 校驗通過" || die "SHA-256 不符，停止"
    docker load -i "$TAR"
    TAG="$NEW_TAG"; check_images
    echo; echo "== 1/6 備份資料庫"; backup_db "before-$NEW_TAG"
    echo; echo "== 2/6 切換 DEMO_IMAGE_TAG"
    cp "$ENV_FILE" "$ENV_FILE.bak-$OLD_TAG"
    sed -i "s/^DEMO_IMAGE_TAG=.*/DEMO_IMAGE_TAG=$NEW_TAG/" "$ENV_FILE"
    [ "$(envval DEMO_IMAGE_TAG)" = "$NEW_TAG" ] || die "compose.env 更新失敗"
    ok "DEMO_IMAGE_TAG=${NEW_TAG}（舊設定保存在 $(basename "$ENV_FILE").bak-${OLD_TAG}）"
    echo; echo "== 3/6 Migration"; run_migration
    echo; echo "== 4/6 體驗設定"
    experience check || die "體驗設定檢查失敗，未寫入；服務仍在舊版執行"
    experience write
    echo; echo "== 5/6 Core → Gateway → 後台 API（Core 先升級，避免新 Gateway 轉發舊 Core 不認得的請求）"
    dc up -d --pull never --no-build --no-deps core
    wait_healthy core 240
    dc up -d --pull never --no-build --no-deps gateway
    wait_healthy gateway 120
    provision activate-key || die "Gateway 簽章金鑰檢查失敗"
    start_admin
    echo; echo "== 6/6 Connector / Bridge"
    start_edge
    echo; dc ps
    ok "升級完成：$NEW_TAG"
    echo "回滾：把 compose.env 換回 $(basename "$ENV_FILE").bak-${OLD_TAG}，再依序重建 core、gateway、edge（migration 不倒退）" ;;
  status) dc ps; dc logs --tail 100 ;;
  stop)   dc stop ;;
  *) die "未知指令：$CMD" ;;
esac
