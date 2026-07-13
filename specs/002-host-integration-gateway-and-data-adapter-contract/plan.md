# Implementation Plan: Host Integration Gateway and Data Adapter Contract

## 1. Overview

本計畫定義 backend 002 `Host Integration Gateway + Data Adapter Contract` 的實作規劃。002 是 `001-internal-assistant-core` 的 extension layer，不是 replacement layer。它的核心目標是在不破壞既有 assistant core public API / SSE / `AnswerDecision` contract 的前提下，新增 host-aware context normalization、PageContext normalization、HostApp registry、DataAdapter specialization，以及 `admin` + `Orders / Inventory` 的第一個 reference integration。

本次輸出只包含 `plan.md`。不產生 `tasks.md`、`data-model.md`、`contracts/**`、`quickstart.md`，也不修改程式碼或既有 spec/design 文件。

## 2. Source Documents and Constraints

### Source Documents

- `specs/002-host-integration-gateway-and-data-adapter-contract/spec.md`
- `specs/002-host-integration-gateway-and-data-adapter-contract/design.md`
- `specs/001-internal-assistant-core/spec.md`
- `specs/001-internal-assistant-core/design.md`
- `specs/001-internal-assistant-core/plan.md`
- `specs/001-internal-assistant-core/tasks.md`
- `.specify/memory/constitution.md`

### Compatibility Note

本 repo 目前未提供額外 `docs/contracts/backend-assistant-core/**` handoff docs，002 以 001 spec/design/plan/tasks 與現有 API contract / runtime structure 作為相容性依據，這不應阻塞 002 implementation planning。

### Fixed Inputs

以下事項已決策，作為 fixed inputs，不再列為 Open Questions：

- reference host app = `admin`
- reference adapter scope = Orders + Inventory
- HostApp Registry v1 = static code-based registration
- permission scope transport = `x-permission-scopes` CSV header，backend 內部 normalize
- adapter timeout policy = 沿用既有 tool timeout policy
- frontend 002 = npm package / SDK mode
- backend 002 不實作 frontend SDK
- frontend 只傳 sanitized PageContext、identity headers、session scope 與必要 metadata
- backend derives `sourceSystem`
- frontend 不得決定 connector / data source / `sourceSystem`
- `degraded` 是 internal dependency state，不是 public `AnswerDecision`
- 不得新增 public `answerDecision = "degraded"`
- DataAdapter / ConnectorAdapter = same-domain specialized interfaces with shared registry

### Non-negotiable Boundaries

- 不重做 001 assistant core
- 不新增另一套 public chat API
- 不破壞既有 session / message / SSE / feedback / approval API
- 不一次實作完整 MES / WMS / SCM / CRM connector
- 不實作 frontend SDK / widget / npm package
- 不做完整 admin UI / CRUD
- 不做 approval management UI
- 不做 production deployment / Kubernetes / Helm
- 不允許 frontend / host app 傳 raw entity data 給 LLM
- 不允許 PageContext 取代 permission check
- 不允許 frontend 決定 connector、任意 data source 或最終 `sourceSystem`
- 不允許 connector / adapter 回傳 raw secret、credential、token、full sensitive payload

## 3. Current Architecture Baseline

002 必須建立在目前 repo 已存在的 bounded contexts 上：

- `src/assistant`
- `src/identity`
- `src/permissions`
- `src/tools`
- `src/connectors`
- `src/retrieval`
- `src/evidence`
- `src/audit`
- `src/feedback`
- `src/approvals`
- `src/query-understanding`
- `src/observability`
- `src/common`

目前已存在並應直接整合的關鍵實作：

- `src/connectors/connector-adapter.interface.ts`
- 既有 assistant planning / answer decision / runtime services
- 既有 identity extraction 與 validation
- 既有 permission pre-check 與 LLM input sanitizer
- 既有 `EvidenceRef` 與 `AuditEvent` 路徑
- 既有 SSE event 與 `final.data.answerDecision` contract

host-integration logic 應靠近 domain boundary，不放進 `common`。DataAdapter 必須留在 `src/connectors` domain，不得變成第二套 assistant runtime。

## 4. Implementation Strategy

整體策略採「先 guardrail，再 foundation，再 adapter contract，再 reference integration，再 runtime integration，再 safe path/eval/regression」。

實作順序必須遵守：

