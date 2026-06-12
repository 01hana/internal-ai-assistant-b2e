# Implementation Plan: 內部後台 AI 助理核心

**Branch**: `001-internal-assistant-core` | **Date**: 2026-06-11 | **Spec**: [`./spec.md`](./spec.md)

**Input**: Feature specification from `/specs/001-internal-assistant-core/spec.md`

**Note**: This plan follows `.specify/templates/plan-template.md` and is aligned with [`design.md`](./design.md). It does not create implementation tasks or code.

## Summary

本計畫定義 `ai-assistant.com` v1 內部後台 AI 助理核心後端的實作方向。v1 目標是建立可嵌入 ERP / MES / WMS / SCM / CRM 的核心 API 與 domain pipeline，支援 session/message、SSE 即時回覆、`PageContext`、`AssistantContextState`、繁體中文 query understanding、`ExecutionPlan`、tool-first 查詢、RAG/evidence、permission filtering、medium-risk confirmation、high-risk approval、append-only audit、feedback/review loop。

本計畫不實作完整後台管理 domain、管理 UI、taxonomy/settings CRUD、analytics dashboard、完整營運報表、真實 ERP / MES / WMS / SCM / CRM connector 或前端 SDK/widget UI。v1 使用 mock connector 驗證核心流程；LLM 預設使用 `OpenAiProvider`，實作位置為 `src/llm/openai/`，並透過可替換 `LlmProvider`、`RetrievalProvider`、`TokenizerAdapter`、`ConnectorAdapter` 保留產品化擴充空間。

MVP 不做完整 dashboard，但必須先保存可分析的原始事件，避免後續產品化時需要重構核心 runtime 紀錄。Runtime 必需 records、audit、feedback/review、approval/action draft、tool/evidence records 必須保存，並保留 internal read/debug/review contract 或後續擴充空間。

## Technical Context

**Language/Version**: TypeScript

**Primary Dependencies**: NestJS、Prisma、Jest；v1 LLM provider 預設為 `OpenAiProvider`，但 LLM / Retrieval / Tokenizer / Connector 仍以 adapter interface 抽象；tokenizer 不在 v1 綁定單一 package

**Storage**: PostgreSQL + Prisma；audit event 採 append-only model；context、evidence、permission snapshot 可使用 JSON 欄位但核心關聯必須可查詢

**Local Development Environment**: 本地開發與測試 baseline 使用 Docker Compose。Local services 至少包含 `app`（NestJS backend local dev service）與 `postgres`（Prisma migrations/tests 使用的 PostgreSQL）；`redis` 僅作為 queue/backpressure/rate limit 的 optional profile，MVP 未使用時可不啟用。Docker Compose 僅代表 local dev/test baseline，不代表 production deployment 規格。

**Testing**: Jest unit/integration/contract tests、e2e tests、regression/eval dataset；需覆蓋權限拒絕、工具失敗、no-answer、審核拒絕、SSE 中斷與 idempotency

**Target Platform**: Backend web service，可被 ERP / MES / WMS / SCM / CRM 等宿主系統嵌入呼叫

**Project Type**: NestJS backend service

**Performance Goals**: v1 設計需支援同時大量內部使用者請求，並預留 queue、backpressure、rate limit、SSE timeout、per-host-app resource isolation；正式數值門檻由後續 implementation/eval 階段以壓測基準固定

**Constraints**: AI 回覆即時輸出只採 SSE，不採 WebSocket；所有 retrieval/tool 前必須完成 actor、host app、company/organization boundary、role、permission scope 檢查；未授權欄位不得進入 LLM input；side-effect execution 必須使用 idempotency key；模型必須透過 `LLM_MODEL` 環境變數切換，不得硬寫死在業務邏輯

**Scale/Scope**: v1 core API + mock connector validation；不實作真實 ERP / MES / WMS / SCM / CRM connector，不實作前端 SDK/widget UI，不實作完整後台管理 domain、管理 UI、taxonomy/settings CRUD、analytics dashboard 或完整營運報表；但 runtime core records、audit、feedback/review、approval/confirmation、tool/evidence records 必須持久化

**LLM Model Defaults**: 主力/demo 使用 `gpt-5.4-mini`；高品質測試使用 `gpt-5.4`；廉價快速/fallback 使用 `gpt-5.4-nano`。若 `LLM_MODEL` 未設定，建議由 config/provider 層預設為 `gpt-5.4-mini`。

