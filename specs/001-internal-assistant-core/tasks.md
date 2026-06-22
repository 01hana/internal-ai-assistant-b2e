# 任務清單：內部後台 AI 助理核心

**輸入文件**：`/specs/001-internal-assistant-core/` 內的設計文件

**前置文件**：`plan.md`、`spec.md`、`design.md`

**測試要求**：本 feature 明確要求 unit、integration、contract、e2e、regression/eval、non-functional 測試。每個 user story 必須先建立測試任務，再實作功能。

**任務組織方式**：任務依 user story 分組，讓每個故事都能獨立實作與驗證。

## 格式：`[ID] [P?] [Story] 任務描述`

- **[P]**：可平行執行，因為任務涉及不同檔案或彼此獨立的模組。
- **[Story]**：對應 `US1` / `US2` / `US3` / `US4`。
- 檔案路徑遵循 `plan.md` 與 `design.md` 中定義的單一 NestJS 後端服務結構。
- 任務 ID 依文件順序遞增；ID 不代表唯一執行順序，實際順序仍以階段與相依性為準。

### 關鍵任務詳細化原則

一般任務維持簡短描述；但涉及安全邊界、資料權限、LLM、SSE、RAG、side-effect、approval、audit、history、feedback/review、non-functional validation 的關鍵任務，必須補充：

- 說明：描述此任務要完成的核心行為、不能違反的限制，以及與其他模組的關係。
- 輸出：列出預期新增或修改的主要檔案、模組、測試檔或文件。
- 完成條件：列出此任務完成的判斷標準，包含測試、錯誤路徑、安全限制與 audit / observability 要求。

補充內容要精準，不要複製整段 design.md；每個欄位以 1～4 個 bullet 為原則。

---

## 階段 1：專案初始化（共用基礎建設）

**目的**：建立 NestJS + TypeScript 專案骨架、基礎工具、Docker local dev baseline、環境變數規範與目錄結構。

- [x] T001 建立 NestJS + TypeScript 專案結構、application bootstrap 與全域 request/validation/error/response 接線，包含 `package.json`、`tsconfig.json`、`nest-cli.json`、`src/main.ts`、`src/app.module.ts`
  - 說明：建立可啟動的 NestJS app skeleton，並在 `main.ts` / `app.module.ts` 接上 global validation、exception handling、response envelope、requestId propagation；controller 只處理 DTO 與 response，不放業務規則。
  - 輸出：`src/main.ts`、`src/app.module.ts`、global `ValidationPipe`、global exception filter、response envelope interceptor、requestId middleware/interceptor 接線、app bootstrap smoke check。
  - 完成條件：app 可成功啟動；DTO validation 生效且未知欄位依專案規則拒絕或處理；所有 response/error envelope 都包含 requestId；非預期錯誤不向 client 洩漏 stack trace、secret、OpenAI API key、database credential 或 connector secret；後續 assistant / approval / feedback / tool controller 可共用全域 response/error 行為。
- [x] T002 [P] 在 `prisma/schema.prisma` 與 `prisma/migrations/` 設定 Prisma 基礎結構
- [x] T003 [P] 在 `jest.config.*`、`test/jest-e2e.json` 設定 Jest unit/e2e 測試環境
- [x] T004 [P] 在 `src/common/config/` 實作 config module，負責從 `.env` / `process.env` 載入並驗證 `LLM_PROVIDER`、`LLM_MODEL`、`DATABASE_URL`、OpenAI provider-specific credentials 與 runtime flags。Local development 使用 `.env`，範例名稱放在 `.env.example`，正式環境由 CI/CD secret 或 secret manager 注入；程式碼不得 hardcode secret、database URL、OpenAI API key、provider 或模型實際值。
  - 說明：建立所有 runtime 設定的唯一入口，避免 controller/service/domain 直接讀取或硬寫模型、secret、database URL。
  - 輸出：config module、typed config DTO、env validation rules、啟動錯誤格式。
  - 完成條件：缺少必要 env 會 fail fast；`LLM_PROVIDER` / `LLM_MODEL` 只在 config/provider layer 使用；secret 不會出現在一般 log、error response 或 audit metadata。
- [x] T005 [P] 建立 `.env.example`，列出 `DATABASE_URL`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`LLM_PROVIDER`、`LLM_MODEL`、OpenAI API key placeholder 與 runtime flags，但不得包含任何真實 secret
  - 說明：提供 Docker/local dev 可用的環境變數範本，同時避免把真實 secret 帶進 repo。
  - 輸出：`.env.example`、必要時 README env 說明。
  - 完成條件：範例值皆為 placeholder；沒有真實 OpenAI key、DB 密碼或 connector secret；與 config validation 欄位一致。
- [x] T006 [P] 建立 local development 用 `Dockerfile`，支援 NestJS backend app service 在容器中啟動
- [x] T007 [P] 建立 `docker-compose.yml`，包含 `app`、`postgres` 與 optional/profile-based `redis`；Redis 僅預留給 queue/backpressure/rate limit，MVP 未使用時可不啟用
- [x] T008 [P] 建立 `.dockerignore`，避免 node_modules、build output、local env、log、cache 與 secret 檔案進入 Docker build context
- [x] T009 [P] 建立原始碼模組目錄：`src/assistant`、`src/query-understanding`、`src/identity`、`src/permissions`、`src/tools`、`src/connectors/mock`、`src/llm/openai`、`src/prisma`、`src/retrieval`、`src/evidence`、`src/approvals`、`src/audit`、`src/feedback`、`src/observability`、`src/common`
- [x] T010 [P] 建立 `src/common/config`、`src/common/errors`、`src/common/request-id`、`src/common/response`、`src/common/sse`、`src/common/logger`，並避免建立 `src/common/providers`
- [x] T011 [P] 建立測試目錄：`test/unit`、`test/integration`、`test/contract`、`test/e2e`、`test/eval`
- [x] T012 [P] 在專案 README 中補上 v1 範圍排除說明：不做完整 admin UI/CRUD、不做真實 ERP/MES/WMS/SCM/CRM connector、不做 frontend SDK/widget
- [x] T013 [P] 在 README 補上 Docker Compose quickstart：`docker compose up`、app / postgres 啟動、Prisma migration、Prisma seed、test database initialization、unit / integration / contract / e2e / eval command、SSE smoke testing command 或手動步驟
  - 說明：建立 local dev/test baseline 的操作入口，讓後續 Codex 或工程師能從空環境啟動 app、DB、migration、seed 與 smoke test。
  - 輸出：README quickstart、Docker Compose command、migration/seed/test DB command、SSE smoke 步驟。
  - 完成條件：README 可指引 `docker compose up` 啟動 app 與 postgres；migration/seed/test DB 初始化步驟清楚；unit/integration/contract/e2e/eval 指令列出；不包含 production deployment、Kubernetes、Helm、CI/CD 範圍。
- [x] T014 [P] 在 README 或 checklist 補上 secret 規則：`.env` 不得 commit；`.env.example` 可 commit 但不得放真實 secret；OpenAI API key 不得出現在 README、測試 fixture、audit metadata、error log
  - 說明：把 secret 管理規則寫成實作前必讀約束，避免後續 fixture、README 或 audit sample 泄漏憑證。
  - 輸出：README/checklist secret section。
  - 完成條件：明確禁止 `.env` commit；禁止 OpenAI API key / connector secrets 進入 README、fixture、audit metadata、error log；與 secret redaction 測試一致。

---

## 階段 2：基礎能力（阻塞性前置任務）

**目的**：建立所有 user stories 共用的資料模型、Prisma access layer、migration/seed/test DB baseline、介面、身份邊界、權限、安全、redaction-aware logging、稽核、query understanding shell 與 provider 基礎。

**重要**：此階段完成前，不應開始任何 user story 的功能實作。

