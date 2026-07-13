# Feature Specification: Host Integration Gateway and Data Adapter Contract

**Feature Branch**: `002-host-integration-gateway-and-data-adapter-contract`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "建立 backend host integration gateway 與 data adapter contract，讓既有 internal assistant core 能安全接收不同 host app 的 identity、permission scopes、PageContext、session scope 與 connector routing hints，並以 Admin / Orders / Inventory 作為第一個 reference host integration。"

## Feature Summary

本 feature 建立 backend host integration gateway 與 data adapter contract，讓既有 internal assistant core 能安全接收來自不同 host app 的 identity、permission scopes、PageContext、session scope 與 connector routing hints，並以 Admin / Orders / Inventory 作為第一個 reference host integration。

本 feature 的目標不是重做 assistant core，而是在 `001-internal-assistant-core` 之上建立可產品化的 host integration backend layer，讓既有 assistant core 可以被 Admin / ERP / MES / WMS / SCM / CRM 等 host system 以一致且安全的方式接入，同時不破壞既有 chat API、session API、SSE contract、feedback/approval 行為與 evidence pipeline。

## Product Context

本產品的產品化方向是一份 assistant backend core 支援多個 host app。不同 host app 透過統一的 Host Integration Context 與 Data Adapter Contract 接入，將宿主系統自己的身份、權限、頁面脈絡與資料來源差異，限制在 host integration layer 與 adapter layer。

`admin` 是第一個 reference host app，用來驗證 Orders 與 Inventory 的最小可行整合路徑，但不代表產品只支援 Admin。未來 MES / WMS / SCM / CRM 都應該有自己的 host app registration、capability declaration 與 data adapter，並沿用本 feature 定義的安全邊界、evidence contract 與 audit expectations。

本 feature 也承接 frontend 002 的整合方向：Frontend 第一版採 npm package / SDK mode，由 host app 掛載 ChatWidget 並實作 `AssistantHostContextProvider`。因此 backend 必須能接收並驗證 provider 所傳入的 identity headers、PageContext、session scope 與 connector routing hints，但不實作 frontend package 本身。

## Scope / Non-goals

### In Scope

- 建立 Host Integration Context 的標準化定義與驗證需求。
- 建立 PageContext normalization 與 minimization 規則。
- 建立 HostApp Registry 的 capability declaration 規格。
- 建立 Data Adapter Contract v1 與 evidence-safe result 規格。
- 定義 connector routing hints 如何影響 candidate tools、required evidence、context resolution、risk assessment、clarification needs 與 expected answer shape。
- 以 `admin` 作為第一個 reference host app，並以 Orders / Inventory 作為第一個 reference adapter scope。
- 定義 integration smoke / golden questions，驗證 host context aware retrieval 與 grounded answer flow。
- 定義 audit、observability 與 degraded behavior 的最小規格要求。

### Out of Scope

- 不實作 frontend widget / frontend SDK / npm package。
- 不重做 001 assistant session / message / SSE / feedback / approval API。
- 不一次實作完整 MES / WMS / SCM / CRM connector。
- 不做完整 admin UI / CRUD。
- 不做 approval management UI。
- 不做 production deployment / Kubernetes / Helm。
- 不繞過既有 identity / permission / audit / evidence pipeline。
- 不允許 host app 直接傳 raw full data 給 LLM 作回答依據。
- 不允許 PageContext 取代 permission check。
- 不允許 connector 回傳 raw secret / credential / full sensitive payload。

## Frontend Integration Dependency

Frontend 002 第一版採 npm package / SDK mode。Host app 會透過 ChatWidget package 掛載 widget，並實作 `AssistantHostContextProvider`。Backend 002 不實作 frontend SDK，但必須能接收該 provider 送出的 identity headers、PageContext、session scope 與 approval detail related metadata。

Frontend 不應傳 raw entity data。Frontend 只傳 sanitized PageContext 與必要 request metadata；完整資料查詢仍由 backend 依據 Host Integration Context、permission scopes、Data Adapter / Connector 與 evidence pipeline 完成。Frontend 送來的畫面狀態可以作為 context hint，但不得被視為資料真值來源或權限依據。

## Core Concepts

### Host Integration Context

`Host Integration Context` 是 backend 用來判定 request 來源、資料邊界、權限邊界與 context resolution 的標準化上下文。它至少包含以下欄位：

