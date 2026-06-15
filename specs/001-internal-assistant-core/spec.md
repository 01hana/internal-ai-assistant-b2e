# Feature Specification: 內部後台 AI 助理核心

**Feature Branch**: `001-internal-assistant-core`

**Created**: 2026-06-11

**Status**: Draft

**Input**: User description: "建立可嵌入 ERP / MES / WMS / SCM / CRM 等企業內部系統的後台 AI 助理核心規格，支援授權查詢、工具調用、RAG/evidence-grounded answer、高風險操作審核、全鏈路稽核與一致 API contract。"

## Internal Assistant Context *(mandatory by Constitution)*

本功能定義 `ai-assistant.com` 的第一個核心能力：可嵌入企業內部系統的 AI 工作助理。它不是對外客服 chatbot，也不處理匿名訪客、公眾知識庫、留資或客服轉接假設。使用者是具備身份、角色與權限的企業內部人員。

每次請求都必須限制在單一公司/組織邊界內，並依據宿主系統傳入的 host app、actor、role、permission scope 執行查詢、工具調用與回答生成。第一版不綁定特定 ERP / MES / WMS / SCM / CRM 的資料模型，而是先建立可被不同宿主系統接入的 assistant core、tool contract、evidence contract、approval workflow 與 audit trail。

### Actor / Role / Permission Assumptions

- **Actor**：已登入宿主系統的企業內部使用者。
- **Role**：由宿主系統提供，例如管理者、業務、採購、倉管、生管、客服主管、財務、系統管理員。
- **Permission Scope**：由宿主系統提供，可限制資料範圍、功能模組、欄位可見性與可執行操作。
- **Company / Organization Boundary**：所有查詢與操作都只在同一公司/組織資料範圍內執行；不設計大型 SaaS 多公司集中管理模型。
- **Host App**：ERP / MES / WMS / SCM / CRM 或其他企業內部系統，負責傳入身份與權限上下文。

### Tool / Action Risk Model

- **Low risk**：只讀查詢、摘要、分類、狀態說明，不產生副作用。
- **Medium risk**：準備操作草稿、產生建議、排程預覽、需使用者確認後才可執行的單筆變更。
- **High risk**：刪除、批次更新、財務/合約操作、權限變更、敏感資料匯出、跨系統寫入，必須進入主管審核或人工介入流程。
- **Critical risk**：可能造成重大財務、法務、資安或營運影響的操作，AI 不得直接執行，只能整理資訊、提出建議與建立審核請求。

### Audit And Evidence Requirements

每次對話、工具選擇、權限檢查、工具結果、RAG evidence、LLM decision、no-answer、clarification、approval、escalation 與 review 都必須形成可追溯 audit event。回答若引用內部資料，必須能追溯到 evidence refs、tool call id、資料來源、查詢時間與權限檢查結果。此處的 escalation 是內部企業流程的廣義升級處理，可包含 `EscalationRequest`、`ApprovalRequest` 或 `ReviewItem`，不得被理解為對外客服轉接。

### Assistant Context State

系統必須維護 `AssistantContextState`，讓助理能理解連續對話與宿主畫面脈絡。此狀態至少必須追蹤 current task、current module/page、current entity type/id、last intent、last entities、last tool calls、last evidence refs、pending clarification、pending approval request 與 task state。

`AssistantContextState` 不得取代權限檢查；任何從上下文延續而來的 entity、tool 或 evidence，在再次使用前仍必須套用公司/組織邊界與權限規則。

### PageContext / ScreenContext

每次 assistant request 可以包含宿主系統目前畫面脈絡，包含 host module、route 或 screenId、entityType、entityId、selectedRows、activeFilters、visibleColumns 與 user-visible page state。這些資料用來理解「這筆資料」、「這張訂單」、「目前這個工單」、「剛剛選取的幾筆」等代稱。

若使用者問題依賴畫面脈絡，但 request 未提供足夠 `PageContext` / `ScreenContext`，系統必須要求澄清，不得自行猜測 entity 或套用上一個不可靠的 context。

### Execution Planning

在 retrieval、tool execution 或 answer generation 前，系統必須產生 `ExecutionPlan`。計畫必須描述 taskType、requiredEvidence、candidateTools、permissionChecks、riskAssessment、clarificationNeeds、expectedAnswerShape，以及是否需要 multi-step tool use。

若 `ExecutionPlan` 判定 evidence 不足、權限不足、風險過高或需要澄清，系統必須先進入 clarification、no-answer、confirmation、approval 或 escalation/review 流程，不得直接執行工具或產生確定答案。


## Core Features

