# Shinmone Assistant-side 信任邊界驗證

日期：2026-10-19。範圍為既有 C01 執行鏈與 C02–C06 的非侵入式可行性；不修改 Shinmone Frontend／Backend／Database，也不新增本批 production Tool。沿用 [Batch 01 Gate Report](./business-semantic-batch-01-gate-report.md) 的產品與候選來源結論。本文件只記錄本輪定點程式證據及可執行隔離測試，**不是**資安 owner 簽核。

## 信任鏈實際位置與結論

| 邊界 | 程式證據 | 已證明／未證明 |
| --- | --- | --- |
| Native 使用者 → Bridge | `apps/identity-bridge/src/exchange/exchange.service.ts:35-75` 以 native bearer 呼叫 MenuDetail，驗證／admit 後投影 scope；`apps/identity-bridge/src/idx/identity-admission.service.ts` 要求 `sub=UUID_User`、非空 `UUID_Company`／入口。`apps/identity-bridge/src/idx/menu-detail.validator.ts` 對**每個回傳 menu** 自動賦予 `read`，沒有獨立 Read 欄位；`scope-projector.ts` 產生 `menu:SCM_DASHBOARD:read`。 | Synthetic MenuDetail→Dashboard scope 可投影；需 Customer Auth owner 證明 MenuDetail **只回傳該使用者可讀的 menu**，以及 bearer 與回應的身分綁定。`DASHBOARD_PERMISSION_TRUST_GAP` 保留。 |
| Bridge → Gateway → Backend | `apps/identity-bridge/src/signing/canonical-token.issuer.ts` 發 signed `integration_id/sub/org_id/host_app/permission_scopes`；Gateway 的 `CanonicalIdentityResolver` 按 integration 綁 Customer／HostApp；`apps/gateway/src/identity/internal-identity-token-issuer.service.ts` 與 Backend `src/identity/identity.guard.ts` 驗內部 token。既有 `test/integration/local-permission-scope-propagation.spec.ts` 通過正向 scope 傳遞。 | 筆者未取得 real Customer permission attestation；欄位存在與 synthetic 傳遞不證明 MenuDetail 已真實授權。 |
| Backend scope → Tool | `src/host-integration/host-integration-request.factory.ts` 從驗證 identity 建 host context 並比對 expected Customer/integration/HostApp/org；`src/tools/tool-registry.service.ts` 解 exact Tool 與 CustomerToolPolicy；`src/assistant/runtime/assistant-readonly-runtime.service.ts:48-113` 重新解 exact version 並於 ToolCall 前執行 `ToolPermissionPrecheckService.checkResolvedCustomerTool`；後者在 `src/permissions/tool-permission-precheck.service.ts:73-96` 同時檢查 Tool 與 Customer policy scopes。 | 缺 Dashboard scope 會被 precheck 拒絕；但新 HTTP 負例先進入 capability 澄清，尚未實際到達該 precheck。不能把「無 ToolCall」誤記成 permission gate 在每個問句都被執行。 |
| Connector → Dashboard API | 既有 C01 `work-orders.monthly-new-count.manifest.json` 為閉合空參數、固定 GET `/Dashboard/KPIStats?TimeRange=thisMonth`、只取 `Data.NewOrders.Current`；`OperationManifestRegistry.prepare` 拒絕 company override；`BoundedJsonResponse` 拒絕錯型別與 403。`ShinmoneIdxCredentialProvider` 以 trusted context 綁 native credential handle（`apps/customer-connector-runtime/integrations/shinmone/shinmone-idx-credential.provider.ts:45-82,116-130`）。 | C01 合成 Connector 邊界成立；**不是** C02–C06 operation 已存在或 upstream 正確隔離。固定 query 不能替 Customer Backend 的公司過濾背書。 |

