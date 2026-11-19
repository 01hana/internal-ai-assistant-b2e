# Tasks: Feature 015 — Admin Operations View

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: Phase 0 完成（Gate 0 PASS），待開始 Phase 1

## Phase 0 — 基線與共用

- [x] T001 `specs/README.md`：014 標為完成（Gate 4 PASS，與 015 一起合併）、登記 015；`.specify/feature.json` 指向 015。
- [x] T002 Migration `20261119000000_feature015_review_item_handling`（`ReviewItem.note`、`updatedAt`）、schema、ledger。
- [x] T003 `ADMIN_TIME_ZONE`（驗證、`AdminSettings`、`admin.env.example`）；`AuditTarget` 擴充 `AssistantSession`、`ReviewItem`；新增事件類型 `admin_conversation_viewed`、`admin_review_item_updated`。
- [x] T004 共用：`common/period.dto.ts`、`common/labels.ts`、`conversations/conversation-content.ts`；測試輔助 `seedConversation()`（兩個客戶）。
- [x] T005 **Gate 0**：使用者 `npx prisma generate`、migrate（本機與測試資料庫）、`prisma migrate diff`、ledger 測試、typecheck、014 後台測試。`FEATURE015_GATE_0=PASS`。

**Phase 0 執行證據（2026-11-19）**：

- T001：`specs/README.md` 014 標為完成（與 015 一起合併）、登記 015；`.specify/feature.json` 指向 015。
- T002：migration `20261119000000_feature015_review_item_handling`（`ReviewItem.note TEXT`、`updatedAt TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP`，schema `@default(now()) @updatedAt`），ledger 已登記。VM 無法執行 `prisma generate`（無法下載 engine），由使用者於 Gate 0 產生 client。
- T003：`ADMIN_TIME_ZONE` 以 class-validator 內建的 `@IsTimeZone()` 驗證（預設 `Asia/Taipei`），`AdminSettings.timeZone`，`admin.env.example` 加註；`AuditTarget.type` 加入 `AssistantSession`、`ReviewItem`，事件類型加入 `admin_conversation_viewed`、`admin_review_item_updated`；環境驗證新增未知時區的拒絕案例。
- T004：`common/period.dto.ts`（`PeriodFilterDto`、`periodWhere`）、`common/labels.ts`（各列舉與後台事件的中文標籤，`satisfies Record<…>` 讓新增列舉值未加標籤時編譯失敗；`optionsOf()`）、`conversations/conversation-content.ts`（`ConversationContentService`：`canRead`、`recordView`、`readExchange` 先讀內容、再寫稽核、最後回傳）；測試資料 `test/support/admin-operations.fixture.ts`（`OTHER_TEST_CUSTOMER`、`resetOperationsData`、`seedConversation`：對話、訊息、Assistant 稽核、回饋、待審項目，格式與 Assistant 實際寫入的一致）。架構測試既有的禁止清單已包含 `feedback`，不需修改。VM：typecheck、eslint 通過。
- T005 Gate 0（使用者於 Mac，2026-11-19）：`prisma generate`、本機與測試資料庫 migrate、typecheck、ledger 與架構測試、環境驗證單元測試、014 後台 DB 測試全數通過。`FEATURE015_GATE_0=PASS`。

## Phase 1 — 對話與統計

- [ ] T006 對話 API：`conversations/getTable`、`getFilters`、`GET :id`（留稽核、500 則上限）。
- [ ] T007 統計 API：`stats/getSummary`（使用量、回答結果分布、時區、補 0、366 天上限）。
- [ ] T008 DB 測試：權限矩陣、客戶隔離、篩選與排序、`deleted` 預設排除、內容稽核（含稽核失敗不回傳內容）、統計日界與 `week`。
- [ ] T009 **Gate 1**：Phase 1 測試、typecheck、lint。`FEATURE015_GATE_1=PASS`。

## Phase 2 — 回饋、待審項目、移除舊路由

- [ ] T010 回饋 API：`feedback/getTable`、`GET :id`（有 `Conversation:read` 才含問答並留稽核）。
- [ ] T011 待審項目 API：`reviewItems/getTable`、`getFilters`、`GET :id`（處理紀錄、問答）、`PATCH batch`（全有或全無、`resolvedAt`、稽核）。
- [ ] T012 移除 Core `/api/v1/admin/assistant/review-items` 與只供它使用的 service 方法、DTO、測試；改寫相關 integration 測試。
- [ ] T013 DB 測試：權限矩陣、沒有 `Conversation:read` 時回應不含問答、開發工程師遮蔽、批次規則、客戶隔離。
- [ ] T014 **Gate 2**：Phase 2 測試、Core 全套、typecheck、lint。`FEATURE015_GATE_2=PASS`。

## Phase 3 — 稽核與文件

- [ ] T015 稽核 API：`auditEvents/getTable`、`getFilters`；`adminAuditEvents/getTable`、`getFilters`（開發工程師遮蔽、`actorAccount` 篩選限制）。
- [ ] T016 DB 測試：權限、客戶隔離、Assistant 稽核不含 `metadata`、遮蔽規則。
- [ ] T017 文件：`docs/frontend-integration/admin-api.md`（新 API、權限與內容規則）、`docs/architecture/admin-back-office.md`、部署 README 的 `ADMIN_TIME_ZONE`。
- [ ] T018 **Gate 3**：全套、typecheck、lint、build；本機 `local:start` 以 Swagger 走過各 API（有／無 `Conversation:read` 的帳號各一）。`FEATURE015_GATE_3=PASS`。
