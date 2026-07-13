# Tasks: Host Integration Gateway and Data Adapter Contract

**Input**: Design documents from `/specs/002-host-integration-gateway-and-data-adapter-contract/`

**Prerequisites**: `plan.md` (required), `spec.md` (required), `design.md` (required)

**Tests**: 本 feature 明確要求 unit、integration、contract、eval/smoke、security/privacy 測試。每個 phase 內都必須 test-first，先建立對應測試任務，再做實作任務。

**Organization**: Tasks are grouped by `plan.md` Phase 0～7，並對應 002 的 user stories 與 architecture guardrails。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (`US1`..`US7`)
- Include exact file paths in descriptions

## Path Conventions

- Backend code: `src/`
- Tests: `test/`
- Feature docs: `specs/002-host-integration-gateway-and-data-adapter-contract/`

### 關鍵任務詳細化原則

一般任務維持簡短描述；但涉及 API/SSE contract、host context、PageContext、DataAdapter contract、runtime wiring、audit/observability、privacy/regression guard 的關鍵任務，必須補充：

- `說明：`
- `輸出：`
- `完成條件：`

---

## Phase 0: Architecture Alignment and Contract Guardrails

**Purpose**: 先鎖住 001 public API / SSE / `AnswerDecision` contract 與 002 shared-registry guardrails，不先做 production implementation。

- [ ] T001 [P] Create host-integration test helper scaffold in `test/helpers/host-integration-test-helpers.ts`
- [ ] T002 [P] Create public assistant API compatibility contract tests in `test/contract/host-integration/public-api-compatibility.contract.spec.ts`
  - 說明：鎖定既有 assistant message API path 與 public chat surface，不允許 002 引入第二套 public chat endpoint。
  - 輸出：`public-api-compatibility.contract.spec.ts`，覆蓋既有 message API path、既有 response envelope 與 no-second-endpoint assertions。
  - 完成條件：驗證既有 assistant message API path 不變；不存在第二套 public chat endpoint；002 不要求 frontend widget 使用任何新 endpoint。
- [ ] T003 [P] Create answer decision and SSE compatibility contract tests in `test/contract/host-integration/answer-decision-compatibility.contract.spec.ts`
  - 說明：鎖定 SSE final state 仍只由 `final.data.answerDecision` 決定，且不得新增 public `degraded` answer decision。
  - 輸出：`answer-decision-compatibility.contract.spec.ts`，覆蓋 SSE final payload、`AnswerDecision` values 與 no-public-degraded assertions。
  - 完成條件：`final.data.answerDecision` 仍為既有 001 contract；不得出現 `answerDecision = "degraded"`；不得出現 `final.data.answerDecision = "degraded"`。
- [ ] T004 Create architecture guard tests in `test/unit/host-integration/architecture-guard.spec.ts`
  - 說明：在實作前先鎖定 `DataAdapter / ConnectorAdapter = same-domain specialized interfaces with shared registry`，並防止 002 scope creep。
  - 輸出：`architecture-guard.spec.ts`，覆蓋 shared-registry、no-second-routing-runtime、reference-scope-only assertions。
  - 完成條件：不得形成第二套 routing runtime、第二套 degraded mapping、第二套 health/timeout/permission pipeline；HostAppRegistry v1 不得被實作成 DB-driven dynamic registry；不得建立 frontend 可呼叫的 HostApp registration API；不得建立 public diagnostic endpoint；`admin` Orders / Inventory 只作 reference integration，不展開成 full MES/WMS/SCM/CRM connector rollout，也不得落地未列入 reference scope 的 capability implementation。

**Checkpoint**: Phase 0 guardrails 完成後，後續 phase 的實作不得違反既有 public contract 與 shared-registry 架構。

---

## Phase 1: Host Integration Context Foundation

**Purpose**: 建立 `HostIntegrationContext`、`PageContextNormalizer`、`HostAppRegistry` 與 backend-derived `sourceSystem` foundation。

- [ ] T005 [P] [US1] Create `HostIntegrationContextService` unit tests in `test/unit/host-integration/host-integration-context.service.spec.ts`
- [ ] T006 [P] [US1] Create backend-derived `sourceSystem` unit tests in `test/unit/host-integration/source-system-derivation.spec.ts`
- [ ] T007 [P] [US2] Create `PageContextNormalizer` unit tests in `test/unit/host-integration/page-context-normalizer.service.spec.ts`
- [ ] T008 [P] [US3] Create `HostAppRegistry` unit tests in `test/unit/host-integration/host-app-registry.service.spec.ts`
  - 說明：鎖定 v1 static `HostAppCapability` contract 與 capability lookup 行為，避免後續實作者把 host/entity/screen/interaction eligibility 簡化成僅看 `hostApp` 或 `entityType`。
  - 輸出：`host-app-registry.service.spec.ts`，覆蓋 capability shape、host/entity/screen/interaction lookup、unsupported capability safe path assertions。
  - 完成條件：`HostAppCapability` 至少包含 `hostAppId`、`displayName`、`supportedEntityTypes`、`supportedScreens`、`supportedDataAdapters`、`defaultPermissionScopeMapping`、`degradedBehavior`、`pageContextAllowlist`、`filterAllowlist`、`fieldVisibilityPolicy`；`hostApp=admin` 可取得完整 static capability；支援與不支援的 `entityType` / `screenId` 均有明確測試；entity type 支援但 interaction 不支援時不得選 adapter；不支援 selectedRows interaction 時不得執行 comparison；adapter capability 不支援時不得 fallback；`mes`、`wms`、`scm`、`crm`、`custom` 在 v1 尚未啟用時必須走 unsupported capability safe path；未註冊 host 不得 fallback 到 `admin`。