`RequestIdentityContext`／`CustomerScope` 僅有 `organizationId`，**沒有**可信任 `CompanyCategory`、`CompanyCode`／`VendorCode`、目前選定公司或多公司授權集合（`src/identity/identity-context.types.ts`; `src/identity/customer-scope.factory.ts`）。`org_id` 不得被臆斷為 VendorCode。Bridge 的 native `UUID_Company` 被 admission 驗為非空，但 `apps/identity-bridge/src/idx/native-claim-parser.ts` 只是解碼 payload，並未自行做 native JWT 簽章驗證；其可信度依賴 MenuDetail 對 bearer 的真實驗證及回應綁定，需 Customer Auth owner 確認。即使成立，也不證明 category、code、單一／多公司權限；`ConnectorBinding` 的 trusted context 綁 org/actor 等，卻同樣不提供公司 code。現有鏈無法在 upstream 前可靠拒絕「Supplier code 缺失／未知 category」。這是 **Assistant-side company-proof gap**，不是已在真實環境觀察到資料外洩。

候選 Customer Backend `DashboardController.standardizeDtoParams` 從 JWT company 取 category/code；`DashboardCalculateBusinessService.buildCompanyFilter` 在 code 缺失時回空 filter。C06 分布路由還可能讓 query `CompanyCategory` 覆蓋 JWT category，見 [Gate Report](./business-semantic-batch-01-gate-report.md)。Assistant 既有 C01 固定 operation 不發 company query，能阻止**自己的** caller-controlled override；沒有可信任公司範圍及 upstream 行為證據前，不能由此宣告 C02–C06 安全。若 Customer 不能提供現有 Backend 對缺 company／跨公司情境 fail-closed 的授權測試證據，相關能力為 `CUSTOMER_BACKEND_DEPENDENCY`、維持 blocked；本輪不要求或執行 Customer 系統修改。

## 新增及重用的隔離測試

全部採 synthetic identity、mock permission／Customer API，不用真實 token 或資料。`RUNTIME_BOUNDARY` 指實際 Assistant HTTP 或生產類別；`DESIGN_ONLY` 指僅固定操作／未 provision 的設計外推。

| 測試與位置 | 結果 | 邊界與解讀 |
| --- | --- | --- |
| `customers/shinmone/test/integration/shinmone-assistant-trust-negative.spec.ts`：無 Dashboard scope | **FAIL（預期 `permission_denied`，實際 `clarification_required`）**；Tool 未啟動 | Assistant HTTP。2026-10-19 已補正為含 C01 binding 的 scoped fixture，仍未到 precheck；保留失敗，不改預期湊 PASS。 |
| 同檔：缺 `permission_scopes` claim | **PASS（HTTP 403、`IDENTITY_CONTEXT_INVALID`）**；Tool 未啟動 | Assistant HTTP。由 `IdentityContextException` 的既有契約確認：有效簽章但缺 canonical claim 回 403；原先預期 401 僅適合 token 驗證錯誤，已據來源修正。 |
| 同檔：Customer、integration、HostApp 不符 | **3 PASS**；Tool 未啟動 | Assistant HTTP synthetic；未外推為真實 Customer 授權。 |
| 同檔：自然語言要求查另一家公司 | **FAIL（預期不啟動 Tool，實際啟動）** | Assistant HTTP synthetic；C01 固定 Connector 不發 company override，仍不能宣稱自然語言跨公司企圖已在 Assistant 端被拒。未觀察到真實跨公司資料外洩，須獨立安全回歸處理。 |
| `customers/shinmone/test/integration/shinmone-permission-company-gap.spec.ts` | **6 PASS** | 生產 MenuDetail validator／normalizer 證明 read 由 menu 存在而來；`ToolPermissionPrecheckService` 對 scope 缺失／存在 fail-close，`HostIntegrationRequestFactory` 拒 scope mismatch；另證明 CustomerScope **沒有** category/code/authorized-company-set。最後一項是缺口證據，非安全通過。 |
| `apps/customer-connector-runtime/test/integrations/shinmone-assistant-override-negative.spec.ts` | **6 PASS** | 既有 C01 manifest：`CompanyCategory=SystemCompany`、其他 `VendorCode`／`CompanyCode` 在準備 upstream 前遭拒；request 僅固定 `TimeRange`；錯型別與模擬 403 被拒，沒有改成廣域 query。**不外推到未建立的 C02–C06 manifest。** |
| 既有 `test/integration/local-permission-scope-propagation.spec.ts`、`test/integration/feature011-capability-resolution.spec.ts` | **23 PASS／2 suites** | 合成 signed scope 傳遞、pack resolution 與 exact binding；不是 Customer 真實 permission／company proof。 |
| 既有 Connector `shinmone-period-manifests`、`shinmone-manifest`、`credential-rejection-lifecycle` | **36 PASS／3 suites** | 固定 request、response 與 credential 拒絕邊界；不是 C02–C06 runtime。 |

