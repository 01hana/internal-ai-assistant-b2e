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
| edge | 可選 Nginx Profile | 8443/TLS | Operator 選定 | 公司既有 Nginx 主機不啟用 |

每個應用服務指定 `linux/amd64`。`backend` Network 是 private；`egress` 只供需要出站的服務；`ingress` 供可選 Edge 與 Gateway/Bridge。只有 Gateway/Bridge 發布固定 Loopback Host Port。公司 Nginx 若不在 Host Network Namespace，這些 `127.0.0.1` Upstream 不能直接使用，須先由 IT 確認，不能改成 `0.0.0.0` 當作捷徑。公司 Host 的 80/443/9000 已在使用，本 Compose 不佔用它們。

Gateway、Bridge、Connector 的 Image 使用非 root `node`；Core Dockerfile 目前沒有 `USER` 指令，Runtime User 為 root，須列入安全審查。PostgreSQL/Caddy 由核准 Image 決定。Compose 配有 healthcheck、依賴條件、`unless-stopped`、json-file 日誌輪替；migration 用 `restart: "no"`。Gateway `/health` 只是 Process Health；`/readiness` 目前固定 `productionReady: false`，不可當作正式信任鏈 Gate。

## 公司 Nginx 路由規格

`nginx-host-routes.example.conf` 是供 IT 在現有 HTTPS Virtual Host 審查的 Location 參考，不得直接覆寫現有 Nginx。以實際核准 Port 替換範例的 14000/13107；須保留 Authorization、Body、Host、`X-Forwarded-Proto`。公開路由：

- `/api/v1/assistant/**` → `127.0.0.1:DEMO_GATEWAY_HOST_PORT`，保留完整 Path。已確認的路由為 Session 建立／讀取、Message History 讀取，以及 `POST /api/v1/assistant/sessions/:id/messages`；後者回 `text/event-stream`，須關閉 Proxy Buffer/Cache，允許長連線與斷線取消。其他路由不能由此範例推定。
- `/assistant-identity/identity/exchange` → `127.0.0.1:DEMO_BRIDGE_HOST_PORT/identity/exchange`；Bridge 實際接受 `POST /identity/exchange`。
- `/.well-known/jwks.json` → Bridge JWKS，僅在已核准的 `BRIDGE_JWKS_PUBLIC_URI` 使用該 Host/Path 且不與既有網站衝突時開放。Gateway JWKS 供 Core 透過 `gateway:4000/.well-known/jwks.json` 取得，不需公開。

Gateway `/health` 與 Bridge `/ready` 僅供內部/Host 健康查驗，不加入公開網站。核對公司 Nginx Network Namespace、TLS 憑證、公開 DNS、Allowed Origins、JWKS URL 與 Host Port 實際可達性。可選 `self-managed-https` Edge Profile 預設關閉，不能與公司 Nginx 搶 80/443。

## 信任、TLS、Secrets 與正式資料

Bridge 使用正式 IDX MenuDetail HTTPS 與 Destination CIDR Policy 核驗身分和 Entry，並以正式 Signing Key 發 Bridge JWT/JWKS；Connector Binding 必須走核准的 HTTPS。Gateway 驗 Bridge JWKS、Integration Binding/TrustProfile，簽 Internal JWT；Core 驗 Gateway JWKS，實施 Customer/Integration Session Ownership、Capability、Tool Policy、Query Scope、Evidence/History。Connector 驗 Signed Service Proof、Binding、Replay、Manifest Allowlist、HTTPS Destination 與 Credential Scope。`ASSISTANT_LLM_TOOL_SELECTION_ENABLED=true` 固定在 Compose；不能以關閉它處理測試失敗。Legacy `integrationId=NULL` Session 仍不得被接受。

Operator 在 Git 與 Build Context 之外提供 `compose.env`、五個 Service Env Files、Active Pack 與 `secrets:` 所列私鑰、憑證、CA。範本在 `config/`，其中空值和 `REPLACE_WITH_...` 都不是可部署值。保持 Secret Source 最小讀取權限，並查驗容器 User 能讀取所需 Secret；Compose Secret Mount 本身不保證可讀。不要複製開發者 `.env`、真實 Token、合成 Signing Key 或測試 Customer。不要將展開後的 `docker compose config` 輸出附在紀錄中；用 `config --quiet`。

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

## 交付目錄與受控啟停

將 `compose.yaml`、`compose.images.yaml`、`connector.Caddyfile`、Nginx Route 參考及 `config/*.example` 放在公司核准目錄；正式 `config/`、`secrets/`、Active Pack 使用 Operator 管理的絕對路徑，不放進 Git。可選 `edge.conf` 只在獨立核准的 Edge 場景使用。Compose 相對 Dockerfile/Volume 路徑均依部署目錄規劃查核；Image-only 仍需 `connector.Caddyfile`。

Preflight：確認 `uname -m`、`docker info`、Compose 版本、Host Nginx Namespace、127.0.0.1 核准 Port 未被占用、DNS/TLS/CA/Firewall、Subnet 不衝突、Image Architecture/ID、Secret Mode 與容器可讀性、Database Backup、Provisioning 審查。Migration Job 執行 `prisma migrate deploy`，只在 PostgreSQL healthy 後啟動；失敗不可被當作成功，不用 `db push`、`migrate reset`、`down -v`。正式 Provisioning 與 Trust 資料完成審核後才開放流量。

啟動後只查本 Compose Project 的 `ps`、`logs --tail 100`，核對 migration Exit 0、PostgreSQL/Connector/Bridge/Gateway/Core Health、Connector TLS、Host Loopback、公開 HTTPS/JWKS。再做授權與拒絕案例的 KPIStats、Evidence、SSE 增量/取消、History E2E。Compose Healthy 不等於業務或安全 Gate 通過。故障時 `docker compose ... stop` 只停止本 Project，保留 Volume/Log；Rollback 先評估 Schema 相容性，使用記錄的舊 Image ID/Tag 與備份，不擅自倒退 Migration。

尚未完成：公司 Host Native Runtime、正式 TLS/Identity/Provisioning、完整 Backend Integration Suite 與兩項 Ambiguity 安全案例、原始 LLM Flag-sensitive 案例、Connector 完整 OS Scanner、Core/Gateway/Bridge 安全掃描與真實 Login→Permission→KPIStats→Evidence→SSE→History E2E。本輪本機合成 Config/Proxy 驗證不能代替上述 Release Gates。