- [ ] T009 [P] [US1] Create request context validation and `x-permission-scopes` CSV normalization integration tests in `test/integration/host-integration/request-context-validation.spec.ts`
  - 說明：驗證 assistant request 進入 host integration flow 時，既有 `x-permission-scopes` request header 會被正確解析、標準化並納入 internal permission scope collection。
  - 輸出：request context validation integration spec，覆蓋 CSV transport、trim、deduplication、空值拒絕、缺漏 header、malformed input 與 normalized output assertions。
  - 完成條件：從既有 `x-permission-scopes` request header 取得權限 scopes；支援 CSV 格式；每個 scope 會 trim；空白項目會移除；重複 scopes 會去重；缺少必要 header 時 fail closed；malformed value 不得被默默接受；最終輸出為 normalized internal permission scope collection。
- [ ] T010 [P] [US2] Create PageContext clarification and minimization integration tests in `test/integration/host-integration/page-context-clarification.spec.ts`
  - 說明：驗證 PageContext 在 detail、selectedRows、filters 與 screen interaction 上的 clarification / minimization 行為，避免 runtime 用不可靠上下文猜測目標。
  - 輸出：`page-context-clarification.spec.ts`，覆蓋 missing context、`entityId` / `selectedRows` conflict、unsupported screen、unsupported selectedRows interaction、未 allowlist filter、`visibleColumns` / permission conflict assertions。
  - 完成條件：`entityId` 與 `selectedRows` 衝突時不得任意選擇；screen 不支援 interaction 時走 safe path；selectedRows 為空、衝突或不支援時回 clarification 或 safe no-answer；`activeFilters` 含未 allowlist 或敏感條件時必須移除、拒絕或遮罩並留下 normalization metadata；frontend `visibleColumns` 不得降低 permission requirement。
- [ ] T011 [US1] Implement host integration module and context foundation in `src/host-integration/host-integration.module.ts`, `src/host-integration/host-integration-context.service.ts`, `src/host-integration/host-app-capability.types.ts`, and `src/host-integration/host-integration-audit.service.ts`
  - 說明：建立 002 host-integration 內部骨架與 normalized context contract，讓 assistant runtime 能在 identity extraction 後取得可信的 host context。
  - 輸出：host-integration module、context service、capability types、host-specific audit assembly skeleton。
  - 完成條件：`HostIntegrationContext` 至少包含 `hostApp`、`actorId`、`organizationId`、`role`、`permissionScopes`、`requestId`、`pageContext`、`sessionScope`、`sourceSystem?`；缺少必要欄位時 fail closed；`sourceSystem` 明確為 backend-derived；frontend 不得把 `role`、`permissionScopes` 或 `sourceSystem` 視為可任意覆寫的可信權限來源。
- [ ] T012 [US2] Implement PageContext normalization in `src/host-integration/page-context-normalizer.service.ts`
  - 說明：將 frontend 傳入的 sanitized PageContext 轉成 internal normalized context，只作 routing/entity-resolution hints，不得成為 raw data source 或 permission source。
  - 輸出：PageContext normalizer、allowlist/minimization logic、normalization metadata。
  - 完成條件：`route` query/hash 不可信；`selectedRows` 只保留 id 或 safe summary；`activeFilters` 僅 allowlisted fields；`visibleColumns` 與 `userVisibleState` 不能取代 permission；敏感欄位會移除或遮罩。
- [ ] T013 [US3] Implement static host app capability registry in `src/host-integration/host-app-registry.service.ts`
  - 說明：建立 v1 static code-based HostApp Registry，作為 host app capability、PageContext allowlist、filter allowlist、field visibility 與 adapter eligibility 的單一來源。
  - 輸出：`src/host-integration/host-app-registry.service.ts`、`admin` HostAppCapability static registration、host/entity/screen/interaction capability lookup、unsupported capability safe-path result。
  - 完成條件：v1 只正式註冊 `admin`；`mes`、`wms`、`scm`、`crm`、`custom` 僅為 future reserved identifiers；`admin` capability 必須明確宣告 supported entity types、supported screens、supported data adapters、default permission scope mapping、degraded behavior、PageContext allowlist、activeFilters allowlist、field visibility policy、selectedRows interaction capability；adapter eligibility 至少考慮 `hostApp`、`entityType`、`screenId`、interaction type、registered adapter capability；unsupported host / entity / screen / selectedRows interaction 必須 fail safe；不得 fallback 到 `admin` adapter；不得猜測最接近 entity 或 screen；不得新增 HostApp production DB table、Prisma model、migration、dynamic registration API、admin CRUD 或 runtime self-service registration。
