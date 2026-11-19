# Feature Specification: Feature 015 — Admin Operations View

**Canonical Feature Path**: `specs/015-admin-operations`
**Feature Branch**: `015-admin-operations`（自 `014-admin-foundation` 分出，之後一起合併）
**Created**: 2026-11-19
**Status**: Draft — 決定已記錄（見 Decisions）
**Predecessor Baseline**: `014-admin-foundation` @ `8d2fc81`（Feature 014 Gate 4 PASS，尚未合併）

## Problem Statement

Feature 014 建好了後台的使用者、群組、登入、權限與稽核，但後台還看不到任何 Assistant 的資料。對話、回答結果、使用者回饋、無法回答的問題（`ReviewItem`）與 Assistant 稽核（`AuditEvent`）都已經記錄在資料庫，卻只能直接查資料庫。015 提供這些資料的**檢視**，以及待審項目的**處理狀態更新**，讓客戶與我方能看到 AI 助理實際被怎麼使用、哪裡答不好。

## Scope and Authority

- 本 feature 只做後台 API（`src/admin/`）；後台網站（`internal-ai-assistant-admin`）依 `docs/frontend-integration/admin-api.md` 串接，另以其自身的 spec 建置。
- **唯讀為主**：除了待審項目的狀態，015 不修改任何 Assistant 資料；不能刪除對話、訊息、回饋或稽核。
- **資料範圍**：所有查詢一律以 `ADMIN_CUSTOMER_ID` 過濾 `customerId`（一個部署 = 一個客戶，沿用 014）。
- **使用者身分只有 ID**：Assistant 的資料只記錄客戶系統使用者的 `actorId`、`organizationId`、`hostApp`，沒有姓名；後台照原樣顯示這三個值，不嘗試對應到人名。
- **對話內容的權限**：看得到問答文字（對話標題、訊息內容）一律需要 `Conversation:read`。只有 `Feedback:read` 或 `ReviewItem:read` 的人，只看得到評分、原因、狀態、類型等資料，看不到問答文字。
- **查看內容留稽核**：每次讀取對話內容（對話詳情，以及回饋、待審項目詳情中的問答）都寫入 `UserAuditEvent` `admin_conversation_viewed`。列表不寫稽核（列表只含對話標題，不含訊息內容）。
- **使用者已刪除的對話**：客戶系統使用者在 AI 助理刪除的對話（`status = deleted`，資料保留）後台看得到，並標示「使用者已刪除」；列表預設不含，以篩選條件顯示。
- **開發工程師的稽核身分**：非開發工程師檢視後台稽核時，執行者或對象為開發工程師的一律顯示為「開發工程師」（014 spec US5-3）。
- **Core 舊的審核 API 移除**：`/api/v1/admin/assistant/review-items`（Feature 001，用客戶系統身分；Gateway 不轉送，部署後無人能呼叫）由後台 API 取代並移除；建立待審項目的邏輯保留在 Core。
- **後台不引入 Assistant 模組**：後台以 Prisma 直接讀取所需資料表，不 import `src/assistant`、`src/feedback` 等模組（014 的架構測試維持不變）。
- **不在本 feature 範圍**：體驗設定編輯（016）、匯出、資料保存與刪除政策、使用者姓名對應、回饋比例與工具使用統計、即時更新、後台網站頁面本身。

## User Scenarios & Testing

### User Story 0 — 開發基線（Priority: P0）

1. **Given** 開啟 `specs/README.md`，**then** 014 標為完成（Gate 4 PASS，與 015 一起合併）、015 列為進行中；`.specify/feature.json` 指向 015。

### User Story 1 — 對話列表與對話內容（Priority: P1）

身為具 `Conversation:read` 的後台使用者，我可以瀏覽對話、找到特定使用者或時段的對話，並打開看完整的問答。

**Independent Test**: 建立數個不同狀態、使用者、HostApp 的對話 → 列表篩選、排序、分頁正確；打開一個對話 → 看到依時間排序的問答、每則回答的結果與回饋，並產生一筆 `admin_conversation_viewed`。

