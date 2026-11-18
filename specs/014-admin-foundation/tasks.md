# Tasks: Feature 014 — Admin Back-Office Foundation

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 完成（Gate 4 PASS，2026-11-19）；實際部署併入 Feature 015 後一起進行

## Phase 0 — 基線

- [x] T001 `specs/README.md`：013 標為完成（合併 2026-11-17）、登記 014；`.specify/feature.json` 指向 014。
- [x] T002 使用者於 Mac 安裝依賴：`npm install @casl/ability @casl/prisma cookie-parser nodemailer` 與 `npm install -D @types/cookie-parser @types/nodemailer`，提交 `package.json`、`package-lock.json`。
- [x] T003 **Gate 0**：既有 Core 全套與 Gateway 全套通過（新依賴不影響現有功能）；以最小範例確認 `@casl/prisma` 支援關聯條件（`none`、`NOT`）。`FEATURE014_GATE_0=PASS`。

**Phase 0 執行證據（2026-11-17）**：

- T002：使用者安裝 `@casl/ability` 7.1.3、`@casl/prisma` 2.2.0（peer 支援 Prisma 4–7）、`cookie-parser` 1.4.7、`nodemailer` 10.6.0、`@types/cookie-parser`、`@types/nodemailer`。
- `@casl/prisma` 驗證（VM 以 node 直接執行）：`accessibleBy(ability, 'read').ofType('User')`（2.x 的寫法）產生 `{"OR":[{"groups":{"none":{"code":"vendor_developer"}}}]}`（當時的群組代碼；後改為 `developer`）；沒有規則時為 `{"OR":[]}`（不符合任何資料，預設拒絕）；`manage all` 為 `{}`。記憶體判斷 `ability.can('read', subject('User', …))` 對原廠帳號為 false、對一般帳號為 true。群組條件改用 `code IS NULL OR code IN (非原廠內建代碼)`，避免 SQL 的 `NOT (code = …)` 排除 `code` 為 NULL 的自訂群組（design D2）。
- 寄信：先使用公司的寄信服務（SMTP 設定於部署時提供）。
- T003 Gate 0（使用者於 Mac，2026-11-18）：typecheck 通過；Core 全套 273 suites 中 249 passed、24 skipped、0 failed，2416 tests 中 2230 passed、186 skipped；Gateway 82 suites 中 72 passed、10 skipped、0 failed，1570 tests 中 1451 passed、119 skipped（與 Feature 013 Gate 8 相同）。`FEATURE014_GATE_0=PASS`。

## Phase 1 — 權限定義與資料模型

- [x] T004 新增權限定義 `src/admin/permissions/`（subjects、兩個內建群組、自訂群組不可勾選的權限、`subject:action` 轉換、`effectivePermissions`、`toCaslRules`）。
- [x] T005 權限單元測試：字串雙向轉換、未知權限拒絕、內建群組權限與 spec 表格一致、`all:manage` 不可出現在自訂群組、動作只允許 `read`／`create`／`update`／`delete`（與 `manage`）。
- [x] T006 Prisma schema 新增 `User`、`UserGroup`（兩者隱含多對多）、`UserToken`、`UserSession`、`UserAuditEvent`；migration `20261118000000_feature014_admin_foundation`；ledger 登記 hash。
- [x] T007 **Gate 1**：使用者 `npx prisma generate`、migrate（本機與測試資料庫）、`prisma migrate diff` 確認 migration 與 schema 一致、權限測試、typecheck。`FEATURE014_GATE_1=PASS`。

**Phase 1 執行證據（2026-11-18）**：

