# Tasks: Feature 015 — Admin Operations View

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 規劃完成，待開始 Phase 0

## Phase 0 — 基線與共用

- [ ] T001 `specs/README.md`：014 標為完成（Gate 4 PASS，與 015 一起合併）、登記 015；`.specify/feature.json` 指向 015。
- [ ] T002 Migration `20261119000000_feature015_review_item_handling`（`ReviewItem.note`、`updatedAt`）、schema、ledger。
- [ ] T003 `ADMIN_TIME_ZONE`（驗證、`AdminSettings`、`admin.env.example`）；`AuditTarget` 擴充 `AssistantSession`、`ReviewItem`；新增事件類型 `admin_conversation_viewed`、`admin_review_item_updated`。
- [ ] T004 共用：`common/period.dto.ts`、`common/labels.ts`、`conversations/conversation-content.ts`；測試輔助 `seedConversation()`（兩個客戶）。
- [ ] T005 **Gate 0**：使用者 `npx prisma generate`、migrate（本機與測試資料庫）、`prisma migrate diff`、ledger 測試、typecheck、014 後台測試。`FEATURE015_GATE_0=PASS`。

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