1. **嵌入式內部助理對話核心**：讓內部使用者能在宿主系統中提問、追問、取得摘要、建議與可追溯答案。
2. **公司/組織邊界與身份上下文**：每次請求必須帶入 host app、actor、role、permission scope、requestId，所有查詢限制在同一公司/組織內。
3. **Tool-First 查詢與操作架構**：建立 tool registry、tool schema、risk level、permission requirements，讀取型工具與寫入/操作型工具分離。
4. **Query Understanding 與工具路由**：解析使用者問題的任務類型、實體、條件、候選工具、風險等級與是否需要澄清。
5. **RAG / Structured Lookup / Evidence Grounding**：回答必須基於工具結果、結構化查詢或文件 evidence，並回傳可追溯來源。
6. **No-answer / Clarification Gate**：當 evidence 不足、問題模糊、權限不足或工具失敗時，不得編造答案，必須要求澄清或明確說明無法回答。
7. **高風險操作確認與主管審核**：刪除、批次更新、財務/合約、權限變更、跨系統寫入等操作不得由 AI 直接執行，必須進入 confirmation 或 approval workflow。
8. **全鏈路 Audit Trail**：記錄對話、tool selection、permission check、tool result、RAG evidence、LLM decision、approval/escalation/review 等事件。
9. **一致 API Contract**：定義 session/message、chat request/response、SSE streaming event、error/requestId、approval request 的規格方向，後續 design/plan 再落地。AI 回覆必須以 SSE 作為即時串流通道。
10. **Context-Aware Assistance**：使用 `AssistantContextState` 與 `PageContext` / `ScreenContext` 理解目前頁面、選取資料、上一輪意圖與待處理任務。
11. **Execution Planning**：在檢索、工具執行或回答生成前產生可稽核的 `ExecutionPlan`，明確描述證據、工具、權限、風險、澄清需求與回答形狀。
12. **Feedback / Review Loop**：支援 message-level feedback，並能從失敗查詢、no-answer、工具失敗、負評、證據不足、工具路由錯誤或權限 mapping 問題建立 `ReviewItem`。
13. **Session History Restore**：支援使用者重新打開 AI 助理聊天視窗時取得既有會話摘要與歷史訊息，並在查詢 history 時重新套用 actor、host app、company/organization boundary 與 permission scope。

## Intelligent Assistant Capability Requirements

本產品必須以「企業內部智能助理」能力來驗收，而不是只驗收一般聊天或 FAQ 回覆。以下能力必須在 design、plan、tasks 與測試中被轉成可量測指標。

- **24/7 服務時間**：系統必須支援全天候可用、健康檢查、錯誤降級、重試、timeout、監控與告警。當 LLM、retrieval 或 connector 不可用時，系統必須安全降級並回覆可行下一步。
- **高語意理解能力**：系統必須支援語意理解、NLP、intent/task classification、entity extraction、context resolution、query decomposition 與 clarification，不得只依賴 keyword matching。
- **高併發處理量能**：系統必須能支援同時大量內部使用者與多個宿主系統請求，並具備排隊、backpressure、rate limit、streaming timeout 與資源隔離策略。
- **自然且可持續優化的回覆品質**：回答必須自然、精確、符合企業語境，並以 evidence、feedback、review item 與 eval dataset 持續改善。
- **降低人力成本**：系統應提升自助解決率，減少人工查資料、整理報表、判讀 SOP、跨系統比對與例行問題處理成本；但不得用自動化繞過權限、審核或安全要求。
- **中高複雜問題處理能力**：系統必須能處理多條件、多步驟、跨模組問題；超出能力、權限或風險範圍時，必須進入 clarification、no-answer、`EscalationRequest`、`ApprovalRequest` 或 `ReviewItem`。
- **深度數據洞察與自動分類**：系統必須能對對話、意圖、工具調用、失敗原因、權限阻擋、熱門問題、負評與 review items 做分類與分析，支援後續營運改善。
- **受控的 AI-assisted improvement**：系統可以輔助產生知識、工具 routing、prompt、eval case 或權限 mapping 的改善建議，但任何會影響正式回答、工具執行或權限規則的變更都必須經人工審核後才能上線。

## Chinese Query Understanding Requirements

系統必須支援繁體中文斷詞/斷句 pipeline，並在 `ExecutionPlan` 產生前完成 query understanding。此 pipeline 不得綁定單一 package；tokenizer 必須透過可替換 adapter 實作，未來可接入 jieba、CKIP、HanLP 或其他 tokenizer。

必要能力包含：

