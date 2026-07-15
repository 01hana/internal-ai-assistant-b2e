# Design: Host App Capability Governance and Reference Integration

**功能分支**: `002-host-integration-gateway-and-data-adapter-contract`

**建立日期**: 2026-07-13

**來源規格**: [`spec.md`](./spec.md)

**狀態**: Draft

## 1. 概觀

Backend 002 是建立在 Backend 001 `internal-assistant-core` 之上的增量設計。它不是 Host Integration foundation、不是新的 assistant runtime，也不是第二套 public API mode。

Backend 001 仍是 assistant session/message/history、SSE、identity extraction、PageContext DTO validation、query understanding、planning、tool/connector execution、permission pre-check、evidence persistence、answer decision、audit 與 observability 的唯一 public API 與核心 runtime owner。

Backend 002 只新增四個狹義能力：

- HostApp capability governance。
- host-specific PageContext policy 與 minimization。
- backend-owned `sourceSystem` derivation。
- `admin` Orders / Inventory reference integration。

Backend 002 不接收 backend `sessionScope`、不新增 nested `hostContext`、不接收 approval navigation metadata、不新增 public route，也不新增 public `answerDecision = "degraded"`。

## 2. 範圍與非目標

範圍內：

- 為 `admin` 建立 static HostApp capability registration。
- host/screen/entity/interaction eligibility checks。
- 在既有 Backend 001 PageContext contract 之上套用 host-specific PageContext policy。
- selectedRows policy 與 Admin reference selectedRows revalidation。
- backend-owned source metadata derivation。
- 使用既有 connector/tool/evidence runtime 完成 Admin Orders / Inventory reference acceptance。
- 防止產生 parallel runtime 的 architecture 與 regression guards。

非目標：

- 不新增第二套 assistant controller、request mode 或 SSE contract。
- 不新增第二套 identity extractor、PageContext DTO、query planner、tool registry、connector router、permission engine、EvidenceRef mapper、answer mapper、audit writer 或 observability pipeline。
- 不實作 frontend SDK/widget。
- 不實作完整 Admin、ERP、MES、WMS、SCM 或 CRM connector。
- v1 不新增 public diagnostic endpoint。

## 3. Backend 001 重用架構

Backend 002 必須直接重用下列 Backend 001 owner。

| 能力 | Backend 001 owner | Backend 002 處理方式 |
| --- | --- | --- |
| Public assistant request | `AssistantController`, `CreateAssistantSessionDto`, `SendAssistantMessageDto` | 重用既有 request path 與 DTO validation；controller 仍只負責 transport/delegation |
| Message orchestration | `AssistantMessageService` | 既有 message flow 的 application orchestration owner；Backend 002 hooks 必須整合在這裡，不能由 controller 協調 |
| Identity | `RequestIdentityContext`, `IdentityContextExtractor`, `IdentityGuard`, `validateRequestIdentityContext` | 直接重用；不得包裝或重新抽取 identity |
| PageContext public contract | `PageContextDto`, `page-context.mapper.ts` | 先由 Backend 001 完成 validation 與 mapping；Backend 002 只套用 host policy |
| Assistant context state | `AssistantContextStateService` | 直接重用；不得建立第二個 context store |
| Query Understanding | `QueryUnderstandingService`, `QueryUnderstandingPipeline` | 直接重用；只把 host policy constraints 當成 bounded context 輸入，而不是 raw PageContext |
| Planning | `AssistantPlanningService`, persisted `ExecutionPlan` | 直接重用；在 planning 後過濾 candidate tools |
| Tool registry | `ToolRegistryService`, `ToolDefinition` | 仍是唯一的 tool lookup 與 registration owner |
| Connector execution | `ConnectorAdapter`, `MockConnectorAdapter`, `AssistantReadonlyRuntimeService` | 重用既有 connector/tool execution path；readonly runtime 負責 read-only execution，不負責完整 message orchestration |
| Permission | `ToolPermissionPrecheckService`, `LlmInputSanitizerService`, masking utilities, row-level extension points | 只延伸 Admin selectedRows policy checks；不得建立新的 engine |
| Evidence | `EvidenceRefService` | 直接重用；host integration 不得直接持久化 EvidenceRef |
| Answer decision | `AnswerDecisionService`, `NoAnswerGateService`, SSE event builder | 直接重用；host integration 不得直接建立 public answer decisions |
| Audit | `AuditWriterService` | 直接重用；host integration 只能組裝 minimized metadata |
| Observability | `observability-metadata.helper.ts`, `DependencyHealthService` | 直接重用；只新增 host-specific metadata |

