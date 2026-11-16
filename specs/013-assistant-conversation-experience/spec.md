# Feature Specification: Feature 013 — Assistant Conversation Experience

**Canonical Feature Path**: `specs/013-assistant-conversation-experience`
**Feature Branch**: `013-assistant-conversation-experience`
**Created**: 2026-11-14
**Status**: Draft — 待人工審核；審核通過前不得實作
**Predecessor Baseline**: `main` @ `ceb6705`（Feature 012 與後續整理已合併）

## Problem Statement

Assistant 已能在驗證過的客戶範圍內解析能力、檢查權限、執行唯讀工具並以串流回答，但使用者體驗仍停在「空白對話框」：

- 開新 session 時沒有問候語，也沒有任何提示告訴使用者可以問什麼。
- 「你能查詢哪些資料？」已有規則式意圖（`capability_discovery`），但只認得固定的完整句子；回答沒有附上可點選的範例，沒有可用能力時的說明也不夠明確。（2026-11-16 更正：原稿寫「答案依賴 LLM 開關」有誤——`describeAvailable()` 雖位於 LLM 選工具服務內，但不呼叫 LLM、不檢查開關，且自 Phase 1 起已改用 `AvailableCapabilityService`。）
- 回答後沒有延伸建議，使用者要自己想下一個問題。
- `AssistantSessionService` 已有 `listVisibleSessions`、`closeVisibleSession`，但沒有對外 API、沒有標題，使用者無法回到舊對話。
- 只有 `no_answer` 會產生 `ReviewItem`；最有規劃價值的「Assistant 不支援的問題」（能力無法辨識而轉為澄清）目前沒有被收集。

Feature 013 補齊以上體驗，並維持既有的信任邊界：**所有提示、建議與能力清單都由伺服器依使用者的實際權限產生，前端與使用者輸入不能取得任何新權限。**

## Scope and Authority

- 已驗證的 `customerId` 仍是最外層隔離邊界；`integrationId`、`organizationId`、`hostApp`、`actorId` 限定 session 與歷史；`roles`、`permissionScopes` 是權限判斷輸入。
- 「使用者能用哪些能力」只有一個來源：Capability Pack 的 active capability → active binding → `ToolDefinition`（active）→ `CustomerToolPolicy`（enabled）→ `requiredPermissions` / `requiredPermissionScopes` / `requiredRoles`。Quick Reply、延伸建議、能力總覽都使用同一個判斷，不另外宣告權限。
- 客戶文案（問候語、Quick Reply、延伸建議）屬客戶資料：原始檔放在 `customers/<customer>/assistant-experience/`，經 provisioning 驗證後寫入資料庫的版本表。Core 只保留不含客戶詞彙的預設問候語。
- 點擊 Quick Reply 或延伸建議時，前端只送 `choiceId`；伺服器從 active 設定取出該選項**預先宣告的能力與參數**，直接交給 binding 解析（不做語意比對），之後的工具政策、權限、證據與審計與手打問題完全相同。選項文字（`message`）只作為對話紀錄中的使用者訊息。見 Decision 4。
- 公開 API 只做**新增**：既有端點、SSE 事件名稱與 `final` 欄位不變，舊版 SDK 不受影響。
- 不在本 feature 範圍：管理後台（admin-api）、使用者對話刪除與保存期限政策、多語系、主動推送、寫入類工具。

## User Scenarios & Testing

### User Story 0 — 開發基線整理（Priority: P0，其他 story 的前置）

身為開發者，我需要移除會擋住正常開發的凍結檢查，並讓 `specs/` 的狀態一目了然。

**Why this priority**: `test/contract/feature010-scope-boundary.contract.spec.ts` 凍結了 controller、DTO、SSE 型別、Prisma schema、全部 migration、`package.json`、`AGENTS.md` 的 hash，以及「controller 只有 4 個路由」與 `.specify/feature.json` 必須指向 010。本 feature 的每個 story 都會觸發它。

**Independent Test**: 保留的安全檢查仍會在違規時失敗；修改 controller、DTO、schema 或新增 migration 不再造成失敗。

**Acceptance Scenarios**:

1. **Given** 新增一支 migration，**when** 執行測試，**then** 不因 hash 失敗；**但** 修改或刪除既有 migration 檔時，測試失敗（migration 只能新增）。
2. **Given** repo 被加入 `.pem` / `.key`、submodule 或第二個 worktree，**when** 執行測試，**then** 失敗。
3. **Given** 開啟 `specs/README.md`，**then** 可看到 001–013 各自的狀態與合併日期。

### User Story 1 — 開場語與依權限的 Quick Reply（Priority: P1）

