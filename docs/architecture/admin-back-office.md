# 後台管理 API 架構（Feature 014、015）

客戶管理後台（使用者、群組，之後的統計、對話稽核、體驗設定）的後端。規格與決策見 [`specs/014-admin-foundation/`](../../specs/014-admin-foundation/spec.md)；前端串接見 [`docs/frontend-integration/admin-api.md`](../frontend-integration/admin-api.md)。

## 1. 行程與邊界

- 程式在 Core 的 `src/admin/`，以獨立進入點 `src/admin-main.ts`（`dist/src/admin-main.js`）啟動：與 Core 同一份 build 與 Docker image，但為獨立行程、連接埠 3200、路徑前綴 `/api/v1/admin`。
- Core 的 `AppModule` 不引入後台；後台不引入 Assistant、LLM、檢索、連接器等模組，也不接受 Gateway 或 Core 的身分 token（架構測試 `test/architecture/admin-boundary.guard.spec.ts` 鎖定）。
- 一個部署只服務一個 Customer：後台資料表沒有 `customerId`，由 `ADMIN_CUSTOMER_ID` 決定；該 Customer 不存在時拒絕啟動。
- HTTP 設定集中在 `admin-app.setup.ts`（helmet、cookie、CORS 只允許 `ADMIN_WEB_ORIGIN`、驗證、錯誤格式、`trust proxy`、本機 Swagger），進入點與測試共用。

```
src/admin/
  admin-main.ts → admin.module.ts, admin-app.setup.ts
  config/         環境變數驗證（啟動時）、AdminSettings、Customer 檢查
  auth/           登入、工作階段、CSRF、速率限制、密碼與連結
  authorization/  CASL ability、路由權限 decorator 與 guard
  permissions/    權限定義（唯一來源，不依賴 NestJS／Prisma）
  users/ groups/  US3、US4 API；users/user-policy.ts 為保護規則
  audit/ mail/    UserAuditEvent、邀請與重設信
  bootstrap/      第一個帳號的 CLI
  health/         GET health（含資料庫檢查）
  conversations/ stats/ feedback/ review-items/ audit-events/   015 營運檢視（唯讀；待審項目可改處理狀態）
  common/         分頁查詢、批次 ids、DTO transform、請求資訊
```

## 2. 登入與工作階段

- 以帳號登入；密碼以 Node 內建 `scrypt` 加鹽雜湊。密碼只能由本人透過信件連結設定（首次登入 72 小時、重設 1 小時，單次有效，資料庫只存 sha256 雜湊），沒有任何能設定他人密碼的 API。
- 工作階段存在資料庫（`UserSession`），httpOnly cookie `admin_session` 只放不透明代碼；閒置 30 分鐘、絕對 12 小時逾時；停用、刪除、重設密碼、開發工程師修改 email 時立即撤銷。
- CSRF：double-submit cookie `admin_csrf` 對 `X-CSRF-Token` header，另檢查 `Origin` 必須等於 `ADMIN_WEB_ORIGIN`。
- 連續 5 次密碼錯誤鎖定 15 分鐘；公開的 auth 端點以 `@nestjs/throttler` 依 IP 與帳號限流（行程內儲存，單一容器足夠）。

## 3. 權限模型

- 權限字串 `subject:action`，動作只有 `read`／`create`／`update`／`delete`（`manage` 代表四種皆有）；定義在 `src/admin/permissions/`，前端由 `groups/getPermissions` 取得，不另行打包。
- 使用者屬於多個群組，權限為各群組的聯集。內建群組只有兩個：`developer`「開發工程師」與 `admin`「最高管理者」（皆為 `all:manage`）；自訂群組可勾選 `all:manage` 以外的任何權限。
- 後端以 `@casl/ability` 判斷、`@casl/prisma` 的 `accessibleBy` 轉成查詢條件。非開發工程師的規則帶條件，看不到開發工程師帳號與「開發工程師」群組（行為等同不存在，404）。
- 每支路由必須以 decorator 宣告存取方式（`@PublicRoute`、`@SignedInRoute`、`@RequirePermission`、`@RequireAnyPermission`），未宣告一律拒絕；guard 順序為工作階段 → CSRF → 權限。
- 保護規則（`users/user-policy.ts`）：只有開發工程師能指派「開發工程師」群組；不可停用、刪除自己或移出自己的內建群組；至少保留一位啟用中、非開發工程師的最高管理者；批次操作全有或全無，錯誤以 `error.details.ids` 說明是哪幾筆。