- T004：權限定義放在 `src/admin/permissions/`（不依賴 NestJS、Prisma）：`subjects.ts`（8 個 subject、四種動作、中文標籤、`permissionCatalog()`）、`permission-string.ts`（`parsePermission`／`formatPermission`／`expandPermission`／`normalizeCustomGroupPermissions`：`subject:manage` 展開、去重、依目錄排序、拒絕未知權限與 `all:manage`）、`system-groups.ts`（`developer` 開發工程師、`admin` 最高管理者，皆 `all:manage`）、`rules.ts`（`effectivePermissions` 以群組聯集計算，內建群組權限只取自定義檔；`toCaslRules`）。原先做成獨立套件 `packages/admin-permission-contract`，經檢討後不打包（spec Decision 27），`package.json` 與 `Dockerfile` 不需修改。
- T005：`test/unit/admin-permissions.spec.ts`。VM 無法執行 jest，改以 `tsc` 編譯後用 node 驗證相同案例，結果與測試預期一致。
- T006：schema 新增 `User`、`UserGroup`（隱含多對多 `_UserToUserGroup`）、`UserToken`（`UserTokenPurpose`）、`UserSession`、`UserAuditEvent`；migration `20261118000000_feature014_admin_foundation` 依 Prisma 產生格式手寫（只新增，`_UserToUserGroup` 採 Prisma 6+ 的複合主鍵 `_AB_pkey`），ledger hash `1f2ff84319671afd0f52065832e6a26360392980737cea6497a51923f940c591`。手寫 SQL 與 schema 是否一致，於 Gate 1 以 `prisma migrate diff` 確認。
- T007 Gate 1（使用者於 Mac，2026-11-18）：`prisma generate`（Core 與 Gateway client 一併更新）、本機與測試資料庫 `migrate deploy` 完成；typecheck（Core、spec、Gateway）通過；`admin-permissions` 22 tests、`repository-safety.guard`（含 migration ledger）5 tests 全數通過。`prisma migrate diff`（資料庫 → schema）回報 5 筆差異，全部是 Feature 005 `Managed*` 表既有的索引名稱：當初 migration 以 PostgreSQL 63 字元截斷產生名稱，與 Prisma 現行的截斷規則不同（例如 `…_enabled_lifecycle_` vs `…_enabled_lifecy_idx`）；欄位與作用相同，無功能影響；014 的新表、索引與外鍵沒有任何差異，手寫 migration 與 schema 一致。`FEATURE014_GATE_1=PASS`。
- 既有索引名稱差異列為後續小整理（不在 014 範圍）：於 schema 以 `map:` 標註資料庫中的實際名稱即可消除，不需 migration。

## Phase 2 — 登入與工作階段

- [x] T008 `src/admin-main.ts`、`AdminModule`、後台環境變數驗證（`ADMIN_PORT`、`ADMIN_WEB_ORIGIN`、`ADMIN_CUSTOMER_ID`、`ADMIN_COOKIE_SECURE`、`ADMIN_SMTP_*`、`ADMIN_MAIL_*`）。
- [x] T009 密碼雜湊（scrypt）與密碼規則；連結代碼服務（產生、驗證、使用、失效）；寄信服務（SMTP／log 傳輸、邀請信與重設信範本、`admin:mail:test`）；單元測試。
- [x] T010 工作階段服務（建立、驗證閒置／絕對逾時、撤銷、`lastSeenAt` 節流）；可注入時鐘的單元測試。
- [x] T011 `AdminAuthGuard`、`CsrfGuard`、登入限流。
- [x] T012 `auth/login`、`auth/logout`、`auth/profile`、`auth/verifyToken`、`auth/firstLogin`、`auth/forgot`、`auth/reset`；鎖定規則；`ADMIN_CUSTOMER_ID` 啟動檢查。
- [x] T013 `UserAuditService` 與登入相關事件。
- [x] T014 `admin:bootstrap` CLI 與 npm script。
- [x] T015 DB 測試：US1、US2 全部情境；稽核事件、日誌與回應不含密碼、工作階段代碼與連結代碼。
- [x] T016 架構測試：`AppModule` 不引入 `src/admin/**`；`src/admin/**` 不引入 Assistant／LLM 模組；Core 路由沒有 `/admin`。
- [x] T017 **Gate 2**：Phase 2 測試、全套、typecheck、lint。`FEATURE014_GATE_2=PASS`。

