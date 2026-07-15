# Tasks: Host App Capability Governance and Reference Integration

**Input**: `spec.md`, `design.md`, `plan.md` from `specs/002-host-integration-gateway-and-data-adapter-contract/`

**Prerequisites**: Backend 002 accepted `spec.md`, `design.md`, `plan.md`; Backend 001 existing controller / DTO / service / runtime wiring.

**Tests**: Every phase is test-first. Each decision point must include deterministic safe outcome, minimized audit metadata, observability metadata, and privacy / redaction coverage in the same phase as the feature work.

**Organization**: Tasks are grouped by Backend 002 `plan.md` Phase 0～8. Backend 001 remains the only runtime owner; Backend 002 adds narrow capability / policy / eligibility / source-governance services only. This file is a full rewrite, not a reorder of old tasks.

## Format: `[ID] [P?] [US?] Description`

- **[P]**: Can run in parallel only when files and dependencies do not overlap.
- **[US]**: Included only when the task clearly maps to a current spec user story.
- **Paths**: Each task names exact primary file paths. No task may rely on a vague glob as its only path.

## User Story / Phase Mapping

| User Story | Focus | Primary phase |
| --- | --- | --- |
| US1 | HostApp capability | Phase 1 |
| US2 | Connector / tool eligibility restriction | Phase 3 |
| US3 | PageContext and selectedRows safety | Phase 2 / Phase 4 |
| US4 | Backend-owned `sourceSystem` | Phase 5 |
| US5 | Admin Orders | Phase 6 |
| US6 | Admin Inventory | Phase 6 |
| US7 | Unsupported host / screen / entity / interaction | Phase 1 / Phase 2 / Phase 3 |
| US8 | Golden / eval / privacy / regression | Phase 8 |

## Phase 0: Existing Contract and Architecture Guardrails

**Purpose**: Lock Backend 001 public API, SSE, `AnswerDecision`, architecture ownership, and fixture boundaries before adding Backend 002 product behavior.

- [ ] T001 [P] Create public API unchanged contract guard in `test/contract/host-integration/public-api-compatibility.contract.spec.ts`
  - 說明：鎖定 Backend 001 public assistant route surface，不允許 Backend 002 新增 public chat route、request mode 或 diagnostic endpoint。
  - 輸出：contract spec covering existing assistant public routes, no second public chat API, no Backend 002 request mode, no public diagnostic endpoint。
  - 完成條件：route assertions pass; no hard-coded Backend 002 route is introduced; history / feedback / approval public contracts remain out of Backend 002 transport scope。
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/public-api-compatibility.contract.spec.ts`
- [ ] T002 [P] Create SSE and `AnswerDecision` compatibility guard in `test/contract/host-integration/answer-decision-sse-compatibility.contract.spec.ts`
  - 說明：固定 SSE final 與 public `AnswerDecision` contract，不允許 public `degraded` 或 `source_mismatch` enum。
  - 輸出：contract spec covering SSE final shape, existing `AnswerDecision`, no public degraded, no public source mismatch。
  - 完成條件：`final.data.answerDecision` remains Backend 001-compatible; no `answerDecision="degraded"`; no `answerDecision="source_mismatch"`。
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/answer-decision-sse-compatibility.contract.spec.ts`
- [ ] T003 [P] Create top-level `pageContext` and no nested `hostContext` guard in `test/contract/host-integration/page-context-contract.contract.spec.ts`
  - 說明：鎖定 Backend 002 沿用 Backend 001 top-level `pageContext`，不得新增 nested `hostContext` 或 backend `sessionScope`。
  - 輸出：contract spec covering top-level `pageContext`, no nested `hostContext`, no backend `sessionScope`。
  - 完成條件：request shape remains Backend 001-compatible; backend `sessionScope` and nested `hostContext` are rejected or absent。
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/page-context-contract.contract.spec.ts`
- [ ] T004 [P] Create no-second-runtime architecture guard in `test/unit/host-integration/no-second-runtime-architecture.spec.ts`
  - 說明：防止 Backend 002 建立第二套 controller、orchestrator、identity、planner、permission、EvidenceRef mapper、audit writer 或 observability pipeline。
  - 輸出：architecture guard spec checking module/service ownership boundaries and forbidden file/class names。
  - 完成條件：no second `AssistantController`, no second message orchestrator, no second identity extractor, no second planner, no second permission engine, no second evidence mapper, no second audit writer。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/no-second-runtime-architecture.spec.ts`
- [ ] T005 [P] Create no DataAdapter runtime guard in `test/unit/host-integration/no-data-adapter-runtime.spec.ts`
  - 說明：v1 不建立 `DataAdapter`, `DataAdapterRegistryService`, `DataAdapterEvidenceResult`, DataAdapter health/timeout/permission/degraded mapper。
  - 輸出：architecture guard spec for prohibited DataAdapter artifacts。
  - 完成條件：no planned v1 source path or provider introduces DataAdapter runtime or registry。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/no-data-adapter-runtime.spec.ts`
- [ ] T006 [P] Create Admin fixture collision guard in `test/unit/host-integration/admin-fixture-collision.spec.ts`
  - 說明：Phase 0 尚未建立 Backend 002 fixtures；此 guard 只鎖定 Backend 001 fixture 不被未來 Backend 002 覆寫。
  - 輸出：fixture collision guard spec。
  - 完成條件：Backend 001 `SO-10001` / `SKU-001` remain unchanged; future Backend 002 fixtures must use `ADMIN-*` namespace; fixture loader must not overwrite existing IDs。`ADMIN-SO-10001` / `ADMIN-SKU-001` existence is validated later in Phase 6。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/admin-fixture-collision.spec.ts`
- [ ] T007 [P] Create host integration orchestration guard in `test/unit/host-integration/controller-orchestration-guard.spec.ts`
  - 說明：`AssistantController` must not coordinate HostApp capability, planning, tools, permission, evidence, answer, audit chain directly。
  - 輸出：architecture guard spec for controller and host integration module orchestration boundaries。
  - 完成條件：`AssistantController` remains transport/delegation only; host integration module is not a message orchestrator; only `AssistantMessageService` may receive Stage A, Stage B, or source resolver injection as their application-flow owner。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/controller-orchestration-guard.spec.ts`
**Checkpoint**: Phase 0 guards all exist before Phase 1 begins.

## Phase 1: Static HostApp Capability Registry

**Purpose**: Add static HostApp capability governance only.

- [ ] T008 [P] [US1] Create HostApp registry unit tests in `test/unit/host-integration/host-app-registry.service.spec.ts`
  - 說明：Test `admin` lookup, unregistered host no fallback, reserved identifiers inactive, screen/entity/interaction declaration, selectedRows policy, filter allowlist, field exposure policy。
  - 輸出：unit spec for `HostAppRegistryService`。
  - 完成條件：tests assert `admin` is registered; `mes` / `wms` / `scm` / `crm` / `custom` are reserved but inactive; unregistered host does not fallback。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-registry.service.spec.ts`
- [ ] T009 [P] [US1] Create capability permission guard tests in `test/unit/host-integration/host-app-capability-architecture.spec.ts`
  - 說明：Capability can only restrict Backend 001 verified permission; role, persona, visibleColumns, and connector domain cannot grant HostApp authority。
  - 輸出：unit architecture spec for capability permission model。
  - 完成條件：capability cannot elevate permission; connector domain cannot own HostApp capability authority。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-capability-architecture.spec.ts`
- [ ] T010 [US1] Implement HostApp capability types in `src/host-integration/host-app-capability.types.ts`
  - 說明：Define narrow capability type for host app governance without copying identity authority。
  - 輸出：types for host app id, supported screens/entities/interactions, eligible tool keys, PageContext allowlist, selectedRows policy, filter allowlist, field exposure policy, permission interpretation, unsupported behavior。
  - 完成條件：type supports all `admin` capability declarations; no identity snapshot, no permission source type。
  - 依賴：T008, T009.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-capability-architecture.spec.ts`
