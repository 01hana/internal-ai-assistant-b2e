# Tasks: Feature 013 — Assistant Conversation Experience

**Input**: 已核准的 `spec.md`（2026-11-15）、`design.md` 與 `plan.md`
**Status**: Phase 0–8 完成（Gate 8 PASS）；後端可合併回 main，前端串接另行進行

## 格式、相依與停止規則

- 格式 `- [ ] TNNN [USn] 說明`。`[US0]`–`[US5]` 對應 spec 的 user story；共用基礎與 Gate 不加標籤。
- 依 Phase 0 → 7 執行。每個 Phase 內先記錄真實的 RED，再做最小 GREEN 實作；原本就正確的行為記為 `EXISTING_GREEN`，不刻意弄壞來製造 RED。Gate 失敗時，該 Gate 與之後所有 task 保持未勾選。
- **STOP 並尋求人工審查**：需要 design D2 以外的 schema 變更；需要修改既有公開 contract 測試的預期值；需要在 Core 加入客戶分支或客戶詞彙；需要新增 LLM 呼叫；需要改變能力解析、工具權限或 evidence 的判斷規則。
- Git：Claude 只在每個 Gate 通過後 stage 該 Phase 的檔案並提供 commit message；commit、push 與 branch 管理由使用者執行。
- 驗證指令：`npx tsc --noEmit -p tsconfig.spec.json`、`npx jest --config jest.config.ts <paths>`；全套測試需本機測試資料庫，由使用者執行並以 `--json --outputFile=.local-state/jest-results.json` 回傳結果。
- **Baseline**：`main` @ `ceb6705` 全套結果為 2 個 suite、4 個 test 失敗：`clarification-required`（2，由 T049 處理）與 `feature010-scope-boundary`（2 個 hash，由 Phase 0 處理）。

## Phase 0 — 開發基線整理（US0）

**Goal**：移除凍結整檔 hash 的檢查，保留真正的安全邊界；建立 specs 索引。

- [x] T001 [US0] 在新檔 `test/architecture/repository-safety.guard.spec.ts` 寫入保留的檢查並確認 GREEN：tracked 檔案不含 `.pem` / `.key`；無 `.gitmodules`、無 submodule；只有一個 worktree；tracked 檔案不含 `frontend|f2e|widget|assistant-sdk` 目錄。
- [x] T002 [US0] 在同檔新增 migration 只能新增的檢查：以 `test/fixtures/migration-ledger.json` 記錄既有每支 migration 目錄名稱與 `migration.sql` 的 sha256；既有項目內容不得改變或消失，新目錄允許出現（需同時更新 ledger）。先以竄改暫存副本的方式證明檢查會失敗（RED 證據），再確認現況 GREEN。
- [x] T003 [US0] 刪除 `test/contract/feature010-scope-boundary.contract.spec.ts`；確認其仍有價值的檢查已由 T001–T002 或既有 contract 測試（`assistant-sessions`、`assistant-messages-sse`、`assistant-message-history`、`feature010-public-compatibility`）涵蓋，將對照表記錄在本檔 Phase 0 證據段。
- [x] T004 [US0] 將 `.specify/feature.json` 改為指向 `specs/013-assistant-conversation-experience`；確認沒有其他測試依賴舊值。
- [x] T005 [US0] 新增 `specs/README.md`：001–012 的名稱、狀態（已完成）、合併進 main 的日期；013 狀態為「進行中」；說明 spec 合併後凍結、現況文件在 `docs/`。日期以 `git log` 查證，不得推測。
- [x] T006 **Gate 0**：typecheck 通過；T001–T002 focused 通過；使用者執行全套，結果只剩 baseline 中的 `clarification-required` 失敗。記錄 `FEATURE013_GATE_0=PASS`。

**Phase 0 執行證據（2026-11-16）**：

- 執行環境：Claude 的 Linux VM 無法執行 jest（`jest-resolve` 使用的原生模組為 macOS 版），測試由使用者在 Mac 執行；Claude 端只跑 `tsc`。`npx tsc --noEmit -p tsconfig.spec.json` PASS。
- T001／T002：新增 `test/architecture/repository-safety.guard.spec.ts` 與 `test/fixtures/migration-ledger.json`（11 支 migration + `migration_lock.toml`）。反向案例內建於同一檔：合成 `.pem`/`.KEY` 與前端路徑清單必須被抓出；在暫存副本中竄改、刪除、插入舊日期 migration 與新增未登錄 migration，必須回報四項違規。
- T003：刪除 `test/contract/feature010-scope-boundary.contract.spec.ts`。原檢查對照：

| 原檢查 | 處置 |
|---|---|
| tracked `.key`/`.pem`、submodule、單一 worktree、無前端目錄 | 移到 T001 |
| `prisma/migrations` 整體 hash 與兩支 ownership migration 內容 | 由 T002 migration ledger 取代（既有 migration 內容不可變） |
| `prisma/schema.prisma` hash | 刻意移除；schema 變更由 migration ledger 與 code review 控管 |
| controller／DTO／SSE 型別／history 型別 hash、controller 只有 4 個路由 | 刻意移除；公開行為由既有 contract 測試把關：`assistant-sessions`、`assistant-messages-sse`、`assistant-message-history`、`feature010-public-compatibility`、`feature012-public-compatibility` |
| specs 009／010 的 spec、design、plan、tasks hash、009 T126–T142 未執行、010 tasks 編號連續 | 刻意移除；合併後的 specs 依 `specs/README.md` 約定凍結，延後項目記錄在索引 |
| Shinmone `work-orders.monthly-new-count` manifest hash | 刻意移除；manifest 內容由 Connector Runtime 的 Shinmone manifest 測試驗證 |
| `package.json`、`AGENTS.md`、`.specify/feature.json` hash | 刻意移除；一般變更由 code review 控管 |