**Phase 2 執行證據**（分兩批）：

- 第一批（2026-11-18，地基）：`src/admin-main.ts`（前綴 `api/v1/admin`、cookie-parser、只允許 `ADMIN_WEB_ORIGIN` 的 CORS、沿用 Core 的 ValidationPipe／filter／envelope）；`AdminModule`（只引入 `AdminConfigModule`、`PrismaModule`）；`admin-env.validation.ts`（獨立於 Core 的環境變數；`log` 寄信與 `ADMIN_COOKIE_SECURE=false` 在 production 拒絕；`smtp` 需 host、port、寄件者）；`AdminSettings`（逾時與期限常數、cookie 名稱、連結網址）；`AdminCustomerCheck`（`ADMIN_CUSTOMER_ID` 不存在即拒絕啟動）；`password-hasher.ts`（scrypt N=2^15、`timingSafeEqual`、帳號不存在時比對假雜湊、密碼規則）；`secret-token.ts`（32 bytes base64url、只存 sha256）；`UserTokenService`（產生時讓同用途舊連結失效、驗證狀態與用途、單次使用）；`UserSessionService`（閒置 30 分鐘／絕對 12 小時、`lastSeenAt` 每分鐘最多寫一次、撤銷）；`AdminMailService`（邀請信與重設信只含連結、帳號、期限；寄送失敗回 false，不記錄信件內容）與 `smtp`／`log` 傳輸；`UserAuditService`。單元測試 `admin-auth-primitives.spec.ts`、`admin-mail.spec.ts`。VM：Core 與 spec typecheck、eslint 通過；以 node 直接驗證雜湊、環境驗證與信件內容，結果與測試預期一致。
- 第二批（2026-11-18，對外）：三個全域 guard，依序為 `AdminSessionGuard`（非公開路由驗證 cookie 工作階段）→ `CsrfGuard`（狀態變更請求檢查 `Origin`，已登入者另需 `X-CSRF-Token` 與 CSRF cookie 相同）→ `AdminPermissionGuard`（未宣告 `@PublicRoute`／`@SignedInRoute`／`@RequirePermission` 的路由一律 403）；`admin-ability.factory.ts`（開發工程師 `manage all`；最高管理者展開為各 subject 的 `manage`；非開發工程師對 `User`／`UserGroup` 加上隱藏開發工程師的條件；`auth/profile` 回傳的規則不含條件）；`AdminRateLimiter`（行程內，登入每 IP 每分鐘 20 次、每帳號 10 次，連結與忘記密碼每 IP 10 次）；`AdminAuthService`／`AdminAuthController`（`auth/login`、`logout`、`profile`、`verifyToken`、`firstLogin`、`forgot`、`reset`；登入失敗一律相同錯誤，帳號不存在、停用、未啟用、鎖定時仍比對假雜湊；忘記密碼一律回相同結果、寄信不等待；稽核只記錄帳號雜湊前 12 碼）；session cookie `HttpOnly; SameSite=Strict; Path=/api/v1/admin`，CSRF cookie 可由網站讀取；`toUserView()` 只輸出允許的欄位；`admin:bootstrap`（`src/admin/bootstrap/admin-bootstrap.cli.ts`、`scripts/admin-bootstrap.ts`、npm script）。DB 測試 `test/integration/admin-auth.spec.ts`（`RUN_DB_BACKED_ADMIN_TESTS=true`，輔助 `test/support/admin-test-app.helper.ts`：每個測試一個新 app、可調整的時鐘、記錄寄信內容的傳輸），架構測試 `test/architecture/admin-boundary.guard.spec.ts`。VM：typecheck（Core、spec、scripts）與 eslint 通過。
- 發現：Core 既有 `admin/assistant/review-items`（Feature 001），SC-006 改寫為「Core 不載入後台模組」；兩者在部署上不衝突（spec Scope）。
- 發現：本 repo 使用 TypeScript 6.0.3，預設開啟 CommonJS 預設匯入相容，`import x from 'cookie-parser'` 可正常執行；仍依 repo 既有測試慣例改用 `import x = require(...)`。
- Gate 2（使用者於 Mac，2026-11-18）：typecheck、eslint 通過；build 產出 `dist/src/admin-main.js` 與 `dist/src/admin/bootstrap/admin-bootstrap.cli.js`。首輪 Phase 2 測試 23 個 DB 測試失敗、架構測試無法執行：`AdminConfigModule` 以 `ConfigModule.forRoot({ validate })` 在**載入檔案時**驗證環境變數，測試先載入模組才設定 `ADMIN_*`。修正為只在載入時讀 `.env`、建立應用程式時才驗證（`ADMIN_ENVIRONMENT` provider），`AdminSettings` 改讀驗證後的物件。第二輪 23 個失敗：測試輔助程式在後台啟動後才建立測試客戶，`AdminCustomerCheck` 正確拒絕啟動；改為啟動前先建立。第三輪：Phase 2 全部 77 tests 通過（單元 50、架構 4、DB 23）。Core 全套（首輪，排除上述兩檔）2280 passed、0 failed；Gateway 1451 passed、0 failed。`FEATURE014_GATE_2=PASS`。
- Gate 2 後改用套件（2026-11-18，使用者同意）：手寫的 `AdminRateLimiter` 改為 `@nestjs/throttler` 6.8.0（`AdminThrottlerGuard`，具名限制 `ip`、`account`，429 沿用後台錯誤格式，只套用在公開 auth 端點）；新增 `helmet` 8.3.0 安全性標頭（原本缺少）；bootstrap 參數改用 Node 內建 `util.parseArgs`。HTTP 設定抽出為 `configureAdminApp()`，進入點與測試共用。新增測試：安全性標頭、連結端點每 IP 10 次、登入每帳號 10 次。保留手寫：scrypt 雜湊（Node 內建演算法，免原生套件）、資料庫工作階段（需依使用者撤銷全部工作階段）、CSRF（Origin + double submit + SameSite=Strict）。VM：typecheck、eslint 通過；以 node 驗證 helmet 匯入、`parseArgs` 結果與帳號限制的鍵值。

