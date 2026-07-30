# Feature Specification: Host App Capability Governance and Reference Integration

**Feature Branch**: `002-host-integration-gateway-and-data-adapter-contract`

**Created**: 2026-07-13

**Status**: Draft

**Input**: User description: "建立 backend host integration gateway 與 data adapter contract，讓既有 internal assistant core 能安全接收不同 host app 的 identity、permission scopes、PageContext、session scope 與 connector routing hints，並以 Admin / Orders / Inventory 作為第一個 reference host integration。"

## Feature Summary

Backend 002 是 Backend 001 `internal-assistant-core` 的增量能力層，不是新的 Host Integration foundation，也不是新的 assistant runtime。Backend 001 已提供 host-aware assistant core，包括 assistant public API、SSE、identity、PageContext、AssistantContextState、Query Understanding、ExecutionPlan、Connector / Tool runtime、permission、EvidenceRef、AnswerDecision、audit 與 observability foundation。

Backend 002 的核心目標是在這些既有能力上新增 Host App capability governance、host-specific PageContext policy、backend-owned source selection，以及 `admin` Orders / Inventory reference integration。此 feature 要讓 backend 能以 static HostApp capability 限制每個 host app 支援的 screen、entity、interaction 與 connector / tool eligibility，並用固定、安全、可回歸的 reference cases 驗證多 Host App 產品化方向。

Backend 002 不得重做 Backend 001 的 identity、PageContext public contract、query planning、connector runtime、permission pipeline、EvidenceRef pipeline、AnswerDecision mapping、audit writer 或 observability framework。

## Product Context

本產品方向是一份 Backend 001 assistant core 服務多個 host app。Backend 001 負責共同 runtime 與 public contract；Backend 002 負責把不同 host app 的能力邊界產品化，讓 backend 在既有 assistant request flow 中知道某個 `hostApp` 在特定 `screenId`、`entityType` 與 interaction 下，哪些 connector / tool / evidence capability 是 eligible。

`admin` 是 Backend 002 的第一個正式 reference host app，用來驗證 Orders 與 Inventory 在既有 connector / tool / permission / evidence pipeline 中如何安全回答。`mes`、`wms`、`scm`、`crm`、`custom` 只保留 identifier 與 extension boundary，不在本 feature 實作 production connector。

Frontend 002 可以透過 npm package / SDK mode 掛載 widget，但 Backend 002 不實作 frontend SDK，也不要求新的 backend request mode。Frontend 只沿用 Backend 001 既有 identity headers 與 top-level `pageContext`，不得傳 raw entity payload、routing authority、approval navigation metadata 或 backend-required session scope。

## Backend 001 Reuse Baseline

Backend 002 必須直接重用下列 Backend 001 能力，不重新定義、不重新實作，也不得建立第二套 authority、registry、runtime、mapper 或 writer：

- 既有 assistant session / message / history API。
- SSE event contract 與 `final.data.answerDecision`。
- `RequestIdentityContext`。
- identity extraction 與 validation。
- actor / hostApp / organization / role / permission scopes / requestId contract。
- 既有 top-level `pageContext` public request 欄位。
- PageContext DTO 與基本 schema validation。
- `AssistantContextState`。
- context resolution 與 clarification flow。
- Query Understanding。
- `ExecutionPlan`。
- Tool Registry。
- `ConnectorAdapter`。
- structured lookup 與既有 runtime orchestration。
- permission pre-check。
- organization boundary、permission pre-check、field masking 與 row-level permission extension points。
- field masking。
- LLM input sanitization。
- `EvidenceRef`。
- `AnswerDecision`。
- degraded / timeout / tool failure 的既有 safe mapping。
- append-only audit writer。
- observability 與 dependency health foundation。

Backend 002 可以新增 host-specific policy、capability metadata、allowlist 與 reference acceptance，但必須接在上述 Backend 001 能力之上。Backend 002 只補上 `admin` reference integration 所需的 selectedRows 逐筆 organization / row-level revalidation，不建立第二套 permission engine。

## Scope / Non-goals

### In Scope

- 定義 static HostApp capability registry 與 capability declaration。
- 定義 host / screen / entity / interaction eligibility。
- 定義 host-specific PageContext policy validation、allowlist、minimization 與 selectedRows policy。
- 定義 backend-derived `sourceSystem` 作為 internal routing / evidence metadata。
- 定義 capability-aware connector / tool eligibility，並要求沿用 Backend 001 planning、tool routing、permission、masking 與 evidence flow。
- 定義 `admin` Orders / Inventory reference integration 的產品 acceptance。
- 定義 deterministic synthetic fixtures、golden questions、eval smoke、privacy 與 regression guardrails。
- 定義 host-specific audit / observability metadata。

### Out of Scope

- 不實作 frontend widget / frontend SDK / npm package。
- 不新增 public chat API。
- 不建立 Backend 001 Compatibility Mode 與 Backend 002 Mode 兩套 backend request contract。
- 不新增 nested `hostContext`。
- 不建立第二個 PageContext request 位置。
- 不建立第二套 identity authority。
- 不建立第二套 Query Understanding、ExecutionPlan 或 routing runtime。
- 不建立第二套 ConnectorAdapter、Tool Registry 或 adapter registry runtime。
- 不建立第二套 permission engine、EvidenceRef conversion framework、AnswerDecision mapper、audit writer 或 observability framework。
- 不把 `sessionScope` 加入 Backend 002 public request contract；`sessionScope` 屬於 Frontend 002 session ownership / namespace / fallback 管理。
- 不接收 approval navigation metadata；Host App 導航屬於 Frontend 002 callback responsibility。
- 不新增 public diagnostic endpoint。
- 不一次實作完整 ERP / MES / WMS / SCM / CRM connector。
- 不做完整 Admin backend domain、generic SQL connector、admin UI / CRUD、approval management UI、production deployment / Kubernetes / Helm。
- 不允許 frontend / host app 傳 raw entity data 給 LLM。
- 不允許 PageContext、visibleColumns、selectedRows 或 userVisibleState 取代 permission check。
- 不允許 connector / adapter 回傳 raw secret、credential、token 或 full sensitive payload 到 response、log、audit metadata 或 LLM input。

