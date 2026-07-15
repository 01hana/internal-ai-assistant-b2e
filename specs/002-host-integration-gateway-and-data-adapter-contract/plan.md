# Implementation Plan: Host App Capability Governance and Reference Integration

## 1. Overview

Backend 002 是建立在 Backend 001 `internal-assistant-core` 之上的增量 feature。Backend 001 仍是唯一 public API 與 core runtime owner；Backend 002 不建立新的 Host Integration foundation、不新增 request mode、不新增 public route，也不建立 DataAdapter runtime 或 registry。

Backend 001 的 `AssistantMessageService` 是 message application orchestration owner。`AssistantController` 只負責 transport / DTO entry / identity guard entry / SSE delegation。`AssistantReadonlyRuntimeService` 是 read-only connector/tool execution subflow owner。

Backend 002 v1 的核心增量是：

- HostApp capability governance。
- Stage A Host PageContext policy。
- Stage B Host interaction eligibility。
- selectedRows safety。
- backend-owned source consistency。
- Admin Orders / Inventory reference integration。

本計畫只產生 implementation plan，不產生 `tasks.md`、`data-model.md`、`contracts/**`、`quickstart.md`，也不修改程式碼、測試、Prisma、package 設定或既有 spec/design 文件。

## 2. Source Documents and Constraints

### Source Documents

- `specs/002-host-integration-gateway-and-data-adapter-contract/spec.md`
- `specs/002-host-integration-gateway-and-data-adapter-contract/design.md`
- `specs/001-internal-assistant-core/spec.md`
- `specs/001-internal-assistant-core/design.md`
- `specs/001-internal-assistant-core/plan.md`
- `specs/001-internal-assistant-core/tasks.md`
- `.specify/memory/constitution.md`
- Backend 001 production code and tests in this repository

### Compatibility Note

本 repo 目前未提供額外 `docs/contracts/backend-assistant-core/**` handoff docs。Backend 002 compatibility 以 Backend 001 spec/design/plan/tasks、現有 controller/DTO/service/runtime wiring、contract/integration/e2e tests，以及已驗收的 Backend 002 `spec.md` / `design.md` 作為依據。

### Fixed Inputs / Decisions

- Backend 001 是唯一 assistant core runtime。
- Backend 002 不新增 public route。
- Public API、SSE、`AnswerDecision` 與 top-level `pageContext` 沿用 Backend 001。
- 不新增 nested `hostContext`。
- 不新增 Backend 001 / Backend 002 request mode。
- `sessionScope` 不進 Backend contract。
- 不接收 approval navigation metadata。
- `role`、permission scopes、requestId 規則繼承 Backend 001。
- HostApp Registry v1 採 static code-based registration。
- v1 正式註冊的 Host App 只有 `admin`。
- `mes`、`wms`、`scm`、`crm`、`custom` 只保留 future identifiers。
- `DataAdapter` 與 `DataAdapterRegistryService` 不屬於 v1 產出。
- v1 使用既有 `ConnectorAdapter`、`ToolRegistryService` 與 runtime。
- HostApp capability 只能縮小 eligibility 與 permission，不得提升權限。
- Stage A owner 是 `HostPageContextPolicyService`。
- Stage B owner 是 `HostInteractionEligibilityService`。
- Stage B 只產生 `ProvisionalEligibleTools`。
- `ProvisionalEligibleTools` 不是 authorization proof。
- `ToolPermissionPrecheckService` 仍是 authoritative execution gate。
- selectedRows 最多 20 筆，以上傳原始輸入數量檢查，不先 dedupe。
- selectedRows 任一 row 未授權時，整體 `permission_denied`。
- `sourceSystem` 由 Backend 推導，不由 frontend 指定。
- `sourceSystem` 採 expected derivation + EvidenceRef consistency verification 兩階段。
- source mismatch 固定走既有 `tool_failure` mapping：`no_answer + noAnswerReason=tool_failure`。
- v1 不新增 public `degraded`。
- v1 不新增 public diagnostic endpoint。
- Admin reference fixtures 使用 `ADMIN-SO-10001` 與 `ADMIN-SKU-001`。
- 不覆蓋 Backend 001 既有 fixture。
- Future Host App、dynamic registry、DataAdapter specialization 與 full connectors 延後。

### Non-negotiable Boundaries

- 不重做 Backend 001 assistant core。
- 不新增第二套 public chat API。
- 不破壞既有 session / message / history / feedback / approval API。
- 不建立第二套 identity、PageContext、planner、registry、permission、evidence、answer、audit 或 observability runtime。
- 不一次實作完整 Admin、ERP、MES、WMS、SCM 或 CRM connector。
- 不實作 frontend SDK / widget / npm package。
- 不做 admin UI / CRUD、approval management UI、production deployment / Kubernetes / Helm。
- 不允許 frontend / host app 傳 raw entity data 給 LLM。
- 不允許 PageContext、visibleColumns、role、persona 或 screen capability 取代 permission check。
- 不允許 frontend 決定 connector、data source、candidate tool、permission result 或 `sourceSystem`。
- 不允許 connector result、audit metadata、log、response 或 LLM input 包含 raw secret、credential、token、raw connector payload、raw PageContext、raw selectedRows 或 restricted value。

## 3. Current Architecture Baseline / Reuse Baseline

每一個 phase 都必須優先修改或擴充既有 Backend 001 owner。除新版 design 明確列出的 Backend 002 窄型元件外，不得新建平行 runtime。