身為內部使用者，打開 Assistant 時我想看到問候語與幾個「我現在就能問」的問題，點一下就能得到答案。

**Why this priority**: 降低第一次使用的門檻，也是所有後續體驗功能（建議、能力總覽）共用的設定與權限基礎。

**Independent Test**: 兩個權限不同的使用者在同一客戶下建立 session，各自只看到自己有權執行的 Quick Reply；點擊後執行設定宣告的能力與參數，工具呼叫、權限檢查、證據與審計與一般問題相同；無論 LLM 工具選擇是否開啟，結果都一致。

**Acceptance Scenarios**:

1. **Given** 該 integration 有 active 的體驗設定，**when** 建立 session，**then** 回應包含 `opening.greeting` 與最多 `maxQuickReplies` 個 Quick Reply（依 `priority` 排序），以及 `opening.configVersion`。
2. **Given** 某 Quick Reply 對應的能力，使用者缺少任一必要權限、或 binding / tool / policy 未啟用，**when** 建立 session，**then** 該 Quick Reply 不出現。
3. **Given** Quick Reply 設定了 `pageScope.modules`，**when** 建立 session 時的 `pageContext.module` 不在其中，**then** 該 Quick Reply 不出現；未設定 `pageScope` 的 Quick Reply 不受頁面限制。
4. **Given** 送出 `{ choiceId }`（某個 Quick Reply 的 ID），**when** 伺服器處理，**then** 由 active 設定取出該選項，重新檢查可見性，以設定的 `message` 作為使用者訊息，以宣告的 `capabilityKey` 與參數直接解析 binding 並執行，寫入 `quick_reply_selected` 審計事件。`kind: capability_overview` 的選項直接回答能力總覽。
5. **Given** `choiceId` 不存在、已不在 active 設定、或使用者已無權限，**when** 送出，**then** 回傳與「session 不存在」同等級的通用錯誤，不透露設定內容。
6. **Given** 沒有任何 active 設定，**when** 建立 session，**then** 回傳 Core 預設問候語、Quick Reply 為空陣列，建立 session 不失敗。
7. **Given** 舊版前端不讀 `opening`，**when** 建立 session，**then** 既有欄位 `sessionId`、`status` 不變。

### User Story 2 — 能力總覽「你能查詢哪些資料？」（Priority: P1）

身為內部使用者，我想問 Assistant 能做什麼，並得到只包含我能用的功能的清單。

**Why this priority**: 這是 Quick Reply 最常見的入口；目前在 LLM 開關關閉時無法運作。

**Independent Test**: LLM 工具選擇開關為 `true` 或 `false` 時，能力總覽內容相同；權限不同的使用者得到不同清單；完全沒有可用能力時回明確訊息。

**Acceptance Scenarios**:

1. **Given** 使用者觸發既有的 `capability_discovery` 意圖或點擊 `kind: capability_overview` 的 Quick Reply，**when** 回答，**then** 內容只列出 US1 同一判斷下可用的能力（沿用既有 `describeAvailable()` 的格式：能力名稱、可查欄位、可用期間與範例問句），且 `final` 附上 `suggestions`：取使用者目前可見的 `kind: capability` Quick Reply（不受 `pageScope` 限制，最多 `maxQuickReplies` 個），讓使用者直接點選範例問題。
2. **Given** LLM 工具選擇開關為 `false`，**then** 結果與開關為 `true` 時相同（既有行為，以回歸測試鎖定）。
3. **Given** 使用者沒有任何可用能力，**then** 回覆說明目前沒有可用的查詢功能，並建議向系統管理者申請權限；不列出任何能力名稱。
4. 回答的 `answerDecision` 維持現有 controlled conversation 的決策類型，不產生工具呼叫或 evidence。
5. **規則層（句型比對）**：**Given** 「請問你可以幫我查哪些東西？」「您能看什麼資料呢」等措辭不同但意思相同的問題，**when** 判斷意圖，**then** 先去除「請問」「想問」「嗎」「呢」等贅字，再以句型（主詞／能力動詞／疑問詞的組合）比對，判定為 `capability_discovery`。句型屬通用產品用語，留在 Core，不放客戶設定。
6. **反向保護**：**Given** 問題含查詢資料的字眼（例如「多少」「幾張」「今天」「本週」「本月」「比較」），如「我可以查本月工單嗎？」，**then** 不得判定為 `capability_discovery`，照一般能力解析流程處理。
7. **LLM 層**：**Given** LLM 工具選擇開啟，且規則層與能力解析都未命中，**when** 既有的 LLM 選擇呼叫回傳「使用者在詢問可用功能」，**then** 以能力總覽回答；不新增額外的 LLM 呼叫。LLM 只判斷意圖，清單內容仍來自 FR-001。
8. **保底**：**Given** 能力解析結果為 `CAPABILITY_NOT_RECOGNIZED` 或 `LLM_NO_MATCH`，**when** 回覆澄清，**then** `final` 附上使用者目前可見的 `kind: capability` Quick Reply 作為 `suggestions`（無可用能力時省略）。