1. 先鎖定 001 public API / SSE / `AnswerDecision` contract 不變
2. 再建立 HostIntegrationContext / PageContext / HostAppRegistry foundation
3. 再建立 DataAdapter specialization 與 shared-registry connector-domain policy
4. 再做 `admin` Orders / Inventory reference adapter
5. 再接入既有 assistant message lifecycle
6. 最後補齊 degraded / timeout / audit / eval / regression hardening

每個 phase 都需定義目的、主要輸出、依賴與驗收條件，讓後續 `tasks.md` 可以直接拆解工作。

## 5. Phase Plan

### Phase 0 - Architecture Alignment and Contract Guardrails

**目的**

確認 002 不破壞 001 assistant core public API / SSE / `AnswerDecision` contract，並先建立 architecture guardrails。

**主要輸出**

- 002 不新增第二套 public chat endpoint 的 guardrail
- SSE final state 仍只由 `final.data.answerDecision` 決定的 guardrail
- `degraded` 不得成為 public `AnswerDecision` 的 guardrail
- DataAdapter / ConnectorAdapter shared-registry decision 寫入後續 implementation contract
- reference adapter scope 固定為 `admin` + `Orders / Inventory`

**依賴**

- 002 spec
- 002 design
- 001 API / SSE / `AnswerDecision` contract

**驗收條件**

- `POST /api/v1/assistant/sessions/:sessionId/messages` 仍為唯一 public chat request path
- 不新增 `answerDecision = "degraded"` 或 `final.data.answerDecision = "degraded"`
- 不新增第二套 routing runtime 規劃

### Phase 1 - Host Integration Context Foundation

**目的**

建立 `HostIntegrationContext`、`PageContextNormalizer`、`HostAppRegistry` 的基礎模型與服務。

**主要輸出**

- `HostIntegrationContext` internal type
- `sourceSystem` derivation rule
- `PageContextNormalizer`
- normalization / minimization metadata
- `HostAppCapability` static registration
- unsupported host/entity safe path planning
- `x-permission-scopes` CSV normalization integration

**依賴**

- 既有 identity extraction
- 002 spec / design 中的 host context contract

**驗收條件**

- `HostIntegrationContext` 在 identity extraction 後即可建立
- `sourceSystem` 被明確定義為 backend-derived internal value
- unsupported host / entity / screenId / selectedRows interaction 不得 fallback 到 admin adapter
- PageContext 不足時可規劃到 `clarification_required`

### Phase 2 - Data Adapter Contract and Registry

**目的**

建立 DataAdapter read-oriented evidence specialization，並與 existing ConnectorAdapter domain 收斂。

**主要輸出**

- `src/connectors/data-adapter.interface.ts`
- `src/connectors/data-adapter-result.types.ts`
- `src/connectors/data-adapter-registry.service.ts`
- shared health / timeout / permission / audit policy
- architecture guard against parallel routing or degraded mapping

**依賴**

- Phase 0 guardrails
- Phase 1 HostIntegrationContext foundation
- 既有 `ConnectorAdapter` domain

**驗收條件**

- DataAdapter 被定義為 read-oriented evidence specialization
- DataAdapterRegistry 不成為第二套獨立 routing runtime
- connector domain 的 health / timeout / permission / degraded mapping 不出現分叉

### Phase 3 - Admin Orders / Inventory Reference Adapter

**目的**

建立第一個受控 reference integration，不擴成完整 admin connector。

**主要輸出**

- `admin-orders.adapter.ts`
- `admin-inventory.adapter.ts`
- synthetic fixtures
- order status lookup
- order summary
- selected orders comparison
- inventory availability lookup
- inventory summary
- restricted `cost` behavior

**依賴**

- Phase 2 DataAdapter contract / registry
- existing permission / masking / evidence services

**驗收條件**

- scope 僅限 `admin` + Orders / Inventory
- 不擴成 full admin connector / full ERP connector / generic SQL connector / dynamic connector builder
- fixtures 保持 deterministic、synthetic、de-identified

### Phase 4 - Assistant Runtime Integration

**目的**

把 host integration context、PageContext normalization、DataAdapter routing 接入既有 assistant message lifecycle。

**主要輸出**

- existing message request handler 中新增 host-integration 接入點
- `ExecutionPlan` 使用 normalized host context
- connector-domain adapter routing
- permission pre-check before adapter execution
- `EvidenceRef` conversion
- `AnswerDecision` / SSE compatibility

**依賴**

- Phase 1 foundation
- Phase 2 adapter contract
- Phase 3 reference adapter

**驗收條件**