- [x] T015 在 `prisma/schema.prisma` 定義 `AssistantSession`、`AssistantMessage`、`AssistantContextState`、`ExecutionPlan`、`AnswerDecision`、`ClarificationQuestion`、`GroundingCheck` 模型
- [x] T016 在 `prisma/schema.prisma` 定義 `ToolDefinition`、`ToolCall`、`EvidenceRef`、`AuditEvent`、`FeedbackEvent`、`ReviewItem` 模型
- [x] T017 在 `prisma/schema.prisma` 定義 `ApprovalRequest`、`ActionDraft`、`EscalationRequest`、`KnowledgeDocument`、`KnowledgeChunk`、`RetrievalRun`、`RetrievalCandidate` 模型
- [x] T018 建立 `src/prisma/prisma.module.ts` 與 `src/prisma/prisma.service.ts`
  - 說明：建立 NestJS 共用 Prisma access layer；`PrismaService` 封裝 PrismaClient lifecycle，供 assistant、audit、tools、retrieval、approvals、feedback 等 module 注入使用；各 module 不得自行 `new PrismaClient()`。
  - 輸出：`src/prisma/prisma.module.ts`、`src/prisma/prisma.service.ts`、`PrismaModule` export `PrismaService`、Prisma lifecycle hooks、unit 或 integration smoke test。
  - 完成條件：`PrismaService` extends 或封裝 `PrismaClient`；app startup 可建立 DB connection；app shutdown 可正確 disconnect；assistant / audit / tools / retrieval / approvals / feedback 可注入；測試環境可 mock PrismaService 或使用 test database；不出現多個散落 PrismaClient instance；DB 連線錯誤不得洩漏 credential。
- [x] T019 建立 Prisma migration / seed / test database initialization baseline
  - 說明：建立 local dev 與 test 所需 migration / seed baseline；seed 僅包含內部 AI 助理 MVP 所需資料，讓 mock connector、RAG 文件知識、tool registry、eval/test cases 可穩定重現。
  - 輸出：`prisma/seed.ts`、seed helper 或 fixtures 目錄、mock connector fixtures seed 或 deterministic fixture loader、KnowledgeDocument / KnowledgeChunk fixtures、ToolDefinition fixtures、test database reset / migration / seed script、README quickstart command。
  - 完成條件：migration script 可成功執行；seed script 可成功執行；dev/test seed 不含真實客戶資料、真實內部交易資料、OpenAI API key 或 connector secret；fixtures 支援 order status、work order progress、inventory availability、customer/supplier history、SOP/policy/field guide/manual RAG、read/medium-risk/high-risk tool 測試；test database 可重置並重複執行 unit/integration/contract/e2e tests。
- [x] T020 [P] 建立 redaction-aware structured logger
  - 說明：建立統一 structured logger，供 request lifecycle、tool execution、retrieval、LLM provider、approval、feedback/review 使用；logger 支援 requestId correlation，並與 append-only AuditEvent 分工：log 用於 runtime/debug，AuditEvent 用於可追溯稽核。
  - 輸出：`src/common/logger/` 或等價路徑、logger service、redaction utility / policy、requestId correlation integration、logger unit tests 或 integration tests、secret-redaction test 與 logger 整合。
  - 完成條件：log 至少包含 timestamp、level、requestId、module/context、message；error log 不包含 OpenAI API key、connector secret、database credential；tool input/output summary、evidence summary、history content 進入 log 前會被 redacted 或最小化；client error response 不洩漏 stack trace；AuditEvent metadata 與一般 log 都遵守 redaction policy，但兩者職責不混淆；secret-redaction 或 logger redaction test 覆蓋失敗路徑。
- [x] T021 在 `specs/001-internal-assistant-core/data-model-notes.md` 決定並記錄 `AssistantContextState.taskState`：新增 `waiting_confirmation` / `waiting_escalation`，或改由 `ActionDraft.status`、`ApprovalRequest.status`、`EscalationRequest.status` 承擔狀態追蹤
- [x] T022 [P] 在 `src/common/request-id/` 實作 requestId middleware/interceptor
- [x] T023 [P] 在 `src/common/response/` 與 `src/common/errors/` 實作共用 response/error envelope
- [x] T024 [P] 在 `src/common/sse/` 定義 SSE event types 與共用 streaming helpers
- [x] T025 [P] 分別在 `src/llm/`、`src/retrieval/`、`src/query-understanding/`、`src/connectors/` 定義 `LlmProvider`、`RetrievalProvider`、`TokenizerAdapter`、`ConnectorAdapter` interfaces，避免將 domain-specific interface 全部塞入 `common`
  - 說明：讓可替換 provider/adapter 靠近所屬 domain，避免 `common/` 變成雜物區，也避免 LLM、retrieval、tokenizer、business connector 互相耦合。
  - 輸出：`src/llm/llm-provider.interface.ts`、`src/retrieval/retrieval-provider.interface.ts`、`src/query-understanding/tokenizer-adapter.interface.ts`、`src/connectors/connector-adapter.interface.ts`。
  - 完成條件：`src/common/providers/` 不存在；各 interface 只暴露 domain contract；後續 provider/mock connector 能以 interface 注入測試。
- [x] T026 [P] 在 `src/llm/openai/` 建立 `OpenAiProvider` shell，實作 `LlmProvider` interface，v1 provider 由 `LLM_PROVIDER=openai` 選擇，模型由 `LLM_MODEL` 選擇，controller/service/domain logic 不得硬寫 provider 或模型名稱
  - 說明：OpenAI 是 LLM provider，不是 ERP/MES/WMS/SCM/CRM connector；provider/model 選擇必須集中在 config/provider layer。
  - 輸出：`src/llm/openai/` provider shell、provider config、測試用 mock/fake hooks。
  - 完成條件：沒有 `src/connectors/openai/`；controller/service/domain/prompt 不硬寫模型；provider 能回報 selected provider/model/fallback metadata。
- [x] T027 [P] 在 `test/unit/config-validation.spec.ts` 撰寫 env validation tests
- [x] T028 [P] 在 `src/common/config/` 實作 config validation，缺少必要 env 時回傳明確啟動錯誤
- [x] T029 [P] 在 `test/integration/secret-redaction.spec.ts` 撰寫 OpenAI credentials、connector secrets 不得出現在 structured logger、一般 log、error response、audit metadata 的測試
  - 說明：驗證所有錯誤路徑與 audit/observability metadata 都會遮罩 secret，包含 LLM 與 connector credentials。
  - 輸出：secret redaction integration spec、測試用 fake secret fixtures、logger/log/error/audit assertion helpers。
  - 完成條件：OpenAI key、connector secret、DB credential 不出現在 structured logger、一般 log、error response、AuditEvent metadata；失敗路徑也通過。
- [x] T030 [P] 在 `test/unit/identity-context-validation.spec.ts` 撰寫 `ActorContext`、`HostAppContext`、`CompanyBoundary` validation unit tests
- [x] T031 [P] 在 `test/integration/missing-identity-context.spec.ts` 撰寫缺少 actor、hostApp、organizationId、permissionScopes 或 requestId 時拒絕處理的 integration test
- [x] T032 [P] 在 `test/integration/organization-boundary.spec.ts` 撰寫不同 organization / hostApp 不可存取 session、message、history、tool result 的 integration test
- [x] T033 [P] 在 `src/identity/` 實作 `ActorContext`、`HostAppContext`、`CompanyBoundary` DTO / validator / guard 或 service
  - 說明：所有 assistant request 都必須先取得可驗證的 actor、host app、organization boundary、role、permission scope 與 requestId。
  - 輸出：identity DTO、validator/guard/service、共用錯誤型別。
  - 完成條件：session/message/history/tool/retrieval 前會先驗證 identity；缺少必要欄位會被拒絕；`AssistantContextState` 不會取代 identity check。
- [x] T034 [P] 在 `src/identity/` 實作 request-level identity context extraction，供 assistant、permissions、tools、retrieval、audit 共用
  - 說明：建立單一 request context extraction，讓權限、安全、稽核與工具執行都使用同一份身份邊界。
  - 輸出：request context extractor、typed identity context、測試 helper。
  - 完成條件：assistant、permissions、tools、retrieval、audit 皆可取得一致 context；跨 organization / hostApp 資料不可被混用。
- [x] T035 [P] 在 `src/identity/` 實作 missing or invalid identity context 的一致錯誤回應；`AssistantContextState` 不得取代 identity / permission check
  - 說明：缺少 actor、hostApp、organizationId、permissionScopes 或 requestId 時必須 fail closed。
  - 輸出：identity error mapping、response envelope integration、audit/observability metadata policy。
  - 完成條件：missing identity integration test 通過；錯誤回應一致；不先查資料再過濾。