設計 guardrails：

- `src/host-integration` 不得實作 identity extraction。
- `AssistantController` 不得直接注入並協調完整的 HostApp capability、planning、tool、permission、evidence 與 answer service chain。
- Backend 002 不得再引入另一套作為 public contract 的 PageContext DTO / mapper。
- Backend 002 不得再引入另一套 planner、tool registry、connector router、permission engine、EvidenceRef mapper、public outcome mapper、audit writer 或 observability pipeline。

## 4. 目標模組架構

Backend 002 應只新增增量元件：

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

src/connectors/
└── connector-adapter.interface.ts        # existing
```

`admin-reference-capability.ts` 應屬於 HostApp capability governance，因為它宣告的是 host policy，而不是 connector behavior。只有在真正需要 Admin-specific `ConnectorAdapter` 時，`src/connectors/admin/` 才應存在。

Host integration module 只提供 registry、policy、eligibility filtering、source resolving 與 metadata helpers。它不是 message orchestrator；`AssistantMessageService` 仍是 application orchestration owner。`HostInteractionEligibilityService` 只能縮小 candidate set，不得授權 tool execution。

舊設計元件的處置：

| 舊元件 | 決策 |
| --- | --- |
| `HostIntegrationContextService` | 移除其作為 foundation service 的定位。若需要 composition，使用引用 `RequestIdentityContext` 與 `PageContextDto` 的 thin local object，避免複製 identity fields。 |
| `HostIntegrationContext` | 不保留成為 copied identity snapshot。改用 `HostCapabilityEvaluationContext` 風格的 composition。 |
| `PageContextNormalizer` | 以 `HostPageContextPolicyService` 取代；DTO validation 與 generic mapping 由 Backend 001 擁有。 |
| `HostAppRegistryService` | 保留，作為 static capability registry。 |
| `DataAdapter` | v1 不引入。既有 `ConnectorAdapter` + `ToolRegistryService` + runtime 足以支撐，直到有明確 gap 被證明。 |
| `DataAdapterRegistryService` | 從 v1 design 移除。它會形成第二個 registry/routing surface。 |
| `DataAdapterEvidenceResult` | 不引入為 required type。優先沿用既有 connector result、sanitizer 與 `EvidenceRefService` inputs。 |
| `HostIntegrationAuditService` | 改成 metadata helper/factory；persistence 仍走 `AuditWriterService`。 |
| `AdminOrdersAdapter` / `AdminInventoryAdapter` | 不預設一定需要。優先沿用既有 mock connector/tool runtime 搭配 Admin capability mapping。 |
| `SourceSystemResolver` | 保留，作為狹義的 Backend 002 職責。 |

## 5. 內部 context 形狀

Backend 002 不得複製 identity authority。若需要 internal context，應組合既有物件：

```ts
interface HostCapabilityEvaluationContext {
  identity: RequestIdentityContext;
  pageContext?: PageContextDto;
  capability: HostAppCapability;
  policyResult: HostPageContextPolicyResult;
}
```

規則：

- 不得把 `actorId`、`organizationId`、`role` 或 `permissionScopes` 複製成第二個 authority。
- 不得重新解析 identity headers。
- 不納入 backend `sessionScope`。
- 在 final connector/tool selection 之前，不得包含 final `sourceSystem`。
- 不得把 frontend input 轉成 permission result。
- 不得建立會與 `RequestIdentityContext` 漂移的 identity snapshots。

## 6. HostApp Capability 註冊表

`HostAppRegistryService` v1 為 static、code-based。正式註冊只有 `admin`；`mes`、`wms`、`scm`、`crm` 與 `custom` 只保留為 reserved identifiers。

`HostAppCapability` 必須包含：

- host app id 與 display name。
- supported screens、entity types 與 interactions。
- eligible tool/connector keys。
- PageContext allowlist。
- selectedRows policy。
- active filter allowlist。
- field visibility/exposure policy。
- default permission-scope interpretation。
- unsupported/dependency behavior。

Capability 只是一層 restriction：

```text
EffectivePermissions
=
Backend 001 verified permissions
∩ HostApp capability restrictions
```

它絕對不是：

```text
Backend permissions
+
HostApp role mapping
```

`defaultPermissionScopeMapping` 可以解讀或收斂既有 scopes，但不能生成新的 scopes。`role`、persona name、screen、PageContext 與 `visibleColumns` 都不能授權欄位或操作。若 capability 與 Backend 001 permission 結果衝突，以更嚴格者為準。

## 7. Host-specific PageContext Policy

`HostPageContextPolicyService` 在 Backend 001 已完成 `PageContextDto` validation 與 generic context mapping 後執行。它不解析 public request body，也不持久化 `AssistantContextState`。

輸入：

- 已完成 validation/mapping 的 `PageContextDto`。
- `RequestIdentityContext`。
- 已解析的 `HostAppCapability`。
- 能保留原始數量的 raw selectedRows count 或 validation metadata。

輸出：

- policy decision。
- canonical screen/entity reference。
- allowlisted filters。
- minimized selected row references。
- visible field hints。
- pre-planning capability constraints。
- selectedRows policy result。
- audit-safe metadata。
- clarification condition 或 unsupported reason。

職責：

- 依 capability 驗證 screen/entity declarations。
- 在 dedupe 前保留 raw selectedRows count，並拒絕超過 20 筆的輸入。
- 移除未 allowlist 的 filters 與敏感 PageContext fields。
- 將 `visibleColumns` 僅視為 hint。
- 將 `entityId` / selectedRows target conflict 標記為 `clarification_required`。
- 將 unsupported screen/entity declaration 標記為 unsupported capability。

非職責：

- Public DTO parsing。
- Identity validation。
- Generic PageContext mapping。
- `AssistantContextState` persistence。
- Deixis resolution ownership。
- Permission authority。
- Query Understanding。
- Query intent。
- Interaction eligibility。
- Operation eligibility。
- Candidate tools。
- Connector eligibility。
- selectedRows comparison intent。
- Permission-compatible tools。
- AnswerDecision creation。
- Audit persistence。

## 8. 兩階段 capability 評估

### Stage A - Pre-planning Context Policy

在既有 identity extraction 與 PageContext validation 之後、`QueryUnderstandingService` 之前執行。

職責：

- 在既有 validation/request boundary 拒絕已知的 client routing-control injection。
- 查詢 static HostApp capability。
- 透過既有 request/integration error envelope 拒絕 unregistered host。
- 驗證 screen/entity declarations。
- 套用 PageContext allowlist/minimization。
- 套用 selectedRows raw count limit；超過 20 筆時，必須在 retrieval/tool/connector/LLM 之前走既有 request/integration error envelope，且不得以 `AnswerDecision` 作為主要拒絕路徑。
- 驗證 selectedRows shape。
- 產生 audit-safe metadata。
- 將 context conflicts 標記為 clarification conditions。
- 不處理 query intent、interaction eligibility、operation eligibility、candidate tools、connector eligibility、selectedRows comparison intent 或 permission-compatible tools。

### Stage B - Post-planning Interaction Eligibility

`HostInteractionEligibilityService` 是 Stage B 的唯一 owner。在 `QueryUnderstandingService` 與 `AssistantPlanningService` 已產出既有 Query Understanding result、`ExecutionPlan` 與 candidate tool keys 之後、connector/tool execution 之前執行。

輸入：

- resolved `HostAppCapability`。
- existing Query Understanding result。
- existing `ExecutionPlan`。
- candidate tool keys。
- registered `ToolDefinition` metadata。
- verified `RequestIdentityContext.permissionScopes`。
- Stage A canonical context / capability constraints。

輸出：

- interaction eligibility decision。
- operation eligibility decision。
- `ProvisionalEligibleTools`。
- unsupported reason。
- audit-safe eligibility metadata。

職責：

- 驗證 interaction eligibility。
- 驗證 operation 與 selectedRows comparison eligibility。
- 將 candidate tools 與 HostApp capability eligible tool keys 做 intersection。
- 執行 static scope-compatible candidate filtering。
- 產生 provisional candidate set。

非職責：

- Query Understanding。
- 建立或修改 `ExecutionPlan` authority。
- 最終 permission authorization。
- row-level permission。
- connector execution。
- EvidenceRef。
- AnswerDecision。
- audit persistence。

Tool 與 field 模型：

```text
ProvisionalEligibleTools
=
ExecutionPlan candidate tools
∩ HostApp capability eligible tools
∩ statically scope-compatible ToolDefinitions
```

`statically scope-compatible ToolDefinitions` 只代表 `ToolDefinition.requiredPermissionScopes`、已驗證的 `RequestIdentityContext.permissionScopes`、operation/risk/read-only metadata，以及 planning 階段可安全判斷的靜態條件。

`ProvisionalEligibleTools` 只是候選縮小，不是 authorization proof。它不能直接授權 connector execution、不能取代 `ToolPermissionPrecheckService`、不能執行 row-level permission，也不能推導 final field exposure。正式執行權限仍由 `ToolPermissionPrecheckService` 作為 authoritative execution permission；selectedRows 則由 Backend 001 row-level permission extension point 進行 authoritative per-row validation。

```text
EffectiveVisibleFields
=
Host capability allowed fields
∩ Backend 001 permission-allowed fields
∩ evidence-safe fields
```

## 9. 請求生命週期與資料流

Backend 002 是對既有 request lifecycle 的增量補強：

```text
AssistantController
  -> AssistantMessageService
      -> existing DTO / identity validation
      -> routing-control injection rejection
      -> HostAppRegistryService capability lookup
      -> HostPageContextPolicyService pre-planning evaluation    # Stage A
      -> QueryUnderstandingService
      -> AssistantPlanningService / ExecutionPlan
      -> HostInteractionEligibilityService                     # Stage B
          -> ProvisionalEligibleTools
      -> AssistantReadonlyRuntimeService
          -> ToolRegistryService resolution
          -> ToolPermissionPrecheckService                    # authoritative
          -> selectedRows organization / row-level revalidation
          -> ConnectorAdapter / connector/tool execution
          -> masking / LlmInputSanitizerService
          -> SourceSystemResolver expected source derivation
          -> EvidenceRefService normalization / persistence
          -> SourceSystemResolver evidence source consistency verification
      -> AnswerDecisionService / NoAnswerGateService
      -> SSE final event builder
      -> AuditWriterService / observability helpers