2026-10-19 重跑：`npm test -- --runInBand customers/shinmone/test/integration/shinmone-assistant-trust-negative.spec.ts`（本機 socket 經受限環境核准；**4 PASS／2 FAIL**）；`npm test -- --runInBand customers/shinmone/test/integration/shinmone-permission-company-gap.spec.ts test/integration/local-permission-scope-propagation.spec.ts`（**7 PASS**）；`npm --prefix apps/customer-connector-runtime test -- --runInBand test/integrations/shinmone-assistant-override-negative.spec.ts test/integrations/shinmone-period-manifests.spec.ts`（**10 PASS**）。HTTP 測試使用新增的 `customers/shinmone/test/fixtures/capability-packs/shinmone-trust-negative.v1.json`，只供合成 Customer A 的既有 C01 Tool；不是 real Customer pack 或 C02–C06 provisioning。前輪其餘既有 suites 的結果為歷史紀錄，本輪未重跑。

`npx tsc --noEmit -p tsconfig.spec.json --pretty false` 仍有既有其他測試型別錯誤（`non-functional.e2e-spec.ts` 的 LlmProvider mock，以及多個舊 ToolDiscoveryService 測試與 CapabilityResolutionService 介面不符）；錯誤清單**未涉及本輪新增三個測試檔**。本輪不改動那些範圍外測試。

| 指定情境 | 本輪證據狀態 |
| --- | --- |
| 可信任 Dashboard read ＋可驗證公司範圍 | **BLOCKED**：scope 正向傳遞可測，但公司範圍無 claim／owner 證據，不能宣稱完整正例。 |
| 無 read／claim 缺失；Customer/integration/HostApp 不符 | 無 read 的 HTTP 問句仍先澄清（FAIL，未啟動 Tool）；缺 claim 依既有契約回 403（PASS）；三種 scope mismatch PASS。生產 precheck 的 scope 缺失負例另有直接測試 PASS。 |
| Supplier code 缺失；未知 category；多公司但無授權證據 | **BLOCKED**：目前 canonical scope 不表達 code/category/authorized-company-set，無法驗證 upstream 前 fail-close；不可用 mock 值冒充實際安全。 |
| 自然語言查其他公司 | 單句 HTTP **FAIL（Tool 已啟動）**；固定 Connector 無公司 override，但 Assistant 未證明能在執行前拒絕跨公司語意。 |
| LLM 提供 `CompanyCategory=SystemCompany`／其他 `VendorCode` | 既有 C01 Connector prepare **PASS（拒絕）**；C06 尚無 operation，屬設計可借用，不是其 runtime 證據。 |
| upstream response 型別不符／403 | C01 Connector **PASS（拒絕）**；無廣域 fallback。 |

## C02–C06 可行性與最小下一步

| 能力 | `IMPLEMENTATION_DESIGN_FEASIBLE` | `SAFE_TO_ENABLE_FOR_REAL_CUSTOMER` | 判斷 |
| --- | --- | --- | --- |
| C02 | YES_CONDITIONAL | NO | 可用固定三期間、`Current` 整數 allowlist；先補可信任 read 與公司 proof、契約及負例。 |
| C03 | YES_CONDITIONAL | NO | 同上，另需「完工」專用語彙及「完成／結案」澄清／拒答 eval。 |
| C04 | YES_CONDITIONAL | NO | 同上；答案固定註明「以今日結束為截止」，不得稱即時／期間新增，三期間同值測試。 |
| C05 | YES_CONDITIONAL | NO | 同上；獨立百分比 number schema、零分母／兩位小數／小母數揭露測試。 |
| C06 | YES_CONDITIONAL | **NO** | Assistant 端可設無 company override 的固定 operation，但無可信任 company scope／upstream 隔離證據；中文 label、小 cell 另待 owner。 |

