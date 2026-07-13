# Design: Host Integration Gateway and Data Adapter Contract

**Feature Branch**: `002-host-integration-gateway-and-data-adapter-contract`

**Created**: 2026-07-13

**Source Spec**: [`spec.md`](./spec.md)

**Status**: Draft

## 1. Overview

本設計文件定義 backend 002 的技術設計：在既有 `001-internal-assistant-core` 之上建立 Host Integration Gateway 與 Data Adapter Contract，使 internal assistant core 能安全接收不同 host app 的 identity、permission scopes、organization boundary、PageContext、session scope 與 routing hints，並以 `admin` + `Orders / Inventory` 作為第一個 reference integration。

本文件不是重做 assistant core，也不是完整 `/speckit-plan` 的設計產物集合。本次只產生單一 `design.md`，供後續 `plan.md` 與 `tasks.md` 使用。它聚焦在 module architecture、service boundary、request lifecycle、adapter interface、evidence integration、safe-path mapping、audit/observability 與 test strategy。

本設計必須維持以下不變：

- 不新增另一套 public chat API。
- 不重做既有 session / message / SSE / feedback / approval API。
- 不實作 frontend SDK / widget / npm package。
- 不一次實作完整 MES / WMS / SCM / CRM connector。
- 不做完整 admin connector、admin UI / CRUD、approval management UI、production deployment / Kubernetes / Helm。
- 不允許 frontend / host app 傳 raw entity data 給 LLM。
- 不允許 PageContext 取代 permission check。
- 不允許 frontend 決定 connector、任意 data source 或最終 `sourceSystem`。
- 不允許新增 public `answerDecision = "degraded"`。

## 2. Scope and Non-goals

本 feature 的 in-scope 是建立 host integration backend layer，讓 assistant core 可以在既有請求生命週期中安全理解 host app context，並把 `admin` 的 Orders / Inventory 資料查詢能力接上既有 evidence pipeline。

本 feature 的 non-goals 是任何會把範圍擴成平行平台或完整產品面：

- 不建立第二套聊天入口或第二套 SSE contract。
- 不建立 full Admin connector platform。
- 不建立 frontend context provider implementation。
- 不建立完整 adapter onboarding platform、dynamic registry UI 或 DB-driven host registration。
- 不建立新的 public `AnswerDecision` enum。

## 3. Relationship to 001 Internal Assistant Core

backend 002 是 001 assistant core 的 extension layer，不是 replacement layer。其角色是把 host app 差異限制在 host integration 與 adapter boundary 內，讓既有 001 assistant runtime 繼續負責：

- identity boundary enforcement
- query understanding
- `ExecutionPlan`
- permission pre-check
- `AnswerDecision`
- `EvidenceRef`
- SSE final state
- feedback / review
- approval / escalation
- audit / observability

002 的責任是補上 001 中尚未產品化的 host integration concerns：

- Host Integration Context normalization
- PageContext validation / normalization / minimization
- HostApp capability lookup
- reference adapter routing for host-aware structured evidence
- adapter degraded / timeout mapping to existing 001 safe response semantics

002 不改寫 001 的 public contract。assistant request 仍走既有 `POST /api/v1/assistant/sessions/:sessionId/messages`，history / feedback / approval 仍沿用 001 public contract，SSE final state 仍由 `final.data.answerDecision` 決定。

## 4. Existing Backend Architecture Assumptions

目前 repo 已存在並可重用的 bounded contexts 包含：

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

目前已存在的重要現況：

- `src/connectors/connector-adapter.interface.ts` 已定義既有 connector domain contract。
- `src/assistant/planning/assistant-planning.types.ts` 已定義 `ExecutionPlan` 輸入輸出與 persistence shape。
- `src/assistant/answer/answer-decision.types.ts` 已定義既有 `AnswerDecision` recording contract。
- `src/identity/identity-context.types.ts` 已定義 request identity context。
- `src/permissions/tool-permission-precheck.service.ts` 與 `src/permissions/llm-input-sanitizer.service.ts` 已提供既有 permission 與 LLM input sanitization 基礎。
- `src/assistant/runtime/assistant-readonly-runtime.service.ts` 已示範 read-only tool / connector -> sanitization -> answer flow。

因此 002 設計應擴充既有 domain boundary，而不是在 `common` 或另一個平行 runtime 中重建 assistant pipeline。

