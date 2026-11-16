# Design: Feature 013 — Assistant Conversation Experience

**Canonical Feature Path**: `specs/013-assistant-conversation-experience`
**Design Date**: 2026-11-15
**Status**: 待人工確認
**Requirements**: `specs/013-assistant-conversation-experience/spec.md`
**Plan**: `specs/013-assistant-conversation-experience/plan.md`

## 0. Reuse Inventory

以 repo 現況為準，判斷每個既有元件在本 feature 的處置。沒有任何元件需要整個取代。

| 既有元件 | 處置 | 依據與變更範圍 |
| --- | --- | --- |
| `LlmToolSelectionService.resolveOffered()` | **EXTRACT** | 已完整實作 FR-001 的權限判斷但為 private；抽成 `AvailableCapabilityService`，原服務改為呼叫它，行為以等價測試鎖定。 |
| `LlmToolSelectionService.describeAvailable()` | **REMOVE**（無其他呼叫者時） | 能力總覽改由 `AvailableCapabilityService` 產生，不再依賴 LLM 開關。 |
| `LlmToolSelectionService` 選擇結構 | **EXTEND** | 新增 `capability_discovery` 決策值；不新增 LLM 呼叫。 |
| `classifyControlledConversation()` | **EXTEND** | 整句清單比對改為正規化 + 句型比對；保留資料字眼排除並擴充；函式簽章不變。 |
| `CapabilityCatalogRegistry` / `CapabilityResolutionService` | **REUSE_AS_IS** | 體驗設定 validator 用它驗證每則 `message` 的解析結果；不改解析規則。 |
| `ToolRegistryService`、`ToolPermissionPrecheckService` | **REUSE_AS_IS** | 由 `AvailableCapabilityService` 間接使用；執行時的權限檢查仍在原處，不因可見性判斷而略過。 |
| `AssistantSessionService` | **EXTEND** | `listVisibleSessions` 加分頁與排序；`closeVisibleSession` 對外開放為封存；新增標題設定。 |
| `AssistantController` / `SendAssistantMessageDto` | **EXTEND** | 新增列表、封存端點；`opening` 回應欄位；`quickReplyId`、`origin` 輸入。 |
| `AssistantMessageService.sendMessage` | **EXTEND** | 接入 Quick Reply 解析、延伸建議、未支援問題收集；既有流程與判斷順序不變。 |
| `assistant-sse-event.builder.ts` / `assistant-sse.types.ts` | **EXTEND** | `finalData` 新增選填 `suggestions`，空時省略。 |
| `ReviewItemService` | **EXTEND** | 新增 `createUnsupportedQuestion`；既有 `createFromAssistantOutcome` 不變。 |
| `AuditWriterService` | **REUSE_AS_IS** | 新增 eventType，不改 schema。 |
| `provision-customer-tool-policy.command.ts` 模式 | **REUSE_PATTERN** | 體驗設定 provisioning 比照其結構（command + script + `--check`）。 |
| Gateway `backend-route-definition.ts`、`gateway-assistant.controller.ts` | **EXTEND** | 白名單新增兩條路由；送訊息轉發 `quickReplyId`、`origin`。Gateway 只做格式驗證，不做可見性判斷。 |

### D1. AvailableCapabilityService（`src/capabilities/available-capability.service.ts`）

```ts
interface AvailableCapabilityV1 {
  capabilityKey: string;
  safeLabel: string;
  bindingId: string;
  allowedParameterValues: Record<string, readonly string[]>; // 來自該 binding 的 ENUM_VALUE_IN
}
listAvailable(host: HostIntegrationContext): Promise<readonly AvailableCapabilityV1[]>
isAvailable(host, capabilityKey, parameters?): Promise<boolean>
```

- 演算法逐行搬移自 `resolveOffered()`；`LlmToolSelectionService` 改用它。先以等價測試鎖定行為再搬移。
- `isAvailable(..., parameters)`：存在至少一個 binding 同時滿足權限與參數限制才為 true。

### D2. 資料模型（migration `20261115000000_feature013_assistant_experience`）

```prisma
enum AssistantExperienceConfigStatus { draft active retired }

model AssistantExperienceConfig {
  id            String   @id @default(cuid())
  customerId    String
  integrationId String
  configVersion String
  status        AssistantExperienceConfigStatus @default(draft)
  payload       Json
  checksum      String
  createdAt     DateTime @default(now())
  activatedAt   DateTime?
  customer      Customer @relation(fields: [customerId], references: [id], onDelete: Restrict)
  @@unique([customerId, integrationId, configVersion])
  @@index([customerId, integrationId, status])
}
// AssistantSession: title String?
// ReviewSourceType: + unsupported_question
```

- 「同一範圍最多一份 active」以 partial unique index 保證：`CREATE UNIQUE INDEX ... ON "AssistantExperienceConfig"("customerId","integrationId") WHERE status = 'active'`（寫在 migration SQL，Prisma schema 加註解說明）。
- `ALTER TYPE "ReviewSourceType" ADD VALUE 'unsupported_question'` 與使用它的程式不在同一個 transaction，PostgreSQL 16 可行。

### D3. 體驗設定（`src/assistant-experience/`）

