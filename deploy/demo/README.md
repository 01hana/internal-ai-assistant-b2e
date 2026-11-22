# Assistant Backend 部署交付說明

本目錄僅部署 Assistant Backend；公司既有 Nginx 提供公開 HTTPS。以下是交付契約，尚未在公司主機執行，也不代表真實信任鏈或 Demo 已驗收。

## 服務、網路與埠

| 服務 | Image / 入口 | 內部埠 | Host 埠 | 依賴 |
| --- | --- | --- | --- | --- |
| postgres | 核准的 PostgreSQL 16 Image | 5432 | 無 | 無；`postgres-data` 持久 Volume |
| migrate | Core Image；`npm run prisma:deploy` | 無 | 無 | PostgreSQL healthy；成功後 Gateway/Core 才啟動 |
| connector | `assistant-shinmone-runtime:TAG-amd64`；production.main | 3100 | 無 | HTTPS Shinmone API、簽章與 Binding 設定 |
| connector-tls | 核准的 Caddy Image | 3443/TLS | 無 | Connector healthy、憑證與私鑰 |
| bridge | `internal-ai-assistant-identity-bridge:TAG-amd64`；`dist/main.js` | 3000 | `127.0.0.1:DEMO_BRIDGE_HOST_PORT` | Connector TLS healthy、MenuDetail HTTPS、Signing/JWKS |
| gateway | `internal-ai-assistant-gateway:TAG-amd64`；`dist/main.js` | 4000 | `127.0.0.1:DEMO_GATEWAY_HOST_PORT` | Migration success、Bridge healthy、TrustProfile |
| core | `internal-ai-assistant-core:TAG`；`dist/src/main.js` | 3000 | 無 | Migration success、Gateway/Connector TLS healthy、PostgreSQL |
| admin-api | `internal-ai-assistant-core:TAG`；`dist/src/admin-main.js` | 3200 | `127.0.0.1:DEMO_ADMIN_HOST_PORT` | Migration success、`ADMIN_CUSTOMER_ID` 已存在、SMTP |
| edge | 可選 Nginx Profile | 8443/TLS | Operator 選定 | 公司既有 Nginx 主機不啟用 |

每個應用服務指定 `linux/amd64`。`backend` Network 是 private；`egress` 只供需要出站的服務；`ingress` 供可選 Edge 與 Gateway/Bridge。只有 Gateway/Bridge/後台 API 發布固定 Loopback Host Port。公司 Nginx 若不在 Host Network Namespace，這些 `127.0.0.1` Upstream 不能直接使用，須先由 IT 確認，不能改成 `0.0.0.0` 當作捷徑。公司 Host 的 80/443/9000 已在使用，本 Compose 不佔用它們。

Gateway、Bridge、Connector 的 Image 使用非 root `node`；Core Dockerfile 目前沒有 `USER` 指令，Runtime User 為 root，須列入安全審查。PostgreSQL/Caddy 由核准 Image 決定。Compose 配有 healthcheck、依賴條件、`unless-stopped`、json-file 日誌輪替；migration 用 `restart: "no"`。Gateway `/health` 只是 Process Health；`/readiness` 目前固定 `productionReady: false`，不可當作正式信任鏈 Gate。

## 公司 Nginx 路由規格

`nginx-host-routes.example.conf` 是供 IT 在現有 HTTPS Virtual Host 審查的 Location 參考，不得直接覆寫現有 Nginx。以實際核准 Port 替換範例的 14000/13107；須保留 Authorization、Body、Host、`X-Forwarded-Proto`。公開路由：

- `/api/v1/assistant/**` → `127.0.0.1:DEMO_GATEWAY_HOST_PORT`，保留完整 Path。已確認的路由為 Session 建立／讀取、Message History 讀取，以及 `POST /api/v1/assistant/sessions/:id/messages`；後者回 `text/event-stream`，須關閉 Proxy Buffer/Cache，允許長連線與斷線取消。其他路由不能由此範例推定。
- `/assistant-identity/identity/exchange` → `127.0.0.1:DEMO_BRIDGE_HOST_PORT/identity/exchange`；Bridge 實際接受 `POST /identity/exchange`。
- `/.well-known/jwks.json` → Bridge JWKS，僅在已核准的 `BRIDGE_JWKS_PUBLIC_URI` 使用該 Host/Path 且不與既有網站衝突時開放。Gateway JWKS 供 Core 透過 `gateway:4000/.well-known/jwks.json` 取得，不需公開。