### User Story 3 — 回答後的延伸建議（Priority: P2）

身為內部使用者，拿到一個數字後，我想直接點「那本週呢？」而不是重新打字。

**Why this priority**: 提高連續使用率，但依賴 US1 的設定與權限基礎。

**Independent Test**: 回答「今日新增工單」後，`final` 事件帶出本週、本月的建議；使用者沒有本月權限時只出現本週；點擊後執行設定宣告的能力與參數。

**Acceptance Scenarios**:

1. **Given** 一次 `RESOLVED` 且成功回答的能力查詢，**when** 送出 `final`，**then** 可附加最多 3 個 `suggestions`（`id`、`label`、`message`），來源是體驗設定中符合該 `capabilityKey` 與參數條件的 `followUps`。
2. **Given** 建議對應的能力或參數組合使用者無權執行，**then** 不出現。
3. **Given** `no_answer`、`permission_denied`、`tool_failed`、澄清或需要確認／核准的回答，**then** 不附建議。例外：能力總覽（US2 情境 1）與能力無法辨識的澄清回覆（US2 情境 8）會附上 Quick Reply 作為建議。
4. **Given** 使用者點擊建議，**when** 前端送出 `{ choiceId }`（該建議的 ID），**then** 與 US1 情境 4 相同：重新檢查可見性，以宣告的能力與參數執行，寫入 `suggestion_selected` 審計事件。
5. 舊版前端忽略 `suggestions` 時行為不變。

### User Story 4 — Session 歷史列表與封存（Priority: P2）

身為內部使用者，我想回到之前的對話，並收起不需要的對話。

**Why this priority**: 前端已能讀單一 session 的訊息歷史，缺的是列表入口。

**Independent Test**: 使用者只能列出自己（同 customer、integration、organization、hostApp、actor）的 active session，依最後訊息時間排序並可分頁；封存後不再出現在列表，也不能再送訊息。

**Acceptance Scenarios**:

1. **Given** 使用者有多個 session，**when** 呼叫 `GET /assistant/sessions?limit&cursor`，**then** 回傳自己的 active session（`sessionId`、`title`、`createdAt`、`lastMessageAt`），依 `lastMessageAt`（無則 `createdAt`）由新到舊，cursor 分頁，`limit` 上限 50。
2. **Given** session 的第一則使用者訊息，**when** 寫入，**then** 以該訊息去除空白後的前 40 個字元設定 `title`（不使用 LLM）；尚未有訊息的 session `title` 為 `null`。
3. **Given** 另一位使用者或另一客戶的 session，**then** 不出現在列表；以其 ID 封存時回傳 not found。
4. **Given** 呼叫 `POST /assistant/sessions/:id/archive`，**then** session 狀態改為 `closed`，寫入 `session_archived` 審計事件；之後對它送訊息回 not found。
5. 列表查詢不寫審計事件（避免每次開啟側欄都產生大量紀錄）。

### User Story 5 — 未支援問題收集（Priority: P2）

身為產品維護者，我想知道使用者問了哪些 Assistant 目前不支援的問題，作為下一批工具的需求來源。

**Why this priority**: `no_answer` 已會建立 `ReviewItem`，但能力無法辨識的問題會轉為澄清，目前沒有任何紀錄。

**Independent Test**: 能力解析結果為 `CAPABILITY_NOT_RECOGNIZED` 或 `LLM_NO_MATCH` 時建立 `sourceType: unsupported_question` 的 `ReviewItem`；可用既有 review-items API 依 `sourceType` 篩選。

**Acceptance Scenarios**:

1. **Given** 能力解析為 `CAPABILITY_NOT_RECOGNIZED` 或 `LLM_NO_MATCH`，**when** Assistant 回覆澄清，**then** 建立一筆 `ReviewItem`（`sourceType: unsupported_question`，`sourceId` 為使用者訊息 ID）。
2. `ReviewItem` 不複製使用者原文；原文只存在 `AssistantMessage`，透過 `sourceId` 關聯（沿用既有的資料最小化原則）。`suggestedImprovement` 只記錄解析原因與 `pageContext.module`。
3. 打招呼、`assistant_help`、`capability_discovery` 等 controlled conversation 不建立 `ReviewItem`。
4. 參數缺漏（`PARAMETER_ISSUES`）與多能力模糊（`MULTIPLE_CAPABILITIES`）屬於可澄清的支援問題，不建立 `unsupported_question`。