- T004：`.specify/feature.json` 改指向 013；repo 內沒有其他測試讀取它。
- T005：新增 `specs/README.md`；日期取自 `git log`（各資料夾第一個 commit 與 `tasks.md` 最後一個 commit、PR #1／#2 merge commit），延後項目取自各 `tasks.md` 未勾選的 task。

- T006 Gate 0（使用者於 Mac 執行全套，2026-11-16）：251 suites 中 227 passed、23 skipped、1 failed；2202 tests 中 2018 passed、182 skipped、2 failed。唯一失敗為 baseline 已知的 `clarification-required`（2，T049 處理）；`repository-safety.guard` 5/5 passed，含兩個反向案例。

```text
FEATURE013_GATE_0=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T006
FEATURE013_FIRST_UNEXECUTED_TASK=T007
```

## Phase 1 — 共用基礎

**Goal**：可用能力單一來源、資料表、體驗設定模組與 provisioning。

- [x] T007 新增 `test/unit/available-capability.service.spec.ts`：以合成 pack 與 tool policy fixture 覆蓋 active/inactive binding、inactive capability、tool 未啟用、policy 未啟用、缺 role、缺 scope、result policy 拒絕、permission mask 缺 scope、參數 `ENUM_VALUE_IN` 限制。RED：服務尚不存在。
- [x] T008 新增等價測試 `test/unit/available-capability-llm-equivalence.spec.ts`：同一組輸入下，`LlmToolSelectionService` 現有 offered 清單與新服務輸出的 `(capabilityKey, bindingId)` 集合相同。先對現有實作取得 EXISTING_GREEN 基準。
- [x] T009 實作 `src/capabilities/available-capability.service.ts`（design D1），註冊於 `CapabilitiesModule`；`LlmToolSelectionService.resolveOffered` 改為使用新服務。T007、T008 與既有 `llm-tool-selection.service.spec.ts` 全部 GREEN。
- [x] T010 修改 `prisma/schema.prisma`（design D2）並新增 migration `20261115000000_feature013_assistant_experience`，含 partial unique index；`npm run prisma:generate`；更新 `test/fixtures/migration-ledger.json`。
- [x] T011 新增 `test/integration/assistant-experience-config.persistence.spec.ts`：同範圍第二筆 active 被拒、不同 integration 各自 active、`title` 可為 null、`unsupported_question` 可寫入。
- [x] T012 新增 `test/unit/assistant-experience.parser.spec.ts`：合法 payload、缺欄位、ID 重複、`maxQuickReplies` 越界、`capability_overview` 帶 `capabilityKey`、`capability` 缺 `capabilityKey`、超長文字；錯誤只含路徑與代碼。RED 後實作 `assistant-experience.types.ts`、`assistant-experience.parser.ts`。
- [x] T013 新增 `test/unit/assistant-experience.validator.spec.ts`：scope 不符、`capabilityKey` 或參數不在 active pack、宣告的能力與參數無法解析到 active binding（Decision 4）、全部正確；驗證過程不寫審計。RED 後實作 `assistant-experience.validator.ts`（使用 `CapabilityBindingResolverService`，不呼叫 LLM）。
- [x] T014 新增 `test/integration/assistant-experience.repository.spec.ts`：activate 新版本時舊版改 `retired` 且在同一 transaction；驗證失敗不留下任何資料列。RED 後實作 `assistant-experience.repository.ts`。
- [x] T015 新增 `test/unit/provision-assistant-experience.spec.ts`：`--check` 不寫入、正常寫入並啟用、同版本同 checksum 重跑略過、同版本不同 checksum 拒絕。RED 後實作 `src/assistant-experience/provision-assistant-experience.command.ts` 與 `scripts/provision-assistant-experience.ts`，於 `package.json` 新增 `assistant-experience:provision` script。
- [x] T016 新增合成 fixture `test/fixtures/assistant-experience/customer-a.v1.json`（對應既有合成 pack），供 Core 測試使用；Core 測試不得引用 `customers/`。
- [x] T017 新增 `customers/shinmone/assistant-experience/1.0.0.json`（問候語、Quick Reply、followUps 對應 `shinmone.dashboard.kpistats.snapshot` 的 today / this_week / this_month），所有文案標記 `NEEDS_HUMAN_REVIEW`，並在 `customers/shinmone/docs/` 新增審核問題清單；新增 `customers/shinmone/test/contract/shinmone-assistant-experience.contract.spec.ts` 以 validator 驗證此檔對應 production pack。
- [x] T018 **Gate 1**：typecheck、T007–T017 focused 通過；`llm-tool-selection` 相關既有測試未修改預期且通過。記錄 `FEATURE013_GATE_1=PASS`。

**Phase 1 執行證據（2026-11-16）**：