- [x] T036 [P] 在 `src/permissions/` 實作 permission policy interfaces 與 masking utilities
  - 說明：支援 module/operation/row/field-level permission，並在資料進入 LLM input 前完成 masking/data minimization。
  - 輸出：permission policy interfaces、masking utilities、field allow/deny helpers。
  - 完成條件：未授權 tool/retrieval 不執行；未授權 row/field 不進 LLM input；部分授權只回覆可見範圍。
- [x] T037 [P] 在 `src/audit/` 實作 append-only audit writer interface
  - 說明：提供核心 runtime 的不可變稽核入口，涵蓋對話、工具、權限、evidence、LLM decision、approval、feedback。
  - 輸出：audit writer interface、append-only persistence adapter、metadata redaction hook。
  - 完成條件：AuditEvent 不可被更新覆蓋；metadata 最小化且遮罩 secret；所有安全決策與失敗路徑可追溯。
- [x] T038 [P] 在 `src/observability/` 實作 analytics-ready raw event metadata helpers，包含 `durationMs`、dependency status、noAnswerReason、permissionDeniedReason、toolFailureReason、approval/confirmation decision status
  - 說明：MVP 不做 dashboard，但必須保存後續分析所需 raw metrics / raw events。
  - 輸出：metadata helper、duration/dependency/reason enums、observability integration points。
  - 完成條件：AuditEvent、ToolCall、ExecutionPlan、AnswerDecision、EvidenceRef、FeedbackEvent、ReviewItem、ApprovalRequest、ActionDraft、RetrievalRun/Candidate 皆能帶分析欄位。
- [x] T039 [P] 在 `src/connectors/mock/` 建立 mock connector fixtures：訂單狀態、工單進度、庫存可用量、客戶/供應商歷史
- [x] T040 [P] 在 `src/query-understanding/` 建立 `QueryUnderstandingPipeline` shell、`QueryUnderstandingInput` / `QueryUnderstandingOutput` DTO、`QueryUnderstandingResult` persistence contract
  - 說明：先建立 US1/US2 可用的 query understanding contract，避免 ExecutionPlan 直接吃 raw message 導致後續重工。
  - 輸出：pipeline shell、input/output DTO、result persistence/audit contract。
  - 完成條件：pipeline output 可保存、debug、eval；至少支援 taskType、entityCandidates、candidateTools、riskLevel、confidence、clarificationNeeds、requiredEvidence。
- [x] T041 [P] 在 `src/query-understanding/` 建立最小 pass-through / rule-based placeholder，至少輸出 taskType、entityCandidates、candidateTools、riskLevel、confidence、clarificationNeeds、requiredEvidence
- [x] T042 [P] 在 `src/assistant/` 的 `ExecutionPlan` 建立流程前串接 `QueryUnderstandingPipeline` shell，確保 US1/US2 不繞過 query understanding contract
  - 說明：ExecutionPlan 必須基於 query understanding output，而不是直接由 controller 或 message handler 臨時推斷。
  - 輸出：assistant planning integration、pipeline result to ExecutionPlan mapper、測試 fake pipeline。
  - 完成條件：US1/US2 message flow 會先執行 query understanding；低信心或需澄清資訊會進入 ExecutionPlan decision；audit 可追溯 pipeline result。

**檢查點**：基礎能力已就緒，可以開始 user story 實作。

---

## 階段 3：User Story 1 - 取得有 evidence 的授權答案（優先級：P1）MVP

**目標**：授權使用者可在宿主系統中提問，系統以 SSE 回覆含 evidence refs 的答案，並保存 session/message/context/audit；使用者重新打開聊天視窗時可取得既有 session message history。

**獨立驗證方式**：使用 mock host app context 與 mock evidence/tool result 送出授權查詢後，SSE final 回覆包含 `answerDecision=answered`、evidence refs、requestId，且 audit 可追溯 permission 與 evidence；同一 actor / organization / hostApp 重新打開時可讀取 message history。

### User Story 1 測試任務

- [x] T043 [P] [US1] 在 `test/contract/assistant-sessions.contract.spec.ts` 撰寫 `POST /assistant/sessions` 與 `GET /assistant/sessions/:id` contract test
  - 說明：鎖定 session create/get 的 API envelope、requestId、identity boundary 與錯誤格式。
  - 輸出：session contract spec、成功/不存在/不可見案例。
  - 完成條件：不同 actor、host app、organization 不可取得他人 session；錯誤回應一致。
- [x] T044 [P] [US1] 在 `test/contract/assistant-messages-sse.contract.spec.ts` 撰寫 `POST /assistant/sessions/:id/messages` SSE events contract test
  - 說明：驗證送出訊息後只能以 SSE 回覆，並固定必要 event sequence 與 event metadata。
  - 輸出：SSE contract spec、event sequence assertions、final/error case fixtures。
  - 完成條件：事件包含 `tool_call_started`、`tool_call_completed`、`evidence_attached`、`answer_delta`、`final`、`error`；每個 event 含 requestId/sessionId/messageId/eventType/sequence；`final` 含完整 answerDecision。
- [x] T045 [P] [US1] 在 `test/contract/assistant-message-history.contract.spec.ts` 撰寫 `GET /assistant/sessions/:id/messages` contract test，驗證 requestId、sessionId、pagination、message order、role、answerDecision、evidence summary 與 response envelope
- [x] T046 [P] [US1] 在 `test/integration/authorized-evidence-answer.spec.ts` 撰寫授權 evidence-grounded answer integration test
- [x] T047 [P] [US1] 在 `test/integration/field-masking-before-llm.spec.ts` 撰寫未授權欄位會在進入 LLM input 前被遮罩的 integration test
- [x] T048 [P] [US1] 在 `test/unit/assistant-context-state.spec.ts` 撰寫 `AssistantContextState` 與 `PageContext` 解析的 unit tests
- [x] T049 [P] [US1] 在 `test/integration/session-history-on-open.spec.ts` 撰寫同一 actor / organization / hostApp 重新打開 AI 助理時可取得既有 session message history 的 integration test
- [x] T050 [P] [US1] 在 `test/integration/session-history-permission-boundary.spec.ts` 撰寫 session history 權限邊界測試，確認不同 actor、host app 或 organization 不可讀取他人 session history
- [x] T051 [P] [US1] 在 `test/integration/session-history-masking.spec.ts` 撰寫歷史訊息中的 evidence summary / tool summary 必須套用 masking 與資料最小化的 integration test

### User Story 1 實作任務

- [x] T052 [US1] 在 `src/assistant/` 實作 `AssistantModule`、session service、session controller
- [x] T053 [US1] 在 `src/assistant/` 實作 `POST /assistant/sessions/:id/messages` endpoint、user/assistant message persistence、SSE response orchestration、`AssistantContextState` update、final `answerDecision` 與必要 `AuditEvent`
  - 說明：接收使用者訊息後，必須驗證 identity / host app / organization boundary，載入 session/context，執行 query understanding → ExecutionPlan → permission → retrieval/tool → evidence → answer decision，並以 SSE 回傳。
  - 輸出：assistant controller/service、message persistence、SSE orchestration、context update、audit writer integration。
  - 完成條件：contract test 通過；SSE event sequence 正確；每個 event 含 requestId/sessionId/messageId/eventType/sequence；final 含 answerDecision；必要 AuditEvent 已寫入；未授權欄位不得進入 LLM input。
- [x] T054 [US1] 在 `src/assistant/` 實作 `GET /assistant/sessions/:id/messages` endpoint，支援 `limit`、`cursor`、`order=asc`、role、answerDecision、evidence summary 與 response envelope
  - 說明：用於使用者重新打開 AI 助理聊天視窗時載入既有 session history。此 endpoint 必須重新檢查 actor、host app、organization boundary 與 session ownership / visibility。
  - 輸出：assistant history endpoint、history query service、pagination cursor handling、history response DTO、history audit integration。
  - 完成條件：history contract test 通過；不同 actor / host app / organization 不可讀取他人 history；session 不存在、過期、關閉或不可見時回傳一致錯誤；evidence/tool summary 套用 masking 與 data minimization；寫入 session_history_viewed 或 session_resumed audit event。