```

`AssistantController` 只擁有 route/transport handling、DTO entry、identity guard entry、SSE response wiring，以及委派給 `AssistantMessageService`。它不得直接協調 HostApp capability、planning、tool、permission、evidence 與 answer services。

`AssistantMessageService` 是既有 message flow 的 application orchestration owner。Backend 002 capability hooks 應整合進這個既有 orchestration；read-only connector execution 的細節則整合到 `AssistantReadonlyRuntimeService`。

Stage A policy 只處理 pre-planning context policy。Stage B 的 `HostInteractionEligibilityService` 只產生 `ProvisionalEligibleTools`，不授權執行。`AssistantReadonlyRuntimeService` 是 read-only execution subflow owner，且 `ToolPermissionPrecheckService` 與 selectedRows organization / row-level revalidation 必須在 `ConnectorAdapter` execution 之前完成。

`sourceSystem` 可以在 routing 收斂後被視為 candidate metadata，但 expected source 必須在 final connector/tool selection 之後、EvidenceRef persistence 之前推導；consistency 則在 EvidenceRef normalization 之後、answer generation 之前驗證，因此 source resolution 不會回圈依賴 EvidenceRef persistence。

## 10. Client Routing-control Injection

下列 client-controlled fields 禁止作為 routing authority：

- connector
- connectorId
- adapter
- adapterId
- sourceSystem
- dataSource
- candidateTool
- candidateTools
- permission result
- final evidence source

設計規則：

- 必須在既有 validation/request boundary 就拒絕，不得等到 planning 後才處理。
- 必須沿用 Backend 001 既有 request/integration error envelope。
- 不得以 `AssistantMessage` / `AnswerDecision` 作為主要拒絕路徑。
- 不得進入 retrieval、tool、connector、adapter 或 LLM flow。
- 透過 `AuditWriterService` 寫入 minimized metadata。
- 只記錄 field names、requestId、hostApp、organization 與 reason。
- 不記錄 client-supplied values 或 raw request body。

如果 global whitelist validation 在欄位名稱尚不可用前就拒絕 unknown fields，實作可以對既有 request validation boundary 或 exception metadata path 做最小延伸，以捕捉安全的 field names，但不得建立第二個 parser。

## 11. DataAdapter 決策

V1 不引入新的 `DataAdapter` runtime 或 `DataAdapterRegistryService`。

原因：

- `ConnectorAdapter` 已提供 `listTools()`, `execute(input)`, `healthCheck()`。
- `ToolRegistryService` 已擁有 tool lookup、active checks、operation checks、schema validation、connector keys、permission scopes、risk、timeout metadata 與 output schema。
- `AssistantReadonlyRuntimeService` 已覆蓋 read-only connector/tool flow，包括 registry、permission pre-check、connector execution、sanitizer、tool-call lifecycle 與 evidence path。
- `EvidenceRefService` 已能接收 sanitization 後的 structured evidence。

因此 Admin reference integration 應該把 HostApp capability 對應到既有或最小擴充的 `ToolDefinition` / connector keys。若未來出現明確 gap 必須引入 `DataAdapter`，它必須：

- 位於 `src/connectors`。
- extend 或 specialize `ConnectorAdapter`。
- 透過既有 tool/connector runtime 註冊與執行。
- 不擁有 registry、routing、health、timeout、permission、EvidenceRef conversion、public outcome mapping、audit 或 observability。

## 12. Admin Orders / Inventory 參考整合

V1 reference scope：

- order status。
- order summary。
- selected orders comparison。
- inventory availability。
- inventory summary。
- restricted `cost` acceptance。
- unsupported capability handling。
- timeout/unavailable safe mapping。

Fixture namespace：

- `ADMIN-SO-10001`
- `ADMIN-SKU-001`

Backend 002 fixtures 不得覆寫 Backend 001 fixtures，例如 `SO-10001`，也不得改變 fixture load order 對既有 IDs 的影響。

優先實作形態：

- 將 Admin capability mapping 加到既有 tool/connector keys。
- 僅在必要時新增 namespaced synthetic fixtures。
- 在足夠的情況下沿用 `MockConnectorAdapter` / 既有 connector execution。
- 只有在既有 mock connector 無法承載 reference behavior 時，才新增 Admin-specific connector；若新增，必須實作 `ConnectorAdapter`、透過既有 tool/connector ownership 註冊，並重用既有 permission、evidence、answer、audit 與 observability paths。

此 reference integration 不得演變成 full ERP connector、full Admin backend domain、generic SQL connector、dynamic adapter onboarding system，或 MES/WMS/SCM/CRM connector。

## 13. selectedRows 與 Row-level Permission 設計

Backend 001 已具備 organization boundary、permission pre-check、field masking 與 row-level permission extension points。Backend 002 只新增 Admin reference integration 所需的 selectedRows revalidation。

流程：

1. 在 dedupe 前檢查 raw selectedRows count；若超過 20，必須在 retrieval/tool/connector/LLM 之前透過既有 request/integration error envelope 拒絕，且不得以 `AnswerDecision` 作為主要拒絕路徑。
2. 將每一列最小化為 canonical ID / safe summary。
3. 對每一列 selected row 驗證 organization boundary。
4. 透過 Backend 001 policy/extension point 驗證每一列的 row-level permission。
5. 只有在所有 rows 都通過後，才可擷取或暴露完整資料。
6. 只要任一 row 失敗，整個 comparison 必須回 `permission_denied`。
7. 不得只處理合法 subset。
8. 不得揭露是哪一個 ID 失敗。
9. 不得把未授權 row data 放入 LLM 或 EvidenceRef input collections。
10. 不得把 frontend ID 或 safe summary 視為 authorization proof。

不得引入：

- `AdminRowPermissionEngine`。
- adapter-owned permission service。
- second permission mapping。
- capability-generated permission。

## 14. SourceSystemResolver 設計

`SourceSystemResolver` 是一個狹義的 Backend 002 職責。

### Phase 1 - Expected Source Derivation

在 final `ToolDefinition` 與 `ConnectorAdapter` 已選定，且 connector/tool output 已可用或即將進入 evidence normalization 時執行；時間點在 EvidenceRef persistence 之前。

輸入：

- `RequestIdentityContext.hostApp`。
- 已解析的 HostApp capability。
- canonical screen/entity。
- final selected `ToolDefinition`。
- final selected `ConnectorAdapter`。
- connector key。
- tool key。
- 若存在則為 adapter specialization。
- 若既有 connector contract 有提供，則使用來自 sanitized connector result 的 backend-owned source hint。

輸出：

- `expectedSourceSystem`。
- audit-safe derivation reason/code。
- expected connector/tool association。

### Phase 2 - Evidence Source Consistency Verification

在 `EvidenceRefService` 已完成 evidence source metadata normalization 之後、`AnswerDecisionService` 或 SSE final output 之前執行。

輸入：

- `expectedSourceSystem`。
- normalized EvidenceRef source metadata。
- 實際執行的 connector/tool identity。

輸出：

- consistency pass/fail。
- audit-safe mismatch reason。

時序規則：

- 不從 frontend input 推導。
- 不在 identity extraction 階段定稿。
- expected source 必須在 EvidenceRef persistence 前推導。
- consistency 必須在 EvidenceRef normalization 後、answer generation 前驗證。
- 若 final selected `ToolDefinition`、final selected `ConnectorAdapter`、`expectedSourceSystem` 與 normalized EvidenceRef actual source metadata 任一不一致，必須沿用 Backend 001 既有 `tool_failure` safe mapping，回 `answerDecision = no_answer` 與既有 `noAnswerReason = tool_failure` 語意。
- 不得產生 source attribution 錯誤的 grounded answer。
- 不得假造 source attribution。
- 不得自動接受 EvidenceRef 宣稱的來源。
- 不得將 expected source 覆蓋成 actual source 來掩蓋錯誤。
- mismatch reason 只能寫入 minimized audit metadata；audit 只包含 tool key、connector key、expected source、actual source 的安全 identifier 或 reason code，不得記錄 raw connector payload 或完整 evidence 內容。

它不得建立 public source routing API、frontend-selectable source、second evidence source store、`source_mismatch` public AnswerDecision，或一套脫離 EvidenceRef 的 parallel source truth。

## 15. Safe Outcome Mapping 設計

Backend 002 只使用 Backend 001 既有 public enums 與 safe mapping。

| 情境 | 固定處理方式 |
| --- | --- |
| selectedRows raw input count 超過 20 | 在 `AssistantMessage` / `AnswerDecision` / retrieval / tool / connector / LLM 之前走既有 request/integration error envelope |
| 缺少或模糊 context、缺少 entity target、或 target conflict | 透過既有 clarification path 回 `clarification_required` |
| client routing-control injection | 在 `AssistantMessage` / `AnswerDecision` / retrieval / tool / LLM 之前走既有 request/integration error envelope |
| Unregistered Host App | 走既有 request/integration error envelope；不進行 connector/tool routing |
| Registered Host App 但 screen/entity/interaction 不支援 | 以既有 internal reason 回 `no_answer` |
| Permission failure | `permission_denied` |
| Tool/connector timeout 或 unavailable | 沿用既有 `tool_failure` mapping，例如 `no_answer` + `noAnswerReason=tool_failure` |
| Expected source 與 normalized EvidenceRef source 不一致 | 沿用 Backend 001 `tool_failure` safe mapping，回 `no_answer` 並使用既有 `noAnswerReason=tool_failure`，不得產生 grounded answer |
| 不具誤導性的 partial answer | 只回答 authorized fields |
| 具誤導性的 partial answer | `permission_denied` |

Owner：

- `AnswerDecisionService` 在 request 進入 answer flow 後記錄 public answer decisions。
- `NoAnswerGateService` 負責既有 no-answer / clarification / permission / tool failure gates。
- Request/integration validation failures 可以在 `AssistantMessage` / `AnswerDecision` 之前終止。
- SSE final 仍由既有 final event semantics 驅動。

`degraded` 只可作為 dependency metadata，不能成為 public `AnswerDecision`。

## 16. Audit 與 Observability 設計

不得建立作為 writer 的 `HostIntegrationAuditService`。應使用 metadata helper/factory，並透過 `AuditWriterService` 持久化。

允許的 host-specific metadata：

- HostApp capability lookup result。
- unsupported reason code。
- PageContext policy decision。
- selectedRows count 與 policy result。
- eligible tool keys。
- final selected tool/connector key。
- backend-derived `sourceSystem`。
- source consistency mismatch reason code。
- dependency status。
- minimization summary。

禁止的 metadata：

- raw PageContext。
- raw selectedRows。
- unauthorized ID。
- complete entity。
- restricted value。
- raw connector payload。
- 完整 evidence 內容。
- raw exception。
- secret、token 或 credential。
- 完整 routing-control injection value。

Observability 應沿用既有 helpers，例如 `createRuntimeDecisionMetadata`、`createDependencyStatusMetadata`、`withNoAnswerReason`、`withPermissionDeniedReason`、`withToolFailureReason`。

## 17. API / Frontend 邊界

Backend 002 不硬編碼 public routes。確切 path、global prefix 與 route parameter names 來自 Backend 001 controller/bootstrap/contract tests。

規則：

- 不新增第二套 public chat API。
- 不新增 nested `hostContext`。
- 不新增 backend `sessionScope`。
- 不區分 Backend 001 compatibility mode 與 Backend 002 mode。
- 不接收 approval navigation metadata。
- v1 不新增 public diagnostic endpoint。
- Frontend 只送既有 identity headers 與 top-level sanitized `pageContext`。
- Frontend 不送 routing authority。
- Host navigation 屬於 Frontend callback responsibility。

## 18. 測試策略

### Unit Tests

- `HostAppRegistryService`。
- `HostPageContextPolicyService` pre-planning policy。
- `HostPageContextPolicyService` 沒有 interaction input。
- `HostPageContextPolicyService` 不處理 tool eligibility。
- `HostInteractionEligibilityService` 處理 Stage B。
- `HostInteractionEligibilityService` 只產生 provisional candidates。
- static scope filtering 不等於 authorization。
- dedupe 前的 selectedRows raw-count limit。
- capability restriction-only permission model。
- `SourceSystemResolver` expected source derivation。
- `SourceSystemResolver` 的 EvidenceRef source consistency verification。
- source mismatch 固定映射到 `tool_failure`。
- routing-control rejection hook。
- audit metadata minimization helper。

### Integration Tests

- `admin` capability lookup。
- Stage A 完成後才執行 Query Understanding。
- Stage B 只能在 `ExecutionPlan` 後執行。
- Stage B 輸出 `ProvisionalEligibleTools`。
- unregistered host 使用既有 request/integration error envelope。
- unsupported screen/entity/interaction 回 `no_answer`。
- target conflict 回 `clarification_required`。
- selectedRows per-row revalidation。
- `ToolPermissionPrecheckService` 一定在 connector execution 前執行。
- selectedRows revalidation 一定在完整資料取得前執行。
- selectedRows over-limit 在 `AssistantMessage` / `AnswerDecision` 前走既有 request/integration error envelope。
- mixed unauthorized rows 回 whole-request `permission_denied`。
- 使用既有 connector/tool runtime。
- 使用既有 `EvidenceRefService` 與 `AnswerDecisionService`。
- source consistency mismatch 不產生 grounded answer。
- source consistency mismatch 回既有 `no_answer + noAnswerReason=tool_failure` mapping。
- timeout/unavailable 映射到既有 `tool_failure`。
- provisional candidate filtering 不得繞過 authoritative `ToolPermissionPrecheckService`。

### Contract / Regression Tests

- public routes 不變。
- top-level `pageContext` 不變。
- SSE final 不變。
- 不新增 nested `hostContext`。
- 不新增 backend `sessionScope`。
- 不新增 public degraded answer decision。
- 不新增 public diagnostic endpoint。
- Backend 002 Admin capability path 以外的既有 Backend 001 flows 維持不變。

### Architecture Guards

- 不新增第二套 identity extractor。
- 不新增第二套 assistant controller/message endpoint。
- `AssistantController` 不得直接協調 HostApp capability、planning、tool、permission、evidence 與 answer service chain。
- 不新增 public PageContext DTO duplicate。
- 不新增平行 registry 的 `DataAdapterRegistryService`。
- tool/connector registration 仍由 `ToolRegistryService` / connector domain 擁有。
- host integration 不得直接持久化 EvidenceRef。
- host integration 不得直接建立 public AnswerDecision。
- host integration 只能透過 `AuditWriterService` 寫入 audit。
- capability mapping 不得生成 permission。
- `HostPageContextPolicyService` 不得接收或判斷 query interaction。
- `HostPageContextPolicyService` 不得產生 tool candidate。
- `HostInteractionEligibilityService` 是 Stage B 唯一 owner。
- `HostInteractionEligibilityService` 只能產生 `ProvisionalEligibleTools`。
- `ProvisionalEligibleTools` 不得作為 authorization proof。
- `ToolPermissionPrecheckService` 仍是 authoritative execution gate。
- selectedRows row-level revalidation 不得被 Stage B 取代。
- `ConnectorAdapter` 不得在 authoritative permission pre-check 與 selectedRows revalidation 前執行。
- source consistency mismatch 不得繼續 answer flow。
- 不得新增 source mismatch public enum。
- `AssistantReadonlyRuntimeService` 是 execution subflow，不是第二個 message orchestrator。
- Host integration module 不得接管完整 message lifecycle。
- provisional candidate filtering 不得取代 `ToolPermissionPrecheckService`。
- Admin fixtures 不得與 Backend 001 fixture IDs 衝突。

### Privacy Tests

- raw PageContext 不得進入 LLM。
- raw selectedRows 不得進入 LLM、response、log、audit 或 observability。
- restricted values 不得進入 LLM、EvidenceRef、response、log、audit 或 observability。
- routing-control values 不得寫入 audit。
- 不得洩漏 raw connector payload、raw exception、secret、token 或 credential。

## 19. 安全與隱私設計

Security model：

- Backend 001 identity 與 permission services 是唯一 authority。
- HostApp capability 是 eligibility constraint，不是 permission source。
- Admin fixture personas 只是 test data，不是 production permission authority。
- restricted values 必須在進入 LLM/EvidenceRef/response/log/audit 前被排除。
- PageContext、selectedRows、`visibleColumns`、role name、persona name 與 screen capability 都不能授權 permission。
- capability 與 permission 衝突時，以更嚴格者為準。

Failure model：

- 缺少 Backend 001 required identity 時 fail closed。
- 在 request boundary 拒絕 routing-control injection。
- 缺少/模糊 context 時使用 `clarification_required`。
- permission failure 時使用 `permission_denied`。
- unavailable/timeout 時沿用既有 `tool_failure` mapping。

## 20. 風險與緩解措施

1. **Parallel runtime 再度出現**
   以 architecture guards 防止 controller-level orchestration，以及第二套 identity、PageContext、planner、registry、permission、evidence、answer、audit 與 observability systems。

2. **DataAdapter 演變成第二個 connector platform**
   V1 不引入 DataAdapter runtime 或 registry。未來若有 adapter，也必須 specialize `ConnectorAdapter` 並走既有 runtime。

3. **Capability 提升了 permission**
   強制使用 intersection model，並測試 role/persona/visibleColumns 不能授予 restricted fields。

4. **selectedRows 洩漏未授權資料**
   在 retrieval/exposure 前重新驗證每一個 selected row；任一失敗即拒絕整個 comparison。

5. **sourceSystem 變成 frontend-controlled**
   拒絕 client source-selection fields，且 final source 只能從 backend-selected tool/connector/evidence metadata 推導。

6. **sourceSystem attribution 不一致**
   使用兩階段的 expected source derivation 與 EvidenceRef source consistency verification；一旦 mismatch，必須在 answer generation 前停止，沿用 `no_answer + noAnswerReason=tool_failure` mapping，且不得新增 public enum 或繼續 grounded answer flow。

7. **過期 fixture IDs 衝突**
   使用 `ADMIN-SO-10001` 與 `ADMIN-SKU-001`；並加上不可覆寫 Backend 001 fixtures 的 guard。

8. **模糊的 safe outcomes 削弱測試**
   使用固定 safe outcome mapping，且只沿用 Backend 001 既有 enum/error envelope。

9. **Audit metadata 洩漏 raw payload**
   使用 metadata helper + `AuditWriterService` redaction；禁止 raw context、selectedRows、connector payload、exceptions 與 restricted values。

## 21. 對下游 Spec Kit 的影響

這次 cleanup 不直接修改 `plan.md` 或 `tasks.md`，但後續 planning artifacts 必須對齊本 design：

- `plan.md` 不得再把 HostIntegrationContext foundation 當作 phase。
- `plan.md` 不得建立 DataAdapterRegistry phase。
- `tasks.md` 不得要求新的 identity extractor。
- `tasks.md` 不得要求 generic PageContextNormalizer。
- `tasks.md` 不得要求第二套 EvidenceRef conversion。
- `tasks.md` 不得要求 degraded mapper。
- `tasks.md` 不得要求 HostIntegrationAudit writer。
- Admin reference tasks 必須使用 namespaced fixtures。
- Runtime integration tasks 必須擴充既有 Backend 001 services，而不是建立 parallel runtime。

## 22. 開放問題

V1 design 沒有 blocking open questions。未來的 diagnostic endpoints、dynamic HostApp registration、full connector rollout 與 DataAdapter specialization 都延後處理，除非後續 feature spec 重新打開這些議題。
