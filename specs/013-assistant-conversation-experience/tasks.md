# Tasks: Feature 013 — Assistant Conversation Experience

**Input**: 已核准的 `spec.md`（2026-11-15）、`design.md` 與 `plan.md`
**Status**: 尚未開始；第一個未執行的 task 為 T001

## 格式、相依與停止規則

- 格式 `- [ ] TNNN [USn] 說明`。`[US0]`–`[US5]` 對應 spec 的 user story；共用基礎與 Gate 不加標籤。
- 依 Phase 0 → 7 執行。每個 Phase 內先記錄真實的 RED，再做最小 GREEN 實作；原本就正確的行為記為 `EXISTING_GREEN`，不刻意弄壞來製造 RED。Gate 失敗時，該 Gate 與之後所有 task 保持未勾選。
- **STOP 並尋求人工審查**：需要 design D2 以外的 schema 變更；需要修改既有公開 contract 測試的預期值；需要在 Core 加入客戶分支或客戶詞彙；需要新增 LLM 呼叫；需要改變能力解析、工具權限或 evidence 的判斷規則。
- Git：Claude 只在每個 Gate 通過後 stage 該 Phase 的檔案並提供 commit message；commit、push 與 branch 管理由使用者執行。
- 驗證指令：`npx tsc --noEmit -p tsconfig.spec.json`、`npx jest --config jest.config.ts <paths>`；全套測試需本機測試資料庫，由使用者執行並以 `--json --outputFile=.local-state/jest-results.json` 回傳結果。
- **Baseline**：`main` @ `ceb6705` 全套結果為 2 個 suite、4 個 test 失敗：`clarification-required`（2，由 T049 處理）與 `feature010-scope-boundary`（2 個 hash，由 Phase 0 處理）。

## Phase 0 — 開發基線整理（US0）

**Goal**：移除凍結整檔 hash 的檢查，保留真正的安全邊界；建立 specs 索引。

- [ ] T001 [US0] 在新檔 `test/architecture/repository-safety.guard.spec.ts` 寫入保留的檢查並確認 GREEN：tracked 檔案不含 `.pem` / `.key`；無 `.gitmodules`、無 submodule；只有一個 worktree；tracked 檔案不含 `frontend|f2e|widget|assistant-sdk` 目錄。
- [ ] T002 [US0] 在同檔新增 migration 只能新增的檢查：以 `test/fixtures/migration-ledger.json` 記錄既有每支 migration 目錄名稱與 `migration.sql` 的 sha256；既有項目內容不得改變或消失，新目錄允許出現（需同時更新 ledger）。先以竄改暫存副本的方式證明檢查會失敗（RED 證據），再確認現況 GREEN。
- [ ] T003 [US0] 刪除 `test/contract/feature010-scope-boundary.contract.spec.ts`；確認其仍有價值的檢查已由 T001–T002 或既有 contract 測試（`assistant-sessions`、`assistant-messages-sse`、`assistant-message-history`、`feature010-public-compatibility`）涵蓋，將對照表記錄在本檔 Phase 0 證據段。
- [ ] T004 [US0] 將 `.specify/feature.json` 改為指向 `specs/013-assistant-conversation-experience`；確認沒有其他測試依賴舊值。
- [ ] T005 [US0] 新增 `specs/README.md`：001–012 的名稱、狀態（已完成）、合併進 main 的日期；013 狀態為「進行中」；說明 spec 合併後凍結、現況文件在 `docs/`。日期以 `git log` 查證，不得推測。
- [ ] T006 **Gate 0**：typecheck 通過；T001–T002 focused 通過；使用者執行全套，結果只剩 baseline 中的 `clarification-required` 失敗。記錄 `FEATURE013_GATE_0=PASS`。

## Phase 1 — 共用基礎

**Goal**：可用能力單一來源、資料表、體驗設定模組與 provisioning。

