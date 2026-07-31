<!--
Sync Impact Report
Version change: 1.0.0 -> 2.0.0
Focused cleanup: retained version 2.0.0 and Last Amended 2026-07-30; clarified requestId,
SDK/Customer Host transport ownership, protected-endpoint scope, and control-plane separation.
Modified principles:
- C2 測試先行與可回歸：新增 customer 跨界隔離測試門檻
- C3 安全與權限不可繞過 -> C3 Trusted Identity Boundary
- C4 API 一致性與可嵌入性：釐清 Gateway、Backend、SDK 與 Customer Host 的責任
- C5 RAG 與工具品質可衡量：新增 customer namespace/filter 與 customer-scoped tool policy
- C6 全鏈路可稽核：新增 customer 可追溯性
Added sections:
- Customer ownership hierarchy
Removed sections:
- 單一公司／單一組織部署與不集中管理多家公司之產品假設
Templates reviewed:
- ✅ .specify/templates/plan-template.md：通用 Constitution Check，無需修改
- ✅ .specify/templates/spec-template.md：通用規格模板，無需修改
- ✅ .specify/templates/tasks-template.md：通用任務模板，無需修改
Follow-up TODOs:
- 將來的 Customer-Scoped Assistant Core spec 必須把本憲章要求轉為資料模型、JWT contract、
  repository/service 規則與測試；本次不修改 spec、schema 或 production code。
-->

# 內部後台 AI 助理產品 Constitution

**版本**：2.0.0 | **Ratified**：2026-06-11 | **Last Amended**：2026-07-30

---

## 1. 文件目的

本文件為 `internal-ai-assistant.com` 內部後台 AI 助理產品的開發憲章，作為所有
`spec.md`、`design.md`、`plan.md`、`tasks.md` 與程式實作的最高約束依據。

本憲章規範可嵌入企業內部系統的 AI 工作助理 Backend、SDK/API、工具調用、資料查詢、
審核流程與稽核要求。任何下層文件若與本憲章衝突，以本憲章為準，並必須先修正下層
文件後才能進入實作。

---

## 2. 產品使命（Mission）

本產品是可嵌入 ERP、MES、WMS、SCM、CRM、客服後台、營運後台等不同企業內部系統的
AI 工作助理。它透過可重用的 `@ideaxpress/assistant-sdk`、統一 Identity Gateway、
customer-scoped AI Backend 與各 customer 的資料 Connector，協助內部人員理解問題、
查詢資料、整理證據、提出建議，並在授權範圍內準備或執行操作。

本產品不是對外客服 chatbot，也不得沿用對外客服的公開知識、匿名訪客、留資或客服
轉接假設。內部助理面對的是具備身份與權限的企業內部使用者。一套共享式 Backend 可
安全服務多個 Customer；Customer 是最外層安全、資料所有權與隔離邊界。所有資料查詢
與操作都必須先限制於 Customer，再依 organization、host app、actor、roles 與
permission scopes 進一步約束。

核心使命原則：**AI 只能在可驗證、可授權、可稽核的範圍內協助工作；高風險操作必須
交由人確認或審核。**

---

## Core Principles

### C1 可維護架構優先

所有功能必須以清楚 bounded context、Service/domain 層業務規則、可替換
LLM/tool/retrieval 介面實作。Controller 只負責請求邊界、DTO 驗證與回應，不得承載
核心業務邏輯。

系統必須把 assistant core、tool registry、connector、retrieval、approval、audit、
host integration 分成清楚模組。ERP、MES、WMS、SCM、CRM 等宿主系統差異必須放在
connector/adapter 層，不得污染核心對話與決策流程。

### C2 測試先行與可回歸

核心服務、工具調用、權限、RAG、審核流程、安全防護必須有可執行測試。高風險與失敗
路徑不得只測 happy path。

