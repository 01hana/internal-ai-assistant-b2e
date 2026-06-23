# Design: 內部後台 AI 助理核心

**Feature Branch**: `001-internal-assistant-core`

**Created**: 2026-06-11

**Source Spec**: [`spec.md`](./spec.md)

**Status**: Draft

## 1. Overview

本設計文件定義 `internal-ai-assistant.com` 的 v1 核心後端設計：一個可嵌入 ERP / MES / WMS / SCM / CRM 等企業內部系統的 AI 工作助理。它不是對外客服 chatbot，也不處理匿名訪客、公眾知識庫、留資或客服轉接假設。

v1 目標是建立可被不同宿主系統接入的核心後端 API、domain model、tool/connector abstraction、RAG/evidence pipeline、approval/escalation/review workflow、audit trail 與 feedback/improvement loop。

**技術決策：**

- **Backend framework**: NestJS + TypeScript
- **Persistence**: Prisma + PostgreSQL
- **Connector strategy**: v1 使用 Mock connector + Adapter contract，不實作特定 ERP / MES / WMS / SCM / CRM connector
- **LLM strategy**: v1 預設實作為 `OpenAiProvider`，但仍透過 `LlmProvider` interface 抽象；provider 必須透過 `LLM_PROVIDER` 選擇，v1 支援 `openai`，模型必須透過 `LLM_MODEL` 環境變數切換，不得硬寫死在業務邏輯中
- **Retrieval strategy**: 文件知識使用 RAG；即時業務資料使用 backend tools / structured lookup / connectors
- **Local dependency strategy**: v1 local development / test baseline 使用 Docker Compose 管理 app dependencies，至少包含 app 與 PostgreSQL，Redis 僅作為 queue/backpressure/rate limit 的 optional profile；production deployment、Kubernetes、Helm、cloud infra 與 CI/CD 不在本 feature 範圍
- **Scope**: v1 只設計核心後端 API，不設計前端 SDK/widget UI；AI 回覆即時輸出採 SSE，不採 WebSocket

## 2. Architecture

### 2.1 Bounded Contexts

```text
src/
├── assistant/              # session、message、context state、execution orchestration
├── query-understanding/    # 繁中斷句、分詞、術語 normalization、時間/代詞/多意圖解析
├── identity/               # actor context、host app context、company/organization boundary
├── permissions/            # module/operation/row/field permission、masking、output filtering
├── tools/                  # tool registry、tool execution、risk classification
├── connectors/             # ERP/MES/WMS/SCM/CRM connector adapter contract、mock business connectors
├── llm/                    # LlmProvider interface、OpenAiProvider adapter、model config
│   └── openai/             # OpenAiProvider implementation
├── retrieval/              # RAG provider、document knowledge retrieval、reranking/no-answer gate
├── evidence/               # EvidenceRef normalization、citation/evidence coverage
├── approvals/              # confirmation、ApprovalRequest、EscalationRequest
├── audit/                  # append-only audit event、requestId traceability
├── feedback/               # FeedbackEvent、ReviewItem、AI-assisted improvement suggestions
├── observability/          # health/readiness/dependency status、metrics、alerts
└── common/                 # config、errors、request-id、response envelope、SSE shared helpers
```

### 2.2 Context Responsibilities

- **Assistant Core**: 負責 session/message lifecycle、`AssistantContextState`、`PageContext`、`ExecutionPlan`、answer orchestration。Controller 只處理 DTO 與 response，不放業務規則。
- **Query Understanding**: 負責繁體中文斷句、tokenization、片語抽取、企業術語 normalization、時間範圍解析、代詞/指示詞解析、多意圖拆解、實體候選抽取、信心分數與澄清條件。
- **Identity & Permission**: 驗證 host app、actor、role、permission scope、company/organization boundary；所有 tool/retrieval 前必須經過 permission filter。
- **Tool Registry & Execution**: 管理 `ToolDefinition`、risk level、side effect、input/output schema；工具執行前必須完成權限檢查與風險判斷。
- **LLM Provider**: 管理 `LlmProvider` abstraction 與 `OpenAiProvider` 實作；此 context 不屬於企業系統 connector，provider/model 選擇只能在 config/provider layer 處理。
- **Retrieval & Evidence**: 文件、SOP、政策、欄位說明、手冊使用 RAG；訂單、庫存、工單、客戶、供應商、報價、交易等 live business data 使用 structured lookup 或 connector。
- **Approval & Escalation**: high/critical risk action 不直接執行，改建立 `ApprovalRequest` 或 `EscalationRequest`。
- **Audit & Observability**: 每個 request、tool call、permission decision、LLM decision、evidence、approval、feedback 都寫入 append-only audit event。
- **Feedback & Review Loop**: 收集 message-level feedback，從 no-answer、tool failure、bad routing、missing evidence、permission mapping issues 產生 `ReviewItem`。

## 3. Request Flow

### 3.1 Standard Answer Flow

```text
Host App
  -> POST /assistant/sessions/:id/messages
  -> Validate ActorContext + HostAppContext + PageContext
  -> Load AssistantSession + AssistantContextState
  -> Run Chinese query understanding pipeline
     -> sentence splitting
     -> tokenization / phrase extraction
     -> domain term normalization
     -> time range parsing
     -> deixis resolution with PageContext / AssistantContextState
     -> entity candidate extraction
     -> multi-intent decomposition
     -> confidence scoring / clarification decision
  -> Build ExecutionPlan
  -> Permission pre-checks
  -> Select retrieval/tool strategy
  -> Execute RAG or structured connector lookup
  -> Apply row/field permission filtering + masking before LLM input
  -> Generate evidence-grounded answer or clarification/no-answer
  -> Persist AssistantMessage + AssistantContextState
  -> Append AuditEvents
  -> Return response or SSE stream events
```