- [ ] T014 [US1] Wire host context foundation into request validation flow in `src/identity/identity-context.extractor.ts` and `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：把 host context 建立流程接到既有 assistant request pipeline，位置在 identity extraction 後、planner/tool routing 前。
  - 輸出：request pipeline wiring、normalized host context handoff、fail-closed error mapping。
  - 完成條件：沿用既有 identity extraction boundary；不得為 002 建立第二套 identity extractor；不得建立第二套 permission header parser；`x-permission-scopes` CSV normalization 必須在 identity extraction 後、planner / adapter routing 前完成，並執行 trim、deduplication、空值拒絕與 malformed-input handling；normalized permission scopes 必須進入 `HostIntegrationContext`；assistant request 先建立 normalized host context 再進入 planning；frontend 不得指定 connector / data source / `sourceSystem`；unsupported host/entity 不得 fallback 到 admin adapter。

**Checkpoint**: Phase 1 完成後，backend 可以建立可信的 host-aware normalized context，但尚未接入 DataAdapter reference implementation。

---

## Phase 2: Data Adapter Contract and Registry

**Purpose**: 建立 `DataAdapter` read-oriented evidence specialization 與 shared-registry connector-domain policy。

- [ ] T015 [P] [US4] Create `DataAdapterRegistry` unit tests in `test/unit/connectors/data-adapter-registry.service.spec.ts`
  - 說明：驗證 shared registry 對 adapter eligibility、unsupported adapter safe path、timeout/unavailable mapping 與非 host-integration request 相容性的邊界。
  - 輸出：`data-adapter-registry.service.spec.ts`，覆蓋 registry policy、adapter eligibility、unsupported adapter、timeout/unavailable、non-host-integrated request compatibility assertions。
  - 完成條件：測試涵蓋 interface capability validation、adapter eligibility、unsupported adapter safe path、timeout / unavailable mapping、no public degraded `AnswerDecision`、非 host-integration request 的既有 `AnswerDecision` 行為不變。
- [ ] T016 [P] [US4] Create DataAdapter result minimization unit tests in `test/unit/connectors/data-adapter-result-minimization.spec.ts`
  - 說明：驗證 adapter result schema、metadata allowlist、organization boundary 與 raw payload rejection，避免以 result shape 當成敏感資料逃生口。
  - 輸出：`data-adapter-result-minimization.spec.ts`，覆蓋 metadata allowlist、raw payload rejection、malformed result safe path、cross-organization entity rejection assertions。
  - 完成條件：`metadata` 僅允許 allowlisted minimized fields；malformed result 會被拒絕或映射 safe path；selectedRows、entityId、row-level / field-level / operation-level 與 adapter-side permission 的 organization boundary 會被重新驗證；跨 organization entity data、raw fixture / connector payload 不得通過 result validation。
- [ ] T017 [P] [US4] Create connector-domain architecture unit tests in `test/unit/connectors/connector-domain-architecture.spec.ts`
  - 說明：鎖定 DataAdapter 與 ConnectorAdapter 的 shared domain / shared policy 邊界。
  - 輸出：`connector-domain-architecture.spec.ts`，覆蓋 same-domain specialization、shared registry / health / timeout / permission / audit / observability / degraded mapping assertions。
  - 完成條件：`DataAdapter` 是 read-oriented evidence specialization；`ConnectorAdapter` 是 broader connector / tool contract；兩者位於同一 connectors domain；不得建立第二套 registry platform、health model、timeout policy、permission engine 或 degraded mapper。
- [ ] T018 [US4] Implement DataAdapter interface and result types in `src/connectors/data-adapter.interface.ts` and `src/connectors/data-adapter-result.types.ts`
  - 說明：定義 evidence-oriented read contract，不建立與 `ConnectorAdapter` 無關的第二套 integration model。
  - 輸出：`DataAdapter` conceptual interface、`DataAdapterEvidenceResult` / health / result type definitions。
  - 完成條件：`DataAdapter` 明確為 read-oriented evidence specialization；static capability properties 至少包含 `sourceSystem`、`supportedHostApps`、`supportedEntityTypes`；operations 至少包含 `canHandle(context)`、`resolveContext(context)`、`fetchEvidence(query)`、`healthCheck()`；`canHandle` 必須根據 normalized `HostIntegrationContext` 判斷，不接受 raw PageContext，也不得只依 `entityType`；`resolveContext` 只解析 normalized entity reference、selected row refs 與 allowlisted filters，不得擴大 selectedRows 範圍，不得信任 raw selected row summary，必須保留 organization boundary，context 不足或 target 衝突時回 safe resolution result，且不得在 permission pre-check 前讀取受保護業務資料；`fetchEvidence` 只能在 permission pre-check 通過後執行，只可查詢 resolved scope，不得 unrestricted full-table scan，不得因 selectedRows 有 ID 就略過 row-level permission；`healthCheck` 沿用既有 connector/tool health policy，不建立第二套 health model，且 runtime 必須能區分 health unavailable、resolveContext failure、fetchEvidence timeout、fetchEvidence unavailable、malformed evidence result；`DataAdapterEvidenceResult` 至少包含 `sourceSystem`、`sourceType`、`sourceId`、`title`、`snippet`、`fieldsSummary`、`permissionResult`、`retrievedAt`、`toolCallId?`、`metadata?`；`metadata` 必須 allowlisted、minimized，不能成為 raw payload 逃生口；`fieldsSummary` 只能包含 permission-safe fields；`snippet` 不得包含未授權敏感資料；`permissionResult` 必須能表達 allow / masked / denied 或對齊既有 permission result shape；`retrievedAt` 供 freshness 與 audit 使用；`sourceSystem` 必須與 backend-selected adapter 一致，不能由 frontend 決定；result 必須能穩定轉換為既有 `EvidenceRef` / `EvidenceRefSummary`；result type 不得包含 raw connector response、raw fixture object、credential、secret、access token、refresh token、connection string、full customer / order / inventory record、stack trace、internal exception object、raw full PageContext 或 raw LLM prompt。
- [ ] T019 [US4] Implement shared-registry DataAdapter routing in `src/connectors/data-adapter-registry.service.ts`
  - 說明：建立 connector-domain registry consolidation 的第一步，並與既有 `ConnectorAdapter` 對齊 health、timeout、permission、audit、degraded mapping policy。
  - 輸出：DataAdapter registry、adapter selection rules、policy alignment hooks。
  - 完成條件：`DataAdapterRegistry` 不得成為第二套 routing / health / timeout / permission / degraded mapping runtime；shared-registry guard tests 通過；unsupported host/entity 不得繞過 capability precheck；registry policy 與 `ConnectorAdapter` 共用或對齊 registry、health、timeout、permission、audit、observability、degraded mapping；不得建立第二套 registry platform。
- [ ] T020 [US4] Implement DataAdapter result conversion and safe degraded mapping in `src/connectors/data-adapter-registry.service.ts`, `src/evidence/evidence-ref.service.ts`, and `src/assistant/answer/answer-decision.service.ts`
  - 說明：把 adapter output 收斂成 frontend-safe `EvidenceRef` 路徑，並將 unavailable/timeout/degraded 映射到既有 assistant core safe outcome。
  - 輸出：DataAdapter-to-EvidenceRef conversion、safe degraded mapping、permission/minimization hooks。
  - 完成條件：只能重用或最小擴充既有 safe mapping；不得新增 `AnswerDecision` enum value；不得新增 public `degraded` decision；不得建立第二套 degraded mapper；不得改變非 host-integration request 的既有 `AnswerDecision` 行為；adapter result 可轉成 `EvidenceRef` / `EvidenceRefSummary`；raw connector payload 不進 response / log / audit / LLM；adapter timeout / unavailable / degraded 必須映射到既有 assistant core safe outcome；`tool_failure` 維持既有 `no_answer + noAnswerReason=tool_failure` 或既有 safe mapping。

**Checkpoint**: Phase 2 完成後，backend 已具備可擴充的 DataAdapter contract，但尚未有 admin reference adapter。

---

## Phase 3: Admin Orders / Inventory Reference Adapter

**Purpose**: 建立 `admin` Orders / Inventory reference adapter 與 deterministic synthetic fixtures。

- [ ] T021 [P] [US5] Create admin orders adapter unit tests in `test/unit/connectors/admin/admin-orders.adapter.spec.ts`
  - 說明：驗證 Orders reference adapter 的 fixed scope、persona permission mapping、selectedRows boundary 與 unsupported operation safe path。
  - 輸出：`admin-orders.adapter.spec.ts`，覆蓋 `SO-10001`、status lookup、summary、selectedRows comparison、restricted `cost`、unsupported operation assertions。
  - 完成條件：固定 fixture values 與 persona permission mapping 被鎖定；`admin_operator` 預設不得讀取 restricted cost；`finance_user` 具備 restricted `cost` permission，並可在既有 permission pre-check 通過後取得 permission-safe `cost` evidence；`limited_user` 問 cost 時回 permission-denied 或 masked answer；selectedRows 不得擴大 entity scope。
- [ ] T022 [P] [US5] Create admin inventory adapter unit tests in `test/unit/connectors/admin/admin-inventory.adapter.spec.ts`
  - 說明：驗證 Inventory reference adapter 的 fixed scope、persona permission mapping、selected inventory entity resolution 與 unsupported SKU safe path。
  - 輸出：`admin-inventory.adapter.spec.ts`，覆蓋 `SKU-001`、availability、summary、restricted `cost`、unsupported SKU assertions。
  - 完成條件：固定 fixture values 與 persona permission mapping 被鎖定；`availableQty=320`、`reservedQty=40` 可支援 availability / summary 測試；restricted `cost` 必須遵守既有 permission policy 與 masking。
- [ ] T023 [P] [US5] Create admin reference fixture unit tests in `test/unit/connectors/admin/admin-reference-fixtures.spec.ts`
  - 說明：把 fixture fixed inputs 與 persona permission mapping 鎖成回歸測試，避免未來 implementation 自行擴張成 generic dataset。
  - 輸出：`admin-reference-fixtures.spec.ts`，覆蓋固定 IDs、固定 quantities、restricted cost、persona mapping、de-identified / minimal dataset assertions。
  - 完成條件：fixture 至少包含 `orderId="SO-10001"`、`status="confirmed"`、`customerName="synthetic customer"`、`itemNo="SKU-001"`、`availableQty=320`、`reservedQty=40`、restricted `cost`；persona mapping 對 `admin_operator`、`finance_user`、`limited_user` 固定且 deterministic；不得演變成完整 ERP dataset。
- [ ] T024 [US5] Implement deterministic synthetic fixtures in `src/connectors/admin/admin-reference-fixtures.ts`
  - 說明：建立 deterministic、synthetic、de-identified 的 reference fixture，僅支援 `admin` Orders / Inventory adapter 與相關 unit、integration、eval、privacy tests。
  - 輸出：至少涵蓋 `SO-10001`、`SKU-001`、restricted `cost` 欄位，以及 `admin_operator`、`finance_user`、`limited_user` personas 的 fixture manifest。
  - 完成條件：fixture 可支援 Orders / Inventory unit、integration、eval、privacy tests；不得使用真實 customer、order、inventory 或 financial data；不得演變成 generic SQL dataset 或完整 ERP schema。
- [ ] T025 [US5] Implement admin orders evidence adapter in `src/connectors/admin/admin-orders.adapter.ts`
  - 說明：實作 Orders reference adapter，僅提供 evidence-oriented read path，不回傳 raw fixture object，也不從 frontend `visibleColumns` 或 selected row summary 推導欄位權限。
  - 輸出：支援 order status lookup、order summary、detail page `entityId` lookup、selected orders comparison、selectedRows scope handling、unsupported order / operation safe path 的 orders adapter。
  - 完成條件：至少支援 order status lookup、order summary、detail page `entityId` lookup、selected orders comparison、selectedRows scope handling、unsupported order / operation safe path；`finance_user` 具備 restricted `cost` permission，並可在既有 permission pre-check 通過後取得 permission-safe `cost` evidence；`admin_operator` 不因角色名稱自動取得 restricted `cost`；`limited_user` 問 `cost` 時回 `permission_denied` 或 masked answer；不得依 frontend `visibleColumns`、selected row summary 或 safe summary 決定 cost 權限；output 必須是 minimized evidence-oriented result，不得回傳 raw fixture object。
- [ ] T026 [US5] Implement admin inventory evidence adapter in `src/connectors/admin/admin-inventory.adapter.ts`
  - 說明：實作 Inventory reference adapter，僅提供 minimized evidence-oriented result，不回傳 raw inventory payload，也不允許 unsupported entity fallback 到其他 adapter。
  - 輸出：支援 inventory availability lookup、inventory summary、detail page `entityId` lookup、selected inventory entity resolution、unsupported SKU / operation safe path 的 inventory adapter。
  - 完成條件：至少支援 inventory availability lookup、inventory summary、detail page `entityId` lookup、selected inventory entity resolution、unsupported SKU / operation safe path；restricted `cost` 必須經 permission masking；unsupported entity 不得 fallback 到其他 adapter；output 必須為 minimized evidence-oriented result，不得回傳 raw inventory payload。
- [ ] T027 [US5] Register admin reference adapters in `src/connectors/data-adapter-registry.service.ts`
  - 說明：將 Orders / Inventory reference adapter 註冊到 shared connector-domain registry，不建立 admin 專用第二套 router 或自有 policy pipeline。
  - 輸出：admin adapter registry wiring、normalized host context / capability / entity type based selection rules。
  - 完成條件：Orders 與 Inventory adapter 必須註冊到既有 shared connector-domain registry；不得建立 admin 專用第二套 router；不得建立 adapter 自有 permission、timeout、health、audit 或 degraded pipeline；registry selection 必須依 normalized host context、capability 與 entity type；unsupported host / entity 不得 fallback 到 admin adapter。

**Checkpoint**: Phase 3 只完成 reference integration。不得擴成 full admin connector、full ERP connector、generic SQL connector、dynamic connector builder，且不得使用真實 customer/order/inventory/financial data。

---

## Phase 4: Assistant Runtime Integration

**Purpose**: 將 host context、PageContext normalization、DataAdapter routing、permission checks 與 EvidenceRef conversion 接入既有 assistant runtime。

- [ ] T028 [P] [US1] Create assistant runtime integration tests in `test/integration/host-integration/assistant-runtime-integration.spec.ts`
  - 說明：驗證 host integration runtime 接線後，normalized context、adapter selection、permission boundary 與 safe outcome 在既有 assistant request flow 中能穩定成立。
  - 輸出：`assistant-runtime-integration.spec.ts`，覆蓋 normalized context handoff、adapter routing、permission pre-check、retry / replay stability assertions。
  - 完成條件：assistant runtime 會在既有 request flow 中使用 normalized host context 與既有 permission / evidence pipeline；retry、SSE interruption、network retry 或使用者重試下，相同 normalized request 必須維持一致的 context resolution、adapter selection、permission boundary、evidence scope 與 safe outcome；不得因 replay 使用上一個 session 的不可靠 entity context。
- [ ] T029 [P] [US5] Create admin orders runtime integration tests in `test/integration/host-integration/admin-orders-runtime.spec.ts`
- [ ] T030 [P] [US5] Create admin inventory runtime integration tests in `test/integration/host-integration/admin-inventory-runtime.spec.ts`
- [ ] T031 [US2] Integrate normalized PageContext into query understanding and execution planning in `src/query-understanding/query-understanding.service.ts` and `src/assistant/planning/assistant-planning.service.ts`
  - 說明：讓 `ExecutionPlan` 只使用 normalized host context / PageContext metadata，不直接吃 raw PageContext。
  - 輸出：query-understanding integration、ExecutionPlan host-context mapping、clarification wiring。
  - 完成條件：normalized routing hints 至少由 `hostApp`、`entityType`、`screenId`、`permissionScopes`、query intent、normalized entity reference、normalized selectedRows scope、allowlisted active filters、HostApp capability result 組成；frontend 傳入資訊只能作 routing hint，不得直接指定 connector、adapter、arbitrary data source、最終 `sourceSystem`、candidate tool ID 或 permission result；routing hints 必須影響 `candidateTools`、`requiredEvidence`、`contextResolution`、`riskAssessment`、`clarificationNeeds`、`expectedAnswerShape`；`candidateTools` 只允許 HostApp capability 已註冊且 permission-compatible 的 candidate，unsupported host / entity / screen 不得產生 admin adapter candidate；Orders 問題要求 Orders evidence，Inventory 問題要求 Inventory evidence，不得因 PageContext summary 跳過 backend evidence retrieval；detail page 可使用 normalized `entityId`，selectedRows 問題只允許解析 normalized selected row refs；`entityId` 與 selectedRows 衝突時不得任意選擇，context 不足或衝突時必須規劃為 clarification；read-only lookup 維持既有 read-oriented risk path，restricted cost query 必須反映 permission-sensitive risk；`ExecutionPlan` 不得直接讀 raw PageContext，不得保存 raw selectedRows payload，不得把 frontend source hint 當 selected adapter；routing hints 不得繞過 HostApp Registry、permission pre-check 或 organization scope；非 host-integration request 的既有 `ExecutionPlan` 行為不得被破壞。
- [ ] T032 [US1] Wire DataAdapter execution into existing runtime in `src/assistant/runtime/assistant-readonly-runtime.service.ts`, `src/permissions/tool-permission-precheck.service.ts`, and `src/evidence/evidence-ref.service.ts`
  - 說明：將 adapter routing、organization boundary enforcement、permission pre-check、evidence conversion 接到既有 readonly runtime，不新增 public endpoint，並沿用 001 既有 identity、permission pre-check、masking、audit 與 safe response pipeline。
  - 輸出：runtime integration、organization boundary enforcement wiring、row-level permission enforcement wiring、operation-level permission enforcement wiring、adapter-side permission enforcement wiring、mixed-scope deterministic safe outcome mapping、unauthorized entity exclusion before adapter access、`EvidenceRef` scope validation。
  - 完成條件：runtime 必須依序完成 normalized `HostIntegrationContext`、HostApp / entity / screen / interaction capability selection、organization boundary validation、row-level permission validation、operation-level permission validation、adapter-side permission validation、`resolveContext`、`fetchEvidence`、field-level permission masking、result minimization、LLM-input sanitization、`EvidenceRef` conversion、frontend-safe evidence validation，以及既有 `AnswerDecision` / SSE mapping；`entityId` 出現在 PageContext、不代表 backend 已授權；entity 出現在 `selectedRows`、frontend 畫面或 frontend safe summary，不代表可直接成為 evidence；每一個 entity ID 都必須由 backend 個別重新驗證 organization 與 permission boundary；mixed authorized / unauthorized `selectedRows` 必須 deterministic，並依既有 permission policy 回 `permission_denied` 或只處理合法 scope 並留下安全化 scope outcome；不得查詢、回傳、記錄、暴露或送入 LLM 任何未授權 entity；field-level masking 不能取代 adapter execution 前的 permission pre-check；permission check 不得發生在資料查詢之後；若 `resolveContext` 可能讀取受保護業務資料，也必須在 permission 通過後才能執行；selectedRows、visibleColumns、activeFilters、PageContext summary 都不得繞過上述順序；不得新增第二套 permission engine、第二套 organization authorization service、frontend-owned permission decision、adapter 自有獨立 permission policy、新的 public `AnswerDecision` 或新的 public endpoint；unsupported host/entity 不得 fallback 到 admin adapter；runtime integration tests 通過。

**Checkpoint**: Phase 4 完成後，backend 能透過既有 assistant runtime 使用 admin reference adapter 回答 Orders / Inventory 問題。

---

## Phase 5: Safe Paths, Degraded, Audit, Observability

**Purpose**: 收斂 degraded/safe-path behavior，補齊 host-integration audit 與 observability metadata。

- [ ] T033 [P] [US7] Create safe-path integration tests in `test/integration/host-integration/safe-paths.spec.ts`
  - 說明：驗證 unsupported host/screen/interaction、selectedRows organization boundary、timeout/unavailable、frontend source-selection bypass 與 repeated request safe outcomes。
  - 輸出：`safe-paths.spec.ts`，覆蓋 unsupported screen、unsupported selectedRows interaction、cross-organization selectedRows、malformed result、frontend adapter/sourceSystem injection、repeated request / retry assertions。
  - 完成條件：unsupported host / entity / screen / interaction 走 safe path；selectedRows 含跨 organization 或混合合法/非法 ID 時行為 deterministic；frontend 嘗試指定 adapter / `sourceSystem` 時 ignore 或 fail closed；相同 normalized request retry / replay 時，scope、adapter、permission boundary、evidence scope 與 public safe outcome 必須一致；clarification、permission denied、unsupported capability outcome 不得因 retry 被繞過；retry 不得改用其他 adapter，也不得擴大 `selectedRows`；不得有 raw payload 洩漏。
- [ ] T034 [P] [US7] Create audit and observability integration tests in `test/integration/host-integration/audit-observability.spec.ts`
  - 說明：驗證 host integration lifecycle 的重要安全與 dependency metadata 能透過既有 audit / observability pipeline 被追蹤，同時不記錄 raw business data、raw PageContext、raw LLM prompt 或敏感資訊。
  - 輸出：`test/integration/host-integration/audit-observability.spec.ts`，至少覆蓋 HostApp capability lookup decision、unsupported capability decision、PageContext normalization、PageContext minimization、`activeFilters` removal / masking、`selectedRows` scope normalization、`sourceSystem` derivation、adapter eligibility decision、adapter selection、`canHandle` result、permission pre-check result、organization boundary rejection、`resolveContext` success / failure、`fetchEvidence` success / timeout / unavailable、field masking、`EvidenceRef` conversion、degraded / timeout / tool-failure safe reason，以及 final safe public outcome metadata。
  - 完成條件：audit 維持 append-only；observability 沿用既有 pipeline；每個 metadata event 可透過 `requestId` 或 trace identifier 關聯；audit / observability 只記錄 normalized identifiers、allowlisted metadata、lifecycle status、permission outcome、minimization action 與 safe-path reason；不得記錄 raw full PageContext、raw selectedRows payload、raw activeFilters payload、raw connector payload、raw fixture payload、raw LLM prompt、full customer / order / inventory record、secret、credential、access token、refresh token、connection string、stack trace、internal exception object、未遮罩敏感欄位或跨 organization entity data；audit 與 observability 不得建立第二套 host-integration 專用 pipeline；`degraded` 只能作 internal dependency metadata；audit metadata 不得改變 public `AnswerDecision`。
- [ ] T035 [P] [US7] Create degraded contract tests in `test/contract/host-integration/degraded-contract.spec.ts`
  - 說明：鎖定 DataAdapter / dependency failure 如何映射到 001 既有 safe response，確保 Backend 002 不新增 public `degraded` `AnswerDecision`，也不洩漏 raw dependency error。
  - 輸出：`test/contract/host-integration/degraded-contract.spec.ts`，至少覆蓋 adapter health unavailable / degraded、`canHandle=false`、`resolveContext` failure / ambiguous result、`fetchEvidence` timeout / unavailable、malformed adapter result、`EvidenceRef` conversion failure、dependency recovered after previous timeout、frontend source-selection bypass attempt，以及 unsupported host / entity / screen / interaction。
  - 完成條件：不得新增 `AnswerDecision = "degraded"`；不得新增 `final.data.answerDecision = "degraded"`；internal degraded / unavailable / timeout 必須映射到既有 `no_answer`、`tool_failure`、`clarification_required`、`permission_denied`、safe error envelope 或其他 001 已存在的等價 safe mapping；`tool_failure` 維持既有 `no_answer + noAnswerReason=tool_failure` 或 repo 現有 mapping；health check success 不保證 `fetchEvidence` 成功；health check failure 與 runtime timeout 必須能區分 internal metadata，但不得新增 public enum；不得回傳 raw error、stack trace、connector exception、credential、token、connection detail 或 raw payload；不得改變 non-host-integration request 的既有 safe mapping；不得建立第二套 degraded mapper；SSE final state 仍只能依既有 `final.data.answerDecision` contract。
- [ ] T036 [US7] Implement host-integration audit event assembly in `src/host-integration/host-integration-audit.service.ts`
  - 說明：把 host capability decision、PageContext normalization、adapter selection、permission masking、evidence conversion 等事件組裝成 append-only audit metadata。
  - 輸出：host-integration audit assembly、event metadata mapping、redaction hooks。
  - 完成條件：audit 至少可追蹤 host capability decision、PageContext normalization、PageContext minimization、`sourceSystem` derivation、adapter selection、adapter result status、permission pre-check result、permission masking、`EvidenceRef` conversion、degraded / timeout / unavailable safe-path reason；維持 append-only audit 原則；audit 只記錄安全化後的 metadata、identifier 與 outcome；raw connector payload、raw fixture payload、secret、credential、token、stack trace、未遮罩敏感欄位、未最小化 selectedRows data 不得進 audit metadata。
- [ ] T037 [US7] Implement observability metadata wiring in `src/observability/observability-metadata.helper.ts`, `src/audit/audit-writer.service.ts`, and `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：讓 degraded/timeout/unavailable 與 no-answer reasons 能進入既有 observability pipeline，但仍維持 001 public contract。
  - 輸出：dependency status metadata、safe-path reason mapping、runtime observability hooks。
  - 完成條件：`degraded` 僅作 internal dependency / availability state；public mapping 維持 existing assistant core safe response；不回 raw error / stack / secret；raw full PageContext、raw selectedRows payload、raw activeFilters payload、raw connector payload、raw fixture payload、raw LLM prompt、secret、credential、token、connection string、stack trace、未遮罩敏感欄位、跨 organization entity data 不得進入 observability metadata；observability integration tests 通過。