- **繁體中文斷句**：拆分多句、多條件與連續指令，例如「幫我看這張訂單有沒有欠料，順便查客戶近三個月出貨」。
- **分詞 / 片語抽取**：抽出業務詞、欄位詞、操作詞、數量詞、時間詞與常見片語。
- **同義詞與企業術語 normalization**：將企業內部用語、縮寫、欄位別名與同義詞正規化，例如「工單 / 製令」、「料號 / 品號」、「客戶 / 客戶資料」。
- **時間範圍解析**：解析「今天」、「上週」、「近三個月」、「今年 Q2」、「昨天到今天」等相對或絕對時間範圍。
- **代詞/指示詞解析**：結合 `PageContext` 與 `AssistantContextState` 解析「這筆」、「這張」、「目前」、「剛剛選取」等指示詞。
- **多意圖拆解**：將複合問題拆成多個可執行子任務，並保留子任務間依賴順序。
- **實體候選抽取**：抽出 orderId、workOrderId、itemNo、customerId、supplierId、date range、selectedRows 等候選實體。
- **信心分數與澄清條件**：當分詞、實體、時間、代詞解析或多意圖拆解信心不足，或候選實體互相衝突時，必須要求澄清。

Pipeline output 必須可被保存、稽核、debug 與 eval 使用，至少包含 sentences、tokens、phrases、normalizedTerms、timeRanges、resolvedReferences、entityCandidates、subTasks、confidence 與 clarificationNeeds。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 取得有 evidence 的授權答案 (Priority: P1)

企業內部使用者在 ERP / MES / WMS / SCM / CRM 等宿主系統中開啟 AI 助理，詢問與自身權限相關的資料問題。系統必須根據使用者身份、角色與權限範圍查詢可用資料，產生有 evidence refs 的回答，並記錄完整 audit event。

**Why this priority**: 這是內部助理的最小可用價值；若不能安全且可追溯地回答內部資料問題，就無法成為可嵌入企業系統的產品。

**Independent Test**: 可用一個 mock host app context、mock tool result 與 mock evidence store 測試。授權使用者提出查詢後，回應必須包含答案、evidence refs、requestId，且 audit log 可追溯 tool call 與 permission result。

**Acceptance Scenarios**:

1. **Given** 使用者具有查詢指定資料的權限，**When** 使用者詢問資料狀態或摘要，**Then** 系統回覆 grounded answer，並包含 evidence refs 與 requestId。
2. **Given** 使用者只能查看部分資料欄位，**When** 使用者詢問包含敏感欄位的資料，**Then** 系統只回覆授權欄位，敏感欄位不得出現在回答或一般 log 中。
3. **Given** tool result 與 RAG evidence 來源不同，**When** 系統產生回答，**Then** 回答必須標示或保留可追溯來源，不得以模型記憶取代 evidence。

---

### User Story 2 - 根據權限安全調用工具 (Priority: P2)

企業內部使用者提出需要查詢或整理資料的問題時，AI 助理必須先理解任務，再選擇合適 tool。任何 tool 執行前都必須檢查 actor、host app、role、permission scope 與公司/組織邊界。

**Why this priority**: Tool-first 是內部助理可信任的基礎；若工具調用不受權限控制，AI 助理會成為資料外洩與越權操作入口。

**Independent Test**: 可建立 tool registry、permission policy 與 mock connector。測試授權 tool 可執行，未授權 tool 在執行前被拒絕，且拒絕事件被 audit。

**Acceptance Scenarios**:

1. **Given** 使用者具備某 read tool 權限，**When** 助理選擇該 tool 查詢資料，**Then** tool 執行成功且回傳 tool call id。
2. **Given** 使用者不具備某 tool 權限，**When** 助理判斷該 tool 可能有助回答，**Then** 系統必須在 tool 執行前拒絕，並回覆權限不足的安全訊息。
3. **Given** 使用者問題可能需要跨模組查詢，**When** 部分工具權限不足，**Then** 系統只能使用授權工具，並清楚說明回答範圍限制。

---

### User Story 3 - 高風險操作建立審核請求 (Priority: P3)

企業內部使用者要求 AI 助理執行刪除、批次更新、財務/合約、權限變更、敏感資料匯出或跨系統寫入時，系統不得直接執行。AI 可以整理操作草稿、影響範圍、風險摘要與 evidence，並建立 approval request。

**Why this priority**: 內部助理會接近企業核心資料與操作流程；高風險操作必須有人類確認或主管審核，否則產品不可上線。

**Independent Test**: 可用一個 high-risk action request 測試。系統應建立 pending approval request，不執行實際 tool action，並產生 audit event。

**Acceptance Scenarios**:

1. **Given** 使用者要求批次更新資料，**When** 系統判斷為 high risk，**Then** 系統建立 approval request，狀態為 `pending`，且不得執行寫入 tool。
2. **Given** approval request 被主管核准，**When** 系統收到核准事件，**Then** 後續執行流程必須能追溯 requester、approver、決策、時間、理由與 requestId。
3. **Given** approval request 被拒絕或逾期，**When** 使用者查看結果，**Then** 系統不得執行操作，並回覆拒絕或逾期狀態。

---

### User Story 4 - 無權限、無證據或問題模糊時正確拒答或澄清 (Priority: P4)

當使用者問題模糊、缺少必要條件、查無 evidence、工具失敗或權限不足時，AI 助理必須要求澄清、說明限制或回覆 no-answer，不得編造資料。

**Why this priority**: 這是 RAG 與工具品質的安全閥；沒有 no-answer / clarification gate，內部助理會在複雜問題下產生誤導性回答。

**Independent Test**: 可用 ambiguous query、no-result query、tool failure、permission denied 四種情境測試。每種情境都不得產生無根據答案，且必須有 audit event。

**Acceptance Scenarios**:

1. **Given** 使用者問題缺少查詢條件，**When** 系統無法安全判斷查詢目標，**Then** 系統要求澄清必要條件。
2. **Given** retrieval 與 tool lookup 都沒有結果，**When** 系統無 evidence 可回答，**Then** 系統回覆 no-answer，不得猜測。
3. **Given** tool 發生錯誤，**When** 系統無法取得可靠資料，**Then** 系統回覆工具失敗與可行下一步，並記錄錯誤 audit event。

### Edge Cases