另有一項明確現況：`docs/contracts/backend-assistant-core/` 目前不存在，因此本設計沒有額外 backend handoff contract docs 可參考。

## 5. Target Module Architecture

002 建議新增的 backend internal modules / services 如下：

```text
src/host-integration/
├── host-integration.module.ts
├── host-integration-context.service.ts
├── page-context-normalizer.service.ts
├── host-app-registry.service.ts
├── host-app-capability.types.ts
└── host-integration-audit.service.ts

src/connectors/
├── connector-adapter.interface.ts           # 既有
├── data-adapter.interface.ts
├── data-adapter-registry.service.ts
└── data-adapter-result.types.ts

src/connectors/admin/
├── admin-orders.adapter.ts
├── admin-inventory.adapter.ts
└── admin-reference-fixtures.ts
```

### Module Boundary Decisions

- `src/host-integration/`：負責 host context normalization、PageContext normalization、HostApp capability lookup、host integration audit metadata。
- `src/connectors/`：保留 connector / adapter domain。Data Adapter Contract v1 應該靠近既有 connector abstraction，而不是跑去 `common`。
- `src/assistant/`：仍負責 orchestrate 既有 message lifecycle、query understanding、`ExecutionPlan`、answer generation、SSE。
- `src/permissions/`：仍負責 adapter execution 前 permission pre-check、LLM 前 masking / minimization、evidence exposure sanitizer。
- `src/evidence/`：仍負責將 adapter result 轉為既有 `EvidenceRef`。
- `src/audit/` 與 `src/observability/`：仍負責 append-only audit event 與 dependency / metadata recording。

### Data Adapter 與 ConnectorAdapter 的收斂方向

repo 已有 `ConnectorAdapter`：

- `listTools()`
- `execute(input)`
- `healthCheck()`

002 明確採用 `same-domain specialized interfaces with shared registry`。`ConnectorAdapter` 保留既有 broader tool / connector contract；`DataAdapter` 是 connector domain 內的 read-oriented evidence adapter specialization，專門負責 host-aware structured evidence retrieval。

`DataAdapter` 應放在 `src/connectors` domain 中，不是放到 `common`，也不是建立另一套 assistant runtime。`DataAdapterRegistry` 不得自成一套與 connector domain 無關的 routing runtime；它必須與 connector domain 既有或未來產品化的 registry policy 收斂，並共用或對齊：

- health model
- timeout policy
- permission pre-check policy
- audit / observability policy
- degraded / failure mapping

若既有 connector registry 尚未完全產品化，002 的 `DataAdapterRegistry` 應被視為 connector domain registry consolidation 的第一步，而不是建立與未來 connector registry 互相競爭的平行設計。

因此必須避免：

- `ConnectorAdapter` 負責一套 routing
- `DataAdapter` 再負責另一套 routing
- 兩套 registry / health / capability / error mapping 並存
- 兩套 permission / timeout / degraded mapping 並存

## 6. Request Lifecycle and Data Flow

002 的 request lifecycle 是 001 message pipeline 的 augmentation，而非 replacement：

```text
Host App / Frontend SDK
  -> POST /api/v1/assistant/sessions/:sessionId/messages
  -> existing identity extraction
  -> HostIntegrationContext normalization
  -> PageContext normalization / minimization
  -> HostApp capability lookup
  -> query understanding
  -> ExecutionPlan build using normalized host context
  -> data adapter routing
  -> permission pre-check before adapter execution
  -> adapter resolveContext
  -> adapter fetchEvidence
  -> field masking / minimization before LLM input
  -> evidence conversion to EvidenceRef
  -> existing AnswerDecision flow
  -> SSE final.data.answerDecision
  -> frontend 001 evidence rendering
  -> audit / observability metadata persisted throughout
```

### Lifecycle Stage Notes

1. request 仍從既有 assistant controller / message handler 進入。
2. 既有 identity extraction 先建立 `RequestIdentityContext`。
3. 002 再建立 normalized `HostIntegrationContext`。
4. `PageContextNormalizer` 對輸入做 validation、allowlisting、minimization。
5. `HostAppRegistry` 以 `hostApp` 決定 capability 與 safe-path boundary。
6. query understanding 與 `ExecutionPlan` 不直接吃原始 host metadata，而是吃 normalized context。
7. `DataAdapterRegistry` 根據 capability + context 挑選 eligible adapter。
8. permission pre-check 在 adapter execution 前就先拒絕不合法操作。
9. adapter 只回 evidence-safe result，不回 raw payload。
10. permission / masking 在 LLM 前再次收斂。
11. `EvidenceRefService` 將 adapter output 轉為 frontend-safe evidence refs。
12. `AnswerDecisionService` 維持既有 public final state。