**Checkpoint**: Phase 5 完成後，safe paths、audit、observability 已完整，但還未做 golden-question regression。

---

## Phase 6: Golden Questions and Eval Smoke

**Purpose**: 用 deterministic synthetic fixtures 驗證 admin Orders / Inventory 與 safe outcomes 的最小 smoke matrix。

- [ ] T038 [US6] Add golden-question fixture manifest in `test/fixtures/host-integration/golden-questions.ts`
  - 說明：建立 deterministic golden-question manifest，作為 `T039`、`T040` 的唯一固定 eval case definition，鎖定 question、host context、fixture data、permission persona、expected routing、expected evidence 與 expected public outcome。
  - 輸出：`test/fixtures/host-integration/golden-questions.ts`，每個 case 至少包含 case ID、question、locale、host app、screen ID、entity type、entity ID 或 `selectedRows`、session scope、persona、permission scopes、normalized PageContext expectation、expected routing / adapter、expected evidence source / scope、expected public outcome、expected safe-path reason（若適用），以及 expected audit / observability assertions。
  - 完成條件：manifest 必須 deterministic、synthetic、de-identified；必須涵蓋 order detail、selectedRows comparison、inventory detail、missing context、unauthorized cost、unsupported capability、degraded / timeout 與 repeated request；persona、fixture 與 expected outcome 不得分散到 `T039` 或 `T040` 另行定義；不得引入真實資料或 dynamic fixture generation。