### 3.2 High-Risk Action Flow

```text
User asks for side-effect or high-risk action
  -> Build ExecutionPlan
  -> RiskAssessment = high | critical
  -> Do not execute side-effect tool
  -> Prepare action summary + evidence + payload summary
  -> Create ApprovalRequest or EscalationRequest
  -> Append audit events
  -> Return pending approval/escalation status
```

### 3.3 Feedback / Review Flow

```text
User submits message feedback
  -> Create FeedbackEvent linked to requestId/messageId/toolCalls/evidenceRefs
  -> If negative or actionable, create ReviewItem
  -> Append audit event
  -> Expose analytics for improvement loop
```

### 3.4 Medium-Risk Confirmation Flow

Medium risk 代表具副作用但不一定需要主管審核的操作，例如建立追蹤任務、新增備註、更新單筆狀態、產生報價草稿、指派負責人、更新單筆非敏感欄位。確認前不得執行任何 side-effect tool。

```text
User asks for medium-risk side-effect action
  -> Build ExecutionPlan
  -> RiskAssessment = medium
  -> Create ActionDraft
  -> Return operation preview via SSE confirmation_required event
  -> User explicitly confirms
  -> Re-check permission + organization boundary + idempotencyKey + tool contract
  -> Execute side-effect tool
  -> Persist ToolCall + EvidenceRef + AuditEvent
  -> Return final SSE event
```

## 4. API Contract Draft

所有 API 回應必須包含一致 `requestId`。錯誤回應必須使用一致 error code 與 message 格式；具體 global response envelope 可在 plan/implementation 階段固定。

### 4.1 Sessions

#### `POST /assistant/sessions`

建立 assistant session。

**Request**

```json
{
  "hostApp": "erp",
  "actor": {
    "id": "user-001",
    "displayName": "王小明",
    "roles": ["sales"],
    "permissionScopes": ["orders:read"]
  },
  "companyBoundary": {
    "organizationId": "org-001"
  },
  "pageContext": {
    "module": "orders",
    "route": "/orders/ORD-001",
    "screenId": "order-detail",
    "entityType": "order",
    "entityId": "ORD-001"
  }
}
```

**Response**

```json
{
  "requestId": "req-001",
  "data": {
    "sessionId": "asst-session-001",
    "status": "active"
  }
}
```

#### `GET /assistant/sessions/:id`

取得 session 與目前 `AssistantContextState` 摘要。

### 4.1.1 Session Restore Strategy

v1 採用簡單 session restore 策略，不強制實作 `GET /assistant/sessions/active` 或 `POST /assistant/sessions/resolve`。Active session resolve 可保留為後續產品化 feature。

1. 第一次打開 AI 助理時，host app 呼叫 `POST /assistant/sessions` 建立 session。
2. Host app 或前端保存 `sessionId`。
3. 使用者再次打開同一個 AI 助理視窗時，host app 帶入 `sessionId`。
4. 系統呼叫 `GET /assistant/sessions/:id` 與 `GET /assistant/sessions/:id/messages` 載入 session summary 與 message history。
5. 若 session 不存在、已過期、已關閉或不屬於目前 actor / host app / organization，系統回傳一致錯誤或要求建立新 session。

### 4.2 Messages

#### `POST /assistant/sessions/:id/messages`

送出使用者訊息並以 SSE streaming 取得 AI 回覆。此 endpoint 不回傳同步回答本文；v1 不使用 WebSocket 作為回答串流通道。

**Request**

```json
{
  "requestId": "req-002",
  "message": "這張訂單目前狀態？",
  "pageContext": {
    "module": "orders",
    "screenId": "order-detail",
    "entityType": "order",
    "entityId": "ORD-001",
    "visibleColumns": ["status", "customerName", "amount"],
    "selectedRows": []
  }
}
```

**SSE Response Events**

```text
event: tool_call_started
data: {"requestId":"req-002","sessionId":"asst-session-001","messageId":"msg-002","eventType":"tool_call_started","sequence":1,"data":{"toolCallId":"tool-call-002"}}

event: evidence_attached
data: {"requestId":"req-002","sessionId":"asst-session-001","messageId":"msg-002","eventType":"evidence_attached","sequence":2,"data":{"evidenceRefs":["ev-002"]}}

event: answer_delta
data: {"requestId":"req-002","sessionId":"asst-session-001","messageId":"msg-002","eventType":"answer_delta","sequence":3,"data":{"delta":"這張訂單目前狀態為"}}

event: final
data: {"requestId":"req-002","sessionId":"asst-session-001","messageId":"msg-002","eventType":"final","sequence":4,"data":{"answerDecision":"answered"}}
```

#### `GET /assistant/sessions/:id/messages`

取得指定 assistant session 的歷史訊息列表，用於使用者打開 AI 助理聊天視窗時恢復對話紀錄。

**Query Params**

- `limit`：預設 50；上限由 implementation phase 決定。
- `cursor`：用於向前載入更舊訊息；v1 contract 預設使用 cursor-based pagination，不同時使用 `before`。
- `order`：v1 固定 `asc`，讓聊天視窗可直接由舊到新渲染。

**Security**