- `hostApp`
- `actorId`
- `organizationId`
- `role`
- `permissionScopes`
- `requestId`
- `pageContext`
- `sessionScope`
- `sourceSystem`

此上下文必須在 assistant request 進入 retrieval、tool execution、adapter routing 或 LLM answer generation 前完成驗證與標準化。若缺少 `hostApp`、`actorId`、`organizationId`、`permissionScopes` 或 `requestId`，系統必須 fail closed，不得進入 retrieval、tool 或 LLM 路徑。

`sourceSystem` 可以保留在標準化後的 internal context 中，但不一定由 frontend 或 host app 每次直接提供。backend 可以根據 `hostApp`、`entityType`、`screenId`、selected adapter 或 HostApp capability 推導 `sourceSystem`。frontend 只需提供 sanitized PageContext、identity headers、session scope 與必要 metadata；最終資料來源選擇與 adapter routing 必須由 backend 控制，frontend 不得決定 `sourceSystem`、connector 或任意 data source。

### PageContext Normalization

`PageContext` 代表 host app 提供的宿主畫面脈絡，可能包含：

- `route`
- `screenId`
- `hostModule`
- `entityType`
- `entityId`
- `selectedRows`
- `activeFilters`
- `visibleColumns`
- `userVisibleState`

PageContext normalization 必須遵守下列規則：

1. backend 必須 validate 與 normalize `PageContext`。
2. `route` 的 query string 與 hash 不得被當成可信資料來源。
3. `selectedRows` 只接受 id 或安全 summary，不接受 raw row payload。
4. `activeFilters` 只接受 allowlisted field。
5. `visibleColumns` 只作為 field-level visibility hint，不可取代 permission check。
6. `userVisibleState` 只能作為 context hint，不可作為權限依據。
7. 遇到敏感、未 allowlist 或過度詳細的欄位時，normalization 必須移除或遮罩。
8. 問題若依賴 PageContext 但缺少必要上下文，系統必須回到 `clarification_required`，不得猜測 entity。

### HostApp Registry

`HostApp Registry` 用來定義 host app registration 與 capability declaration。第一版採 static code-based registration，不要求 dynamic database registration。每個 host app capability 宣告至少包含：

- `hostAppId`
- `displayName`
- `supportedEntityTypes`
- `supportedScreens`
- `supportedDataAdapters`
- `defaultPermissionScopeMapping`
- `degradedBehavior`

第一版 reference host app 為：

- `admin`

未來保留但不在本 feature 實作：

- `mes`
- `wms`
- `scm`
- `crm`
- `custom`

若 request 帶入尚未註冊的 host app，或 host app 不支援目前 `entityType` / `screenId`，系統必須回傳一致的 safe path，例如 `unsupported host app`、`no_answer`、`clarification_required` 或 `degraded`，不得誤用其他 host app 的 adapter。

### Data Adapter Contract v1

`Data Adapter Contract v1` 是 backend-side data adapter 的統一規格，用來讓不同 host app 與 source system 透過相同模式提供 evidence-safe 資料給既有 assistant core。概念上必須支援：

- `sourceSystem`
- `supportedHostApps`
- `supportedEntityTypes`
- `canHandle(context)`
- `resolveContext(context)`
- `fetchEvidence(query)`
- `healthCheck()`

此處的 `sourceSystem` 代表 backend 在 routing 後實際選定的 evidence source，而不是 frontend 指定的 connector target 或資料來源。

Adapter 回傳結果不得是 raw system payload，而必須是 evidence-safe structure。建議 evidence shape 至少包含：

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

Data Adapter Contract v1 必須遵守以下規則：

1. adapter 不得回傳 credential / secret。
2. adapter 不得把 raw full payload 直接交給 LLM。
3. adapter 必須在資料進入 LLM 前完成 permission masking 與 data minimization。
4. adapter result 必須可轉成 `EvidenceRef`。
5. adapter failure 或 dependency degraded 只能走既有 public contract 可理解的 safe path，例如 `tool_failure`、`no_answer`、safe error envelope 或等價的既有 unavailable/degraded UI flow；`degraded` 在本 spec 中代表 internal dependency state / safe path，而不是新的 public answer enum。
6. permission check 必須在 adapter execution 前與 evidence exposure 前都成立。

### Connector Routing Hints