- 使用者問題同時涉及多個宿主系統模組，但只有部分模組授權。
- 使用者要求查詢敏感資料，但權限只允許查看摘要或遮罩後欄位。
- 使用者要求 AI 直接執行高風險操作，例如批次刪除、匯出客戶敏感資料或變更權限。
- Tool result 與 RAG evidence 互相矛盾。
- Query understanding 無法判斷 task type 或候選工具。
- Retrieval 命中資料但 evidence coverage 不足以回答完整問題。
- Approval request 長時間未處理、被拒絕、被取消或逾期。
- 相同 requestId 重送，系統必須避免重複執行副作用操作。
- Host app 未傳入必要 actor 或 permission context，系統必須拒絕處理。
- 使用者在訂單頁問「這張訂單目前狀態？」且 `PageContext` 有 order id，系統必須使用 structured lookup 或 connector，而不是 RAG 猜測。
- 使用者在工單頁問「目前這個工單進度？」且具備權限，系統必須使用工單工具取得即時進度 evidence。
- 使用者查詢某料號庫存，系統必須使用 inventory connector 或 structured lookup，不得假設庫存資料已進入 vector search。
- 使用者要求摘要客戶或供應商歷史，系統必須依權限查詢結構化資料與必要文件 evidence。
- 使用者問「這筆資料」但 request 缺少足夠 page context，系統必須要求澄清。
- 使用者要求批次更新或敏感資料匯出，系統必須建立 `ApprovalRequest` 或 `EscalationRequest`，不得直接執行。
- Tool result 與文件 evidence 矛盾時，系統必須說明衝突，要求澄清或建立 `ReviewItem`。
- 使用者對回答給予負評時，系統必須能關聯原始 request、message、tool calls、evidence refs 與 audit events。
- 使用者打開聊天視窗但 session 已過期、已關閉或不存在，系統必須回傳一致錯誤或要求建立新 session。
- 使用者嘗試讀取不屬於自己 actor、host app 或 company/organization boundary 的 session history，系統必須拒絕。
- Message history 包含敏感欄位、evidence summary 或 tool status summary 時，回傳前必須依 permission / masking 規則處理。
- Pagination cursor 無效或過期時，系統必須回傳一致錯誤格式，不得回傳錯誤範圍的 history。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系統必須提供 assistant conversation/session 能力，支援建立會話、送出訊息、保存訊息、回傳回答與關聯 requestId。
- **FR-001a**: 系統必須提供 assistant message history retrieval 能力，支援使用者依 sessionId 取得歷史訊息列表，並支援 pagination/cursor。回傳內容必須包含 requestId、sessionId、messageId、role、content、answerDecision、createdAt，以及必要的 evidence summary / tool status summary。
- **FR-001b**: 系統必須定義使用者打開 AI 助理時的 session restore strategy。v1 採用 host app 或前端保存 sessionId 的簡單策略：有 sessionId 時呼叫 `GET /assistant/sessions/:id` 與 `GET /assistant/sessions/:id/messages` 讀取 session summary 與 message history；沒有 sessionId 時呼叫 `POST /assistant/sessions` 建立新 session。更進階的 active session resolve 保留為後續擴充，不強制納入第一階段 MVP。
- **FR-002**: 每次 assistant request 必須包含或解析 host app、actor、role、permission scope、company/organization boundary 與 requestId；缺少必要上下文時必須拒絕處理。
- **FR-003**: 系統必須在所有資料查詢、RAG retrieval、structured lookup 與 tool call 前套用公司/組織邊界與 permission filter。
- **FR-004**: 系統必須提供 tool registry，描述 tool name、purpose、input schema、output schema、required permissions、risk level、side effect 與 audit behavior。
- **FR-005**: 系統必須區分 read-only tool 與 side-effect tool；side-effect tool 不得與 read-only tool 共用無審核執行路徑。
- **FR-006**: 系統必須提供 query understanding 流程，至少產出 task type、entities、candidate tools、risk level、clarification needs 與 evidence needs。
- **FR-007**: 系統必須支援 evidence-grounded answer，回答需基於 tool result、structured lookup 或 RAG evidence，並可追溯 evidence refs。
- **FR-008**: 系統必須提供 no-answer / clarification gate；當 evidence 不足、權限不足、問題模糊、工具失敗或資料矛盾時，不得編造答案。
- **FR-009**: 系統必須對 high risk / critical action 建立 approval request 或 escalation/review，不得由 AI 直接執行。
- **FR-010**: 系統必須支援 approval request 狀態：`pending`、`approved`、`rejected`、`expired`、`cancelled`。
- **FR-011**: 系統必須對 medium risk 或具副作用但非 high risk 的操作要求明確 confirmation，確認前不得執行。
- **FR-012**: 系統必須記錄 append-only audit event，涵蓋對話、工具選擇、權限檢查、tool result、RAG evidence、LLM decision、no-answer、clarification、approval 與 escalation/review。
- **FR-013**: Audit event 必須能追溯 requestId、timestamp、company/organization boundary、host app、actor、session/message、eventType、decision、toolCallId、riskLevel、permission result、evidence refs 與 durationMs。
- **FR-014**: 系統必須提供一致 API response、error response、requestId 與 SSE streaming event contract；AI 回覆的即時輸出必須使用 SSE，不以 WebSocket 作為 v1 回覆通道。
- **FR-015**: 系統不得在 SDK、前端或 prompt 中放置權限決策、connector secret、API key 或敏感 mapping。
- **FR-016**: 系統必須支援 connector/adapter 抽象，讓 ERP / MES / WMS / SCM / CRM 等宿主系統差異留在 adapter 層，不污染 assistant core。
- **FR-017**: 系統必須支援敏感資料遮罩或欄位過濾，未授權資料不得出現在 answer、stream chunk、audit detail 或一般 log 中。
- **FR-018**: 系統必須能在工具或 retrieval 失敗時回覆可行下一步，並記錄失敗原因與相關 requestId。
- **FR-019**: 系統必須能防止同一高風險或具副作用 request 因重送而被重複執行。
- **FR-020**: 系統必須保留未來接入不同 LLM provider、retrieval provider、tool connector 與 approval backend 的替換空間。
- **FR-020a**: v1 LLM provider 預設使用 `OpenAiProvider`，且此 provider 屬於 LLM layer，不屬於 ERP / MES / WMS / SCM / CRM connector。Provider 必須透過 `LLM_PROVIDER` 環境變數選擇，v1 支援值為 `openai`；模型必須透過 `LLM_MODEL` 環境變數切換，不得硬寫死在 controller、service、prompt 或業務邏輯中。OpenAI credential 使用 provider-specific `OPENAI_API_KEY`，未來新增 provider 時應新增各自 credential env。建議模型設定為主力/demo `gpt-5.4-mini`、高品質測試 `gpt-5.4`、廉價快速/fallback `gpt-5.4-nano`。
- **FR-021**: 系統必須維護 `AssistantContextState`，至少追蹤 current task、current module/page、current entity type/id、last intent、last entities、last tool calls、last evidence refs、pending clarification、pending approval request 與 task state。
- **FR-022**: 每次 assistant request 必須支援可選的 `PageContext` / `ScreenContext`，包含 host module、route 或 screenId、entityType、entityId、selectedRows、activeFilters、visibleColumns 與 user-visible page state。
- **FR-023**: 當使用者使用「這筆資料」、「這張訂單」、「目前這個工單」、「剛剛選取的幾筆」等代稱時，系統必須先使用 page/screen context 解析目標；若上下文不足，必須要求澄清。
- **FR-024**: 系統必須在 retrieval、tool execution 或 answer generation 前產生 `ExecutionPlan`，內容包含 taskType、requiredEvidence、candidateTools、permissionChecks、riskAssessment、clarificationNeeds、expectedAnswerShape 與 multi-step tool use 判斷。
- **FR-025**: 文件、SOP、政策、欄位說明與操作手冊必須優先使用 RAG；訂單、庫存、工單、客戶、供應商、報價、交易等即時業務資料必須使用 backend tools、structured lookup 或 connectors。
- **FR-026**: 系統不得假設所有業務資料都應被 embedding 到 vector search；live business data 的查詢正確性必須以授權 connector 或結構化查詢為主。
- **FR-027**: 權限模型必須支援 module-level、operation-level、row-level、field-level permission filtering，以及 data masking 與 output filtering。
- **FR-028**: 未授權欄位必須在 tool result 或 structured lookup result 交給 LLM 前移除或遮罩，不得只在最終回答後處理。
- **FR-029**: 系統必須支援 message-level feedback，並關聯 requestId、messageId、intent、tool calls、evidence refs、answer decision 與 audit events。
- **FR-030**: 系統必須能從 failed queries、no-answer cases、tool failures、negative feedback、missing evidence、bad tool routing 或 permission mapping issues 建立 `ReviewItem`。
- **FR-031**: 系統必須使用 `EscalationRequest`、`ApprovalRequest` 與 `ReviewItem` 表達內部升級、審核與改善流程；`handoff` 若出現，只能作為廣義 escalation 類型，不得暗示對外客服轉接。
- **FR-032**: 系統必須支援 24/7 服務能力所需的 health check、readiness check、dependency status、timeout、retry、safe degradation 與告警事件。
- **FR-033**: 系統必須記錄並輸出 semantic understanding 結果，至少包含 intent/task classification、entities、context resolution、query decomposition、confidence 與 clarification decision。
- **FR-034**: 系統必須支援高併發請求的 queue、backpressure、rate limit、streaming timeout 與資源隔離設計，避免單一宿主系統或大型查詢拖垮整體服務。
- **FR-035**: 系統必須支援回答品質評估資料，包含 answer decision、evidence coverage、citation coverage、feedback score、negative feedback reason 與 review outcome。
- **FR-036**: 系統必須提供營運洞察資料，至少能分類與統計 intents、task types、tool calls、tool failures、no-answer reasons、permission denials、approval requests、review items 與高頻問題。
- **FR-037**: 系統必須支援 AI-assisted improvement 建議，例如知識缺口、工具 routing 改善、prompt/eval case 建議或權限 mapping 問題；這些建議不得自動套用到正式環境，必須經人工審核。
- **FR-038**: 系統必須支援 automation efficiency metrics，包含自助解決率、人工介入率、approval rate、review item close rate、重複問題減少率與平均處理時間。
- **FR-039**: 系統必須在 `ExecutionPlan` 前執行繁體中文 query understanding pipeline，包含斷句、分詞、片語抽取、術語 normalization、時間解析、代詞解析、多意圖拆解、實體候選抽取、信心分數與澄清條件。
- **FR-040**: 系統必須提供可替換的 `TokenizerAdapter`，不得將中文理解能力綁定到 jieba 或任何單一 package。
- **FR-041**: 系統必須支援企業術語、同義詞、縮寫與欄位別名 normalization，且這些詞彙資料必須可維護，不得只寫死在 prompt。
- **FR-042**: Query understanding output 必須保存並可用於 audit、debug、eval 與 ReviewItem 分析，至少包含 sentences、tokens、phrases、normalizedTerms、timeRanges、resolvedReferences、entityCandidates、subTasks、confidence 與 clarificationNeeds。
- **FR-043**: 當中文 query understanding 的信心分數低、上下文不足、時間範圍不明、代詞解析失敗或候選實體衝突時，系統必須要求澄清，不得自行猜測。
- **FR-044**: AI 回覆必須支援 SSE 即時串流，事件至少包含 answer_delta、tool_call_started、tool_call_completed、evidence_attached、approval_required、confirmation_required、final 與 error；每個事件必須包含 requestId、sessionId、messageId 與 sequence。
- **FR-045**: 系統必須保存可追溯的對話紀錄、稽核紀錄與回饋紀錄，並能以 requestId、messageId、toolCallId、evidenceRefId 或 audit event 追蹤來源。