- 必須重新檢查 actor identity、host app、organization boundary、session ownership / visibility。
- 不得回傳其他 actor、其他 host app 或其他 organization 的訊息。
- Message content、evidence summary、tool summary 必須套用 permission、field masking 與資料最小化。
- 不得在一般 log 中輸出完整敏感 message content 或未遮罩 evidence。
- 每次 history retrieval 應寫入 `session_history_viewed` 或 `session_resumed` audit event，metadata 必須最小化。

**Response**

```json
{
  "requestId": "req-history-001",
  "data": {
    "sessionId": "asst-session-001",
    "messages": [
      {
        "messageId": "msg-001",
        "role": "user",
        "content": "這張訂單目前狀態？",
        "createdAt": "2026-06-11T10:00:00Z"
      },
      {
        "messageId": "msg-002",
        "role": "assistant",
        "content": "這張訂單目前狀態為...",
        "answerDecision": "answered",
        "evidenceRefs": ["ev-001"],
        "toolSummary": {
          "status": "completed",
          "toolCallIds": ["tool-call-001"]
        },
        "createdAt": "2026-06-11T10:00:03Z"
      }
    ],
    "nextCursor": null
  }
}
```

#### `GET /assistant/sessions/:id/messages/:messageId`

取得單一 message、answer decision、tool calls、evidence refs 與 audit correlation id。

### 4.3 Approval Requests

`ApprovalRequest` 主要由 assistant pipeline 在 high risk / critical risk action 判斷時建立。不提供任意外部 API 讓使用者繞過 assistant pipeline 直接建立高風險操作請求。所有 approval request 必須可追溯 requester、approver、risk level、action summary、payload summary、evidence refs、status、decision reason、requestId 與 audit event。

#### `GET /assistant/approval-requests/:id`

取得單一 approval request、狀態、風險、證據、決策理由與 audit correlation。呼叫者必須具備 requester、approver 或內部維運權限。

#### `GET /assistant/approval-requests`

查詢 approval request 清單。至少支援依 status、riskLevel、requesterActorId、approverActorId、createdAt 範圍過濾。

#### `POST /assistant/approval-requests/:id/approve`

核准高風險操作。只有具備 approver permission 的 actor 可呼叫。`approved` 後的實際副作用執行仍必須重新檢查 permission、organization boundary、idempotency key 與 tool contract。

#### `POST /assistant/approval-requests/:id/reject`

拒絕高風險操作，必須提供 reason。拒絕後不得執行 side-effect tool。

#### `POST /assistant/approval-requests/:id/cancel`

取消尚未執行的 approval request。 requester、approver 或具備內部維運權限者可取消；取消必須寫入 audit event。

### 4.4 Action Drafts / Confirmations

`ActionDraft` 主要由 assistant pipeline 在 `RiskAssessment = medium` 時建立。不提供任意外部 API 讓使用者繞過 assistant pipeline 直接建立 medium-risk 操作草稿。`ActionDraft` 與 `ApprovalRequest` 的差別：`ActionDraft` 是 medium risk，使用者本人確認後可執行；`ApprovalRequest` 是 high / critical risk，需要主管、資料 owner 或具備審核權限者核准。

#### `GET /assistant/action-drafts/:id`

取得單一 `ActionDraft` 的操作預覽、狀態、風險等級、payload summary、toolName、resource、operation、expiresAt、requestId、messageId 與 audit correlation。只有原 requester、具備相關 approval / operation 權限的 actor，或內部維運角色可以查詢。回傳內容必須套用 permission、field masking 與資料最小化，不得回傳未授權欄位或敏感 payload 明文。

#### `POST /assistant/action-drafts/:id/confirm`

使用者明確確認 medium-risk action draft，確認後才允許執行 side-effect tool。確認不等於直接信任前端；後端在 confirm 時必須重新檢查 actor identity、organization boundary、permission scope、tool contract、risk policy、idempotencyKey、draft status、draft expiration、tool active/version compatibility。

若檢查通過，系統執行 side-effect tool，並建立或更新 `ToolCall`、`EvidenceRef`、`AuditEvent`。`ActionDraft.status` 進入 `executed` 或 `failed`。若偵測到相同 `idempotencyKey` 已成功或進行中，必須回傳既有執行結果或 duplicate-safe response，不得重複執行。

#### `POST /assistant/action-drafts/:id/cancel`

取消尚未執行的 `ActionDraft`。只有原 requester、具備相關權限者，或內部維運角色可以取消。只有 `draft` 或 `waiting_confirmation` 狀態可以取消；取消後不得執行 side-effect tool，且必須寫入 `AuditEvent`。

`confirmation_required` SSE event 必須包含 `actionDraftId`、`requestId`、`messageId`、`riskLevel`、`preview`、`expiresAt`。

### 4.5 Feedback And Review

#### `POST /assistant/messages/:messageId/feedback`

建立 message-level feedback。

**Request**

```json
{
  "requestId": "req-feedback-001",
  "rating": "negative",
  "reason": "wrong_tool_routing",
  "comment": "這題應該查工單，不是查 SOP。"
}
```

#### `GET /assistant/review-items`

查詢待檢視改善項目；v1 可只支援內部維運使用，不開放宿主系統 end user。

### 4.6 SSE Streaming Event Contract

AI 回覆的即時輸出必須使用 SSE。每個 SSE event 必須可關聯 `sessionId`、`messageId`、`requestId`、`eventType` 與 `sequence`。v1 不使用 WebSocket 作為回答串流通道。

SSE event types 至少包含：`answer_delta`、`tool_call_started`、`tool_call_completed`、`evidence_attached`、`approval_required`、`confirmation_required`、`final`、`error`。`final` event 的 `answerDecision` 可以使用完整 `AnswerDecision.status` enum。