- [x] T055 [US1] 在 `src/assistant/dto/` 實作 `PageContext` DTO validation 與儲存
  - 說明：PageContext 是解析「這筆」「這張」「目前」等指示詞的必要上下文，不可用猜測替代缺失資料。
  - 輸出：PageContext DTO、validation rules、persistence mapper。
  - 完成條件：缺少必要 page/entity context 時可觸發 clarification；不可越權引用不可見 selectedRows / filters / visibleColumns。
- [x] T056 [US1] 在 `src/assistant/` 實作 `AssistantContextState` load/update lifecycle
  - 說明：保存 current task、last intent/entities/tool calls/evidence、pending clarification/approval 與 task state，但不得承擔身份或權限檢查。
  - 輸出：context state service、load/update methods、state transition tests hooks。
  - 完成條件：message flow 會更新 context；taskState 與 ActionDraft/ApprovalRequest/EscalationRequest 狀態不互相矛盾；audit 可追溯 state 變更。
- [x] T057 [US1] 在 `src/assistant/` 實作 read-only evidence answers 使用的 `ExecutionPlan` 建立流程，並使用 Phase 2 的 `QueryUnderstandingPipeline` shell 輸出
  - 說明：建立 read-only 問答的計畫，必須在 retrieval/tool/answer generation 前決定 evidence、candidate tools、permission checks、risk 與 answer shape。
  - 輸出：ExecutionPlan builder、query-understanding mapper、plan persistence/audit integration。
  - 完成條件：ExecutionPlan 在任何資料查詢前建立；permissionChecks/riskAssessment/requiredEvidence 不可空白；低信心會導向 clarification/no-answer。
- [x] T058 [US1] 在 `src/evidence/` 實作 `EvidenceRef` normalization 與 attachment
  - 說明：將 tool result、document chunk、context state 等來源標準化成可追溯 evidence。
  - 輸出：EvidenceRef service、source normalizers、message attachment integration。
  - 完成條件：assistant final answer 可列 evidence refs；未授權 evidence 不附加；evidence summary 套用 masking/data minimization。
- [x] T059 [US1] 在 `src/assistant/` 實作 answered responses 使用的 `AnswerDecision`、`AnswerPlan`、`GroundingCheck`
  - 說明：final answer 前必須確認回答沒有超出 EvidenceRef / ToolCall result / context coverage。
  - 輸出：AnswerPlan builder、AnswerDecision mapper、GroundingCheck service。
  - 完成條件：沒有足夠 evidence 不產生確定答案；tool/document evidence 衝突時進入 clarification/no-answer/review；`final` SSE event 帶完整 answerDecision。
- [x] T060 [US1] 在 `src/common/sse/` 實作 SSE events：`tool_call_started`、`tool_call_completed`、`evidence_attached`、`answer_delta`、`final`、`error`
  - 說明：SSE 是 v1 唯一即時回答通道，所有事件必須可排序、可追蹤、可恢復錯誤語意。
  - 輸出：SSE event envelope、sequence generator、streaming helpers、error event mapper。
  - 完成條件：每個 event 含 requestId/sessionId/messageId/eventType/sequence；錯誤路徑產生 `error` event；`final` event 結束 stream 並包含 answerDecision。
- [x] T061 [US1] 在 `src/audit/` 寫入 `AuditEvent`：session created、message received、execution plan created、evidence attached、answer generated
- [x] T062 [US1] 在 `src/assistant/` 實作 session history access control，檢查 actor、host app、organization boundary、session ownership / visibility，並使用 Phase 2 identity boundary check
  - 說明：history retrieval 是 runtime API，不是後台查詢；必須與 message/tool/retrieval 使用同一套身份邊界。
  - 輸出：history access policy、session ownership/visibility checks、boundary test helpers。
  - 完成條件：不可讀取其他 actor / host app / organization 的 history；不可先讀取後再過濾；拒絕原因可 audit。
- [x] T063 [US1] 在 `src/assistant/` 實作 v1 session restore runtime behavior：host app 帶入 `sessionId` 時讀取 session summary 與 message history；session 不存在、過期、關閉或不可見時回傳一致錯誤或要求建立新 session
  - 說明：支援聊天視窗重新開啟的最小 restore strategy，不實作完整 active session auto-resolve。
  - 輸出：restore flow service、session state checks、錯誤回應 mapping。
  - 完成條件：有 sessionId 時可讀 summary/history；不存在/過期/關閉/不可見時 fail closed；不新增 `sessions/active` 或 `sessions/resolve` 產品化策略。
- [x] T064 [US1] 在 `src/audit/` 寫入 `session_history_viewed` 或 `session_resumed` audit event，metadata 必須最小化並避免敏感內容進入一般 log
  - 說明：history access 必須可追溯，但 audit 不應保存完整敏感 message content 或未遮罩 evidence。
  - 輸出：history audit event writer、metadata minimization policy。
  - 完成條件：每次 successful history retrieval 有 audit；拒絕路徑有 permissionDeniedReason；audit/log 無完整敏感內容。
- [x] T065 [US1] 在 `src/assistant/` 或 `src/permissions/` 實作 history response 的 message/evidence/tool summary masking 與資料最小化
  - 說明：歷史訊息中的 evidence/tool summary 也必須遵守目前 actor 的 field/row permission，不可因為是舊訊息就放寬。
  - 輸出：history response sanitizer、evidence/tool summary masker、DTO mapper。
  - 完成條件：history masking test 通過；敏感欄位被移除或遮罩；response 只保留聊天視窗恢復所需最小資訊。

**檢查點**：US1 可獨立運作並可 demo。

---

## 階段 4：User Story 2 - 根據權限安全調用工具（優先級：P2）

**目標**：系統在 tool execution 前檢查 actor、host app、organization boundary、role、permission scope，並只把授權資料交給 LLM。

**獨立驗證方式**：授權 tool 可執行，未授權 tool 會在執行前被拒絕，部分授權情境只回覆可見範圍，且所有 decision 都有 audit event。

### User Story 2 測試任務

- [x] T066 [P] [US2] 在 `test/unit/tool-risk-classification.spec.ts` 撰寫 risk classification 與 tool selection unit tests
- [x] T067 [P] [US2] 在 `test/unit/permission-filtering.spec.ts` 撰寫 module/operation/row/field permission filtering unit tests
- [x] T068 [P] [US2] 在 `test/integration/authorized-tool-execution.spec.ts` 撰寫使用 mock connector 的授權 tool execution integration test
- [x] T069 [P] [US2] 在 `test/integration/tool-permission-denied.spec.ts` 撰寫 tool execution 前 permission denied 的 integration test
- [x] T070 [P] [US2] 在 `test/unit/openai-provider-config.spec.ts` 撰寫 `OpenAiProvider` 依 `LLM_PROVIDER=openai` 與 `LLM_MODEL` 選擇 provider/model 的 unit test，確認實作位於 `src/llm/openai/` 且不在 `connectors/`

### User Story 2 實作任務

- [x] T071 [US2] 在 `src/tools/` 實作 `ToolDefinition` registry 與 schema validation
  - 說明：LLM 只能選擇已註冊 tool，所有 input 必須通過 schema validation，不得任意呼叫 API 或資料庫。
  - 輸出：tool registry service、ToolDefinition loader、input/output schema validator。
  - 完成條件：未註冊或 inactive tool 不可執行；schema invalid 會 fail closed；tool version 可供 audit replay。
- [x] T072 [US2] 在 `src/tools/` 實作 `ToolCall` lifecycle，包含 permission result、input summary、output summary、durationMs、executionStatus
  - 說明：ToolCall 是工具執行與 audit/analytics 的 source-of-truth raw record。
  - 輸出：ToolCall service、status transitions、summary redaction、duration tracking。
  - 完成條件：started/completed/failed/blocked 狀態可追蹤；input/output summary 不含未遮罩敏感內容；durationMs 與 failure reason 可分析。