- 純邏輯先在 Claude 的 VM 以「編譯成 JS 後用 node 執行」驗證（parser、validator、provisioning command），再由使用者在 Mac 執行 jest；Prisma Client 由使用者在 Mac 產生（VM 無法下載 Prisma 引擎）。
- T007／T008：`available-capability.service.spec.ts` RED 為 `TS2307`（服務尚不存在）。T009 搬移 `resolveOffered()` 的判斷到 `AvailableCapabilityService`；`LlmToolSelectionService` 建構子不變、內部建立新服務。等價測試涵蓋完整權限、缺月份權限、無權限、其他 integration、其他客戶五種情境。既有 `llm-tool-selection.service.spec.ts` 未修改預期且通過。
- T010：migration `20261116000000_feature013_assistant_experience`。**與 design D2 的差異**：「同一範圍最多一份 active」改用可為 null 的 `activeSlot` 欄位加 unique 限制，而非 partial unique index；後者無法寫進 Prisma schema，日後 `prisma migrate dev` 會產生刪除它的 migration。複合 unique 以 `map` 指定名稱，避免超過 PostgreSQL 63 字元上限。`prisma migrate diff` 對本 migration 無差異。
- T012：parser 為封閉結構驗證，錯誤只含路徑與代碼；新增 `semanticReviewStatus` 欄位，provisioning 預設拒絕非 `HUMAN_VERIFIED` 內容（`--allow-unverified` 供開發與測試）。
- T013：**依 spec Decision 4 調整**：validator 驗證宣告的能力與參數可解析到 active binding，不做語意比對、不呼叫 LLM、不寫審計；`message` 僅為顯示文字。過程中把 `classifyControlledConversation` 搬到 `src/query-understanding/controlled-conversation.classifier.ts` 並 export（T026 會改寫）。
- T014：repository 的 activate 在同一 transaction 內先 retire 舊 active 再 upsert；讀取時重新 parse payload，失敗則視為無設定（回到預設問候語）。`scripts/test-db-init.ts` 加入 `assistantExperienceConfig.deleteMany()`，避免外鍵阻擋重設。
- T015：命令列入口 `src/assistant-experience/provision-assistant-experience.cli.ts` 會編譯進 Core image，供部署時在容器內執行；`npm run assistant-experience:provision` 為開發入口。結果：`VALIDATED`／`ACTIVATED`／`REACTIVATED`／`UNCHANGED`；錯誤：`INVALID_PAYLOAD`／`UNVERIFIED_CONTENT`／`PACK_MISMATCH`／`CUSTOMER_NOT_FOUND`／`VERSION_CONFLICT`。
- T016：合成 pack `customer-a-experience.v1.json` 與設定 `customer-a.v1.json`；validator 首次執行即抓出合成 pack 缺少「新增多少工單」別名的問題。
- T017：Shinmone 設定以 `NEEDS_HUMAN_REVIEW` 提交，審核問題見 `customers/shinmone/docs/assistant-experience-review.md`。發現 Shinmone 正式 pack 的確定性語意無法辨識常見問法（含 pack 自身範例），促成 Decision 4；pack 語意改善另列客戶待辦。客戶測試首次失敗原因為 tool catalog 為 staged-only（`isActive=false`），已改為模擬 `deploy/demo/provision` 建立後的啟用狀態。
- 範圍外待辦：`prisma migrate diff` 另列出 5 個 Feature 005 留下的索引名稱差異（PostgreSQL 截斷與 Prisma 命名規則不同），不影響功能，未在本 feature 處理。
- T018 Gate 1（使用者於 Mac 執行，2026-11-16）：全套 258 suites 中 232 passed、24 skipped、2 failed；修正 Shinmone 客戶測試後單獨重跑通過。剩餘失敗僅 baseline 的 `clarification-required`（2，T049）。DB-backed `assistant-experience-config.persistence.spec.ts` 4/4 通過。typecheck 與變更檔 lint 通過。

```text
FEATURE013_GATE_1=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T018
FEATURE013_FIRST_UNEXECUTED_TASK=T019
```

## Phase 2 — 開場語與 Quick Reply（US1）

- [x] T019 [US1] 新增 `test/unit/assistant-experience.service.spec.ts`（`buildOpening`、`resolveQuickReply`）：權限篩選、`pageScope` 篩選、`priority` 排序、`maxQuickReplies` 截斷、`capability_overview` 只在至少一項可用能力時出現、無設定時回預設問候語。RED 後實作 `assistant-experience.service.ts` 對應方法。
- [x] T020 [US1] 擴充 `test/contract/assistant-sessions.contract.spec.ts`：回應新增 `opening`，既有欄位與既有斷言不變。RED 後在 `AssistantController.createSession` 組裝 `opening`，`session_created` 審計 metadata 加 `experienceConfigVersion`、`quickReplyIds`。
- [x] T021 [US1] 新增 `test/unit/send-message-dto.spec.ts`：`message` 與 `choiceId` 恰好一個、`choiceId` 格式。RED 後修改 `SendAssistantMessageDto`；新增 `CapabilityResolutionService.resolveDeclared` 與其單元測試（binding 解析結果與審計 `reasonCode: DECLARED_CHOICE`）。
- [x] T022 [US1] 新增 `test/integration/quick-reply-selection.spec.ts`：點擊可見 Quick Reply 以宣告的能力與參數執行，LLM 工具選擇開或關結果相同且不呼叫模型；ToolCall、權限檢查與 answerDecision 與一般問題路徑一致；寫入 `quick_reply_selected`；不存在／已換版／無權限的 ID 回與 session not found 相同的 404，且不寫 user message。RED 後在 `AssistantMessageService` 與 query understanding 接入 `resolveChoice` / `resolveDeclared`。
- [x] T023 [US1] 擴充 `test/integration/customer-session-isolation.spec.ts`：A 客戶的 `choiceId` 在 B 客戶 session 不可用，`opening` 不含 B 的設定。
- [x] T024 [US1] Gateway：擴充 `apps/gateway/test` 對應測試，`readSendMessageInput` 接受並轉發 `choiceId`，拒絕格式錯誤；`POST sessions` 回應原樣轉發 `opening`。RED 後修改 `gateway-assistant.controller.ts` 與 trust chain handler 的 message 型別。
- [x] T025 [US1] **Gate 2**：typecheck（Core + Gateway）、US1 focused 測試、既有 `assistant-sessions` / `assistant-messages-sse` / `gateway-internal-identity` contract 通過且預期值未改。記錄 `FEATURE013_GATE_2=PASS`。

**Phase 2 執行證據（2026-11-16）**：