```json
{
  "eventType": "tool_call_completed",
  "requestId": "req-002",
  "sessionId": "asst-session-001",
  "messageId": "msg-002",
  "sequence": 3,
  "data": {
    "toolCallId": "tool-call-002",
    "status": "success"
  }
}
```

## 5. Data Model Draft

### 5.1 AssistantSession

- `id`
- `hostApp`
- `organizationId`
- `actorId`
- `status`: `active | closed | expired`
- `createdAt`
- `updatedAt`
- `lastMessageAt`

### 5.2 AssistantMessage

- `id`
- `sessionId`
- `requestId`
- `role`: `user | assistant | system | tool`
- `content`
- `answerDecision`: `answered | clarification_required | no_answer | permission_denied | tool_failed | approval_required | confirmation_required | escalation_required`
- `executionPlanId`
- `createdAt`

### 5.3 AssistantContextState

- `id`
- `sessionId`
- `currentTask`
- `currentModule`
- `currentPage`
- `currentEntityType`
- `currentEntityId`
- `lastIntent`
- `lastEntities`
- `lastToolCallIds`
- `lastEvidenceRefIds`
- `pendingClarification`
- `pendingApprovalRequestId`
- `taskState`: `idle | planning | waiting_clarification | waiting_confirmation | waiting_approval | waiting_escalation | completed | failed`
- `updatedAt`

### 5.4 PageContext / ScreenContext

Page context 可作為 message request payload 保存，也可存為 JSON 欄位供 audit/replay。

- `module`
- `route`
- `screenId`
- `entityType`
- `entityId`
- `selectedRows`
- `activeFilters`
- `visibleColumns`
- `userVisibleState`

### 5.5 ExecutionPlan

- `id`
- `sessionId`
- `messageId`
- `taskType`
- `requiredEvidence`
- `candidateTools`
- `permissionChecks`
- `riskAssessment`: `low | medium | high | critical`
- `clarificationNeeds`
- `expectedAnswerShape`
- `requiresMultiStepToolUse`
- `decision`: `continue | clarify | no_answer | permission_denied | tool_failed | approval_required | confirmation_required | escalation_required`
- `createdAt`

### 5.6 ToolDefinition

ToolDefinition 是正式產品可維護的 tool contract。LLM 不得直接呼叫任意 API 或資料庫，只能選擇已註冊且 active 的 ToolDefinition。ToolDefinition 必須支援 version，讓舊 tool call 可以 audit replay；tool contract 變更不可破壞既有 audit traceability。

- `id`
- `name`
- `version`
- `description`
- `resource`
- `operation`: `read | create | update | delete | export | approve | other`
- `inputSchema`
- `outputSchema`
- `requiredPermissions`
- `riskLevel`: `low | medium | high | critical`
- `hasSideEffect`
- `requiresConfirmation`
- `requiresApproval`
- `connectorKey`
- `timeoutMs`
- `auditBehavior`
- `isActive`
- `createdAt`
- `updatedAt`

Tool input 必須通過 schema validation；tool execution 必須套用 permission、organization boundary、risk policy、masking 與 audit logging。

### 5.7 ToolCall

- `id`
- `requestId`
- `sessionId`
- `messageId`
- `toolDefinitionId`
- `toolName`
- `toolVersion`
- `inputSummary`
- `permissionResult`
- `outputSummary`
- `status`: `pending | success | failed | blocked`
- `executionStatus`: `not_started | in_progress | executed | skipped_duplicate | failed`
- `idempotencyKey`
- `durationMs`
- `errorCode`
- `createdAt`
- `executedAt`

### 5.8 EvidenceRef

- `id`
- `sourceType`: `tool_result | structured_record | document_chunk | approval_decision`
- `sourceId`
- `toolCallId`
- `documentId`
- `entityType`
- `entityId`
- `fieldPaths`
- `timestamp`
- `permissionSnapshot`

### 5.9 ApprovalRequest

- `id`
- `requestId`
- `sessionId`
- `messageId`
- `requesterActorId`
- `approverActorId`
- `riskLevel`
- `status`: `pending | approved | rejected | expired | cancelled`
- `actionSummary`
- `payloadSummary`
- `evidenceRefIds`
- `decisionReason`
- `idempotencyKey`
- `auditEventIds`
- `expiresAt`
- `createdAt`
- `decidedAt`

### 5.10 ActionDraft

ActionDraft 代表 medium-risk confirmation flow 的操作草稿。確認前不得執行 side-effect tool。

- `id`
- `requestId`
- `sessionId`
- `messageId`
- `actorId`
- `toolName`
- `resource`
- `operation`
- `riskLevel`
- `payloadSummary`
- `preview`
- `status`: `draft | waiting_confirmation | confirmed | executed | cancelled | expired | failed`
- `idempotencyKey`
- `createdAt`
- `confirmedAt`
- `executedAt`
- `expiresAt`

### 5.11 EscalationRequest

- `id`
- `requestId`
- `sessionId`
- `reason`: `permission_gap | data_owner_required | policy_required | tool_failure | evidence_conflict | other`
- `status`: `open | resolved | cancelled`
- `ownerType`: `data_owner | system_admin | approver | product_ops`
- `summary`
- `createdAt`
- `resolvedAt`

### 5.12 FeedbackEvent

- `id`
- `requestId`
- `messageId`
- `rating`: `positive | negative | neutral`
- `reason`
- `comment`
- `intent`
- `toolCallIds`
- `evidenceRefIds`
- `answerDecision`
- `createdAt`