- [x] T073 [US2] 在 `src/connectors/mock/` 實作訂單、工單、庫存、客戶/供應商查詢的 mock connector adapter execution
  - 說明：v1 用 mock business connector 驗證 structured lookup；不實作真實 ERP/MES/WMS/SCM/CRM connector。
  - 輸出：mock connector adapter、deterministic fixtures、connector result DTO。
  - 完成條件：order/work-order/inventory/customer-supplier examples 可被 tool 使用；live business data 不走 RAG/vector search；結果先進 permission/masking 再給 LLM。
- [x] T074 [US2] 在 `src/permissions/` 實作 retrieval/tool execution 前的 permission pre-checks
  - 說明：任何 retrieval 或 tool execution 前都必須先檢查 identity、host app、organization boundary、role、permission scope。
  - 輸出：permission pre-check service、deny reason mapper、audit integration。
  - 完成條件：未授權 tool 不執行；權限不足回 permission_denied；拒絕原因寫入 audit/observability metadata。
- [x] T075 [US2] 在 `src/permissions/` 實作進入 LLM input 前的 row/field masking
  - 說明：遮罩必須發生在 tool/retrieval result 交給 LLM 前，不只是在最終回答後處理。
  - 輸出：row/field masking pipeline、LLM input sanitizer、masking tests。
  - 完成條件：未授權欄位不得進 LLM input；部分授權只回答可見資料；masked fields 不出現在 prompt/debug/audit。
- [x] T076 [US2] 在 `src/llm/openai/` 實作支援 `LLM_PROVIDER=openai` 與 `LLM_MODEL` 的真實 OpenAI SDK provider layer，支援 `gpt-5.4-mini`、`gpt-5.4`、`gpt-5.4-nano`
  - 說明：provider/model 切換屬於 provider/config 責任；fallback/model selection 不得散落在業務邏輯。
  - 輸出：OpenAiProvider SDK implementation、provider registry hook、model config mapping、fallback policy hook。
  - 完成條件：`LLM_PROVIDER=openai` 可選擇 OpenAI provider，`LLM_MODEL` 可切換三種建議模型；controller/service/domain 不 hardcode provider/model；provider failure 可回 safe degradation metadata。
- [x] T077 [US2] 在 `src/audit/` 或 `src/observability/` 記錄 selected provider/model 與 fallback decision 到 audit 或 observability metadata
  - 說明：LLM provider/model/fallback 是回答品質與成本分析的重要 raw metric。
  - 輸出：provider/model metadata writer、fallback decision reason enum。
  - 完成條件：每次 LLM call 可追溯 provider/model；fallback 或 degraded 狀態有 reason；不記錄 API key 或 secret。

**檢查點**：US1 與 US2 可各自獨立運作，也能一起整合。

---

## 階段 5：User Story 3 - 高風險操作建立審核請求（優先級：P3）

**目標**：Medium-risk side effects 必須透過 `ActionDraft` 讓使用者確認；high/critical actions 必須建立 `ApprovalRequest` 或 `EscalationRequest`；confirm/approve 前不得執行 side-effect。

**獨立驗證方式**：批次更新或敏感匯出 request 不會執行 side-effect tool，只會建立 pending approval/action draft；confirm/approve 後仍會重新檢查 permission、organization boundary、tool contract、idempotency。

### User Story 3 測試任務

- [x] T078 [P] [US3] 在 `test/contract/action-drafts.contract.spec.ts` 撰寫 `GET /assistant/action-drafts/:id`、`POST /assistant/action-drafts/:id/confirm`、`POST /assistant/action-drafts/:id/cancel` contract tests
  - 說明：鎖定 medium-risk confirmation API，確認前不可執行 side-effect。
  - 輸出：ActionDraft contract spec、get/confirm/cancel 成功與錯誤 fixtures。
  - 完成條件：expired/cancelled/executed draft 不可再次 confirm；duplicate confirm 不重複執行；response envelope/requestId 一致。
- [x] T079 [P] [US3] 在 `test/contract/approval-requests.contract.spec.ts` 撰寫 approval get/list/approve/reject/cancel APIs contract tests
  - 說明：鎖定 high/critical risk approval API，approval request 不可由任意外部 API 繞過 assistant pipeline 建立。
  - 輸出：ApprovalRequest contract spec、list/get/approve/reject/cancel fixtures。
  - 完成條件：approve/reject 權限不足會拒絕；approved 後仍需 re-check；所有狀態回應一致。
- [x] T080 [P] [US3] 在 `test/integration/action-draft-confirmation.spec.ts` 撰寫 medium-risk request 建立 `ActionDraft` 且 confirm 前不執行 side-effect 的 integration test
- [x] T081 [P] [US3] 在 `test/integration/approval-request-flow.spec.ts` 撰寫 high/critical request 建立 `ApprovalRequest` 且 approve 前不執行 side-effect 的 integration test
- [x] T082 [P] [US3] 在 `test/unit/side-effect-idempotency.spec.ts` 撰寫 confirm/approve/retry duplicate-safe idempotency unit tests

### User Story 3 實作任務

- [x] T083 [US3] 在 `src/approvals/` 實作 `ActionDraft` service/controller 與 statuses
  - 說明：medium-risk side-effect 必須先建立 ActionDraft，回傳操作預覽並等待使用者本人確認。
  - 輸出：ActionDraft controller/service、status transition rules、preview/payload summary DTO。
  - 完成條件：confirm 前不得執行 side-effect；draft/waiting_confirmation/confirmed/executed/cancelled/expired/failed 狀態合法；狀態轉換寫 audit。
- [x] T084 [US3] 在 `src/approvals/` 實作 `ApprovalRequest` service/controller 與 statuses
  - 說明：high/critical risk action 必須由具審核權限者核准，不可由 requester 自行繞過。
  - 輸出：ApprovalRequest controller/service、approve/reject/cancel handlers、decision reason DTO。
  - 完成條件：approve 前不執行 side-effect；核准者身份/權限可驗證；requester/approver/risk/action/evidence/requestId 可追溯。
- [x] T085 [US3] 在 `src/approvals/` 實作 `EscalationRequest` persistence 與 creation hooks
  - 說明：需要資料 owner、系統管理員、產品維運或其他內部人員介入時，建立 escalation 而不是讓 AI 猜測處理。
  - 輸出：EscalationRequest model adapter、creation hooks、audit event integration。
  - 完成條件：escalation_required decision 可保存；關聯 session/message/requestId/evidence；不觸發 side-effect。
- [x] T086 [US3] 在 `src/tools/` 實作 side-effect execution 前的 idempotency key checks
  - 說明：前端重送、SSE 中斷、approval callback 重送或 worker retry 都不得造成重複副作用。
  - 輸出：idempotency guard、ToolCall lookup、duplicate-safe response helper。
  - 完成條件：相同 idempotencyKey 的成功或進行中操作不重複執行；重複建立/更新/匯出/通知/跨系統寫入被阻擋。
- [x] T087 [US3] 在 `src/approvals/` 實作 confirm/approve 時的 permission、organization boundary、tool active/version compatibility re-checks
  - 說明：確認或核准不代表可以直接信任先前狀態；執行 side-effect 前必須重新檢查 actor identity、organization boundary、permission scope、risk policy、tool contract、tool version、draft/request status 與 idempotencyKey。
  - 輸出：approval/action-draft execution guard、permission re-check logic、tool compatibility check、idempotency integration。
  - 完成條件：confirm/approve 前不得執行 side-effect；權限變更後會阻擋執行；相同 idempotencyKey 不會重複執行；所有 blocked / executed / failed 狀態皆寫入 AuditEvent。
- [x] T088 [US3] 在 `src/common/sse/` 實作 SSE events：`confirmation_required`、`approval_required`
  - 說明：當 medium/high/critical risk 被判定時，SSE 必須清楚告知前端需要確認或審核，而不是繼續產生一般答案。
  - 輸出：confirmation/approval SSE event DTO、actionDraftId/approvalRequestId payload mapping。
  - 完成條件：event 含 requestId/sessionId/messageId/eventType/sequence；confirmation_required 含 actionDraftId/preview/expiresAt；approval_required 含 approvalRequestId/riskLevel/action summary。
