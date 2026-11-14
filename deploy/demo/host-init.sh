#!/usr/bin/env bash
# 主機初始化：在部署主機上產生部署需要的目錄、金鑰、內部 CA、TLS 憑證與資料庫密碼。
# - 已存在的檔案一律不覆蓋，可以安全地重複執行。
# - 私鑰與密碼只寫入檔案，不會印到畫面上。
# 用法：IMAGE_TAG=<image tag> PROXY_CONTAINER=<反向代理容器名稱> bash host-init.sh
#       部署目錄預設為 ~/BackEndDockerData/ai-assistant-demo，可用 AI_ASSISTANT_HOME=/路徑 覆寫
set -euo pipefail
umask 077

BASE="${AI_ASSISTANT_HOME:-$HOME/BackEndDockerData/ai-assistant-demo}"
CONNECTOR_TLS_HOST="${CONNECTOR_TLS_HOST:-connector-tls.ai-assistant.internal}"
PROXY_CONTAINER="${PROXY_CONTAINER:?請提供 PROXY_CONTAINER（公司反向代理的容器名稱）}"
IMAGE_TAG="${IMAGE_TAG:?請提供 IMAGE_TAG}"
CFG="$BASE/config"; SEC="$BASE/secrets"; PUB="$BASE/public"; CA="$BASE/ca"; PACK="$BASE/packs"

ok()   { echo "✓ $*"; }
skip() { echo "· $*（已存在，略過）"; }
die()  { echo "✗ $*" >&2; exit 1; }

command -v openssl >/dev/null || die "缺少 openssl"
command -v python3 >/dev/null || die "缺少 python3"
command -v docker  >/dev/null || die "缺少 docker"

[ -f "$BASE/compose.yaml" ] || die "$BASE 裡找不到 compose.yaml，請確認部署目錄"
mkdir -p "$CFG" "$SEC" "$PUB" "$CA" "$PACK"
chmod 700 "$CFG" "$SEC" "$CA"; chmod 755 "$PACK" "$PUB"
ok "目錄：$BASE"

# ---------- 資料庫密碼 ----------
if [ -s "$SEC/postgres-password" ]; then skip "postgres-password"
else openssl rand -hex 24 | tr -d '\n' > "$SEC/postgres-password"; ok "postgres-password"; fi

# ---------- 四把用途不同的 RSA 簽章金鑰（PKCS#8）與 public JWK ----------
jwk_from_key() { # 私鑰路徑 → 輸出 public JWK JSON（含 RFC 7638 thumbprint 當 kid）
  local n
  n="$(openssl rsa -in "$1" -noout -modulus 2>/dev/null | cut -d= -f2)"
  python3 -I - "$n" <<'PY'
import base64, hashlib, json, sys
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
n = b64(bytes.fromhex(sys.argv[1])); e = "AQAB"
kid = b64(hashlib.sha256(json.dumps({"e": e, "kty": "RSA", "n": n}, separators=(",", ":"), sort_keys=True).encode()).digest())
print(json.dumps({"kty": "RSA", "alg": "RS256", "use": "sig", "kid": kid, "n": n, "e": e}))
PY
}
for name in gateway-signing-key bridge-signing-key bridge-binding-key core-connector-key; do
  if [ -s "$SEC/$name.pem" ]; then skip "$name.pem"
  else openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$SEC/$name.pem" 2>/dev/null; ok "$name.pem"; fi
  jwk_from_key "$SEC/$name.pem" > "$PUB/$name.jwk.json"
  [ "$(openssl rsa -in "$SEC/$name.pem" -noout -text 2>/dev/null | grep -c 'publicExponent: 65537')" = 1 ] || die "$name 的 exponent 不是 65537"
done

# ---------- 內部 CA 與 Connector TLS 憑證（只在 Docker 內部網路使用） ----------
if [ -s "$CA/ca.key" ]; then skip "內部 CA"
else
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -sha256 \
    -subj "/CN=AI Assistant Internal CA" -keyout "$CA/ca.key" -out "$CA/ca.crt" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>/dev/null
  ok "內部 CA（10 年）"
fi
cp "$CA/ca.crt" "$SEC/trusted-ca.pem"