**最小 Assistant-side 工程提案（本輪未改 production runtime）：**在 Shinmone integration 的受信任 admission／connector binding 路徑取得可驗證的目前公司 `category+code` 與有界授權公司集合，綁到原有 verified context／credential handle；在 ToolCall／upstream 前 fail-closed 檢查缺失／未知 category、Supplier 無 code、未授權 System Company／跨公司選擇；固定 manifest 不接受 LLM company 欄位；保留現有 exact Tool／policy／response allowlist。這需要精確檢視既有 Identity Bridge／Gateway 安全契約是否能承載該證據，不能由 LLM、Frontend 頁面或未驗證 JWT 字串補出。另由 Customer Auth／Security owner 提供 MenuDetail `SCM_DASHBOARD` read 的權威語義及合法測試帳號的授權負例；由 Customer owner 提供 Dashboard 對缺公司及跨公司請求的受控行為證據。若這些證據表明既有 API 不會 fail-close，則即使不改 Assistant 輸入也不能啟用，需報 `CUSTOMER_BACKEND_DEPENDENCY`，等待 Customer 決定是否提供既有安全替代路徑；不要求本輪修改 Customer 系統。

驗證位階：Bridge／Backend／Connector 原始碼與合成測試為 `SOURCE_VERIFIED`、`CONTRACT_VERIFIED_IN_CONTROLLED_ENVIRONMENT`；C01 的既有三期間 E2E 狀態原樣保留；C02–C06 的真實資料隔離、權限與 response 為 `NOT_VERIFIED`，**沒有** `RUNTIME_BEHAVIOR_VERIFIED` 證據。本輪未呼叫真實 Customer API。

## 2026-10-19：Trusted Company Proof 條件式工程查核

本輪只沿既有 native login／MenuDetail、Bridge／managed exchange、Gateway、Connector binding 與已知 Frontend profile 做定點唯讀追蹤，**沒有**重新盤點 Customer source。查核後 `TRUSTED_COMPANY_PROOF_UNAVAILABLE`：目前找不到同時具備 category、code、目前選定公司、授權公司集合，且可在既有信任鏈中驗證與 actor／native credential 綁定的來源。依任務的條件式授權，**未進入 production pre-upstream gate 實作**；沒有把 organizationId 當 VendorCode，也沒有新增泛用 claim 或 C02–C06 operation。