1. **Given** 具 `Conversation:read`，**when** `POST conversations/getTable`，**then** 回傳對話：`id`、`title`、`actorId`、`organizationId`、`hostApp`、`status`、`messageCount`（使用者提問數）、`createdAt`、`lastMessageAt`，以及標記 `hasNegativeFeedback`、`hasUnanswered`（含無法回答、權限不足、工具失敗等非「已回答」結果）。篩選：`status`（預設排除 `deleted`）、`hostApp`、`organizationId`、`actorId`、期間（`lastMessageAt`）、`hasNegativeFeedback`、`hasUnanswered`；`keyword` 比對標題；排序 `lastMessageAt`（預設新到舊）、`createdAt`。
2. **Given** 同上，**when** `GET conversations/getFilters`，**then** 回傳狀態選項與此客戶出現過的 `hostApp`。
3. **Given** 同上，**when** `GET conversations/:id`，**then** 回傳對話資訊與訊息（只含 `user`、`assistant` 角色；`id`、`role`、`content`、`answerDecision`、`createdAt`），每則回答附上回饋（評分、原因、留言）與相關待審項目（ID、類型、狀態）；寫入 `admin_conversation_viewed`（`targetType: 'AssistantSession'`、`sessionId`）。
4. **Given** 沒有 `Conversation:read`，**then** 上述 API 一律 403；對話不存在或不屬於此客戶，404。

### User Story 2 — 統計（Priority: P1）

身為具 `Stats:read` 的後台使用者，我可以看到一段期間的使用量與回答結果分布，判斷 AI 助理的使用狀況與回答品質。

1. **Given** 具 `Stats:read`，**when** `GET stats/getSummary?from&to&granularity=day|week`，**then** 回傳期間內：
   - **使用量**：新對話數、提問數（使用者訊息）、使用人數（不重複 `actorId`），總計與依日／週的序列。
   - **回答結果分布**：Assistant 回答依 `answerDecision`（已回答、需澄清、無法回答、權限不足、工具失敗、需核准／確認、需轉人工）的數量與比例，總計與序列。
2. 日期依部署設定的時區切分（`ADMIN_TIME_ZONE`，預設 `Asia/Taipei`）；`from`、`to` 為該時區的日期（含頭尾），最長 366 天；沒有資料的日期回傳 0，序列連續。
3. 已被使用者刪除的對話仍計入統計（統計反映實際使用）。

### User Story 3 — 回饋（Priority: P2）

身為具 `Feedback:read` 的後台使用者，我可以看到使用者對回答的評價，找出答不好的地方。

1. **Given** 具 `Feedback:read`，**when** `POST feedback/getTable`，**then** 回傳：`id`、`rating`（👍／👎／中立）、`reason`、`comment`、`answerDecision`、`createdAt`、`sessionId`、`messageId`。篩選：`rating`、期間、`hasComment`；排序 `createdAt`。
2. **Given** 同上，**when** `GET feedback/:id`，**then** 回傳回饋資訊；呼叫者**也**具 `Conversation:read` 時，另回傳被評價的回答與它前一則使用者提問的文字，並寫入 `admin_conversation_viewed`（`messageId`、`via: 'feedback'`）；沒有時 `conversation` 為 `null`。

### User Story 4 — 待審項目（無法回答的問題等）（Priority: P1）

身為具 `ReviewItem:read` 的後台使用者，我可以看到 AI 助理無法回答、工具失敗、收到負評等需要改善的項目；具 `ReviewItem:update` 時可以標記處理狀態。