## 4. 稽核

- 所有狀態變更寫入 `UserAuditEvent`（與 Assistant 的 `AuditEvent` 分開）：時間、`requestId`、執行者與目標（含是否為開發工程師）、事件類型、IP 與 User-Agent 摘要、變更前後摘要。
- 不記錄密碼、雜湊、cookie 或連結代碼；登入失敗只記錄帳號雜湊的前 12 碼。被刪除的使用者，稽核以帳號快照保留。

## 5. 部署與本機

- **部署**：`deploy/demo/compose.yaml` 的 `admin-api` 服務（Core image、`command: [node, dist/src/admin-main.js]`、`admin.env`、`127.0.0.1:DEMO_ADMIN_HOST_PORT`、`egress` 連 SMTP、healthcheck 使用 `GET /api/v1/admin/health`）。`deploy.sh app`／`upgrade` 啟動或更新它，`deploy.sh admin-bootstrap` 建立第一個帳號。後台網站以獨立網域放在公司 Nginx 後方，網站與 API 同源（`ADMIN_TRUSTED_PROXY_HOPS=1`）。步驟見 [`deploy/demo/README.md`](../../deploy/demo/README.md)「後台 API」。
- **正式環境限制**：`NODE_ENV=production` 時，`ADMIN_MAIL_TRANSPORT=log`、`ADMIN_COOKIE_SECURE=false`、`ADMIN_ENABLE_SWAGGER_DOCS=true` 都會拒絕啟動。
- **本機**：`npm run local:start` 一併啟動（3200 埠，信件寫入 `.local-state/assistant/logs/admin.log`，Swagger UI 在 `/api/v1/admin/docs`）；`ADMIN_CUSTOMER_ID` 預設取自本機 Capability Pack，`.env` 的 `ADMIN_*` 可覆寫預設。第一個帳號以 `npm run admin:local:bootstrap -- --account … --name … --email …` 建立（與 `local:start` 相同的環境，連結只在終端機顯示一次）。

## 6. 營運檢視（Feature 015）

- **唯讀讀取 Assistant 資料**：後台以 Prisma 直接查 `AssistantSession`、`AssistantMessage`、`FeedbackEvent`、`ReviewItem`、`AuditEvent`，一律以 `ADMIN_CUSTOMER_ID` 過濾；不 import Core 的 Assistant、feedback 等模組（架構測試以實際路徑判斷）。
- **對話內容只有一個出口**：`conversations/conversation-content.ts` 檢查 `Conversation:read`，依序「讀取 → 寫 `admin_conversation_viewed` → 回傳」，稽核寫入失敗就不回傳內容。列表只含對話標題，不寫稽核。
- **統計**在 PostgreSQL 彙總（`date_trunc`、`AT TIME ZONE ADMIN_TIME_ZONE`、`generate_series` 補 0），參數化的 `$queryRaw`。
- **待審項目對應的訊息**：`COALESCE(suggestedImprovement->>'messageId', sourceId)`，集中在 `review-items/review-item-source.ts`。處理狀態寫在 `ReviewItem`（`note`、`resolvedAt`），處理紀錄以 `admin_review_item_updated` 稽核為準。
- **開發工程師遮蔽**集中在 `audit/audit-actor.ts`（後台稽核與待審項目的處理紀錄共用）。
- Core 舊的 `/api/v1/admin/assistant/review-items` 已移除；架構測試確保 Core 沒有 `/admin` 路由。

## 7. 擴充（Feature 016 之後）

新增 subject 或動作只需修改 `src/admin/permissions/subjects.ts`：內建群組自動取得，自訂群組不會自動取得。新模組放在 `src/admin/<模組>/`，在 `AdminModule` 註冊，並為每個路由宣告權限；若需要讀取 Assistant 的資料，於架構測試逐一放行所需模組。
