# Design: Feature 015 — Admin Operations View

**Spec**: [`spec.md`](./spec.md)　**Plan**: [`plan.md`](./plan.md)

## 0. Reuse Inventory

| 需要 | 沿用 |
| --- | --- |
| 登入、權限、路由宣告、CSRF、錯誤格式 | 014 的 `AdminSessionGuard`、`AdminPermissionGuard`、`@RequirePermission`、`GlobalExceptionFilter`（含 `details`） |
| 列表 | `common/table-query.dto.ts`（`TableQueryDto`、`pageArgs`、`orderByOf`、`keywordWhere`）、`common/ids.dto.ts` |
| 後台稽核 | `UserAuditService.record`（`AuditTarget.type` 擴充 `AssistantSession`、`ReviewItem`） |
| 資料 | 既有 Prisma model：`AssistantSession`、`AssistantMessage`、`FeedbackEvent`、`ReviewItem`、`AuditEvent`、`UserAuditEvent` |
| 統計彙總 | PostgreSQL（`date_trunc`、`AT TIME ZONE`、`generate_series`），以 Prisma `$queryRaw` 樣板字串（參數化）執行，不新增套件 |
| 權限 | 014 已登記 `Conversation:read`、`Stats:read`、`Feedback:read`、`ReviewItem:read/update`、`AuditEvent:read`，不需修改權限定義 |

不 import `src/assistant`、`src/feedback` 等 Core 模組：後台只讀資料表，014 的架構測試不需放寬。

## D1. 程式結構

```
src/admin/
  conversations/   controller、service、dto；conversation-content.ts（讀取一則問答與留稽核，供回饋與待審項目共用）
  stats/           controller、service（$queryRaw）、dto
  feedback/        controller、service、dto
  review-items/    controller、service、dto（路徑 reviewItems）
  audit-events/    assistant-audit（auditEvents）、admin-audit（adminAuditEvents）各一組 controller／service，共用 dto
  common/          period.dto.ts（期間篩選）、labels.ts（列舉的中文標籤）
```

每個模組在 `AdminModule` 註冊；`config/` 新增 `ADMIN_TIME_ZONE`。

## D2. 共用：期間、客戶範圍與內容存取

- **客戶範圍**：每個 service 的查詢條件都以 `{ customerId: settings.customerId }` 開頭；以 id 讀取用 `findFirst({ where: { id, customerId } })`，不屬於此客戶 → 404。
- **期間篩選**（列表）：`filters.from`／`filters.to` 為 ISO 8601 時間（前端換算好時區），`from` 含、`to` 不含。
- **ConversationContent**（`conversations/conversation-content.ts`）：
  - `exchangeAround(messageId)`：讀取該訊息與同一對話中的相鄰訊息，回傳 `{ sessionId, sessionStatus, question, answer }`。若為回答，`question` 是它之前最近的一則使用者訊息；若為提問，`answer` 是之後最近的一則回答。
  - `viewed(principal, meta, target)`：寫入 `admin_conversation_viewed`（`targetType` 為 `AssistantSession`，`metadata` 含 `sessionId`、`messageId?`、`via`）。
  - 呼叫順序：先讀內容、再寫稽核、最後回傳；寫稽核失敗 → 例外向上拋出，不回傳內容（FR-003）。
  - 回饋、待審項目的詳情只在 `principal.ability.can('read', 'Conversation')` 時呼叫，否則 `conversation: null`。
- **中文標籤**（`common/labels.ts`）：`AnswerDecisionStatus`、`ReviewSourceType`、`ReviewItemStatus`、`ReviewPriority`、`FeedbackRating`、`AssistantSessionStatus`、後台稽核事件類型的標籤集中在一處，`getFilters` 與回應共用。

## D3. 對話（US1）

