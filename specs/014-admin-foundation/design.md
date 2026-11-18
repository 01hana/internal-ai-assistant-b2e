# Design: Feature 014 — Admin Back-Office Foundation

**Spec**: [`spec.md`](./spec.md)　**Branch**: `014-admin-foundation`

## 0. Reuse Inventory

| 既有 | 用途 |
| --- | --- |
| `src/prisma/`（`PrismaModule`、`createPrismaClient`） | 後台與 Core 共用同一個 Prisma client 與連線方式 |
| `src/common/request-id/`、`response/`、`errors/` | 後台沿用相同的 `requestId`、envelope 與錯誤格式 |
| `src/common/config/env.validation.ts` | 後台新增自己的環境變數驗證（不污染 Core 的必填項） |
| `src/common/logger/redaction.util.ts` | 後台日誌同樣遮罩密碼、cookie、token |
| `test/fixtures/migration-ledger.json` | 新 migration 依既有規則登記 hash |
| `test/support/us1-db-test.helper.ts` 的模式 | 後台 DB 測試使用 `assistant_test`，以環境旗標啟用 |
| `deploy/demo/compose.yaml` 的 `migrate` 服務 | 「同一 image、不同指令」的前例，`admin-api` 照此新增 |
| 範本 `ecommerce-admin` 的 API 慣例 | `getTable`／`getFilters`／`getOptions`／`batch`／`DELETE` 帶 `ids` |

## D1. 程式結構

```
src/admin-main.ts                         # 後台進入點（與 src/main.ts 並列）
src/admin/
  admin.module.ts                         # AdminModule：只引入 PrismaModule、config、admin 子模組
  permissions/                            # 權限唯一來源（不依賴 NestJS、Prisma；可單元測試）
    subjects.ts                           # 8 個 subject、四種動作、中文標籤、permissionCatalog()
    permission-string.ts                  # 'subject:action' <-> { action, subject }；manage 展開；自訂群組權限驗證
    system-groups.ts                      # 兩個內建群組（developer、admin）的代碼、名稱與權限
    rules.ts                              # effectivePermissions(groups)、toCaslRules(permissions)
  config/admin-env.validation.ts          # ADMIN_PORT、ADMIN_WEB_ORIGIN、ADMIN_CUSTOMER_ID、ADMIN_COOKIE_SECURE、ADMIN_SMTP_*、ADMIN_MAIL_*
  config/admin-customer.provider.ts       # 啟動時確認 ADMIN_CUSTOMER_ID 存在，提供給 015 的查詢使用
  auth/
    password-hasher.ts                    # scrypt 雜湊與驗證（timingSafeEqual）、密碼規則
    user-token.service.ts                 # 首次登入／重設連結代碼的產生、驗證、使用、失效
    user-session.service.ts               # 建立、驗證（閒置／絕對逾時）、撤銷工作階段
    auth.controller.ts                    # auth/login、logout、profile、verifyToken、firstLogin、forgot、reset
    session.guard.ts                      # 讀 cookie → 驗證工作階段 → 掛上 AdminPrincipal
    csrf.guard.ts                         # 狀態變更請求檢查 X-CSRF-Token 與 Origin
    admin-throttler.guard.ts              # @nestjs/throttler：依 IP 與帳號限制公開 auth 端點
  authorization/
    admin-ability.factory.ts              # 依使用者的群組組出 CASL ability
    require-permission.decorator.ts       # @RequirePermission('read', 'User')
    permission.guard.ts                   # 未宣告權限的路由一律拒絕
  users/                                  # users/*
  groups/                                 # groups/*
  common/table-query.dto.ts               # getTable 的 page/pageSize/sort/filters/keyword
  audit/user-audit.service.ts             # 寫入 UserAuditEvent
  mail/admin-mail.service.ts              # nodemailer（SMTP）或本機 log 傳輸；邀請信與重設信範本
  bootstrap/admin-bootstrap.cli.ts        # npm run admin:bootstrap
```

- **進入點** `src/admin-main.ts`：`NestFactory.create(AdminModule)` 後呼叫 `configureAdminApp()`（`src/admin/admin-app.setup.ts`，測試共用同一份）：`setGlobalPrefix('api/v1/admin')`、`helmet`（安全性標頭）、`cookie-parser`、CORS（只允許 `ADMIN_WEB_ORIGIN`、`credentials: true`）、`ValidationPipe`、既有 filter 與 interceptor。
- `src/app.module.ts` 不變；以架構測試鎖定「`AppModule` 不引入 `src/admin/**`」與「`src/admin/**` 不引入 Assistant／LLM 模組」。
- `nest build` 以 `tsc` 編譯 tsconfig 涵蓋的整個 `src/`，`dist/src/admin-main.js` 會與 `dist/src/main.js` 一併產出，不需調整 build 設定；以測試確認 build 後檔案存在。