## Public API / Transport Contract

Backend 002 必須沿用 Backend 001 既有 Assistant public API 與 transport contract。Backend 002 不重新定義 route path、global prefix 或 route parameter naming；精確 public path、global prefix 與 `:id` 等 parameter 命名，以 Backend 001 實際 controller、bootstrap global prefix、Swagger / OpenAPI 產出與 contract tests 為唯一來源。

Backend 002 沿用 Backend 001 現有 assistant session、message、history、feedback、approval、action draft 與 escalation public routes。

Backend 002 的 public contract decisions：

- request validation 仍透過既有 assistant request path 進入，不建立平行 host integration chat endpoint。
- message request body 繼續使用 Backend 001 既有 top-level `pageContext`。
- 不新增 nested `hostContext`。
- identity、organization、role、permission scopes 與 requestId 完全繼承 Backend 001 現有 validator 與 contract tests。
- Backend 002 不重新決定 `role` 是否 required；此規則直接繼承 Backend 001 實際 contract。
- Backend 002 不建立 body 中的第二套 identity authority。
- `sessionScope` 不加入 Backend 002 public request contract。
- Backend 002 不接收 approval navigation metadata。
- SSE final state 維持 Backend 001 既有 `AnswerDecision`、`noAnswerReason` 與 final-state semantics。
- `EvidenceRef` output 必須保持 frontend-safe，不暴露 raw connector payload。

## Frontend Integration Dependency

Frontend 002 可以用 npm package / SDK mode 取得 host app 畫面脈絡，但 Backend 002 只接受 Backend 001 已定義的 backend contract：

- 既有 trusted identity headers。
- 既有 top-level sanitized `pageContext`。
- 既有 assistant session / message / SSE transport。

Frontend 不得傳 raw entity payload，也不得傳 connector、connectorId、adapter、adapterId、`sourceSystem`、dataSource、candidateTool、candidateTools、permission result 或 final evidence source 作為 backend routing authority。

Frontend session ownership、session namespace、fallback recovery 與 host app navigation callback 屬於 Frontend 002 responsibility，不是 Backend 002 required request contract。

## Core Concepts

### HostApp Capability Registry

`HostApp Capability Registry` 是 Backend 002 的核心功能。v1 採 static code-based registration，不建立 dynamic database registration、self-service onboarding API 或 admin CRUD。

每個 `HostAppCapability` 至少描述：

- `hostAppId`
- `displayName`
- supported entity types
- supported screens
- supported interactions
- eligible connector / tool 或 evidence capabilities
- PageContext allowlist
- selectedRows policy
- active filter allowlist
- field visibility / exposure policy
- default permission-scope mapping interpretation
- degraded / unsupported behavior

v1 正式註冊：

- `admin`

Future reserved identifiers，非本 feature deliverable：

- `mes`
- `wms`
- `scm`
- `crm`
- `custom`

Capability rules:

1. 未註冊 host app 不得 fallback 到 `admin`。
2. unsupported entity 不得猜測最接近的 entity。
3. unsupported screen 不得套用其他 screen 的 capability。
4. unsupported interaction 不得執行 connector / tool。
5. 某 entity type 存在，不代表所有 screen 與 interaction 都允許使用該 entity 的 connector / tool。
6. capability eligibility 必須發生在既有 tool / connector 執行前。
7. HostApp capability 與 `defaultPermissionScopeMapping` 只能解讀、限制或縮小 Backend 001 已驗證的 permission scopes 與 eligible capability，不得生成、補齊、合併、替換或提升使用者權限。
8. `role` 名稱、persona 名稱、`visibleColumns`、screen capability 與 PageContext 都不得授予或提升 permission。
9. 若 HostApp capability declaration 與 Backend 001 permission 結果衝突，必須採用較嚴格的限制。

### Host-specific PageContext Policy

Backend 002 不新增 public PageContext DTO，也不新增第二個 PageContext request 位置。Backend 002 在 Backend 001 既有 PageContext DTO、mapper、AssistantContextState、Query Understanding 與 clarification flow 上，新增 host-specific policy validation 與 minimization。

Backend 002 新增的 PageContext policy 範圍：

- 根據 HostApp capability 驗證 `screenId`。
- 根據 HostApp capability 驗證 `entityType`。
- 根據 screen / entity 驗證 interaction。
- PageContext 欄位 allowlist。
- activeFilters allowlist。
- field visibility / exposure policy。
- selectedRows 上限與 interaction eligibility。
- host-specific 敏感欄位移除或遮罩。
- capability decision 與 minimization 結果的 audit metadata。

PageContext policy rules:

1. `route` query string 與 hash 不得作為可信資料來源。
2. `visibleColumns` 不得取代 permission。
3. `userVisibleState` 不得作為 permission authority。
4. PageContext 不足時沿用 Backend 001 既有 clarification path。
5. Backend 002 不建立第二套 deixis resolution、clarification pipeline 或 AssistantContextState。
6. raw PageContext 不得直接交給 LLM。

### selectedRows Policy

`selectedRows` 只作 request-scoped comparison / bulk context，不作 session identity，也不得擴大查詢範圍。

Backend 002 固定 selectedRows 規則：