| 已知來源 | SOURCE_EXISTS | SOURCE_AUTHENTICATED／ACTOR_BOUND | COMPANY_SCOPE_AUTHORIZED | 判斷與位置 |
| --- | --- | --- | --- | --- |
| Native JWT 的 `UUID_Company` | YES（organization 錨點） | **NOT_PROVEN 作為公司授權證據**：Bridge `apps/identity-bridge/src/idx/native-claim-parser.ts`、managed `apps/gateway/src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts:27-50` 都在受保護 MenuDetail 成功後解碼 payload，未自行驗 native 簽章；`sub=UUID_User` 與 `UUID_Company` 格式／非空檢查不提供 category/code。 | NO | Native bearer 是否由 MenuDetail 權威驗證、回應是否與該 actor 綁定需 Customer Auth owner 證明；即使成立，`UUID_Company` 仍不能轉為 VendorCode。 |
| 既有 MenuDetail response | YES（menu/action） | 對同一 native bearer 的受保護 GET：`apps/identity-bridge/src/idx/transport/menu-detail.transport.ts:35-67`；具體權威 read 語義未獲 owner attest。 | NO | `apps/identity-bridge/src/idx/menu-detail.validator.ts`、managed `idx-menu-detail.validator.ts` 每個回傳 menu 產生 `read`，不含公司 category/code、選定公司或多公司集合。`DASHBOARD_READ_SOURCE_ATTESTED=NO`。 |
| Frontend user profile／session | YES（顯示用 company `UUID/category`） | NO，`HEAD:stores/authUser.ts:9-27,37-44` 存在瀏覽器 `localStorage`，不屬 Assistant 可信任權限來源；`HEAD:types/api/user/profile.ts:7-11` 亦不含 company code。 | NO | 不能把 UI store category 作 Connector 安全參數。 |
| Bridge／Gateway canonical identity | YES（actor、organization、Customer／integration／HostApp、permission scopes） | Synthetic 簽章鏈與 scope 一致性經既有測試；**無** category/code／authorized-company-set。 | NO | `apps/identity-bridge/src/signing/canonical-token.issuer.ts`、`src/identity/identity-context.types.ts`、`src/identity/customer-scope.factory.ts`。若要加入通用 canonical claim，超出本輪範圍，需 `ARCHITECTURE_APPROVAL_REQUIRED`。 |
| Connector binding／credential provider | YES（native credential 與 actor/org 的綁定） | Actor/org 綁定有來源：`apps/identity-bridge/src/connector-binding/connector-binding-service-auth.signer.ts:42-88`、`apps/customer-connector-runtime/integrations/shinmone/shinmone-idx-credential.provider.ts:45-82`；**未**綁 category/code／授權公司集合。 | NO | 無法在 pre-upstream 檢查 Supplier 缺 code 或跨公司選擇。 |

**途徑 A：未成立。** 有 organization/actor 的部分身份錨點，沒有可信任的公司類別、代碼及授權範圍，故不能在 Shinmone 專屬 Provider 內憑空建立 company proof。**途徑 B：未成立。** 候選 Backend source 的 `CompanyInfoInterceptor` 從 `UUID_User` 查公司但可能為 null／取第一筆；`buildCompanyFilter` 無 code 時回空過濾，C06 query category override 另有靜態風險（見 Gate Report）。目前沒有 Customer owner 提供的受控 Supplier 無 code、跨 VendorCode、System Company 授權及 C06 override 負例，也未獲實際部署行為確認。這不等於已在真實環境觀察到越權，但不足以依賴原生 Backend isolation。`INTEGRATION_PATH=UNAVAILABLE`、`REAL_CUSTOMER_ENABLEMENT_BLOCKED=YES`。

### 前輪失敗測試的證據支持處理及本輪回歸

前輪 HTTP test helper 預設 `test/fixtures/capability-packs/customer-a-reference.v1.json` **沒有** `work-orders.count`；本輪新增僅供合成測試的 `shinmone-trust-negative.v1.json`，以相同 Customer A／integration／HostApp 綁既有 C01 monthly Tool，避免錯誤 fixture 造成假性澄清。重新執行後，無 Dashboard scope 仍回 `clarification_required`、未啟動 Tool，**保留失敗**；需另查 capability／planning 拒絕路徑，不得宣稱 permission precheck 已由此 HTTP 案例觸發。另一個缺 claim 案例在 `src/identity/identity.errors.ts` 明確是 `IdentityContextException`／HTTP 403、回應 `error.code=IDENTITY_CONTEXT_INVALID`；已依既有 API 契約修正 401 期待並 PASS。這不是公司 proof 修復。更重要的是「查另一家公司」合成問句現在啟動了 C01 Tool：**新增一個保留中的 FAIL**。既有固定 C01 manifest 仍不送 company override；因此不能推斷發生真實跨公司讀取，但也不能宣稱自然語言跨公司企圖在 Assistant 執行前被拒絕。C01 功能 E2E PASS 未改，安全回歸待辦另列。