- [ ] T011 [US1] Implement static HostApp registry in `src/host-integration/host-app-registry.service.ts`
  - 說明：Provide static code-based lookup for v1 capabilities。
  - 輸出：`HostAppRegistryService` with lookup behavior, unsupported result, no fallback。
  - 完成條件：`admin` can resolve; unregistered hosts return unsupported; registry does not require DB table or connector ownership。
  - 依賴：T010.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-registry.service.spec.ts`
- [ ] T012 [US1] Add Admin reference capability in `src/host-integration/admin-reference-capability.ts`
  - 說明：Declare Admin Orders / Inventory supported screens, entities, interactions, selectedRows policy, filter allowlist, field exposure, eligible tool keys。
  - 輸出：static `admin` capability declaration。
  - 完成條件：Admin capability covers Orders and Inventory only; future hosts remain reserved identifiers; capability does not grant restricted cost permission。
  - 依賴：T010.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-registry.service.spec.ts`
- [ ] T013 [US1] Wire host integration module into AssistantModule in `src/host-integration/host-integration.module.ts` and `src/assistant/assistant.module.ts`
  - 說明：Phase 1 只註冊 HostApp capability governance 所需 provider，並讓既有 `AssistantModule` 可匯入 `HostIntegrationModule`。
  - 輸出：module exporting `HostAppRegistryService` and static `admin-reference-capability.ts` dependencies, plus `AssistantModule` import wiring。
  - 完成條件：`AssistantModule` imports `HostIntegrationModule`; Phase 1 does not require `HostPageContextPolicyService`, `HostInteractionEligibilityService`, or `SourceSystemResolver` injection before those providers are created in later phases; `AssistantController` does not inject host integration services; no controller, message orchestrator, identity extractor, or circular module dependency is introduced。
  - 依賴：T011, T012.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/no-second-runtime-architecture.spec.ts`
- [ ] T014 [US1] Add capability lookup metadata behavior in `src/host-integration/host-app-registry.service.ts`
  - 說明：Registry decision must expose minimized audit/observability metadata for registered, unregistered, no-fallback, and permission-elevation-prohibited outcomes。
  - 輸出：safe metadata fields / reason codes from registry lookup。
  - 完成條件：metadata includes host id and reason code only; no raw request payload; no permission elevation implication。
  - 依賴：T011.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-app-registry.service.spec.ts`

**Checkpoint**: `admin` capability is resolvable; unregistered hosts reject deterministically; no dynamic DB registry or connector-owned capability exists.

## Phase 2: Request Boundary and Stage A Host PageContext Policy

**Purpose**: Add Stage A policy after Backend 001 DTO/identity validation and before Query Understanding.

- [ ] T015 [P] [US3] Create Stage A request-boundary integration tests in `test/integration/host-integration/stage-a-request-boundary.spec.ts`
  - 說明：Verify Backend 001 DTO/identity validation runs first, then routing-control rejection, HostApp lookup, and Stage A request/context validation run before `AssistantMessageRepository.createUserMessage()` and `createPendingAssistantMessage()`。
  - 輸出：integration spec for Stage A order and request-boundary rejection。
  - 完成條件：routing injection, unregistered host, malformed selectedRows, selectedRows over-limit, and forbidden raw entity payload reject before user message persistence, pending assistant message persistence, Query Understanding, Planning, Tool Registry, ConnectorAdapter, LLM, and AnswerDecision。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-a-request-boundary.spec.ts`
- [ ] T016 [P] [US3] Create Stage A PageContext policy unit tests in `test/unit/host-integration/host-page-context-policy.service.spec.ts`
  - 說明：Test unsupported screen/entity, selectedRows raw count before dedupe, over-limit rejection, invalid shape, raw payload rejection, target conflict, filters minimization, visibleColumns not permission。
  - 輸出：unit spec for `HostPageContextPolicyService`。
  - 完成條件：target conflict -> `clarification_required`; unsupported screen/entity -> `no_answer`; selectedRows invalid/over-limit -> existing error envelope classification。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-page-context-policy.service.spec.ts`
- [ ] T017 [P] [US3] Create Stage A privacy redaction tests in `test/security/host-integration/page-context-redaction.spec.ts`
  - 說明：Validate raw PageContext, raw selectedRows, raw activeFilters, raw entity payload do not enter LLM/audit/log metadata。
  - 輸出：security/privacy spec for Stage A redaction。
  - 完成條件：only normalized identifiers and allowlisted metadata are emitted。
  - 驗證：`npm run test -- --runTestsByPath test/security/host-integration/page-context-redaction.spec.ts`
- [ ] T018 [P] [US3] Create no-interaction/no-candidate Stage A guard in `test/unit/host-integration/stage-a-boundary-guard.spec.ts`
  - 說明：Stage A must not receive query interaction, produce candidate tools, or perform connector eligibility。
  - 輸出：unit architecture guard。
  - 完成條件：`HostPageContextPolicyService` has no interaction/tool eligibility authority。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/stage-a-boundary-guard.spec.ts`
- [ ] T019 [US3] Implement `HostPageContextPolicyService` in `src/host-integration/host-page-context-policy.service.ts`
  - 說明：Apply host-specific PageContext policy over Backend 001 validated DTO/mapped context。
  - 輸出：Stage A policy service for screen/entity, allowlist/minimization, selectedRows shape/count, target conflict。
  - 完成條件：does not parse public body; does not persist context state; does not process interaction/tools/permissions。
  - 依賴：T010, T011, T012, T016, T018.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-page-context-policy.service.spec.ts`
- [ ] T020 [US3] Implement routing-control rejection hook in `src/assistant/message/assistant-message.service.ts`
  - 說明：Reject client-owned connector/adapter/source/tool/permission routing controls after DTO/identity validation and before `AssistantMessageRepository.createUserMessage()`。
  - 輸出：request-boundary hook using existing error envelope and minimized audit reason。
  - 完成條件：rejected payload does not create user or pending assistant messages and does not enter Query Understanding, planning, Tool Registry, ConnectorAdapter, LLM, or AnswerDecision; only field names, requestId, hostApp, organization, and reason code may be audited。
  - 依賴：T015, T019.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-a-request-boundary.spec.ts`
- [ ] T021 [US3] Wire Stage A before Query Understanding in `src/host-integration/host-integration.module.ts`, `src/assistant/assistant.module.ts`, and `src/assistant/message/assistant-message.service.ts`
  - 說明：在 `HostPageContextPolicyService` 實作完成後，將其註冊並 export 於 `HostIntegrationModule`，再由 `AssistantModule` 匯入，供 `AssistantMessageService` 在 Backend 001 DTO/identity/PageContext validation 後使用。
  - 輸出：Stage A provider/export wiring、`AssistantModule` import、`AssistantMessageService` injection 與 message service hook。
  - 完成條件：fixed order is DTO validation -> identity validation -> routing-control rejection -> HostApp Registry lookup -> Stage A request/context validation -> `createUserMessage()` -> `createPendingAssistantMessage()` -> Query Understanding -> Planning; Stage A 不註冊或注入尚未完成的 `HostInteractionEligibilityService` / `SourceSystemResolver`，不建立 placeholder provider 或 module cycle，且 `AssistantController` 不注入 Stage A service；early returns use existing request/integration envelope and call `AuditWriterService.append()` before returning。
  - 依賴：T019, T020.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-a-request-boundary.spec.ts`
- [ ] T022 [US3] Pass Stage A canonical context into planning input composition in `src/host-integration/host-page-context-policy.service.ts` and `src/assistant/message/assistant-message.service.ts`
  - 說明：`HostPageContextPolicyService` owns host-specific allowlist/minimization; generic PageContext mapper stays host-agnostic。
  - 輸出：canonical/minimized context and capability constraints passed to downstream Query Understanding / Planning composition。
  - 完成條件：no second PageContext mapper; `src/assistant/page-context/page-context.mapper.ts` is changed only if code inspection proves a generic metadata gap for raw count, validation metadata, or canonical safe refs; any mapper change must remain host-agnostic and must not read `HostAppCapability` or execute host-specific policy。
  - 依賴：T019.
  - 驗證：`npm run test -- --runTestsByPath test/security/host-integration/page-context-redaction.spec.ts`