1. **Given** 具 `ReviewItem:read`，**when** `POST reviewItems/getTable`，**then** 回傳：`id`、`sourceType`（類型）、`status`、`priority`、`summary`、`createdAt`、`resolvedAt`、`sessionId`、`messageId`。篩選：`status`（預設 `open`、`in_review`）、`sourceType`、`priority`、期間；排序 `createdAt`、`priority`。
2. **Given** 同上，**when** `GET reviewItems/getFilters`，**then** 回傳類型、狀態、優先度選項（含中文標籤）。
3. **Given** 同上，**when** `GET reviewItems/:id`，**then** 回傳項目資訊與處理紀錄（誰、何時、改成什麼狀態、備註）；呼叫者也具 `Conversation:read` 時，另回傳相關的使用者提問與回答文字，並寫入 `admin_conversation_viewed`（`via: 'reviewItem'`）。
4. **Given** 具 `ReviewItem:update`，**when** `PATCH reviewItems/batch` 以 `{ ids, status, note? }`，**then** 更新狀態（`open`、`in_review`、`resolved`、`dismissed` 之間可任意切換；改為 `resolved`／`dismissed` 時記錄 `resolvedAt`，改回其他狀態時清除），全有或全無；每筆寫入 `admin_review_item_updated`（前後狀態、備註）。
5. **Given** 非開發工程師檢視處理紀錄，**then** 處理者為開發工程師時顯示「開發工程師」。

### User Story 5 — 稽核紀錄（Priority: P2）

身為具 `AuditEvent:read` 的後台使用者，我可以查詢 Assistant 的稽核紀錄與後台操作紀錄。

1. **Given** 具 `AuditEvent:read`，**when** `POST auditEvents/getTable`（Assistant 稽核），**then** 回傳：`id`、`timestamp`、`eventType`、`requestId`、`actorId`、`organizationId`、`hostApp`、`sessionId`、`messageId`、`decision`、`durationMs`。篩選：`eventType`、期間、`actorId`、`sessionId`、`requestId`。不回傳 `metadata` 原文（見「待確認」2）。
2. **Given** 同上，**when** `POST adminAuditEvents/getTable`（後台稽核），**then** 回傳 `UserAuditEvent`：時間、事件類型（附中文標籤）、執行者帳號、對象、IP 與 User-Agent 摘要、`metadata`；篩選：事件類型、期間、執行者。非開發工程師看到的開發工程師一律為「開發工程師」；對象為開發工程師的事件不回傳 `metadata`（其中含帳號、名稱、email）。
3. **Given** 同上，**when** `GET auditEvents/getFilters`、`GET adminAuditEvents/getFilters`，**then** 回傳可篩選的事件類型。
4. 沒有修改或刪除稽核的 API。

### User Story 6 — 移除 Core 舊的審核 API（Priority: P2）

1. **Given** Core（`src/main.ts`），**then** `/api/v1/admin/assistant/review-items` 路由不存在；`ReviewItemService` 只保留建立待審項目的方法，舊的列表、讀取、標記方法與對應測試一併移除；Assistant 建立待審項目的行為不變。

## Edge Cases

- 對話的訊息很多：`conversations/:id` 一次回傳全部訊息（Assistant 對話通常在數十則內），超過 500 則時只回傳最新 500 則並標示 `truncated: true`。
- `ReviewItem` 的來源可能已不存在（例如資料被手動清理）：列表照常顯示，詳情的 `conversation` 為 `null`。
- 舊資料：`integrationId` 為空的舊對話照常顯示。
- 時區切換日：以 PostgreSQL 的時區規則計算，不在程式內換算。

## Requirements

- **FR-001** 新增的後台路由皆以 decorator 宣告權限（014 FR-006），對應如下表。
- **FR-002** 所有查詢以 `ADMIN_CUSTOMER_ID` 過濾；對話詳情、回饋、待審項目的讀取若不屬於此客戶一律 404。
- **FR-003** 讀取對話內容一律檢查 `Conversation:read` 並寫入 `admin_conversation_viewed`；寫入失敗時不回傳內容（fail closed）。
- **FR-004** 統計以資料庫彙總（不把整段期間的資料讀進記憶體），期間上限 366 天。
- **FR-005** `ReviewItem` 新增 `updatedAt`、`note`（最後一次備註），migration 只新增欄位；處理紀錄（誰、何時、前後狀態、備註）以 `UserAuditEvent` 的 `admin_review_item_updated` 為準。
- **FR-006** 列表 API 的格式沿用 014（`getTable` 的 `page`／`pageSize`／`sort`／`filters`／`keyword`，回應 `{ items, total }`；批次全有或全無，錯誤以 `error.details.ids` 說明）。
- **FR-007** 新增環境變數 `ADMIN_TIME_ZONE`（IANA 時區名稱，預設 `Asia/Taipei`），啟動時驗證。