- `getTable`：`where = { customerId, status: filters.status ?? { not: 'deleted' }, hostApp?, organizationId?, actorId?, lastMessageAt?: { gte, lt }, title: keyword contains }`。
  - `hasUnanswered` 篩選：`messages: { some: { role: 'assistant', answerDecision: { in: UNANSWERED } } }`，`UNANSWERED = [no_answer, permission_denied, tool_failed]`。
  - `hasNegativeFeedback` 篩選：`messages: { some: { feedbackEvents: { some: { rating: 'negative' } } } }`。
  - `messageCount`：`_count: { select: { messages: { where: { role: 'user' } } } }`。
  - 兩個標記：對本頁的對話 ID 各查一次（`assistantMessage.findMany({ where: { sessionId: { in }, … }, distinct: ['sessionId'] })`），不逐筆查詢。
  - 排序白名單：`lastMessageAt`（預設 desc，`nulls: 'last'`）、`createdAt`。
- `getFilters`：狀態（含標籤）；`hostApp` 以 `assistantSession.findMany({ distinct: ['hostApp'] })` 取得。
- `GET :id`：讀取 session 與訊息（`role in [user, assistant]`，依 `createdAt`、`id` 排序，取最新 500 則，超過時 `truncated: true`），一併帶入每則回答的 `feedbackEvents` 與相關 `ReviewItem`（以 `messageId` 對應，見 D6），再寫 `admin_conversation_viewed`。

## D4. 統計（US2）

`GET stats/getSummary?from=YYYY-MM-DD&to=YYYY-MM-DD&granularity=day|week`：

- 期間轉換在 SQL 內完成：`start = (from::timestamp AT TIME ZONE tz)`、`end = ((to + 1)::timestamp AT TIME ZONE tz)`；欄位以 `("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE tz` 換成當地時間後 `date_trunc(granularity, …)`（`week` 以週一為起點）。
- 三個查詢（`$queryRaw`，`customerId`、時區、期間皆為參數）：
  1. 使用量序列：`generate_series(bucket)` LEFT JOIN 新對話數、提問數、使用人數（`count(DISTINCT s."actorId")`，提問所屬對話的使用者）。
  2. 回答結果序列：依 bucket 與 `answerDecision` 計數（`role = 'assistant' AND "answerDecision" IS NOT NULL`）。
  3. 總計的使用人數另以一次 `count(DISTINCT)` 取得（不能把各期間的人數相加）。
- 回應：
  ```json
  { "from": "2026-11-01", "to": "2026-11-30", "granularity": "day", "timeZone": "Asia/Taipei",
    "usage": { "total": { "sessions": 0, "questions": 0, "actors": 0 }, "series": [{ "period": "2026-11-01", "sessions": 0, "questions": 0, "actors": 0 }] },
    "answers": { "total": { "answered": 0, "no_answer": 0, "…": 0 }, "labels": { "answered": "已回答" }, "series": [{ "period": "2026-11-01", "answered": 0 }] } }
  ```
  `answers` 的鍵一律列出全部 `AnswerDecisionStatus`（沒有資料為 0），前端不用補值。
- 驗證：`from <= to`、期間 ≤ 366 天、日期格式 `YYYY-MM-DD`。

## D5. 回饋（US3）

- `getTable`：`feedbackEvent.findMany({ where: { customerId, rating?, createdAt?, comment: hasComment ? { not: null } : undefined } })`，附 `message.sessionId`（`include: { message: { select: { sessionId: true } } }`）。回應不含任何訊息內容。
- `GET :id`：回饋資訊；具 `Conversation:read` 時 `conversation = exchangeAround(messageId)` 並留稽核（`via: 'feedback'`）。

## D6. 待審項目（US4）