### 5.13 ReviewItem

- `id`
- `sourceType`: `failed_query | no_answer | tool_failure | negative_feedback | missing_evidence | bad_tool_routing | permission_mapping_issue`
- `sourceId`
- `status`: `open | in_review | resolved | dismissed`
- `priority`: `low | medium | high`
- `summary`
- `suggestedImprovement`
- `createdAt`
- `resolvedAt`

### 5.14 AuditEvent

Audit event 必須 append-only，不提供 update/delete path。

- `id`
- `requestId`
- `timestamp`
- `organizationId`
- `hostApp`
- `actorId`
- `sessionId`
- `messageId`
- `eventType`
- `decision`: full decision enum, including `answered | clarification_required | no_answer | permission_denied | tool_failed | approval_required | confirmation_required | escalation_required`
- `toolCallId`
- `riskLevel`
- `permissionResult`
- `evidenceRefIds`
- `durationMs`
- `metadata`

### 5.15 QueryUnderstandingResult

- `id`
- `requestId`
- `messageId`
- `sentences`
- `tokens`
- `phrases`
- `normalizedTerms`
- `timeRanges`
- `resolvedReferences`
- `entityCandidates`
- `subTasks`
- `confidence`
- `clarificationNeeds`
- `createdAt`

### 5.16 KnowledgeDocument

`KnowledgeDocument` 和 `KnowledgeChunk` 是 v1 文件型 RAG 的標準模型；不另外建立重複的 `DocumentChunk`。

- `id`
- `title`
- `sourceType`: `manual | sop | policy | field_guide | faq | uploaded_file | other`
- `sourceKey`
- `version`
- `language`
- `status`: `draft | active | archived`
- `metadata`
- `createdAt`
- `updatedAt`

### 5.17 KnowledgeChunk

- `id`
- `documentId`
- `chunkIndex`
- `heading`
- `content`
- `tokenCount`
- `metadata`
- `embeddingRef` or `vectorId`
- `enabled`
- `createdAt`
- `updatedAt`

### 5.18 RetrievalRun

RetrievalRun 用於 RAG 可觀測性、debug、eval 與 review item。若 v1 實作期不建立實體表，至少必須把等價資料寫入 `AuditEvent.metadata`。

- `id`
- `requestId`
- `messageId`
- `query`
- `normalizedQuery`
- `filters`
- `strategy`: `keyword | vector | hybrid`
- `selectedEvidenceRefIds`
- `noAnswerReason`
- `durationMs`
- `createdAt`

### 5.19 RetrievalCandidate

- `id`
- `retrievalRunId`
- `chunkId` or `sourceId`
- `sourceType`
- `score`
- `rank`
- `selected`
- `reason`

### 5.20 AnswerPlan

- `id`
- `requestId`
- `messageId`
- `answerType`
- `expectedAnswerShape`
- `requiredEvidence`
- `selectedEvidenceRefs`
- `allowedClaims`
- `disallowedClaims`
- `missingInformation`
- `clarificationRequired`
- `approvalRequired`
- `escalationRequired`
- `reviewRequired`

### 5.21 AnswerDecision

- `status`: `answered | clarification_required | no_answer | permission_denied | tool_failed | approval_required | confirmation_required | escalation_required`
- `noAnswerReason`: `no_evidence | low_confidence | ambiguous_query | permission_denied | tool_failure | evidence_conflict | unsupported_scope | missing_page_context`
- `clarificationQuestionId`
- `groundingCheckId`

### 5.22 ClarificationQuestion

- `id`
- `requestId`
- `messageId`
- `question`
- `missingInformation`
- `candidateOptions`
- `createdAt`

### 5.23 GroundingCheck

- `id`
- `answerPlanId`
- `selectedEvidenceRefIds`
- `coverageResult`: `passed | failed`
- `unsupportedClaims`
- `createdAt`

### 5.24 Decision Enum Consistency

- `AssistantMessage.answerDecision` 表示最後對使用者呈現的回答結果狀態。
- `ExecutionPlan.decision` 表示執行計畫在進入 retrieval/tool/answer generation 前或過程中的控制決策。
- `AnswerDecision.status` 表示 final answer 前的最終回答決策。
- 三者不一定代表同一層級，但狀態名稱必須一致，避免 API、audit、test、frontend rendering 解讀不一致。
- `confirmation_required` 用於 medium-risk action draft，需要使用者本人確認。
- `approval_required` 用於 high/critical risk action，需要具備審核權限者核准。
- `escalation_required` 用於需要資料 owner、系統管理員、產品維運或其他內部人員介入的狀況。
- `tool_failed` 用於工具失敗且無法用其他 evidence 安全回答的狀況。
- SSE `final` event 的 `answerDecision` 可使用完整 enum。
- `AuditEvent.decision` 可以記錄上述完整 enum。

## 6. Permission And Masking Design

### 6.1 Permission Levels

系統必須支援下列權限層級：

- **Module-level**：是否可進入/查詢某模組，例如 orders、inventory、work-orders。
- **Operation-level**：是否可執行 read、export、update、delete、approve 等操作。
- **Row-level**：是否可查看某筆資料，例如特定部門、客戶、倉庫、工廠或業務負責範圍。
- **Field-level**：是否可查看欄位，例如成本、毛利、合約金額、個資、內部備註。

### 6.2 LLM 前過濾

未授權欄位必須在 tool/structured lookup result 交給 LLM 前移除或遮罩。LLM 不得接收到未授權內容後再由 prompt 要求不要輸出。

