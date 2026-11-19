# Tasks: Feature 015 — Admin Operations View

**Spec**: [`spec.md`](./spec.md)　**Design**: [`design.md`](./design.md)　**Plan**: [`plan.md`](./plan.md)
**Status**: 完成（Gate 3 PASS，2026-11-19）；與 014 一起合併到 main，實際部署與 014 一起進行

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

- [x] T006 對話 API：`conversations/getTable`、`getFilters`、`GET :id`（留稽核、500 則上限）。
- [x] T007 統計 API：`stats/getSummary`（使用量、回答結果分布、時區、補 0、366 天上限）。
- [x] T008 DB 測試：權限矩陣、客戶隔離、篩選與排序、`deleted` 預設排除、內容稽核（含稽核失敗不回傳內容）、統計日界與 `week`。
- [x] T009 **Gate 1**：Phase 1 測試、typecheck、lint。`FEATURE015_GATE_1=PASS`。

**Phase 1 執行證據（2026-11-19）**：

- T006：`conversations/`（controller、service、dto）。列表條件：此客戶、狀態（預設排除 `deleted`）、`hostApp`／`organizationId`／`actorId`、最後訊息時間期間、`hasNegativeFeedback`／`hasUnanswered`（以 `some`／`none` 關聯條件）、標題關鍵字；`messageCount` 以 Prisma 的篩選關聯計數；兩個標記對本頁對話各查一次（`distinct: ['sessionId']`）；`lastMessageAt` 排序時沒有訊息的對話一律排在最後。`GET :id` 取最新 500 則（多取一則判斷 `truncated`），附每則訊息的回饋與待審項目，先寫 `admin_conversation_viewed` 再回傳。待審項目與訊息的對應集中在 `review-items/review-item-source.ts`（`messageIdOf()` 與等價的 SQL `COALESCE("suggestedImprovement"->>'messageId', "sourceId")`，一次查出多則訊息的項目）。
- T007：`stats/`。三個參數化的 `$queryRaw`：使用量序列（`generate_series` 產生每個區間，LEFT JOIN 新對話數、提問數、使用人數）、回答結果（依區間與 `answerDecision` 計數）、整段期間的使用人數。期間在 SQL 內換算：當地日期的午夜 `AT TIME ZONE ADMIN_TIME_ZONE` 再轉回資料庫儲存的 UTC；區間為 `date_trunc(day|week, 當地時間)`。參數一律加型別轉換（`::text`、`::date`），避免 PostgreSQL 無法推斷參數型別。回答結果的鍵一律包含全部 `AnswerDecisionStatus`。
- T008：`admin-conversations.spec.ts`（8 tests：列表、篩選與排序、篩選選項、內容與稽核、已刪除對話與客戶隔離、稽核失敗不回傳內容、500 則上限、權限）、`admin-stats.spec.ts`（5 tests：台北日界 15:59Z／16:00Z、補 0、已刪除對話計入、週、`ADMIN_TIME_ZONE=UTC`、期間驗證、權限）。測試輔助新增 `signInWithPermissions()`。VM：typecheck、eslint 通過（DB 測試由使用者於 Mac 執行）。
- T009 Gate 1（使用者於 Mac，2026-11-19）：首次執行 8 個失敗，原因是測試資料庫尚未套用 015 migration（`ReviewItem.updatedAt` 不存在），以 `.env.test` 的 `DATABASE_URL` 執行 `prisma migrate deploy` 後重跑：後台 DB 測試 6 個檔案 80 tests 全數通過（其後一次執行曾出現失敗但未留下輸出，再執行兩次皆通過；如再出現需保留輸出追查）。typecheck、eslint 通過。自我檢查修正：測試輔助程式的預設環境補上 `ADMIN_TIME_ZONE`，避免設定 `UTC` 的測試影響同一檔案之後的測試。`FEATURE015_GATE_1=PASS`。

## Phase 2 — 回饋、待審項目、移除舊路由