- [ ] T007 新增 `test/unit/available-capability.service.spec.ts`：以合成 pack 與 tool policy fixture 覆蓋 active/inactive binding、inactive capability、tool 未啟用、policy 未啟用、缺 role、缺 scope、result policy 拒絕、permission mask 缺 scope、參數 `ENUM_VALUE_IN` 限制。RED：服務尚不存在。
- [ ] T008 新增等價測試 `test/unit/available-capability-llm-equivalence.spec.ts`：同一組輸入下，`LlmToolSelectionService` 現有 offered 清單與新服務輸出的 `(capabilityKey, bindingId)` 集合相同。先對現有實作取得 EXISTING_GREEN 基準。
- [ ] T009 實作 `src/capabilities/available-capability.service.ts`（design D1），註冊於 `CapabilitiesModule`；`LlmToolSelectionService.resolveOffered` 改為使用新服務。T007、T008 與既有 `llm-tool-selection.service.spec.ts` 全部 GREEN。
- [ ] T010 修改 `prisma/schema.prisma`（design D2）並新增 migration `20261115000000_feature013_assistant_experience`，含 partial unique index；`npm run prisma:generate`；更新 `test/fixtures/migration-ledger.json`。
- [ ] T011 新增 `test/integration/assistant-experience-config.persistence.spec.ts`：同範圍第二筆 active 被拒、不同 integration 各自 active、`title` 可為 null、`unsupported_question` 可寫入。
- [ ] T012 新增 `test/unit/assistant-experience.parser.spec.ts`：合法 payload、缺欄位、ID 重複、`maxQuickReplies` 越界、`capability_overview` 帶 `capabilityKey`、`capability` 缺 `capabilityKey`、超長文字；錯誤只含路徑與代碼。RED 後實作 `assistant-experience.types.ts`、`assistant-experience.parser.ts`。
- [ ] T013 新增 `test/unit/assistant-experience.validator.spec.ts`：scope 不符、`capabilityKey` 不在 active pack、`message` 解析成別的能力或參數、全部正確。RED 後實作 `assistant-experience.validator.ts`（使用 `CapabilityResolutionService`，不呼叫 LLM）。
- [ ] T014 新增 `test/integration/assistant-experience.repository.spec.ts`：activate 新版本時舊版改 `retired` 且在同一 transaction；驗證失敗不留下任何資料列。RED 後實作 `assistant-experience.repository.ts`。
- [ ] T015 新增 `test/unit/provision-assistant-experience.spec.ts`：`--check` 不寫入、正常寫入並啟用、同版本同 checksum 重跑略過、同版本不同 checksum 拒絕。RED 後實作 `src/assistant-experience/provision-assistant-experience.command.ts` 與 `scripts/provision-assistant-experience.ts`，於 `package.json` 新增 `assistant-experience:provision` script。
- [ ] T016 新增合成 fixture `test/fixtures/assistant-experience/customer-a.v1.json`（對應既有合成 pack），供 Core 測試使用；Core 測試不得引用 `customers/`。
- [ ] T017 新增 `customers/shinmone/assistant-experience/1.0.0.json`（問候語、Quick Reply、followUps 對應 `shinmone.dashboard.kpistats.snapshot` 的 today / this_week / this_month），所有文案標記 `NEEDS_HUMAN_REVIEW`，並在 `customers/shinmone/docs/` 新增審核問題清單；新增 `customers/shinmone/test/contract/shinmone-assistant-experience.contract.spec.ts` 以 validator 驗證此檔對應 production pack。
- [ ] T018 **Gate 1**：typecheck、T007–T017 focused 通過；`llm-tool-selection` 相關既有測試未修改預期且通過。記錄 `FEATURE013_GATE_1=PASS`。

## Phase 2 — 開場語與 Quick Reply（US1）

- [ ] T019 [US1] 新增 `test/unit/assistant-experience.service.spec.ts`（`buildOpening`、`resolveQuickReply`）：權限篩選、`pageScope` 篩選、`priority` 排序、`maxQuickReplies` 截斷、`capability_overview` 只在至少一項可用能力時出現、無設定時回預設問候語。RED 後實作 `assistant-experience.service.ts` 對應方法。
- [ ] T020 [US1] 擴充 `test/contract/assistant-sessions.contract.spec.ts`：回應新增 `opening`，既有欄位與既有斷言不變。RED 後在 `AssistantController.createSession` 組裝 `opening`，`session_created` 審計 metadata 加 `experienceConfigVersion`、`quickReplyIds`。
- [ ] T021 [US1] 新增 `test/unit/send-message-dto.spec.ts`：`message` 與 `quickReplyId` 恰好一個、`quickReplyId` 格式、`origin` 格式。RED 後修改 `SendAssistantMessageDto`。
- [ ] T022 [US1] 新增 `test/integration/quick-reply-selection.spec.ts`：點擊可見 Quick Reply 與手打相同訊息得到相同能力解析、ToolCall、answerDecision；寫入 `quick_reply_selected`；不存在／已換版／無權限的 ID 回與 session not found 相同的 404，且不寫 user message。RED 後在 `AssistantMessageService` 接入 `resolveQuickReply`。
- [ ] T023 [US1] 擴充 `test/integration/customer-session-isolation.spec.ts`：A 客戶的 `quickReplyId` 在 B 客戶 session 不可用，`opening` 不含 B 的設定。
- [ ] T024 [US1] Gateway：擴充 `apps/gateway/test` 對應測試，`readSendMessageInput` 接受並轉發 `quickReplyId`、`origin`，拒絕格式錯誤；`POST sessions` 回應原樣轉發 `opening`。RED 後修改 `gateway-assistant.controller.ts` 與 trust chain handler 的 message 型別。
- [ ] T025 [US1] **Gate 2**：typecheck（Core + Gateway）、US1 focused 測試、既有 `assistant-sessions` / `assistant-messages-sse` / `gateway-internal-identity` contract 通過且預期值未改。記錄 `FEATURE013_GATE_2=PASS`。

