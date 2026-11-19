# Implementation Plan: Feature 015 — Admin Operations View

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Branch**: `015-admin-operations`（自 `014-admin-foundation` 分出）

## Summary

在 014 的後台 API 上新增唯讀的營運檢視：對話列表與內容、統計、回饋、待審項目（含處理狀態）、Assistant 與後台稽核；讀取對話內容一律需要 `Conversation:read` 並留稽核。移除 Core 舊的 review-items 路由。

## Technical Context

- 沿用 014：NestJS 11、Prisma 7、CASL、後台的 envelope 與錯誤格式；不新增依賴。
- 一支只新增欄位的 migration（`ReviewItem.note`、`updatedAt`），hash 登記於 `test/fixtures/migration-ledger.json`；使用者在 Mac 執行 `prisma generate` 與 migrate。
- DB 測試以 `RUN_DB_BACKED_ADMIN_TESTS=true` 啟用，沿用 014 的 advisory lock。

## Constitution Check

- 客戶專屬內容：無。
- 後台不 import Assistant 模組；Core 不 import 後台（架構測試）。
- 讀取對話內容需 `Conversation:read` 並留稽核，稽核失敗不回傳內容。
- 唯讀：除待審項目狀態外不修改 Assistant 資料。

## Phases and Gates

| Phase | 內容 | Gate |
| --- | --- | --- |
| 0 | 基線（specs 索引、feature.json）、migration、`ADMIN_TIME_ZONE`、共用（期間、標籤、`ConversationContent`）、測試資料輔助 | Gate 0：migration 與 schema 一致、ledger、typecheck、014 測試照常通過 |
| 1 | 對話（US1）、統計（US2） | Gate 1：對話與統計 DB 測試、權限矩陣 |
| 2 | 回饋（US3）、待審項目（US4）、移除 Core 舊路由（US6） | Gate 2：相關 DB 測試、Core 全套 |
| 3 | 稽核（US5）、文件（前端串接、架構）、部署範本 | Gate 3：全套、typecheck、lint、本機以 Swagger 檢查 |

每個 Phase 分批實作，使用者確認並 commit 後才進下一批。

## Risks

- **統計 SQL 與時區**：以固定時間點的測試資料驗證日界；`$queryRaw` 的結果型別（`bigint`）在 service 內轉成 number。
- **資料量**：對話列表的標記與統計皆以資料庫彙總；若之後資料量大，再為 `AssistantMessage(customerId, role, createdAt)` 加索引（本版先觀察，不預先加）。
- **移除舊路由的測試**：部分既有 integration 測試以舊路由驗證待審項目，需改寫為直接查資料庫，確保覆蓋率不下降。