| 能力 | Backend 001 owner | Backend 002 plan |
| --- | --- | --- |
| Public request | `AssistantController`, `CreateAssistantSessionDto`, `SendAssistantMessageDto` | 保持不變；controller 只負責 transport / delegation |
| Message orchestration | `AssistantMessageService` | 插入 capability hooks，不建立第二個 orchestrator |
| Identity | `RequestIdentityContext`, `IdentityContextExtractor`, `IdentityGuard`, `validateRequestIdentityContext` | 直接重用，不重新抽取 identity |
| PageContext | `PageContextDto`, `page-context.mapper.ts` | Stage A 只套 host policy，不建立新 public DTO / mapper |
| Context state | `AssistantContextStateService` | 直接重用，不建立第二個 context store |
| Query Understanding | `QueryUnderstandingService`, `QueryUnderstandingPipeline` | 直接重用；Stage A 後才執行 |
| Planning | `AssistantPlanningService`, persisted `ExecutionPlan` | 直接重用；Stage B 在 planning 後縮小候選 |
| Tool registry | `ToolRegistryService`, `ToolDefinition` | 唯一 tool owner；Stage B 只讀既有 metadata |
| Execution | `AssistantReadonlyRuntimeService`, `ConnectorAdapter`, `MockConnectorAdapter` | 直接重用既有 read-only execution subflow |
| Permission | `ToolPermissionPrecheckService`, row-level permission extension points, `LlmInputSanitizerService`, `masking.util.ts` | authoritative owner 不變；Backend 002 只新增 Admin selectedRows revalidation 需求 |
| Evidence | `EvidenceRefService` | 直接重用；host integration 不直接 persist EvidenceRef |
| Answer | `AnswerDecisionService`, `NoAnswerGateService`, `assistant-sse-event.builder.ts` | 直接重用；host integration 不直接建立 public AnswerDecision |
| Audit | `AuditWriterService` | 只新增 minimized metadata |
| Observability | `observability-metadata.helper.ts`, `DependencyHealthService` | 只新增 host-specific metadata |

## 4. Implementation Strategy

整體策略採 test-first 與 contract-sensitive first：

```text
contract / architecture guardrails
-> static HostApp capability
-> Stage A context policy
-> Stage B interaction eligibility
-> existing runtime / permission integration
-> source consistency
-> Admin reference integration
-> safe outcomes / audit / eval / regression
```

每個 phase 在新增 decision point 時，就必須同時完成該 decision point 的 deterministic safe outcome、最小化 audit metadata、observability metadata 與 privacy / redaction tests。Phase 7 只做跨 phase 收斂與補齊，不是第一次接入 audit、safe outcome 或 observability。

### Phase Execution Protocol

每個 phase 必須依照以下順序執行：

1. 先建立 contract / unit / integration failing tests。
2. 確認測試失敗原因是功能尚未實作，不是測試本身錯誤。
3. 實作最小必要功能。
4. 補 architecture / privacy guards。
5. 執行該 phase targeted tests。
6. 執行受影響的 Backend 001 regression tests。
7. 完成 phase acceptance review。
8. 前一 phase 驗收通過後，才能進入下一 phase。

不得採用「先建立所有 services，最後 Phase 8 才補測試」的方式。

## 5. Phase Plan

### Phase 0 - Existing Contract and Architecture Guardrails

#### 目的

在實作 Backend 002 增量能力前，鎖定 Backend 001 public contract 與唯一 runtime ownership。

#### 依賴

- 已驗收的 Backend 002 `spec.md` / `design.md`。
- Backend 001 public API、SSE、`AnswerDecision`、top-level `pageContext` contract。
- 必須先完成本 phase 才能進入 Phase 1。

#### Backend 001 Reuse Owners

- `AssistantController`
- `CreateAssistantSessionDto`
- `SendAssistantMessageDto`
- `assistant-sse-event.builder.ts`
- `AnswerDecisionService`
- `NoAnswerGateService`
- existing architecture modules

#### Backend 002 New Outputs

- Public assistant API unchanged contract guard。
- SSE / `AnswerDecision` unchanged guard。
- top-level `pageContext` unchanged guard。
- no nested `hostContext` guard。
- no backend `sessionScope` guard。
- no second controller / message endpoint guard。
- no second identity / planner / registry / permission / evidence / answer / audit runtime guard。
- no `DataAdapterRegistryService` guard。
- no public `degraded` guard。
- fixture collision guard。

#### Test-first Entry Criteria

- 建立 public API unchanged guards。
- 建立 no second runtime architecture guards。
- 建立 no public degraded guard。
- 建立 fixture collision guard。

#### Implementation Work

- 只建立 contract / architecture guardrails。
- 不先實作產品功能。
- 不硬編 Backend 002 public route。
- 不新增 Backend 002 request mode。

#### Cross-cutting Safe Outcome / Audit / Privacy

- 此 phase 不新增 runtime decision point。
- 測試必須確認 no public degraded、no second runtime 與 no fixture collision。
- 若 guard 失敗，回報為 architecture violation，不新增 public outcome。

#### Acceptance Criteria

- Backend 001 public API / SSE / `AnswerDecision` guard 通過。
- architecture guards 鎖住新版 design 邊界。
- Phase 0 完成前不得建立 Phase 1 產品功能。

### Phase 1 - Static HostApp Capability Registry

#### 目的

建立 Backend 002 第一個真正新增能力：static HostApp capability governance。

#### 依賴

- Phase 0 guardrails。
- Backend 001 identity / tool / permission vocabulary。
- 不可在 Phase 0 未通過前實作。

#### Backend 001 Reuse Owners

- `RequestIdentityContext`
- `ToolRegistryService`
- `ToolDefinition`
- `ToolPermissionPrecheckService`
- `AuditWriterService`

#### Backend 002 New Outputs

- `src/host-integration/host-integration.module.ts`
- `src/host-integration/host-app-capability.types.ts`
- `src/host-integration/host-app-registry.service.ts`
- `src/host-integration/admin-reference-capability.ts`
- `admin` 正式 registration。
- `mes` / `wms` / `scm` / `crm` / `custom` future reserved identifiers。
- capability restriction-only model。