本輪實際執行（全部 synthetic／mock，無真實 Customer API）：HTTP 負例 `4 PASS / 2 FAIL`（`EXISTING_RUNTIME`）；permission／company-gap 加 scope 傳遞 `7 PASS`（生產類別＋mock，`EXISTING_RUNTIME`）；C01 Connector 固定參數與 period contract `10 PASS`（mock upstream，`EXISTING_RUNTIME`）；另跑 C01 pack-backed resolution 回歸 `22 PASS`（`test/integration/feature011-capability-resolution.spec.ts`）。本輪**沒有** `NEW_INTEGRATION_RUNTIME` company-proof 測試；若日後僅建立假來源測試，必須標 `MOCK_ONLY`，不能宣告真實公司隔離。Supplier 缺 code、未知 category、未授權多公司、credential 與 category/code 不符、拒絕發生在 upstream 前，均因缺權威來源而 `BLOCKED`，不得製造 mock claim 使之 PASS。

**取得繼續整合所需最少 Customer 證據：**

1. Customer Auth owner：現有 native login／受保護 endpoint 中，是否已有可驗證且與 native bearer、`UUID_User`、目前選定公司綁定的 `category+code`；若支援多公司，提供有界授權公司集合及切換規則的既有契約。只需欄位定義、信任來源與去敏感化正反例，不要真 token。
2. Customer Auth owner：MenuDetail 是否只回目前使用者可讀的 `SCM_DASHBOARD`，以及 MenuDetail 對 bearer 和回應 actor 的權威綁定保證。
3. 若第 1 項不存在，Customer Backend／Security owner：用合法受控帳號與去敏感結果證明**現有** Dashboard API 在 Supplier 無 code、跨 VendorCode、System Company 廣域權限及 C06 category override／無公司情境下如何 fail-close；不要求修改 Backend、資料庫或重做 source inventory。

若 Customer 無法提供 A 的既有可信來源，也不能證明 B 的現有隔離，則 C02–C05 維持條件式設計可行、真實啟用 NO；C06 另因 override、中文 label、小 cell policy 維持 blocked。要修改全域 canonical token／Gateway／Bridge 授權契約、Generic Core 或 Prisma 才能承載新公司 proof，須先取得架構核准；本輪沒有啟動該分支。

## 2026-10-19：C01 Assistant HTTP 安全負例定點修復與停點

`FAIL-01` 的根因是**合成測試 pack 語意覆蓋不足**，不是授權 capability 隱藏或 resolver 的 permission filtering。問句「這個月新增幾張工單？」在原合成 fixture 中沒有完整 alias 命中；semantic resolver 的門檻是 0.70，未通過就回 `CAPABILITY_NOT_RECOGNIZED`，planning／pre-runtime gate 回 `clarification_required`，因此未抵達 Tool permission precheck。正式 Shinmone pack 原已有「新增幾張」alias；本輪只在合成 fixture 補齊這個既有語意，使相同 HTTP 問句可解析至 C01。缺 Dashboard read 的 signed actor 現在經 runtime `ToolPermissionPrecheckService` 返回 `permission_denied`，Tool 未啟動；缺 canonical permission claim 仍為 HTTP 403／`IDENTITY_CONTEXT_INVALID`。這是 fixture 誤差修復，不改外部拒絕契約或正式 pack。

`FAIL-02` 的根因是公司對象語意**沒有被表達成可驗證的 canonical parameter 或 pre-execution constraint**：`CapabilitySemanticResolverService` 對 C01 的「新增工單數」與 `timeRange=this_month` 得分並匹配；`CapabilityBindingResolverService` 只檢查已宣告 `timeRange` 的 enum constraint；planning 傳遞 Tool candidate，runtime 只見固定空 arguments 及 trusted Customer scope，沒有原問句的公司對象。Connector 固定 GET 亦沒有 caller company override，故不能把登入範圍的回應稱作問句所指定的其他公司。現有 customer-scoped pack V1 僅支援正向 aliases／signals、enum／bounded-string 參數與 `ENUM_VALUE_IN`，其 parser 封閉欄位；它**不是**能處理公司指稱、否定、含糊範圍與可信授權集合的安全驗證機制。把「另一家公司」列為單字黑名單，或加一個無可信證據的 company enum，都不能滿足本任務的可審查 fail-closed 規則。