- [ ] T023 [US3] Add Stage A decision audit/observability in `src/host-integration/host-page-context-policy.service.ts` and `src/assistant/message/assistant-message.service.ts`
  - 說明：`HostPageContextPolicyService` 只產生 decision、safe reason code 與 minimized metadata；`AssistantMessageService` 在 early return 或 continuation 前以既有 `AuditWriterService.append()` 寫入 audit。
  - 輸出：routing rejection、unregistered HostApp、unsupported screen/entity、selectedRows invalid/over-limit、raw entity payload rejection、target conflict 與 context ambiguity 的安全 metadata 與 call-site persistence。
  - 完成條件：routing-control rejection、unregistered HostApp、selectedRows invalid shape/over-limit、raw entity payload rejection 均在 message persistence 前 audit；unsupported screen/entity、target conflict、context ambiguity 均在對應 return 前 audit；每次 decision 僅寫一次，metadata 不含 raw PageContext、raw selectedRows、raw activeFilters 或 routing-control values，且 `AuditWriterService` 不重新計算 Stage A policy。
  - 依賴：T019.
  - 驗證：`npm run test -- --runTestsByPath test/integration/host-integration/stage-a-request-boundary.spec.ts test/security/host-integration/page-context-redaction.spec.ts`

**Checkpoint**: Stage A rejects unsafe context before planning and has not performed interaction eligibility or tool authorization.

## Phase 3: Planning Integration and Stage B Interaction Eligibility

**Purpose**: Add post-planning eligibility narrowing through `HostInteractionEligibilityService`.

- [ ] T024 [P] [US2] Create Stage B eligibility unit tests in `test/unit/host-integration/host-interaction-eligibility.service.spec.ts`
  - 說明：Test unsupported interaction/operation, selectedRows comparison eligibility, capability tool-key intersection, static scope compatibility, no-candidate outcome。
  - 輸出：unit spec for Stage B service。
  - 完成條件：unsupported interaction/operation -> `no_answer`; no provisional candidate -> deterministic `no_answer`。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-interaction-eligibility.service.spec.ts`
- [ ] T025 [P] [US2] Create `ProvisionalEligibleTools` tests in `test/unit/host-integration/provisional-eligible-tools.spec.ts`
  - 說明：Validate provisional candidates are not authorization proof and cannot execute row-level permission or connector logic。
  - 輸出：unit spec for provisional output semantics。
  - 完成條件：provisional output narrows candidates only; final permission remains with `ToolPermissionPrecheckService`。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/provisional-eligible-tools.spec.ts`
- [ ] T026 [P] [US2] Create post-planning integration tests in `test/integration/host-integration/stage-b-planning-eligibility.spec.ts`
  - 說明：Stage B must run after Query Understanding / persisted `ExecutionPlan`, and `ToolDefinition` metadata must come from `ToolRegistryService`。
  - 輸出：integration spec for ordering and registry metadata source。
  - 完成條件：Stage B does not modify Query Understanding authority, does not create second `ExecutionPlan`, does not copy Tool Registry。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-b-planning-eligibility.spec.ts`
- [ ] T027 [P] [US2] Create Stage B architecture guard in `test/unit/host-integration/stage-b-architecture-guard.spec.ts`
  - 說明：Ensure `HostInteractionEligibilityService` is the only Stage B owner and cannot execute connectors, create EvidenceRef, create AnswerDecision, or persist audit。
  - 輸出：architecture guard spec。
  - 完成條件：no row-level permission, no connector execution, no EvidenceRef, no AnswerDecision in Stage B service; `host-integration.module.ts` exports Stage B only after implementation, and `assistant.module.ts` imports it without a module cycle or Controller injection。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/stage-b-architecture-guard.spec.ts`
- [ ] T028 [US2] Implement `HostInteractionEligibilityService` in `src/host-integration/host-interaction-eligibility.service.ts`
  - 說明：Narrow post-planning candidate tools using capability, interaction/operation eligibility, and static scope compatibility。
  - 輸出：Stage B service with `ProvisionalEligibleTools` output and minimized reason codes。
  - 完成條件：service only narrows candidates; does not authorize execution; does not own registry。
  - 依賴：T024, T025, T026.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/host-interaction-eligibility.service.spec.ts`
- [ ] T029 [US2] Wire Stage B after planning in `src/host-integration/host-integration.module.ts`, `src/assistant/assistant.module.ts`, and `src/assistant/message/assistant-message.service.ts`
  - 說明：在 `HostInteractionEligibilityService` 實作完成後，將其註冊並 export 於 `HostIntegrationModule`，由 `AssistantModule` 匯入，讓 `AssistantMessageService` 在 `AssistantPlanningService` / `ExecutionPlan` 後、readonly runtime 前呼叫 Stage B。
  - 輸出：Stage B provider/export wiring、`AssistantModule` import、message service injection 與 post-planning ordering integration。
  - 完成條件：Stage B receives existing Query Understanding result, `ExecutionPlan`, candidate tool keys, `ToolDefinition` metadata; output is only `ProvisionalEligibleTools` and safe metadata; it does not create a second `ExecutionPlan`, inject `AssistantController`, own `EvidenceRefService` / `AnswerDecisionService`, or introduce a module cycle。
  - 依賴：T028.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-b-planning-eligibility.spec.ts`
- [ ] T030 [US2] Integrate Stage B with `ToolRegistryService` metadata in `src/tools/tool-registry.service.ts`
  - 說明：Expose only existing registered `ToolDefinition` metadata needed for static scope-compatible filtering。
  - 輸出：minimal registry read path for Stage B, no duplicated registry。
  - 完成條件：Stage B reads `ToolDefinition` metadata from `ToolRegistryService`; no copied registry or connector-owned HostApp authority。
  - 依賴：T028.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/stage-b-planning-eligibility.spec.ts`
- [ ] T031 [US2] Add Stage B safe outcome and audit metadata in `src/host-integration/host-interaction-eligibility.service.ts` and `src/assistant/message/assistant-message.service.ts`
  - 說明：`HostInteractionEligibilityService` 只產生 interaction/operation decision、no-candidate decision、safe tool keys 與 reason code；`AssistantMessageService` 在 return 或 runtime handoff 前透過 `AuditWriterService.append()` persist audit。
  - 輸出：unsupported interaction/operation、no provisional candidate 與 provisional candidate set 的 audit-safe eligibility metadata。
  - 完成條件：unsupported outcome 有 audit，successful provisional handoff 也有必要的 minimized observability metadata；Stage B 不直接 persist audit，也不記錄 full `ToolDefinition`、raw context、raw PageContext 或 fabricated permission result；`AuditWriterService` 不重新執行 eligibility。
  - 依賴：T028.
  - 驗證：`npm run test -- --runTestsByPath test/unit/host-integration/host-interaction-eligibility.service.spec.ts test/integration/host-integration/stage-b-planning-eligibility.spec.ts`

**Checkpoint**: Stage B narrows candidates only and emits `ProvisionalEligibleTools`.

## Phase 4: Existing Readonly Runtime and Authoritative Permission Integration

**Purpose**: Wire provisional candidates into existing readonly runtime and enforce permission/row checks before connector execution.

- [ ] T032 [P] [US3] Create readonly runtime permission-order integration tests in `test/integration/host-integration/readonly-runtime-permission-order.spec.ts`
  - 說明：Verify `AssistantMessageService` remains orchestrator, controller does not coordinate full chain, pre-check happens before connector execution, provisional tools cannot bypass pre-check。
  - 輸出：integration spec for runtime ordering。
  - 完成條件：connector execution is impossible before `ToolPermissionPrecheckService` passes。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/readonly-runtime-permission-order.spec.ts`
- [ ] T033 [P] [US3] Create selectedRows revalidation tests in `test/integration/host-integration/selected-rows-revalidation.spec.ts`
  - 說明：Validate organization and row-level checks before full data retrieval, whole-request denial, no legal subset, no failed row ID leak。
  - 輸出：integration spec for selectedRows authority。
  - 完成條件：any unauthorized row -> whole-request `permission_denied`; failed row id not exposed; unauthorized row does not enter LLM/EvidenceRef。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/selected-rows-revalidation.spec.ts`
- [ ] T034 [P] [US3] Create runtime ordering architecture guard in `test/unit/host-integration/runtime-ordering-architecture.spec.ts`
  - 說明：Ensure `AssistantReadonlyRuntimeService` is execution subflow owner and connector execution cannot precede pre-check/row validation。
  - 輸出：unit architecture guard。
  - 完成條件：no second orchestrator; no `AdminRowPermissionEngine`, `HostPermissionService`, `AdapterPermissionService`, or second permission mapping。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/runtime-ordering-architecture.spec.ts`