任何涉及 query understanding、tool routing、permission check、risk classification、
approval workflow、audit logging、RAG/no-answer gate 的功能，必須具備 unit、integration、
contract、e2e 或 regression tests。新增或修改 retrieval/query-understanding 時，必須
更新或執行 eval dataset 與 no-answer regression。

所有 customer-owned 功能必須有跨 Customer 隔離測試。測試至少使用兩個 Customer，並
刻意使用相同 `organizationId`、`actorId`、`hostApp`，證明 `customerId` 才是平台級
隔離邊界。

### C3 Trusted Identity Boundary

Backend 只信任由 Identity Gateway 驗證外部身份後簽發的 internal identity JWT。Backend
必須驗證 internal JWT 的簽章、issuer、audience、有效時間與必要 claims，且不得接受
外部 customer JWT 作為 Backend identity token。

此 internal identity JWT 要求適用於接觸 customer-owned data 或提供業務操作能力的受保護
端點。health、readiness、metrics 與公開文件端點可依部署政策處理，但不得暴露 Customer
資料或提供業務操作能力。

可信 identity context 的 `customerId`、`integrationId`、`organizationId`、`hostApp`、
`actorId`、`roles: string[]` 與 `permissionScopes` 必須來自已驗簽 claims。Customer 是最
外層資料隔離邊界；`organizationId`、`hostApp`、`actorId`、roles 或 permission scopes
皆不得取代 `customerId` 作為平台級邊界。

不得信任前端、SDK、Customer Host 或 public request 提供的 `x-customer-id`、
`x-actor-id`、`x-role`、`x-organization-id`、`x-host-app` 或 `x-permission-scopes`。
`requestId` 必須由 Gateway、Backend 或可信 tracing 機制產生或正規化；`x-request-id`
僅可作 tracing 與 audit correlation 用途，不得作身份、授權或 customer boundary 依據。
禁止以 prompt 指令、LLM 自我約束或前端邏輯取代後端安全檢查。

### C4 API 一致性與可嵌入性

所有 API、SDK、Widget、Host Integration contract 必須穩定、版本化且一致。HTTP response、
error response、requestId、streaming event、tool result schema 必須有統一格式與相容性
策略。

Identity Gateway 負責外部身份驗證與 canonical identity mapping；Backend 負責
customer-scoped authorization、orchestration、RAG、tool、approval 與 audit。SDK 與
Customer Host 可以安全傳輸既有登入憑證或 session、提供同源 BFF／reverse proxy、
pageContext 與操作輸入，但不得建立、覆寫或決定 canonical `customerId`、
`integrationId`、`organizationId`、`hostApp`、`actorId`、`roles` 或
`permissionScopes`。核心 domain 不得依賴特定宿主系統細節。

### C5 RAG 與工具品質可衡量

回答必須基於可追溯 evidence、tool result 或明確不確定狀態。RAG 不得只依賴單一
keyword matching；必須支援 query understanding、structured lookup、semantic retrieval、
reranking 或 clarification/no-answer gate 的升級路徑。

RAG 必須在檢索前套用 customer namespace/filter 與 permission filter，不得先檢索其他
Customer 的敏感資料再於回答階段過濾。涉及資料查詢的回答必須記錄或返回可追溯來源，
例如 entity id、document id、tool call id、timestamp。當 evidence 不足、互相矛盾、
權限不足或工具失敗時，必須回覆不確定或要求澄清，不得編造答案。

`ToolDefinition` 可以是全域產品契約；每個 Customer 的 tool 可用性、connector binding
與 permission policy 必須 customer-scoped。Connector credentials 與 connector binding
的具體實作不屬於本憲章 amendment 範圍，但未來實作必須遵守 Customer boundary。

### C6 全鏈路可稽核

每次對話、工具選擇、資料查詢、權限拒絕、RAG evidence、LLM 呼叫、操作建議、
confirmation、approval、handoff/escalation 都必須寫入 append-only audit event。

