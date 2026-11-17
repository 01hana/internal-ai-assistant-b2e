# Implementation Plan: Feature 014 — Admin Back-Office Foundation

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Branch**: `014-admin-foundation`

## Summary

在 Core 的程式庫內建立獨立行程的後台 API（`src/admin/` + `src/admin-main.ts`），提供使用者、使用者群組、登入工作階段、CASL 權限與後台稽核；權限清單以 `packages/admin-permission-contract` 為唯一來源，供後台前端共用。部署時以同一個 Core image、不同指令啟動 `admin-api` 容器。

## Technical Context and Existing Interfaces

- NestJS 11、Prisma 7（產生的 client 納入版控，schema 變更後需 `npx prisma generate`）、PostgreSQL 16。
- 既有 envelope、`requestId`、錯誤格式、日誌遮罩直接沿用。
- Migration 只新增，hash 登記於 `test/fixtures/migration-ledger.json`。
- 新依賴：`@casl/ability`、`@casl/prisma`、`cookie-parser`、`nodemailer`（`@types/cookie-parser`、`@types/nodemailer`）。VM 無法安裝套件：由使用者在 Mac 上 `npm install` 並提交 lockfile，之後才進入使用這些套件的階段。
- 測試：單元測試不需資料庫；DB 測試使用 `assistant_test`，以 `RUN_DB_BACKED_ADMIN_TESTS=true` 啟用（Gate 指令會帶上）。

## Constitution Check

- 客戶專屬內容：無（權限、群組、程式皆通用；客戶差異只在部署時建立的資料）。
- Core 的客戶系統 API 行為不變；Core、Gateway 上不出現 `/admin` 路徑（架構測試鎖定）。
- 權限只在後端判斷；未宣告權限的後台路由一律拒絕。
- 所有狀態變更留稽核；稽核與日誌不含密碼、雜湊、工作階段代碼。

## Phases and Gates

| Phase | 內容 | Gate |
| --- | --- | --- |
| 0 | 基線：specs 索引、使用者在 Mac 安裝新依賴 | Gate 0：依賴安裝完成、既有全套通過 |
| 1 | 權限契約套件、資料模型與 migration、Prisma client | Gate 1：契約單元測試、migration ledger、typecheck |
| 2 | 後台進入點、寄信、設定密碼連結（firstLogin／forgot／reset）、登入／登出／profile、工作階段、CSRF、限流、稽核、bootstrap CLI | Gate 2：auth 單元與 DB 測試、架構測試 |
| 3 | CASL ability、權限 guard、使用者 API、群組 API | Gate 3：權限矩陣、原廠可見性、指派規則、稽核 |
| 4 | 本機啟動、部署設定、文件 | Gate 4：全套、typecheck、lint、build 產出 `dist/src/admin-main.js`、本機手動驗證 |

每個 Gate 由使用者在 Mac 執行並回傳 JSON 結果；通過後由使用者 commit。

## Risks

- **新依賴**：`@casl/prisma` 需與 Prisma 7 相容；Phase 0 安裝後先以最小範例確認 `accessibleBy` 可用，不相容時改為手寫 `where` 條件（設計已將查詢條件集中在一處）。
- **cookie 與部署網域**：`SameSite=Strict` 需要後台網站與 API 同網域；部署文件須寫清楚。
- **時間相關測試**：逾時、鎖定與連結期限以可注入的時鐘測試，避免依賴實際等待。
- **寄信**：各部署需提供 SMTP；信可能被客戶的郵件系統擋下。部署時以 `admin:mail:test` 先確認，且建立帳號時寄信失敗不阻擋，可重寄。
