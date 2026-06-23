<!--
Sync Impact Report
Version change: template -> 1.0.0
Modified principles:
- 原則一 placeholder -> C1 可維護架構優先
- 原則二 placeholder -> C2 測試先行與可回歸
- 原則三 placeholder -> C3 安全與權限不可繞過
- 原則四 placeholder -> C4 API 一致性與可嵌入性
- 原則五 placeholder -> C5 RAG 與工具品質可衡量
- 新增 C6 全鏈路可稽核
- 新增 C7 人工介入與主管審核
Added sections:
- 產品使命
- 資料與權限治理
- Tool-First Assistant 原則
- 高風險操作、人工介入與主管審核
- RAG 與工具品質門檻
- API 與嵌入式整合規範
- Definition of Done、Quality Gates、禁止事項
Removed sections:
- Speckit placeholder sections
Templates requiring updates:
- ⚠ .specify/templates/plan-template.md：尚未同步，本次只重建 constitution
- ⚠ .specify/templates/spec-template.md：尚未同步，本次只重建 constitution
- ⚠ .specify/templates/tasks-template.md：尚未同步，本次只重建 constitution
Follow-up TODOs: 後續可再執行 template sync，讓 speckit 產出的 plan/spec/tasks 自動套用本憲章檢查項目
-->

# 內部後台 AI 助理產品 Constitution

**版本**：1.0.0 | **Ratified**：2026-06-11 | **Last Amended**：2026-06-11

---

## 1. 文件目的

本文件為 `internal-ai-assistant.com` 內部後台 AI 助理產品的開發憲章，作為所有 `spec.md`、`design.md`、`plan.md`、`tasks.md` 與程式實作的最高約束依據。

本憲章規範可嵌入企業內部系統的 AI 工作助理後端、SDK/API、工具調用、資料查詢、審核流程與稽核要求。任何下層文件若與本憲章衝突，以本憲章為準，並必須先修正下層文件後才能進入實作。

---

## 2. 產品使命（Mission）

本產品是可嵌入 ERP、MES、WMS、SCM、CRM、客服後台、營運後台等不同企業內部系統的 AI 工作助理。它協助內部人員理解問題、查詢資料、整理證據、提出建議，並在授權範圍內準備或執行操作。

本產品不是對外客服 chatbot，也不得沿用對外客服的公開知識、匿名訪客、留資或客服轉接假設。內部助理面對的是具備身份與權限的企業內部使用者；產品部署與資料範圍以單一公司/組織為邊界，不預設由同一個大系統集中管理多家公司資料。所有資料查詢與操作都必須限制在該公司/組織內，並依據 actor、company/organization boundary、host app、role 與 permission scope 進行約束。

核心使命原則：**AI 只能在可驗證、可授權、可稽核的範圍內協助工作；高風險操作必須交由人確認或審核。**

---

## Core Principles

### C1 可維護架構優先

所有功能必須以清楚 bounded context、Service/domain 層業務規則、可替換 LLM/tool/retrieval 介面實作。Controller 只負責請求邊界、DTO 驗證與回應，不得承載核心業務邏輯。

系統必須把 assistant core、tool registry、connector、retrieval、approval、audit、host integration 分成清楚模組。ERP、MES、WMS、SCM、CRM 等宿主系統差異必須放在 connector/adapter 層，不得污染核心對話與決策流程。

### C2 測試先行與可回歸

核心服務、工具調用、權限、RAG、審核流程、安全防護必須有可執行測試。高風險與失敗路徑不得只測 happy path。

任何涉及 query understanding、tool routing、permission check、risk classification、approval workflow、audit logging、RAG/no-answer gate 的功能，必須具備 unit、integration、contract、e2e 或 regression tests。新增或修改 retrieval/query-understanding 時，必須更新或執行 eval dataset 與 no-answer regression。

### C3 安全與權限不可繞過

所有內部資料查詢與工具操作必須先驗證 actor、company/organization boundary、host app、role、permission scope。禁止以 prompt 指令、LLM 自我約束或前端 SDK 邏輯取代後端安全檢查。

任何 connector/tool 在執行前必須完成權限檢查；不得先查資料再由 LLM 決定是否可用。跨公司或跨組織邊界存取資料必須預設禁止，除非有明確系統級授權、政策依據與 audit 記錄。

### C4 API 一致性與可嵌入性

所有 API、SDK、Widget、Host Integration contract 必須穩定、版本化且一致。HTTP response、error response、requestId、streaming event、tool result schema 必須有統一格式與相容性策略。