- T019：`AssistantExperienceService`（`buildOpening`、`resolveChoice`）。一次請求只呼叫一次 `resolveAvailableBindings`，再以純函式 `acceptsDeclared` 比對每個選項。`pageScope` 只是顯示篩選，點擊時不重新檢查；權限每次點擊都重新檢查。無 active 設定或 hostApp 不在設定內時，回 Core 預設問候語。
- T020：`opening` 由 controller 組好後傳入 `AssistantSessionService.createSession`（session 服務建構子不變）；`session_created` 審計加 `experienceConfigVersion`、`quickReplyIds`。既有 `assistant-sessions.contract.spec.ts` 為 `objectContaining`，未修改；opening 案例寫在新檔 `test/integration/quick-reply-selection.spec.ts`。
- T021：`SendAssistantMessageDto` 以 `ValidateIf` + 自訂限制實作「`message` 與 `choiceId` 恰好一個」；另新增 `CapabilityResolutionService.resolveDeclared()`（略過語意比對，照常寫解析審計，`reasonCode: DECLARED_CHOICE`／`DECLARED_CHOICE_UNRESOLVED`）。`declaredChoice` 經 controller → 訊息服務 → 規劃服務 → query understanding → pipeline 傳遞；pipeline 收到宣告的能力時不做文字意圖分類、不呼叫 LLM 工具選擇。
- T022：`AssistantController` 新增的 `AssistantExperienceService` 標為 `@Optional()`，以免修改手動建構 controller 的既有單元測試；正式 app 一律由 Nest 注入。測試用 in-memory Prisma mock 新增 `assistantExperienceConfig`，並新增 `test/support/assistant-experience-state.fixture.ts` 與合成設定 `customer-a-reference.v1.json`（使用預設 reference pack 的 `orders.status`，經 mock connector 實際執行）。
- T023：**與 tasks 的差異**：跨客戶隔離案例寫在 `quick-reply-selection.spec.ts`，未修改 `customer-session-isolation.spec.ts`（後者的 app 設定不含體驗設定）。
- T024：Gateway controller、trust-chain handler、backend client 三層改為接受 `message` 或 `choiceId` 擇一（共用 `apps/gateway/src/backend-client/assistant-message-input.ts`）。只送 `message` 時轉發給 Core 的 JSON 與原本相同。
- **經使用者同意修改的既有測試預期值**（皆因 FR-004／FR-005 的新增欄位，且原測試為嚴格比對）：`apps/gateway/test/backend-client/gateway-backend-client.spec.ts` 鎖定的送訊息 DTO 欄位；`customers/shinmone/test/integration/shinmone-reference-vertical.spec.ts` 的 session 回應明確加入 `opening`。
- 首輪全套另有 3 個失敗：本 Phase 新測試的預期錯誤（無權限時 reference pack 仍有不需權限的工具）、DTO 單元測試缺 `reflect-metadata`、上述 Shinmone 嚴格比對；修正後 4 個受影響檔案單獨重跑通過。`shinmone-kpistats-demo-http` 的 `it.each` 首例在全套時逾時 5 秒，單獨執行通過，判定為負載造成，非本 Phase 變更所致。
- T025 Gate 2（使用者於 Mac 執行，2026-11-16）：Core 全套 262 suites 中 233 passed、24 skipped、5 failed（修正後僅剩 baseline `clarification-required` 2 個）；Gateway 全套 81 suites 中 71 passed、10 skipped，1418 tests passed。typecheck（Core、Gateway）與變更檔 lint 通過。

```text
FEATURE013_GATE_2=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T025
FEATURE013_FIRST_UNEXECUTED_TASK=T026
```

## Phase 3 — 能力總覽（US2）

- [x] T026 [US2] 新增 `test/unit/controlled-conversation-classifier.spec.ts`：正向問句表（至少 20 句不同措辭，含既有清單）與反向問句表（至少 20 句含資料字眼，如「我可以查本月工單嗎」）。RED 後將 `classifyControlledConversation` 改為正規化 + 句型比對（design D5-1），保留函式簽章。
- [x] T027 [US2] 擴充 `test/unit/controlled-conversation.spec.ts` 或新增 `test/integration/capability-overview.spec.ts`：開關 `true` / `false` 輸出相同清單；權限不同的兩位使用者清單不同；無可用能力時回固定說明且不列任何能力；`final.suggestions` 為可見的能力類 Quick Reply；不產生 ToolCall / evidence。**2026-11-16 調整**：開關無關性為既有行為（EXISTING_GREEN，以測試鎖定）；RED 後修改無可用能力時的說明，並加入 `final.suggestions`（含 SSE builder 的 `suggestions` 欄位，原屬 T033）。
- [x] T028 [US2] 擴充 `test/unit/llm-tool-selection.service.spec.ts`：模型回 `capability_discovery` 時解析為能力總覽；開關關閉時不呼叫模型；模型回非法值時照原本失敗路徑。RED 後擴充選擇結構（不新增呼叫）。
- [x] T029 [US2] 新增 `test/integration/unrecognized-capability-suggestions.spec.ts`：`CAPABILITY_NOT_RECOGNIZED` / `LLM_NO_MATCH` 的澄清 `final` 附 `suggestions`；無可用能力時省略。RED 後實作保底（design D5-3）。
- [x] T030 [US2] **2026-11-16 調整**：保留 `describeAvailable()`（design Reuse Inventory 更正）；`kind: capability_overview` 的 Quick Reply 點擊走能力總覽，補一個 integration 案例於 `quick-reply-selection.spec.ts`。
- [x] T031 [US2] **Gate 3**：typecheck、US2 focused、SC-006 反向問句表 0 誤判、既有 `controlled-conversation` 與 `query-understanding` 測試通過。記錄 `FEATURE013_GATE_3=PASS`。

**Phase 3 執行證據（2026-11-16）**：