```text
Connector result
  -> row permission filter
  -> field permission filter
  -> masking
  -> evidence normalization
  -> LLM input
```

## 7. Side-Effect Idempotency Design

Idempotency 的目的：同一個具副作用操作即使因前端重送、SSE 中斷、網路重試、approval callback 重送或 worker retry 被送出多次，也只能產生一次實際效果。

- 所有 medium risk / high risk / critical risk 的 side-effect execution 都必須有 `idempotencyKey`。
- `requestId` 只能用於 request trace，不應單獨作為所有副作用操作的唯一去重依據。
- Side-effect tool execution 必須在執行前檢查是否已存在相同 `idempotencyKey` 的成功或進行中操作。
- Approval 後執行、confirmation 後執行、worker retry 都必須遵守 idempotency。
- Retry 不得造成重複建立、重複更新、重複匯出、重複扣庫存、重複送出通知或重複跨系統寫入。

## 8. RAG And Structured Lookup Design

### 8.1 RAG 使用範圍

RAG 用於 document knowledge：

- SOP
- 政策
- 欄位說明
- 操作手冊
- 內部規範
- FAQ-like 說明文件

### 8.2 Structured Lookup / Connector 使用範圍

Structured lookup / connector 用於 live business data：

- 訂單
- 庫存
- 工單
- 客戶
- 供應商
- 報價
- 交易
- 即時狀態或統計

系統不得假設所有業務資料都應進入 vector search。即時性、授權性與交易一致性資料必須以來源系統 connector 或 structured lookup 為準。

### 8.3 Evidence Conflict

當 tool result 與 document evidence 衝突時：

- 回答必須揭露衝突。
- 降低確定語氣，不可編造整合結論。
- 視情況要求澄清、建立 `ReviewItem` 或建立 `EscalationRequest`。

### 8.4 Document Knowledge / RAG Ingestion Pipeline

文件型 RAG 必須包含 ingestion、chunking、embedding/indexing、reindex、seed/eval data。若只有資料表但沒有 ingestion、chunking、embedding/indexing、reindex、seed/eval data，RAG 表會是空的，系統也不算完成文件型 RAG 能力。

```text
Create or upload document
  -> Create KnowledgeDocument
  -> Chunking
  -> Create KnowledgeChunk
  -> Embedding / indexing job
  -> Retrieval returns chunk-level EvidenceRef
  -> Reindex preserves version + audit traceability
```

## 9. Provider And Adapter Interfaces

Provider/adapter interface 必須靠近各自 domain，避免 `common/` 變成雜物區。v1 預設檔案歸屬為：`src/llm/llm-provider.interface.ts`、`src/retrieval/retrieval-provider.interface.ts`、`src/query-understanding/tokenizer-adapter.interface.ts`、`src/connectors/connector-adapter.interface.ts`。`common/` 只保留 config、errors、request-id、response envelope、SSE shared helpers 等真正跨 domain 基礎能力。

### 9.1 LlmProvider

v1 `LlmProvider` 的預設 adapter 為 `OpenAiProvider`，實作位置為 `src/llm/openai/`。Provider 選擇必須由 `LLM_PROVIDER` 環境變數控制，v1 支援值為 `openai`；模型選擇必須由 `LLM_MODEL` 環境變數控制，禁止在 controller、service、prompt template 或 domain rule 中硬寫死 provider 或模型名稱。OpenAI credential 使用 provider-specific `OPENAI_API_KEY`，未來新增 provider 時應新增各自 credential env，不共用泛用 `LLM_API_KEY`。

建議模型用途：

- 主力 / demo：`gpt-5.4-mini`
- 高品質測試：`gpt-5.4`
- 廉價快速 / fallback：`gpt-5.4-nano`

若 `LLM_MODEL` 未設定，implementation plan 建議以 `gpt-5.4-mini` 作為非業務邏輯層的設定預設值；fallback 切換必須由 provider/config 層處理，並寫入 audit/observability metadata。

```ts
interface LlmProvider {
  generateAnswer(input: GenerateAnswerInput): Promise<GenerateAnswerResult>;
  classifyIntent(input: ClassifyIntentInput): Promise<ClassifyIntentResult>;
  summarize(input: SummarizeInput): Promise<SummarizeResult>;
}
```

### 9.2 RetrievalProvider

```ts
interface RetrievalProvider {
  retrieve(input: RetrievalInput): Promise<RetrievalResult>;
  rerank(input: RerankInput): Promise<RerankResult>;
}
```

### 9.3 ConnectorAdapter

```ts
interface ConnectorAdapter {
  key: string;
  listTools(): ToolDefinition[];
  execute(input: ConnectorExecuteInput): Promise<ConnectorExecuteResult>;
  healthCheck(): Promise<DependencyStatus>;
}
```

v1 mock connector 必須至少支援：

- order status lookup
- work order progress lookup
- inventory availability lookup
- customer/supplier history summary lookup

### 9.4 QueryUnderstandingPipeline

```ts
interface QueryUnderstandingPipeline {
  understand(input: QueryUnderstandingInput): Promise<QueryUnderstandingResult>;
}
```

### 9.5 TokenizerAdapter

```ts
interface TokenizerAdapter {
  tokenize(input: TokenizeInput): Promise<TokenizeResult>;
  extractPhrases(input: PhraseExtractionInput): Promise<PhraseExtractionResult>;
}
```