#### Test-first Entry Criteria

- `admin` registration lookup test。
- unregistered host no-fallback test。
- capability cannot elevate permission test。
- connector domain cannot own HostApp authority guard。

#### Implementation Work

- 定義 HostApp capability type。
- 建立 static registry。
- 註冊 `admin` capability。
- 宣告 supported screens、entity types、interactions、eligible tool / connector keys、PageContext allowlist、selectedRows policy、filter allowlist、field exposure policy、permission-scope interpretation 與 unsupported behavior。
- 不建立 DB registry、dynamic registry API 或 admin CRUD。

#### Cross-cutting Safe Outcome / Audit / Privacy

- registered host lookup 必須產生 minimized capability lookup metadata。
- unregistered host 必須使用 deterministic rejection，不 fallback 到 `admin`。
- capability permission interpretation metadata 不得暗示 permission elevation。
- audit metadata 只記錄 host id、decision reason code 與 request correlation。

#### Acceptance Criteria

- `admin` capability 可查詢。
- unregistered host 不得 fallback 到 `admin`。
- capability 不得生成 permission。
- connector domain 不得擁有 HostApp capability authority。

### Phase 2 - Request Boundary and Stage A Host PageContext Policy

#### 目的

在既有 DTO 與 identity validation 後、Query Understanding 前，加入 Stage A context policy。

#### 依賴

- Phase 1 HostApp capability registry。
- Backend 001 request validation 與 PageContext validation。
- Stage A 必須早於 Query Understanding 與 planning integration。

#### Backend 001 Reuse Owners

- existing request validation。
- `PageContextDto`
- `page-context.mapper.ts`
- `IdentityGuard`
- `IdentityContextExtractor`
- existing error envelope。
- `AuditWriterService`

#### Backend 002 New Outputs

- `src/host-integration/host-page-context-policy.service.ts`
- routing-control injection rejection integration。
- screen / entity declaration validation。
- PageContext allowlist / minimization。
- activeFilters allowlist。
- selectedRows shape 與原始數量檢查。
- target conflict detection。
- audit-safe policy metadata。

#### Test-first Entry Criteria

- Stage A before Query Understanding test。
- routing-control rejection test。
- selectedRows raw-count test。
- target conflict test。
- unsupported screen / entity test。
- raw PageContext redaction test。

#### Implementation Work

- 在既有 DTO / identity validation 後接入 Stage A。
- 拒絕 routing-control injection。
- 驗證 screen / entity declaration。
- 套用 PageContext allowlist / minimization。
- 套用 selectedRows raw count 與 shape validation。
- 偵測 `entityId` / selectedRows target conflict。
- 不處理 query intent、interaction、operation、tools、connector eligibility 或 permission-compatible tools。
- 不建立 generic `PageContextNormalizer`。

#### Cross-cutting Safe Outcome / Audit / Privacy

- routing injection -> existing validation / integration error。
- unregistered host -> existing integration error。
- selectedRows shape invalid / 超過 20 筆 -> existing validation / integration error。
- screen / entity unsupported -> `no_answer`。
- target conflict / context ambiguity -> `clarification_required`。
- 每個 early return 都必須寫入 minimized audit metadata。
- raw PageContext、raw selectedRows、raw activeFilters 必須 redacted。

#### Acceptance Criteria

- Stage A 在 Query Understanding 前執行。
- Stage A 不處理 interaction 或 tools。
- raw PageContext 不進 LLM。
- selectedRows 超限在 planning 前終止。

### Phase 3 - Planning Integration and Stage B Interaction Eligibility

#### 目的

在 Query Understanding 與 `ExecutionPlan` 完成後，根據 HostApp capability 縮小候選工具。

#### 依賴

- Phase 2 Stage A policy。
- `QueryUnderstandingService` 與 `AssistantPlanningService` 已產生 `ExecutionPlan`。
- Stage B 必須在 planning 後才可執行。

#### Backend 001 Reuse Owners

- `QueryUnderstandingService`
- `AssistantPlanningService`
- persisted `ExecutionPlan`
- `ToolRegistryService`
- `ToolDefinition`
- `AuditWriterService`

#### Backend 002 New Outputs

- `src/host-integration/host-interaction-eligibility.service.ts`
- interaction eligibility。
- operation eligibility。
- selectedRows comparison eligibility。
- capability tool-key intersection。
- static scope-compatible filtering。
- `ProvisionalEligibleTools`。
- audit-safe eligibility metadata。

#### Test-first Entry Criteria

- Stage B after `ExecutionPlan` test。
- `ProvisionalEligibleTools` test。
- no authorization proof test。
- `ToolDefinition` metadata sourced only from `ToolRegistryService` test。
- unsupported interaction / operation test。

#### Implementation Work

- 在 planning 後接入 `HostInteractionEligibilityService`。
- 從既有 `ToolRegistryService` 讀取 `ToolDefinition` metadata。
- 產生 `ProvisionalEligibleTools`。
- 不修改 Query Understanding authority。
- 不建立第二套 `ExecutionPlan`。
- 不執行 connector。
- 不執行 row-level permission。

#### Cross-cutting Safe Outcome / Audit / Privacy

- unsupported interaction / operation 必須有 deterministic outcome。
- no provisional candidate 必須有 deterministic outcome。
- Stage B eligibility metadata 必須 minimized。
- `ProvisionalEligibleTools` audit 只記錄 safe identifiers。
- 不記錄完整 `ToolDefinition`、raw PageContext 或 raw context。

#### Acceptance Criteria

- Stage B 只在 planning 後執行。
- `ProvisionalEligibleTools` 不是 authorization proof。
- Stage B 不能執行 connector 或 row-level permission。
- `ToolDefinition` metadata 只從既有 Tool Registry 取得，不複製 registry。