PageContext 在整條流程中都不是完整資料來源，也不能直接成為 raw LLM context。它只能作為 entity resolution、selectedRows scope、filter hints 與 routing hints。

## 7. Host Integration Context Design

### Proposed Internal Type

`HostIntegrationContext` 應是 backend internal normalized context，至少包含：

- `hostApp`
- `actorId`
- `organizationId`
- `role`
- `permissionScopes`
- `requestId`
- `pageContext`
- `sessionScope`
- `sourceSystem?`

### Composition Sources

它應由下列來源組成：

- identity headers
- request metadata
- sanitized PageContext
- HostApp Registry capability
- session scope
- adapter routing result

### Responsibility

`HostIntegrationContextService` 應負責：

- 合併既有 `RequestIdentityContext` 與 host integration metadata
- 呼叫 `PageContextNormalizer`
- 查詢 `HostAppRegistry`
- 產生 normalized internal context
- 在需要時推導 `sourceSystem`
- 產生可寫入 audit / observability 的 normalization metadata

### `sourceSystem` Rule

`sourceSystem` 是 backend internal context 的推導結果，不是 frontend 必填欄位。frontend 不得指定任意 `sourceSystem`、connector 或 data source。backend 只能根據：

- `hostApp`
- `entityType`
- `screenId`
- selected adapter
- capability policy

推導最終 `sourceSystem`。

若 frontend 嘗試塞入超出 contract 的 source selection hint，system 應：

- ignore it if harmless
- or record audit metadata and fail closed if it implies unauthorized routing

## 8. PageContext Normalization Design

`PageContextNormalizer` 應處理：

- `route`
- `screenId`
- `hostModule`
- `entityType`
- `entityId`
- `selectedRows`
- `activeFilters`
- `visibleColumns`
- `userVisibleState`

### Normalization Rules

1. `route` 的 query / hash 不可信，不可當成資料真值。
2. `selectedRows` 只保留 id 或安全 summary。
3. `activeFilters` 只允許 allowlisted field。
4. `visibleColumns` 只能是 visibility hint。
5. `userVisibleState` 只能是 context hint。
6. 敏感、未 allowlist、過度詳細欄位必須移除或遮罩。
7. normalization 必須產生 metadata 供 audit/debug/eval 使用。
8. context 不足時必須支援 `clarification_required` path。

### Proposed Outputs

`NormalizedPageContext` 可包含：

- trusted route path
- canonical `screenId`
- normalized `hostModule`
- entity reference
- normalized selected row refs
- allowlisted active filters
- visible field hints
- normalization metadata

### Explicit Boundaries

- PageContext 不是完整資料來源。
- PageContext 不能直接變成 LLM context。
- PageContext 只能幫助 backend 選擇 entity、selectedRows、filters 與 routing hints。
- `visibleColumns` 不等於 permission。
- `selectedRows` 不等於授權資料集合。

## 9. HostApp Registry Design

`HostAppRegistry` v1 採 static code-based registration。

### HostAppCapability Shape

每個 host app capability 至少包含：

- `hostAppId`
- `displayName`
- `supportedEntityTypes`
- `supportedScreens`
- `supportedDataAdapters`
- `defaultPermissionScopeMapping`
- `degradedBehavior`
- `pageContextAllowlist`
- `filterAllowlist`
- `fieldVisibilityPolicy`

### v1 Registration

v1 只正式啟用：

- `admin`

future reserved but not implemented:

- `mes`
- `wms`
- `scm`
- `crm`
- `custom`

### Safe Path Design

以下狀況都必須 fail safe，且不得 fallback 到 `admin` adapter：

- unsupported host app
- unsupported `entityType`
- unsupported `screenId`
- unsupported selectedRows interaction

safe path 應回到既有 assistant core 可理解的 outcomes，例如：

- `clarification_required`
- `no_answer`
- safe error envelope

具體 mapping 由既有 assistant core safe response mapping 決定，不新開 public enum。

