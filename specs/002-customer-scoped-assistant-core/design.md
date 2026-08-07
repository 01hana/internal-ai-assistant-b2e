# Feature 002 — Customer-Scoped Assistant Core Design

## Overview

本設計將 Customer 定義為共享式 Assistant Backend 的最外層資料所有權與安全隔離邊界。既有 hierarchy 維持為 Customer → Organization → HostApp → Actor；organizationId、hostApp、actorId、roles 或 permissionScopes 均不可取代 customerId。

本文件是 `spec.md` 的實作設計輸入，適用 NestJS、Prisma 與 PostgreSQL。它不實作 Gateway registry、外部 JWT onboarding、Connector framework、SDK transport、Customer Host proxy 或 platform control plane。

## Identity Boundary and Request Context

### Canonical context

所有接觸 customer-owned data 或執行業務操作的受保護端點，都由已驗簽的 Gateway internal identity JWT 建立下列唯一 canonical context：

```ts
interface RequestIdentityContext {
  requestId: string;
  customer: {
    customerId: string;
    integrationId: string;
  };
  organization: {
    organizationId: string;
  };
  hostApp: {
    hostApp: string;
  };
  actor: {
    actorId: string;
    roles: string[];
    permissionScopes: string[];
  };
  auth: {
    tokenId: string;
    gatewayIssuer: string;
  };
}
```

`requestId` 不屬於 identity claim。它由 Gateway、Backend 或受信任 tracing 機制產生或正規化，`x-request-id` 僅可供 tracing 與 audit correlation 使用。

### Verification and error classification

Bearer parser 與 JWKS verifier 先驗證 JWT signature、RS256 algorithm、issuer、audience、`iat`、`exp`，以及存在時的 `nbf`。缺少 token、Bearer 格式錯誤或任一驗簽／registered-claim 驗證失敗，一律回應 `401 IDENTITY_TOKEN_INVALID`。

只有驗簽成功後才驗證 canonical claims。`customer_id`、`integration_id`、`sub`、`org_id`、`host_app`、`roles`、`permission_scopes` 與 `jti` 缺少、空白、型別錯誤或彼此不一致時，一律回應 `403 IDENTITY_CONTEXT_INVALID`。`roles` 與 `permission_scopes` 必須是陣列，元素 trim 後不可為空字串；空陣列合法，並由後續 permission pipeline 拒絕需要權限的操作。

Backend 不讀取、補值、覆寫或 fallback 至 `x-customer-id`、`x-actor-id`、`x-role`、`x-organization-id`、`x-host-app`、`x-permission-scopes` 或其他 public identity header。health、readiness、metrics 與公開文件可依部署政策不使用 identity guard，但不得暴露 Customer 資料或業務操作能力。

### Implementation shape

Identity guard 是 protected Assistant API 的唯一 identity 入口。它使用 verifier abstraction，production implementation 以 Remote JWKS、`kid` key rotation 與 clock tolerance 驗證 Gateway token，然後將 canonical context 寫入 request scope。服務不得重新解析 JWT、也不得自行組合 identity。

`backup/gateway-identity-jwt-prototype` 僅能作為未來實作時的唯讀參考：可選擇性採用其 Bearer parser、RS256 Remote JWKS verifier、verifier abstraction、401/403 exception shape 與 verifier test pattern。不得沿用其單一 `role`、non-empty scopes、header-era context/types，或其 Gateway runtime。

## Customer Ownership

### Ownership root

新增最小 Customer ownership root。`Customer.id` 本身就是 canonical `customerId`，是所有 customer-owned data 的最外層 ownership target；Customer 不保存另一個指向自身的 `customerId`。

Feature 002 不定義 Customer lifecycle、status、disable/delete、retention、provisioning 或 administration 行為。這些產品與 control-plane concerns 由後續 Customer administration 或 platform-control-plane feature 定義。

### Ownership matrix

| Classification | Records and rule |
| --- | --- |
| Ownership root | `Customer`；其 `id` 即 `customerId`，不自我引用 `customerId`。 |
| Global product contract | `ToolDefinition` 不帶 customer ownership；僅定義產品工具契約。 |
| Direct Customer ownership | `AssistantSession`、`AssistantMessage`、`KnowledgeDocument`、`KnowledgeChunk`、`RetrievalRun`、`RetrievalCandidate`、`EvidenceRef`、`ToolCall`、`ApprovalRequest`、`ActionDraft`、`EscalationRequest`、`FeedbackEvent`、`ReviewItem`、`AuditEvent`、`CustomerToolPolicy` 直接保存 `customerId`。 |
| Parent-owned children | `AssistantContextState`、`ExecutionPlan`、`AnswerDecision`、`ClarificationQuestion`、`GroundingCheck`、`QueryUnderstandingResult` 只可經 customer-scoped session 或 message parent 讀取。 |
| Multi-parent relations | 同時連向 session、message、document、chunk、tool、retrieval 或 workflow 的 relation，必須以 Customer-qualified parent key 或等價 relational constraint 確保兩端屬於相同 Customer。 |