`TokenizerAdapter` 必須可替換。v1 不綁定 jieba；jieba、CKIP、HanLP 或其他 tokenizer 都只能作為 adapter 實作。

### 9.6 DomainLexiconRepository

```ts
interface DomainLexiconRepository {
  findTerms(input: DomainTermLookupInput): Promise<DomainTerm[]>;
  normalize(input: NormalizeTermsInput): Promise<NormalizeTermsResult>;
}
```

### 9.7 TimeRangeParser

```ts
interface TimeRangeParser {
  parse(input: TimeRangeParseInput): Promise<TimeRangeParseResult>;
}
```

### 9.8 DeixisResolver

```ts
interface DeixisResolver {
  resolve(input: DeixisResolveInput): Promise<DeixisResolveResult>;
}
```

## 10. Chinese Query Understanding Pipeline

中文 query understanding pipeline 必須在 `ExecutionPlan` 前執行，並輸出可稽核、可 debug、可 eval 的 `QueryUnderstandingResult`。

### 10.1 Pipeline Steps

```text
Raw user message
  -> Traditional Chinese sentence splitting
  -> tokenization / phrase extraction
  -> domain lexicon lookup
  -> synonym / enterprise term normalization
  -> time range parsing
  -> deixis resolution using PageContext + AssistantContextState
  -> entity candidate extraction
  -> multi-intent decomposition
  -> confidence scoring
  -> clarificationNeeds or ExecutionPlan input
```

### 10.2 Required Capabilities

- **繁體中文斷句**：拆分多句、多條件、連續指令。
- **分詞 / 片語抽取**：抽出業務詞、欄位詞、操作詞、數量詞、時間詞。
- **企業術語 normalization**：支援同義詞、縮寫、欄位別名與公司內部術語，例如「工單 / 製令」、「料號 / 品號」。
- **時間範圍解析**：支援相對與絕對時間，例如「今天」、「上週」、「近三個月」、「今年 Q2」。
- **代詞/指示詞解析**：使用 `PageContext` 與 `AssistantContextState` 解析「這筆」、「這張」、「目前」、「剛剛選取」。
- **多意圖拆解**：將複合問題拆成多個可執行子任務。
- **實體候選抽取**：抽出 orderId、workOrderId、itemNo、customerId、supplierId、date range 等候選。
- **信心分數與澄清條件**：低信心、上下文不足、候選衝突或時間不明時必須要求澄清。

### 10.3 Tokenizer Decision

v1 必須設計 `TokenizerAdapter`，但不必導入 jieba。Tokenizer 是可替換基礎能力，不是完整語意理解方案。中文理解必須由 tokenizer、domain lexicon、rules、LLM structured understanding、confidence scoring 與 clarification gate 共同完成。

## 11. Availability And Scalability Design

### 11.1 Health And Readiness

系統必須提供：

- API health check
- readiness check
- dependency status: LLM、retrieval、database、connector、approval workflow
- degraded status reason
- alert/audit event for dependency failure

### 11.2 Timeout / Retry / Safe Degradation

- LLM、retrieval、connector 必須有 timeout。
- 可重試錯誤必須有 bounded retry。
- 不可用時必須回覆 safe degradation message，不得編造答案。
- side-effect tool 不得因 retry 造成重複執行。

### 11.3 Concurrency

v1 design 必須預留：

- queue
- backpressure
- rate limit
- SSE streaming timeout
- per-host-app resource isolation
- audit traceability under load

## 12. Audit And Observability

Audit event 必須 append-only。敏感資料不得明文寫入一般 log；audit metadata 也必須遵守 masking 與資料最小化。

必須記錄：

- assistant request received
- execution plan created
- permission check passed/denied
- tool selected
- tool call started/completed/failed/blocked
- retrieval started/completed/no-result
- evidence refs attached
- answer generated
- clarification/no-answer decision
- approval request created/approved/rejected/expired/cancelled
- escalation request created/resolved
- feedback received
- review item created/resolved

## 13. Feedback And Improvement Loop

FeedbackEvent 必須關聯：

- requestId
- messageId
- intent/task type
- tool calls
- evidence refs
- answer decision
- audit events

ReviewItem 可由以下來源建立：

- failed query
- no-answer
- tool failure
- negative feedback
- missing evidence
- bad tool routing
- permission mapping issue
- evidence conflict

AI-assisted improvement 只能產生建議，例如知識缺口、工具 routing 改善、prompt/eval case 建議或權限 mapping 問題。任何影響正式回答、工具執行或權限規則的變更都必須人工審核後才能上線。

## 14. Security And Data Governance

- 所有 request 必須有 actor、host app、organization boundary、requestId。
- 不接受前端或 prompt 宣告的權限決策作為最終依據。
- Connector secret、API key、LLM key 不得進入 SDK 或前端。
- 跨公司/組織邊界預設禁止。
- 未授權欄位不得進入 LLM input。
- 高風險操作必須 approval；critical risk 只能整理資訊與建立審核請求。
- 所有 side-effect execution 必須使用 idempotencyKey，並在執行前檢查重複或進行中操作。
- Audit/log 必須避免敏感資料明文。

## 15. Answer Decision Design

Answer decision 在 final answer 前執行，確保回答沒有超出 evidence coverage。沒有足夠 evidence 時不得產生確定答案；tool result 與 document evidence 衝突時不得自行整合成單一結論。回答必須基於 `EvidenceRef`、`ToolCall` result、`AssistantContextState` 或通過權限過濾後的資料。