## Phase 3 — 權限、使用者與群組

- [x] T018 `AdminAbilityFactory`（群組 → CASL 規則，含開發工程師可見性條件）、`users/user-policy.ts`（保護規則，純函式，單筆與批次共用）、`@RequirePermission`、`PermissionGuard`（未宣告即拒絕）。
- [x] T019 使用者 API：`getTable`（`accessibleBy`）、`getFilters`、讀取、建立、修改（含群組）、`batch` 停用／啟用、`resendInvite`、`DELETE`；開發工程師可見性、email 啟用後唯讀、指派規則與最後一位管理者檢查（含批次）。
- [x] T020 群組 API：`getTable`、`getOptions`、`getPermissions`、讀取、建立、修改、`DELETE`；權限驗證、內建群組不可改、有成員不可刪、非開發工程師看不到「開發工程師」群組。
- [x] T021 DB 測試：內建與自訂群組 × 全部 API 的允許／拒絕矩陣（SC-001）、開發工程師帳號與群組的可見性（SC-002）、指派與保護規則（SC-009）、US3、US4 全部情境、稽核事件（SC-004）、所有回應不含內部欄位（SC-007）、沒有能設定他人密碼的路由（SC-008）。
- [x] T022 **Gate 3**：Phase 3 測試、全套、typecheck、lint。`FEATURE014_GATE_3=PASS`。

**Phase 3 執行證據**（分兩批）：