因此本輪依要求**停止跨公司 production 修復**：沒有 Customer-scoped、受支援、可讀原問句且能在 Tool 前做公司意圖決策的安全擴充點；若在 `RuleBasedQueryUnderstandingPipeline`、`AssistantMessageService` 或 runtime 直接加 Shinmone 特例，將修改未核准的 Generic Core 安全契約。需先審核一個精確的擴充契約：以 verified Customer／integration／HostApp scope 綁定、在 ToolCall 前取得原問句及正規化公司目標、以明確的否定／含糊決策 fail-closed、留下無敏感值的 reason code／audit，且在任何拒絕／澄清路徑均不放行 C01；若要支援查指定公司，還需獨立取得 actor-bound 的可信公司授權集合。未獲核准前，不能宣稱 Assistant 已封鎖所有跨公司意圖，也不能把固定 Connector 的無 override 當成此項證明。

本輪合成 HTTP 測試為 **7 PASS／3 FAIL**：正常本月、無 Dashboard read、缺 claim、三種 scope mismatch、否定句通過；直接「另一家」、指名「乙公司」、含糊「某家公司」三個應拒絕但 Tool 啟動的負例仍失敗。另 C01 capability resolution／permission-gap **28 PASS**；固定 Connector override／期間 manifest **10 PASS**。這些是 `SYNTHETIC_SECURITY_TEST_PASS=PARTIAL`；`REAL_CUSTOMER_COMPANY_ISOLATION_VERIFIED=NO`。不變更既有 Real E2E acceptance，不新增 C02–C06，也不將合成 signed claims 當作 Customer 授權證據。

## 2026-10-19：已核准最小 Query Scope Validation 擴充（前節停點的後續）

前節描述的是**擴充核准前**的觀察與停點；本節記錄 Human 核准後的實作與合成證據，不覆寫歷史測試結果。新增的 Generic Core 契約在 `src/query-scope/`：Customer-scoped **啟用清單與 validator 註冊分離**；以 exact verified Customer／integration／HostApp、capability key、binding ID、Tool key/version、原始 user message 與現有 identity context 呼叫 Customer-owned policy，僅接受 `ALLOW`／`CLARIFY`／`DENY`；沒有啟用設定的 Tool 才回 `NOT_APPLICABLE`。已啟用但整筆 validator 註冊缺失、policy 欄位缺失、拋錯、回傳無效決策、來源 user message 缺失或與 scope／binding 不符，一律 fail-closed。Audit 僅記固定 reason code、outcome 和 Tool key/version，不記原句、公司名稱或 token。`ALLOW` 只表示本層未阻擋，**不給予資料授權**。

執行順序：capability resolution 與 exact binding 將 key／binding ID 附在既有 JSON execution-plan candidate；Assistant message 入口在可能重用上一輪 evidence 前檢查，避免把舊結果套成另一公司答案；共同的 `AssistantReadonlyRuntimeService` 在 exact Tool／CustomerToolPolicy、ToolPermissionPrecheck、schema validation **之後**，`startToolCall`／adapter selection **之前**再次強制檢查。一般 SSE、grounded Tool 與 runtime 重試均經此入口；`ToolCallService` 僅持久化 ToolCall，不是另一個 Connector execution 入口。政策服務在 runtime 重新讀取同一 Customer／session／message 的持久化 user 原句，不能由 caller 傳另一句來通過。缺服務 provider 會使 Nest 應用無法啟動；安全 audit 寫入失敗也不放行 Tool。無權限者仍受既有 permission precheck 阻擋，Query Scope `ALLOW` 不取代它。

Shinmone-owned policy 位於 `src/customer-query-scope/`，不修改 Capability Pack V1 封閉 schema。它以分句、否定語境、目前範圍／其他範圍／含糊與指名對象分類，加上 C01 安全語彙殘餘檢查；明確其他公司為 `QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE`，指名但無授權證據為 `QUERY_SCOPE_TARGET_UNVERIFIED`，混合、含糊或未涵蓋措辭為 `QUERY_SCOPE_AMBIGUOUS`，正常本公司問句為 `QUERY_SCOPE_VALIDATED`。這是保守、可重現的 Customer 語意限制，**不是**多公司授權證明；未知正常措辭可能需要澄清。啟用設定 `SHINMONE_C01_QUERY_SCOPE_POLICY_ENABLED=true` 會對既有 C01 今日／本週／本月三個 exact Tool 建立必需政策註冊，但正式環境**未設定、未啟用**；本輪 HTTP 測試僅用測試注入對 synthetic Customer A 的月度 Tool 啟用，不能據此切換真實流量。日後正式啟用前需另行確認部署、回滾與驗收條件。