- [x] T089 [US3] 在 `src/audit/` 寫入 action draft created/confirmed/cancelled/executed/failed 與 approval created/approved/rejected/expired/cancelled audit events
  - 說明：side-effect 相關狀態轉換必須 append-only audit，供日後審計與事故追查。
  - 輸出：approval/action audit event writers、decision metadata、redaction policy。
  - 完成條件：每個狀態轉換有 AuditEvent；包含 requester/approver/risk/idempotencyKey/requestId；不保存敏感 payload 明文。

**檢查點**：US3 可獨立運作，且不破壞 US1/US2 行為。

---

## 階段 6：User Story 4 - 無權限、無證據或問題模糊時正確拒答或澄清（優先級：P4）

**目標**：問題模糊、PageContext 不足、無 evidence、tool failure、權限不足或 evidence conflict 時，系統必須 clarification/no-answer/safe error，不得編造答案。US4 深化 Phase 2 已建立的 query understanding shell，而不是第一次導入 query understanding。

**獨立驗證方式**：ambiguous query、missing PageContext、no-result、tool failure、permission denied、evidence conflict 都不得產生確定答案，且會建立 audit event 與必要的 ReviewItem。

### User Story 4 測試任務

- [x] T090 [P] [US4] 在 `test/unit/chinese-tokenizer.spec.ts` 撰寫繁體中文斷句、斷詞、片語抽取 unit tests
  - 說明：驗證中文 query understanding 的基本解析能力，包含多句、多條件與業務片語。
  - 輸出：繁中斷句/斷詞/片語抽取測試資料。
  - 完成條件：常見 ERP/MES/WMS/SCM/CRM 詞句可被穩定切分；tokenizer 仍可替換，不綁死單一 package。
- [x] T091 [P] [US4] 在 `test/unit/query-normalization.spec.ts` 撰寫 domain term normalization 與 time range parsing unit tests
  - 說明：驗證企業術語與時間語意 normalization，避免「工單/製令」「料號/品號」「上週/近三個月」解析不一致。
  - 輸出：normalization/time range parser unit specs。
  - 完成條件：同義詞映射與時間範圍可追溯；低信心或衝突會產生 clarificationNeeds。
- [x] T092 [P] [US4] 在 `test/unit/deixis-resolution.spec.ts` 撰寫缺少或具備足夠 `PageContext` 時的 deixis resolution unit tests
  - 說明：驗證「這筆」「這張」「目前」「剛剛選取」必須依 PageContext / AssistantContextState 解析，不足時不得猜測。
  - 輸出：deixis resolution unit specs、PageContext fixtures。
  - 完成條件：缺少 PageContext 時進入 clarification；多候選衝突時不直接選一筆。
- [X] T093 [P] [US4] 在 `test/integration/clarification-required.spec.ts` 撰寫 ambiguous query clarification integration test
- [X] T094 [P] [US4] 在 `test/integration/no-answer-review-item.spec.ts` 撰寫 no evidence/no-answer 與 ReviewItem creation integration test
- [X] T095 [P] [US4] 在 `test/integration/tool-failure-safe-response.spec.ts` 撰寫 tool failure safe response integration test
- [ ] T096 [P] [US4] 在 `test/eval/internal-assistant-core.eval.spec.ts` 撰寫 tool routing accuracy、no-answer precision、entity extraction、evidence coverage eval tests
- [ ] T097 [P] [US4] 在 `test/contract/feedback.contract.spec.ts` 撰寫 `POST /assistant/messages/:messageId/feedback` contract test，驗證 requestId、rating、reason、comment、messageId、response envelope、錯誤格式
- [ ] T098 [P] [US4] 在 `test/contract/review-items.contract.spec.ts` 撰寫 `GET /assistant/review-items` contract test，驗證 list/filter/status、requestId、response envelope
- [ ] T099 [P] [US4] 在 `test/integration/feedback-review-linkage.spec.ts` 撰寫負評建立 `FeedbackEvent` 並關聯 requestId、messageId、toolCallIds、evidenceRefIds、answerDecision、`AuditEvent` 的 integration test
- [ ] T100 [P] [US4] 在 `test/integration/rag-sop-field-explanation.spec.ts` 撰寫 SOP / 欄位說明查詢使用 `KnowledgeDocument` / `KnowledgeChunk` retrieval 並回傳 `EvidenceRef` 的 integration test
- [ ] T101 [P] [US4] 在 `test/unit/knowledge-chunking.spec.ts` 撰寫 `KnowledgeDocument` chunking placeholder unit test
- [ ] T102 [P] [US4] 在 `test/integration/retrieval-run-candidates.spec.ts` 撰寫 `RetrievalRun` / `RetrievalCandidate` 或等價 `AuditEvent.metadata` 的 observability test

### User Story 4 實作任務

- [x] T103 [US4] 在 `src/query-understanding/` 深化 `QueryUnderstandingPipeline` orchestration，沿用 Phase 2 input/output contract
  - 說明：US4 深化既有 pipeline，不重新繞過 Phase 2 contract；結果必須可保存、debug、eval。
  - 輸出：pipeline orchestration、debug/eval metadata、result persistence integration。
  - 完成條件：query understanding 在 ExecutionPlan 前執行；output 包含 normalized terms、entity candidates、subTasks、confidence、clarificationNeeds。
- [x] T104 [US4] 在 `src/query-understanding/` 深化 `TokenizerAdapter` 預設 adapter placeholder，保持可替換，不綁定 jieba
  - 說明：提供 MVP 可用 tokenizer placeholder，同時保留未來替換 jieba/CKIP/HanLP 的 adapter 邊界。
  - 輸出：default tokenizer adapter、adapter registration、測試 fake adapter。
  - 完成條件：沒有把產品能力綁死單一 package；adapter output 可被 phrase/entity/time/deixis 模組消費。
- [x] T105 [US4] 在 `src/query-understanding/` 實作 sentence splitting、phrase extraction、domain term normalization、time range parsing
  - 說明：將 raw message 轉成可規劃的語意結構，支援文件問題與 structured lookup 問題。
  - 輸出：sentence splitter、phrase extractor、domain lexicon normalizer、time range parser。
  - 完成條件：繁中 eval cases 通過；解析失敗或低信心會帶 clarificationNeeds；結果寫入 audit/debug metadata。
- [x] T106 [US4] 在 `src/query-understanding/` 實作使用 `PageContext` 與 `AssistantContextState` 的 deixis resolver
  - 說明：解析指示詞時必須使用頁面狀態與上下文，不得自行猜測目前資料。
  - 輸出：deixis resolver、resolvedReferences DTO、conflict/insufficient-context handling。
  - 完成條件：PageContext 不足時 clarification；多 selectedRows 需明確候選；解析結果可被 ExecutionPlan 使用。
- [x] T107 [US4] 在 `src/query-understanding/` 實作 entity candidate extraction 與 multi-intent decomposition
  - 說明：抽取 orderId、workOrderId、itemNo、customerId、date range 等候選，並將複合問題拆成可執行子任務。
  - 輸出：entity extractor、query decomposer、subTask DTO。
  - 完成條件：多意圖不被塞成單一 tool call；衝突候選會要求澄清；結果可供 tool routing/eval。
- [x] T108 [US4] 在 `src/query-understanding/` 實作 confidence scoring 與 clarificationNeeds generation
  - 說明：建立低信心與上下文不足時的安全閘門，避免因模糊問題產生假答案。
  - 輸出：confidence scorer、clarification need rules、threshold config。
  - 完成條件：low confidence、missing context、candidate conflict 會觸發 clarification；score/reason 可 audit/eval。
- [X] T109 [US4] 在 `src/assistant/` 實作 no-answer / clarification gate 與 `ClarificationQuestion` persistence
  - 說明：無 evidence、low confidence、tool failure、permission denied、evidence conflict 或 unsupported scope 時不得編造答案。
  - 輸出：no-answer gate、ClarificationQuestion persistence、AnswerDecision mapping。
  - 完成條件：no-answer/clarification integration tests 通過；NoAnswerReason 可追溯；必要時建立 ReviewItem。
- [ ] T110 [US4] 在 `src/retrieval/` 實作 `RetrievalProvider` interface 與 MVP retrieval service shell
  - 說明：文件型知識走 RAG/document retrieval，live business data 仍走 structured lookup / connector。
  - 輸出：retrieval service shell、provider adapter、strategy enum。
  - 完成條件：RAG 與 connector 路徑清楚分離；無 retrieval result 時可產生 noAnswerReason；可記錄 RetrievalRun。