- [ ] T039 [P] [US6] Create admin Orders / Inventory eval tests in `test/eval/host-integration/admin-orders-inventory.eval.spec.ts`
  - 說明：驗證 admin Orders / Inventory routing、required evidence、expected answer shape 與固定 fixture values 是否與 capability / registry / runtime wiring 一致。
  - 輸出：`admin-orders-inventory.eval.spec.ts`，覆蓋 order detail routing、inventory detail routing、selected orders comparison routing、fixed fixture values / personas assertions。
  - 完成條件：至少覆蓋 order detail routing、inventory detail routing、selected orders comparison routing；驗證 expected public outcome、expected evidence source、routing hints、organization boundary 與 fixed fixture values / persona expectations。
- [ ] T040 [P] [US6] Create safe-outcomes eval tests in `test/eval/host-integration/host-integration-safe-outcomes.eval.spec.ts`
  - 說明：驗證 ambiguous intent、missing context、unsupported screen、`entityId` / selectedRows conflict、frontend source-selection bypass、malformed result、timeout 與 repeated request 等 edge-case safe outcomes。
  - 輸出：`host-integration-safe-outcomes.eval.spec.ts`，覆蓋 clarification、permission-denied / masked、safe no-answer、tool-failure 路徑。
  - 完成條件：至少覆蓋 missing context clarification、ambiguous Orders / Inventory intent、unsupported screen safe path、`entityId` / selectedRows conflict、frontend 嘗試指定 adapter / `sourceSystem` 時 ignore 或 fail closed、health success 但 `fetchEvidence` timeout、adapter 回 malformed/raw payload 的 safe outcome、repeated order detail request、repeated selectedRows comparison request、repeated missing-context request，以及 repeated unauthorized-cost request；每次執行都必須驗證 expected public outcome、expected evidence source、selectedRows scope、adapter selection 與 audit / observability safe metadata。