- [ ] T035 [US3] Wire provisional input into readonly runtime in `src/assistant/message/assistant-message.service.ts`
  - 說明：Pass Stage B `ProvisionalEligibleTools` into Backend 001 readonly runtime without bypassing registry or permission。
  - 輸出：message service handoff to `AssistantReadonlyRuntimeService`。
  - 完成條件：message service remains orchestrator; controller remains transport/delegation only。
  - 依賴：T029, T032.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/readonly-runtime-permission-order.spec.ts`
- [ ] T036 [US3] Enforce tool resolution and pre-check ordering in `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：Resolve tool through `ToolRegistryService`, then run `ToolPermissionPrecheckService` before connector execution。
  - 輸出：readonly runtime ordering update。
  - 完成條件：`ConnectorAdapter` execution only after tool resolution and pre-check pass。
  - 依賴：T035.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/readonly-runtime-permission-order.spec.ts`
- [ ] T037 [US3] Add selectedRows organization validation in `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：Validate every selected row organization boundary before retrieving complete data。
  - 輸出：organization validation hook using Backend 001 identity / organization boundary policy。
  - 完成條件：cross-organization row blocks whole request; no failed ID leak; no data retrieval for unauthorized row。
  - 依賴：T036.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/selected-rows-revalidation.spec.ts`
- [ ] T038 [US3] Add generic selectedRows row authorization extension in `src/permissions/permission-policy.interface.ts`, `src/permissions/tool-permission-precheck.service.ts`, and `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：`ToolPermissionPrecheckService.check()` remains the authoritative tool/operation/required-scope gate. Because the existing `PermissionPolicy` exposes only `evaluate()` and has no row authorization method, add a minimal generic batch-row authorization interface/callback in the existing permission domain; `AssistantReadonlyRuntimeService` invokes it with canonical selected row references after organization-boundary validation.
  - 輸出：generic batch row authorization input/result, all-or-nothing authorization integration, and runtime call site.
  - 完成條件：organization boundary uses existing `assertSameCompanyBoundary()` policy; row authorization returns an all-or-nothing result without failed-row disclosure; any row denial returns whole-request `permission_denied`; connector execution cannot begin first; no `AdminRowPermissionEngine`, `HostPermissionService`, adapter-owned permission service, or second permission engine.
  - 依賴：T037.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/selected-rows-revalidation.spec.ts`
- [ ] T039 [US3] Verify masking and sanitizer ownership in `src/permissions/llm-input-sanitizer.service.ts` and `src/permissions/masking.util.ts`
  - 說明：Ensure Backend 001 masking/sanitizer remain final owners for LLM input and field exposure。
  - 輸出：minimal integration or guard updates around existing sanitizer/masking utilities。
  - 完成條件：capability cannot expand organization/row/field/operation scope; unauthorized rows/fields do not enter LLM/EvidenceRef collection。
  - 依賴：T038.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/selected-rows-revalidation.spec.ts`
- [ ] T040 [US3] Add permission decision audit metadata in `src/assistant/runtime/assistant-readonly-runtime.service.ts`
  - 說明：Audit permission denial, selectedRows row denial, and connector execution ordering through existing `AuditWriterService.append()` calls without leaking failed row IDs。
  - 輸出：minimized permission ordering and denial metadata。
  - 完成條件：audit records reason codes only; no raw row ids, raw selectedRows, or unauthorized entity data。
  - 依賴：T036, T038.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/selected-rows-revalidation.spec.ts`
- [ ] T041 [P] Create connector timeout/unavailable integration tests in `test/integration/host-integration/connector-timeout-unavailable.spec.ts`
  - 說明：Cover connector timeout, health unavailable, dependency unavailable, and non-succeeded connector result in the existing readonly runtime path。
  - 輸出：integration spec for connector dependency safe outcomes。
  - 完成條件：all connector timeout/unavailable cases map through existing `tool_failure` safe mapping; no public degraded enum; no raw connector error, stack trace, credential, token, connection detail, or raw connector payload leaks to response/log/audit/LLM。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/connector-timeout-unavailable.spec.ts`
- [ ] T042 Handle connector timeout/unavailable in `src/assistant/runtime/assistant-readonly-runtime.service.ts`, `src/connectors/mock/mock-connector.adapter.ts`, and `src/observability/dependency-health.service.ts`
  - 說明：Preserve Backend 001 readonly execution ownership while making timeout/unavailable behavior deterministic for Backend 002 Admin reference flows。
  - 輸出：minimal runtime/connector/dependency-health handling for timeout, unavailable, and non-succeeded connector outcomes。
  - 完成條件：first verify existing `MockConnectorAdapter` can already express timeout/health/unavailable behavior; if sufficient, no adapter change is made; if only namespaced lookup or timeout fixture behavior is missing, make the smallest existing-adapter change; if a new connector contract, DataAdapter runtime, or Admin-specific adapter is required, stop dependent implementation and report a blocking contract gap; all public outcomes reuse existing `tool_failure` mapping。
  - 依賴：T036, T041.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/connector-timeout-unavailable.spec.ts`
- [ ] T043 Persist connector timeout/unavailable audit and observability in `src/assistant/runtime/assistant-readonly-runtime.service.ts`, `src/audit/audit-writer.service.ts`, `src/observability/dependency-health.service.ts`, `src/observability/observability.module.ts`, and `src/assistant/assistant.module.ts`
  - 說明：由 readonly runtime 捕捉既有 connector failure，產生 safe dependency metadata，透過既有 `AuditWriterService.append()` 寫入 audit，並使用 `DependencyHealthService` 作為 dependency status owner；必要時只補既有 module 的 export/import wiring。
  - 輸出：timeout/unavailable audit persistence call site、dependency metadata、必要的 `ObservabilityModule` export 與 `AssistantModule` import wiring。
  - 完成條件：connector timeout/unavailable -> runtime catches existing failure -> safe dependency metadata -> `AuditWriterService.append()` -> existing `tool_failure` outcome；metadata 僅含 dependency identifier、safe connector/tool key、internal timeout/unavailable reason、dependency health status 與 request correlation，不含 raw exception、stack trace、credential、connection string、endpoint secret 或 raw connector payload；public result fixed to `no_answer + noAnswerReason=tool_failure`，不得映射為 `permission_denied`、`clarification_required`、public `degraded`、timeout 或 source mismatch enum；Phase 7 only consolidates this existing call site.
  - 依賴：T042.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/connector-timeout-unavailable.spec.ts`

**Checkpoint**: connector execution happens only after pre-check and all selectedRows checks pass.

## Phase 5: Backend-owned Source Derivation and Evidence Consistency

**Purpose**: Add backend-owned source governance around the existing evidence path.

- [ ] T044 [P] [US4] Create source resolver unit tests in `test/unit/host-integration/source-system-resolver.service.spec.ts`
  - 說明：Expected source derivation excludes frontend `sourceSystem` and derives from final `ToolDefinition` / `ConnectorAdapter` association。
  - 輸出：unit spec for expected source derivation and safe reason codes。
  - 完成條件：frontend source input is not accepted; expected source derivation is deterministic。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/source-system-resolver.service.spec.ts`
- [ ] T045 [P] [US4] Create source consistency integration tests in `test/integration/host-integration/source-consistency.spec.ts`
  - 說明：Verify derivation before EvidenceRef, consistency after normalization, pass continues answer。
  - 輸出：integration spec for source flow ordering。
  - 完成條件：`SourceSystemResolver.deriveExpectedSource(...)` runs before `EvidenceRefService` attach/normalize/persist; `SourceSystemResolver.verifyEvidenceConsistency(...)` runs after EvidenceRef normalization and before answer flow; `EvidenceRefService` stays generic。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts`