### Phase 4 - Existing Readonly Runtime and Authoritative Permission Integration

#### 目的

把 Stage B 產生的 provisional 候選接入既有 read-only execution subflow，並完成 authoritative permission 與 selectedRows 逐筆重驗證。

#### 依賴

- Phase 3 `ProvisionalEligibleTools`。
- Backend 001 read-only runtime 與 permission services。
- 必須早於 Admin reference 完整驗收。

#### Backend 001 Reuse Owners

- `AssistantMessageService`
- `AssistantReadonlyRuntimeService`
- `ToolRegistryService`
- `ToolPermissionPrecheckService`
- row-level extension points
- `ConnectorAdapter`
- `LlmInputSanitizerService`
- masking utilities
- `AuditWriterService`

#### Backend 002 New Outputs

- `AssistantMessageService` 中的 Backend 002 hooks。
- `AssistantReadonlyRuntimeService` integration。
- selectedRows organization / row-level revalidation hook。
- connector execution ordering guard。
- permission / row-level telemetry metadata。

#### Test-first Entry Criteria

- pre-check before connector execution test。
- selectedRows revalidation before full retrieval test。
- mixed unauthorized whole-request denial test。
- no legal subset processing test。
- controller not orchestrating full chain guard。

#### Implementation Work

- 將 provisional 候選接入 `AssistantReadonlyRuntimeService`。
- 透過 `ToolRegistryService` resolve tool。
- 在 `ConnectorAdapter` execution 前執行 `ToolPermissionPrecheckService`。
- 在完整資料取得前逐筆驗證 selectedRows organization / row-level permission。
- 套用既有 masking 與 `LlmInputSanitizerService`。

#### Cross-cutting Safe Outcome / Audit / Privacy

- permission denial -> `permission_denied`。
- mixed unauthorized selectedRows -> whole-request `permission_denied`。
- row-level denial 不揭露失敗 ID。
- authoritative pre-check audit metadata 必須 minimized。
- connector execution 前 permission ordering telemetry 必須可測。
- 未授權 entity data 不得被查詢、記錄、暴露或送入 LLM。

#### Acceptance Criteria

- Controller 不協調完整 service chain。
- Permission 一定先於 connector execution。
- selectedRows 完整資料只在全部授權後取得。
- 任一 row 失敗時整體 `permission_denied`。
- 不處理合法 subset。
- 不建立第二套 permission engine。

### Phase 5 - Backend-owned Source Derivation and Evidence Consistency

#### 目的

在既有 connector / evidence path 中加入來源治理，不建立第二套 Evidence truth。

#### 依賴

- Phase 4 read-only runtime integration。
- Existing connector result 與 `EvidenceRefService` path。
- 必須早於 grounded Admin reference acceptance 完成。

#### Backend 001 Reuse Owners

- `AssistantReadonlyRuntimeService`
- `ConnectorAdapter`
- `LlmInputSanitizerService`
- `EvidenceRefService`
- `AnswerDecisionService`
- `NoAnswerGateService`
- `AuditWriterService`
- observability helpers

#### Backend 002 New Outputs

- `src/host-integration/source-system-resolver.service.ts`
- expected source derivation。
- EvidenceRef source consistency verification。
- source mismatch audit metadata。
- source mismatch safe mapping。

#### Test-first Entry Criteria

- expected source derivation test。
- evidence consistency pass test。
- source mismatch `tool_failure` test。
- no grounded answer on mismatch test。
- no public `source_mismatch` enum guard。

#### Implementation Work

- 在 masking / sanitizer 後推導 expected source。
- 在 `EvidenceRefService` normalization / persistence 後驗證 actual evidence source。
- 將 source mismatch 映射到 existing `tool_failure`。
- 不自動覆蓋或修補 source。
- 不建立 source registry 或 evidence store。

#### Cross-cutting Safe Outcome / Audit / Privacy

- expected source derivation metadata 必須 minimized。
- source consistency pass / fail metadata 必須 audit-safe。
- source mismatch -> `no_answer + noAnswerReason=tool_failure`。
- mismatch 不產生 grounded answer。
- 不記錄 raw evidence 或 connector payload。

#### Acceptance Criteria

- `sourceSystem` 不得來自 frontend。
- expected source 與 actual evidence source 都有可測依據。
- mismatch 不產生 grounded answer。
- 不建立第二套 source truth。

### Phase 6 - Admin Orders / Inventory Reference Integration

#### 目的

使用既有 Tool / Connector / Permission / Evidence runtime 完成第一個 reference acceptance。

#### 依賴

- Phase 5 source consistency。
- Existing connector/runtime/permission/evidence path。
- 必須在 authoritative permission 與 source consistency 可用後才完整驗收。

#### Backend 001 Reuse Owners

- `MockConnectorAdapter` 或實際 existing connector。
- `ToolRegistryService`
- existing `ToolDefinition`
- permission / masking / EvidenceRef / AnswerDecision pipeline
- `AuditWriterService`

#### Backend 002 New Outputs

- `admin` capability 對應 existing tool / connector keys。
- namespaced synthetic fixtures：`ADMIN-SO-10001`、`ADMIN-SKU-001`。
- order status。
- order summary。
- selected orders comparison。
- inventory availability。
- inventory summary。
- restricted cost behavior。
- unsupported capability cases。
- timeout / unavailable case。

#### Test-first Entry Criteria

- Admin namespaced fixture tests。
- existing connector runtime usage test。
- cost permission tests。
- Orders / Inventory golden integration tests。
- no mandatory Admin adapter architecture test。

#### Implementation Work