- runtime 路徑為 identity extraction -> HostIntegrationContextService -> PageContextNormalizer -> HostAppRegistry -> query understanding / `ExecutionPlan` -> DataAdapterRegistry -> permission pre-check -> adapter fetchEvidence -> minimization -> `EvidenceRef` -> `AnswerDecision` / SSE final
- `ExecutionPlan` 不直接吃 raw PageContext
- adapter degraded 不得成為 public `AnswerDecision`

### Phase 5 - Safe Paths, Degraded, Audit, Observability

**目的**

處理 unsupported host/entity、missing PageContext、adapter timeout/degraded/unavailable、permission denied、tool failure，並補齊 audit / observability。

**主要輸出**

- `no_answer` / `clarification_required` / `permission_denied` / `tool_failure` mapping
- no public degraded `AnswerDecision`
- audit event / metadata
- dependency status metadata
- no raw error / stack / secret exposure

**依賴**

- Phase 4 runtime integration

**驗收條件**

- public mapping 沿用既有 assistant core safe response
- 不創造新 enum
- audit / observability 記錄 HostApp capability、PageContext normalization、sourceSystem derivation、adapter selection、adapter result、permission masking、EvidenceRef conversion、degraded / timeout

### Phase 6 - Golden Questions and Eval Smoke

**目的**

建立最小 golden question set，驗證 host context aware retrieval 與 grounded answer。

**主要輸出**

- order detail
- selected orders comparison
- inventory detail
- missing PageContext
- unauthorized cost field
- unsupported host/entity
- degraded / timeout

**依賴**

- Phase 3 reference adapter
- Phase 4 / 5 runtime and safe path behavior

**驗收條件**

- expected evidence source 與 expected answerDecision 可被明確驗證
- selectedRows scope only 被驗證
- audit assertions 可被定義

### Phase 7 - Final Contract / Regression Hardening

**目的**

確認不破壞 001 contract，並補齊 privacy / security / architecture guard tests。

**主要輸出**

- existing assistant API unchanged
- SSE final remains `AnswerDecision`-based
- `EvidenceRef` frontend-safe
- no raw connector payload to response/log/audit/LLM
- no second routing runtime
- no complete MES/WMS/SCM/CRM scope creep

**依賴**

- 前六個 phases

**驗收條件**

- regression tests 能鎖住 001 public contract
- architecture guard 能阻止 parallel runtime / degraded mapping 再次出現

## 6. Module and File Plan

### Proposed New Files

- `src/host-integration/host-integration.module.ts`
- `src/host-integration/host-integration-context.service.ts`
- `src/host-integration/page-context-normalizer.service.ts`
- `src/host-integration/host-app-registry.service.ts`
- `src/host-integration/host-app-capability.types.ts`
- `src/host-integration/host-integration-audit.service.ts`
- `src/connectors/data-adapter.interface.ts`
- `src/connectors/data-adapter-registry.service.ts`
- `src/connectors/data-adapter-result.types.ts`
- `src/connectors/admin/admin-orders.adapter.ts`
- `src/connectors/admin/admin-inventory.adapter.ts`
- `src/connectors/admin/admin-reference-fixtures.ts`

### Likely Touched Existing Areas

- `src/assistant/*`
- `src/query-understanding/*`
- `src/permissions/*`
- `src/evidence/*`
- `src/audit/*`
- `src/observability/*`
- `src/connectors/connector-adapter.interface.ts`

### Constraints

- 不直接改 public API contract
- 不把 host-integration 放進 `common`
- 不把 DataAdapter 放進 assistant runtime
- 不新增 connector/data adapter 的第二套 public endpoint
- 不新增 MES/WMS/SCM/CRM production connector

## 7. Data Flow Integration Plan

runtime integration 路徑必須明確為：

```text
existing message request handler
-> existing identity extraction
-> HostIntegrationContextService
-> PageContextNormalizer
-> HostAppRegistry
-> query understanding / ExecutionPlan
-> DataAdapterRegistry
-> permission pre-check
-> adapter fetchEvidence
-> permission masking / minimization
-> EvidenceRef conversion
-> AnswerDecision / SSE final
```

### Integration Rules

- `ExecutionPlan` 使用 normalized host context，不直接使用 raw PageContext
- DataAdapter result 進入 LLM 前必須最小化
- PageContext 不足應進 `clarification_required`
- unsupported host/entity 不得 fallback 到 admin adapter
- adapter degraded 不得成為 public `AnswerDecision`

## 8. Data Adapter / Connector Domain Plan

本計畫明確採用 `same-domain specialized interfaces with shared registry`。