## 10. Data Adapter Contract v1 Design

### Proposed Interface Responsibility

Data Adapter Contract v1 應至少表達以下責任：

```ts
interface DataAdapter {
  sourceSystem: string
  supportedHostApps: string[]
  supportedEntityTypes: string[]

  canHandle(context): boolean
  resolveContext(context): Promise<ResolvedAdapterContext>
  fetchEvidence(query): Promise<DataAdapterEvidenceResult>
  healthCheck(): Promise<DataAdapterHealth>
}
```

此 interface 是 conceptual contract；後續實作可以配合 NestJS / 現有 connector abstraction 做 naming 微調，但責任不可缺漏。

### Result Shape

`DataAdapterEvidenceResult` 應至少包含：

- `sourceSystem`
- `sourceType`
- `sourceId`
- `title`
- `snippet`
- `fieldsSummary`
- `permissionResult`
- `retrievedAt`
- `toolCallId?`
- `metadata?`

### Contract Rules

1. 不可回傳 credential / secret / token。
2. 不可把 raw full payload 直接交給 LLM。
3. 必須在 LLM 前完成 permission masking / minimization。
4. 必須可轉成 `EvidenceRef`。
5. failure / timeout / unavailable 必須映射到既有 safe response。

### Alignment with Existing `ConnectorAdapter`

002 在 connector 架構上已決定採 `same-domain specialized interfaces with shared registry`：

- `ConnectorAdapter` 保留 broader execution-oriented connector contract
- `DataAdapter` 是專門為 assistant grounded answer 準備的 read-oriented evidence specialization
- `DataAdapterRegistry` 由 connector domain 管理，不在 `assistant` 或 `common` 自立門戶
- `DataAdapterRegistry` 必須與 connector domain 共用或對齊 health model、timeout policy、permission pre-check policy、audit / observability metadata 與 degraded / failure mapping

若顯式的 `ConnectorAdapterRegistry` 尚未產品化，002 的 `DataAdapterRegistry` 應被視為 connector domain registry consolidation 的第一步，而不是另一套與未來 connector registry 互相競爭的平行 registry。

這種設計可避免：

- connector 的 `execute()` 與 adapter 的 `fetchEvidence()` 分別有兩套 health model
- permission / audit / timeout policy 重複
- mock connector 與 reference adapter 無法共用 fixtures / registry / observability
- connector routing 與 data adapter routing 變成兩套平行 runtime

## 11. Admin Orders / Inventory Reference Adapter Design

第一版 reference adapter 僅支援：

- `Admin Orders`
- `Admin Inventory`

### Supported Query Shapes

- order status lookup
- order summary
- selected orders comparison
- inventory availability lookup
- inventory summary

### Required Fixture Basis

- `orderId = SO-10001`
- `status = confirmed`
- `customerName = synthetic customer`
- `cost = restricted field`

- `itemNo = SKU-001`
- `availableQty = 320`
- `reservedQty = 40`
- `cost = restricted field`

- `admin_operator`
- `finance_user`
- `limited_user`

### Adapter Responsibilities

- detail page `entityId` lookup
- `selectedRows` scoped lookup
- field masking for restricted `cost`
- permission-denied or masked-answer behavior
- unsupported entity safe path
- adapter degraded safe path

### Explicit Scope Limit

此 adapter 只是 reference integration，用來驗證 host integration gateway + adapter contract + evidence pipeline 是否成立。它不是完整 admin connector，也不應擴張成全域 admin data access layer。

## 12. Permission, Masking, and Data Minimization Design

至少需有三層檢查：

1. **adapter execution 前**
   驗證 actor 是否能使用該 adapter / entity / operation。

2. **adapter result 進入 LLM 前**
   進行 field-level masking / minimization。

3. **evidence exposure 前**
   驗證 `EvidenceRef`、`fieldsSummary`、snippet 是否 frontend-safe。

### Existing Module Alignment

- execution 前：靠 `src/permissions/tool-permission-precheck.service.ts` 或其等價擴充
- LLM 前：靠 `src/permissions/llm-input-sanitizer.service.ts` 或其等價擴充
- evidence exposure 前：靠 `src/evidence/evidence-ref.service.ts` + history/response sanitizers

### Explicit Rules