- 優先沿用 `MockConnectorAdapter` 或既有 connector。
- 僅擴充必要 `ToolDefinition` 與 fixtures。
- 不預設新增 `AdminOrdersAdapter` 或 `AdminInventoryAdapter`。
- 只有測試證明既有 connector contract 無法承載時，才允許新增 Admin-specific `ConnectorAdapter`。
- 即使新增，也必須走既有 Tool Registry 與 runtime。

#### Cross-cutting Safe Outcome / Audit / Privacy

- 純 cost 問題 -> `permission_denied`。
- mixed 問題可不誤導 partial answer -> 僅回答授權部分。
- mixed 問題會誤導 -> `permission_denied`。
- unsupported reference capability -> deterministic safe outcome。
- timeout / unavailable -> existing `tool_failure`。
- Admin fixture scope audit 必須 minimized。
- restricted cost 不得進 LLM / EvidenceRef / response / log / audit。

#### Acceptance Criteria

- 不覆蓋 Backend 001 既有 fixture。
- 不擴成完整 Admin / ERP connector。
- `finance_user` 名稱本身不能取得 cost；必須依既有 permission scope。
- restricted field 遵守既有 permission 與 masking。
- reference integration 不建立獨立 runtime。

### Phase 7 - Safe Outcome, Audit and Observability Consolidation

#### 目的

收斂與驗證 Phase 1～6 已經落地的 safe outcome、audit、observability 與 privacy coverage。Phase 7 只負責 cross-phase consistency consolidation、共用 metadata helper、safe outcome coverage review、early-return audit coverage review、reason code consistency、regression assertions 與補齊遺漏。

#### 依賴

- Phase 1～6 的所有 decision points 已各自完成 deterministic outcome、audit、observability 與 privacy work。
- Phase 7 不得作為第一次接入 audit / safe outcome 的 phase。

#### Backend 001 Reuse Owners

- `AuditWriterService`
- observability metadata helpers
- `DependencyHealthService`
- `AnswerDecisionService`
- `NoAnswerGateService`
- existing reason-code helpers

#### Backend 002 New Outputs

- `src/host-integration/host-integration-metadata.helper.ts`
- all-decision-point coverage matrix。
- reason code consolidation。
- metadata schema consistency。
- early-return audit regression。
- redaction regression。
- observability completeness assertions。

#### Test-first Entry Criteria

- all early-return audit coverage matrix。
- safe outcome consistency matrix。
- metadata minimization tests。
- observability reason code coverage。

#### Implementation Work

- 收斂共用 metadata helper。
- 檢查 Phase 1～6 所有 decision points 都已有 audit。
- 檢查 reason code 一致性。
- 補齊 observability coverage。
- 補齊 early-return regression 與 redaction regression。

#### Cross-cutting Safe Outcome / Audit / Privacy

- 不首次建立 Stage A audit。
- 不首次建立 Stage B audit。
- 不首次建立 selectedRows denial audit。
- 不首次建立 permission denial audit。
- 不首次建立 source mismatch audit。
- 不首次建立 restricted field audit。
- 不首次建立 timeout outcome mapping。
- 補齊遺漏時仍必須只記錄 minimized metadata，不記錄 raw payload。

#### Acceptance Criteria

- Phase 1～6 所有 decision points 都有 deterministic outcome、minimized audit、observability metadata 與 privacy/redaction coverage。
- 不建立 `HostIntegrationAuditService` writer。
- 只使用 `AuditWriterService`。
- 不新增 public enum。

### Phase 8 - Golden Questions, Privacy, Contract and Architecture Hardening

#### 目的

證明 Backend 002 增量能力可用，且未破壞 Backend 001。

#### 依賴

- Phase 0～7 全部完成。
- 所有 feature behavior、safe outcomes、audit/observability coverage 已可測。

#### Backend 001 Reuse Owners

- existing contract tests。
- integration / e2e harness。
- architecture test utilities。
- privacy test utilities。
- build pipeline。

#### Backend 002 New Outputs

- Admin Orders / Inventory golden questions。
- eval smoke。
- privacy regression。
- contract regression。
- source consistency tests。
- selectedRows scope tests。
- architecture guards。
- Backend 001 Admin capability path 以外流程的 regression。

#### Test-first Entry Criteria

- full contract regression。
- full architecture regression。
- privacy regression。
- eval smoke。
- build。
- affected Backend 001 suites。
- Backend 002 complete suite。

#### Implementation Work

- 補齊 golden question manifest 與 eval smoke。
- 執行 full regression 與 build。
- 確認 no second runtime / no fixture collision / no scope creep。
- 確認 Backend 001 Admin capability path 以外流程維持不變。

#### Cross-cutting Safe Outcome / Audit / Privacy

- eval cases 必須驗證 public outcome、evidence source/scope、audit/observability metadata。
- privacy regression 必須驗證 raw PageContext、raw selectedRows、restricted values、routing-control values、secret/token/credential 不外洩。

#### Acceptance Criteria

- existing public API / SSE / `AnswerDecision` 保持不變。
- expected evidence source 可驗證。
- selectedRows 只查授權範圍。
- restricted values 零洩漏。
- source mismatch 不回答。
- no second registry / permission / evidence / audit runtime。
- no fixture collision。
- no scope creep 到 MES / WMS / SCM / CRM。
- 全部測試與 build 通過後才完成 feature。

## 6. Phase Dependencies

核心依賴順序：

```text
Phase 0
  ↓
Phase 1
  ↓
Phase 2
  ↓
Phase 3
  ↓
Phase 4
  ↓
Phase 5
  ↓
Phase 6
  ↓
Phase 7
  ↓
Phase 8
```

依賴規則：

