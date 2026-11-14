#!/usr/bin/env bash
# 交付前在開發機（repo 根目錄或任何位置）執行：從 customers/shinmone 產生部署需要、但不進版控的檔案。
# - provision/tool-catalog.json：provision.cjs 使用的 Tool 定義，來源是 Shinmone 的 tool catalog
# 正式 Active Pack 請另外上傳：customers/shinmone/capability-packs/shinmone-scm-kpistats/1.0.0.json
#   → 主機上的 $DEMO_CAPABILITY_PACK_DIR/shinmone-scm-kpistats.json
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
SRC="customers/shinmone/test/fixtures/shinmone-kpistats-demo-tool-catalog.json"
[ -s "$ROOT/$SRC" ] || { echo "✗ 找不到 $SRC" >&2; exit 1; }
python3 -I - "$ROOT/$SRC" "$SRC" "$DIR/provision/tool-catalog.json" <<'PY'
import json, sys
src, rel, out = sys.argv[1:4]
tools = json.load(open(src, encoding="utf-8"))["tools"]
with open(out, "w", encoding="utf-8") as f:
    json.dump({"source": rel, "tools": tools}, f, ensure_ascii=False, indent=2); f.write("\n")
print(f"✓ provision/tool-catalog.json（{len(tools)} 個 Tool，來源 {rel}）")
PY
echo "· 記得上傳 Active Pack：customers/shinmone/capability-packs/shinmone-scm-kpistats/1.0.0.json"