- `AnswerPlan` 描述 answerType、expectedAnswerShape、requiredEvidence、selectedEvidenceRefs、allowedClaims、disallowedClaims、missingInformation、是否需要 clarification、approval、escalation 或 review。
- `AnswerDecision` 狀態包含 `answered`、`clarification_required`、`no_answer`、`permission_denied`、`tool_failed`、`approval_required`、`confirmation_required`、`escalation_required`。
- `NoAnswerReason` 包含 `no_evidence`、`low_confidence`、`ambiguous_query`、`permission_denied`、`tool_failure`、`evidence_conflict`、`unsupported_scope`、`missing_page_context`。
- `GroundingCheck` 必須在 final answer 前確認回答是否超出 evidence coverage。

## 16. Test Strategy

### 16.1 Unit Tests

- `ExecutionPlan` generation
- permission check before tool/retrieval
- field masking before LLM input
- risk classification
- context resolution from `PageContext`
- no-answer / clarification gate
- answer decision mapping
- answer decision enum mapping consistency
- Traditional Chinese sentence splitting
- tokenization / phrase extraction
- domain term normalization
- time range parsing
- deixis resolution confidence scoring

### 16.2 Integration Tests

- order status with `PageContext` uses structured lookup
- SOP/field explanation uses RAG
- inventory query uses mock connector
- work order progress query uses mock connector
- medium-risk update creates ActionDraft and waits for confirmation
- confirmation executes side-effect tool only after permission/org/idempotency re-check
- high-risk batch update creates `ApprovalRequest`
- sensitive export creates `ApprovalRequest` or `EscalationRequest`
- tool failure creates safe response + audit event
- negative feedback creates `FeedbackEvent` and optional `ReviewItem`
- tool result vs document evidence conflict creates clarification or `ReviewItem`
- multi-intent query is decomposed into executable subtasks
- missing PageContext for 指示詞 triggers clarification

### 16.3 Contract Tests

- session/message API response format
- SSE event shape
- approval get/list/approve/reject/cancel API
- action draft get API
- action draft confirm API
- action draft cancel API
- confirm before side-effect tool execution
- confirm re-checks permission / organization boundary / idempotency
- duplicate confirm does not repeat side-effect tool execution
- expired/cancelled/executed draft cannot be confirmed again
- enum consistency for AssistantMessage.answerDecision / ExecutionPlan.decision / AnswerDecision.status / AuditEvent.decision
- feedback API
- review items API
- error/requestId format
- permission denied response

### 16.4 Regression / Eval Tests

- semantic understanding eval set
- task routing accuracy
- entity extraction accuracy
- context resolution accuracy
- no-answer precision
- citation/evidence coverage
- unauthorized field never reaches LLM input
- Traditional Chinese query understanding eval set
- enterprise synonym/term normalization eval set
- low confidence clarification eval set

### 16.5 Non-Functional Tests

- readiness/dependency failure
- degraded dependency response
- concurrent thousands-of-requests scenario
- queue/backpressure/timeout behavior
- audit traceability under error and load conditions
- bounded retry does not duplicate side-effect execution
- idempotency prevents duplicate side-effect execution across retries, approval callbacks, SSE interruption, and worker retry

## 17. Analytics And Metrics Phasing

MVP 必須在 source-of-truth 層級記錄完整可分析事件與 raw metrics，不得因 dashboard/read model 尚未完成而缺漏原始資料。

MVP 必須記錄 analytics-ready raw events/raw metrics：

- `AuditEvent`
- `ToolCall`
- `ExecutionPlan`
- `AnswerDecision`
- `EvidenceRef`
- `FeedbackEvent`
- `ReviewItem`
- `ApprovalRequest`
- `EscalationRequest`
- dependency status
- durationMs
- noAnswerReason
- permissionDeniedReason
- toolFailureReason

後續產品階段再實作 aggregated analytics read models、dashboards、operational reports 與 automation efficiency dashboard。這些後續項目不得影響 raw event 的完整性與可追溯性。

## 18. Productized MVP Scope

MVP 必須完成：context、query understanding、execution planning、permission filtering、tool contract、evidence grounding、no-answer / clarification、medium-risk confirmation、high-risk approval request、audit event、feedback / review item raw data、analytics-ready raw events、mock connector validation。

MVP 可以預留但不必完整完成：真實 ERP / MES / WMS / SCM / CRM connector、完整 approval UI、大型 dashboard、完整 analytics read model、大規模高併發 production tuning、AI 自動修改知識、prompt、tool routing 或權限 mapping。

## 19. Design Decisions And Defaults

- v1 使用 NestJS module/service/domain 分層；controller 不承載業務邏輯。
- v1 使用 Prisma + PostgreSQL；JSON 欄位可用於 context/evidence/permission snapshot，但核心關聯需可查詢。
- v1 使用 mock connector 驗證核心流程；真實 ERP / MES / WMS / SCM / CRM connector 後續拆 feature specs。
- v1 不建立前端 SDK/widget UI，但 API 必須保持可嵌入宿主系統。
- v1 不做大型 SaaS 多公司 tenant 管理；以單一公司/組織部署邊界為前提。
- v1 不允許 AI 自動修改正式知識、工具 routing、prompt、eval set 或權限 mapping；只能建立改善建議或 `ReviewItem`。
- v1 不導入 jieba 作為必要依賴；必須先定義可替換 `TokenizerAdapter`，讓 jieba、CKIP、HanLP 或其他 tokenizer 可作為未來 adapter。
- v1 AI 回覆串流採 SSE；WebSocket 不作為 v1 回覆通道，除非後續 feature spec 明確新增雙向即時協作需求。
