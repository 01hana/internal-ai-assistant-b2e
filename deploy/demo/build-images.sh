#!/usr/bin/env bash
# 在開發機打包後端四個 image（linux/amd64），產生 tar 與 .sha256 供主機 `deploy.sh load` 使用。
# 用法：bash deploy/demo/build-images.sh [TAG]
#   TAG 預設：<分支縮寫>-<日期>-<commit>，例如 013-20261117-d9f0c35a1b2c
#   NO_CACHE=1 可強制不用快取重建。
# 四個 image 共用同一個 TAG（compose.yaml 以 DEMO_IMAGE_TAG 指定），所以每次一起打包。
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
cd "$ROOT"
die() { echo "✗ $*" >&2; exit 1; }
ok()  { echo "✓ $*"; }

command -v docker >/dev/null || die "找不到 docker"
docker info >/dev/null 2>&1 || die "Docker 沒有在執行"
if [ -n "$(git status --porcelain)" ] && [ "${ALLOW_DIRTY:-}" != 1 ]; then
  git status --short | head -20
  die "工作目錄有未 commit 的變更；image 必須能對應到一個 commit（確定要打包請加 ALLOW_DIRTY=1）"
fi

COMMIT="$(git rev-parse --short=12 HEAD)"
BRANCH="$(git rev-parse --abbrev-ref HEAD | sed -E 's/^([0-9]+)-.*/\1/; s#[^A-Za-z0-9._-]#-#g')"
TAG="${1:-${BRANCH}-$(date +%Y%m%d)-${COMMIT}}"
[[ "$TAG" =~ ^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$ ]] || die "TAG 格式不合法：$TAG"

IMAGES=(
  "internal-ai-assistant-core:${TAG}|Dockerfile"
  "internal-ai-assistant-gateway:${TAG}-amd64|apps/gateway/Dockerfile"
  "internal-ai-assistant-identity-bridge:${TAG}-amd64|apps/identity-bridge/Dockerfile"
  "assistant-shinmone-runtime:${TAG}-amd64|apps/customer-connector-runtime/Dockerfile"
)
for entry in "${IMAGES[@]}"; do
  ref="${entry%%|*}"
  docker image inspect "$ref" >/dev/null 2>&1 && die "$ref 已存在；不要覆蓋既有 tag，請換一個 TAG"
done

echo "TAG：$TAG（commit $COMMIT）"
cache=(); [ "${NO_CACHE:-}" = 1 ] && cache=(--no-cache)
for entry in "${IMAGES[@]}"; do
  ref="${entry%%|*}"; file="${entry##*|}"
  echo; echo "== 建置 $ref（$file）"
  docker build --platform linux/amd64 "${cache[@]}" \
    --label "org.opencontainers.image.revision=$(git rev-parse HEAD)" \
    -f "$file" -t "$ref" .
  arch="$(docker image inspect "$ref" --format '{{.Os}}/{{.Architecture}}')"
  [ "$arch" = linux/amd64 ] || die "$ref 架構是 $arch"
  ok "$ref ($arch)"
done

OUT="$DIR/assistant-backend-${TAG}.tar"
echo; echo "== 匯出 $(basename "$OUT")"
docker save -o "$OUT" "${IMAGES[@]%%|*}"
if command -v sha256sum >/dev/null; then (cd "$DIR" && sha256sum "$(basename "$OUT")" > "$(basename "$OUT").sha256")
else (cd "$DIR" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256"); fi
ok "$(basename "$OUT")（$(du -h "$OUT" | cut -f1)）"
ok "$(basename "$OUT").sha256"
echo
echo "下一步：上傳這兩個檔案到主機，並把 config/compose.env 的 DEMO_IMAGE_TAG 改成 $TAG"