## D2. 權限定義與 CASL

- 型別：`type AdminAction = 'read' | 'create' | 'update' | 'delete' | 'manage'`；`type AdminSubject = keyof typeof SUBJECT_ACTIONS | 'all'`；`AppAbility = PureAbility<[AdminAction, AdminSubject | AdminSubjectRecord], PrismaQuery>`（`@casl/prisma` 的 `createPrismaAbility`）。
- **`manage`**：CASL 內建的「任何動作」。`subject:manage` 等同該 subject 的四種動作；`all:manage` 等同全部（只屬於兩個內建群組）。
- **內建群組的權限只來自 `src/admin/permissions/`**：資料庫的內建群組列只存代碼與顯示名稱，`permissions` 欄位不使用；組 ability 時以代碼查權限定義。版本更新即生效，無需資料遷移。
- **自訂群組**：`permissions` 存 `subject:action` 字串陣列；寫入前以權限定義驗證（未知的 subject 或 action、`all:manage` → 400）。
- **開發工程師可見性**：非開發工程師的 ability 對 `User` 加上條件 `{ groups: { none: { code: 'developer' } } }`、對 `UserGroup` 加上 `{ OR: [{ code: null }, { code: 'admin' }] }`（不用 `NOT: { code: 'developer' }`：SQL 的 `NOT (code = …)` 遇到 `code` 為 NULL 的自訂群組會一併排除）。列表以 `accessibleBy(ability, 'read').ofType('User')` 併入 Prisma `where`；單筆先查再以 `ability.can(action, subject('User', record))` 檢查，不符一律 404。
- **套件版本**：`@casl/ability` 7.x、`@casl/prisma` 2.x（支援 Prisma 7）。本 repo 的 Prisma client 輸出到 `src/generated/prisma`，因此由 `@casl/prisma/runtime` 匯入，型別以 `PrismaQueryFactory<Prisma.TypeMap>`（取自本 repo 產生的 client）定義，不依賴 `@prisma/client` 的預設型別。
- **指派與保護規則**（service 檢查，不只是權限；集中在 `UserPolicyService`）：
  - 只有開發工程師能指派或移除 `developer`。
  - 不得停用或刪除自己，不得把自己移出所屬的內建群組。
  - 「最後一位最高管理者」以「變更後的狀態」重新計算：屬於 `admin`、啟用中、且不屬於 `developer` 的使用者至少一位。
  - email：`passwordHash` 不為空（已啟用）時只有開發工程師能修改；修改後撤銷工作階段與未使用的連結。
  - 批次操作先全部檢查再於同一 transaction 執行，任一筆違規即整批拒絕。

## D3. 資料模型（migration `20261118000000_feature014_admin_foundation`）

```prisma
model User {
  id                 String        @id @default(cuid())
  account            String        @unique          // 小寫
  name               String
  email              String        @unique          // 必填、小寫
  status             Boolean       @default(true)   // true = 啟用
  passwordHash       String?                        // 尚未設定密碼（邀請中）時為空
  failedLoginCount   Int           @default(0)
  lockedUntil        DateTime?
  lastLoginAt        DateTime?
  passwordChangedAt  DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt
  groups             UserGroup[]                     // 隱含多對多（_UserToUserGroup）
  sessions           UserSession[]
  tokens             UserToken[]
  @@index([status])
}

enum UserTokenPurpose { first_login reset_password }

model UserToken {
  id        String           @id @default(cuid())
  userId    String
  purpose   UserTokenPurpose
  tokenHash String           @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime         @default(now())
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, purpose])
}

model UserGroup {
  id          String   @id @default(cuid())
  code        String?  @unique                       // 內建群組：developer / admin
  name        String   @unique
  description String?
  isSystem    Boolean  @default(false)
  permissions String[]                               // 自訂群組的 'subject:action'；內建群組不使用
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  users       User[]                                 // 隱含多對多
}

model UserSession {
  id               String    @id @default(cuid())
  tokenHash        String    @unique
  userId           String
  createdAt        DateTime  @default(now())
  lastSeenAt       DateTime  @default(now())
  expiresAt        DateTime                           // 絕對逾時
  revokedAt        DateTime?
  ipSummary        String?
  userAgentSummary String?
  user             User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, revokedAt])
}

model UserAuditEvent {
  id               String   @id @default(cuid())
  requestId        String
  timestamp        DateTime @default(now())
  actorUserId      String?                            // 不建立外鍵：使用者刪除後紀錄仍完整
  actorAccount     String?                            // 帳號快照
  actorIsDeveloper Boolean  @default(false)            // 015 對非開發工程師顯示為「開發工程師」
  eventType        String
  targetType       String?
  targetIsDeveloper Boolean @default(false)
  targetId         String?
  ipSummary        String?
  userAgentSummary String?
  metadata         Json?
  @@index([timestamp])
  @@index([actorUserId, timestamp])
  @@index([eventType, timestamp])
}
```