| 檔案 | 責任 |
|---|---|
| `assistant-experience.types.ts` | payload v1 型別（spec Key Entities） |
| `assistant-experience.parser.ts` | 純函式 schema 驗證：欄位、長度、ID 唯一、`maxQuickReplies` 1–6、`kind` 規則；錯誤回傳路徑與代碼，不含內容 |
| `assistant-experience.validator.ts` | 與 active pack 交叉驗證：scope 一致、`capabilityKey` 存在、每則 `message` 經 `CapabilityResolutionService` 解析為宣告的 key 與參數 |
| `assistant-experience.repository.ts` | 讀 active、寫 draft、activate（同一 transaction 將舊 active 改 `retired`） |
| `assistant-experience.service.ts` | `buildOpening(host, pageContext)`、`resolveQuickReply(host, id)`、`buildFollowUps(host, resolvedCapability, parameters)`、`buildCapabilityQuickReplies(host)` |
| `provision-assistant-experience.command.ts` + `scripts/provision-assistant-experience.ts` | 讀 `customers/<c>/assistant-experience/<v>.json` → parse → validate → 寫入並 activate；`--check` 只驗證不寫入 |

- Core 預設問候語（無設定時）：通用文字，不含客戶詞彙。
- 讀取 active 設定在單一 request 內快取，不做跨 request 快取（換版立即生效，量體很小）。

### D4. 開場與 Quick Reply（US1）

- `AssistantSessionService.createSession` 回傳後，controller 呼叫 `buildOpening` 組 `opening`；`session_created` 審計的 metadata 加 `experienceConfigVersion`、`quickReplyIds`。
- `SendAssistantMessageDto`：`message` 改為選填，新增 `quickReplyId`（`@MaxLength(64)`，格式 `SAFE_IDENTIFIER`）與 `origin`；以自訂驗證保證 `message` 與 `quickReplyId` 恰好一個。
- `quickReplyId` 流程：`resolveQuickReply` → 不可見則丟出與 session not found 相同的 404 → 以設定中的 `message` 走既有 `sendMessage` → 寫 `quick_reply_selected`（`quickReplyId`、`configVersion`）。
- `kind: capability_overview` 的 Quick Reply 直接走 US2 的能力總覽回答。

### D5. 能力總覽三層（US2）

1. **規則層**：`classifyControlledConversation` 改為「正規化 → 句型比對」。正規化：去除句尾標點、「請問／想問／想知道／我想」前綴與「嗎／呢／啊」語尾、全半形與空白。句型：`(你|您)?(可以|能|能夠|會)?(幫我)?(查|查詢|看|做|回答)(什麼|哪些)(資料|東西|功能|事|問題)?` 及既有清單。保留資料字眼排除表（多少、幾筆、幾張、今天、昨天、本週、上週、本月、上月、比較…）並擴充。
2. **LLM 層**：`LlmToolSelectionService` 的選擇結構新增 `decision: "capability_discovery"`；僅在規則層與能力解析都未命中、且開關開啟時生效。不新增 LLM 呼叫。
3. **保底**：能力解析為 `CAPABILITY_NOT_RECOGNIZED` / `LLM_NO_MATCH` 的澄清回覆，`final.suggestions` 帶 `buildCapabilityQuickReplies(host)`。
- 回答內容：`AvailableCapabilityService.listAvailable` 的 `safeLabel` 清單；無可用能力時回固定說明。移除對 `describeAvailable()` 的依賴（`describeAvailable` 若無其他使用者則刪除）。

### D6. 延伸建議（US3）

- 成功回答（`answerDecision` 為 grounded 類且能力解析 `RESOLVED`）後，`buildFollowUps` 取設定中 `whenCapabilityKey` 相符、`whenParameters` 為目前參數子集的 `followUps`，排除與目前參數完全相同者，以 `isAvailable` 篩選，取前 3 個。
- `finalData` 新增選填 `suggestions`；builder 在空陣列時省略欄位。
- `origin.type === "suggestion"` 時寫 `suggestion_selected`（`suggestionId`），不影響處理流程。

### D7. Session 列表與封存（US4）

- `GET /assistant/sessions?limit&cursor`：exact scope + `status=active`；排序 `coalesce(lastMessageAt, createdAt) desc, id desc`；cursor 為 base64url 的 `{t, id}`，伺服器驗證格式；`limit` 預設 20、上限 50。
- 標題：在 `sendMessage` 寫入第一則 user message 的同一 transaction，以 `updateMany where title is null` 設定（避免併發覆寫）。
- `POST /assistant/sessions/:id/archive`：沿用 `closeVisibleSession`，寫 `session_archived`。

### D8. 未支援問題（US5）

- 在能力解析結果轉為澄清處，若 reasonCode 為 `CAPABILITY_NOT_RECOGNIZED` / `LLM_NO_MATCH` 且不是 controlled conversation，呼叫 `ReviewItemService` 新方法 `createUnsupportedQuestion`：`sourceId` = 使用者訊息 ID，`summary` 為固定文字，`suggestedImprovement` = `{ reasonCode, module }`。
- `clarification-required` 測試依決定更新預期為現行行為。

### D9. Gateway

- `backend-route-definition.ts` 新增 `list-sessions`（GET `/api/v1/assistant/sessions`）、`archive-session`（POST `/api/v1/assistant/sessions/:id/archive`）。
- `gateway-assistant.controller.ts` 新增對應 handler；`readSendMessageInput` 接受 `quickReplyId`、`origin` 並做與 Core 相同的格式驗證後轉發。
- Gateway 只做格式驗證與轉發，不做可見性判斷。