- T026：`classifyControlledConversation` 改為「正規化（去除請問／想問／嗎／呢等）＋ 5 種句型」，舊的固定句子清單與「怎麼查詢 X」規則原樣保留。資料字眼（數量、期間、比較、狀態、進度、單號、數字等）一律不歸類為能力總覽。主詞包含指 AI 本身的「這個／這套／你們的 ＋ 助理／系統／AI／機器人／小幫手」。`controlled-conversation-classifier.spec.ts` 正反各 29 句，先在 VM 以編譯後的 JS 驗證 0 錯誤；既有 `controlled-conversation.spec.ts` 13 個案例結果不變。
- T027：**更正 spec**：原稿「能力總覽依賴 LLM 開關」有誤——`describeAvailable()` 不呼叫 LLM、不檢查開關，且自 Phase 1 起經 `AvailableCapabilityService` 判斷權限（開關無關性為 EXISTING_GREEN，以 `capability-overview.spec.ts` 鎖定）。實作：無可用能力時改為建議申請權限；`final.suggestions` 由 `AssistantExperienceService.buildCapabilityQuickReplies` 提供（可見的能力類 Quick Reply，不受 `pageScope` 限制）。SSE `finalData.suggestions` 型別在本 Phase 加入（原屬 T033），空陣列時不出現。
- T028：LLM 選工具新增 `{"decision":"capability_discovery"}`（必須只有這個鍵）→ `LLM_CAPABILITY_DISCOVERY` → pipeline 以能力總覽回答；全程只呼叫一次模型。
- T029：`CAPABILITY_NOT_RECOGNIZED`（澄清路徑）與 `LLM_NO_MATCH`（no_answer 路徑）的回覆附上能力類 Quick Reply；一般成功回答不附。
- T030：**依 design 更正保留 `describeAvailable()`**（輸出含可查欄位、期間與範例問句，比只列 `safeLabel` 更適合使用者）；`capability_overview` Quick Reply 點擊附建議的案例在 `capability-overview.spec.ts`。
- 首輪 `capability-overview.spec.ts` 2 個測試寫法問題：LLM 案例的測試句含「這個」，被追問判斷視為指涉前文而在無前文時要求澄清，未走到 LLM；一般問題案例缺少回答替身（測試封鎖真實 LLM）。修正後通過。
- **觀察事項（不屬本 feature，另列 Feature 010 待辦）**：追問判斷遇到「這個／那個」時，即使指示詞後接的是助理或系統本身、或前面沒有任何對話，也會直接要求澄清。本 Phase 已讓「這個助理能做什麼」這類能力問題在規則層先被辨識；其他帶指示詞但前文不存在的問題，建議改為繼續往下解析而非直接澄清。
- T031 Gate 3（使用者於 Mac 執行，2026-11-16）：全套 264 suites 中 238 passed、24 skipped、2 failed（`capability-overview` 2 個測試寫法問題，修正後重跑通過；其餘僅 baseline `clarification-required`）。擴充主詞後 `controlled-conversation-classifier`、`controlled-conversation`、`capability-overview` 重跑全部通過。typecheck 與變更檔 lint 通過。

```text
FEATURE013_GATE_3=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T031
FEATURE013_FIRST_UNEXECUTED_TASK=T032
```

## Phase 4 — 延伸建議（US3）

- [x] T032 [US3] 擴充 `assistant-experience.service.spec.ts`（`buildFollowUps`）：條件比對、排除與目前參數相同者、權限與參數可用性篩選、上限 3。RED 後實作。
- [x] T033 [US3] 擴充 `test/unit/assistant-sse-event-builder.spec.ts`：`suggestions` 有值時出現、空陣列時省略欄位、其他 `final` 欄位不變。RED 後修改 `assistant-sse.types.ts` 與 builder。
- [x] T034 [US3] 新增 `test/integration/follow-up-suggestions.spec.ts`：成功回答附建議；無權限的建議不出現；`no_answer`、`permission_denied`、`tool_failed`、一般澄清、確認／核准回答不附建議；以 `choiceId` 點擊建議寫入 `suggestion_selected`，並以宣告的能力與參數執行。RED 後在 `AssistantMessageService` 接入。
- [x] T035 [US3] 擴充 `test/contract/feature012-public-compatibility.contract.spec.ts`：未設定 followUps 時 `final` 形狀與現行完全相同。
- [x] T036 [US3] **Gate 4**：typecheck、US3 focused、`feature012-*` 與 `assistant-messages-sse` contract 通過。記錄 `FEATURE013_GATE_4=PASS`。

**Phase 4 執行證據（2026-11-16）**：

- T032：`AssistantExperienceService.buildFollowUps`：`whenCapabilityKey` 相符、`whenParameters` 每項等於已回答的參數；排除與剛回答完全相同的請求與使用者無權執行者；依設定順序最多 3 個。
- T033：SSE `suggestions` 型別已於 Phase 3 加入；本 Phase 補 builder 測試（`buildAnswerOnlyEvents`、`buildMessageEvents` 皆原樣帶出，未提供時不出現欄位）。
- T034：`AssistantMessageService.followUpSuggestions` 只在 `answered`、工具 `completed`、能力解析 `RESOLVED` 時附加；LLM 串流生成與確定性回答兩條成功路徑皆接上，證據衝突的 no_answer 不附。
- T035：無設定客戶的 `final` 不含 `suggestions`（`follow-up-suggestions.spec.ts`）；既有 `feature012-public-compatibility`、`assistant-messages-sse` contract 未修改且通過。
- 首輪 2 個測試問題：Phase 3 的「一般問題不附建議」在加入延伸建議後已過時，改為檢查附的是延伸建議而非 Quick Reply；SO-10002 的回答替身比對了不存在於證據中的文字，改為比對 `"status":"delayed"`。同一替身錯誤也存在於 Phase 2 `quick-reply-selection.spec.ts`（原只檢查工具與審計，故未失敗），一併修正並補上「成功回答」斷言。
- T036 Gate 4（使用者於 Mac 執行，2026-11-16）：全套 265 suites 中 238 passed、24 skipped、3 failed（上述 2 個測試問題與 baseline `clarification-required`）；修正後 3 個受影響檔案重跑通過。typecheck 與變更檔 lint 通過。