本 feature 不要求完整重寫 planner，但必須定義下列因素如何影響 routing 決策：

- `hostApp`
- `entityType`
- `screenId`
- `permissionScopes`
- `query intent`

上述 routing hints 必須能影響：

- `candidateTools`
- `requiredEvidence`
- `contextResolution`
- `riskAssessment`
- `clarificationNeeds`
- `expectedAnswerShape`

frontend 提供的 context 可以影響 backend 的 resolution 與 routing 判斷，但不能指定任意 connector、任意 data source 或最終 `sourceSystem`。資料來源選擇、adapter selection 與 evidence routing 必須由 backend 根據 capability、permission 與 safety rules 決定。

### Admin / Orders / Inventory Reference Adapter

第一版 reference adapter 限定為 `admin` host app 下的 Orders / Inventory 範圍，只驗證最小資料查詢與 grounded answer flow。建議最小支援範圍如下：

- `Admin Orders`
- `Admin Inventory`

第一版可支援的問答類型：

- order status lookup
- order summary
- selected orders comparison
- inventory availability lookup
- inventory summary

超出範圍或無法安全回答時，系統必須只回傳：

- `no_answer`
- `clarification_required`
- `permission_denied`
- `tool_failure`
- `degraded`

## User Personas

- **admin_operator**：可查看 order 與 inventory 基本資料的營運使用者。
- **finance_user**：除基本資料外，也具備成本相關欄位權限的使用者。
- **limited_user**：能使用 assistant，但不具備敏感欄位或成本欄位權限的使用者。
- **host system integrator**：負責在 host app 內整合 frontend SDK 與 backend headers/context handoff 的工程人員。
- **product / platform owner**：負責審查 host app registration、adapter capability 與 degraded behavior 的產品或平台角色。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Validate Host Integration Context (Priority: P1)

backend 必須接收並驗證 host app 傳來的 identity、permission scopes、hostApp、organization boundary 與 PageContext，並把這些資訊轉成可供 assistant core 與 `ExecutionPlan` 使用的標準化請求上下文。

**Why this priority**: 若無法先建立可信的 request context，後續 retrieval、tool routing、evidence 或 answer 全部不可信，也違反既有安全與權限邊界。

**Independent Test**: 使用帶有完整 headers 與 host metadata 的 assistant request 即可獨立驗證 context validation，不必先實作 reference adapter。

**Acceptance Scenarios**:

1. **Given** request 帶完整 identity、`hostApp`、`organizationId`、`permissionScopes` 與 `requestId`，**When** backend 建立 assistant request context，**Then** context 會被標準化並可供 `ExecutionPlan` 使用。
2. **Given** request 缺少 `actorId`、`organizationId`、`hostApp`、`permissionScopes` 或 `requestId`，**When** backend 收到 request，**Then** 系統 fail closed，回傳一致 safe error，且不進入 retrieval、tool 或 LLM。
3. **Given** `hostApp` 未註冊，**When** request 進入 backend，**Then** 系統回傳 unsupported host app safe error 或 `no_answer` / `degraded`，不得猜測 connector。

---

### User Story 2 - Normalize PageContext and Resolve Current Entity (Priority: P1)

backend 能把 host app 的 PageContext 轉成可稽核、可權限檢查、可供 `ExecutionPlan` 使用的 normalized context，並在必要時解析目前頁面實體或 selected rows。

**Why this priority**: host app 的頁面資料格式不一致，若沒有 normalization，assistant core 無法安全理解「這筆」、「目前這張」或「剛剛選取的幾筆」。

**Independent Test**: 僅需輸入不同形狀的 PageContext 與對應 query，即可驗證 normalized context 與 clarification 邏輯。

**Acceptance Scenarios**:

1. **Given** PageContext 包含 `entityType` 與 `entityId`，**When** 使用者問「這筆」或「目前這張」，**Then** backend 能解析 current entity candidate。
2. **Given** PageContext 只有 `selectedRows`，**When** 使用者問「剛剛選取的幾筆」，**Then** backend 能解析 selected row candidates。
3. **Given** 問題依賴 PageContext 但 context 不足，**When** backend 判斷無法安全解析目標，**Then** 回傳 `clarification_required`，不得使用上一個不可靠 context。
4. **Given** PageContext 含敏感或未 allowlist 欄位，**When** backend 執行 normalization，**Then** 該欄位會被移除或遮罩，並在 audit 中記錄 minimization。