- [ ] T111 [US4] 在 `src/retrieval/` 實作 `KnowledgeDocument` / `KnowledgeChunk` seed fixtures，至少支援 SOP、policy、field_guide 或 manual 類文件
  - 說明：MVP 不需正式 vector DB，但必須有文件知識可進入 retrieval 最小閉環。
  - 輸出：seed fixtures、document/chunk sample data、eval labels。
  - 完成條件：SOP/field explanation 測試可命中文件 chunk；fixtures 不包含 live business transaction data。
- [ ] T112 [US4] 在 `src/retrieval/` 實作 MVP chunking placeholder，能從 seed document 產生 `KnowledgeChunk`
  - 說明：沒有 ingestion/chunking/indexing，RAG 表只是空殼；MVP 至少要 deterministic chunking。
  - 輸出：chunking placeholder、chunk metadata、chunkIndex/tokenCount handling。
  - 完成條件：seed document 可產生 chunk；re-run 不產生不可控重複；chunk 可成為 EvidenceRef source。
- [ ] T113 [US4] 在 `src/retrieval/` 實作 keyword、mock-vector 或 deterministic fixture retrieval，讓文件型問題可取得 chunk-level `EvidenceRef`
  - 說明：先用 keyword/mock-vector/deterministic retrieval 驗證 evidence pipeline，不要求正式向量資料庫。
  - 輸出：MVP retrieval implementation、ranking/selection reason、chunk-level evidence mapping。
  - 完成條件：SOP/欄位說明問題回傳 document_chunk EvidenceRef；no result 進 no-answer；不可用 RAG 回答 live business data。
- [ ] T114 [US4] 在 `src/retrieval/` 實作 `RetrievalRun` / `RetrievalCandidate` persistence，或明確使用等價 `AuditEvent.metadata`
  - 說明：retrieval 可觀測性是 debug、eval、review item 的必要資料。
  - 輸出：RetrievalRun/Candidate persistence 或 audit metadata schema、selected/rejected candidate reasons。
  - 完成條件：query、normalizedQuery、filters、strategy、scores、rank、selectedEvidenceRefIds、noAnswerReason、durationMs 可追溯。
- [ ] T115 [US4] 在 `src/evidence/` 串接 document_chunk `EvidenceRef` normalization
  - 說明：RAG retrieval result 必須轉成標準 EvidenceRef，讓 AnswerPlan/GroundingCheck/audit 使用同一格式。
  - 輸出：document_chunk evidence normalizer、source metadata mapper。
  - 完成條件：EvidenceRef 可追溯 documentId/chunkId/sourceType/rank；未授權或 disabled chunk 不可附加。
- [ ] T116 [US4] 在 `src/feedback/` 實作 `FeedbackEvent` service/controller，提供 `POST /assistant/messages/:messageId/feedback`
  - 說明：message-level feedback 必須關聯 requestId、messageId、answerDecision、tool/evidence/audit context。
  - 輸出：feedback controller/service、FeedbackEvent DTO、access control checks。
  - 完成條件：feedback contract test 通過；不可對不可見 message 留 feedback；feedback_received audit event 已寫入。
- [ ] T117 [US4] 在 `src/feedback/` 實作 `ReviewItem` query service/controller，提供 `GET /assistant/review-items`
  - 說明：提供 MVP runtime review raw data 查詢 contract，不是完整後台管理 UI/CRUD。
  - 輸出：ReviewItem query controller/service、filter/status DTO、response envelope。
  - 完成條件：review item contract test 通過；查詢受 identity/organization boundary 限制；response 不外洩敏感 evidence/tool payload。
- [ ] T118 [US4] 在 `src/feedback/` 實作 `FeedbackEvent` → `ReviewItem` creation policy：negative 或 actionable feedback 可建立 `ReviewItem`
  - 說明：把負評或可行動回饋轉成可追蹤改善項目，支援後續產品化改善 loop。
  - 輸出：review creation policy、linkage mapper、audit writer integration。
  - 完成條件：negative/actionable feedback 會建立 ReviewItem；ReviewItem 關聯 requestId/messageId/toolCallIds/evidenceRefIds/answerDecision/AuditEvent。
- [X] T119 [US4] 在 `src/feedback/` 實作從 failed query、no-answer、tool failure、missing evidence、bad routing、permission mapping issue、evidence conflict 建立 `ReviewItem`
  - 說明：系統失敗或不確定狀態應可進入改善佇列，而不是靜默消失。
  - 輸出：ReviewItem creation hooks、failure reason mapping、dedupe policy。
  - 完成條件：no-answer/tool failure/evidence conflict cases 可建立 ReviewItem；不建立重複噪音；audit 可追溯來源。
- [ ] T120 [US4] 在 `src/audit/` 寫入 `feedback_received`、`review_item_created`、`review_item_resolved` audit events
  - 說明：feedback/review lifecycle 必須可追溯，且不得保存未遮罩敏感內容。
  - 輸出：feedback/review audit event writers、metadata minimization rules。
  - 完成條件：feedback/review 狀態變更皆有 AuditEvent；metadata 關聯原始 request/message/tool/evidence；secret 與敏感 payload 不進 audit。

**檢查點**：所有 user stories 都可獨立運作。

---

## 階段 7：潤飾與跨領域品質補強

**目的**：補齊品質門檻、文件與非功能驗證。

- [ ] T121 [P] 在 `test/contract/health-readiness.contract.spec.ts` 撰寫 health/readiness/dependency status contract test，驗證 database、LLM、retrieval、connector、approval workflow、degraded status reason、requestId / response envelope、錯誤格式
  - 說明：鎖定 health/readiness API contract，讓 local Docker 與後續部署都能判斷依賴狀態。
  - 輸出：health/readiness contract spec、dependency status fixtures、degraded/error response assertions。
  - 完成條件：dependency status 至少包含 database、LLM、retrieval、connector、approval workflow；degraded 有 reason；response envelope/requestId 一致。
- [ ] T122 [P] 在 `src/observability/` 新增 LLM、retrieval、database、connector、approval workflow 的 health/readiness/dependency status endpoints
  - 說明：提供 dependency health 的 runtime 查詢，不暴露 secret 或過度詳細內部設定。
  - 輸出：health/readiness controller/service、dependency probes、safe degradation mapper。
  - 完成條件：DB/LLM/retrieval/connector/approval workflow 可各自回報 healthy/degraded/unavailable；錯誤不含 secret；可供 Docker smoke test 使用。
- [ ] T123 [P] 在 `test/integration/analytics-ready-raw-events.spec.ts` 新增 analytics-ready raw event validation，涵蓋 `AuditEvent`、`ToolCall`、`ExecutionPlan`、`AnswerDecision`、`EvidenceRef`、`FeedbackEvent`、`ReviewItem`、`ApprovalRequest`、`ActionDraft`、`RetrievalRun` / `RetrievalCandidate`
  - 說明：MVP 不做 dashboard，但必須先保存可分析原始事件，避免後續產品化重構核心 runtime 紀錄。
  - 輸出：raw event integration spec、event completeness assertions、metadata redaction checks。
  - 完成條件：所有核心 raw records 可透過 requestId/messageId/toolCallId/evidenceRefId 關聯；duration/reason/status 欄位完整；無敏感 payload 明文。
- [ ] T124 [P] 在 `test/e2e/non-functional.e2e-spec.ts` 新增 dependency degradation、SSE timeout/interruption、bounded retry、queue/backpressure assumptions 的 non-functional tests
  - 說明：驗證依賴失敗、串流中斷與重試不會造成不安全回答或重複 side-effect。
  - 輸出：non-functional e2e spec、degradation fixtures、SSE interruption fixtures。
  - 完成條件：SSE timeout/interruption 有安全 error/final 行為；bounded retry 不重複 side-effect；queue/backpressure 假設有測試或明確文件。