1. 只接受 Backend 001 既有 PageContext contract 允許的 ID 或 safe summary。
2. Frontend 與 Backend 都必須獨立驗證最多 20 筆。
3. Backend 不得只信任 Frontend 驗證結果。
4. 超過 20 筆時整體拒絕，不得截斷為前 20 筆。
5. 上限檢查必須針對 client 原始輸入數量執行，不得先 deduplicate 後才判斷是否超限。
6. `entityId` 與 `selectedRows` 指向互相衝突的 target 時，不得任意選擇其中一方。
7. 任一 selected row 跨 organization 或未通過 row-level permission 時，整個 comparison request 回 `permission_denied`。
8. 不得只處理合法 subset。
9. 不得在 response 中揭露是哪一個 ID 未授權。
10. Audit metadata 必須最小化，不記錄未授權 row 的 raw payload。
11. 每個 selected row 都必須在取得或暴露完整資料前重新套用 Backend 001 既有 organization boundary 與 row-level permission extension point。
12. frontend 傳入的 row ID、safe summary 或畫面上可見狀態都不得視為 authorization proof。

### Backend-owned `sourceSystem`

`sourceSystem` 是 backend-owned internal routing / evidence metadata，不是 frontend 或 host app 可指定的欄位。

Backend 可以根據下列可信資訊推導 `sourceSystem`：

- trusted `hostApp`
- HostApp capability
- normalized `screenId`
- normalized `entityType`
- eligible existing connector / tool
- backend-selected adapter specialization
- existing `ExecutionPlan`

`sourceSystem` 推導結果必須與實際選用的 connector / tool / adapter specialization 一致。推導與選擇結果必須寫入既有 audit / observability pipeline。Client 傳入的 `sourceSystem` 必須視為 routing-control injection，而不是可信 routing input。

### Connector / Tool / Data Adapter Boundary

`DataAdapter` 可以保留為概念，但它不是第二套 runtime。若後續設計保留 `DataAdapter`，它必須是既有 Connector / Tool domain 中的 read-oriented evidence specialization。

Backend 002 必須遵守：

1. DataAdapter 若存在，必須由既有 Connector / Tool domain 管理。
2. 不建立獨立於 Tool Registry / ConnectorAdapter 的第二套 registry。
3. 不建立第二套 routing runtime。
4. 不建立第二套 health model。
5. 不建立第二套 timeout policy。
6. 不建立第二套 permission engine。
7. 不建立第二套 EvidenceRef conversion framework。
8. 不建立第二套 degraded / public outcome mapper。
9. 不建立第二套 audit writer 或 observability framework。
10. adapter eligibility 由 HostApp capability 與既有 planning / tool routing 共同約束。
11. adapter 執行仍走 Backend 001 既有 permission pre-check。
12. adapter evidence 仍走 Backend 001 既有 masking、LLM sanitization 與 EvidenceRef pipeline。
13. timeout / unavailable / tool failure 仍映射到 Backend 001 既有 `tool_failure` safe mapping。
14. `degraded` 不得成為新的 public `AnswerDecision`。
15. adapter 不得建立 adapter-specific permission engine；Admin selectedRows 逐筆 revalidation 必須擴充既有 permission policy 與 row-level extension point。

本 spec 不強制保留獨立的 `DataAdapterRegistryService` 技術設計；後續技術設計若提及 registry，必須與既有 Tool Registry / ConnectorAdapter domain 對齊，不得成為獨立產品 surface。

### Public Safe Outcome Mapping

Backend 002 必須讓相同情境只有一個公開結果，並沿用 Backend 001 既有 public enum、error envelope 與 safe mapping：

| 情境 | 固定 public outcome |
| --- | --- |
| query 依賴「這筆」、「這張」、「目前這個」、缺少必要 entity reference、`entityId` 與 `selectedRows` target 衝突，或存在多個無法安全選擇的 entity candidate | `clarification_required` |
| client payload 包含 connector、connectorId、adapter、adapterId、`sourceSystem`、dataSource、candidateTool、candidateTools、permission result 或 final evidence source 等 routing-control 欄位 | Backend 001 既有 request validation / integration error envelope；不以 `AnswerDecision` 作為主要拒絕結果 |
| 未註冊 Host App | Backend 001 既有 request / integration error envelope；不 fallback 到 `admin`，不進入 connector / tool routing |
| 已註冊 Host App 但 screen、entity 或 interaction 不支援 | `no_answer`，搭配 Backend 001 可容納的 internal `noAnswerReason`；不新增 public enum |
| 純 restricted-field 問題、mixed unauthorized selectedRows、row-level permission 失敗或 operation permission 失敗 | `permission_denied` |
| tool / adapter timeout、unavailable 或 tool failure | Backend 001 既有 `tool_failure` safe mapping；適用時為 `no_answer` + `noAnswerReason=tool_failure` |
| 混合授權 / restricted-field 問題，且授權欄位可形成不誤導 partial answer | 回答授權部分，restricted 部分明確表示無權限提供，不暴露 restricted value 或存在性 |
| 混合授權 / restricted-field 問題，但 partial answer 會誤導 | `permission_denied` |

Backend 002 不新增 public `AnswerDecision`、不新增第二套 error model，也不把 `degraded` 暴露成 public answer decision。

### Routing Authority

Backend 可使用的 routing inputs 包含：

- existing trusted identity context
- `hostApp`
- normalized `screenId`
- normalized `entityType`
- normalized entity reference
- normalized selectedRows
- allowlisted filters
- permission scopes
- query intent
- HostApp capability
- existing Query Understanding / ExecutionPlan result

上述資訊只能影響：

- eligible candidate tools / connectors
- required evidence
- context resolution
- clarification requirement
- expected answer shape
- backend-owned source selection

Client / frontend 不得指定：

- connector
- connectorId
- adapter
- adapterId
- `sourceSystem`
- dataSource
- candidateTool
- candidateTools
- permission result
- final evidence source

若 client-controlled payload 傳入上述 routing-control 欄位，Backend 必須拒絕該 request，不進入 retrieval、tool、adapter 或 LLM，並寫入最小化 audit。Audit 只記錄欄位名稱、requestId、hostApp、organization 與拒絕原因，不記錄 client 傳入的完整 routing target 值或 raw request body。