## Phase 3 — 能力總覽（US2）

- [ ] T026 [US2] 新增 `test/unit/controlled-conversation-classifier.spec.ts`：正向問句表（至少 20 句不同措辭，含既有清單）與反向問句表（至少 20 句含資料字眼，如「我可以查本月工單嗎」）。RED 後將 `classifyControlledConversation` 改為正規化 + 句型比對（design D5-1），保留函式簽章。
- [ ] T027 [US2] 擴充 `test/unit/controlled-conversation.spec.ts` 或新增 `test/integration/capability-overview.spec.ts`：開關 `true` / `false` 輸出相同清單；權限不同的兩位使用者清單不同；無可用能力時回固定說明且不列任何能力；`final.suggestions` 為可見的能力類 Quick Reply；不產生 ToolCall / evidence。RED 後改用 `AvailableCapabilityService` 產生回答。
- [ ] T028 [US2] 擴充 `test/unit/llm-tool-selection.service.spec.ts`：模型回 `capability_discovery` 時解析為能力總覽；開關關閉時不呼叫模型；模型回非法值時照原本失敗路徑。RED 後擴充選擇結構（不新增呼叫）。
- [ ] T029 [US2] 新增 `test/integration/unrecognized-capability-suggestions.spec.ts`：`CAPABILITY_NOT_RECOGNIZED` / `LLM_NO_MATCH` 的澄清 `final` 附 `suggestions`；無可用能力時省略。RED 後實作保底（design D5-3）。
- [ ] T030 [US2] 移除 `describeAvailable()`（若已無呼叫者）與對應測試；`kind: capability_overview` 的 Quick Reply 點擊走能力總覽，補一個 integration 案例於 `quick-reply-selection.spec.ts`。
- [ ] T031 [US2] **Gate 3**：typecheck、US2 focused、SC-006 反向問句表 0 誤判、既有 `controlled-conversation` 與 `query-understanding` 測試通過。記錄 `FEATURE013_GATE_3=PASS`。

## Phase 4 — 延伸建議（US3）

- [ ] T032 [US3] 擴充 `assistant-experience.service.spec.ts`（`buildFollowUps`）：條件比對、排除與目前參數相同者、權限與參數可用性篩選、上限 3。RED 後實作。
- [ ] T033 [US3] 擴充 `test/unit/assistant-sse-event-builder.spec.ts`：`suggestions` 有值時出現、空陣列時省略欄位、其他 `final` 欄位不變。RED 後修改 `assistant-sse.types.ts` 與 builder。
- [ ] T034 [US3] 新增 `test/integration/follow-up-suggestions.spec.ts`：成功回答附建議；無權限的建議不出現；`no_answer`、`permission_denied`、`tool_failed`、一般澄清、確認／核准回答不附建議；`origin: suggestion` 寫入 `suggestion_selected` 且處理結果與手打相同。RED 後在 `AssistantMessageService` 接入。
- [ ] T035 [US3] 擴充 `test/contract/feature012-public-compatibility.contract.spec.ts`：未設定 followUps 時 `final` 形狀與現行完全相同。
- [ ] T036 [US3] **Gate 4**：typecheck、US3 focused、`feature012-*` 與 `assistant-messages-sse` contract 通過。記錄 `FEATURE013_GATE_4=PASS`。

## Phase 5 — Session 列表與封存（US4）