### Edge Cases

- 體驗設定引用的 `capabilityKey` 不存在於同一 integration 的 active pack → provisioning 驗證失敗，不寫入。
- 設定中某選項宣告的能力與參數無法解析到 active binding（例如 binding 已停用或缺必要參數）→ provisioning 驗證失敗。
- 設定在 session 建立後被換版 → 點擊舊版才有的 `choiceId` 回通用錯誤；前端應重新建立 session 或忽略。
- Capability Pack 換版導致能力停用 → 下次建立 session 時自動不再出現，不需改體驗設定。
- 同一 integration 同時只能有一份 active 設定；啟用新版本時舊版本改為 `retired`，在同一 transaction 內完成。
- session 標題含有使用者輸入的敏感資料：標題與訊息內容同等級，只回傳給該 session 的擁有者。

## Requirements

### Functional Requirements

- **FR-001**: 系統 MUST 提供單一「可用能力」判斷服務，輸入已驗證的 host context，輸出使用者可執行的 capability（含可用的 enum 參數值）；US1、US2、US3 皆使用此服務。
- **FR-002**: 系統 MUST 以 `AssistantExperienceConfig` 儲存每個 `customerId` + `integrationId` 的體驗設定版本，狀態為 `draft` / `active` / `retired`，同一範圍最多一份 `active`。
- **FR-003**: 系統 MUST 提供 provisioning 指令，從 `customers/<customer>/assistant-experience/<version>.json` 讀取設定，驗證 schema、`customerId` / `integrationId` / `hostApps` 與 active pack 一致、每個選項宣告的能力與參數都能解析到 active binding（Decision 4；`message` 僅為顯示文字），語意審核狀態須為 `HUMAN_VERIFIED`（開發與測試可用 `--allow-unverified`），通過後寫入並啟用；驗證失敗不得寫入任何資料。
- **FR-004**: `POST /assistant/sessions` 回應 MUST 新增 `opening: { configVersion: string | null, greeting: string, quickReplies: { id, label }[] }`。
- **FR-005**: `POST /assistant/sessions/:id/messages` MUST 接受 `choiceId`（與 `message` 二擇一），指向 active 設定中的 Quick Reply 或延伸建議（兩者 ID 在同一份設定內唯一）；伺服器以該選項宣告的能力與參數執行（Decision 4）。
- **FR-006**: `capability_discovery` 的回答 MUST 使用 FR-001 的可用能力（既有 `describeAvailable()` 已符合），且不依賴 LLM 工具選擇開關；意圖判斷 MUST 依序使用規則層句型比對、LLM 層（僅在開關開啟時，併入既有呼叫）與保底建議（US2 情境 5–8）。
- **FR-007**: SSE `final` 事件的資料 MUST 可選擇性新增 `suggestions: { id, label, message }[]`；未產生建議時省略此欄位。
- **FR-008**: 系統 MUST 新增 `GET /assistant/sessions` 與 `POST /assistant/sessions/:id/archive`，範圍限定與既有 session 端點相同。
- **FR-009**: `AssistantSession` MUST 新增可為 null 的 `title` 欄位；migration 只能新增，不回填既有資料。
- **FR-010**: `ReviewSourceType` MUST 新增 `unsupported_question`，並依 US5 建立紀錄。
- **FR-011**: 系統 MUST 寫入審計事件：`session_created` metadata 加入 `experienceConfigVersion` 與顯示的 `quickReplyIds`；新增 `quick_reply_selected`、`suggestion_selected`、`session_archived`。
- **FR-012**: Core 程式與 Core 測試 MUST NOT 含客戶名稱、客戶詞彙或客戶範例問句；Shinmone 設定與測試放在 `customers/shinmone/`。

### Key Entities

- **AssistantExperienceConfig**（新增）：`id`、`customerId`、`integrationId`、`configVersion`、`status`（draft / active / retired）、`payload`（JSON，已驗證）、`checksum`、`createdAt`、`activatedAt`。唯一鍵 `(customerId, integrationId, configVersion)`。
- **體驗設定 payload v1**：`locale`、`greeting.text`、`maxQuickReplies`（1–6）、`quickReplies[]`（`id`、`label`、`kind: "capability" | "capability_overview"`、`message`、`capabilityKey`、`parameters?`、`pageScope?.modules[]`、`priority`）、`followUps[]`（`id`、`whenCapabilityKey`、`whenParameters?`、`label`、`message`、`capabilityKey`、`parameters?`）。`capability_overview` 類型不需要 `capabilityKey`，只要使用者至少有一項可用能力就顯示。
- **AssistantSession**（修改）：新增 `title String?`。
- **ReviewSourceType**（修改）：新增 `unsupported_question`。
- **AuditEvent**（不改 schema）：新增上述 eventType。