- [ ] T046 [P] [US4] Create source mismatch contract tests in `test/contract/host-integration/source-mismatch.contract.spec.ts`
  - 說明：Mismatch maps to `no_answer + noAnswerReason=tool_failure`, produces no grounded answer, and adds no public `source_mismatch` enum。
  - 輸出：contract spec for mismatch public outcome。
  - 完成條件：mismatch does not create AnswerDecision enum; no actual-overwrites-expected behavior。
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/source-mismatch.contract.spec.ts`
- [ ] T047 [US4] Implement `SourceSystemResolver` in `src/host-integration/source-system-resolver.service.ts`
  - 說明：Provide expected source derivation and EvidenceRef consistency verification with audit-safe reason codes。
  - 輸出：source resolver service。
  - 完成條件：no source registry/database/store; no public source selection API; no frontend-owned source input。
  - 依賴：T044.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/source-system-resolver.service.spec.ts`
- [ ] T048 [US4] Wire `SourceSystemResolver` after implementation in `src/host-integration/host-integration.module.ts`, `src/assistant/assistant.module.ts`, and `src/assistant/message/assistant-message.service.ts`
  - 說明：在 resolver 實作完成後才將其註冊並 export 於 `HostIntegrationModule`，由 `AssistantModule` 匯入並僅注入 `AssistantMessageService`，使 message service 成為唯一 source/evidence orchestration owner。
  - 輸出：resolver provider/export wiring、`AssistantModule` import、`AssistantMessageService` injection。
  - 完成條件：`AssistantController` 與 `AssistantReadonlyRuntimeService` 不注入 resolver；`EvidenceRefService` 不依賴 HostApp Registry 或 resolver；不產生 module cycle，且不讓 Message Service 與 readonly runtime 同時執行 consistency verification。
  - 依賴：T047.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts`
- [ ] T049 [US4] Hook expected source derivation before EvidenceRef in `src/assistant/message/assistant-message.service.ts`
  - 說明：Primary source/evidence orchestration owner for Backend 002 is `AssistantMessageService`; it receives the sanitized runtime result and final tool/connector identity from `AssistantReadonlyRuntimeService`, then derives expected source before EvidenceRef normalization/persistence。
  - 輸出：message-service expected source derivation hook。
  - 完成條件：readonly runtime only returns sanitized execution result and final identity; expected source is tied to the actual final tool/connector association and is not frontend-controlled。
  - 依賴：T048.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts`
- [ ] T050 [US4] Orchestrate EvidenceRef source verification in `src/assistant/message/assistant-message.service.ts`
  - 說明：`AssistantMessageService` calls generic `EvidenceRefService` attach/normalize/persist, then invokes `SourceSystemResolver.verifyEvidenceConsistency(...)` exactly once before `AnswerDecisionService` / SSE。
  - 輸出：single-owner orchestration hook around the existing EvidenceRef flow。
  - 完成條件：`EvidenceRefService` stays generic and does not depend on HostApp registry or resolver; consistency pass permits answer flow; mismatch blocks grounded answer before AnswerDecision; readonly runtime neither persists EvidenceRef nor verifies source consistency。
  - 依賴：T049.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts`
- [ ] T051 [US4] Add source mismatch audit metadata in `src/host-integration/source-system-resolver.service.ts` and `src/assistant/message/assistant-message.service.ts`
  - 說明：Resolver produces expected/actual comparison result and safe mismatch metadata; the single primary owner, `AssistantMessageService`, calls `AuditWriterService.append()` before blocking the grounded answer and returning existing `tool_failure`.
  - 輸出：expected source key、actual source key、safe connector key、safe tool key、reason code 與 request correlation metadata plus message-service persistence call site。
  - 完成條件：audit occurs before tool-failure return and verification runs once; raw connector result, raw evidence payload, restricted values are not logged/audited; `AuditWriterService` does not derive source mismatch。
  - 依賴：T050.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts`
- [ ] T052 [US4] Map source mismatch through existing tool-failure flow in `src/assistant/message/assistant-message.service.ts`
  - 說明：After the required mismatch audit, reuse existing `tool_failure` safe mapping from message orchestration; modify `AnswerDecisionService` / `NoAnswerGateService` only if tests prove an actual generic mapping gap。
  - 輸出：orchestration-level safe outcome mapping for source mismatch。
  - 完成條件：mismatch returns `no_answer + noAnswerReason=tool_failure`; no grounded answer; no public `source_mismatch`; no generic answer service changes unless required by failing contract tests。
  - 依賴：T051.
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/source-mismatch.contract.spec.ts`

**Checkpoint**: source consistency is verified before answer flow, and mismatch is deterministic `tool_failure`.

## Phase 6: Admin Orders / Inventory Reference Integration

**Purpose**: Add Admin reference acceptance using existing connector/tool/runtime.

- [ ] T053 [P] Create Admin fixture tests in `test/unit/host-integration/admin-reference-fixtures.spec.ts`
  - 說明：Validate `ADMIN-SO-10001`, `ADMIN-SKU-001`, Backend 001 fixture preservation, and fixture load order。
  - 輸出：fixture unit spec。
  - 完成條件：Backend 002 fixtures are namespaced and synthetic; Backend 001 `SO-10001` / `SKU-001` remain unchanged。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/admin-reference-fixtures.spec.ts`
- [ ] T054 [P] [US5] Create Admin Orders integration tests in `test/integration/host-integration/admin-orders-reference.spec.ts`
  - 說明：Cover order status, order summary, selected orders comparison, expected evidence source, existing runtime usage。
  - 輸出：Orders reference integration spec。
  - 完成條件：queries use existing connector/tool/runtime; no mandatory Admin adapter。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-orders-reference.spec.ts`
- [ ] T055 [P] [US6] Create Admin Inventory integration tests in `test/integration/host-integration/admin-inventory-reference.spec.ts`
  - 說明：Cover inventory availability, inventory summary, expected evidence source, existing runtime usage。
  - 輸出：Inventory reference integration spec。
  - 完成條件：queries use existing connector/tool/runtime; no mandatory Admin adapter。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-inventory-reference.spec.ts`
- [ ] T056 [P] Create restricted cost tests in `test/integration/host-integration/admin-restricted-cost.spec.ts`
  - 說明：Cover limited user pure cost -> `permission_denied`, persona name cannot grant cost, non-misleading partial answer, misleading mixed answer -> `permission_denied`, restricted value leakage guards。
  - 輸出：restricted cost integration spec。
  - 完成條件：restricted values never enter LLM, EvidenceRef, response, log, or audit。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-restricted-cost.spec.ts`
- [ ] T057 [US5] Add namespaced Admin Orders fixture in `src/connectors/mock/fixtures/orders.fixture.ts`
  - 說明：Add synthetic `ADMIN-SO-10001` without overriding Backend 001 `SO-10001`。
  - 輸出：namespaced order fixture with safe synthetic fields and restricted cost marker。
  - 完成條件：fixture is de-identified; load order does not change existing IDs。
  - 依賴：T053.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/admin-reference-fixtures.spec.ts`
- [ ] T058 [US6] Add namespaced Admin Inventory fixture in `src/connectors/mock/fixtures/inventory.fixture.ts`
  - 說明：Add synthetic `ADMIN-SKU-001` without overriding Backend 001 `SKU-001`。
  - 輸出：namespaced inventory fixture with safe synthetic fields and restricted cost marker。
  - 完成條件：fixture is de-identified; load order does not change existing IDs。
  - 依賴：T053.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/admin-reference-fixtures.spec.ts`
- [ ] T059 Export Admin fixtures through `src/connectors/mock/fixtures/index.ts`
  - 說明：Expose namespaced Admin fixtures to existing mock connector without changing existing fixture behavior。
  - 輸出：fixture index update。
  - 完成條件：existing fixture exports remain stable; Admin fixtures are additive only。
  - 依賴：T057, T058.
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/admin-reference-fixtures.spec.ts`
- [ ] T060 Add Admin tool-key mapping in `src/host-integration/admin-reference-capability.ts`
  - 說明：Map Admin capability to existing tool/connector keys for Orders and Inventory。
  - 輸出：Admin capability tool-key mapping update。
  - 完成條件：tool-key mapping references existing Tool Registry; no Admin-specific registry。
  - 依賴：T012, T054, T055.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-orders-reference.spec.ts test/integration/host-integration/admin-inventory-reference.spec.ts`
- [ ] T061 Check or minimally extend existing mock connector behavior in `src/connectors/mock/mock-connector.adapter.ts`
  - 說明：First verify existing `MockConnectorAdapter` can query namespaced fixtures by existing tool keys, return evidence-compatible results, and preserve timeout/health behavior。
  - 輸出：capability check result; optional minimal namespaced lookup extension only if current lookup cannot reach Admin fixtures。
  - 完成條件：if existing connector is sufficient, no adapter change is made and tests pass; if only namespaced lookup is missing, make the smallest existing-adapter change without contract/registry changes; if a new contract or adapter abstraction is required, stop Phase 6 dependent implementation and report a blocking contract gap instead of inventing `AdminOrdersAdapter`, `AdminInventoryAdapter`, or a new registry。
  - 依賴：T059, T060.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-orders-reference.spec.ts test/integration/host-integration/admin-inventory-reference.spec.ts`