**Checkpoint**: `T038` 先提供 golden-question fixture manifest；`T039`、`T040` 在其後建立依賴該 manifest 的 eval tests。每個 eval case 必須驗證 expected public outcome、expected evidence source、selectedRows scope boundary、audit / observability metadata，以及 no raw payload / secret / token leakage。

---

## Phase 7: Final Contract / Regression Hardening

**Purpose**: 做最後的 API/SSE/privacy/architecture regression hardening，確認 002 不破壞 001 contract。

- [ ] T041 [P] Create final contract regression tests in `test/contract/host-integration/final-contract-regression.spec.ts`
  - 說明：集中驗證 002 完整接線後，既有 assistant API、SSE final state、EvidenceRef safety 與 no-answer mapping 仍與 001 相容。
  - 輸出：final contract regression spec、API/SSE/EvidenceRef assertions。
  - 完成條件：existing assistant API unchanged；SSE final remains AnswerDecision-based；`EvidenceRef` frontend-safe；`tool_failure` remains existing no-answer mapping。
- [ ] T042 [P] Create final privacy regression tests in `test/security/host-integration/privacy-regression.spec.ts`
  - 說明：集中驗證 frontend source selection bypass、PageContext permission bypass、raw payload leakage 等安全風險不會在整合後重新出現。
  - 輸出：privacy regression spec、frontend authority / minimization / leakage assertions。
  - 完成條件：每個 entity ID 都必須重新驗證 organization boundary、row-level permission、field-level permission、operation-level permission、adapter-side permission；entity 出現在 `selectedRows` 或頁面上不代表已授權；`visibleColumns` 顯示欄位不代表 backend 可回傳；frontend safe summary 不可直接成為 evidence；selectedRows 含跨 organization ID 時不得查詢、不得進 LLM、不得進 EvidenceRef，且必須留下安全化 audit metadata；混合 authorized / unauthorized selectedRows 時行為必須 deterministic；retry 不得造成 cross-organization entity leakage；retry 不得把前一次未授權 entity 帶入下一次 LLM input；retry 不得因 session context 殘留擴大 `EvidenceRef`；retry 不得在 log / audit / observability 中累積 raw PageContext 或 raw selectedRows payload；frontend cannot specify `sourceSystem` / connector / arbitrary data source；PageContext / visibleColumns / selectedRows cannot bypass permission；raw full PageContext、raw selectedRows payload、raw activeFilters payload、raw connector payload、raw fixture payload、raw LLM prompt、secret、credential、token、connection string、stack trace、未遮罩敏感欄位、跨 organization entity data 不得進 response / log / audit / observability / LLM。