```text
FEATURE013_GATE_4=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T036
FEATURE013_FIRST_UNEXECUTED_TASK=T037
```

## Phase 5 — Session 列表與封存（US4）

- [x] T037 [US4] 新增 `test/unit/session-cursor.spec.ts`：cursor 編解碼、竄改或格式錯誤回 400、`limit` 預設 20 與上限 50。RED 後實作 cursor 工具。
- [x] T038 [US4] 新增 `test/integration/session-list.spec.ts`：只列自己 exact scope 的 active session；排序 `coalesce(lastMessageAt, createdAt) desc, id desc`；分頁不重複不遺漏；`closed` 不出現；不寫審計。RED 後新增 `GET /assistant/sessions` 與 service 方法。
- [x] T039 [US4] 擴充 `session-list.spec.ts`：第一則 user message 設定 `title`（去除空白後前 40 字）、第二則不覆寫、併發兩則只設定一次。RED 後在 `sendMessage` 的 user message transaction 內實作。
- [x] T040 [US4] 新增 `test/integration/session-archive.spec.ts`：封存後狀態 `closed`、寫 `session_archived`、之後送訊息與讀取回 404；他人或他客戶 session 回 404。RED 後新增 `POST /assistant/sessions/:id/archive`。
- [x] T041 [US4] 新增 `test/contract/assistant-session-list.contract.spec.ts`：列表與封存的回應形狀與錯誤格式。
- [x] T042 [US4] 擴充 `test/integration/customer-session-isolation.spec.ts`：跨客戶列表與封存隔離。
- [x] T043 [US4] Gateway：`backend-route-definition.ts` 新增 `list-sessions`、`archive-session`；`gateway-assistant.controller.ts` 新增 handler；擴充 Gateway 測試（含白名單仍拒絕未定義路由）。
- [x] T044 [US4] **Gate 5**：typecheck（Core + Gateway）、US4 focused、`assistant-sessions` / `assistant-message-history` contract 通過。記錄 `FEATURE013_GATE_5=PASS`。

**Phase 5 執行證據（2026-11-16）**：

- T037：`src/assistant/session/session-cursor.ts`：cursor 為 base64url `{t, id}`，長度、字元、欄位、時間格式任一不符回 400；`limit` 預設 20、1–50 以外回 400。
- T038：`AssistantSessionService.listSessionPage`。與原設計的差異（已同步 spec/design）：(1) 只列已有訊息的 session，避免每次開啟助理都多一筆空紀錄；(2) 排序改為 `lastMessageAt desc, id desc`（不需 coalesce）；(3) 發現 `lastMessageAt` 先前從未被更新，改為每則 user message 寫入後更新。
- T039：`recordUserMessage` 以 `updateMany where title is null` 設定標題（空白合併、去頭尾、前 40 字）；第二則不覆寫。併發只設定一次由單一條件更新保證，未另寫併發測試。
- T040、T042：封存與跨客戶隔離測試併入 `test/integration/session-list.spec.ts`（`archive (T040)`、兩個 T042 案例），未另建 `session-archive.spec.ts`，也未修改 `customer-session-isolation.spec.ts`。
- T041：`test/contract/assistant-session-list.contract.spec.ts`。
- T043：Gateway 新增 `list-sessions`、`archive-session` 固定路由與 client／handler／controller 方法；列表只接受 `limit`（1–3 位數字）與 `cursor`（base64url，最多 200 字），Core 的 400（cursor 或 limit 不合法）安全轉發；封存不接受 body 與 query，只轉發 401/403/404。新增 `apps/gateway/test/backend-client/gateway-session-list.spec.ts`。**修改既有測試**：`backend-route-definition.contract.spec.ts`（路由鎖定加入兩條新路由與 3 個漂移案例）、`gateway-trust-chain-handler.spec.ts`（handler 方法清單加入 `listSessions`、`archiveSession`）。
- typecheck（Core、Gateway `tsconfig.test.json`）與變更檔 lint 通過。
- T044 Gate 5（使用者於 Mac 執行，2026-11-16）：Core 全套 268 suites 中 242 passed、24 skipped、2 failed：baseline `clarification-required`（2 tests，T049 處理）與 `structured-api-evidence-http.contract.spec.ts` 的「請查本期新增數量」案例回 404（單一案例、耗時 896ms，同組其他案例同一 session 皆通過）；該檔單獨重跑 3 次皆 22 passed、1 skipped，判定為偶發，不屬 Phase 5 變更。Gateway 82 suites 中 72 passed、10 skipped、0 failed。

```text
FEATURE013_GATE_5=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T044
FEATURE013_FIRST_UNEXECUTED_TASK=T045
```

## Phase 6 — 未支援問題收集（US5）

- [x] T045 [US5] 擴充 `test/unit/review-item.service.spec.ts`（或新增）：`createUnsupportedQuestion` 不複製原文、`suggestedImprovement` 只含 `reasonCode` 與 `module`。RED 後實作。
- [x] T046 [US5] 新增 `test/integration/unsupported-question-review-item.spec.ts`：`CAPABILITY_NOT_RECOGNIZED`、`LLM_NO_MATCH` 建立紀錄；`PARAMETER_ISSUES`、`MULTIPLE_CAPABILITIES`、controlled conversation 不建立；同一問題重問兩次建立兩筆。RED 後在澄清路徑接入。
- [x] T047 [US5] 擴充 `test/integration/customer-review-isolation.spec.ts`：`unsupported_question` 跨客戶隔離；review-items API 可依 `sourceType=unsupported_question` 篩選。
- [x] T048 [US5] 確認 `src/feedback/feedback.dto.ts` 與 review-items 查詢參數的 `sourceType` 驗證接受新值。
- [x] T049 [US5] 依 spec Decision 1 更新 `test/integration/clarification-required.spec.ts`：預期改為 `CAPABILITY_NOT_RECOGNIZED`、候選為空，並保留「不執行工具」與「建立 clarification question」斷言。
- [x] T050 [US5] **Gate 6**：typecheck、US5 focused、`clarification-required`、`no-answer-review-item`、`feedback-review-linkage` 通過。記錄 `FEATURE013_GATE_6=PASS`。