if [ -s "$SEC/connector-tls.crt" ]; then skip "connector-tls 憑證"
else
  openssl req -newkey rsa:2048 -nodes -subj "/CN=$CONNECTOR_TLS_HOST" -keyout "$SEC/connector-tls.key" -out "$CA/connector-tls.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n' "$CONNECTOR_TLS_HOST" > "$CA/connector-tls.ext"
  openssl x509 -req -in "$CA/connector-tls.csr" -CA "$CA/ca.crt" -CAkey "$CA/ca.key" -CAcreateserial \
    -days 825 -sha256 -extfile "$CA/connector-tls.ext" -out "$SEC/connector-tls.crt" 2>/dev/null
  ok "connector-tls 憑證（SAN=$CONNECTOR_TLS_HOST，825 天）"
fi
openssl verify -CAfile "$SEC/trusted-ca.pem" "$SEC/connector-tls.crt" >/dev/null || die "connector-tls 憑證驗證失敗"

# ---------- 容器讀取權限 ----------
# Gateway/Bridge/Connector 以 node（uid 1000）執行，需要能讀自己的金鑰與 CA。
chmod 600 "$SEC"/*.pem "$SEC"/*.key "$SEC/postgres-password" "$SEC/connector-tls.crt"
chmod 644 "$SEC/trusted-ca.pem"
if [ "$(id -u)" != 1000 ]; then
  echo "! 你的 uid 是 $(id -u)，不是 1000。請執行以下指令讓容器讀得到金鑰："
  echo "  sudo chown 1000 $SEC/gateway-signing-key.pem $SEC/bridge-signing-key.pem $SEC/bridge-binding-key.pem"
fi

# ---------- Image digest ----------
PG_REF="$(docker image inspect postgres:16-alpine --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
[ -n "$PG_REF" ] || die "主機上找不到 postgres:16-alpine 的 digest"
if ! docker image inspect caddy:2-alpine >/dev/null 2>&1; then
  echo "下載 caddy:2-alpine…"; docker pull -q caddy:2-alpine >/dev/null
fi
CADDY_REF="$(docker image inspect caddy:2-alpine --format '{{index .RepoDigests 0}}')"
ok "PostgreSQL：$PG_REF"; ok "Caddy：$CADDY_REF"

# ---------- 公司反向代理網路 ----------
PROXY_NET="$(docker inspect "$PROXY_CONTAINER" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | awk '{print $1}')"
[ -n "$PROXY_NET" ] && ok "$PROXY_CONTAINER 所在網路：$PROXY_NET" || die "找不到 $PROXY_CONTAINER 的網路"

# ---------- compose.env 與 database.env ----------
PGPW="$(cat "$SEC/postgres-password")"
if [ -s "$CFG/compose.env" ]; then skip "compose.env"
else cat > "$CFG/compose.env" <<ENV
DEMO_IMAGE_TAG=$IMAGE_TAG
DEMO_POSTGRES_IMAGE=$PG_REF
DEMO_CADDY_IMAGE=$CADDY_REF
DEMO_CONFIG_DIR=$CFG
DEMO_SECRET_DIR=$SEC
DEMO_CAPABILITY_PACK_DIR=$PACK
DEMO_POSTGRES_USER=assistant
DEMO_POSTGRES_DB=assistant
DEMO_CONNECTOR_TLS_HOST=$CONNECTOR_TLS_HOST
DEMO_BACKEND_SUBNET=172.31.250.0/24
DEMO_GATEWAY_HOST_PORT=14000
DEMO_BRIDGE_HOST_PORT=13107
DEMO_COMPANY_PROXY_NETWORK=$PROXY_NET
ENV
ok "compose.env"; fi
if [ -s "$CFG/database.env" ]; then skip "database.env"
else echo "DATABASE_URL=postgresql://assistant:$PGPW@postgres:5432/assistant?schema=public" > "$CFG/database.env"; ok "database.env"; fi
chmod 600 "$CFG"/*.env

echo
echo "完成。Public JWK（可公開）在 $PUB，kid 如下："
for f in "$PUB"/*.jwk.json; do printf '  %-22s %s\n' "$(basename "$f" .jwk.json)" "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["kid"])' "$f")"; done
echo "內部 CA 私鑰在 $CA/ca.key，請勿複製到其他地方。"