- [ ] T037 [US4] 新增 `test/unit/session-cursor.spec.ts`：cursor 編解碼、竄改或格式錯誤回 400、`limit` 預設 20 與上限 50。RED 後實作 cursor 工具。
- [ ] T038 [US4] 新增 `test/integration/session-list.spec.ts`：只列自己 exact scope 的 active session；排序 `coalesce(lastMessageAt, createdAt) desc, id desc`；分頁不重複不遺漏；`closed` 不出現；不寫審計。RED 後新增 `GET /assistant/sessions` 與 service 方法。
- [ ] T039 [US4] 擴充 `session-list.spec.ts`：第一則 user message 設定 `title`（去除空白後前 40 字）、第二則不覆寫、併發兩則只設定一次。RED 後在 `sendMessage` 的 user message transaction 內實作。
- [ ] T040 [US4] 新增 `test/integration/session-archive.spec.ts`：封存後狀態 `closed`、寫 `session_archived`、之後送訊息與讀取回 404；他人或他客戶 session 回 404。RED 後新增 `POST /assistant/sessions/:id/archive`。
- [ ] T041 [US4] 新增 `test/contract/assistant-session-list.contract.spec.ts`：列表與封存的回應形狀與錯誤格式。
- [ ] T042 [US4] 擴充 `test/integration/customer-session-isolation.spec.ts`：跨客戶列表與封存隔離。
- [ ] T043 [US4] Gateway：`backend-route-definition.ts` 新增 `list-sessions`、`archive-session`；`gateway-assistant.controller.ts` 新增 handler；擴充 Gateway 測試（含白名單仍拒絕未定義路由）。
- [ ] T044 [US4] **Gate 5**：typecheck（Core + Gateway）、US4 focused、`assistant-sessions` / `assistant-message-history` contract 通過。記錄 `FEATURE013_GATE_5=PASS`。

## Phase 6 — 未支援問題收集（US5）

- [ ] T045 [US5] 擴充 `test/unit/review-item.service.spec.ts`（或新增）：`createUnsupportedQuestion` 不複製原文、`suggestedImprovement` 只含 `reasonCode` 與 `module`。RED 後實作。
- [ ] T046 [US5] 新增 `test/integration/unsupported-question-review-item.spec.ts`：`CAPABILITY_NOT_RECOGNIZED`、`LLM_NO_MATCH` 建立紀錄；`PARAMETER_ISSUES`、`MULTIPLE_CAPABILITIES`、controlled conversation 不建立；同一問題重問兩次建立兩筆。RED 後在澄清路徑接入。
- [ ] T047 [US5] 擴充 `test/integration/customer-review-isolation.spec.ts`：`unsupported_question` 跨客戶隔離；review-items API 可依 `sourceType=unsupported_question` 篩選。
- [ ] T048 [US5] 確認 `src/feedback/feedback.dto.ts` 與 review-items 查詢參數的 `sourceType` 驗證接受新值。
- [ ] T049 [US5] 依 spec Decision 1 更新 `test/integration/clarification-required.spec.ts`：預期改為 `CAPABILITY_NOT_RECOGNIZED`、候選為空，並保留「不執行工具」與「建立 clarification question」斷言。
- [ ] T050 [US5] **Gate 6**：typecheck、US5 focused、`clarification-required`、`no-answer-review-item`、`feedback-review-linkage` 通過。記錄 `FEATURE013_GATE_6=PASS`。

## Phase 7 — 收尾與驗收

- [ ] T051 新增 `test/integration/feature013-acceptance.spec.ts`：兩位權限不同的使用者完整走過 開場 → 點 Quick Reply → 延伸建議 → 能力總覽 → 列表 → 封存，驗證 SC-001（看得到的都能執行、看不到的都不能執行）。
- [ ] T052 `customers/shinmone/test/integration/shinmone-assistant-experience.spec.ts`：以 Shinmone 合成資料驗證設定檔在其 pack 上的 opening、建議與權限篩選（Shinmone 文案仍為 `NEEDS_HUMAN_REVIEW`）。
- [ ] T053 Core 架構檢查：`src/`、`test/`（客戶以外）不含客戶名稱與客戶詞彙（以既有 `shinmone-reference-boundary.guard` 的方式擴充檢查範圍到 `src/assistant-experience/`）。
- [ ] T054 文件：更新 `docs/` 架構文件（新增體驗設定、可用能力服務、新端點）；`deploy/demo/README.md` 與部署 runbook 加入 `assistant-experience:provision` 步驟與「Core 先於 Gateway 部署」；`specs/README.md` 將 013 標為完成。
- [ ] T055 **Gate 7**：使用者執行全套測試（`--json` 輸出）全部通過；typecheck 通過；SC-001～SC-006 對照表記錄於本檔。記錄 `FEATURE013_GATE_7=PASS`，Feature 013 可合併回 main。