Audit event 必須至少能追溯 requestId、timestamp、customer、organization、host app、
actor、session/message、eventType、decision、toolCallId、riskLevel、permission result、
evidence refs 與 durationMs。敏感資料不得明文寫入一般 log，且原始 access token 或
internal identity JWT 不得寫入 log、audit 或 client response。

### C7 人工介入與主管審核

高風險請求不得由 AI 直接執行。AI 可以協助準備操作草稿、風險摘要、證據整理與建議，
但必須進入 confirmation、approval workflow 或 human handoff/escalation 後才能執行具
副作用或高風險操作。

delete、批次更新、財務/合約操作、權限變更、跨系統寫入、客戶敏感資料匯出預設為
高風險或 critical。審核流程必須記錄 requester、approver、risk level、requested action、
tool payload 摘要、決策、時間、理由與 requestId。

---

## Customer ownership hierarchy

- **Customer**：平台最外層資料所有權與安全隔離邊界。所有 customer-owned session、
  knowledge、retrieval、tool、approval、action、audit 與 feedback 流程都必須在
  customer scope 下執行。
- **Organization**：Customer 內的業務、公司或組織邊界；用於 Customer 內進一步的資料
  與權限限制，不可取代 `customerId`。
- **HostApp**：Customer 內整合助理的宿主應用識別；用於整合與授權範圍限制，不可取代
  `customerId` 或 `organizationId`。
- **Actor**：在 Customer、organization 與 host app 範圍下行動的已驗簽使用者；其授權
  由 `roles: string[]` 與 `permissionScopes` 表示。

文件可以將 Customer 說明為 multi-tenant security boundary，但 domain 與程式碼必須統一
使用 `Customer` / `customerId`，不得混用 `tenantId`。

---

## 資料與權限治理

**必須遵守：**

- 每個請求必須由已驗簽 internal identity JWT 解析 `customerId`、`integrationId`、
  `organizationId`、`hostApp`、`actorId`、`roles` 與 `permissionScopes`。`requestId`
  必須由 Gateway、Backend 或可信 tracing 機制產生或正規化。
- 所有 customer-owned repository / service 的建立、查詢、更新與刪除，必須在最前面套用
  customer scope；不得只以 global ID 存取 resource。
- 所有資料查詢、RAG retrieval、structured lookup、tool call、approval/action 與 audit
  流程必須先套用 customer scope，再套用 organization、host app、actor 與 permission filter。
- 一般 Assistant runtime、RAG、tool、approval、action 與使用者 API 一律不得跨 Customer
  存取；跨 Customer 資源存取必須回傳 not-found 或既定安全錯誤，且不得洩露資源是否存在。
- 若未來平台 control plane 確實需要跨 Customer 維運能力，必須使用獨立身份模型、獨立
  API boundary、明確授權與完整 audit；不得重用一般 Assistant runtime 路徑。
- 財務、合約、個資、客戶敏感欄位、內部備註等資料必須依權限與用途遮罩。
- 所有 connector secret、API key、token 必須由安全設定或 secret manager 注入，不得硬編碼。
- 企業內部資料不得用於外部模型訓練；LLM provider 設定與資料政策必須符合此要求。

**應遵守：**

- 權限模型應支援 Gateway 的 canonical identity mapping，而不是要求各 Customer Host 重建
  角色模型。
- 權限拒絕回覆應說明可行下一步，但不得揭露使用者無權查看的資料是否存在。

---

## Tool-First Assistant 原則

**必須遵守：**

- 涉及內部資料、狀態、統計、操作建議時，助理必須優先使用授權 tool/connector 取得
  evidence，不得憑模型記憶回答。
- 每個 tool 必須定義名稱、用途、input schema、output schema、權限需求、風險等級、
  side effect、audit event。
- 讀取型 tool 與寫入/操作型 tool 必須分離；寫入型 tool 不得在無 confirmation 或
  approval 時執行。
- 回答引用 tool result 時，必須保留 tool call id、輸入摘要、輸出摘要、資料來源與時間。
- 若任務需要多個工具或跨系統操作，任何一步失敗都必須停止後續副作用，並回報已完成與
  未完成步驟。