- [x] T010 回饋 API：`feedback/getTable`、`GET :id`（有 `Conversation:read` 才含問答並留稽核）。
- [x] T011 待審項目 API：`reviewItems/getTable`、`getFilters`、`GET :id`（處理紀錄、問答）、`PATCH batch`（全有或全無、`resolvedAt`、稽核）。
- [x] T012 移除 Core `/api/v1/admin/assistant/review-items` 與只供它使用的 service 方法、DTO、測試；改寫相關 integration 測試。
- [x] T013 DB 測試：權限矩陣、沒有 `Conversation:read` 時回應不含問答、開發工程師遮蔽、批次規則、客戶隔離。
- [x] T014 **Gate 2**：Phase 2 測試、Core 全套、typecheck、lint。`FEATURE015_GATE_2=PASS`。

**Phase 2 執行證據**（分兩批）：

- 第一批（2026-11-19，回饋與待審項目）：
  - T010 `feedback/`：`getTable`（評分、期間、有無留言、關鍵字比對原因與留言；回應不含問答文字）、`getFilters`（評分選項，spec API 表補上此路由）、`GET :id`（以 `ConversationContentService.readExchange` 取被評價的回答與前一則提問，沒有 `Conversation:read` 時為 null，有則先稽核再回傳）。
  - T011 `review-items/`（路徑 `reviewItems`）：`getTable`（預設 `open`、`in_review`；類型、優先度、期間、關鍵字比對摘要；以 `messageIdOf()` 對應訊息並一次查出 `sessionId`；不含 `suggestedImprovement` 與問答文字）、`getFilters`、`GET :id`（`suggestedImprovement`、處理紀錄、問答）、`PATCH batch`（全有或全無；逐筆更新狀態，`note` 有給才覆寫；改為已解決／不處理時設定 `resolvedAt`，已是關閉狀態則保留原時間，改回其他狀態時清除；每筆寫 `admin_review_item_updated`，`metadata` 含前後狀態與備註）。處理紀錄的執行者以共用的 `audit/audit-actor.ts` 顯示（非開發工程師看到開發工程師為「開發工程師」，Phase 3 的後台稽核沿用）。
  - T013（部分）：`admin-feedback.spec.ts`（4 tests）、`admin-review-items.spec.ts`（8 tests）：列表不含問答文字、篩選與選項、詳情的內容權限與稽核、批次狀態與 `resolvedAt`、全有或全無、開發工程師遮蔽、權限、客戶隔離。VM：typecheck、eslint 通過。
- 第一批測試（使用者於 Mac，2026-11-19）：後台 DB 測試 92 tests 全數通過；已 commit（`2b196ee`）。
- 第二批（2026-11-19，移除 Core 舊的審核 API）：
  - T012：刪除 `src/feedback/review-item.controller.ts`，`FeedbackModule` 移除 controller；`ReviewItemService` 刪除 `listForReview`、`getForReview`、`markResolved`、`markDismissed` 及只供它們使用的 `transitionReviewItem`、`hasValidSource`、`isVisibleIntegrationSession`、`toReviewItemResponse` 與兩個 input 型別；`feedback.dto.ts` 刪除 `ReviewItemsQueryDto`、`ReviewItemDecisionDto`。建立待審項目的三個方法不變。
  - 測試：刪除 `test/contract/review-items.contract.spec.ts`、`test/integration/customer-review-isolation.spec.ts`（只測舊路由，客戶隔離改由後台 `admin-review-items.spec.ts` 覆蓋）；`customer-feedback-isolation.spec.ts` 刪除以舊讀取方法驗證的一項；`unsupported-question-review-item.spec.ts` 刪除以舊路由篩選的兩項（建立時的客戶與不複製提問文字，已由同檔第一項以資料驗證）。架構測試新增：Core（`src/admin/` 以外）沒有 `@Controller('admin…')`。
  - 文件：`docs/architecture/assistant-conversation-experience.md` 改為說明由後台 `reviewItems/*` 檢視。VM：typecheck、eslint 通過。
- T014 Gate 2（使用者於 Mac，2026-11-19）：首輪 Core 全套 2 個失敗：(1) 架構測試以字串比對 import 路徑，把後台自己的 `src/admin/feedback/` 誤判為 Core 的 `src/feedback/` —— 改為先把 import 換算成 `src/` 下的實際位置再判斷所屬模組；(2) `session-list.spec.ts`「pages without duplicates or gaps」建立對話時回應沒有 `data`（記憶體測試資料，與本次變更無關；同檔其他測試通過，重跑未重現，推測即 014 Gate 3 那次未留紀錄的偶發失敗）—— 測試輔助函式改為建立失敗時在錯誤中附上 HTTP 狀態與回應，再出現時可追查。重跑：Core 全套 283 suites（0 failed）、後台 DB 測試 8 個檔案 92 tests 全數通過；typecheck、eslint 通過。`FEATURE015_GATE_2=PASS`。