- `ConnectorAdapter` = broader connector / tool contract
- `DataAdapter` = read-oriented evidence specialization
- `DataAdapterRegistry` = connector domain registry consolidation 的第一步

### Architecture Guards Required for Later Tasks

- 不得建立第二套 routing runtime
- 不得建立第二套 health model
- 不得建立第二套 timeout policy
- 不得建立第二套 permission mapping
- 不得建立第二套 degraded mapping

若顯式的 connector registry 尚未產品化，DataAdapterRegistry 應以 connector domain consolidation 的方向實作，而不是與未來 connector registry 競爭。

## 9. Admin Orders / Inventory Reference Adapter Plan

### Scope

- `admin` + Orders / Inventory only

### Explicit Exclusions

- full admin connector
- full ERP connector
- generic SQL connector
- dynamic connector builder

### Synthetic Fixtures

- `SO-10001`
- `status=confirmed`
- `customerName=synthetic customer`
- `cost=restricted field`
- `SKU-001`
- `availableQty=320`
- `reservedQty=40`
- `admin_operator`
- `finance_user`
- `limited_user`

### Planned Behaviors

- detail page entityId lookup
- selectedRows scoped lookup
- order status lookup / summary
- selected orders comparison
- inventory availability / summary
- unauthorized cost field -> `permission_denied` or masked answer
- unsupported entity safe path
- adapter degraded safe path

## 10. Permission / Masking / Minimization Plan

必須設計三層 enforcement：

1. adapter execution 前
2. LLM input 前
3. evidence exposure 前

### Required Rules

- PageContext is not permission
- visibleColumns is not permission
- selectedRows is not authorization

### Planned Alignment

- adapter execution 前：既有 permission pre-check service 擴充
- LLM input 前：既有 sanitizer / masking service 擴充
- evidence exposure 前：`EvidenceRef` / summary sanitizer 擴充

## 11. Evidence / AnswerDecision / SSE Compatibility Plan

planned mapping：

```text
DataAdapterEvidenceResult
-> EvidenceRef
-> existing grounded answer path
-> existing AnswerDecision
-> final.data.answerDecision
```

### Compatibility Guarantees

- `tool_failure` 維持既有 safe-response mapping
- `EvidenceRef` 保持 frontend-safe
- 不新增 public degraded enum
- response 不得包含 raw connector payload
- SSE final state remains `AnswerDecision`-based

## 12. Degraded / Timeout / Safe Response Plan

`degraded` 是 internal dependency / availability state。

### Non-negotiable Rules

- no public `AnswerDecision degraded`
- no `final.data.answerDecision = degraded`
- 不創造新 enum

### Public Mapping

- `no_answer + noAnswerReason=tool_failure`
- safe error envelope
- existing unavailable/degraded UI-compatible flow

這一層必須完全沿用既有 assistant core safe response 語意，而不是新增新的 public contract。

## 13. Audit / Observability Plan

### Planned Events / Metadata

- HostApp capability decision
- PageContext normalization / minimization
- `sourceSystem` derivation
- unsupported host/entity
- adapter selection
- adapter `canHandle`
- adapter `resolveContext`
- adapter `fetchEvidence` success/failure
- permission masking
- `EvidenceRef` conversion
- degraded / timeout
- golden question eval result

### Prohibited Data

- raw connector payload
- raw full PageContext
- raw LLM prompt
- secret
- credential
- token

## 14. Test Plan

### Unit tests

- PageContextNormalizer
- HostAppRegistry
- HostIntegrationContextService
- DataAdapterRegistry
- DataAdapter result minimization
- `sourceSystem` derivation
- permission masking
- degraded mapping does not create public `AnswerDecision`

### Integration tests

- full request context validation
- unsupported host app
- unsupported entityType / screenId
- missing PageContext -> `clarification_required`
- admin order detail evidence answer
- selectedRows scoped lookup
- inventory availability answer
- unauthorized cost field -> `permission_denied` / masked answer
- adapter unavailable / timeout safe path
- audit metadata generated

### Contract tests

- existing assistant message API unchanged
- no second public chat API
- SSE final remains `AnswerDecision`-based
- no `answerDecision = degraded`
- `EvidenceRef` remains frontend-safe
- `tool_failure` remains existing no-answer mapping
- no raw connector payload in response

### Eval / smoke tests

- Admin Orders / Inventory golden questions
- expected evidence source
- expected answerDecision
- selectedRows scope only
- missing PageContext
- unauthorized field
- unsupported host/entity
- adapter degraded / timeout

### Security / privacy tests