**應遵守：**

- Query understanding 應輸出 task type、entities、candidate tools、risk level、
  clarification needs。
- LLM 不應直接組裝未驗證 SQL 或任意 connector payload；必須通過 typed tool schema。

---

## 高風險操作、人工介入與主管審核

**必須遵守：**

- 高風險或 critical 請求必須建立 approval request，由具備授權的人員核准後才能執行。
- 中風險或具副作用操作必須要求使用者明確確認操作內容、範圍與影響。
- Approval workflow 至少必須支援 `pending`、`approved`、`rejected`、`expired`、
  `cancelled`。
- 當 AI 無法處理、權限不足、資料 owner 介入必要或政策要求人工處理時，必須能進入
  handoff/escalation，而不是靜默失敗。
- 高風險審核事件必須有完整 audit trail，包含決策者、決策時間、理由、風險等級與
  requestId。

**應遵守：**

- 高風險審核應支援 timeout/expiry，避免 pending request 無限期有效。
- 主管審核 UI 或 API 可以後續實作，但 domain model 與 audit event 不得封死擴充路徑。

---

## RAG 與工具品質門檻

**必須遵守：**

- RAG/query-understanding 重大改動必須對固定測試集執行回歸，涵蓋簡單、複雜、多條件、
  無結果與越權情境。
- Spec/design 必須定義命中率、no-answer precision、tool routing accuracy、citation
  coverage 或等價品質指標。
- RAG 結果必須在檢索前與 customer scope、organization scope 與 permission filter
  整合；不得先檢索敏感資料再於回答階段過濾。
- 對複雜問題應採 query planning、decomposition 或 multi-step tool use，不得只把完整
  問題丟給單一 keyword query。

**應遵守：**

- RAG evidence 應區分 Customer、資料來源、時間、權限範圍與可信度。
- Tool result 與 RAG evidence 衝突時，助理應回報衝突並要求澄清或人工介入。

---

## API 與嵌入式整合規範

**必須遵守：**

- 所有 HTTP API 必須使用一致 response/error/requestId 格式；錯誤碼與錯誤語意需
  版本化管理。
- REST/SSE/WebSocket/SDK contract 變更必須明確記錄相容性與 migration path。
- 前端 SDK/widget 不得包含 API key、connector secret、權限判斷邏輯、可信 identity
  mapping 或敏感 mapping。
- 若採 SSE/WebSocket streaming，每個 chunk 必須可關聯 session/message/requestId；錯誤
  與中止需有一致事件格式。
- 對外 API/SDK 必須定義版本策略；破壞性變更需有 MAJOR 版本或 migration window。

**應遵守：**

- SDK 應薄而穩定，主要負責渲染與傳輸；工具、權限、審核與資料查詢邏輯應留在 Backend。
- SDK 與 Customer Host 可經由既有登入憑證或 session、同源 BFF／reverse proxy 安全傳輸
  請求，但不得決定或覆寫 canonical identity claims。
- 不同宿主系統的差異應放在 connector/adapter，不應出現在核心 API contract。

---

## Definition of Done（DoD）

一個 task 或 user story 完成時，以下全部必須滿足：

- [ ] 符合對應 spec/design/plan 的驗收條件
- [ ] Service/domain 層業務規則已實作，不在 Controller 或 prompt 中硬塞規則
- [ ] 有對應 unit、integration、contract、e2e 或 regression 測試
- [ ] 涉及 customer-owned resource 時，已有至少兩個 Customer 的跨界隔離測試
- [ ] 涉及權限、工具、RAG、審核或 audit 的失敗路徑已測試
- [ ] API request/response/error 格式符合版本化 contract
- [ ] customer scope、權限檢查與資料遮罩已實作
- [ ] 高風險操作有 confirmation、approval 或 handoff/escalation 路徑
- [ ] Audit event 已記錄必要欄位
- [ ] RAG/tool answer 有 evidence 或明確 no-answer/clarification 行為
- [ ] 無硬編碼 secret、無未處理 Promise rejection、無不必要 `any` 型別