**Phase 6 執行證據（2026-11-16）**：

- T045：判斷規則抽成純函式 `src/assistant/message/unsupported-question.ts`（`unsupportedQuestionReason`），單元測試 `test/unit/unsupported-question.spec.ts`；`ReviewItemService.createUnsupportedQuestion` 單元測試 `test/unit/review-item-unsupported-question.spec.ts`：`sourceId` 為使用者訊息 ID，`suggestedImprovement` 只有 `{ reasonCode, module }`（無 module 時為 `null`），`summary` 為固定文字，審計 metadata 同樣不含原文；使用者訊息不在該 session 時不寫入。`priority` 為 `medium`。
- T046：`test/integration/unsupported-question-review-item.spec.ts`。接入兩處：`CAPABILITY_NOT_RECOGNIZED` 走前置澄清路徑，`LLM_NO_MATCH` 走前置 no_answer 路徑；兩處都在回應前寫入。打招呼、能力詢問、點擊 Quick Reply／延伸建議、成功回答都不建立；同一問題重問兩次建立兩筆。建立失敗時整個請求失敗，與既有 no_answer `ReviewItem` 行為一致。
- T047：review-items API 依 `sourceType=unsupported_question` 篩選、跨客戶列表與讀取隔離，併入上述 integration 檔，未修改 `customer-review-isolation.spec.ts`。`hasValidSource` 對 `unsupported_question` 改以使用者訊息確認來源仍屬於同一 Integration 的 session。
- T048：`ReviewItemsQueryDto.sourceType` 加入 `unsupported_question`；Prisma enum 已於 Phase 1 migration 加入。
- T049：`clarification-required.spec.ts` 依 Decision 1 改為 `CAPABILITY_NOT_RECOGNIZED`、候選為空，保留「不執行工具」與「建立 clarification question」斷言。**注意**：依 Decision 1，這兩種模糊情境（多筆選取列、同錨點多工具）目前解析為 `CAPABILITY_NOT_RECOGNIZED`，因此也會建立 `unsupported_question`。待日後恢復「列出候選」時，它們會自然改走 `MULTIPLE_CAPABILITIES`，不再被收集。
- 首輪 2 個失敗：(1) `clarification-required` 第二個測試的 `candidateRefs` 位於 `metadata`，修正斷言；(2) `listForReview` 未提供的篩選條件以 `undefined` 傳入，測試替身刻意把 `undefined` 視為無效條件（Prisma 視為不篩選），改為只帶入有提供的條件，實際查詢結果不變。
- typecheck（`tsconfig.json`、`tsconfig.spec.json`）與變更檔 lint 通過。
- T050 Gate 6（使用者於 Mac 執行，2026-11-16）：全套 271 suites 中 245 passed、24 skipped、2 failed（上述 2 個問題，baseline `clarification-required` 已不在既有失敗中）；修正後重跑 `clarification-required`、`unsupported-question-review-item`、`customer-review-isolation`、`feedback-review-linkage`、`no-answer-review-item`、`review-items` contract 全部通過。

```text
FEATURE013_GATE_6=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T050
FEATURE013_FIRST_UNEXECUTED_TASK=T051
```

## Phase 7 — 收尾與驗收

- [x] T051 新增 `test/integration/feature013-acceptance.spec.ts`：兩位權限不同的使用者完整走過 開場 → 點 Quick Reply → 延伸建議 → 能力總覽 → 列表 → 封存，驗證 SC-001（看得到的都能執行、看不到的都不能執行）。
- [x] T052 `customers/shinmone/test/integration/shinmone-assistant-experience.spec.ts`：以 Shinmone 合成資料驗證設定檔在其 pack 上的 opening、建議與權限篩選（Shinmone 文案仍為 `NEEDS_HUMAN_REVIEW`）。
- [x] T053 Core 架構檢查：`src/`、`test/`（客戶以外）不含客戶名稱與客戶詞彙（以既有 `shinmone-reference-boundary.guard` 的方式擴充檢查範圍到 `src/assistant-experience/`）。
- [x] T054 文件：更新 `docs/` 架構文件（新增體驗設定、可用能力服務、新端點）；`deploy/demo/README.md` 與部署 runbook 加入 `assistant-experience:provision` 步驟與「Core 先於 Gateway 部署」；`specs/README.md` 將 013 標為完成。
- [x] T055 **Gate 7**：使用者執行全套測試（`--json` 輸出）全部通過；typecheck 通過；SC-001～SC-006 對照表記錄於本檔。記錄 `FEATURE013_GATE_7=PASS`，Feature 013 可合併回 main。

**Phase 7 執行證據（2026-11-16）**：