- **多對多**：Prisma 依 `User.groups` ↔ `UserGroup.users` 自動建立 `_UserToUserGroup`（兩個外鍵欄 `A` = `User.id`、`B` = `UserGroup.id`，Prisma 依 model 名稱字母序命名），刪除使用者或群組時對應列一併移除。
- **刪除**：使用者刪除時工作階段與連結代碼一併刪除（`onDelete: Cascade`）；稽核事件不受影響。群組只能在沒有成員時刪除（service 檢查）。
- **不帶 `customerId`**：一個部署一個客戶（spec Decision 14）；015 讀取 Assistant 資料時以 `ADMIN_CUSTOMER_ID` 過濾。
- 名稱 `User`／`UserGroup` 指後台使用者；Assistant 的終端使用者在既有資料中只是 `actorId` 字串，沒有資料表，不會衝突。

## D4. 登入、工作階段與 CSRF

- **雜湊**：`scrypt(password, salt16, 64, { N: 2^15, r: 8, p: 1 })`，儲存格式 `scrypt$N$r$p$saltB64$hashB64`；驗證以 `timingSafeEqual`。帳號不存在時對固定的假雜湊做一次驗證，避免時間差。
- **工作階段代碼**：32 bytes 隨機值（base64url）放在 cookie `admin_session`；資料庫存 `sha256(token)`。每次請求更新 `lastSeenAt`（同一分鐘內不重複寫入）。
- **逾時**：`lastSeenAt + 30m` 或 `expiresAt`（建立時 + 12h）任一到期即無效。
- **撤銷**：登出、停用、重設密碼（`auth/reset`）設 `revokedAt`；刪除使用者時工作階段一併刪除。
- **鎖定**：密碼錯誤 `failedLoginCount + 1`；達 5 次設 `lockedUntil = now + 15m` 並歸零；成功登入歸零。
- **CSRF**：登入成功時另發 `admin_csrf` cookie（非 httpOnly、`SameSite=Strict`）；`CsrfGuard` 對 POST／PUT／PATCH／DELETE 檢查 header `X-CSRF-Token` 等於 cookie，且 `Origin` 等於 `ADMIN_WEB_ORIGIN`。`auth/login` 只檢查 `Origin`。
- **`GET auth/profile`**：回傳 `{ user: { id, account, name, email, status, lastLoginAt, groups: [{ id, name, code }] }, permissions }`（`permissions` 為 CASL 規則 `[{ action, subject }]`）。前端在開啟或重新整理頁面時呼叫（cookie 是 httpOnly，前端無法自己判斷是否已登入）、改密碼後呼叫；回 401 即導向登入頁。`auth/login` 成功的回應與它相同。
- **設定密碼的連結**（`UserTokenService`）：
  - 產生：32 bytes 隨機值（base64url），資料庫存 `sha256`；產生新代碼時，同一使用者同用途、未使用的舊代碼設為已使用（失效）。首次登入 72 小時、重設 1 小時。
  - `auth/verifyToken { token }` → `{ account, purpose }`；`auth/firstLogin { token, password }` 只接受 `first_login`、`auth/reset { token, password }` 只接受 `reset_password`。無效、已使用、過期、用途不符、使用者已停用或已刪除 → 一律 400 `invalid_or_expired_link`。
  - 使用與設定密碼在同一 transaction：標記 `usedAt`、寫入 `passwordHash`、`passwordChangedAt`，`reset` 另清除鎖定並撤銷所有工作階段。
  - `firstLogin` 只在使用者尚未設定密碼時有效（已設定則連結視為無效）。
  - `auth/forgot { email }`：一律回相同結果；只對「已設定密碼、啟用中」的使用者寄信；同一 email 15 分鐘內只寄一次（以最近一筆 `reset_password` 代碼的 `createdAt` 判斷）。
  - 連結網址：`${ADMIN_WEB_ORIGIN}/auth/firstLogin?token=…`、`${ADMIN_WEB_ORIGIN}/auth/reset?token=…`。