- Phase 0 必須先完成。
- Phase 1 是 Stage A / Stage B 的 capability 來源。
- Stage A 必須早於 planning integration。
- Stage B 必須依賴 Query Understanding / `ExecutionPlan`。
- Authoritative permission integration 必須早於 Admin reference 完整驗收。
- Source consistency 必須早於 grounded reference acceptance 完成。
- Phase 7 依賴 Phase 1～6 已各自完成 safe outcome / audit / observability 初始接入。
- Final hardening 依賴所有功能 phase。
- 不保留 DataAdapter Registry phase。
- 不保留 HostIntegrationContext foundation phase。
- 不要求 Admin adapters 早於 runtime integration。

## 7. Module and File Plan

### Proposed New Files

```text
src/host-integration/
├── host-integration.module.ts
├── host-app-capability.types.ts
├── host-app-registry.service.ts
├── admin-reference-capability.ts
├── host-page-context-policy.service.ts
├── host-interaction-eligibility.service.ts
├── source-system-resolver.service.ts
└── host-integration-metadata.helper.ts
```

### Likely Touched Existing Areas

- `src/assistant/**`
- `src/query-understanding/**`
- `src/tools/**`
- `src/connectors/**`
- `src/permissions/**`
- `src/evidence/**`
- `src/audit/**`
- `src/observability/**`
- existing module wiring

### Reference Fixtures

Namespaced reference fixtures should live in the location that best matches existing connector / test fixture ownership. The plan does not require Admin-specific adapters. Backend 002 fixtures must use `ADMIN-SO-10001` and `ADMIN-SKU-001` and must not override Backend 001 mock fixtures or fixture load order.

### Explicitly Not Baseline Planned Files

- `src/host-integration/host-integration-context.service.ts`
- `src/host-integration/page-context-normalizer.service.ts`
- `src/host-integration/host-integration-audit.service.ts`
- `src/connectors/data-adapter.interface.ts`
- `src/connectors/data-adapter-result.types.ts`
- `src/connectors/data-adapter-registry.service.ts`
- `src/connectors/admin/admin-orders.adapter.ts`
- `src/connectors/admin/admin-inventory.adapter.ts`

Only a later feature or a test-proven connector contract gap may reopen Admin-specific connector implementation, and it must still implement `ConnectorAdapter` and run through existing Tool Registry / runtime.

## 8. Data Flow Integration Plan

Runtime integration uses the accepted nested ownership model:

```text
AssistantController
-> AssistantMessageService
    -> existing DTO / identity validation
    -> routing-control injection rejection
    -> HostAppRegistryService
    -> HostPageContextPolicyService               # Stage A
    -> QueryUnderstandingService
    -> AssistantPlanningService / ExecutionPlan
    -> HostInteractionEligibilityService          # Stage B
        -> ProvisionalEligibleTools
    -> AssistantReadonlyRuntimeService
        -> ToolRegistryService
        -> ToolPermissionPrecheckService
        -> selectedRows row-level revalidation
        -> ConnectorAdapter execution
        -> masking / LlmInputSanitizerService
        -> expected source derivation
        -> EvidenceRefService
        -> source consistency verification
    -> AnswerDecisionService / NoAnswerGateService
    -> SSE final
    -> AuditWriterService / observability
```

Integration rules:

- Audit is not only a final step; every early termination writes minimized audit metadata before returning.
- Stage A does not handle interaction.
- Stage B does not authorize execution.
- Permission and row validation happen before connector execution.
- `AnswerDecisionService` runs after source consistency verification.
- Host integration module never becomes the full message lifecycle owner.

## 9. Connector / Tool Plan

V1 does not add a `DataAdapter` abstraction. Existing `ConnectorAdapter`, `ToolDefinition`, `ToolRegistryService`, and `AssistantReadonlyRuntimeService` are sufficient for the reference integration.

Rules:

- `ConnectorAdapter` remains the connector/tool execution contract.
- `ToolRegistryService` remains the only tool lookup and active metadata owner.
- `AssistantReadonlyRuntimeService` remains the read-only execution subflow.
- `DataAdapterRegistryService` is not created.
- DataAdapter result type is not created.
- Adapter-specific health / timeout / permission / degraded policy is not created.
- Future DataAdapter specialization may be evaluated only by a later feature after a concrete contract gap is proven.

## 10. Permission / Masking / Minimization Plan

Candidate filtering and authoritative permission are distinct.

Candidate filtering by `HostInteractionEligibilityService`:

- capability intersection。
- static required scope compatibility。
- output only `ProvisionalEligibleTools`。
- no authorization proof。
- no row-level permission。
- no final field exposure。

Authoritative permission by Backend 001:

- `ToolPermissionPrecheckService`。
- operation permission。
- organization boundary。
- selectedRows row-level extension。
- masking。
- `LlmInputSanitizerService`。
- Evidence exposure safety。

Rules:

- Capability must not generate permission.
- Provisional candidate is not authorization.
- selectedRows per-row validation happens before complete data retrieval.
- Any unauthorized selected row rejects the whole comparison with `permission_denied`.
- Legal subset processing is not allowed for mixed authorized / unauthorized selectedRows.
- Final field exposure owner remains Backend 001 permission / masking / evidence safety.

## 11. Evidence / AnswerDecision / SSE Compatibility Plan

Use existing evidence and answer flow:

```text
existing connector result
-> existing masking / sanitizer
-> expected source derivation
-> EvidenceRefService
-> evidence source consistency verification
-> existing AnswerDecision / SSE
```

Compatibility guarantees:

- Host integration does not directly persist EvidenceRef.
- Host integration does not directly create AnswerDecision.
- source mismatch uses existing `tool_failure` mapping.
- `degraded` never becomes a public outcome.
- SSE final contract is unchanged.
- raw connector result never enters response.

## 12. Safe Outcomes Plan

Fixed safe outcomes:

- routing-control injection -> existing request / integration error envelope.
- unregistered host in capability-governed request flow -> existing request / integration error envelope.
- selectedRows invalid shape / over 20 -> existing request / integration error envelope.
- context ambiguity / target conflict -> `clarification_required`.
- unsupported registered screen / entity / interaction -> `no_answer` with existing internal reason.
- permission failure -> `permission_denied`.
- pure restricted cost question without permission -> `permission_denied`.
- misleading mixed allowed/restricted field answer -> `permission_denied`.
- timeout / unavailable -> existing `tool_failure`.
- source mismatch -> existing `tool_failure`.

No new public `degraded`, `source_mismatch`, or Backend 002-specific `AnswerDecision` enum is introduced.

## 13. Audit / Observability Plan

Audit / observability are cross-cutting requirements for every phase that adds a decision point. Phase 7 consolidates and reviews coverage; it is not the first audit integration phase.

Planned host-specific metadata:

- HostApp capability lookup result.
- Stage A PageContext policy decision.
- selectedRows count / shape / rejection reason.
- Stage B eligibility decision.
- provisional tool keys.
- final selected tool/connector key.
- backend-derived `sourceSystem`.
- source consistency mismatch reason code.
- permission denial reason.
- dependency status.
- safe outcome reason.
- golden question eval result.

Prohibited data:

- raw PageContext.
- raw selectedRows.
- raw activeFilters.
- unauthorized row raw data.
- restricted value.
- raw connector payload.
- raw LLM prompt.
- raw exception / stack trace.
- secret / credential / token / connection string.

Audit persistence must go through `AuditWriterService`. Observability must reuse existing helpers and `DependencyHealthService`.

## 14. Test Plan

### Unit Tests

- HostApp Registry.
- Stage A policy.
- Stage B eligibility.
- `ProvisionalEligibleTools`.
- capability cannot elevate permission.
- selectedRows raw count.
- source expected derivation.
- evidence consistency.
- metadata minimization.

### Integration Tests

- actual orchestration owner and hook order.
- Stage A before Query Understanding.
- Stage B after `ExecutionPlan`.
- authoritative pre-check before connector execution.
- selectedRows per-row revalidation.
- existing connector/runtime is used.
- source mismatch fixed `tool_failure`.
- Admin Orders / Inventory reference cases.

### Contract / Regression Tests

- public routes unchanged.
- top-level `pageContext` unchanged.
- no nested `hostContext`.
- no backend `sessionScope`.
- SSE / `AnswerDecision` unchanged.
- no public `degraded`.
- no public diagnostic endpoint.
- unregistered HostApp cannot bypass registry in capability-governed request flow.
- history / feedback / approval / action draft / escalation existing flows are unaffected.
- Backend 002 Admin capability path outside existing Backend 001 flows remains unchanged.

### Architecture Tests

- no second identity.
- no second planner.
- no `DataAdapterRegistryService`.
- no second permission engine.
- no second evidence mapper.
- no second audit writer.
- no controller orchestration expansion.
- no connector execution before permission.
- no fixture collision.

### Privacy Tests

- raw PageContext / selectedRows do not enter LLM, response, audit, log, or observability.
- restricted value does not enter EvidenceRef.
- routing-control value does not enter audit.
- no secret / token / credential leakage.

## 15. Eval / Golden Question Plan

Golden questions must cover:

1. Admin order status for `ADMIN-SO-10001`.
2. Admin order summary for `ADMIN-SO-10001`.
3. selected orders comparison with selectedRows scope only.
4. inventory availability for `ADMIN-SKU-001`.
5. inventory summary for `ADMIN-SKU-001`.
6. missing / ambiguous PageContext -> `clarification_required`.
7. unsupported registered screen / entity / interaction -> `no_answer`.
8. unregistered host in capability-governed request flow -> existing request / integration error envelope.
9. unauthorized restricted cost -> `permission_denied`.
10. timeout / unavailable -> `tool_failure`.
11. source mismatch -> `tool_failure` and no grounded answer.

Each case validates public outcome, expected evidence source/scope, audit/observability metadata, and no raw payload / secret / token leakage.

## 16. Security / Privacy Plan

Security model:

- Backend 001 identity and permission services are authoritative.
- HostApp capability is an eligibility constraint, not a permission source.
- Stage B provisional filtering is not authorization.
- selectedRows are request-scoped context only, not authorization proof.
- visibleColumns is a hint only.
- restricted values are excluded before LLM / EvidenceRef / response / log / audit.
- frontend cannot specify `sourceSystem`, connector, adapter, data source, candidate tool, permission result, or final evidence source.

## 17. Migration / Data / Fixture Plan

No production migration planned for v1.

Persistence decisions:

- No HostAppRegistry DB table.
- No dynamic registry table.
- No DataAdapter registry table.
- No frontend-controlled persisted `sourceSystem`.
- No production schema change unless a later task proves existing `EvidenceRef` / `AuditEvent` cannot carry required safe metadata.

Fixture decisions:

- Admin reference fixtures are synthetic and de-identified.
- Use `ADMIN-SO-10001` and `ADMIN-SKU-001`.
- Do not override Backend 001 fixtures such as `SO-10001` or `SKU-001`.
- Do not change fixture load order for existing IDs.
- Do not use real customer, order, inventory, or financial data.

## 18. Rollout and Backward Compatibility Plan

Backend 002 is introduced through internal module / service hooks. It does not add a frontend transport mode, public diagnostic endpoint, or Backend 002 request mode.

### Type A - HostApp capability-governed request flow

These requests require `hostApp`, screen, entity, interaction, capability, and connector eligibility decisions. If the HostApp is unregistered:

- use existing request / integration error envelope.
- do not fallback to `admin`.
- do not enter Stage A follow-up planning.
- do not enter connector / tool execution.
- do not bypass registry through Backend 001 generic answer flow.

### Type B - Existing Backend 001 flows outside Backend 002 Admin capability path