- `visibleColumns` 不等於 permission。
- PageContext 不等於 permission。
- `selectedRows` 不等於授權資料集合。
- 前端畫面可見，不代表 backend 可合法曝露。

## 13. Evidence and AnswerDecision Integration

adapter result 應流入既有 evidence pipeline：

```text
DataAdapterEvidenceResult
  -> EvidenceRef / EvidenceRefSummary
  -> existing grounded answer path
  -> AnswerDecision
  -> SSE final.data.answerDecision
  -> frontend 001 evidence rendering
```

### Integration Expectations

- `DataAdapterEvidenceResult` 必須能被 `EvidenceRefService` 轉為既有 `EvidenceRef`。
- `fieldsSummary` 必須是 frontend-safe，不允許前端自己補造 summary。
- `tool_failure`、permission deny、unsupported scope 等都應走既有 `AnswerDecision` 與 `noAnswerReason` mapping。
- `degraded` 永遠不能成為新的 public `AnswerDecision`。

### AnswerDecision Mapping Rule

若 adapter degraded / timeout / unavailable 導致無法提供可靠 evidence，應沿用既有 assistant core safe response mapping，例如：

- `no_answer` + `noAnswerReason=tool_failure`
- safe error envelope
- 既有 unavailable/degraded UI-compatible flow

## 14. Degraded / Timeout / Safe Path Design

adapter unavailable、timeout、health check failed、dependency degraded 都必須被視為 internal dependency state / observability metadata / safe-path category。

### Non-negotiable Rules

- 不得新增 `answerDecision = "degraded"`。
- 不得新增 `final.data.answerDecision = "degraded"`。
- 不得新增新的 public final-state enum。
- 一律沿用既有 assistant core safe response mapping。

### Mapping Strategy

對外 public outcome 應映射為既有 safe responses，例如：

- `no_answer` + `noAnswerReason=tool_failure`
- safe error envelope
- 既有 unavailable/degraded UI-compatible flow

對內 observability / audit metadata 可記錄：

- dependency status = degraded
- timeout category
- adapter key
- sourceSystem
- failure code category

但這些 internal state 不得直接暴露成新的 public answer enum。

## 15. Audit and Observability Design

至少應寫入下列 audit metadata / observability hooks：

- HostApp capability decision
- PageContext normalization / minimization
- unsupported host/entity
- adapter selection
- adapter `canHandle` result
- adapter `resolveContext` result
- adapter `fetchEvidence` success/failure
- permission masking
- evidence conversion
- degraded / timeout
- golden question eval result

### Prohibited Data in Response / Log / Audit / LLM

以下資料不得進入 response、general logs、audit metadata 或 LLM input：

- raw connector payload
- secret
- credential
- token
- raw full PageContext
- raw LLM prompt

### Proposed Recording Pattern

- `host-integration-audit.service.ts`：負責 host-specific audit event assembly
- `audit-writer.service.ts`：負責 append-only persistence
- `observability-metadata.helper.ts`：負責 dependency status、noAnswerReason、toolFailureReason 等標準 metadata

## 16. Golden Questions and Eval Smoke Design

### Smoke Matrix

1. **admin order detail page**
   「這張訂單目前狀態是什麼」
   expected evidence source = order
   expected answerDecision = answered

2. **selected orders comparison**
   「比較剛剛選取的幾筆訂單狀態」
   expected scope = selectedRows only

3. **admin inventory detail**
   「這個品項可用庫存是多少」
   expected evidence source = inventory
   expected answerDecision = answered

4. **missing PageContext**
   「這張目前狀態是什麼」
   expected answerDecision = clarification_required

5. **unauthorized cost field**
   「這筆成本是多少」
   expected answerDecision = permission_denied 或 masked answer

6. **unsupported host/entity**
   expected outcome = no_answer / clarification_required / safe error

7. **adapter degraded / timeout**
   expected outcome = no_answer + tool_failure 或既有 safe error envelope

### Assertions

每個 smoke case 至少驗證：

- fixture basis 是否 deterministic
- expected public outcome 是否符合 001 contract
- expected evidence source / selectedRows scope 是否正確
- audit metadata 是否存在
- 無 raw payload / secret / unmasked sensitive field 外洩

## 17. API / Contract Compatibility

本 feature 不新增另一套 public chat API。

assistant request 仍走既有：

- `POST /api/v1/assistant/sessions/:sessionId/messages`