### API 一覽（前綴 `/api/v1/admin`）

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| POST | `conversations/getTable` | `Conversation:read` | 對話列表 |
| GET | `conversations/getFilters` | `Conversation:read` | 狀態、HostApp 選項 |
| GET | `conversations/:id` | `Conversation:read` | 對話內容（留稽核） |
| GET | `stats/getSummary` | `Stats:read` | 使用量與回答結果分布 |
| POST | `feedback/getTable` | `Feedback:read` | 回饋列表 |
| GET | `feedback/:id` | `Feedback:read` | 回饋詳情（有 `Conversation:read` 才含問答，留稽核） |
| POST | `reviewItems/getTable` | `ReviewItem:read` | 待審項目列表 |
| GET | `reviewItems/getFilters` | `ReviewItem:read` | 類型、狀態、優先度選項 |
| GET | `reviewItems/:id` | `ReviewItem:read` | 待審項目詳情與處理紀錄（有 `Conversation:read` 才含問答，留稽核） |
| PATCH | `reviewItems/batch` | `ReviewItem:update` | 批次更新狀態（`{ ids, status, note? }`） |
| POST | `auditEvents/getTable` | `AuditEvent:read` | Assistant 稽核 |
| GET | `auditEvents/getFilters` | `AuditEvent:read` | 事件類型 |
| POST | `adminAuditEvents/getTable` | `AuditEvent:read` | 後台稽核 |
| GET | `adminAuditEvents/getFilters` | `AuditEvent:read` | 事件類型 |

## Success Criteria

- **SC-001** 每支新 API 的允許／拒絕矩陣以 DB 測試覆蓋（內建群組、只有單一權限的自訂群組、沒有權限）。
- **SC-002** 沒有 `Conversation:read` 時，任何回應都不含訊息內容或對話標題（以測試掃描回應）。
- **SC-003** 每次回傳對話內容都有對應的 `admin_conversation_viewed`；稽核寫入失敗時不回傳內容。
- **SC-004** 其他客戶的資料不會出現在任何回應中（測試資料含兩個客戶）。
- **SC-005** 統計數字與以測試資料手算的結果一致，含跨時區日界與空白日期。
- **SC-006** 非開發工程師看不到開發工程師的帳號、名稱或 email（後台稽核、待審項目處理紀錄）。
- **SC-007** Core 不再有 `/api/v1/admin/assistant/review-items`；Core 與 Gateway 既有測試（扣除移除的審核 API 測試）全數通過；Assistant 建立待審項目的行為不變。

## Decisions（2026-11-19 審核決定）

1. **使用者已刪除的對話**：後台看得到並標示「使用者已刪除」；對話列表預設不含，以 `status` 篩選顯示。
2. **問答文字的權限**：一律需要 `Conversation:read`；只有 `Feedback:read`／`ReviewItem:read` 的人看不到問答文字。
3. **Core 舊的審核 API**：移除 `/api/v1/admin/assistant/review-items`，改由後台 API 提供。
4. **統計第一版**：使用量與回答結果分布；回饋比例、工具使用不在本版。
5. **路徑命名**：多字資源一律 camelCase（`reviewItems`、`auditEvents`、`adminAuditEvents`）。
6. **Assistant 稽核的 `metadata`**：第一版不回傳，只回傳 US5-1 列出的欄位。
7. **對話列表不寫稽核**：列表需要 `Conversation:read`（含標題）但不寫稽核；讀取對話內容（對話、回饋、待審項目詳情）才寫 `admin_conversation_viewed`。
8. **「有未答」的範圍**：`hasUnanswered` 只算 `no_answer`、`permission_denied`、`tool_failed`；`clarification_required` 不算。
9. **分支**：`015-admin-operations` 自 `014-admin-foundation` 分出，與 014 一起合併到 main。
