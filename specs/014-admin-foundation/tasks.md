# Tasks: Feature 014 — Admin Back-Office Foundation

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 規格審核中；審核通過前不得實作

## Phase 0 — 基線

- [x] T001 `specs/README.md`：013 標為完成（合併 2026-11-17）、登記 014；`.specify/feature.json` 指向 014。
- [ ] T002 使用者於 Mac 安裝依賴：`npm install @casl/ability @casl/prisma cookie-parser nodemailer` 與 `npm install -D @types/cookie-parser @types/nodemailer`，提交 `package.json`、`package-lock.json`。
- [ ] T003 **Gate 0**：既有 Core 全套與 Gateway 全套通過（新依賴不影響現有功能）；以最小範例確認 `@casl/prisma` 支援關聯條件（`none`、`NOT`）。`FEATURE014_GATE_0=PASS`。

## Phase 1 — 權限契約與資料模型

- [ ] T004 新增 `packages/admin-permission-contract`（subjects、內建群組、僅限原廠權限、`subject:action` 轉換、`toCaslRules`），build 設定比照 `internal-identity-contract`；根 `package.json` 以 `file:` 引用。
- [ ] T005 契約單元測試：字串雙向轉換、未知權限拒絕、內建群組權限與 spec 表格一致、`all:manage` 不可出現在自訂群組、動作只允許 `read`／`create`／`update`／`delete`（與 `manage`）。
- [ ] T006 Prisma schema 新增 `User`、`UserGroup`（兩者隱含多對多）、`UserToken`、`UserSession`、`UserAuditEvent`；migration `20261118000000_feature014_admin_foundation`；ledger 登記 hash。
- [ ] T007 **Gate 1**：使用者 `npx prisma generate`、migrate（本機與測試資料庫）、契約測試、typecheck。`FEATURE014_GATE_1=PASS`。

## Phase 2 — 登入與工作階段

- [ ] T008 `src/admin-main.ts`、`AdminModule`、後台環境變數驗證（`ADMIN_PORT`、`ADMIN_WEB_ORIGIN`、`ADMIN_CUSTOMER_ID`、`ADMIN_COOKIE_SECURE`、`ADMIN_SMTP_*`、`ADMIN_MAIL_*`）。
- [ ] T009 密碼雜湊（scrypt）與密碼規則；連結代碼服務（產生、驗證、使用、失效）；寄信服務（SMTP／log 傳輸、邀請信與重設信範本、`admin:mail:test`）；單元測試。
- [ ] T010 工作階段服務（建立、驗證閒置／絕對逾時、撤銷、`lastSeenAt` 節流）；可注入時鐘的單元測試。
- [ ] T011 `AdminAuthGuard`、`CsrfGuard`、登入限流。
- [ ] T012 `auth/login`、`auth/logout`、`auth/profile`、`auth/verifyToken`、`auth/firstLogin`、`auth/forgot`、`auth/reset`；鎖定規則；`ADMIN_CUSTOMER_ID` 啟動檢查。
- [ ] T013 `UserAuditService` 與登入相關事件。
- [ ] T014 `admin:bootstrap` CLI 與 npm script。
- [ ] T015 DB 測試：US1、US2 全部情境；稽核事件、日誌與回應不含密碼、工作階段代碼與連結代碼。
- [ ] T016 架構測試：`AppModule` 不引入 `src/admin/**`；`src/admin/**` 不引入 Assistant／LLM 模組；Core 路由沒有 `/admin`。
- [ ] T017 **Gate 2**：Phase 2 測試、全套、typecheck、lint。`FEATURE014_GATE_2=PASS`。

## Phase 3 — 權限、使用者與群組

- [ ] T018 `AdminAbilityFactory`（群組 → CASL 規則，含非原廠的原廠可見性條件）、`@RequirePermission`、`PermissionGuard`（未宣告即拒絕）。
- [ ] T019 使用者 API：`getTable`（`accessibleBy`）、`getFilters`、讀取、建立、修改（含群組）、`batch` 停用／啟用、`resendInvite`、`DELETE`；原廠可見性、指派規則與最後一位管理者檢查（含批次）。
- [ ] T020 群組 API：`getTable`、`getOptions`、`getPermissions`、讀取、建立、修改、`DELETE`；權限驗證、內建群組不可改、有成員不可刪、非原廠看不到原廠群組。
- [ ] T021 DB 測試：三群組 × 全部 API 的允許／拒絕矩陣（SC-001）、原廠帳號與群組的可見性（SC-002）、US3、US4 全部情境、稽核事件（SC-004）、所有回應不含內部欄位（SC-007）、沒有能設定他人密碼的路由（SC-008）。
- [ ] T022 **Gate 3**：Phase 3 測試、全套、typecheck、lint。`FEATURE014_GATE_3=PASS`。

## Phase 4 — 本機、部署與文件

- [ ] T023 本機：`PORTS.admin = 3200`，`local:start`／`local:status`／`local:stop` 納入後台 API。
- [ ] T024 部署：`compose.yaml` 新增 `admin-api`；`deploy.sh` 的 `app`、`upgrade` 與新增的 `admin-bootstrap`；`prepare-delivery.sh` 的 `admin.env` 範本（含 SMTP 設定與 secret）；nginx 範例；部署 preflight 的寄測試信步驟。
- [ ] T025 文件：`docs/architecture/admin-back-office.md`（結構、權限模型、部署）、`docs/frontend-integration/admin-api.md`（給後台前端的 API 與權限契約）、部署手冊新增後台步驟。
- [ ] T026 **Gate 4**：全套、typecheck、lint、`npm run build` 產出 `dist/src/admin-main.js`、本機以 `admin:bootstrap` 建立帳號，從日誌取得連結，以 curl 走過 verifyToken → firstLogin → 登入 → profile → 建立使用者（日誌出現邀請連結）→ 登出 → forgot → reset。`FEATURE014_GATE_4=PASS`。