## Success Criteria

- **SC-001**: 權限不同的兩位使用者，看到的 Quick Reply、能力總覽與延伸建議，與各自實際能執行的能力完全一致（以 integration 測試驗證，含「點擊後真的能執行」與「看不到的確實不能執行」兩個方向）。
- **SC-002**: `ASSISTANT_LLM_TOOL_SELECTION_ENABLED` 為 `true` 或 `false` 時，US1、US3 的輸出與能力總覽的清單內容相同；LLM 層只會讓更多問法被辨識為能力總覽，不改變清單內容。
- **SC-006**: 含查詢資料字眼的問題被誤判為能力總覽的次數為 0（以正反兩組問句測試驗證）。
- **SC-003**: 舊版公開 contract 測試（session、message SSE、history）全部維持通過，未修改其預期值。
- **SC-004**: 跨客戶隔離測試涵蓋 session 列表、封存、Quick Reply 點擊與 `ReviewItem`。
- **SC-005**: Core 全套測試與 `customers/shinmone` 測試通過；`npx tsc --noEmit -p tsconfig.spec.json` 通過。

## Assumptions

- 本 feature 只修改通用 Core；客戶之間的差異全部透過體驗設定資料表達。Shinmone 只提供設定檔（`customers/shinmone/assistant-experience/`）與客戶測試，不含任何 Shinmone 專屬程式邏輯。
- Quick Reply 只出現在建立 session 的開場；每則成功回答之後出現的是「延伸建議」（US3），兩者回傳格式相同（`id`、`label`），前端可用同一種按鈕元件呈現。

- 前端 SDK（`internal-ai-assistant` repo）的畫面另外開發；本 feature 只交付後端 API 與 contract。
- 體驗設定由 provisioning 指令寫入；後台編輯介面屬未來的 admin-api 範圍，會沿用同一張版本表與驗證器。
- Shinmone 的正式文案（問候語、Quick Reply、延伸建議）需人工確認後才可標為 `HUMAN_VERIFIED` 並 provision 到正式環境；開發期間使用測試 fixture。
- `capability_discovery` 的規則式判斷（`classifyControlledConversation`）維持現狀，本 feature 只改它的回答來源。

## Decisions（2026-11-15 審核決定）

1. `clarification-required`：接受現行行為（`CAPABILITY_NOT_RECOGNIZED`、無候選），更新測試預期；「列出候選讓使用者選」待 US3 穩定後另案評估。
2. 未支援問題：每次都建立 `ReviewItem`，不去重；分組留給後台。
3. Session 標題：固定取第一則問題前 40 字，本 feature 不提供改名 API。

4. **Quick Reply 與延伸建議以伺服器端預先宣告的能力執行**（2026-11-16）：Shinmone 正式 pack 的確定性語意幾乎無法辨識任何問法（連 pack 自身範例皆為 `CAPABILITY_NOT_RECOGNIZED`），測試機目前依賴 LLM 工具選擇。若按鈕文字仍走語意解析，結果會隨 LLM 而變。改為：選項宣告的 `capabilityKey` 與參數屬於經人工確認、provisioning 時已驗證可解析到 active binding 的伺服器端設定；前端只能送 ID。這是 Feature 011「pack 語意解析為唯一工具語意來源」之外新增的第二個入口，僅限此類設定，其餘授權、政策與證據判斷不變。改善 Shinmone pack 語意另列為客戶待辦。

## Open Questions（原始提問，已於上方決定）

1. **澄清時是否列出候選（`clarification-required` 測試）**：目前模糊問題回 `CAPABILITY_NOT_RECOGNIZED` 且候選為空，舊測試預期 `multiple_candidates` / `tool_ambiguity` 並附候選。選項：(a) 本 feature 恢復「列出候選讓使用者選」，候選以 Quick Reply 形式回傳；(b) 接受現行行為，更新測試預期；(c) 留到下一個 feature。建議 (b)，並在 US3 的延伸建議穩定後再評估 (a)。
2. **未支援問題的去重**：同一使用者重複問同一問題，是否每次都建立 `ReviewItem`？建議先每次建立（數量本身就是需求訊號），之後由後台依訊息內容分組。
3. **Session 標題長度**：建議 40 個字元；是否需要讓使用者改名（需再加一支 API）？建議本 feature 不做。