### Key Entities *(include if feature involves data)*

- **AssistantSession**：代表一段內部助理對話，關聯 host app、actor、company/organization boundary、建立時間、狀態與訊息集合。
- **AssistantMessage**：代表使用者訊息、AI 回覆、tool status 或 system event，包含 role、content、requestId、evidence refs、tool calls 與建立時間。
- **ActorContext**：代表宿主系統傳入的使用者身份、角色、permission scope 與資料可見範圍。
- **HostAppContext**：代表嵌入來源系統，例如 ERP / MES / WMS / SCM / CRM，以及該系統的 integration identity 與 request metadata。
- **ToolDefinition**：代表可被助理選擇的工具，包含用途、schema、權限需求、風險等級、副作用標記與 audit 設定。
- **ToolCall**：代表一次工具調用，包含 input summary、permission result、output summary、狀態、duration、錯誤與 tool call id。
- **EvidenceRef**：代表回答依據，可指向 tool result、文件片段、結構化資料列、entity id、時間戳與權限檢查結果。
- **ApprovalRequest**：代表高風險操作審核請求，包含 requester、approver、risk level、action summary、payload summary、status、decision reason 與 requestId。
- **AuditEvent**：代表 append-only 稽核事件，記錄對話、權限、工具、RAG、LLM、審核與人工介入全鏈路行為。
- **AssistantContextState**：代表助理對目前任務與連續對話的狀態記憶，包含 current task、current module/page、current entity type/id、last intent、last entities、last tool calls、last evidence refs、pending clarification、pending approval request 與 task state。
- **PageContext / ScreenContext**：代表宿主畫面的使用者可見狀態，包含 host module、route/screenId、entityType、entityId、selectedRows、activeFilters、visibleColumns 與 user-visible page state。
- **ExecutionPlan**：代表執行前計畫，描述 taskType、requiredEvidence、candidateTools、permissionChecks、riskAssessment、clarificationNeeds、expectedAnswerShape 與 multi-step tool use 需求。
- **EscalationRequest**：代表需要內部人員、資料 owner、系統管理者或主管介入的升級處理請求，不限於客服轉接。
- **ReviewItem**：代表需要產品、知識、工具、權限或 connector 維護人員檢視的改善項目，可由 no-answer、工具失敗、負評、證據不足、路由錯誤或權限 mapping 問題產生。
- **FeedbackEvent**：代表 message-level 使用者回饋，關聯 requestId、messageId、intent、tool calls、evidence refs、answer decision 與 audit events。
- **QueryUnderstandingResult**：代表中文 query understanding pipeline 的輸出，包含 sentences、tokens、phrases、normalizedTerms、timeRanges、resolvedReferences、entityCandidates、subTasks、confidence 與 clarificationNeeds。