Examples include history, feedback, approval, action draft, escalation, existing functions that do not require HostApp capability routing, and existing non-Admin reference paths that do not trigger Backend 002 capability governance.

These flows:

- preserve Backend 001 public behavior.
- are not changed by Backend 002 hooks.
- do not gain a new request mode.
- are not rewritten merely because HostApp Registry exists.

Regression tests must cover both Type A unregistered HostApp rejection and Type B unchanged existing flows.

## 19. Deferred Work

1. Full MES connector.
2. Full WMS connector.
3. Full SCM connector.
4. Full CRM connector.
5. dynamic HostApp registry / DB registration.
6. self-service adapter onboarding.
7. frontend SDK / npm package implementation.
8. Web Component / iframe mode.
9. full Admin connector platform.
10. admin UI / CRUD.
11. approval management UI.
12. production deployment / Kubernetes / Helm.
13. public diagnostic endpoint.
14. DataAdapter specialization, if a later feature proves a concrete contract gap.

## 20. Risks and Mitigations

1. **Parallel runtime reappears**
   Mitigation: Phase 0 and Phase 8 architecture guards reject second identity, PageContext, planner, registry, permission, evidence, answer, audit, and observability runtimes.

2. **Controller orchestration expands**
   Mitigation: keep `AssistantController` transport/delegation only; integrate hooks through `AssistantMessageService`.

3. **Stage A / Stage B responsibility drifts**
   Mitigation: Stage A has no query/interaction/tool responsibility; Stage B is the only post-planning eligibility owner.

4. **Provisional filtering is misused as authorization**
   Mitigation: `ProvisionalEligibleTools` is explicitly not authorization proof; `ToolPermissionPrecheckService` remains authoritative.

5. **Capability elevates permission**
   Mitigation: capability can only restrict verified Backend 001 permissions; stricter result wins.

6. **selectedRows leaks unauthorized data**
   Mitigation: validate organization and row-level permission before complete data retrieval; any failing row rejects the whole comparison.

7. **Connector execution happens before permission**
   Mitigation: Phase 4 acceptance and architecture tests require pre-check and row validation before `ConnectorAdapter` execution.

8. **`sourceSystem` becomes frontend-controlled**
   Mitigation: routing-control fields are rejected at request boundary; source is derived only from backend-selected tool/connector/evidence metadata.

9. **Expected / actual source mismatch**
   Mitigation: Phase 5 consistency verification maps mismatch to `tool_failure` and prevents grounded answer generation.

10. **Fixture ID collision**
    Mitigation: use namespaced `ADMIN-SO-10001` / `ADMIN-SKU-001`; tests guard against overriding Backend 001 fixtures.

11. **Audit metadata leaks raw payload**
    Mitigation: each phase owns minimized audit for its decision points; Phase 7 consolidates reason codes and redaction coverage through `AuditWriterService`.

12. **Scope creep becomes full connector platform**
    Mitigation: Admin reference scope is fixed; future DataAdapter/full connector work is deferred to later features.

13. **Backend 001 regression**
    Mitigation: Phase 0 and Phase 8 contract/regression tests cover public API, SSE, `AnswerDecision`, top-level `pageContext`, Type A unregistered HostApp rejection, and Type B existing flows outside Backend 002 Admin capability path.

## 21. Downstream Tasks Rewrite Rules

Future `tasks.md` must follow these rules:

1. `tasks.md` 必須完全依新版 Phase 0～8 分組。
2. 可以重新編 Task IDs，不必保留舊 T001～T044。
3. 每個 phase 必須先測後實。
4. 每個 task 必須標明是修改 existing Backend 001 owner，或新增 Backend 002 窄型元件。
5. 不建立 `HostIntegrationContextService`。
6. 不建立 `HostIntegrationContext foundation`。
7. 不建立 generic `PageContextNormalizer`。
8. 不建立 `DataAdapter`。
9. 不建立 `DataAdapterRegistryService`。
10. 不建立 `DataAdapterEvidenceResult`。
11. 不建立 `HostIntegrationAuditService`。
12. 不建立 degraded mapper。
13. 不建立 second EvidenceRef mapper。
14. 不建立 second permission engine。
15. 不預設建立 `AdminOrdersAdapter`。
16. 不預設建立 `AdminInventoryAdapter`。
17. Stage A 與 Stage B 必須拆成不同 tasks。
18. `ProvisionalEligibleTools` 與 authoritative permission 必須拆成不同 tasks。
19. `ToolPermissionPrecheckService` 與 selectedRows row-level revalidation 必須有獨立測試。
20. Connector execution ordering 必須有明確 task 與 architecture guard。
21. Expected source derivation 與 Evidence consistency verification 必須拆成不同 tasks。
22. Source mismatch fixed mapping 必須有獨立 test。
23. 各 decision point 的 audit / observability / privacy 要求必須跟著該功能 task 完成。
24. 不得只在最後建立一個大型「補 audit」task。
25. Admin fixtures 必須使用 `ADMIN-SO-10001` 與 `ADMIN-SKU-001`。
26. 不得覆蓋 Backend 001 fixture。
27. Runtime wiring 必須修改 `AssistantMessageService`、`AssistantReadonlyRuntimeService`、existing Tool / Permission / Evidence pipeline。
28. 不得新增 parallel orchestrator。
29. Phase 8 必須包含完整 Backend 001 regression。
30. Final architecture guards 必須鎖住 no-second-runtime。

後續產生 `tasks.md` 時，不能只重新排列舊 tasks，必須刪除與新版 spec/design/plan 衝突的舊 task。

## 22. Open Questions

No blocking open questions for v1 `tasks.md`.

Future diagnostic endpoints, dynamic HostApp registration, full connector rollout, and DataAdapter specialization are deferred unless a later feature spec reopens them.