Gateway `/health` 與 Bridge `/ready` 僅供內部/Host 健康查驗，不加入公開網站。核對公司 Nginx Network Namespace、TLS 憑證、公開 DNS、Allowed Origins、JWKS URL 與 Host Port 實際可達性。可選 `self-managed-https` Edge Profile 預設關閉，不能與公司 Nginx 搶 80/443。

## 後台 API（Feature 014）

後台 API 與 Core 使用同一個 image，以 `node dist/src/admin-main.js` 啟動為獨立容器 `admin-api`，路徑前綴 `/api/v1/admin`，一個部署只服務一個 Customer（`ADMIN_CUSTOMER_ID`，啟動時必須已存在）。架構見 [`docs/architecture/admin-back-office.md`](../../docs/architecture/admin-back-office.md)。

1. **設定**：依 `config/admin.env.example` 建立 `$DEMO_CONFIG_DIR/admin.env`（權限 600）：`DATABASE_URL`（與 Core 相同）、`ADMIN_CUSTOMER_ID`、`ADMIN_WEB_ORIGIN`（後台網站的 `https://` 來源）、`ADMIN_MAIL_FROM` 與 `ADMIN_SMTP_*`；`ASSISTANT_CAPABILITY_PACK_PATHS_JSON`（與 `core.env` 相同，Feature 016 體驗設定編輯以它驗證；Pack 目錄也唯讀掛載到 `admin-api`，`preflight` 檢查兩者一致）；選填 `ADMIN_TIME_ZONE`（統計切分日期的時區，預設 `Asia/Taipei`）。SMTP 密碼與其他服務的密碼一樣放在這個 env 檔。`compose.env` 新增 `DEMO_ADMIN_HOST_PORT`（核准的 loopback port）。`NODE_ENV=production` 下，信件改寫入日誌、cookie 不加 Secure、開啟 Swagger 都會拒絕啟動。
2. **網路**：`admin-api` 需要能連到 SMTP 伺服器（`egress`）；`ADMIN_TRUSTED_PROXY_HOPS=1` 固定在 Compose，代表前面恰好有一層公司 Nginx，速率限制與稽核使用 Nginx 帶入的 `X-Forwarded-For`。不要讓外部直接連到 host port。
3. **Nginx**：後台網站使用獨立網域，同一個 server block 提供網站靜態檔與 `/api/v1/admin/` 轉送（見 `nginx-host-routes.example.conf` 末段）；`/api/v1/admin/health` 只供主機與 Compose 健康檢查，不對外開放。Nginx 跑在 Docker 時，`compose.company-nginx.yaml` 讓 `admin-api` 以別名 `ai-assistant-admin` 加入公司代理網路。
4. **首次部署**：`preflight` 會檢查 `admin.env` 與 port；`app` 在 Core 之後啟動 `admin-api` 並等 healthy。接著執行 `./deploy.sh admin-bootstrap <compose.env> --account <帳號> --name <名稱> --email <email>` 建立第一個帳號（開發工程師群組）：只在沒有任何後台使用者時可執行，寄出首次登入信並在終端機顯示一次連結（72 小時、單次有效）。寄信結果會顯示在輸出中，可藉此確認 SMTP 設定。之後的帳號一律由後台建立並寄邀請信。
5. **升級既有部署**：新版的 `compose.yaml` 含 `admin-api`，缺少 `admin.env` 或 `DEMO_ADMIN_HOST_PORT` 時整個 Compose 專案都無法解析，所以 `upgrade` 會先檢查，缺少就停止且不做任何變更。準備好設定後執行 `upgrade`，它會在 Gateway 之後啟動／更新 `admin-api`；首次升級到含後台的版本後再執行一次 `admin-bootstrap`。

## 信任、TLS、Secrets 與正式資料