**Analytics-ready Raw Events**: MVP 必須保存或可追蹤 `AuditEvent`、`ToolCall`、`ExecutionPlan`、`AnswerDecision`、`EvidenceRef`、`FeedbackEvent`、`ReviewItem`、`ApprovalRequest`、`ActionDraft`、`RetrievalRun` / `RetrievalCandidate` 或等價 audit metadata、dependency status、durationMs、noAnswerReason、permissionDeniedReason、toolFailureReason、approval / confirmation decision status。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **C1 可維護架構優先**: PASS。設計採 NestJS module/service/domain 分層，controller 只負責 DTO 與 response；核心 bounded contexts 包含 assistant、query-understanding、identity、permissions、tools、connectors、retrieval、evidence、approvals、audit、feedback、observability、common。
- **C2 測試先行與可回歸**: PASS。計畫要求 unit、integration、contract、e2e、regression/eval、non-functional tests，且需覆蓋權限拒絕、tool failure、no-answer、審核拒絕、SSE interruption、side-effect idempotency 等失敗路徑。
- **C3 安全與權限不可繞過**: PASS。所有 retrieval、structured lookup、tool execution 前必須檢查 actor、host app、company/organization boundary、role、permission scope；未授權欄位必須在送入 LLM 前移除或遮罩。
- **C4 API 一致性與可嵌入性**: PASS。REST/SSE contract 必須包含一致 requestId、error format、eventType、sessionId、messageId、sequence；核心 API 不耦合特定宿主系統資料模型。
- **C5 RAG 與工具品質可衡量**: PASS。文件知識使用 RAG；訂單、庫存、工單、客戶、供應商、報價、交易等 live business data 使用 structured lookup / connector；回答必須有 evidence 或進入 no-answer / clarification。
- **C6 全鏈路可稽核**: PASS。對話、tool selection、permission decision、tool result、RAG evidence、LLM decision、approval、confirmation、feedback、review 都必須寫入 append-only audit event。
- **C7 人工介入與主管審核**: PASS。Medium risk 透過 `ActionDraft` confirmation；high/critical risk 透過 `ApprovalRequest` / `EscalationRequest`；確認或核准前不得執行 side-effect tool。

**Post-Design Re-check**: PASS。現有 `design.md` 已定義 API contract、data model、SSE event、permission/masking、idempotency、RAG/structured lookup、answer decision、test strategy 與 MVP scope，未發現憲章違規。

## Project Structure

### Documentation (this feature)

```text
specs/001-internal-assistant-core/
├── spec.md               # 已建立：功能規格
├── design.md             # 已建立：技術設計
├── plan.md               # 本文件：實作計畫
├── research.md           # 後續 Phase 0 可產生
├── data-model.md         # 後續 Phase 1 可產生
├── quickstart.md         # 後續 Phase 1 可產生
├── contracts/            # 後續 Phase 1 可產生
└── tasks.md              # 已建立：實作任務清單
```

### Source Code (repository root)

```text
src/
├── assistant/             # session、message、context state、execution orchestration
├── query-understanding/   # 繁中斷句、分詞、術語 normalization、時間/代詞/多意圖解析
├── identity/              # actor context、host app context、company/organization boundary
├── permissions/           # module/operation/row/field permission、masking、output filtering
├── tools/                 # tool registry、tool execution、risk classification
├── connectors/            # ERP/MES/WMS/SCM/CRM connector adapter contract、mock business connectors
├── llm/                   # LlmProvider interface、OpenAiProvider adapter、model config
│   └── openai/            # OpenAiProvider implementation
├── retrieval/             # RAG provider、document knowledge retrieval、reranking/no-answer gate
├── evidence/              # EvidenceRef normalization、citation/evidence coverage
├── approvals/             # ActionDraft、ApprovalRequest、EscalationRequest
├── audit/                 # append-only audit event、requestId traceability
├── feedback/              # FeedbackEvent、ReviewItem、AI-assisted improvement suggestions
├── observability/         # health/readiness/dependency status、metrics、alerts
└── common/                # config、errors、request-id、response envelope、SSE shared helpers

test/
├── unit/
├── integration/
├── contract/
├── e2e/
└── eval/
```