核心 domain 不得依賴特定宿主系統細節。Host app 必須明確傳遞 organization boundary、actor、role、permission scope；助理不得自行猜測身份或權限。

### C5 RAG 與工具品質可衡量

回答必須基於可追溯 evidence、tool result 或明確不確定狀態。RAG 不得只依賴單一 keyword matching；必須支援 query understanding、structured lookup、semantic retrieval、reranking 或 clarification/no-answer gate 的升級路徑。

涉及資料查詢的回答必須記錄或返回可追溯來源，例如 entity id、document id、tool call id、timestamp。當 evidence 不足、互相矛盾、權限不足或工具失敗時，必須回覆不確定或要求澄清，不得編造答案。

### C6 全鏈路可稽核

每次對話、工具選擇、資料查詢、權限拒絕、RAG evidence、LLM 呼叫、操作建議、confirmation、approval、handoff/escalation 都必須寫入 append-only audit event。

Audit event 必須至少能追溯 requestId、timestamp、company/organization boundary、host app、actor、session/message、eventType、decision、toolCallId、riskLevel、permission result、evidence refs 與 durationMs。敏感資料不得明文寫入一般 log。

### C7 人工介入與主管審核

高風險請求不得由 AI 直接執行。AI 可以協助準備操作草稿、風險摘要、證據整理與建議，但必須進入 confirmation、approval workflow 或 human handoff/escalation 後才能執行具副作用或高風險操作。

delete、批次更新、財務/合約操作、權限變更、跨系統寫入、客戶敏感資料匯出預設為高風險或 critical。審核流程必須記錄 requester、approver、risk level、requested action、tool payload 摘要、決策、時間、理由與 requestId。

---

## 資料與權限治理

**必須遵守：**

- 每個請求必須攜帶或解析 actor、company/organization boundary、host app、role、permission scope、requestId。
- 所有資料查詢、RAG retrieval、structured lookup、tool call 必須先套用 company/organization boundary 與 permission filter。
- 財務、合約、個資、客戶敏感欄位、內部備註等資料必須依權限與用途遮罩。
- 所有 connector secret、API key、token 必須由安全設定或 secret manager 注入，不得硬編碼。
- 企業內部資料不得用於外部模型訓練；LLM provider 設定與資料政策必須符合此要求。

**應遵守：**

- 權限模型應支援 host app 傳入既有 RBAC/ABAC context，而不是要求每個宿主系統重建角色模型。
- 權限拒絕回覆應說明可行下一步，但不得揭露使用者無權查看的資料是否存在。

---

## Tool-First Assistant 原則

**必須遵守：**

- 涉及內部資料、狀態、統計、操作建議時，助理必須優先使用授權 tool/connector 取得證據，不得憑模型記憶回答。
- 每個 tool 必須定義名稱、用途、input schema、output schema、權限需求、風險等級、side effect、audit event。
- 讀取型 tool 與寫入/操作型 tool 必須分離；寫入型 tool 不得在無 confirmation 或 approval 時執行。
- 回答引用 tool result 時，必須保留 tool call id、輸入摘要、輸出摘要、資料來源與時間。
- 若任務需要多個工具或跨系統操作，任何一步失敗都必須停止後續副作用，並回報已完成與未完成步驟。

**應遵守：**

- Query understanding 應輸出 task type、entities、candidate tools、risk level、clarification needs。
- LLM 不應直接組裝未驗證 SQL 或任意 connector payload；必須通過 typed tool schema。

---

## 高風險操作、人工介入與主管審核

**必須遵守：**

- 高風險或 critical 請求必須建立 approval request，由具備授權的人員核准後才能執行。
- 中風險或具副作用操作必須要求使用者明確確認操作內容、範圍與影響。
- Approval workflow 至少必須支援 `pending`、`approved`、`rejected`、`expired`、`cancelled`。
- 當 AI 無法處理、權限不足、資料 owner 介入必要或政策要求人工處理時，必須能進入 handoff/escalation，而不是靜默失敗。
- 高風險審核事件必須有完整 audit trail，包含決策者、決策時間、理由、風險等級與 requestId。

**應遵守：**

- 高風險審核應支援 timeout/expiry，避免 pending request 無限期有效。
- 主管審核 UI 或 API 可以後續實作，但 domain model 與 audit event 不得封死擴充路徑。

---

## RAG 與工具品質門檻

**必須遵守：**