- **密碼規則**：至少 8 字元、最多 128 字元；不得與帳號相同（首次登入與重設相同）。
- **回應欄位白名單**：使用者一律經 `toUserView()` 轉換後回傳，只含 spec 允許的欄位與 `invitationPending = passwordHash === null`（SC-007）。
- **速率限制**（`@nestjs/throttler`，行程內儲存；單一 `admin-api` 容器足夠，多個容器需改用共用儲存）：只套用在公開的 auth 端點（`@UseGuards(AdminThrottlerGuard)`）。`auth/login` 每個 IP 每分鐘 20 次、每個帳號每分鐘 10 次；`auth/forgot`、`auth/verifyToken`、`auth/firstLogin`、`auth/reset` 每個 IP 每分鐘 10 次。超過時回 429 `TOO_MANY_REQUESTS`（沿用後台錯誤格式）。

## D4a. 寄信

- `AdminMailService.send({ to, subject, text, html })`，傳輸方式由 `ADMIN_MAIL_TRANSPORT` 決定：`smtp`（預設，`nodemailer` + `ADMIN_SMTP_*`）或 `log`（只把收件者、主旨與連結寫入日誌；`NODE_ENV=production` 時拒絕啟動）。
- 範本：邀請信（帳號、連結、72 小時期限）、重設信（帳號、連結、1 小時期限、「若非本人申請請忽略」）。純文字與簡單 HTML，不含密碼或其他使用者資料；寄件者名稱與主旨中不放客戶專屬文字（由 `ADMIN_MAIL_FROM` 決定顯示名稱）。
- 寄信失敗：建立使用者與重寄邀請時，使用者資料照常寫入，回應 `inviteSent: false`，稽核事件記錄寄送結果（不含 SMTP 錯誤細節中的帳密）；`auth/forgot` 寄信失敗時仍回相同結果，只寫日誌。
- 啟動時不連 SMTP（避免郵件伺服器暫時不通導致後台無法啟動）。部署時以 `deploy.sh admin-bootstrap` 的寄信結果確認 SMTP 設定（輸出會顯示是否寄出，連結也同時顯示在終端機），不另設寄測試信的指令。

## D5. 列表（getTable／getFilters／getOptions）

- `POST users/getTable`：body `{ page = 1, pageSize = 20 (max 100), sort?: { field: 'account' | 'name' | 'lastLoginAt' | 'createdAt', order: 'asc' | 'desc' }, filters?: { groups?: string[], status?: boolean[] }, keyword? }`（`keyword` 比對帳號、名稱、email）。回應 `{ items, total }`。
- `GET users/getFilters`：`{ groups: [{ value, label }], status: [{ value: true, label: '啟用' }, { value: false, label: '停用' }] }`（群組依呼叫者可見性過濾）。
- `GET groups/getOptions`：`[{ id, label, isSystem }]`，非開發工程師不含「開發工程師」。
- `GET groups/getPermissions`：`[{ subject, label, actions: ['read', …] }]`，不含 `all`。
- `POST groups/getTable`：與使用者相同格式，另回傳每個群組的成員數。

## D6. 稽核

`UserAuditService.record({ eventType, actor, target, before, after })`，事件類型：`admin_bootstrap`、`admin_login_succeeded`、`admin_login_failed`、`admin_logout`、`admin_password_set`（firstLogin）、`admin_password_reset_requested`、`admin_password_reset`、`admin_user_created`、`admin_user_updated`、`admin_user_email_changed`、`admin_user_groups_changed`、`admin_user_disabled`、`admin_user_enabled`、`admin_user_invite_resent`、`admin_user_deleted`、`admin_user_group_created`、`admin_user_group_updated`、`admin_user_group_deleted`。批次操作每個對象一筆，共用 `requestId`。`metadata` 只放 ID、帳號、群組代碼／名稱與權限字串，不放密碼、雜湊、cookie。登入失敗只記錄帳號的雜湊前 12 碼，不記錄輸入的帳號原文（避免把密碼誤打成帳號時外洩）。

## D7. Bootstrap CLI

`npm run admin:bootstrap -- --account <a> --name <n> --email <e>`（`dist/src/admin/bootstrap/admin-bootstrap.cli.js`）：

1. 以 transaction 確認 `User` 為空。
2. upsert 兩個內建群組（`developer`「開發工程師」、`admin`「最高管理者」，`isSystem: true`）。
3. 建立使用者（`passwordHash` 為空）並加入 `developer`。
4. 產生首次登入連結、嘗試寄信，並在終端機輸出連結一次（不寫入日誌檔）。
5. 寫入 `admin_bootstrap` 稽核事件（含寄信結果，不含連結）。