## RAG / Tool Quality Requirements

- Retrieval 與 structured lookup 必須先套用權限與公司/組織邊界，再把結果交給 LLM。
- 回答必須能區分 evidence 來源：tool result、structured lookup、document chunk 或人工審核決策。
- 複雜問題應支援 query decomposition 或 multi-step tool use 的設計空間，不得只依賴單一 keyword matching。
- 品質評估必須涵蓋簡單查詢、複雜多條件查詢、無結果、越權查詢、工具失敗與資料矛盾情境。
- 成功回答應具備 citation coverage；無 evidence 時必須 no-answer 或 clarification。
- 文件、SOP、政策、欄位說明與操作手冊屬於 document knowledge，應使用 RAG 與 citation。
- 訂單、庫存、工單、客戶、供應商、報價與交易屬於 live business data，應使用 backend tools、structured lookup 或 connectors。
- 系統不得把 vector search 視為所有企業資料的預設查詢方式；即時性、授權性與交易一致性資料必須以來源系統查詢為準。
- Tool result 與 document evidence 衝突時，系統必須揭露衝突、降低確定語氣，並要求澄清或建立 `ReviewItem`。

## API Contract Requirements

本 spec 不鎖定最終 API path，但後續 design/plan 必須定義以下 contract：

- 建立或取得 assistant session。
- 查詢指定 session 的 message history，支援 pagination/cursor、權限檢查、masking、requestId 與一致錯誤格式。
- 送出使用者訊息並以 SSE streaming 取得 AI 回覆。
- 查詢 message、tool call、evidence refs 與 audit correlation id。
- 建立、查詢、核准、拒絕、取消 approval request。
- 統一 response/error/requestId 格式。
- SSE chunk 必須可關聯 sessionId、messageId、requestId 與 event type，並支援 answer delta、tool status、evidence attached、approval required、confirmation required、final、error 等事件。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 在授權查詢情境中，90% 以上測試案例能回傳含 evidence refs 的回答，且不需要人工補查資料。
- **SC-002**: 100% 未授權資料查詢會在 tool/retrieval 執行前或結果輸出前被阻擋，不得出現未授權資料內容。
- **SC-003**: 100% high risk / critical action 測試案例只會建立 approval request 或 escalation/review，不會直接執行副作用操作。
- **SC-004**: 100% no-result、ambiguous、tool failure 測試案例不得產生編造答案，必須 no-answer、clarification 或安全錯誤回覆。
- **SC-005**: 100% assistant request、tool call、permission denial、approval decision 都能透過 requestId 追溯到 audit event。
- **SC-006**: 在固定 RAG/query-understanding regression set 中，tool routing accuracy、no-answer precision 與 citation coverage 必須達到 design 階段定義的最低門檻。
- **SC-007**: API contract tests 必須覆蓋成功、錯誤、權限不足、SSE stream interruption、approval pending/rejected/expired 等主要狀態。
- **SC-008**: 100% 使用「這筆資料」、「這張訂單」、「目前這個工單」等代稱的測試案例，若缺少足夠 page context，系統必須要求澄清，不得猜測目標 entity。
- **SC-009**: 100% 未授權欄位測試案例必須在 tool result 交給 LLM 前被移除或遮罩。
- **SC-010**: 100% message-level feedback 必須可追溯到 requestId、messageId、intent、tool calls、evidence refs、answer decision 與 audit events。
- **SC-011**: Failed query、no-answer、tool failure、negative feedback、missing evidence、bad tool routing 與 permission mapping issue 必須能建立可追蹤的 `ReviewItem`。
- **SC-012**: 訂單狀態、工單進度、料號庫存、客戶/供應商歷史等 live business data 測試案例必須使用 structured lookup 或 connector；SOP、政策、欄位說明與手冊測試案例必須使用 RAG evidence。
- **SC-013**: 24/7 readiness 測試必須能偵測 LLM、retrieval、connector 或 approval dependency 異常，並回傳安全降級狀態與可追蹤告警事件。
- **SC-014**: 固定語意理解 eval set 的 task routing accuracy、entity extraction accuracy、context resolution accuracy 必須達到 design 階段定義門檻，且不得只用 keyword match 通過。
- **SC-015**: 高併發測試必須覆蓋同時數千個 assistant requests 的情境，並驗證 queue、backpressure、timeout 與錯誤回覆不破壞 audit traceability。
- **SC-016**: 回覆品質 regression 必須追蹤自然語言品質、evidence coverage、citation coverage、負評率與 no-answer precision。
- **SC-017**: 營運洞察必須能產生 intents、task types、tool failures、permission denials、approval requests、review items 與高頻問題的分類統計。
- **SC-018**: AI-assisted improvement 測試必須證明系統只會建立改善建議或 `ReviewItem`，不會未經人工審核自動修改正式知識、工具 routing、prompt、eval set 或權限 mapping。
- **SC-019**: Automation efficiency dashboard 或等價報表必須能量測自助解決率、人工介入率、approval rate、review item close rate 與平均處理時間。
- **SC-020**: 固定繁體中文 query understanding eval set 必須覆蓋斷句、分詞、片語抽取、企業術語 normalization、時間範圍解析、代詞解析、多意圖拆解、實體候選抽取與澄清條件。
- **SC-021**: 缺少 `PageContext` 或 `AssistantContextState` 時，100%「這筆」、「這張」、「目前」、「剛剛選取」類指示詞測試案例必須要求澄清，不得猜測目標。
- **SC-022**: tokenizer 替換測試必須證明系統可切換 tokenizer adapter，而不影響 `ExecutionPlan`、audit、eval output 的資料契約。
- **SC-023**: SSE contract tests 必須驗證 answer delta、tool status、evidence attached、approval required、confirmation required、final、error 與 stream interruption 事件都包含 requestId、sessionId、messageId、eventType 與 sequence。

## Assumptions

- v1 以單一公司/組織部署邊界為前提，不設計大型 SaaS 多公司 tenant 管理。
- 宿主系統負責傳入身份、角色與權限上下文；本系統負責驗證、套用與稽核，不自行猜測權限。
- 第一版可先定義 connector/tool contract，實際 ERP / MES / WMS / SCM / CRM connector 可由後續 specs 拆分。
- 前端 SDK/widget 不是本 spec 的主要實作範圍，只保留 API/嵌入式 contract 需求。
- 初期可使用 mock connector 與固定 eval dataset 驗證 assistant core；真實宿主系統整合在後續 feature specs 展開。
- 高風險操作的實際執行 worker、主管審核 UI 與通知渠道可在後續 specs 補充，但本 spec 必須先定義 approval domain 與 audit requirement。
- v1 預設 LLM provider 為 `OpenAiProvider`；provider 由 `LLM_PROVIDER` 環境變數決定，v1 支援 `openai`，模型由 `LLM_MODEL` 環境變數決定，預設建議使用 `gpt-5.4-mini`。