- T051：`test/integration/feature013-acceptance.spec.ts`：兩位權限不同的使用者（只有 `orders:read`；`orders:read` + `work-orders:read`）。開場看到的每個選項點了都能執行（`RESOLVED`／`DECLARED_CHOICE`），沒看到的都回 404 且不執行；完整走過 Quick Reply → 延伸建議 → 能力總覽 → 列表（標題來自第一則訊息）→ 封存，另一位使用者看不到、不能送訊息、不能封存。
- T052：`customers/shinmone/test/integration/shinmone-assistant-experience.spec.ts`：以正式 Active Pack 與合成使用者驗證 Shinmone 設定：Dashboard 開場 4 個選項、其他頁只有 overview、無 `menu:SCM_DASHBOARD:read` 時全部不出現；三個期間的延伸建議；顯示的選項都能解析、無權限時都不能。Shinmone 文案已於 2026-11-16 由使用者確認為 `HUMAN_VERIFIED`（原 task 寫 `NEEDS_HUMAN_REVIEW` 已過時）。
- T053：`test/unit/shinmone-reference-boundary.guard.spec.ts` 掃描範圍加入 `src/assistant-experience`、`src/capabilities`、`src/assistant/session`、`src/feedback`；先以相同規則手動掃過，無命中。
- T054：新增 `docs/architecture/assistant-conversation-experience.md`、`docs/frontend-integration/assistant-conversation-experience.md`（前端串接指南）；`docs/customer-onboarding/customer-artifact-map.md` 加入 AssistantExperienceConfig；`deploy/demo/deploy.sh` 新增 `experience` 指令（在 Core image 內執行 provisioning CLI，先 `--check` 再寫入），`prepare-delivery.sh` 產生 `provision/assistant-experience.json`（加入 `.gitignore`）；`deploy/demo/README.md` 加入體驗設定與「Core 先於 Gateway」升級順序；Project 部署手冊第 8 節加入 Feature 013 升級步驟。`specs/README.md` 於 Gate 7 通過後標為完成。
- typecheck（`tsconfig.spec.json`）、變更檔 lint、`bash -n` 通過。
- T055 Gate 7（使用者於 Mac 執行，2026-11-16）：Core 全套（含 `customers/shinmone`）273 suites 中 249 passed、24 skipped、0 failed；2411 tests 中 2225 passed、186 skipped。Gateway 本 Phase 未變更，沿用 Gate 5 結果（82 suites 中 72 passed、10 skipped、0 failed）。

| 成功標準 | 結果 | 證據 |
| --- | --- | --- |
| SC-001 看得到 ⇔ 能執行 | PASS | `feature013-acceptance`、`shinmone-assistant-experience`、`quick-reply-selection`、`capability-overview`、`follow-up-suggestions` |
| SC-002 LLM 旗標不改變清單 | PASS | `capability-overview`（flag true/false 同文）、`quick-reply-selection`（兩種 flag 皆以宣告能力執行） |
| SC-003 舊公開 contract 不改預期 | PASS | `assistant-sessions`、`assistant-messages-sse`、`assistant-message-history`、`feature012-public-compatibility` 預期值未改（僅新增案例）。Gateway 內部路由鎖定與 handler 方法清單依新路由更新（Phase 5 已記錄並經使用者確認） |
| SC-004 跨客戶隔離 | PASS | `session-list`（列表、封存）、`quick-reply-selection`（點擊）、`unsupported-question-review-item`（ReviewItem） |
| SC-005 全套與 typecheck | PASS | 本 Gate 全套 0 failed；`tsc --noEmit -p tsconfig.spec.json` 通過 |
| SC-006 資料問句 0 誤判為總覽 | PASS | `controlled-conversation-classifier`（Gate 3 反向問句表） |

```text
FEATURE013_GATE_7=PASS
FEATURE013_COMPLETED_TASK_RANGE=T001-T055
FEATURE013_STATUS=COMPLETE_BACKEND
```

## Phase 8 — 已封存列表、取消封存與刪除（US4 延伸，2026-11-16）

來源：Frontend 003 檢視對話紀錄畫面後，使用者選擇「做法 A」：封存可在「已封存」找回並取消封存；刪除是使用者端永久移除，後端保留資料作稽核。已封存的對話須先取消封存才能開啟。

- [x] T056 Migration `20261117000000_feature013_session_deleted`：`AssistantSessionStatus` 新增 `deleted`（只新增；`migration-ledger.json` 已加入）。需使用者於 Mac 執行 `npx prisma generate` 更新已進版控的 Prisma 產生檔，並 `prisma migrate deploy` 至本機與測試資料庫。
- [x] T057 Core：`GET /assistant/sessions?status=archived`（`closed` 狀態，格式與分頁同一般列表）；`POST /assistant/sessions/:id/unarchive`（`closed` → `active`，審計 `session_unarchived`）；`DELETE /assistant/sessions/:id`（`active`／`closed` → `deleted`，審計 `session_deleted`，訊息與審計保留）。`deleted` 不出現在任何列表，讀取、送訊息、封存、取消封存、刪除皆 404。
- [x] T058 Gateway：新增 `unarchive-session`（POST）、`delete-session`（DELETE）固定路由；列表查詢接受 `status=archived`；兩個新操作只轉發 401/403/404 的安全錯誤。**修改既有測試**：`backend-route-definition.contract.spec.ts`（鎖定清單加入兩條路由與 2 個漂移案例）、`gateway-trust-chain-handler.spec.ts`（handler 方法清單）。
- [x] T059 測試：`test/integration/session-list.spec.ts`（已封存列表、取消封存、刪除、跨客戶）、`test/contract/assistant-session-list.contract.spec.ts`、`apps/gateway/test/backend-client/gateway-session-list.spec.ts`。文件：`docs/frontend-integration/…`（5a 節）、`docs/architecture/…`。
- [x] T060 **Gate 8**：使用者 `npx prisma generate` 後執行 Core 全套與 `npm --prefix apps/gateway test`。`FEATURE013_GATE_8=PASS`。
  - 證據（使用者於 Mac 執行，2026-11-17）：migration 已套用本機與測試資料庫；Core 全套 273 suites 中 249 passed、24 skipped、0 failed，2416 tests 中 2230 passed、186 skipped（`session-list` integration 12、contract 3 全數通過）；Gateway 82 suites 中 72 passed、10 skipped、0 failed，1570 tests 中 1451 passed、119 skipped。