Child records 不採一律直接加欄位的機械式策略。會被獨立查詢、需要自身唯一性／audit／relation integrity 的 child 採直接 `customerId`；僅由已 customer-scoped parent 存取者可採 parent ownership；跨多個 direct aggregates 的 relation 必須採 composite integrity。任何路徑都必須能證明 customer ownership。

## Prisma and PostgreSQL Integrity

Customer-owned direct rows 使用 `customerId`、Customer-aware indexes 和 Customer-scoped unique keys。資料庫約束與 repository filter 必須共同防護，不能只依賴 application-side checks。

- `ToolCall` 的 idempotency key 改為在 Customer 內唯一；不同 Customer 可以使用相同 key。
- `KnowledgeDocument` 的 `sourceKey + version` 改為 Customer-scoped unique；不同 Customer 可以使用相同 source/version。
- `KnowledgeDocument` 保存 Customer、organization applicability、visibility 與 requiredPermissionScopes；`KnowledgeChunk` 不重複保存 policy，而是經 document relation 繼承唯一有效 access policy，並以 relation integrity 保持同一 Customer。
- session/message/workflow、document/chunk、retrieval candidate/evidence 等 relation 使用 Customer-qualified parent keys 或等價 composite constraint，避免引用另一 Customer 的 ID。
- Relation design 不得因 Customer parent deletion 意外 cascade 移除 Customer-owned history 或 audit；具體 delete policy 由後續 Customer lifecycle feature 定義。
- `CustomerToolPolicy` 以 Customer + ToolDefinition 定義 customer-level enablement 與 permission policy；不包含 connector binding、instance、credential、secretRef 或 connector runtime。

Schema migration 不得從 organization、HostApp、actor、roles、permission scopes 或任意 metadata 自行推論 customerId。

## Repository and Service Boundary

由 canonical context 衍生統一的 `CustomerScope`，至少包含 customerId，以及在需要時供後續 policy 取用的 organization、host app、actor、roles、permission scopes。其使用順序固定為：已驗簽 identity → Customer-first data predicate → organization/host/actor visibility → permission policy。

customer-owned create、find、list、update、delete、transition、idempotent retry 與 side-effect precheck 的第一個資料條件必須是 Customer scope。禁止 bare `findUnique({ id })`、只用 sessionId/messageId/approvalId/idempotencyKey 取得 customer-owned resource、或先全域讀取後才套 visibility filter。跨 Customer 存取回安全 not-found 或既定安全 authorization error，且不得揭露資源存在性。

| Area | Required Customer-first design |
| --- | --- |
| Session, message, history | Session lookup/list、message append/read、history、SSE orchestration 皆以 customerId 起始；parent-owned context/planning records 經已 scoped session/message 取得。 |
| Knowledge and retrieval | Document/chunk CRUD、source/version uniqueness、retrieval run/candidate/evidence read/write 都帶 Customer ownership。 |
| Tools | Tool definition lookup 可為 global contract；CustomerToolPolicy resolution、tool call、permission precheck、idempotent retry 與 result lookup 都以 Customer scope 起始。 |
| Workflow | approval、action draft、escalation 的 list/get/transition 和 side-effect precheck 均先確認 Customer。 |
| Quality records | feedback、review、audit 的 write/read/list 均保存並查詢 customerId；不得以 JSON metadata 後置篩選作隔離。 |

## RAG and Evidence Isolation

### Access-policy model and validation

KnowledgeDocument 的 visibility 僅有 `CUSTOMER` 與 `ORGANIZATION`。`CUSTOMER` 要求 `organizationIds=[]`，代表同一 Customer 的所有 Organization 都可通過 organization filter；`ORGANIZATION` 要求 organizationIds 至少含一個合法 canonical organizationId，且 requester 的 organizationId 必須在 allowlist。organizationIds 的元素必須為非空、合法字串；寫入時 trim、去重並正規化。

`requiredPermissionScopes` 是 string[]。空陣列沒有額外 scope 限制；非空陣列採 ALL semantics，actor 必須具備每一 scope。元素必須為非空、合法字串，並於寫入時 trim、去重並正規化。ANY semantics 不可重新解讀此欄位；未來需要 ANY 時，必須另行規格化 permissionMatchMode。

HostApp 不參與 Feature 002 的 knowledge visibility，也不保存 hostApp allowlist；它仍保留於 canonical identity、tracing 與 audit。新增或更新 document 時，未知 visibility、錯誤型別、空白或不合法 array element、CUSTOMER 使用非空 organizationIds、或 ORGANIZATION 使用空 allowlist，均以既有 validation error contract 拒絕保存。

RAG 的 candidate selection 固定按下列順序在資料存取層完成：

```text
Customer → visibility/organization → requiredPermissionScopes ALL check → candidate selection → ranking
```