---

### User Story 3 - Register HostApp Capabilities (Priority: P1)

backend 有 HostApp Registry，可描述 host app 支援哪些 `entityType`、`screenId`、`data adapter` 與 degraded behavior，並可讓 assistant core 在 routing 前先理解宿主能力邊界。

**Why this priority**: assistant core 必須知道某個 host app 能做什麼、不能做什麼，才能避免把 admin adapter 誤套到其他系統。

**Independent Test**: 可單獨測 registry lookup 與 unsupported capability path，不依賴 reference adapter 內容。

**Acceptance Scenarios**:

1. **Given** `hostApp=admin`，**When** request 進入 backend，**Then** backend 可取得 `admin` capabilities。
2. **Given** `hostApp=mes/wms/scm/crm` 但尚未實作 adapter，**When** request 進入 backend，**Then** backend 以 unsupported capability safe path 回應，不得誤用 `admin` adapter。
3. **Given** host app capability 不支援該 `entityType`，**When** backend 進行 routing，**Then** 回傳 `no_answer` 或 `clarification_required`，並記錄 audit。

---

### User Story 4 - Define Data Adapter Contract v1 (Priority: P1)

建立 backend Data Adapter Contract v1，使未來 MES / WMS / SCM / CRM 能依相同 interface 接入 assistant core，並確保 adapter result 只以 evidence-safe 形式流入後續回答流程。

**Why this priority**: 若沒有穩定的 adapter contract，host integration 只能逐案硬接，無法產品化，也無法確保資料最小化與 permission-safe evidence。

**Independent Test**: 可透過 mock adapter 測試 `canHandle`、`resolveContext`、`fetchEvidence` 與 minimization，不需要真實 host connector。

**Acceptance Scenarios**:

1. **Given** 已註冊 adapter 支援某個 `entityType`，**When** `ExecutionPlan` 需要 structured evidence，**Then** backend 可呼叫 adapter 並取得 evidence-safe result。
2. **Given** adapter 嘗試回傳 raw payload，**When** result 進入 evidence pipeline，**Then** raw payload 必須被 minimization 或 masking，且不得直接進入 LLM input。
3. **Given** adapter unavailable，**When** backend 嘗試查詢資料，**Then** 回傳 `tool_failure`、`no_answer` 或 `degraded` safe path，並記錄 audit。

---

### User Story 5 - Admin Orders / Inventory Reference Adapter (Priority: P2)

使用 Admin / Orders / Inventory 建立第一個 reference adapter，驗證 host integration gateway 與 data adapter contract 能實際串起 assistant core、`ExecutionPlan`、evidence pipeline 與 grounded answer。

**Why this priority**: 需要第一個受控且可測試的 reference integration，證明這條產品化路徑可行，但不把 002 擴成完整 ERP/CRM project。

**Independent Test**: 只需 `admin` host app 與 deterministic synthetic fixtures，即可驗證 detail page、selected rows 與權限遮罩行為。

**Acceptance Scenarios**:

1. **Given** admin order detail PageContext，**When** 使用者問「這張訂單目前狀態是什麼」，**Then** backend 使用 admin orders adapter 取得 evidence，並回傳 grounded answer。
2. **Given** admin inventory detail PageContext，**When** 使用者問「這個品項可用庫存是多少」，**Then** backend 使用 inventory adapter 取得 evidence，並回傳 grounded answer。
3. **Given** `selectedRows` 包含多筆 orders，**When** 使用者要求比較，**Then** backend 只針對 `selectedRows` 查詢，不擴大查詢範圍。
4. **Given** 使用者沒有成本欄位權限，**When** 問成本或毛利，**Then** 回傳 `permission_denied` 或只回答可見欄位。

---

### User Story 6 - Integration Golden Questions and Eval Smoke (Priority: P2)

建立最小 golden question set 與 eval smoke，驗證 host context aware retrieval、adapter routing、權限控制與安全狀態是否順暢。

**Why this priority**: 沒有固定 smoke cases，就無法穩定驗證 host integration 是否仍維持 grounded、permission-safe 與 frontend-compatible。

**Independent Test**: 可以固定 synthetic fixtures 與 question set 直接驗證，不依賴完整 end-to-end 環境。

**Acceptance Scenarios**:

1. **Given** order status detail page question，**When** eval smoke 執行，**Then** expected evidence source 必須是 order。
2. **Given** selected orders comparison question，**When** eval smoke 執行，**Then** 查詢範圍只限於 `selectedRows`。
3. **Given** inventory availability question，**When** eval smoke 執行，**Then** expected evidence source 必須是 inventory。
4. **Given** missing PageContext case，**When** eval smoke 執行，**Then** final answer decision 必須是 `clarification_required`。
5. **Given** unauthorized field case，**When** eval smoke 執行，**Then** final answer decision 必須是 `permission_denied` 或 masked answer。
6. **Given** unsupported host/entity 或 adapter degraded case，**When** eval smoke 執行，**Then** final public outcome 必須映射到 001 既有 safe response，例如 `no_answer`、`tool_failure` 或 safe error envelope，而不是新增 `degraded` answer decision。

---

### User Story 7 - Audit, Observability, and Degraded Behavior (Priority: P2)

host integration decisions、adapter routing、permission masking、adapter failures 都必須可稽核、可觀測，且對 frontend 001 的 response shape 維持安全狀態。

**Why this priority**: 本 feature 是產品化整合層，沒有 audit 與 degraded behavior，就無法安全上線或追查整合失敗原因。

**Independent Test**: 可透過 audit metadata、safe errors 與 SSE final state 驗證，不必等所有 host app 實作完成。

**Acceptance Scenarios**:

1. **Given** 任一次 HostApp capability decision，**When** request 完成，**Then** 系統有對應 audit event 或 audit metadata。
2. **Given** 任一次 PageContext normalization / minimization，**When** request 完成，**Then** 系統有可追蹤 metadata。
3. **Given** 任一次 adapter selection 或 adapter failure，**When** request 完成，**Then** 系統有對應 audit event。
4. **Given** connector degraded 或 adapter timeout，**When** backend 回應，**Then** response 不得洩漏 raw error、stack、secret 或 credential。
5. **Given** request 最終進入安全狀態，**When** frontend 接收結果，**Then** response 必須仍對齊 frontend 001 的 `AnswerDecision`、`noAnswerReason` 與 SSE contract。

### Edge Cases