### Admin Orders / Inventory Reference Integration

Backend 001 已存在 generic mock connector、generic Orders / Inventory lookup、tool execution、permission、evidence 與 safe response。Backend 002 不取代這些能力。

Backend 002 新增的 `admin` reference integration acceptance 包含：

- `hostApp=admin` 正式 capability registration。
- Orders / Inventory supported screens。
- Orders / Inventory supported entity types。
- supported interactions。
- selectedRows comparison eligibility。
- backend-derived source selection。
- deterministic synthetic reference fixtures。
- fixed personas 與 restricted field acceptance。
- host capability-aware routing 驗收。
- golden questions / eval cases。

Reference integration 必須支援下列 acceptance questions：

- order status lookup
- order summary
- selected orders comparison
- inventory availability lookup
- inventory summary
- restricted cost permission behavior
- unsupported host / screen / entity / interaction
- adapter unavailable / timeout safe path

Reference integration 不得演變成完整 ERP connector、generic SQL connector、完整 Admin backend domain，也不得取代 Backend 001 既有 mock fixtures 或 connector runtime。

### Restricted Field Behavior

純 restricted-field 問題，例如使用者只問無權限的 `cost`：

- 回 `permission_denied`。
- restricted value 不得進入 LLM input。
- restricted value 不得進入 EvidenceRef。
- restricted value 不得出現在 response、log 或 audit metadata。

混合授權 / 受限欄位問題，例如同時詢問 status 與 cost：

- 只有在授權欄位本身能形成真實、有用且不誤導的 partial answer 時，才回答授權部分。
- 受限部分必須省略、遮罩或明確表示無權限提供。
- 不得透露受限值。
- 不得透露受限值是否為 null、是否存在、是否超過某個門檻。
- 若 partial answer 會造成誤導，則整體回 `permission_denied`。
- 必須沿用 Backend 001 既有 permission、masking 與 EvidenceRef pipeline。
- `finance_user` 只有在 Backend 001 可信 permission scopes 實際包含 restricted `cost` permission 時，才可讀取 `cost`；persona 名稱或 `role` 名稱本身不得授予 `cost` 權限。
- `defaultPermissionScopeMapping` 不得將 `role` 自動轉換成額外 permission scope，也不得把未授權欄位加入 LLM input 或 EvidenceRef。

### Audit / Observability

Backend 002 只新增 host-specific audit metadata，不建立第二套 audit 或 observability framework。

可新增 metadata：

- HostApp capability lookup result
- unsupported host / screen / entity / interaction reason
- PageContext policy decision
- selectedRows policy rejection
- eligible connector / tool set
- final backend-selected connector / tool / adapter specialization
- backend-derived `sourceSystem`
- adapter dependency status
- host-specific minimization summary

必須沿用：

- Backend 001 `AuditWriter`
- requestId correlation
- existing structured logger
- redaction policy
- existing observability metadata
- dependency health model
- timeout / failure reason
- existing safe mapping defined by Backend 001 AnswerDecision / noAnswerReason behavior

不得記錄：

- raw PageContext
- raw selected rows
- 完整 entity record
- unauthorized field value
- credential
- token
- secret
- raw connector payload
- raw exception object

### Approval / Diagnostic / Future Host Apps

Approval:

- Backend 002 不接收 approval navigation metadata。
- Backend 002 不新增 approval-specific Host Integration Context。
- 沿用 Backend 001 既有 `ApprovalRequest`、`ActionDraft`、`EscalationRequest` 與 public API。
- Host App 導航屬於 Frontend 002 callback responsibility。

Diagnostic:

- v1 不新增 public diagnostic endpoint。
- 沿用 Backend 001 既有 health、readiness、audit 與 observability。
- HostApp Registry inspection 或 adapter diagnostic 延後至後續 feature。

Future Host Apps:

- `mes`
- `wms`
- `scm`
- `crm`
- `custom`

本 feature 只保留 identifier 與 extension boundary，不決定優先序，也不實作 production connector。

## User Personas

- **admin_operator**: 可查看 order 與 inventory 基本資料的營運使用者，但不因角色名稱自動取得 restricted `cost` 欄位。
- **finance_user**: 具備 order / inventory 基本 read permission；只有當 Backend 001 可信 permission scopes 實際包含 restricted `cost` permission 時，才可讀取 `cost`。
- **limited_user**: 能使用 assistant 並可讀基本欄位，但不具備 restricted `cost` permission。
- **host system integrator**: 負責在 host app 中提供既有 identity headers 與 top-level sanitized `pageContext` 的工程人員。
- **product / platform owner**: 負責審查 HostApp capability、unsupported behavior、reference acceptance 與 future host app extension boundary。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use Existing Identity and PageContext to Resolve HostApp Capability (Priority: P1)

Backend 使用 Backend 001 既有 `RequestIdentityContext` 與 top-level `pageContext`，查詢 static HostApp capability，判定目前 host / screen / entity / interaction 是否受支援。

**Independent Test**: 以既有 assistant request contract 傳入完整 identity headers 與 top-level `pageContext`，驗證 `hostApp=admin` 可取得 capability；未註冊 host 使用 Backend 001 既有 request / integration error envelope。

**Acceptance Scenarios**:

1. **Given** request 使用 Backend 001 既有 identity headers 且 `hostApp=admin`，**When** backend 評估 capability，**Then** 取得 `admin` HostApp capability。
2. **Given** request 帶未註冊 host app，**When** backend 評估 capability，**Then** 沿用 Backend 001 既有 request / integration error envelope，不得 fallback 到 `admin`。
3. **Given** request 缺少 Backend 001 required identity field，**When** backend 收到 request，**Then** 沿用 Backend 001 identity validation fail closed，不進入 capability、retrieval、tool 或 LLM。

### User Story 2 - Restrict Eligible Connector / Tool by Host Capability (Priority: P1)