- [ ] T043 Create final architecture guard tests in `test/unit/host-integration/final-architecture-guard.spec.ts`
  - 說明：最終鎖定 shared-registry architecture、no-second-routing-runtime 與 no-scope-creep rules。
  - 輸出：final architecture guard spec、shared-registry / scope / diagnostic-endpoint assertions。
  - 完成條件：no second routing runtime；no complete MES/WMS/SCM/CRM connector scope creep；no public diagnostic endpoint required by frontend widget。
- [ ] T044 Run final 002 validation pass and document command coverage in `specs/002-host-integration-gateway-and-data-adapter-contract/tasks.md`

**Checkpoint**: Phase 7 完成後，002 implementation 可在未破壞 001 public contract、privacy boundary、permission boundary 與 shared-registry architecture 的前提下完成最終驗收並標記完成。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 0**: No dependencies - must complete first
- **Phase 1**: Depends on Phase 0
- **Phase 2**: Depends on Phase 0 and can proceed after Phase 1 foundation interfaces are clear
- **Phase 3**: Depends on Phase 2
- **Phase 4**: Depends on Phase 1 + Phase 2 + Phase 3
- **Phase 5**: Depends on Phase 4
- **Phase 6**: Depends on Phase 3 + Phase 4 + Phase 5
- **Phase 7**: Final hardening - depends on all earlier phases