- [ ] T125 [P] 在 `README.md` 新增 local mock connector、RAG seed fixtures 與 SSE smoke testing 的 quickstart-style instructions
- [ ] T126 [P] 在 `test/e2e/docker-local-dev.e2e-spec.ts` 或 README smoke checklist 新增 Docker local dev 驗證：`docker compose up` 可啟動 app dependencies、app 可連線 database、health/readiness 可回報 database dependency status、SSE smoke test 可在 local Docker baseline 下執行
  - 說明：Docker Compose 只驗證 local dev/test baseline，不延伸成 production deployment 設計。
  - 輸出：Docker smoke e2e 或 README checklist、Prisma migration/test DB init command、SSE smoke steps。
  - 完成條件：`docker compose up` 可啟動 app/postgres；app 可連 DB；health/readiness 回報 database；SSE smoke 可執行；Redis 仍為 optional/profile-based。
- [ ] T127 [P] 在 `specs/001-internal-assistant-core/tasks.md` 新增 regression checklist，確認 v1 範圍不包含完整 admin UI/CRUD、taxonomy/settings management UI、真實 ERP/MES/WMS/SCM/CRM connector、frontend SDK/widget、active session auto-resolve 完整產品化策略、production deployment / Kubernetes / Helm / CI/CD
  - 說明：防止 MVP scope creep，確保核心 runtime、安全閉環、mock connector validation 優先。
  - 輸出：regression/scope checklist。
  - 完成條件：每次交付前可檢查未新增 out-of-scope feature；runtime records/query contracts 不被誤刪。
- [ ] T128 依專案 scripts 執行完整驗證：unit、integration、contract、e2e、eval、lint/build/typecheck
  - 說明：最後驗證必須覆蓋功能、合約、安全、eval 與非功能門檻。
  - 輸出：final validation script 或 checklist、migration/seed/test DB 執行紀錄、測試執行紀錄。
  - 完成條件：Prisma migration、seed、test DB reset 可執行；unit/integration/contract/e2e/eval/lint/build/typecheck 可執行；若有環境限制需標註原因；不得略過安全、SSE、RAG、approval、audit、history、feedback/review 測試。

---

## 相依性與執行順序

### 階段相依性

- **階段 1 專案初始化**：沒有相依任務。
- **階段 2 基礎能力**：依賴階段 1，並阻塞所有 user stories。
- **階段 3 US1**：依賴階段 2，是 MVP path。
- **階段 4 US2**：依賴階段 2，會與 US1 整合，但仍需可獨立測試。
- **階段 5 US3**：依賴階段 2 與 tool/risk 基礎，可在 US2 tool registry 基礎完成後推進。
- **階段 6 US4**：依賴階段 2；Phase 2 已提供 query understanding shell，US4 負責深化 no-answer / clarification quality gate。
- **階段 7 潤飾**：依賴選定 user stories 完成後執行。

### User Story 相依性

- **US1（P1）**：foundation 完成後，不依賴其他 user stories。
- **US2（P2）**：使用 US1 的 session/message/history 與 audit 基礎，但可用 mock session context 獨立測試。
- **US3（P3）**：使用 tool/risk/idempotency 基礎，可透過 ActionDraft/ApprovalRequest APIs 獨立測試。
- **US4（P4）**：使用 Phase 2 query shell、context/evidence/retrieval 基礎，可透過 mock retrieval/tool failures 獨立測試。

### 可平行執行的任務

- 專案初始化任務 T002-T014 可平行執行。
- 基礎能力任務 T018-T042 可在 schema、DB 與 logger ownership 明確後分工執行。
- 每個 user story 中標記 `[P]` 的測試可平行撰寫。
- 階段 2 完成後，US2、US3、US4 可平行推進，並以整合檢查點避免 contract drift。

---

## 實作策略

### MVP 優先

1. 完成階段 1 與階段 2。
2. 完成 US1，包含 session create/get、message SSE、message history retrieval、identity boundary、audit traceability。
3. 驗證授權 evidence answer 可透過 SSE 回覆，且重新打開聊天視窗可讀取 history。
4. 使用 mock host app context 與 Docker Compose local baseline 進行 demo。

### 漸進交付

1. 加入 US2，完成 permission-aware tool execution 與 `src/llm/openai/` provider config。
2. 加入 US3，完成 confirmation/approval safety loop。
3. 加入 US4，完成 query understanding 深化、RAG 最小閉環、feedback/review、no-answer/clarification quality gate。
4. 完成階段 7 的 health/readiness、observability、Docker local dev smoke、raw event validation 與 non-functional checks。

### 不可妥協的檢查項

- 每個 story 都必須先撰寫測試任務，再進入實作任務。
- Docker Compose 只作為 local dev/test baseline，不代表 production deployment。
- Identity validation 必須發生在 session/message/history/tool/retrieval 前。
- `AssistantContextState` 不得取代 identity / permission check。
- Query understanding 必須在 `ExecutionPlan` 前執行；US1/US2 使用 shell，US4 做深化。
- 任何 side-effect tool 在 confirmation 或 approval 前不得執行。
- 未授權欄位不得進入 LLM input。
- `OpenAiProvider` 必須位於 `src/llm/openai/`，不屬於 `connectors/`。
- provider/model 選擇必須透過 config/provider layer 從 `LLM_PROVIDER` / `LLM_MODEL` 取得。
- `.env` 不得 commit，OpenAI API key / connector secrets 不得進入 README、fixtures、audit metadata、error log。
- 所有 DB access 必須透過 `PrismaService` 注入，不得散落 `new PrismaClient()`。
- Prisma migration / seed / test database baseline 必須可在 local dev/test 重複執行，且 seed 不得含真實客戶資料或 secret。
- 一般 structured log 與 append-only AuditEvent 職責必須分開，但都要遵守 redaction policy。
- 即使 dashboard 與 admin UI 不在範圍內，也必須保存 runtime records 與 analytics-ready raw events。

## 關鍵驗收任務

以下任務為本期 MVP 最重要的驗收節點，必須全部通過才可宣告 MVP 完成。

| 任務範圍                                                                          | 驗收標準                                                                                                                                                                                                                                                                                        | 對應核心需求                                                                    |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Phase 2 foundation                                                                | PrismaService 注入與 migration/seed/test DB baseline 可用；identity / host app / organization boundary 在 session/message/history/tool/retrieval 前執行；config/env/secret/logger redaction 通過；provider interfaces 位於各自 domain；QueryUnderstandingPipeline shell 在 ExecutionPlan 前串接 | DB access layer、安全邊界、provider 抽象、query understanding 前置、secret 保護 |
| US1 session/message/SSE/history/evidence answer                                   | session create/get、message SSE、history retrieval、PageContext、AssistantContextState、ExecutionPlan、EvidenceRef、AnswerDecision/GroundingCheck 可獨立通過；SSE event metadata 完整；history masking 與 audit 通過                                                                            | 即時回答、聊天歷史、evidence-grounded answer、audit traceability                |
| US2 permission-aware tool execution / masking before LLM                          | tool execution 前完成 identity/permission/organization boundary check；未授權 tool 不執行；connector result 先 row/field masking 再進 LLM；OpenAiProvider 位於 `src/llm/openai/` 且 provider/model 由 `LLM_PROVIDER` / `LLM_MODEL` 控制                                                         | Tool-first、權限不可繞過、LLM provider 管理                                     |
| US3 ActionDraft / ApprovalRequest / idempotency                                   | medium-risk 建立 ActionDraft 並等待使用者確認；high/critical 建立 ApprovalRequest 或 EscalationRequest；confirm/approve 前不執行 side-effect；idempotency 防止重複執行；所有狀態 append-only audit                                                                                              | Side-effect safety、approval workflow、idempotency、audit                       |
| US4 no-answer / clarification / RAG / feedback-review                             | 中文理解可保存/debug/eval；PageContext 不足會澄清；無 evidence/low confidence/tool failure/permission denied/evidence conflict 不編造；文件知識走 RAG；live business data 走 connector；FeedbackEvent 可建立 ReviewItem                                                                         | No-answer gate、RAG 最小閉環、改善 loop                                         |
| Phase 7 health/readiness / analytics-ready raw events / non-functional validation | dependency status 包含 database、LLM、retrieval、connector、approval workflow；degraded 有 reason；SSE timeout/interruption 與 bounded retry 有測試；analytics-ready raw events 完整；Docker local smoke 與 final validation 可執行                                                             | 可用性、可觀測性、非功能品質、local dev baseline                                |