Backend 根據 HostApp capability、normalized screen/entity/interaction 與既有 ExecutionPlan，限制 eligible connector / tool。

**Independent Test**: 不需要實作完整 Admin adapter，可用 capability fixtures 驗證 unsupported host、screen、entity 或 interaction 不產生 eligible connector / tool。

**Acceptance Scenarios**:

1. **Given** `admin` capability 支援 order detail status lookup，**When** 使用者詢問訂單狀態，**Then** eligible tools 只能包含 capability 與 permission compatible 的 Orders evidence path。
2. **Given** screen 不支援 selectedRows comparison，**When** 使用者要求比較 selected rows，**Then** backend 不得選取 comparison connector / tool。
3. **Given** entity type unsupported，**When** backend 建立 routing decision，**Then** public outcome 為 `no_answer`，並搭配 Backend 001 可容納的 internal `noAnswerReason`。

### User Story 3 - Apply Host-specific PageContext Policy and selectedRows Safety (Priority: P1)

Backend 在既有 PageContext contract 上套用 host-specific allowlist、selectedRows policy 與 minimization，並沿用 Backend 001 clarification path。

**Independent Test**: 以不同 PageContext shape 驗證 allowlist、selectedRows 20 筆上限、entityId / selectedRows conflict 與 minimization metadata。

**Acceptance Scenarios**:

1. **Given** PageContext `screenId` 不在 `admin` capability 中，**When** request 進入 backend，**Then** public outcome 為 `no_answer`，不套用其他 screen capability。
2. **Given** `selectedRows` 超過 20 筆，**When** backend 執行 policy validation，**Then** 整體拒絕，不截斷、不 deduplicate 後再接受。
3. **Given** `entityId` 與 `selectedRows` 指向不同 target，**When** 使用者要求查詢或比較，**Then** public outcome 為 `clarification_required`，不任意選一方。
4. **Given** selectedRows 任一 row 跨 organization 或未授權，**When** backend 執行 row-level permission，**Then** 整個 comparison request 回 `permission_denied`，不處理合法 subset。

### User Story 4 - Derive Backend-owned `sourceSystem` (Priority: P1)

Backend 根據 trusted identity、HostApp capability、normalized PageContext、eligible connector / tool 與 ExecutionPlan 推導 `sourceSystem`。

**Independent Test**: 使用 fixed capability 與 request fixtures 驗證 `sourceSystem` 與實際 selected connector / tool / adapter specialization 一致，且 frontend 指定 `sourceSystem` 會被拒絕。

**Acceptance Scenarios**:

1. **Given** `admin` Orders detail lookup，**When** backend 選定 Orders evidence path，**Then** `sourceSystem` 由 backend 推導並寫入最小化 audit metadata。
2. **Given** client payload 嘗試傳入 `sourceSystem`，**When** backend 驗證 request，**Then** request 被拒絕，不進入 retrieval、tool、adapter 或 LLM。
3. **Given** backend-selected connector / tool 改變，**When** source metadata 被記錄，**Then** `sourceSystem` 必須與實際 evidence source 一致。

### User Story 5 - Complete Admin Orders Queries Through Existing Pipeline (Priority: P2)

Backend 使用既有 Connector / Tool / permission / masking / EvidenceRef / AnswerDecision pipeline 完成 `admin` Orders reference queries。

**Independent Test**: 使用 deterministic synthetic fixtures 驗證 order status、order summary、selected orders comparison 與 restricted cost behavior。

**Acceptance Scenarios**:

1. **Given** admin order detail PageContext，**When** 使用者問「這張訂單目前狀態是什麼」，**Then** backend 使用 existing connector / tool / evidence path 回傳 grounded answer。
2. **Given** selectedRows comparison request，**When** 所有 rows 都在 organization boundary 且具 read permission，**Then** 查詢範圍只限 selectedRows。
3. **Given** limited_user 只問 `cost`，**When** backend 處理 request，**Then** final public outcome 是 `permission_denied`，restricted value 不進 LLM、EvidenceRef、response、log 或 audit。

### User Story 6 - Complete Admin Inventory Queries Through Existing Pipeline (Priority: P2)

Backend 使用既有 pipeline 完成 `admin` Inventory reference queries，並套用 HostApp capability 與 restricted field policy。

**Independent Test**: 使用 deterministic synthetic fixtures 驗證 inventory availability、inventory summary 與 restricted cost behavior。

**Acceptance Scenarios**:

1. **Given** admin inventory detail PageContext，**When** 使用者問可用庫存，**Then** backend 回傳 grounded answer 且 evidence source 是 inventory。
2. **Given** unsupported inventory screen，**When** 使用者詢問 inventory data，**Then** backend 不得套用其他 screen capability。
3. **Given** mixed status + cost question，**When** 使用者無 cost permission，**Then** 只有在授權欄位能形成不誤導 partial answer 時才回答授權部分；若 partial answer 會誤導，public outcome 為 `permission_denied`。

### User Story 7 - Safely Reject Unsupported Host / Screen / Entity / Interaction (Priority: P2)

Backend 對 unsupported capability case 使用固定 public outcome，不猜測、不 fallback、不暴露 routing detail。

**Independent Test**: 使用 unsupported host、screen、entity、interaction fixtures 驗證固定 public outcome、audit metadata 與 no fallback。

**Acceptance Scenarios**:

1. **Given** `hostApp=mes` 但 v1 未註冊 production capability，**When** request 進入 backend，**Then** 沿用 Backend 001 既有 request / integration error envelope，不使用 `admin` capability。
2. **Given** `admin` 不支援某 interaction，**When** 使用者要求該 interaction，**Then** public outcome 為 `no_answer`，backend 不選 connector / tool。
3. **Given** client 指定 candidate tool，**When** backend 驗證 request，**Then** request 被拒絕並寫入最小化 audit。

### User Story 8 - Golden Questions / Eval / Privacy / Regression (Priority: P2)