Bridge 使用正式 IDX MenuDetail HTTPS 與 Destination CIDR Policy 核驗身分和 Entry，並以正式 Signing Key 發 Bridge JWT/JWKS；Connector Binding 必須走核准的 HTTPS。Gateway 驗 Bridge JWKS、Integration Binding/TrustProfile，簽 Internal JWT；Core 驗 Gateway JWKS，實施 Customer/Integration Session Ownership、Capability、Tool Policy、Query Scope、Evidence/History。Connector 驗 Signed Service Proof、Binding、Replay、Manifest Allowlist、HTTPS Destination 與 Credential Scope。`ASSISTANT_LLM_TOOL_SELECTION_ENABLED=true` 固定在 Compose；不能以關閉它處理測試失敗。Legacy `integrationId=NULL` Session 仍不得被接受。

Operator 在 Git 與 Build Context 之外提供 `compose.env`、六個 Service Env Files、Active Pack 與 `secrets:` 所列私鑰、憑證、CA。範本在 `config/`，其中空值和 `REPLACE_WITH_...` 都不是可部署值。保持 Secret Source 最小讀取權限，並查驗容器 User 能讀取所需 Secret；Compose Secret Mount 本身不保證可讀。不要複製開發者 `.env`、真實 Token、合成 Signing Key 或測試 Customer。不要將展開後的 `docker compose config` 輸出附在紀錄中；用 `config --quiet`。

`DEMO_BACKEND_SUBNET` 不得與公司/VPN 網段衝突，須納入 Core/Bridge 對 Connector TLS DNS Alias 的 Destination Policy。Connector TLS 憑證 SAN 必須符合 `DEMO_CONNECTOR_TLS_HOST`，CA 加入 `trusted-ca.pem`，不可停用驗證。Bridge MenuDetail、Connector KPIStats 所需的正式 HTTPS URL、DNS、CIDR Allowlist、出站 Firewall 與 Credential Binding 仍待 IT/Backend 團隊確認；HTTP API 不能當作安全替代。Core Env 的 Pack Paths 必須指向掛載的正式 Active Pack；Repo 內 KPIStats Pack 仍是 inactive 且含本機識別值。

正式 Provisioning 尚沒有已核准、可重複執行的 Staging 程序。部署前須建立/驗證 Customer、Integration、Integration Binding、TrustProfile、Bridge/Gateway Signing/JWKS、Connector Deployment/Credential/Service Proof、Tool Definition/Policy、Permission/Query Scope、Active Pack；衝突的 Authority 必須 Fail Closed。`customers/shinmone/scripts/provision-shinmone-kpistats-local.ts`、Gateway Local Provisioner、`prisma:seed` 均不是正式初始化。不能自動建立假的 Permission、Key 或 Customer。

## Image 建置與交付

目標 Host 是 `linux/amd64`，仍須用 `docker info` 驗證 Engine Architecture。優先在授權 Build 環境以完整 Repo（Dockerfiles、Package Locks、Contracts、Prisma Schema/Migrations）建置、掃描、固定唯一 TAG，再透過核准 Registry 或具完整性校驗的 Image Archive 交付；Host 不需 Clone Source。PostgreSQL/Caddy 也需核准且固定 Digest。Archive 目前尚未製作，不能宣稱已交付。Image Archive 不能包含 `.env`、Private Key 或 Source Build Context。Image Tag 不得覆蓋既有 Tag；記錄 Image ID、Digest（Registry 交付時）與 `Os/Architecture`。

Image-only 部署同時指定 `compose.yaml` 與 `compose.images.yaml`；後者移除所有 Application Build Context，保留相同 Image、網路、Secrets 與 Trust。使用 `--pull never --no-build`，先確認所有 Tags 已載入。另一種 Host Source Build 方案需要完整 Source、Build Context、私有依賴存取及較多資源，目前不作為優先交付方式。

```sh
# 以下只是在核准 Host 的操作範例，本輪未執行。
docker load -i /approved/path/assistant-backend-images.tar
docker image inspect internal-ai-assistant-core:TAG --format '{{.Os}}/{{.Architecture}} {{.Id}}'
docker compose --env-file /approved/path/compose.env -f deploy/demo/compose.yaml -f deploy/demo/compose.images.yaml config --quiet
docker compose --env-file /approved/path/compose.env -f deploy/demo/compose.yaml -f deploy/demo/compose.images.yaml up -d --pull never --no-build
```