- [ ] T062 Add Admin reference runtime audit/privacy assertions in `src/assistant/message/assistant-message.service.ts`, `src/assistant/runtime/assistant-readonly-runtime.service.ts`, and `src/host-integration/source-system-resolver.service.ts`
  - 說明：Admin static capability file declares policy only; Phase 6 runtime owners use currently available safe reason codes and minimized metadata to record capability decision, selected final tool/connector, `sourceSystem`, permission outcome, restricted field redaction, timeout/dependency reason, and no raw fixture payload。
  - 輸出：runtime metadata expectations and call-site assertions without depending on the Phase 7 shared metadata helper。
  - 完成條件：`admin-reference-capability.ts` has no dependency on `AuditWriterService`, `EvidenceRefService`, runtime execution result, permission decision, source mismatch result, or `host-integration-metadata.helper.ts`; restricted value and raw fixture payload are never audited。
  - 依賴：T060, T061.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/admin-restricted-cost.spec.ts`

**Checkpoint**: Admin reference works through existing connector/tool/permission/evidence runtime and does not overwrite Backend 001 fixtures.

## Phase 7: Safe Outcome, Audit and Observability Consolidation

**Purpose**: Consolidate coverage already added in Phases 1～6; do not add first-time audit here.

- [ ] T063 [P] Create decision point coverage matrix tests in `test/integration/host-integration/audit-observability-coverage.spec.ts`
  - 說明：Verify all Phase 1～6 decision points have deterministic outcome, minimized audit, observability metadata。
  - 輸出：coverage matrix integration spec。
  - 完成條件：registry, Stage A, Stage B, permission, selectedRows, source, Admin reference all covered。
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T064 [P] Create metadata redaction tests in `test/security/host-integration/metadata-redaction.spec.ts`
  - 說明：Reject raw PageContext, selectedRows, activeFilters, connector/evidence payload, restricted values, raw exception, secret/token/credential in metadata。
  - 輸出：security spec for metadata redaction。
  - 完成條件：only allowlisted identifiers/reason codes are emitted。
  - 驗證：`npm run test -- --runTestsByPath test/security/host-integration/metadata-redaction.spec.ts`
- [ ] T065 [P] Create no host integration audit writer guard in `test/unit/host-integration/no-host-integration-audit-writer.spec.ts`
  - 說明：Ensure no `HostIntegrationAuditService`, second audit writer, event store, or parallel observability framework。
  - 輸出：architecture guard spec。
  - 完成條件：audit persistence remains with `AuditWriterService`。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/no-host-integration-audit-writer.spec.ts`