- 第一批（2026-11-18，群組）：先查可用套件 —— DTO 以 `@nestjs/swagger` 的 `PartialType` 由建立 DTO 推導修改 DTO；查詢可見範圍以 `@casl/prisma` 的 `accessibleBy(ability, action).ofType('UserGroup')` 轉為 Prisma 條件；分頁只需 Prisma `skip`／`take`，不另裝分頁套件。共用：登入守衛為每個請求建立一次 CASL ability 並放在 `AdminPrincipal`，`@CurrentAdmin()` 取用；`@RequireAnyPermission(...)`（任一權限即可）；`common/table-query.ts`（`getTable` 的 `page`／`pageSize`／`sort`／`keyword`、排序欄位白名單、關鍵字條件）；`common/prisma-errors.ts`（P2002）。群組：`groups.controller.ts`／`groups.service.ts`／`groups.dto.ts` —— `getTable`、`getOptions`（`User:read` 或 `UserGroup:read`；非開發工程師不含「開發工程師」）、`getPermissions`、`GET :id`、`POST`、`PATCH :id`、`DELETE`（`ids`，全有或全無：不存在／看不到 404、內建 400、有成員 400）；內建群組不可修改或刪除；建立、修改、刪除皆寫稽核（修改含前後權限）；內建群組依 `code` 固定排序，不受資料庫定序影響。測試 `test/integration/admin-groups.spec.ts`。自我檢查修正：更新／刪除改依對應動作的可見範圍；名稱在 DTO 去除前後空白；`getOptions` 改為只依「是否為開發工程師」過濾（否則只有 `User:read` 的人會拿到空清單）。VM：typecheck、eslint 通過。
- 第一批測試（使用者於 Mac，2026-11-18）：首輪 19 個失敗 —— `admin-auth` 與 `admin-groups` 兩個 DB 測試檔被 Jest 同時執行，都會重設同一批後台資料表而互相干擾（群組代碼重複、關聯不到群組、登入 500）。修正：測試輔助程式以 PostgreSQL advisory lock（由 Prisma interactive transaction 持有，交易結束即釋放）讓後台 DB 測試依序執行，不需新依賴、不需 `--runInBand`；app 啟動失敗時也會釋放。重跑：96 tests 全數通過（單元 50、架構 4、auth 26、groups 16）。
- Swagger（2026-11-18，spec Decision 28）：`nest-cli.json` 啟用 `@nestjs/swagger` CLI plugin（`classValidatorShim`、`introspectComments`），build 時依 DTO 型別與 class-validator 自動產生欄位說明（Core 的文件一併受惠）；plugin 只讀 `*.dto.ts`，`common/table-query.ts` 改名為 `table-query.dto.ts`。`setupSwagger` 可傳入標題、說明與驗證方式（Core 預設不變：bearer）。後台新增 `ADMIN_ENABLE_SWAGGER_DOCS`（預設 false，production 拒絕）；開啟時 `/api/v1/admin/docs`，驗證為 `admin_session` cookie 與 `X-CSRF-Token` header，helmet 的 CSP 只在開啟時關閉（Swagger UI 需要 inline script）。本機使用：`ADMIN_WEB_ORIGIN` 需設為 Swagger 頁面的來源（`http://localhost:3200`）才能通過 Origin 檢查。測試 `test/integration/admin-docs.spec.ts`（預設 404；開啟後含路由與兩種驗證方式），環境驗證新增 production 拒絕案例。VM：typecheck、eslint、`nest build`（確認 DTO 產生 OpenAPI metadata）通過。
- 第二批（2026-11-18，使用者）：`users/users.controller.ts`／`users.service.ts`／`users.dto.ts`／`user-policy.ts`／`account-rules.ts`。路由：`getTable`（`filters.groups`、`filters.status`、`keyword` 比對帳號／名稱／email、排序白名單 `account`／`name`／`lastLoginAt`／`createdAt`）、`getFilters`（群組選項沿用 `GroupsService.options`）、`GET :id`、`POST`（回應 `{ user, inviteSent }`）、`PUT :id`（`name`、`email`、`groupIds`）、`PATCH batch`（`{ ids, status }`）、`POST :id/resendInvite`、`DELETE`（`ids`）。可見範圍以 `accessibleBy(ability, action).ofType('User')` 查詢，非開發工程師看不到開發工程師帳號（404）。規則：只有開發工程師能指派「開發工程師」群組（403）；不可停用、刪除自己或把自己移出所屬內建群組；至少保留一位啟用中、非開發工程師的最高管理者（停用、刪除、移出群組、加入開發工程師群組皆檢查，含批次）；批次全有或全無；邀請中改 email 使舊邀請連結失效（寫 `admin_user_updated`）；已啟用者只有開發工程師能改 email，並撤銷其工作階段與未使用連結（`admin_user_email_changed`）；重寄邀請限尚未設定密碼且啟用中的使用者；刪除連帶移除工作階段、連結與群組關聯（cascade），稽核保留帳號快照；寄信於 commit 後進行，失敗時 `inviteSent: false`。帳號與 email 先查重（409 `ACCOUNT_TAKEN`／`EMAIL_TAKEN`），併發時以 P2002 退回 409。共用整理：`common/ids.dto.ts`（`IdsDto`、`uniqueIds`，群組刪除一併改用）、`common/dto-transforms.ts`（`trim`、`trimLower`）；bootstrap 改用共用的帳號規則與 class-validator 的 `isEmail`。錯誤回應：Core 的 `GlobalExceptionFilter` 新增選用的 `details`（例外物件帶 `details` 時才輸出，既有 Core 回應不變），後台以 `details.ids` 等說明是哪幾筆被拒（群組刪除原本附的 `ids` 先前會被過濾掉，一併修正）。測試 `test/integration/admin-users.spec.ts`（20 tests）；`RecordingMail.failing` 模擬寄信失敗。VM：typecheck、eslint 通過。
- T022 Gate 3（使用者於 Mac，2026-11-18）：typecheck（Core、spec）通過；`npx eslint src test` 無錯誤；後台 DB 測試（users 20、groups 16、auth 26、docs 2）全數通過；Core 全套 281 suites 中 253 passed、28 skipped、0 failed，2535 tests 中 2285 passed、250 skipped（首次執行有 1 個偶發失敗，未留下紀錄，重跑未重現；後台測試皆通過）。`FEATURE014_GATE_3=PASS`。