- **對應到訊息**：`messageId = suggestedImprovement.messageId`（Assistant 結果與回饋建立的項目都有）；沒有時為 `sourceId`（`unsupported_question` 的 `sourceId` 就是使用者提問的訊息 ID）。以 `messageIdOf(item)` 集中處理；列表對本頁的 messageId 一次查出 `sessionId`。
- `getTable`：篩選 `status`（預設 `[open, in_review]`）、`sourceType`、`priority`、`createdAt` 期間；排序 `createdAt`（預設 desc）、`priority`。回應不含 `suggestedImprovement` 原文（可能含工具名稱與內部原因代碼，詳情才回傳）。
- `GET :id`：項目資訊、`suggestedImprovement`、處理紀錄（`userAuditEvent.findMany({ where: { eventType: 'admin_review_item_updated', targetId: id } })`，開發工程師遮蔽同 D7）；具 `Conversation:read` 時附問答並留稽核（`via: 'reviewItem'`）。
- `PATCH batch`：`{ ids, status, note? }`（`note` 最多 500 字）。全部 id 必須屬於此客戶，否則 404 並以 `details.ids` 列出；交易內 `updateMany` 狀態、`note`、`resolvedAt`（改為 `resolved`／`dismissed` 時設定、其他清除）；每筆寫 `admin_review_item_updated`（`metadata: { before, after, note }`）。狀態相同的項目也更新備註並留紀錄。
- **Migration** `20261119000000_feature015_review_item_handling`：`ALTER TABLE "ReviewItem" ADD COLUMN "note" TEXT, ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;`（schema：`note String?`、`updatedAt DateTime @default(now()) @updatedAt`）；ledger 登記 hash。

## D7. 稽核（US5）

- **Assistant 稽核**（`auditEvents`）：`select` 只取 US5-1 列出的欄位（不取 `metadata`、`permissionResult`、`evidenceRefIds`）；篩選 `eventType`（多選）、期間、`actorId`、`sessionId`、`requestId`；排序 `timestamp`（預設 desc）。`getFilters` 以 `distinct: ['eventType']` 取得此客戶出現過的事件類型。
- **後台稽核**（`adminAuditEvents`）：篩選 `eventType`、期間、`actorAccount`；排序 `timestamp`。非開發工程師時：
  - `actorIsDeveloper` → `actor = { account: null, label: '開發工程師' }`。
  - `targetIsDeveloper` → `metadata = null`（內容是開發工程師帳號的資訊）。
  - 以 `actorAccount` 篩選時，不得藉此查出開發工程師帳號：條件加上 `actorIsDeveloper: false`。
- 事件類型標籤：後台事件集中在 `labels.ts`；Assistant 事件直接顯示代碼（事件種類多且屬技術性）。

## D8. 移除 Core 舊的審核 API（US6）

- 刪除 `src/feedback/review-item.controller.ts`，`FeedbackModule` 移除 controller。
- `ReviewItemService` 刪除 `listForReview`、`getForReview`、`markResolved`、`markDismissed` 及只供它們使用的私有方法與 DTO（`ReviewItemsQueryDto`、`ReviewItemDecisionDto`）。
- 測試：刪除 `test/contract/review-items.contract.spec.ts`；`customer-review-isolation`、`customer-feedback-isolation`、`unsupported-question-review-item` 中呼叫舊路由的案例改為直接查資料庫驗證建立結果（隔離保證改由後台 API 的 DB 測試覆蓋）。
- `docs/architecture/assistant-conversation-experience.md` 更新提及舊路由之處。

## D9. 設定

- `ADMIN_TIME_ZONE`：`IsOptional`，預設 `Asia/Taipei`；以 `Intl.DateTimeFormat(undefined, { timeZone })` 驗證是有效的 IANA 名稱。`local:start` 的預設不需變更；部署 `admin.env` 範本加上此項（選填）。

## D10. 測試

- **DB 測試**（`test/integration/admin-*.spec.ts`，`RUN_DB_BACKED_ADMIN_TESTS=true`）：測試輔助程式新增 `seedConversation()`（建立兩個客戶的對話、訊息、回答結果、回饋、待審項目、Assistant 稽核）。
  - 每支 API 的權限矩陣（SC-001）；兩個客戶的資料隔離（SC-004）。
  - 沒有 `Conversation:read` 時掃描回應不含訊息內容與標題（SC-002）。
  - `admin_conversation_viewed`：每次讀取內容一筆；模擬稽核寫入失敗時回應為錯誤且不含內容（SC-003）。
  - 統計：跨台北日界（UTC 15:59／16:00）、空白日期補 0、`week`、366 天上限（SC-005）。
  - 開發工程師遮蔽（SC-006）；待審項目批次全有或全無、`resolvedAt` 設定與清除。
- **架構測試**：維持 014 的邊界；新增「後台不 import `src/feedback`」。
- **Core**：移除舊路由後 Core 全套通過（SC-007）。