建立固定 golden questions、eval smoke、privacy 與 architecture regression，證明 Backend 002 的增量能力不破壞 Backend 001。

**Independent Test**: 使用 synthetic fixtures 與固定 expected outcomes，驗證 public contract、source selection、permission behavior 與 Public Safe Outcome Mapping。

**Acceptance Scenarios**:

1. **Given** order status golden question，**When** eval 執行，**Then** expected evidence source 是 order，且 public response 符合 Backend 001 AnswerDecision contract。
2. **Given** inventory availability golden question，**When** eval 執行，**Then** expected evidence source 是 inventory。
3. **Given** adapter timeout 或 unavailable，**When** backend 回應，**Then** final public outcome 沿用 Backend 001 `tool_failure` safe mapping，不出現 public `answerDecision = "degraded"`。
4. **Given** Backend 002 Admin capability path以外的既有Backend 001流程，**When** 002 capability code 存在，**Then** 既有 Backend 001 行為不被改變。

### Edge Cases

- unregistered host app 嘗試使用 `admin` Orders / Inventory capability。
- unsupported screen 但 entity type 支援。
- unsupported interaction 但 entity type 與 screen 支援。
- client 傳入 connector / adapter / `sourceSystem` / candidateTools / permission result。
- `selectedRows` 超過 20 筆。
- `selectedRows` 原始輸入超過 20 筆但 deduplicate 後小於 20 筆。
- selectedRows 包含跨 organization 或未授權 row。
- `entityId` 與 `selectedRows` target 衝突。
- `visibleColumns` 顯示 restricted field，但 permission scope 不允許 backend 曝露該欄位。
- `activeFilters` 含未 allowlist 或敏感條件。
- adapter health 正常但 actual lookup timeout。
- repeated request / retry 不得造成 scope drift、adapter drift、permission drift 或 evidence expansion。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Backend 002 必須重用 Backend 001 既有 `RequestIdentityContext`、identity extraction、identity validation 與 required identity fields，不得建立第二套 identity authority。
- **FR-002**: Backend 002 必須沿用 Backend 001 既有 assistant public API、SSE、top-level `pageContext` 與 requestId / error envelope contract，不得新增 public chat endpoint、nested `hostContext` 或第二套 backend request mode。
- **FR-003**: Backend 002 不得把 `sessionScope` 加入 backend public request contract；session ownership / namespace / fallback 屬於 Frontend 002 concern。
- **FR-004**: Backend 002 不得接收 approval navigation metadata，並必須沿用 Backend 001 既有 approval / action draft / escalation APIs。
- **FR-005**: 系統必須提供 static HostApp Capability Registry v1，正式註冊 `admin`，並保留 `mes`、`wms`、`scm`、`crm`、`custom` identifiers 作為 future extension boundary。
- **FR-006**: `HostAppCapability` 至少必須描述 hostAppId、displayName、supported entity types、supported screens、supported interactions、eligible connector / tool 或 evidence capabilities、PageContext allowlist、selectedRows policy、active filter allowlist、field exposure policy、permission-scope mapping interpretation 與 degraded / unsupported behavior。
- **FR-007**: 未註冊 host 必須沿用 Backend 001 既有 request / integration error envelope；unsupported screen、unsupported entity 或 unsupported interaction 的 public outcome 必須為 `no_answer` 並搭配 Backend 001 可容納的 internal `noAnswerReason`。所有情況皆不得 fallback 到 `admin` 或其他 capability。
- **FR-008**: Capability eligibility 必須在既有 connector / tool execution 前完成，且必須與 Backend 001 Query Understanding / ExecutionPlan / Tool Registry 結果共同約束 eligible candidate tools。
- **FR-008a**: HostApp capability 與 permission-scope mapping 只能縮小 eligible connector、eligible tool、visible field 與 supported operation，不得生成、補齊、合併、替換或提升 Backend 001 已驗證的 permission scopes，也不得擴大 organization boundary、row scope、field permission、operation permission 或 evidence exposure。
- **FR-009**: Backend 002 必須在 Backend 001 既有 PageContext DTO 與 mapper 之上套用 host-specific PageContext policy，不得新增 public PageContext DTO 或第二個 PageContext request 位置。
- **FR-010**: PageContext policy 必須支援 screenId validation、entityType validation、screen/entity/interaction validation、PageContext allowlist、activeFilters allowlist、field visibility / exposure policy、selectedRows 上限與 host-specific sensitive field minimization。
- **FR-011**: `route` query string 與 hash 不得作為可信資料來源。
- **FR-012**: `visibleColumns`、`userVisibleState`、selectedRows safe summary 與 PageContext 不得作為 permission authority。
- **FR-013**: PageContext 不足、缺少必要 entity reference、target 衝突或存在多個無法安全選擇的 candidate 時，public outcome 必須為 `clarification_required`，且不得建立第二套 clarification pipeline。
- **FR-014**: `selectedRows` 最多 20 筆，且 Backend 必須針對 client 原始輸入數量獨立檢查；超過 20 筆時整體拒絕，不得截斷或先 deduplicate 後接受。
- **FR-015**: `selectedRows` 只作 request-scoped comparison / bulk context，不作 session identity，也不得擴大查詢範圍。
- **FR-016**: 任一 selected row 跨 organization 或未通過 row-level permission 時，整個 comparison request 必須回 `permission_denied`，不得只處理合法 subset，也不得揭露哪個 ID 未授權。Backend 002 必須對每個 selected row 重新套用 Backend 001 既有 organization boundary 與 row-level permission extension point，不得將 frontend row ID、safe summary 或畫面可見狀態視為 authorization proof。
- **FR-017**: Client / frontend 不得指定 connector、connectorId、adapter、adapterId、`sourceSystem`、dataSource、candidateTool、candidateTools、permission result 或 final evidence source。
- **FR-018**: Client-controlled payload 若包含 routing-control 欄位，Backend 必須以 Backend 001 既有 request validation / integration error envelope 拒絕 request，不進入 retrieval、tool、adapter 或 LLM，不以 `AnswerDecision` 作為主要拒絕結果，並寫入只含欄位名稱、requestId、hostApp、organization 與拒絕原因的最小化 audit metadata。
- **FR-019**: Backend 必須推導 backend-owned `sourceSystem`，且推導結果必須與實際選用的 connector / tool / adapter specialization 一致。
- **FR-020**: `sourceSystem` 推導與 final backend-owned source selection 必須寫入既有 audit / observability pipeline。
- **FR-021**: 若保留 DataAdapter 概念，它必須是既有 Connector / Tool domain 中的 read-oriented evidence specialization，不得成為獨立 runtime、registry、health model、timeout policy、permission engine、EvidenceRef conversion framework、public outcome mapper、audit writer 或 observability framework。
- **FR-022**: adapter / connector execution 仍必須走 Backend 001 既有 permission pre-check、row-level permission extension point、masking、LLM sanitization、EvidenceRef 與 AnswerDecision pipeline；Backend 002 不得建立 adapter-specific permission engine。
- **FR-023**: timeout、unavailable、tool failure 或 degraded dependency 必須映射到 Backend 001 既有 `tool_failure` safe mapping；適用時為 `no_answer` + `noAnswerReason=tool_failure`。不得新增 public `answerDecision = "degraded"` 或 `final.data.answerDecision = "degraded"`。
- **FR-024**: Backend 002 必須提供 `hostApp=admin` reference capability registration，並定義 Orders / Inventory supported screens、entity types、interactions、selectedRows comparison eligibility 與 evidence capabilities。
- **FR-025**: Admin Orders reference acceptance 至少涵蓋 order status lookup、order summary、selected orders comparison 與 restricted cost permission behavior。
- **FR-026**: Admin Inventory reference acceptance 至少涵蓋 inventory availability lookup、inventory summary 與 restricted cost permission behavior。
- **FR-027**: 純 restricted-field 問題必須回 `permission_denied`，restricted value 不得進入 LLM input、EvidenceRef、response、log 或 audit metadata。
- **FR-028**: 混合授權 / 受限欄位問題只有在授權欄位能形成真實、有用且不誤導 partial answer 時才可回答授權部分；受限值不得洩漏存在性、null 狀態或門檻資訊。若 partial answer 會誤導，public outcome 必須為 `permission_denied`。
- **FR-029**: Backend 002 只新增 host-specific audit metadata，必須沿用 Backend 001 append-only audit writer、redaction policy、observability metadata 與 dependency health model。
- **FR-030**: Audit / observability 不得記錄 raw PageContext、raw selected rows、完整 entity record、unauthorized field value、credential、token、secret、raw connector payload 或 raw exception object。
- **FR-031**: Backend 002 必須提供 deterministic synthetic fixtures、golden questions、eval smoke、privacy tests、contract tests 與 architecture guards，驗證 002 增量能力不破壞 Backend 001。
- **FR-032**: Backend 002 不得實作 full ERP connector、generic SQL connector、完整 Admin backend domain、MES / WMS / SCM / CRM production connector 或 public diagnostic endpoint。