- host app 傳入 `selectedRows`，但其中包含未授權資料或超出目前 organization boundary 的 id。
- 使用者詢問「這張訂單」時，PageContext 同時存在 `entityId` 與 `selectedRows`，且兩者指向不同 target。
- `visibleColumns` 表示某欄位目前可見，但 permission scope 不允許 backend 曝露該欄位。
- `activeFilters` 含有未 allowlist 欄位、敏感欄位或推導出敏感資訊的條件。
- adapter health check 正常，但實際 `fetchEvidence` 因來源系統 timeout 進入 degraded path。
- host app capability 支援 `entityType`，但不支援當前 `screenId` 或 selected rows interaction pattern。
- frontend 重送同一 request，而 backend 必須維持一致 safe outcome 並避免不必要的擴大查詢。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統必須定義 Host Integration Context 的標準欄位與驗證要求，至少涵蓋 `hostApp`、`actorId`、`organizationId`、`role`、`permissionScopes`、`requestId`、`pageContext`、`sessionScope` 與 `sourceSystem`；其中 `sourceSystem` 屬於標準化後的 internal context，可由 backend 推導，不得被視為 frontend 必填或 frontend 可任意指定的資料來源選擇器。
- **FR-002**: 系統必須對缺少 `actorId`、`organizationId`、`hostApp`、`permissionScopes` 或 `requestId` 的 request fail closed，且不得進入 retrieval、tool 或 LLM。
- **FR-003**: 系統必須接受 `x-permission-scopes` CSV header 作為 v1 外部 permission scope transport，並在 backend 內部 normalize 成一致格式供 assistant core 使用。
- **FR-004**: 系統必須驗證 `hostApp` 是否已註冊於 HostApp Registry；未註冊時不得猜測或 fallback 到其他 host app adapter。
- **FR-005**: 系統必須支援 HostApp Registry 的 capability declaration，至少能描述 `hostAppId`、`displayName`、`supportedEntityTypes`、`supportedScreens`、`supportedDataAdapters`、`defaultPermissionScopeMapping` 與 `degradedBehavior`。
- **FR-006**: HostApp Registry v1 必須採 static code-based registration，並以 `admin` 作為第一個 reference host app。
- **FR-007**: 系統必須 validate 與 normalize `PageContext`，並確保 `route` query/hash 不被視為可信資料來源。
- **FR-008**: `selectedRows` 只可接受 id 或安全 summary，不得接受 raw row payload。
- **FR-009**: `activeFilters` 只可接受 allowlisted field；未 allowlist 欄位必須被忽略、移除或遮罩。
- **FR-010**: `visibleColumns` 只可作為 field-level visibility hint，不得取代 permission check。
- **FR-011**: `userVisibleState` 只可作為 context hint，不得被視為權限、資料真值或 evidence。
- **FR-012**: 當問題依賴 PageContext，但缺少可安全解析 current entity 或 selected rows 的必要資訊時，系統必須回傳 `clarification_required`。
- **FR-013**: 系統必須根據 `hostApp`、`entityType`、`screenId`、`permissionScopes` 與 query intent 形成 connector routing hints，並影響 `candidateTools`、`requiredEvidence`、`contextResolution`、`riskAssessment`、`clarificationNeeds` 與 `expectedAnswerShape`。
- **FR-013a**: frontend 或 host app 不得決定任意 connector、任意 data source 或最終 `sourceSystem`；frontend 提供的 metadata 只能作為 routing hint，最終 adapter 與資料來源選擇必須由 backend 控制。
- **FR-014**: 系統必須定義 Data Adapter Contract v1，支援 `sourceSystem`、`supportedHostApps`、`supportedEntityTypes`、`canHandle(context)`、`resolveContext(context)`、`fetchEvidence(query)` 與 `healthCheck()`。
- **FR-015**: Data Adapter 回傳必須是 evidence-safe structure，不得回傳 raw full payload、secret、credential 或 token。
- **FR-016**: adapter result 在進入 LLM 前必須完成 permission-aware masking 與 data minimization。
- **FR-017**: adapter result 必須可轉換成 frontend-safe 的 `EvidenceRef` 或等價 evidence reference。
- **FR-018**: permission check 必須在 adapter execution 前執行一次，並在 evidence exposure 前再次確保輸出欄位安全。
- **FR-019**: adapter unavailable、timeout、health check failed 或 source degraded 時，系統必須映射到 001 已存在的 public safe outcome，例如 `no_answer` 搭配既有 `noAnswerReason`、`tool_failure` 對應的 safe response，或既有 safe error envelope；不得新增 public `AnswerDecision` 值 `degraded`。
- **FR-020**: adapter timeout policy v1 必須沿用既有 tool timeout policy，不另定一套獨立 timeout framework，但可在 registry 或 adapter metadata 中宣告 degraded behavior。
- **FR-021**: 系統必須提供 `admin` reference adapter，至少支援 Orders / Inventory 的最小查詢能力。
- **FR-022**: `admin` orders reference flow 至少支援 order status lookup、order summary 與 selected orders comparison。
- **FR-023**: `admin` inventory reference flow 至少支援 inventory availability lookup 與 inventory summary。
- **FR-024**: 當問題超出 reference adapter 範圍、超出 host capability、缺 context、權限不足或 adapter degraded 時，系統只能回傳安全狀態，不得生成超範圍答案。
- **FR-025**: 本 feature 必須沿用 001 既有 assistant public API 與 session/message/SSE contract，不得新增另一套 chat API。
- **FR-026**: 允許新增 backend internal module / service contract，例如 `HostIntegrationModule`、`HostAppRegistry`、`PageContextNormalizer`、`DataAdapterRegistry`、`AdminOrdersAdapter`、`AdminInventoryAdapter`，但這些是 backend internal contract，不是新的 frontend public API。
- **FR-027**: 若需要管理或 diagnostic endpoint，必須明確標示為 internal/admin diagnostic，且不得破壞 frontend 001 widget API contract。
- **FR-028**: 本 feature 不得要求 frontend 傳 raw entity data；frontend 只能傳 sanitized PageContext、identity headers、session scope 與必要 metadata。
- **FR-029**: backend 必須透過 Data Adapter / Connector 根據權限查詢完整資料，不得把 PageContext 視為完整資料來源。
- **FR-030**: PageContext 不得繞過 row-level、field-level、operation-level 或 adapter-side permission check。
- **FR-031**: 每次 HostApp capability decision、PageContext normalization、masking/minimization、adapter selection 與 adapter failure 都必須可稽核。
- **FR-032**: degraded response、`tool_failure`、`permission_denied`、`clarification_required` 與 `no_answer` 都必須維持與 001 `AnswerDecision`、`noAnswerReason` 與 SSE final state 相容；本 feature 不得新增 `answerDecision = "degraded"`、`final.data.answerDecision = "degraded"` 或任何等價的新 public final-state enum。
- **FR-033**: integration smoke / golden questions 必須固定 expected answer decision 與 expected evidence source，以驗證 host context aware retrieval 是否正確。
- **FR-034**: 測試與 eval fixtures 必須是 synthetic / de-identified，不得使用真實客戶、真實訂單、真實庫存、真實金額或真實 secret。
- **FR-035**: 安全與隱私要求必須明確禁止 raw connector payload 出現在 response、audit metadata、general logs 或 LLM input。
- **FR-036**: connector、adapter 與 routing failure 的 safe path 必須保留可觀測 metadata，但不得暴露 stack trace、raw error detail 或 secret。
- **FR-037**: 本 feature 必須保留未來接入 MES / WMS / SCM / CRM / custom host app 的擴充空間，但不得把這些 future adapters 視為本 feature 的 deliverable。

