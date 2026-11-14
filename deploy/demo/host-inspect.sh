#!/usr/bin/env bash
# 主機現況檢查（唯讀）：不修改任何設定，不讀取密碼或 env 檔。
# 用法：bash host-inspect.sh [要測試連線的 URL ...] > host-report.txt 2>&1
#   例：bash host-inspect.sh https://<公開網域>/ https://<客戶 API>/<健康檢查路徑> > host-report.txt 2>&1
#   未提供 URL 時只測 Docker Registry 與 OpenAI。
# 跑完把 host-report.txt 的內容貼回對話即可。
set -u
h() { echo; echo "===== $* ====="; }
run() { echo "\$ $*"; "$@" 2>&1 | head -${LINES_MAX:-60}; }

h "系統"
run uname -m
grep -E '^(PRETTY_NAME|VERSION_ID)=' /etc/os-release 2>/dev/null
echo "CPU: $(nproc)"; run free -h
run df -h / /var/lib/docker

h "Docker"
if docker info >/dev/null 2>&1; then echo "目前使用者可直接執行 docker：是"; else echo "目前使用者可直接執行 docker：否（可能需要 sudo 或加入 docker 群組）"; fi
docker version --format 'Engine {{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}' 2>&1
docker compose version 2>&1
docker info --format 'Root dir: {{.DockerRootDir}} / Storage: {{.Driver}}' 2>&1

h "執行中的容器（名稱 / image / 對外 port）"
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>&1 | head -80

h "Docker 網路網段"
for n in $(docker network ls -q 2>/dev/null); do
  docker network inspect -f '{{.Name}}	{{range .IPAM.Config}}{{.Subnet}} {{end}}' "$n" 2>/dev/null
done

h "主機網路介面與路由（用來避開網段衝突）"
ip -4 -o addr show 2>/dev/null | awk '{print $2, $4}'
ip route 2>/dev/null | head -40

h "正在監聽的 TCP port"
ss -ltn 2>/dev/null | awk 'NR>1{print $4}' | sort -u | head -100

h "Nginx"
if command -v nginx >/dev/null 2>&1; then
  echo "主機上有安裝 nginx：$(nginx -v 2>&1)"
  systemctl is-active nginx 2>/dev/null | sed 's/^/systemd 狀態：/'
  ls /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
  grep -rhoE 'server_name[^;]+;|listen[^;]+;' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sort | uniq -c | head -40
else
  echo "主機上沒有 nginx 執行檔"
fi
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null | grep -iE 'nginx|caddy|traefik|haproxy' | sed 's/^/容器內的反向代理：/'
ps -eo user,comm 2>/dev/null | grep -iE 'nginx|caddy|traefik|haproxy' | sort -u | head

h "既有的 PostgreSQL / Caddy image"
docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}' 2>/dev/null | grep -iE 'postgres|caddy|node' | head -20

h "對外連線（只看能不能連，不傳送任何資料）"
for u in https://registry-1.docker.io/v2/ https://api.openai.com/v1/models "$@"; do
  code=$(curl -s -o /dev/null -m 8 -w '%{http_code}' "$u" 2>/dev/null || echo 失敗)
  echo "$u -> $code"
done
for u in "$@"; do
  d=$(printf '%s' "$u" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')
  getent hosts "$d" >/dev/null || echo "$d DNS 查不到"
done

h "完成"