不得先讀取其他 Customer、同 Customer 未授權 organization、visibility 或 permission 的 candidate，再於 orchestration、application layer 或答案產生時過濾。legacy、缺少、未知、型別錯誤或內部不一致的 policy 在 retrieval 時 deny-by-default；可寫入 redacted internal log/metric，但不得 materialize content、title、source key、metadata、count 或 embedding reference。no-evidence 結果不得暗示另一 Customer 或未授權 organization 有資料。

`RetrievalRun`、`RetrievalCandidate` 和 `EvidenceRef` 均保存 Customer traceability，且 candidate/evidence 與 document/chunk/session/message 的 relation 必須維持同 Customer。相同 sourceKey/version 可存在於兩個 Customer；同一 Customer 不同 organization／visibility／permission 的文件必須在 candidate selection 前排除。

## Tool, Workflow, and Audit Design

ToolDefinition 是全域產品契約。CustomerToolPolicy 僅決定該 Customer 是否啟用工具及其 permission policy；actor permission pipeline 依 canonical roles/scopes 和 Customer policy 判斷受保護操作，空授權陣列不會取得隱性權限。

approval、action draft、escalation、feedback、review 與 audit 都保存直接 Customer ownership。所有 get/list/transition/retry/side-effect precheck 均先處理 Customer scope。audit 至少可追溯 Customer、organization、HostApp、actor、requestId 與相關 session/message/tool/evidence/workflow；原始 access token 或 internal JWT 不得進入 log、audit、error、observability metadata 或 SSE payload。

## Migration, Seed, Rollout, and Rollback

### Development and test data

可重建的開發／測試資料可 reset 後重新 seed。deterministic seed 必須建立 Customer A/B，並故意使用相同 organizationId、actorId、HostApp、knowledge sourceKey/version 與 tool idempotency key，驗證 customerId 是唯一平台隔離邊界。

每個 seeded `KnowledgeDocument` 必須明確帶有合法 `customerId`、`visibility`、`organizationIds` 和 `requiredPermissionScopes`。fixture 必須涵蓋 `CUSTOMER` 加空 allowlist、`ORGANIZATION` 加非空 allowlist、空 required scopes、採 ALL semantics 的非空 required scopes，以及僅供寫入拒絕與 retrieval deny-by-default 測試的 invalid-policy fixture；invalid fixture 不得成為可檢索資料。

### Retained data

必須保留的資料採 expand → explicit approved mapping/backfill → validation → enforce。每筆 approved mapping 必須明確包含 `customerId`、`visibility`、`organizationIds` 和 `requiredPermissionScopes`，且 `customerId` 必須指向既有 Customer root。不得從 organization、HostApp、actor、roles、permissionScopes、metadata 或既有內容推論 Customer ownership 或 access policy。

在 backfill 與 validation 完成前，缺少或無效 policy 的 document 一律 deny-by-default：不得進入 candidate selection 或 enforce。只有 validation 通過後，才可 enforce policy required fields、visibility enum、`CUSTOMER`／`ORGANIZATION` consistency、正規化去重的 arrays，以及 ownership／relation constraints。

### Production gate and rollback

Feature 002 開發與驗證可使用測試 internal JWT fixtures。production 啟用新的 protected identity contract 前，Feature 003／Gateway 必須正式簽發 `customer_id` 與 `integration_id`，並完成 JWKS、issuer、audience 與 token-redaction deployment verification。不得以 public identity headers 作過渡 fallback。

enforce 前，應用程式可回退而保留 additive ownership data；缺少或無效 policy 的 retained document 仍保持 deny-by-default，不能藉由 rollback 進入 retrieval。enforce 後只可使用 forward migration 或備份還原修復資料，不能回復不安全 header trust。

## Verification Design

Unit tests 覆蓋 token/claim 401-403 classification、empty authorization arrays、CustomerScope predicate、CustomerToolPolicy、idempotency、parent-child integrity、RAG filter composition 和 token redaction。

Integration and contract tests 以 Customer A/B（共享 organizationId、actorId、HostApp）驗證 session/history、knowledge/RAG/evidence、tool、approval/action/escalation、feedback/review/audit 均無跨 Customer 存取；並驗證安全 not-found/error、SSE guard rejection JSON envelope、相同 source/version 與 idempotency key 的 Customer-scoped 行為。

Migration tests 覆蓋 reset/seed、unmapped retained data reject、approved mapping success 與 enforcement constraints。E2E/regression tests 覆蓋完整 assistant flow、permission denied、no-evidence、side-effect retry、既有 organization/HostApp visibility 與 RAG eval/no-answer 行為。

## Explicit Boundaries

本設計不定義或實作 Gateway CustomerIntegration registry、外部 customer JWT issuer/audience/JWKS onboarding、client allowlist、external claims mapping、Connector framework 或 credentials、Frontend SDK auth transport、Customer Host BFF/reverse proxy、platform control plane、Customer management UI、Customer lifecycle management、Customer disable/delete、retention workflow 或 administration，或 `apps/gateway/**` 的 production implementation。