## Data / Fixtures

Backend 002 deterministic test fixtures 必須是 synthetic / de-identified，且不得取代 Backend 001 既有 mock connector runtime。Backend 002 reference fixtures 必須放在獨立 reference namespace，不得修改、覆蓋或重新定義 Backend 001 既有 fixture key 與 value；retry、seed 與 fixture loading 順序不得改變同一 ID 的資料結果。

### Admin order fixture

- `orderId: ADMIN-SO-10001`
- `status: confirmed`
- `customerName: synthetic customer`
- `cost: restricted field`

### Admin inventory fixture

- `itemNo: ADMIN-SKU-001`
- `availableQty: 320`
- `reservedQty: 40`
- `cost: restricted field`

### Personas

- `admin_operator`: 可讀 order / inventory 基本欄位，不因角色名稱自動取得 restricted `cost`。
- `finance_user`: 具備 order / inventory 基本 read permission；只有當 Backend 001 可信 permission scopes 實際包含 restricted `cost` permission 時，才可讀取 `cost`。
- `limited_user`: 可使用 assistant 並讀基本欄位，但沒有 restricted `cost` permission。

## Testing Requirements

### Contract Tests

- Backend 001 assistant message API unchanged。
- SSE final remains `AnswerDecision`-based。
- no public `answerDecision = "degraded"`。
- top-level `pageContext` remains public request location。
- no nested `hostContext`。
- no backend-required `sessionScope`。
- no public diagnostic endpoint。

### Unit Tests

- HostApp capability registry。
- Host / screen / entity / interaction eligibility。
- HostApp capability 與 permission-scope mapping 只能縮小 capability，不得提升 Backend 001 verified permission scopes。
- PageContext allowlist / minimization policy。
- selectedRows max 20 policy。
- routing-control field rejection。
- backend-derived `sourceSystem` derivation。
- DataAdapter / ConnectorAdapter no-split architecture guard。

### Integration Tests

- `admin` capability lookup。
- unregistered host cannot use `admin` capability。
- unsupported screen / entity / interaction cannot select connector / tool。
- Admin Orders reference questions use existing connector / tool / permission / evidence path。
- Admin Inventory reference questions use existing connector / tool / permission / evidence path。
- selectedRows over 20 rejected as whole request。
- mixed unauthorized selectedRows return `permission_denied` as whole request。
- every selected row is revalidated through Backend 001 organization boundary and row-level permission extension point before full data retrieval or exposure。
- client-supplied routing-control fields rejected before retrieval / tool / adapter / LLM。
- unregistered host uses Backend 001 existing request / integration error envelope and does not route connector / tool。
- unsupported screen / entity / interaction returns `no_answer` without connector / tool selection。
- adapter unavailable / timeout uses Backend 001 `tool_failure` safe mapping。