### API / Contract Requirements

本 feature 原則上不新增新的 public chat API，應延續 001 既有 assistant API，例如：

- `POST /api/v1/assistant/sessions`
- `POST /api/v1/assistant/sessions/:sessionId/messages`
- `GET /api/v1/assistant/sessions/:sessionId/messages`
- `GET /api/v1/assistant/approval-requests/:id`

API / contract 必須遵守：

- request validation 仍透過既有 assistant request path 進入，不建立平行的 host integration chat endpoint。
- SSE final state 必須維持 001 既有 `AnswerDecision`、`noAnswerReason` 與相關 final-state semantics，不得新增 public `degraded` answer decision value。
- response/error/requestId contract 必須保持與 001 相容。
- `EvidenceRef` 或等價 evidence output 必須保持 frontend-safe，不暴露 raw connector payload。
- adapter degraded、timeout 或 unavailable 必須映射到既有 safe response，例如 `no_answer` 搭配既有理由、`tool_failure` 對應 safe response、safe error envelope，或既有 unavailable/degraded UI flow 所能理解的狀態；不得在 public contract 暴露 `answerDecision = "degraded"`。
- 任何新增 internal/admin diagnostic endpoint 都不得影響前端 widget 契約或要求前端改用不同傳輸模式。

### Data Adapter Contract Requirements

Data Adapter Contract v1 的規格目標是讓未來 host app 可以以一致模式接入 assistant core，而不是把每個 connector 特性硬耦合到 assistant runtime。後續 design/plan 必須至少保留以下要求：

- adapter 必須宣告可服務的 `sourceSystem`、`supportedHostApps` 與 `supportedEntityTypes`。
- adapter 必須能根據 normalized Host Integration Context 判斷 `canHandle(context)`。
- adapter 必須能把 host-specific context 轉成較一致的 internal resolution result。
- adapter 必須只回傳 evidence-safe result，而非 raw connector payload。
- adapter 必須提供 health check 或等價 degraded signal，讓 assistant 能決定 safe fallback；此 degraded signal 屬於 internal dependency / observability 狀態，不得直接變成新的 public `AnswerDecision`。
- adapter contract 必須支援 future host apps 擴充，但 v1 不要求 dynamic registry 或 self-service adapter onboarding。

## Testing Requirements

### Unit Tests

- `PageContextNormalizer`
- `HostAppRegistry`
- `DataAdapterRegistry`
- permission-aware field masking
- adapter result minimization

### Integration Tests

- full request context validation
- unsupported host app
- missing PageContext clarification
- admin order detail evidence answer
- selectedRows scoped lookup
- unauthorized field `permission_denied`
- adapter unavailable safe `degraded` / `tool_failure`

### Contract Tests

- existing assistant message API does not change
- SSE final state remains `AnswerDecision`-based
- no new frontend-breaking response shape
- `EvidenceRef` remains frontend-safe

### E2E / Eval Smoke

- golden questions for Admin Orders / Inventory
- expected `answerDecision`
- expected evidence source
- `no_answer` / `permission_denied` / `degraded` cases

### Security / Privacy Tests