session/history/feedback/approval 仍沿用 001 public contract。

### Compatibility Rules

- SSE final state 仍只由 `final.data.answerDecision` 決定。
- 不得新增 public `answerDecision = "degraded"`。
- `EvidenceRef` 必須 frontend-safe。
- 不得在 response 中暴露 raw connector payload。

若後續 design / plan 提到 diagnostic endpoint，只能標示為：

- optional
- internal/admin only
- not required by frontend widget
- not part of public chat API
- not a blocker for v1

## 18. Testing Strategy

### Unit tests

- `PageContextNormalizer`
- `HostAppRegistry`
- `DataAdapterRegistry`
- permission masking
- adapter result minimization
- sourceSystem derivation
- degraded mapping does not create public `AnswerDecision`

### Integration tests

- full request context validation
- unsupported host app
- missing PageContext clarification
- admin order detail evidence answer
- selectedRows scoped lookup
- unauthorized field permission_denied / masked answer
- adapter unavailable safe path
- audit metadata generated

### Contract tests

- existing assistant message API unchanged
- SSE final state remains `AnswerDecision`-based
- no `answerDecision = degraded`
- `EvidenceRef` remains frontend-safe
- no raw connector payload in response

### Eval / smoke tests

- Admin Orders / Inventory golden questions
- expected evidence source
- expected answerDecision
- no-answer / permission-denied / tool-failure cases

### Security / privacy tests

- no raw payload to LLM
- no secret in logs / audit metadata / response
- PageContext cannot bypass permission check

## 19. Security and Privacy Design

security / privacy design 的核心原則如下：

- fail closed for missing identity / organization / hostApp / permissionScopes / requestId
- frontend 只可提供 sanitized PageContext 與 metadata
- frontend 不得指定 connector、data source 或最終 `sourceSystem`
- adapter result 必須在進入 LLM 前被最小化
- `cost` 等 restricted field 必須依 permission scopes 決定 masked answer 或 permission-denied path
- audit / observability 只能保存最小必要 metadata
- synthetic fixtures only

特別是 host integration layer 必須防止以下誤用：

- 把 PageContext 當成可直接查詢的完整資料
- 把 `visibleColumns` 當成 backend permission
- 把 `selectedRows` 當成自動授權集合
- 把 degraded state 當成 public contract

## 20. Risks and Mitigations

1. **Host adapter 傳入過多資料**
   以 `PageContextNormalizer` allowlist + minimization 阻擋，並在 audit 記錄 trimming metadata。

2. **frontend 嘗試指定 sourceSystem / connector**
   明確將其視為 forbidden routing authority；backend 忽略或 fail closed，並寫 audit metadata。

3. **PageContext 被誤用為 permission**
   在設計上拆開 context normalization 與 permission enforcement，禁止 PageContext 直接驅動授權。

4. **visibleColumns 被誤用為權限**
   將其明確定義為 visibility hint only；實際欄位權限仍由 permissions module 決定。

5. **selectedRows 超出 organization / permission boundary**
   selectedRows 必須在 adapter execution 前再次套用 organization boundary 與 permission pre-check。

6. **DataAdapter interface 與既有 ConnectorAdapter interface 變成兩套平行 contract**
   採 `same-domain specialized interfaces with shared registry`。`DataAdapter` 只作 read-evidence specialization；registry / health / timeout / permission / audit policy 必須共用或對齊。後續 `plan.md` / `tasks.md` 必須加入 regression test 或 architecture guard，避免新增第二套路由 runtime 或第二套 degraded mapping。

7. **degraded 被誤新增為 public AnswerDecision**
   在 design、contract tests、mapping rules 中明確禁止。

8. **reference adapter scope 膨脹成完整 admin connector**
   把 Orders / Inventory 支援範圍明確寫死在 v1 設計與測試矩陣中。

9. **fixtures 使用真實資料**
   只允許 deterministic synthetic fixtures，並在測試策略與資料設計中明確限制。

10. **audit metadata 洩漏 raw payload**
   對 audit / logs 套用最小化與 redaction policy，禁止 raw connector payload、secret、token 進入 metadata。

## 21. Open Questions

1. optional internal/admin diagnostic endpoint 是否需要在 v1 規劃只讀 registry / adapter health inspection contract，或完全依賴既有 observability API，需在 `plan.md` 決定是否列入非阻塞性工作。