## Phase 4 — 本機、部署與文件

- [x] T023 本機：`PORTS.admin = 3200`，`local:start`／`local:status`／`local:stop` 納入後台 API。
- [x] T024 部署：`compose.yaml` 新增 `admin-api`；`deploy.sh` 的 `app`、`upgrade` 與新增的 `admin-bootstrap`；`config/admin.env.example`（含 SMTP 設定）；nginx 範例；以 `admin-bootstrap` 的寄信結果確認 SMTP。
- [x] T025 文件：`docs/architecture/admin-back-office.md`（結構、權限模型、部署）、`docs/frontend-integration/admin-api.md`（給後台前端的 API 與權限契約）、部署手冊新增後台步驟。
- [x] T026 **Gate 4**：全套、typecheck、lint、`npm run build` 產出 `dist/src/admin-main.js`、本機以 `admin:bootstrap` 建立帳號，從日誌取得連結，以 curl 走過 verifyToken → firstLogin → 登入 → profile → 建立使用者（日誌出現邀請連結）→ 登出 → forgot → reset。`FEATURE014_GATE_4=PASS`。

**Phase 4 執行證據**（分兩批）：

- 第一批（2026-11-18，本機）：`dev/local-assistant/local-lib.mjs` 新增 `PORTS.admin = 3200`、`ADMIN_COMPILED_ENTRYPOINT`、`localAdminEnvironment()`（本機預設：`log` 寄信、非 Secure cookie、Swagger 開啟、網站來源為 API 本身 `http://localhost:3200`；`ADMIN_CUSTOMER_ID` 預設取自本機 Capability Pack 的唯一 Customer，找不到或有多個時要求在 `.env` 設定；`.env` 的 `ADMIN_*` 皆可覆寫，`NODE_ENV`、`ADMIN_PORT` 固定）。`local:start` 在 Backend 之後啟動後台 API（受管程序，重新 build 後自動重啟；日誌 `.local-state/assistant/logs/admin.log` 含邀請與重設連結），失敗時 `ROOT_CAUSE=ADMIN_API_UNAVAILABLE` 並回復本次啟動的服務；`local:status` 顯示、`local:stop` 停止後台 API。後台新增公開的 `GET health`（含資料庫檢查）。README 補上本機後台說明。測試：`dev/local-assistant/test/local-assistant.test.mjs` 新增一項（VM 執行 37 項全數通過），`admin-auth.spec.ts` 新增 health 測試。VM：typecheck、eslint 通過。
- 第二批（2026-11-18，部署與文件）：`deploy/demo/compose.yaml` 新增 `admin-api`（Core image、`node dist/src/admin-main.js`、`admin.env`、`127.0.0.1:DEMO_ADMIN_HOST_PORT:3200`、`backend`／`egress`／`ingress`、依賴 migration、healthcheck `GET /api/v1/admin/health`、`ADMIN_TRUSTED_PROXY_HOPS=1`、`trusted_ca`）；`compose.images.yaml`、`compose.company-nginx.yaml`（別名 `ai-assistant-admin`）同步。`deploy.sh`：`preflight` 檢查 `admin.env`（`ADMIN_WEB_ORIGIN` 必須 https、必填項目）與 port；`app` 在 Core 之後啟動後台 API；`upgrade` 先檢查 `admin.env` 與 port 再變更，並在 Gateway 之後更新後台 API；新增 `admin-bootstrap`（`dc run --rm --no-deps admin-api node dist/src/admin/bootstrap/admin-bootstrap.cli.js …`）。新增 `config/admin.env.example`、`compose.env.example` 的 `DEMO_ADMIN_HOST_PORT`、nginx 範例的後台 server block、部署 README「後台 API」一節。後台新增 `ADMIN_TRUSTED_PROXY_HOPS`（預設 0，對應 Express `trust proxy`），否則在 Nginx 後方所有人共用同一個 IP 的速率限制，稽核也記不到真實 IP。設計調整：SMTP 密碼放在 `admin.env`（與其他服務一致），不另建 compose secret；不另做寄測試信指令，改以 `admin-bootstrap` 的寄信結果確認。文件：`docs/architecture/admin-back-office.md`、`docs/frontend-integration/admin-api.md`。測試：`admin-docs.spec.ts` 改名為 `admin-app-setup.spec.ts`，新增 trust proxy 兩項；環境驗證新增一項。VM：typecheck、eslint、`bash -n deploy.sh`、compose YAML 解析通過（VM 無 Docker，`docker compose config` 待主機或 Mac 確認）。
- 第三批（2026-11-19，Gate 4 前置與調整）：新增 `npm run admin:local:bootstrap`（`dev/local-assistant/local-admin-bootstrap.mjs`，以與 `local:start` 相同的環境執行編譯後的 bootstrap CLI；本機 `.env` 不需填 `ADMIN_*`）。依使用者審查調整：`auth/login`、`auth/profile` 的 `rules` 改名為 `permissions`（spec Decision 30）；密碼最少字元數由 12 改為 8（Decision 29）。
- T026 Gate 4（使用者於 Mac，2026-11-19）：build、typecheck、全套、`test:local-assistant`、eslint、後台 DB 測試通過；`local:start` 啟動後台 API，`admin:local:bootstrap` 建立帳號，於 Swagger 走過 verifyToken → firstLogin（重複使用連結 400）→ login → profile → 建立使用者（`admin.log` 出現邀請信）→ logout（之後 profile 401）→ forgot（`admin.log` 出現重設信）→ reset（舊密碼失敗、新密碼成功），結果皆符合預期。`rules`→`permissions` 與 8 字元的調整在 Gate 4 之後完成，以相關測試確認。`FEATURE014_GATE_4=PASS`。實際部署（主機 `admin.env`、SMTP、nginx）依使用者決定併入 Feature 015 後一起進行。