## Assistant 體驗設定（Feature 013）

開場問候、Quick Reply 與延伸建議來自 `customers/<customer>/assistant-experience/<version>.json`，存在資料庫的 `AssistantExperienceConfig`（有版本，同一 Integration 只有一筆 active）。

1. 開發機執行 `deploy/demo/prepare-delivery.sh`，產生 `provision/assistant-experience.json`（不進版控）並一起交付。
2. 主機在 `db`（含 Feature 013 migration）與 `provision` 之後執行 `./deploy.sh experience <compose.env>`：先 `--check` 唯讀驗證（schema、Customer／Integration／HostApp、每個選項宣告的能力與參數都能解析到 Active Pack、語意審核為 `HUMAN_VERIFIED`），通過才寫入並啟用；失敗不寫入任何資料。
3. **Feature 016 起，之後的修改在後台的體驗設定頁進行**（儲存即生效、可回復舊版本）；設定檔只提供新部署的初始內容。目前生效的版本是後台儲存的時，`experience` 會以 `ADMIN_MANAGED` 拒絕，避免覆蓋後台的修改；確定要以設定檔取代時，在 Core image 內以 `--force` 執行 provisioning 指令。Core 每次請求都讀 active 設定，不需要重啟。同版本、同內容重跑不會新增紀錄；內容改了卻沒提高版本會被拒絕（`VERSION_CONFLICT`）。

沒有 active 設定時，開場回 Core 預設問候、`quickReplies` 為空，其他功能不受影響。

**升級既有部署的順序：Core 先於 Gateway。** 新 Gateway 會轉發 `choiceId`、Session 列表與封存；若 Core 還是舊版，這些請求會被拒絕。順序：`load` → `db`（migration）→ `experience` → 重啟 `core` 並等 healthy → 重啟 `gateway`。首次部署照原本的 `app` 順序即可（兩者同時是新版）。

## 交付目錄與受控啟停

將 `compose.yaml`、`compose.images.yaml`、`connector.Caddyfile`、Nginx Route 參考及 `config/*.example` 放在公司核准目錄；正式 `config/`、`secrets/`、Active Pack 使用 Operator 管理的絕對路徑，不放進 Git。可選 `edge.conf` 只在獨立核准的 Edge 場景使用。Compose 相對 Dockerfile/Volume 路徑均依部署目錄規劃查核；Image-only 仍需 `connector.Caddyfile`。

Preflight：確認 `uname -m`、`docker info`、Compose 版本、Host Nginx Namespace、127.0.0.1 核准 Port 未被占用、DNS/TLS/CA/Firewall、Subnet 不衝突、Image Architecture/ID、Secret Mode 與容器可讀性、Database Backup、Provisioning 審查。Migration Job 執行 `prisma migrate deploy`，只在 PostgreSQL healthy 後啟動；失敗不可被當作成功，不用 `db push`、`migrate reset`、`down -v`。正式 Provisioning 與 Trust 資料完成審核後才開放流量。

啟動後只查本 Compose Project 的 `ps`、`logs --tail 100`，核對 migration Exit 0、PostgreSQL/Connector/Bridge/Gateway/Core Health、Connector TLS、Host Loopback、公開 HTTPS/JWKS。再做授權與拒絕案例的 KPIStats、Evidence、SSE 增量/取消、History E2E。Compose Healthy 不等於業務或安全 Gate 通過。故障時 `docker compose ... stop` 只停止本 Project，保留 Volume/Log；Rollback 先評估 Schema 相容性，使用記錄的舊 Image ID/Tag 與備份，不擅自倒退 Migration。

尚未完成：公司 Host Native Runtime、正式 TLS/Identity/Provisioning、完整 Backend Integration Suite 與兩項 Ambiguity 安全案例、原始 LLM Flag-sensitive 案例、Connector 完整 OS Scanner、Core/Gateway/Bridge 安全掃描與真實 Login→Permission→KPIStats→Evidence→SSE→History E2E。本輪本機合成 Config/Proxy 驗證不能代替上述 Release Gates。