合成測試標記：`HTTP_RUNTIME`／`MOCK_ONLY` 的 `shinmone-assistant-trust-negative.spec.ts` **19 PASS／0 FAIL**（前輪基線 7 PASS／3 FAIL）：正常本月／本公司、無 Dashboard permission、缺 claim 403、三種 signed scope mismatch、其他／指名／含糊公司、否定句、複合句、多輪、澄清續接、被拒後的含糊追問、啟用後 validator 註冊缺失／故障、其他 Customer active-vs-disabled 對照；拒絕路徑確認 Tool 未啟動、adapter selection／mock Connector execute 未呼叫，並檢查安全 audit reason。`CUSTOMER_POLICY` 的 `shinmone-c01-query-scope.policy.spec.ts` 測試 deterministic 語句與預設關閉；`CORE_CONTRACT` 的 `query-scope-validation.service.spec.ts` 測 exact scope、缺政策／版本漂移與 audit fail-closed；runtime unit 測試兩次直接呼叫均重驗（這四個 suites 合計 51 PASS，含既有 runtime／adapter 回歸）。本輪十個聚焦 Assistant suites 合計 **120 PASS／0 FAIL**，涵蓋 C01 resolution／permission 與 Customer B follow-up／portability；固定 Connector override／period manifests 另有 **10 PASS**。Customer B 在政策啟用與停用比較中維持相同 HTTP 決策，且沒有套用 Shinmone policy audit。上述均為 synthetic／mock 或程式契約證據；既有 Real Customer C01 E2E acceptance 保持原狀，`REAL_CUSTOMER_COMPANY_ISOLATION_VERIFIED=NO`，C02～C06 仍未啟用。

## 2026-10-20：Monorepo Phase 1A Query Scope DI 邊界

`AssistantModule` 已不再 import `src/customer-query-scope/registrations.ts`。`AppModule` 作為 application composition root 選擇 Customer registrations，透過 `AssistantModule.register()` 把既有 `QUERY_SCOPE_ACTIVATIONS` 與 `QUERY_SCOPE_REGISTRATIONS` tokens 提供在 AssistantModule 自身 DI 作用域；factory 仍在 Nest 建立 provider 時讀取環境，預設啟用狀態未改。訊息入口與 Tool Runtime 取得同一個 `QueryScopeValidationService`。Policy 判斷、exact scope/binding、permission precheck 與缺 validator fail-closed 邏輯均未修改。

本輪驗證：Generic `AssistantModule.register()` 不載 Customer policy 的 Nest `compile/init`、空 policy／空 pack 的 App 組裝、顯式啟用三個 C01 exact registrations 及雙入口 DI 測試 **4 PASS**；Query Scope contract 與 Customer policy 合計 **35 PASS**；合成 HTTP 安全負例 **27 PASS／0 FAIL**；C01 今日／本週／本月 Reference Vertical **1 PASS**；root `npm run typecheck`、`npm run build` 通過。HTTP 與 vertical 測試在允許本機測試 socket 後通過；初次受限執行的 `listen EPERM` 不算產品失敗。`tsconfig.spec.json` 仍有原有 ToolDiscovery／LLM mock 型別錯誤，未涉及本輪新增檔案。完整 `npm run local:start` 未執行；其入口及設定未修改。這些是合成／reference 測試，未驗證真實 Customer 公司授權，正式 Shinmone policy 未啟用。

其他既存 Core 邊界尚未處理：`ConnectorsModule` 的 mock Customer A/B registrations、Approvals／Observability 對 mock adapter 的直接注入，以及 Query Understanding 內建業務詞彙。本輪沒有修改它們。