### User Story Dependencies

- **US1 / US2 / US3**: Delivered primarily through Phase 1 and Phase 4
- **US4**: Delivered primarily through Phase 2
- **US5**: Delivered through Phase 3 and Phase 4
- **US6**: Delivered through Phase 6
- **US7**: Delivered through Phase 5 and Phase 7

### Within Each Phase

- Tests MUST be written before implementation tasks
- Foundations before runtime integration
- Reference adapter before runtime integration
- Runtime integration before safe-path/eval/final hardening

### Task-Level Dependencies

- `T009` must complete before `T014`
- `T008` must complete before `T013`
- `T011`～`T014` must complete before `T031` and `T032`
- `T011`, `T012`, and `T013` must complete before `T018`, `T019`, `T031`, and `T032`
- `T013` must complete before `T027`, `T031`, and `T032`
- `T018`～`T020` must complete before `T024`～`T027`
- `T018` must complete before `T019`, `T020`, and `T024`～`T027`
- organization boundary, row-level, field-level, and operation-level tests must be established before `T032`
- `T023` and `T024` must complete before `T025` and `T026`
- `T024` must complete before `T025` and `T026`
- `T025` and `T026` must complete before `T027`
- `T031` must complete before `T032`, unless the integration boundary is explicitly proven non-conflicting
- `T027` must complete before `T029`, `T030`, and `T032`
- `T036` and `T037` must complete before Phase 6 eval tasks
- `T038` must complete before `T039` and `T040`
- `T038` fixture manifest must include fixed fixture values and persona expectations
- `T039` and `T040` must cover routing hints, organization boundary, and edge-case safe outcomes
- `T042` must execute after all runtime, adapter, and audit wiring is complete
- `T041`～`T043` can execute only after all production implementation and earlier-phase tests are complete
- `T044` must execute last

### Parallel Opportunities

- Phase 0 contract tests can run in parallel
- Phase 1 unit tests can run in parallel
- Phase 2 unit tests can run in parallel
- Phase 3 adapter unit tests can run in parallel
- `T039` and `T040` can run in parallel only after `T038` completes
- Phase 6 eval cases can run in parallel once runtime integration is complete and Phase 5 audit/observability work is ready

---

## Parallel Example

```bash
# Phase 1 unit tests can run in parallel:
Task: "Create HostIntegrationContextService unit tests in test/unit/host-integration/host-integration-context.service.spec.ts"
Task: "Create PageContextNormalizer unit tests in test/unit/host-integration/page-context-normalizer.service.spec.ts"
Task: "Create HostAppRegistry unit tests in test/unit/host-integration/host-app-registry.service.spec.ts"
```

---

## Validation Commands

```bash
npm run lint
npm run build
npm run test
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e
npm run test:eval
```

DB-backed tests must follow the existing 001 test database / environment variable convention.  
Do not introduce a separate database setup for 002.

執行前必須先檢查現有 `package.json` 是否真的存在對應 scripts。  
不得為 002 任意新增第二套 test runner 或平行測試架構。  
若 repo 沒有 `test:unit`、`test:integration`、`test:contract`、`test:eval`，則應優先使用既有 Jest / test configuration 加上 targeted test path 執行。  
只有當 repo-level convention 明確需要時，才可新增 package scripts。  
002 DB-backed tests 必須沿用 001 既有 test database 與 environment variable convention。  
不得建立 `assistant_002_test` 或其他獨立資料庫。

---

## Deferred Work

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
13. formal internal/admin diagnostic endpoint

上述項目不得被 002 tasks 實作；若需要，應進入 003 / 004 或後續 feature spec。

---

## Notes

- Backend 002 is an extension layer over 001 assistant core, not a replacement layer
- `sourceSystem` is backend-derived and must not be treated as a frontend-owned input
- `degraded` is internal-only and must not become public `AnswerDecision`
- `admin` Orders / Inventory remains reference scope only