---

## Quality Gates

下列任一條件觸發即視為不可合併 / 不可上線：

- ❌ 以 prompt 文字取代後端身份驗證、權限檢查或資料遮罩
- ❌ 信任前端、SDK 或 Customer Host 提供的 identity header 或 customer boundary
- ❌ repository / service 只以 global ID 存取 customer-owned resource
- ❌ Tool/action 在未授權或未審核時執行副作用
- ❌ 高風險操作缺少 confirmation、approval 或 handoff/escalation
- ❌ 一般 Assistant runtime、RAG、tool、approval、action 或使用者 API 跨 Customer 存取
  資料
- ❌ 以一般 Assistant runtime 路徑實作跨 Customer 的平台 control plane 能力
- ❌ RAG 在 customer filter 前檢索其他 Customer 的資料
- ❌ RAG/tool 回答缺少 evidence，卻以確定語氣回答
- ❌ 沒有 no-answer / clarification gate，導致模型編造資料
- ❌ API contract 變更未更新 spec/contract tests
- ❌ Audit event 缺少 requestId、customer、actor、decision 或 timestamp
- ❌ 敏感資料、access token 或 internal identity JWT 明文寫入一般 log、audit 或前端 SDK
- ❌ 只測 happy path，未測跨 Customer、權限拒絕、工具失敗、審核拒絕、no-result
- ❌ Controller 直接承載核心業務邏輯

---

## 禁止事項（Non-Negotiable / Anti-Patterns）

以下行為嚴格禁止：

1. 不得把內部助理當成對外客服 chatbot 延伸，直接沿用 visitor/public knowledge 假設。
2. 不得讓 LLM 自行決定使用者是否有權查看或操作資料。
3. 不得把 host app 的資料模型直接耦合進 assistant core。
4. 不得讓寫入型 tool 與讀取型 tool 共用同一個無風險執行路徑。
5. 不得為了回答流暢而忽略 evidence 不足、資料矛盾或工具失敗。
6. 不得把高風險操作包裝成一般 chat 回覆而跳過審核。
7. 不得缺少 audit event 或只記錄最終答案。
8. SDK/widget 與 Customer Host 可以安全傳輸既有登入憑證或 session、提供同源
   BFF／reverse proxy，但不得放置 secret、建立或覆寫 canonical identity claims、
   customer boundary、權限決策或敏感 mapping。
9. 不得在未有 regression tests 的情況下修改 retrieval/query-understanding 核心行為。
10. 不得因趕進度降低 customer isolation、安全、測試、稽核或審核標準。

---

## Governance

本憲章高於所有 feature specs、design docs、plans、tasks 與實作慣例。若下層文件與本
憲章衝突，必須先修正下層文件或正式修訂本憲章。

**修訂程序：**

- 憲章修訂必須說明變更動機、影響範圍、版本升級理由與受影響模板。
- 原則刪除、產品使命改變、安全/權限/審核規則重定義，必須升 MAJOR。
- 新增原則、章節或品質門檻，必須升 MINOR。
- 文字修正、澄清或非語意調整，升 PATCH。
- 每次修訂必須更新 Sync Impact Report、版本與 Last Amended 日期。

**合規檢查：**

- 每個 `plan.md` 必須包含 Constitution Check，且在 Phase 0 前與 Phase 1 design 後各
  檢查一次。
- 每個 `spec.md` 必須明確列出 customer、organization、host app、actor、roles、
  permission scopes、tool/action risk、audit 與 human approval/escalation 需求。
- 每個 `tasks.md` 必須包含 customer isolation、身份與權限、安全、API contract、RAG
  品質、audit、高風險審核相關的測試或驗收工作。

**Version**: 2.0.0 | **Ratified**: 2026-06-11 | **Last Amended**: 2026-07-30