- [ ] T066 Implement shared metadata helper in `src/host-integration/host-integration-metadata.helper.ts`
  - 說明：Centralize safe metadata shape, reason code normalization, redaction helpers for host integration decisions。
  - 輸出：metadata helper functions。
  - 完成條件：helper emits allowlisted metadata only; no audit persistence; no raw payload handling。
  - 依賴：T063, T064.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T067 Consolidate observability reason codes in `src/observability/observability-metadata.helper.ts`
  - 說明：Align host-specific reason codes with existing observability metadata helpers and `DependencyHealthService` semantics。
  - 輸出：reason-code integration with existing observability helper。
  - 完成條件：dependency, safe outcome, permission, source mismatch reasons are consistent and non-public。
  - 依賴：T066.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T068 Migrate Registry and Stage A audit call sites to shared metadata helper in `src/assistant/message/assistant-message.service.ts`, `src/host-integration/host-app-registry.service.ts`, and `src/host-integration/host-page-context-policy.service.ts`
  - 說明：Registry and Stage A decision metadata is generated by the decision owners/helpers and persisted by `AssistantMessageService` through `AuditWriterService.append()`。
  - 輸出：call-site migration for HostApp lookup, unregistered/no-fallback decision, routing-control rejection, PageContext minimization, selectedRows over-limit, and target conflict。
  - 完成條件：Phase 1～2 early returns are covered; no second writer; `AuditWriterService` remains generic and does not compute HostApp lookup or PageContext policy。
  - 依賴：T066.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T069 Migrate Stage B audit call sites to shared metadata helper in `src/assistant/message/assistant-message.service.ts` and `src/host-integration/host-interaction-eligibility.service.ts`
  - 說明：Stage B decision metadata is generated by `HostInteractionEligibilityService` and persisted by the existing message orchestration call site。
  - 輸出：call-site migration for unsupported interaction/operation, no provisional candidate, capability/tool-key intersection, and `ProvisionalEligibleTools` metadata。
  - 完成條件：Stage B does not persist audit itself; metadata contains safe tool keys/reason codes only and never full `ToolDefinition`, raw PageContext, or permission result fabrication。
  - 依賴：T066, T068.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T070 Migrate permission and selectedRows audit call sites to shared metadata helper in `src/assistant/runtime/assistant-readonly-runtime.service.ts`, `src/permissions/tool-permission-precheck.service.ts`, and `src/permissions/permission-policy.interface.ts`
  - 說明：Permission and selectedRows metadata is generated by runtime/precheck owners and persisted by the runtime call site through `AuditWriterService.append()`。
  - 輸出：call-site migration for tool/operation pre-check, organization boundary validation, row-level revalidation, selectedRows denial, and connector-before-permission ordering。
  - 完成條件：no failed row ID leak; no raw selectedRows; no unauthorized entity data; no `AdminRowPermissionEngine`, `HostPermissionService`, adapter-owned permission service, or second permission engine。
  - 依賴：T066, T068.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`
- [ ] T071 Migrate source and dependency audit call sites to shared metadata helper in `src/assistant/runtime/assistant-readonly-runtime.service.ts`, `src/assistant/message/assistant-message.service.ts`, `src/host-integration/source-system-resolver.service.ts`, and `src/observability/observability-metadata.helper.ts`
  - 說明：`SourceSystemResolver` produces source metadata and `AssistantMessageService` persists source derivation/mismatch metadata; `AssistantReadonlyRuntimeService` persists timeout/unavailable dependency metadata. Both call sites use the shared helper through existing `AuditWriterService.append()`.
  - 輸出：call-site migration for expected source derivation, source mismatch, connector timeout, connector unavailable, dependency health reason, and `tool_failure` safe outcome metadata。
  - 完成條件：no raw connector result, raw evidence, raw exception, credential, token, connection detail, or stack trace; `AuditWriterService` remains generic and does not compute source mismatch, dependency state, or feature policy. Only if the existing writer API cannot accept safe generic metadata may a minimal generic metadata contract extension be planned。
  - 依賴：T043, T052, T066, T067, T068.
  - 驗證：`npm run test:integration -- --runTestsByPath test/integration/host-integration/audit-observability-coverage.spec.ts`

**Checkpoint**: Phase 1～6 decision points all have deterministic outcome, minimized audit, observability metadata, and privacy coverage.

## Phase 8: Golden Questions, Privacy, Contract and Architecture Hardening

**Purpose**: Final proof that Backend 002 works and Backend 001 remains compatible.

- [ ] T072 [US8] Create golden question manifest in `test/fixtures/host-integration/golden-questions.ts`
  - 說明：Single deterministic source for eval cases: order status, order summary, selected orders comparison, inventory availability, inventory summary, ambiguity, unsupported capability, unregistered HostApp, unauthorized cost, timeout/unavailable, source mismatch。
  - 輸出：golden question fixture manifest。
  - 完成條件：all cases include public outcome, evidence source/scope, selected scope, audit/observability expectations, no raw payload leakage expectations。
  - 驗證：manual fixture review plus eval tests in T073.
- [ ] T073 [P] [US8] Create eval smoke tests in `test/eval/host-integration/admin-orders-inventory.eval.spec.ts`
  - 說明：Run golden Admin Orders / Inventory scenarios against deterministic fixtures。
  - 輸出：eval smoke spec。
  - 完成條件：all manifest cases assert outcome, evidence scope, selectedRows boundary, audit metadata, observability metadata。
  - 依賴：T072.
  - 驗證：`npm run test:eval -- --runTestsByPath test/eval/host-integration/admin-orders-inventory.eval.spec.ts`
- [ ] T074 [P] [US8] Create final contract regression in `test/contract/host-integration/final-contract-regression.spec.ts`
  - 說明：Cover public route unchanged, top-level `pageContext`, no nested `hostContext`, no backend `sessionScope`, SSE final unchanged, `AnswerDecision` unchanged, no public degraded, no diagnostic endpoint。
  - 輸出：final contract regression spec。
  - 完成條件：unregistered capability request cannot bypass registry; history / feedback / approval / action draft / escalation unaffected。
  - 驗證：`npm run test:contract -- --runTestsByPath test/contract/host-integration/final-contract-regression.spec.ts`
- [ ] T075 [P] [US8] Create privacy regression in `test/security/host-integration/privacy-regression.spec.ts`
  - 說明：Validate raw PageContext, raw selectedRows, restricted values, routing-control values, secret/token/credential never leak。
  - 輸出：privacy regression spec。
  - 完成條件：no raw payload leaks to LLM, EvidenceRef, response, log, audit, observability。
  - 驗證：`npm run test -- --runTestsByPath test/security/host-integration/privacy-regression.spec.ts`
- [ ] T076 [P] [US8] Create final architecture guard in `test/unit/host-integration/final-architecture-guard.spec.ts`
  - 說明：Final guard for no second controller/orchestrator/identity/planner/DataAdapterRegistry/permission engine/EvidenceRef mapper/audit writer, no connector before permission, no fixture collision, no MES/WMS/SCM/CRM scope creep。
  - 輸出：final architecture guard spec。
  - 完成條件：no legacy architecture reappears。
  - 驗證：`npm run test:unit -- --runTestsByPath test/unit/host-integration/final-architecture-guard.spec.ts`
- [ ] T077 [US8] Create host integration e2e regression in `test/e2e/host-integration.e2e-spec.ts`
  - 說明：Exercise high-level Admin capability path and Backend 001 unaffected flows through existing app harness。
  - 輸出：e2e spec for Type A unregistered HostApp rejection and Type B existing flow unchanged。
  - 完成條件：unregistered host cannot bypass registry; history/feedback/approval/action draft/escalation remain compatible。
  - 驗證：`npm run test:e2e -- --runTestsByPath test/e2e/host-integration.e2e-spec.ts`
- [ ] T078 [US8] Run final validation command set documented in `specs/002-host-integration-gateway-and-data-adapter-contract/tasks.md`
  - 說明：Execute all targeted and regression suites required for feature completion using existing repo scripts only。
  - 輸出：Codex completion report only; no production, test, Spec Kit, or package file is modified by validation。
  - 完成條件：先完成 `Validation Command Preflight`，再執行 targeted Backend 002 tests, affected Backend 001 regression, contract tests, integration tests, e2e tests, architecture tests, privacy tests, eval smoke, build, typecheck, and lint using existing scripts; DB-backed tests use `npm run test:db:init` only when required by existing convention; if a script is absent in a future branch, use the existing Jest runner and explicit path/pattern rather than adding package scripts, and report executed/skipped/fallback commands plus DB conditions。
  - 依賴：T001～T077.
  - 驗證：commands listed in `Validation Commands`.

**Checkpoint**: all targeted Backend 002 tests, affected Backend 001 regressions, eval smoke, privacy, architecture, contract, build, typecheck, and lint pass.

## Dependencies & Execution Order

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

- Phase 0 blocks Phase 1.
- Phase 1 provides capability source for Stage A and Stage B.
- Phase 2 Stage A blocks Query Understanding integration.
- Phase 3 depends on Query Understanding / `ExecutionPlan`.
- Phase 4 requires Stage B provisional candidates.
- Phase 4 timeout handling/audit is ordered T041 -> T042 -> T043 and must exist before Phase 7 consolidation.
- Phase 5 requires actual selected tool / connector; its provider wiring is ordered T047 -> T048 -> T049 -> T050 -> T051/T052, with `AssistantMessageService` as the single source/evidence orchestration owner.
- Phase 6 requires permission and source governance.
- Phase 7 requires Phase 1～6 decision points already connected to audit / observability / privacy.
- Phase 8 requires all feature phases complete.

Specific provider and consolidation dependencies:

- T021 depends on the Stage A implementation T019 and routing-control hook T020; it registers only Stage A.
- T029 depends on Stage B implementation T028; it registers only Stage B.
- T048 depends on resolver implementation T047; it registers only `SourceSystemResolver`.
- T071 may migrate timeout/source metadata only after Phase 4 timeout audit T043 and Phase 5 source mismatch audit T052 exist.
- T078 depends on every preceding task.

Within each phase:

1. failing tests.
2. minimal implementation.
3. audit / privacy.
4. architecture guards.
5. targeted tests.
6. Backend 001 regression.
7. checkpoint.

## Parallel Opportunities

- Phase 0 guard test tasks T001～T007 can run in parallel because they create separate test files.
- Phase 1 tests T008～T009 can run in parallel before implementation.
- Phase 2 tests T015～T018 can run in parallel before `HostPageContextPolicyService` implementation.
- Phase 3 tests T024～T027 can run in parallel before `HostInteractionEligibilityService` implementation.
- Phase 5 tests T044～T046 can run in parallel before `SourceSystemResolver` implementation.
- Phase 6 tests T053～T056 can run in parallel before fixture/runtime implementation.
- Phase 8 tests T073～T077 can run in parallel after T072 and feature behavior are complete.

Do not parallelize tasks that modify the same runtime owner, depend on newly defined types/contracts, or involve `AssistantMessageService`, `AssistantReadonlyRuntimeService`, permission ordering, or EvidenceRef/source consistency wiring.

## Requirement / Story Traceability

### User Story Traceability

| User Story | Acceptance / integration tasks | Final validation tasks |
| --- | --- | --- |
| US1 - Use Existing Identity and PageContext to Resolve HostApp Capability | T008～T014, T015, T021 | T074, T077, T078 |
| US2 - Restrict Eligible Connector / Tool by Host Capability | T024～T031, T035, T036 | T074, T076, T078 |
| US3 - Apply Host-specific PageContext Policy and selectedRows Safety | T015～T023, T032～T040 | T075, T077, T078 |
| US4 - Derive Backend-owned `sourceSystem` | T044～T052 | T046, T074, T078 |
| US5 - Complete Admin Orders Queries Through Existing Pipeline | T041～T043, T053, T054, T056, T057, T059～T062 | T072, T073, T077, T078 |
| US6 - Complete Admin Inventory Queries Through Existing Pipeline | T041～T043, T053, T055, T056, T058～T062 | T072, T073, T077, T078 |
| US7 - Safely Reject Unsupported Host / Screen / Entity / Interaction | unregistered host: T008, T011, T015, T021; unsupported screen/entity: T016, T019, T023; unsupported interaction/operation/no candidate: T024, T028, T031 | T072, T073, T074, T077, T078 |
| US8 - Golden Questions / Eval / Privacy / Regression | T063～T078 | T073～T078 |

### Functional Requirement Traceability

| Requirement | Primary tasks | Test / validation tasks |
| --- | --- | --- |
| FR-001 | T004, T013, T021 | T001, T004, T074, T076 |
| FR-002 | T001, T003, T015, T020 | T001, T003, T074, T078 |
| FR-003 | T003, T074 | T003, T074 |
| FR-004 | T001, T074, T077 | T001, T074, T077 |
| FR-005 | T008, T010～T014 | T008, T074 |
| FR-006 | T008～T012 | T008, T009 |
| FR-007 | T008, T011, T015, T016, T019, T024, T028, T031 | T015, T016, T024, T074, T077 |
| FR-008 | T024～T031, T035, T036 | T026, T032, T076 |
| FR-008a | T009, T024～T031, T038～T040 | T009, T025, T032, T076 |
| FR-009 | T015～T023 | T016, T017, T018, T074 |
| FR-010 | T016, T019, T022, T023, T024, T028～T031 | T016～T018, T024～T027, T075 |
| FR-011 | T016, T019, T022 | T016, T017 |
| FR-012 | T009, T016, T019, T038～T040 | T009, T016, T033, T075 |
| FR-013 | T016, T019, T021 | T016, T074 |
| FR-014 | T015～T019, T021 | T015, T016, T075 |
| FR-015 | T016, T019, T032～T040 | T016, T033, T034, T075 |
| FR-016 | T032～T040 | T033, T034, T075, T077 |
| FR-017 | T015, T020, T044～T052 | T015, T044, T046, T074 |
| FR-018 | T015, T020, T021, T023 | T015, T017, T063, T064 |
| FR-019 | T044～T052 | T044～T046, T074 |
| FR-020 | T049～T052, T063～T071 | T045, T063, T064, T071 |
| FR-021 | T005, T027, T061, T076 | T005, T027, T076 |
| FR-022 | T032～T042, T061 | T032～T034, T041, T076 |
| FR-023 | T041～T043, T071 | T041, T043, T073, T077 |
| FR-024 | T012, T060 | T008, T054, T055 |
| FR-025 | T054, T056, T057, T059～T062 | T054, T056, T073 |
| FR-026 | T055, T056, T058～T062 | T055, T056, T073 |
| FR-027 | T038～T040, T056, T062 | T056, T064, T075 |
| FR-028 | T038～T040, T056, T062 | T056, T073, T075 |
| FR-029 | T014, T023, T031, T040, T043, T051, T062～T071 | T063～T065, T068～T071 |
| FR-030 | T017, T023, T040, T043, T051, T062, T064～T071 | T017, T064, T075 |
| FR-031 | T001～T007, T053～T056, T072～T078 | T073～T078 |
| FR-032 | T005, T012, T061, T076 | T005, T061, T076 |

### Success Criteria Traceability

| Success Criterion | Measurement / assertion | Validation tasks |
| --- | --- | --- |
| SC-001 | Public API / SSE / `AnswerDecision` unchanged | T001, T002, T074, T078 |
| SC-002 | No second identity, PageContext, planner, permission, evidence, audit, observability, or connector runtime | T004, T005, T027, T065, T076 |
| SC-003 | `admin` capability resolves | T008, T011, T012 |
| SC-004 | Unregistered host never uses `admin` capability | T008, T011, T015, T074, T077 |
| SC-005 | Unsupported screen / entity / interaction never selects connector / tool | T016, T024, T031, T074 |
| SC-006 | Backend derives and audits sourceSystem consistent with selected connector / tool / adapter specialization | T044～T052, T063, T071 |
| SC-007 | Admin Orders / Inventory uses Backend 001 connector / tool / permission / evidence path | T054, T055, T061, T076 |
| SC-008 | selectedRows over 20 rejected as whole request | T015, T016, T075 |
| SC-009 | Mixed unauthorized rows return `permission_denied` | T033, T037, T038, T075 |
| SC-010 | Restricted values never enter LLM, EvidenceRef, response, log, or audit | T056, T062, T064, T075 |
| SC-011 | Client routing-control fields rejected and minimally audited | T015, T020, T023, T063 |
| SC-012 | Connector timeout / unavailable maps to Backend 001 `tool_failure` | T041, T042, T043, T071, T073, T077 |
| SC-013 | No public `answerDecision = "degraded"` or `final.data.answerDecision = "degraded"` | T002, T046, T074 |
| SC-014 | Backend 002 Admin capability path outside Backend 001 flows unchanged | T001, T074, T077, T078 |
| SC-015 | Fixtures synthetic / de-identified | T006, T053, T057, T058 |
| SC-016 | Capability / permission-scope mapping never elevates Backend 001 permission or scope | T009, T024～T031, T032～T040, T076 |

## Validation Command Preflight

Before executing validation, read the actual `package.json` and confirm each npm script, the Jest config, and the `test/` root. Confirm that the existing `npm run test` runner accepts `--runTestsByPath`; a command listed below is not proof that its script exists in a future branch. Do not add or modify npm scripts.

- Preferred command when the script exists: use the named `build`, `typecheck`, `lint`, `test`, `test:unit`, `test:integration`, `test:contract`, `test:e2e`, `test:eval`, or `test:db:init` script from `package.json`.
- Fallback: use the repository's existing Jest runner with explicit config and path, normally `npm run test -- --runTestsByPath <path>`, when a category script cannot target the requested file.
- DB-backed tests must use the repository's actual environment variables and existing initialization flow only; do not introduce a Backend 002 database.
- Final validation reporting must list executed commands, skipped commands and reasons, fallback commands, and DB-backed environment conditions.

## Validation Commands

### Targeted Phase Tests

```bash
npm run test -- --runTestsByPath test/unit/host-integration/host-app-registry.service.spec.ts
npm run test -- --runTestsByPath test/integration/host-integration/stage-a-request-boundary.spec.ts
npm run test -- --runTestsByPath test/integration/host-integration/stage-b-planning-eligibility.spec.ts
npm run test -- --runTestsByPath test/integration/host-integration/readonly-runtime-permission-order.spec.ts
npm run test -- --runTestsByPath test/integration/host-integration/connector-timeout-unavailable.spec.ts
npm run test -- --runTestsByPath test/integration/host-integration/source-consistency.spec.ts
```

### Contract Tests

```bash
npm run test:contract
```

### Integration Tests

```bash
npm run test:integration
```

### Architecture / Privacy Tests

```bash
npm run test -- --runTestsByPath test/unit/host-integration/final-architecture-guard.spec.ts
npm run test -- --runTestsByPath test/security/host-integration/privacy-regression.spec.ts
```

### Backend 001 Regression

```bash
npm run test:unit
npm run test:integration
npm run test:contract
npm run test:e2e
```

### Full Backend 002 Suite

```bash
npm run test
npm run test:eval
```

### Build

```bash
npm run build
npm run typecheck
npm run lint
```

### DB-backed Setup When Required

```bash
npm run test:db:init
```

Use DB-backed setup only when existing repo test convention requires it. Do not introduce a separate Backend 002 database.

## Forbidden Legacy Work

Do not create or plan these as implementation work:

- `HostIntegrationContextService`
- copied `HostIntegrationContext`
- `host-integration-context.types.ts`
- `normalized-page-context.types.ts`
- generic `PageContextNormalizer`
- `page-context-normalizer.service.ts`
- `DataAdapter`
- `DataAdapterEvidenceResult`
- `DataAdapterRegistryService`
- DataAdapter routing runtime / health model / timeout policy / permission service / degraded mapper
- second EvidenceRef converter
- `HostIntegrationAuditService`
- second audit writer
- second observability pipeline
- second identity extractor
- second permission header parser
- second `AssistantController`
- second message orchestrator
- Backend 001 / 002 request mode
- backend `sessionScope`
- nested `hostContext`
- approval navigation metadata
- public diagnostic endpoint
- public `degraded` AnswerDecision
- public `source_mismatch` AnswerDecision
- `AdminOrdersAdapter`
- `AdminInventoryAdapter`
- Admin-specific registry
- full Admin connector
- generic SQL connector

These names may appear only in architecture guards, explicit prohibition text, fixture collision tests, or old-architecture deletion notes.

## Notes

- This `tasks.md` is a new task list, not a reorder of old tasks.
- Each decision point owns its safe outcome, audit, observability, and privacy work in the same phase.
- Phase 7 consolidates and verifies coverage; it is not the first audit implementation phase.
- Generating this task list does not start implementation.