- RAG/query-understanding 重大改動必須對固定測試集執行回歸，涵蓋簡單、複雜、多條件、無結果與越權情境。
- Spec/design 必須定義命中率、no-answer precision、tool routing accuracy、citation coverage 或等價品質指標。
- RAG 結果必須與權限過濾整合；不得先檢索敏感資料再於回答階段過濾。
- 對複雜問題應採 query planning、decomposition 或 multi-step tool use，不得只把完整問題丟給單一 keyword query。

**應遵守：**

- RAG evidence 應區分資料來源、時間、權限範圍與可信度。
- Tool result 與 RAG evidence 衝突時，助理應回報衝突並要求澄清或人工介入。

---

## API 與嵌入式整合規範

**必須遵守：**

- 所有 HTTP API 必須使用一致 response/error/requestId 格式；錯誤碼與錯誤語意需版本化管理。
- REST/SSE/WebSocket/SDK contract 變更必須明確記錄相容性與 migration path。
- 前端 SDK/widget 不得包含 API key、connector secret、權限判斷邏輯或敏感 mapping。
- 若採 SSE/WebSocket streaming，每個 chunk 必須可關聯 session/message/requestId；錯誤與中止需有一致事件格式。
- 對外 API/SDK 必須定義版本策略；破壞性變更需有 MAJOR 版本或 migration window。

**應遵守：**

- SDK 應薄而穩定，主要負責渲染與傳輸；工具、權限、審核與資料查詢邏輯應留在 backend。
- 不同宿主系統的差異應放在 connector/adapter，不應出現在核心 API contract。

---

## Definition of Done（DoD）

一個 task 或 user story 完成時，以下全部必須滿足：

- [ ] 符合對應 spec/design/plan 的驗收條件
- [ ] Service/domain 層業務規則已實作，不在 Controller 或 prompt 中硬塞規則
- [ ] 有對應 unit、integration、contract、e2e 或 regression 測試
- [ ] 涉及權限、工具、RAG、審核或 audit 的失敗路徑已測試
- [ ] API request/response/error 格式符合版本化 contract
- [ ] 權限檢查與資料遮罩已實作
- [ ] 高風險操作有 confirmation、approval 或 handoff/escalation 路徑
- [ ] Audit event 已記錄必要欄位
- [ ] RAG/tool answer 有 evidence 或明確 no-answer/clarification 行為
- [ ] 無硬編碼 secret、無未處理 Promise rejection、無不必要 `any` 型別

---

## Quality Gates

下列任一條件觸發即視為不可合併 / 不可上線：

- ❌ 以 prompt 文字取代後端權限檢查或資料遮罩
- ❌ Tool/action 在未授權或未審核時執行副作用
- ❌ 高風險操作缺少 confirmation、approval 或 handoff/escalation
- ❌ 跨公司或跨組織邊界存取資料且無明確授權與 audit
- ❌ RAG/tool 回答缺少 evidence，卻以確定語氣回答
- ❌ 沒有 no-answer / clarification gate，導致模型編造資料
- ❌ API contract 變更未更新 spec/contract tests
- ❌ Audit event 缺少 requestId、actor、decision 或 timestamp
- ❌ 敏感資料明文寫入一般 log 或前端 SDK
- ❌ 只測 happy path，未測權限拒絕、工具失敗、審核拒絕、no-result
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
8. 不得在 SDK/widget 內放置 secret、權限決策或敏感 mapping。
9. 不得在未有 regression tests 的情況下修改 retrieval/query-understanding 核心行為。
10. 不得因趕進度降低安全、測試、稽核或審核標準。

---

## Governance

本憲章高於所有 feature specs、design docs、plans、tasks 與實作慣例。若下層文件與本憲章衝突，必須先修正下層文件或正式修訂本憲章。

**修訂程序：**

- 憲章修訂必須說明變更動機、影響範圍、版本升級理由與受影響模板。
- 原則刪除、產品使命改變、安全/權限/審核規則重定義，必須升 MAJOR。
- 新增原則、章節或品質門檻，必須升 MINOR。
- 文字修正、澄清或非語意調整，升 PATCH。
- 每次修訂必須更新 Sync Impact Report、版本與 Last Amended 日期。

**合規檢查：**

- 每個 `plan.md` 必須包含 Constitution Check，且在 Phase 0 前與 Phase 1 design 後各檢查一次。
- 每個 `spec.md` 必須明確列出 actor/role/permission、company/organization/host app scope、tool/action risk、audit 與 human approval/escalation 需求。
- 每個 `tasks.md` 必須包含與權限、安全、API contract、RAG 品質、audit、高風險審核相關的測試或驗收工作。

**Version**: 1.0.0 | **Ratified**: 2026-06-11 | **Last Amended**: 2026-06-11