**Structure Decision**: 採單一 NestJS backend service。宿主系統差異放在 `connectors/` adapter；LLM provider 獨立放在 `llm/`，不放入企業系統 connector；retrieval、tokenizer、connector provider interfaces 靠近各自 domain。v1 不建立 frontend、SDK、widget UI、完整後台管理 UI 或完整 CRUD，但 runtime core records、audit、feedback/review、approval/confirmation、tool/evidence records 必須持久化。

## Implementation Phases

### Phase 0 Research

- 確認 NestJS module boundaries 與 provider injection pattern。
- 決定 Prisma schema 分層策略，涵蓋 session/message/context、tool/evidence、approval/action draft、audit、feedback/review、RAG document/chunk、retrieval observability。
- 固定 SSE event contract、error/requestId envelope、stream interruption 行為。
- 固定 `OpenAiProvider` 預設實作於 `src/llm/openai/`，並固定 `LlmProvider`、`RetrievalProvider`、`TokenizerAdapter`、`ConnectorAdapter` interface 邊界：interfaces 必須靠近各自 domain，不集中塞入 `common/`。
- 固定 `LLM_MODEL` env config 與模型切換策略，確認 model name 不出現在 controller/service/domain 業務邏輯中。
- 固定 `.env.example`、config validation 與 secret redaction 策略，確保 OpenAI API key、connector secrets 不進 README、fixtures、一般 log、error response 或 audit metadata。
- 固定 Docker Compose local dev/test baseline：`app`、`postgres`、optional/profile-based `redis`；`.env.example` 必須包含 Docker Compose 所需的 `DATABASE_URL`、`POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`LLM_MODEL`、OpenAI key placeholder。
- 固定 Prisma migration、seed 與 test database initialization 在容器環境中的執行方式。
- 定義 mock connector fixtures：order status、work order progress、inventory availability、customer/supplier history。
- 定義 audit event strategy：append-only、敏感資料遮罩、metadata 最小化、requestId traceability。

### Phase 1 Design Artifacts

- 產生 `data-model.md`：補完整資料模型、關聯、索引、idempotency key 與 JSON 欄位策略；必須確認 `AssistantContextState.taskState` 是否需要擴充為 `idle | planning | waiting_clarification | waiting_confirmation | waiting_approval | waiting_escalation | completed | failed`。
- `data-model.md` 必須說明 message ordering、pagination cursor、session ownership / visibility、session history retrieval audit event，以及 session 不存在、過期、關閉或不可見時的錯誤語意。
- `data-model.md` 必須說明 `waiting_confirmation` 用於 medium-risk `ActionDraft` 等待使用者本人確認，`waiting_approval` 用於 high/critical risk `ApprovalRequest` 等待具審核權限者核准，`waiting_escalation` 用於需要資料 owner、系統管理員、產品維運或其他內部人員介入的狀況。若 implementation phase 決定不新增這些狀態，必須說明由 `ActionDraft.status`、`ApprovalRequest.status` 或 `EscalationRequest.status` 承擔狀態追蹤，避免重複狀態來源。
- 產生 `contracts/`：session/message SSE、session message history、approval requests、action drafts、feedback/review、health/readiness、error/requestId contract。
- 產生 `quickstart.md`：Docker Compose 本地啟動、Prisma migration/seed/test database initialization、mock connector、SSE 測試、基本查詢、confirmation/approval flow。
- 產生 eval dataset outline：繁中 query understanding、tool routing、no-answer、evidence coverage、permission denial。

### Phase 2 Implementation Planning

- 拆分 tasks：Docker local dev baseline、session/message、session message history retrieval、identity context validation、query understanding shell、context state、PageContext、ExecutionPlan、permission/masking、tool registry/execution、mock connectors、RAG ingestion/retrieval minimum loop、retrieval logs、answer decision/no-answer、ActionDraft、ApprovalRequest、feedback/review APIs、audit、observability、tests。
- Tasks 必須包含 `GET /assistant/sessions/:id/messages` 的 contract test、integration tests 與 implementation task；v1 不強制 active session auto-resolve，先採 host app / frontend 保存 `sessionId` 的 restore strategy。
- Tasks 必須確保 `QueryUnderstandingPipeline` shell 在 US1/US2 可用，完整繁中斷句、tokenization、normalization、time range、deixis、多意圖與 confidence scoring 可在 US4 深化。
- 每個 task 必須包含對應測試或驗收：權限、audit、API contract、RAG/tool 品質、high-risk approval 或 medium-risk confirmation。

### Phase 3 Validation

- 執行 unit、integration、contract、e2e、regression/eval、non-functional checks。
- 驗證 SSE-only streaming、permission before tool/retrieval、unauthorized field never reaches LLM、side-effect idempotency、confirmation/approval workflow、audit traceability。
- 驗證 live business data 使用 structured lookup / connector；document knowledge 使用 RAG。

## Test Plan

### Unit Tests

- query understanding pipeline：斷句、分詞/片語、術語 normalization、時間解析、代詞解析、實體候選、多意圖拆解、confidence/clarification。
- `ExecutionPlan` generation：taskType、candidateTools、requiredEvidence、riskAssessment、decision。
- permission and masking：module/operation/row/field filtering，未授權欄位不得進入 LLM input。
- risk classification：low/medium/high/critical，side-effect tool 分流。
- no-answer / clarification / answer decision：no evidence、low confidence、ambiguous query、tool failure、evidence conflict。
- idempotency key handling：重送、worker retry、approval callback retry 不重複執行。

### Integration Tests

- 訂單頁含 `PageContext` 查「這張訂單目前狀態」時使用 structured lookup。
- 庫存與工單查詢使用 mock connector。
- SOP 或欄位說明使用 RAG evidence。
- Medium-risk request 建立 `ActionDraft`，確認前不執行 side-effect tool。
- High-risk request 建立 `ApprovalRequest`，核准前不執行 side-effect tool。
- Tool failure 產生 safe response、`AuditEvent` 與必要 `ReviewItem`。

### Contract Tests

- session/message API response format。
- SSE event shape：`answer_delta`、`tool_call_started`、`tool_call_completed`、`evidence_attached`、`approval_required`、`confirmation_required`、`final`、`error`。
- approval APIs：get/list/approve/reject/cancel。
- action draft APIs：get/confirm/cancel。
- feedback/review APIs。
- error/requestId format 與 permission denied response。

### Regression / Eval Tests

- Traditional Chinese sentence splitting/tokenization。
- entity extraction 與 context/deixis resolution。
- tool routing accuracy。
- no-answer precision。
- citation/evidence coverage。
- unauthorized field never reaches LLM input。

### Non-functional Tests

- readiness/dependency degradation：LLM、retrieval、database、connector、approval workflow。
- concurrent request / queue / backpressure behavior。
- SSE streaming timeout 與 interruption。
- audit traceability under error/load。
- side-effect idempotency across retries、SSE interruption、approval callbacks、worker retry。

## Complexity Tracking

> 無憲章違規需要例外核准。

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| N/A | N/A | N/A |

## Assumptions

- 本 feature 的規格文件會持續保持 `spec.md`、`design.md`、`plan.md`、`tasks.md` 對齊；實作前不得新增前端 SDK/widget、完整後台管理 UI/CRUD 或真實 ERP / MES / WMS / SCM / CRM connector。
- v1 不實作完整後台管理 domain、管理 UI、完整 CRUD 管理頁、analytics dashboard、automation efficiency dashboard、taxonomy/settings management UI。
- MVP 要做 runtime core records persistence、audit traceability、feedback / review raw data、approval / confirmation records、evidence / tool call records、analytics-ready raw events、mock connector validation。
- MVP 不做完整後台管理 UI、完整 CRUD 管理頁、analytics dashboard、automation efficiency dashboard、taxonomy/settings management UI、真實 ERP / MES / WMS / SCM / CRM connector、前端 SDK/widget UI。
- 真實 ERP / MES / WMS / SCM / CRM connector 後續拆 feature specs；v1 只用 mock connector 驗證核心流程。
- v1 不以 WebSocket 作為 AI 回覆通道；SSE 是唯一即時回答通道。
- v1 不把 jieba 視為必要依賴；中文理解能力透過可替換 `TokenizerAdapter` 與 query understanding pipeline 實作。
- v1 預設 LLM adapter 為 `OpenAiProvider`，且仍需透過 `LlmProvider` interface 抽象；`LLM_MODEL` 可切換主力/demo `gpt-5.4-mini`、高品質測試 `gpt-5.4`、廉價快速/fallback `gpt-5.4-nano`，provider/model 選擇不得硬寫死在 controller、service、prompt 或業務邏輯中，fallback/model selection 應在 config/provider 層處理並寫入 audit 或 observability metadata。