## Phase 3 — 稽核與文件

- [x] T015 稽核 API：`auditEvents/getTable`、`getFilters`；`adminAuditEvents/getTable`、`getFilters`（開發工程師遮蔽、`actorAccount` 篩選限制）。
- [x] T016 DB 測試：權限、客戶隔離、Assistant 稽核不含 `metadata`、遮蔽規則。
- [x] T017 文件：`docs/frontend-integration/admin-api.md`（新 API、權限與內容規則）、`docs/architecture/admin-back-office.md`、部署 README 的 `ADMIN_TIME_ZONE`。
- [x] T018 **Gate 3**：全套、typecheck、lint、build；本機 `local:start` 以 Swagger 走過各 API（有／無 `Conversation:read` 的帳號各一）。`FEATURE015_GATE_3=PASS`。

**Phase 3 執行證據（2026-11-19）**：

- T015 `audit-events/`：`auditEvents/getTable`（`select` 只取 US5-1 的欄位，不取 `metadata`、`permissionResult`、`evidenceRefIds`；篩選事件類型、使用者、對話、request、期間）、`getFilters`（此客戶出現過的事件類型）；`adminAuditEvents/getTable`（篩選事件類型、執行者帳號、期間；以 `audit-actor.ts` 遮蔽開發工程師；對象為開發工程師帳號時 `targetId`、`metadata` 為 null；非開發工程師以帳號篩選時加上 `actorIsDeveloper: false`）、`getFilters`（後台事件類型與中文標籤）。兩個 controller 只有讀取路由。
- T016 `admin-audit-events.spec.ts`（6 tests）：Assistant 稽核不含 `metadata`、客戶隔離、各篩選、事件類型選項；後台稽核的開發工程師遮蔽（含 `targetId`／`metadata`、帳號篩選）、事件類型驗證；權限與沒有修改／刪除稽核的路由。
- T017 文件：`docs/frontend-integration/admin-api.md` 新增「6. 營運檢視」（內容權限與稽核、各 API 的 body 與回應、狀態規則、遮蔽規則）；`docs/architecture/admin-back-office.md` 新增「6. 營運檢視」；部署 README 加上 `ADMIN_TIME_ZONE`（`admin.env.example` 已於 T003 加入）。VM：typecheck、eslint 通過。
- Swagger 範例：`PeriodFilterDto` 的 `from`／`to` 加上 `@example`（Swagger CLI plugin 讀取 JSDoc），範例 body 不再是無效的 `"string"`。
- T018 Gate 3（使用者於 Mac，2026-11-19）：build、typecheck、eslint 通過；Core 全套 284 suites、2561 tests（2277 passed、284 skipped、0 failed）；後台 DB 測試 9 個檔案 98 tests 全數通過。本機 `local:start` 以 Swagger 檢查：開發工程師帳號讀取對話、統計、回饋與待審項目詳情（含問答）、批次更新待審項目與處理紀錄、後台稽核中的 `admin_conversation_viewed`；只有營運權限（無 `Conversation:read`）的帳號：對話 API 403、詳情的 `conversation` 為 null、開發工程師顯示為「開發工程師」——使用者回報皆無問題。`FEATURE015_GATE_3=PASS`。

## 後續調整（合併前）

- 2026-11-19（後台前端 `internal-ai-assistant-admin` spec 001 的 T001）：`ADMIN_WEB_ORIGIN` 支援逗號分隔的多個來源（`@Transform` 拆成陣列，`@IsUrl({ each: true })` 逐一驗證）；`AdminSettings.webOrigins` 供 CORS 與 Origin 檢查，`webOrigin`（第一個）供信件連結；`local:start` 預設 `http://localhost:3300,http://localhost:3200`（網站 dev server 在前，信件連結開啟網站；Swagger UI 在後）。測試：環境驗證（多來源、清單中有無效值）、`admin-app-setup.spec.ts` 新增來源測試（清單中任一可用、其他 403、信件連結用第一個）、本機腳本預設值。文件：前端串接、架構、README、`admin.env.example`。

