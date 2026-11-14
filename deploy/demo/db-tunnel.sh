#!/usr/bin/env bash
# 讓 pgAdmin 等圖形工具查看資料庫（在主機上執行）。
#   bash db-tunnel.sh readonly-user   建立唯讀帳號 assistant_readonly（只需一次，可重複執行）
#   bash db-tunnel.sh start           在 127.0.0.1:15432 開一個暫時的轉接入口
#   bash db-tunnel.sh stop            關閉轉接入口（用完請關）
#   bash db-tunnel.sh status
# 轉接容器只綁 127.0.0.1，外部無法直接連入；從 Mac 需透過 SSH tunnel。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEC="$DIR/secrets"
PG=shinmone-assistant-demo-postgres-1
NET=shinmone-assistant-demo_backend
TUNNEL=ai-assistant-db-tunnel
PORT="${DB_TUNNEL_PORT:-15432}"
IMAGE="${DB_TUNNEL_IMAGE:-nginx:alpine}"
ok() { echo "✓ $*"; }; die() { echo "✗ $*" >&2; exit 1; }

docker inspect "$PG" >/dev/null 2>&1 || die "找不到資料庫容器 $PG"

case "${1:-}" in
  readonly-user)
    umask 077
    [ -s "$SEC/postgres-readonly-password" ] || openssl rand -hex 16 | tr -d '\n' > "$SEC/postgres-readonly-password"
    PW="$(cat "$SEC/postgres-readonly-password")"
    docker exec -i "$PG" psql -q -U assistant -d assistant -v ON_ERROR_STOP=1 <<SQL
DO \$\$BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'assistant_readonly') THEN
    CREATE ROLE assistant_readonly LOGIN PASSWORD '$PW';
  ELSE
    ALTER ROLE assistant_readonly LOGIN PASSWORD '$PW';
  END IF;
END\$\$;
GRANT CONNECT ON DATABASE assistant TO assistant_readonly;
GRANT USAGE ON SCHEMA public TO assistant_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO assistant_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE assistant IN SCHEMA public GRANT SELECT ON TABLES TO assistant_readonly;
ALTER ROLE assistant_readonly SET default_transaction_read_only = on;
SQL
    ok "唯讀帳號 assistant_readonly 已就緒"
    echo "  密碼存在 $SEC/postgres-readonly-password（用 cat 查看，不要貼到聊天或文件中）" ;;
  start)
    if docker inspect "$TUNNEL" >/dev/null 2>&1; then
      docker start "$TUNNEL" >/dev/null; ok "轉接入口已在 127.0.0.1:$PORT"; exit 0
    fi
    docker image inspect "$IMAGE" >/dev/null 2>&1 || die "主機上沒有 $IMAGE"
    CONF="$DIR/db-tunnel.nginx.conf"
    printf 'events {}\nstream {\n  server {\n    listen 5432;\n    proxy_connect_timeout 5s;\n    proxy_pass postgres:5432;\n  }\n}\n' > "$CONF"
    chmod 644 "$CONF"
    docker create --name "$TUNNEL" --restart no --network bridge \
      -p "127.0.0.1:$PORT:5432" -v "$CONF:/etc/nginx/nginx.conf:ro" "$IMAGE" >/dev/null
    docker network connect "$NET" "$TUNNEL"     # 先接上內部網路，nginx 才解析得到 postgres
    docker start "$TUNNEL" >/dev/null
    sleep 1
    [ "$(docker inspect -f '{{.State.Running}}' "$TUNNEL")" = true ] || { docker logs "$TUNNEL"; die "轉接容器啟動失敗"; }
    ok "轉接入口已開在 127.0.0.1:$PORT（用完請執行 bash db-tunnel.sh stop）" ;;
  stop)
    if docker inspect "$TUNNEL" >/dev/null 2>&1; then docker rm -f "$TUNNEL" >/dev/null; ok "轉接入口已關閉"; else ok "轉接入口原本就沒開"; fi ;;
  status)
    docker ps -a --filter "name=^${TUNNEL}$" --format '{{.Names}}  {{.Status}}  {{.Ports}}' | grep . || echo "轉接入口未開啟" ;;
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