## D8. 部署與本機

- `deploy/demo/compose.yaml` 新增 `admin-api` 服務：`image` 與 `core` 相同、`command: [node, dist/src/admin-main.js]`、`env_file: admin.env`、`ports: 127.0.0.1:${DEMO_ADMIN_HOST_PORT}:3200`、`networks: [backend, ingress]`、依賴 `migrate` 完成。
- `deploy.sh`：`app` 與 `upgrade` 一併啟動 `admin-api`；新增 `admin-bootstrap` 子指令（`dc run --rm admin-api node dist/src/admin/bootstrap/admin-bootstrap.cli.js …`）。
- `admin.env` 範本為 `deploy/demo/config/admin.env.example`（與其他服務的範本一致；`DATABASE_URL`、`ADMIN_CUSTOMER_ID`、`ADMIN_WEB_ORIGIN`、`ADMIN_MAIL_FROM`、`ADMIN_SMTP_*` 由部署者填寫；SMTP 密碼與其他服務的密碼一樣放在權限 600 的 env 檔；不含任何主機位址）。`deploy.sh preflight` 檢查 `admin.env` 與 `DEMO_ADMIN_HOST_PORT`。
- `admin-api` 需能連到 SMTP 伺服器：compose 網路加入 `egress`（或部署者指定的郵件網路）。前面恰好一層公司 Nginx：Compose 固定 `ADMIN_TRUSTED_PROXY_HOPS=1`（Express `trust proxy`），速率限制與稽核使用 Nginx 帶入的 `X-Forwarded-For`；預設 0（直接連線，例如本機）。
- `deploy/demo/nginx-host-routes.example.conf` 新增後台網域範例（網站靜態檔與 `/api/v1/admin/` 轉送，網站與 API 同源；`health` 與 `docs` 不對外）；`compose.company-nginx.yaml` 讓 `admin-api` 以別名 `ai-assistant-admin` 加入公司代理網路。`upgrade` 在變更前檢查 `admin.env` 與 port（新版 compose 缺少它們時整個專案無法解析）。
- 本機：`dev/local-assistant` 的 `PORTS` 新增 `admin: 3200`，`local:start` 啟動 `node dist/src/admin-main.js`（`ADMIN_CUSTOMER_ID` 預設取自本機 Capability Pack 的 Customer，不寫死在程式；`ADMIN_WEB_ORIGIN` 預設為 API 本身 `http://localhost:3200`，讓 Swagger UI 通過 Origin 檢查，後台網站在本機啟動後於 `.env` 改為網站來源；`ADMIN_COOKIE_SECURE=false`、`ADMIN_MAIL_TRANSPORT=log`、`ADMIN_ENABLE_SWAGGER_DOCS=true` 僅限本機；`.env` 中任何 `ADMIN_*` 皆可覆寫預設；邀請與重設連結寫入 `.local-state/assistant/logs/admin.log`）。後台 API 提供公開的 `GET health`（含資料庫檢查），供 `local:start`／`local:status` 與容器 healthcheck 使用。

## D9. 測試

- **單元**：權限定義（字串轉換、`manage` 展開、內建群組權限、`all:manage` 不可指派、只允許四種動作）、ability factory（兩個內建群組與數種自訂群組 × 全部權限的矩陣、開發工程師可見性條件）、密碼雜湊、工作階段逾時計算、CSRF guard。
- **DB 整合**（`assistant_test`，`RUN_DB_BACKED_ADMIN_TESTS=true`；寄信以記錄收件內容的假傳輸替代）：邀請 → verifyToken → firstLogin → 登入、連結過期／重複使用／用途不符、forgot 不透露 email 是否存在與 15 分鐘限制、reset 撤銷工作階段、重寄邀請（含已設定密碼者被拒）、登入／鎖定／登出／逾時／停用／刪除、使用者與群組 API 的允許／拒絕矩陣、開發工程師可見性、email 啟用後唯讀、指派規則與最後一位最高管理者（含批次）、稽核事件、bootstrap、`ADMIN_CUSTOMER_ID` 啟動檢查、回應不含內部欄位。
- **架構**：`src/admin/**` 與 `src/admin-main.ts` 以外的程式不引入後台程式；`src/admin/**` 不引入 Assistant、LLM、檢索、連接器等模組（015 需要時再逐一放行）；每個後台 controller 方法都宣告存取方式；`src/main.ts` 不啟動後台。
- **安全掃描**：測試結束後掃描稽核事件、日誌輸出與所有 API 回應，不得出現測試用的明文密碼、工作階段代碼或連結代碼；也確認沒有任何路由能設定他人密碼（SC-008）。