- no raw payload to LLM
- no secret / credential / token in logs / audit metadata / response
- PageContext cannot bypass permission check
- visibleColumns cannot grant permission
- selectedRows cannot bypass organization boundary
- frontend cannot specify sourceSystem / connector / arbitrary data source

## 15. Eval / Golden Question Plan

最小 golden question set 應鎖定：

1. admin order detail -> expected evidence source = order, expected answerDecision = answered
2. selected orders comparison -> expected scope = selectedRows only
3. admin inventory detail -> expected evidence source = inventory, expected answerDecision = answered
4. missing PageContext -> expected answerDecision = `clarification_required`
5. unauthorized cost field -> expected `permission_denied` or masked answer
6. unsupported host/entity -> expected `no_answer` / `clarification_required` / safe error
7. degraded / timeout -> expected `no_answer + tool_failure` or existing safe error envelope

每個 eval case 應同時驗證：

- expected public outcome
- expected evidence source 或 scope boundary
- audit / observability metadata
- 無 raw payload / secret / token 外洩

## 16. Security / Privacy Plan

### Core Enforcement

- no raw payload to LLM
- no secret / credential / token in logs / audit metadata / response
- PageContext cannot bypass permission check
- visibleColumns cannot grant permission
- selectedRows cannot bypass organization boundary
- frontend cannot specify sourceSystem / connector / arbitrary data source

### Privacy Constraints

- frontend 只傳 sanitized PageContext / identity headers / session scope / necessary metadata
- adapter output 在進入 LLM 前必須最小化
- fixture data 必須 synthetic / de-identified

## 17. Migration / Data / Fixture Plan

### Migration Decision

No required production DB migration for v1 unless existing `EvidenceRef` / `AuditEvent` persistence shape is insufficient.

### Additional Constraints

- HostAppRegistry v1 不建 DB table
- 不建立 dynamic connector onboarding schema
- fixtures 必須 synthetic / de-identified

### Fixture Plan

- static code-based host registration
- synthetic admin Orders / Inventory fixtures
- no real customer / order / inventory / financial data

## 18. Rollout and Backward Compatibility Plan

### Rollout Strategy

- preserve 001 behavior by default
- add 002 as internal integration layer without API break
- integrate incrementally behind internal module/service boundaries

### Backward Compatibility

- existing assistant message API unchanged
- SSE final remains `AnswerDecision`-based
- no change to public history / feedback / approval contract
- no formal diagnostic endpoint in v1

## 19. Deferred Work

1. Full MES connector
2. Full WMS connector
3. Full SCM connector
4. Full CRM connector
5. dynamic HostApp registry / DB registration
6. self-service adapter onboarding
7. frontend SDK / npm package implementation
8. Web Component / iframe mode
9. full admin connector platform
10. admin UI / CRUD
11. approval management UI
12. production deployment / Kubernetes / Helm
13. optional internal diagnostic endpoint if not included

## 20. Risks and Mitigations

1. **scope creep into full connector**
   將 `admin` + Orders / Inventory only 寫成 phase-level acceptance boundary。

2. **DataAdapter / ConnectorAdapter split-brain**
   鎖定 same-domain specialized interfaces with shared registry，並加入 architecture guard。

3. **frontend sourceSystem / connector injection**
   將 source selection 視為 backend-only authority，超出輸入一律忽略或 fail closed。

4. **PageContext permission bypass**
   拆開 context normalization 與 permission enforcement，避免 PageContext 直接影響授權。

5. **selectedRows organization boundary bypass**
   在 adapter execution 前再次套用 organization boundary 與 permission pre-check。

6. **visibleColumns permission misuse**
   把 visibleColumns 明確限制為 visibility hint only。

7. **raw payload leakage**
   在 adapter result、LLM input、response、audit、logs 全面套用 minimization / redaction。

8. **degraded public enum leakage**
   contract tests + mapping guard 明確禁止 public degraded enum。

9. **breaking frontend 001 SSE / AnswerDecision contract**
   以 Phase 0 / Phase 7 regression hardening 鎖住 final SSE / `AnswerDecision` compatibility。

10. **synthetic fixtures accidentally replaced by real data**
   在 fixture plan、security/privacy plan、tests 中明確要求 deterministic synthetic fixtures only。

## 21. Open Questions

目前無阻塞 v1 `tasks.md` 的 open question。

v1 不新增正式 diagnostic endpoint，只保留 internal/admin diagnostic extension point。若後續真的需要 adapter health / registry inspection，再另開非阻塞 task 或後續 feature。