- no raw payload to LLM
- no secret in logs / audit metadata / response
- PageContext cannot bypass permission check

## Data / Fixtures

本 feature 的 deterministic test fixtures 至少包含：

### Admin order fixture

- `orderId: SO-10001`
- `status: confirmed`
- `customerName: synthetic customer`
- `cost: restricted field`

### Admin inventory fixture

- `itemNo: SKU-001`
- `availableQty: 320`
- `reservedQty: 40`
- `cost: restricted field`

### Users

- `admin_operator` with read order/inventory permission
- `finance_user` with cost permission
- `limited_user` without cost permission

所有 fixtures 都必須是 synthetic / de-identified，且不得使用真實客戶、真實訂單、真實庫存、真實金額或真實 secret。

## Security / Privacy / Audit Requirements

- 缺少 identity、organization、hostApp、permissionScopes 或 requestId 時必須 fail closed。
- data minimization 必須在資料進入 LLM 前完成。
- permission check 必須在 adapter execution 前與 evidence exposure 前都成立。
- adapter timeout 或 degraded 時必須回到安全 fallback。
- frontend 不得指定任意 connector、任意 data source 或最終 `sourceSystem`；這些只能由 backend 根據 capability、permission 與 routing rules 決定。
- routing decision、masking/minimization 與 degraded path 都必須產生 audit event 或等價 audit metadata。
- response、general logs 與 audit metadata 都不得包含 raw connector payload。
- response、general logs 與 audit metadata 都不得包含 secret、credential 或 token。
- PageContext 只能作為 context hint，不得取代 permission 或資料授權。
- `degraded` 屬於 internal dependency state、availability signal 或 safe path metadata，應記錄於 audit / observability；對前端 public response 仍必須維持 001 既有 `AnswerDecision`、`noAnswerReason`、safe error envelope 與 SSE final state。
- degraded、`tool_failure`、`permission_denied` 與 `clarification_required` 必須對前端回傳安全、穩定、可解釋的狀態，而非底層錯誤細節。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: backend 可驗證 Host Integration Context，且 100% 缺少必要 identity / organization / hostApp / permissionScopes / requestId 的測試案例都 fail closed。
- **SC-002**: backend 可 normalize PageContext，且 100% 缺少必要 context 的指示詞查詢都回到 `clarification_required`。
- **SC-003**: backend 可根據 `hostApp` / `entityType` 選擇 reference data adapter，且不會在 unsupported host/entity 情況下誤用其他 adapter。
- **SC-004**: backend 可用 Admin Orders / Inventory reference adapter 回答 grounded answer，且成功案例都能指出對應 evidence source。
- **SC-005**: backend 對缺 context、無權限、unsupported host、adapter degraded 都走安全狀態，不產生 raw data leakage。
- **SC-006**: 本 feature 不破壞 001 frontend widget API / SSE contract，所有 contract tests 維持既有 response shape、`AnswerDecision`-based final state，且不得出現 public `answerDecision = "degraded"`。
- **SC-007**: audit / observability 可追蹤 host integration decision、normalization、masking、adapter routing 與 degraded path。
- **SC-008**: 所有 test fixtures 都是 synthetic / de-identified，且 security/privacy tests 證明沒有 raw payload 或 secret exposure。

## Assumptions

- `001-internal-assistant-core` 已存在並提供既有 assistant chat/session/SSE/evidence/audit contract，本 feature 只建立其上的 host integration layer。
- HostApp Registry v1 先採 static code-based registration，不在本 feature 建立 dynamic DB registration。
- permission scope transport v1 先沿用 `x-permission-scopes` CSV header，backend 內部再 normalize。
- adapter timeout policy v1 沿用既有 tool timeout policy，而不是另立一套 adapter timeout framework。
- 第一個 reference host app 為 `admin`，reference entity scope 為 Orders 與 Inventory。
- frontend 002 只會傳 sanitized PageContext，不會傳 raw entity payload。

## Open Questions

1. 若未來需要非 `admin` host app onboarding，第一個要擴充的 reference host 是 `MES`、`WMS`、`SCM` 還是 `CRM`，應依哪個產品優先序拆出下一份 feature spec？
2. 對於 internal/admin diagnostic endpoint，第一版是否需要只讀的 adapter health / registry inspection contract，還是先完全依賴既有 observability 與 audit 查核？