### Security / Privacy Tests

- raw PageContext does not enter LLM input。
- raw selectedRows does not enter LLM input, response, log, audit or observability。
- restricted values do not enter LLM input, EvidenceRef, response, log or audit metadata。
- frontend cannot specify `sourceSystem`、connector、adapter、candidate tool、permission result or final evidence source。
- visibleColumns / userVisibleState / selectedRows safe summary cannot bypass permission。
- `finance_user` role / persona name without trusted restricted `cost` permission scope cannot access `cost`。
- capability mapping cannot add unauthorized fields to LLM input or EvidenceRef。

### Eval / Golden Questions

- order status lookup。
- order summary。
- selected orders comparison。
- inventory availability lookup。
- inventory summary。
- unauthorized cost。
- unsupported host / screen / entity / interaction。
- adapter unavailable / timeout。
- repeated request / retry scope stability。

### Backend 001 Regression

- Backend 002 Admin capability path以外的既有Backend 001流程 remains unchanged。
- Existing assistant API / SSE / AnswerDecision / EvidenceRef / audit tests remain compatible。

## Security / Privacy / Audit Requirements

- Backend 002 必須沿用 Backend 001 identity、permission、masking、EvidenceRef、AnswerDecision、audit 與 observability foundation。
- 缺少 Backend 001 required identity context 時，必須沿用 Backend 001 fail-closed behavior。
- HostApp capability rejection、PageContext policy rejection、selectedRows rejection、routing-control rejection 與 source selection 都必須產生最小化 audit metadata。
- selectedRows 超過 20 筆必須整體拒絕。
- mixed unauthorized rows 必須整體回 `permission_denied`。
- 每個 selected row 都必須在取得或暴露完整資料前重新套用 Backend 001 既有 organization boundary 與 row-level permission extension point。
- HostApp capability 只能縮小 Backend 001 已驗證的 permission scopes、eligible capability 與 evidence exposure，不得提升權限。
- restricted field value 不得出現在 LLM input、EvidenceRef、response、log、audit metadata 或 observability metadata。
- client-supplied routing-control 欄位必須安全拒絕並 audit。
- frontend 不得指定 `sourceSystem`。
- `degraded` 只可作 internal dependency / availability metadata，不得成為 public `AnswerDecision`。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Backend 001 既有 public API / SSE / `AnswerDecision` contract 無 breaking change。
- **SC-002**: Backend 002 沒有建立第二套 identity、PageContext、planner、permission、evidence、audit、observability 或 connector runtime。
- **SC-003**: `admin` 可取得明確 HostApp capability。
- **SC-004**: 未註冊 host app 100% 不得使用 `admin` capability。
- **SC-005**: unsupported screen / entity / interaction 100% 不得選取 connector / tool。
- **SC-006**: Backend 能推導並 audit 最終 backend-owned `sourceSystem`，且與實際 selected connector / tool / adapter specialization 一致。
- **SC-007**: Admin Orders / Inventory reference questions 使用 Backend 001 既有 connector / tool / permission / evidence path。
- **SC-008**: selectedRows 超過 20 筆的測試案例 100% 整體拒絕。
- **SC-009**: mixed unauthorized rows 的 comparison 測試案例 100% 整體回 `permission_denied`。
- **SC-010**: restricted values 100% 不進 LLM input、EvidenceRef、response、log 或 audit metadata。
- **SC-011**: client 傳入 routing-control 欄位時 100% 安全拒絕並產生最小化 audit metadata。
- **SC-012**: adapter unavailable / timeout 100% 沿用 Backend 001 `tool_failure` safe mapping。
- **SC-013**: public response 中 0 cases 出現 `answerDecision = "degraded"` 或 `final.data.answerDecision = "degraded"`。
- **SC-014**: Backend 002 Admin capability path以外的既有Backend 001流程，其 public behavior、routing、permission、EvidenceRef、AnswerDecision 與 audit 結果不得因 Backend 002 capability code 而改變。
- **SC-015**: 所有 fixtures 都是 synthetic / de-identified。
- **SC-016**: HostApp capability / permission-scope mapping 0 cases 提升 Backend 001 已驗證的 permission scopes、organization boundary、row scope、field permission、operation permission 或 evidence exposure。

## Assumptions / Decisions

- Backend 001 host-aware foundation 已存在，且是唯一 core runtime。
- Backend 002 直接重用 Backend 001 public API 與 context contract。
- top-level `pageContext` 維持不變。
- 不新增 nested `hostContext`。
- 不新增 Backend request mode。
- `sessionScope` 不進 Backend public contract。
- role / permission / requestId 規則繼承 Backend 001，且 `role` 名稱不得自動授予額外 permission。
- DataAdapter 若存在，只是 existing connector domain specialization。
- 不建立獨立 DataAdapter registry / runtime。
- v1 HostApp Registry 採 static code-based registration。
- reference host 為 `admin`。
- reference domain 為 Orders / Inventory。
- v1 不新增 public diagnostic endpoint。
- Future Host App 優先序延後至後續 feature。

## Deferred Work / Future Considerations

- Full MES connector。
- Full WMS connector。
- Full SCM connector。
- Full CRM connector。
- `custom` host app onboarding。
- dynamic HostApp registry / DB registration。
- self-service adapter onboarding。
- frontend SDK implementation。
- Web Component / iframe mode。
- full admin connector platform。
- admin UI / CRUD。
- approval management UI。
- production deployment / Kubernetes / Helm。
- HostApp Registry inspection 或 adapter diagnostic endpoint。

## Open Questions

目前沒有阻塞本 spec 的 Open Questions。Future host app 優先序、diagnostic endpoint 與 dynamic onboarding 都已延後至 Deferred Work / Future Considerations。
