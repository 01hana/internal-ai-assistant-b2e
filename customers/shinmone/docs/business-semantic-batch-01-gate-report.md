# Shinmone Batch 01 最終技術／資安 Gate Report（C02–C06）

記錄日：2026-10-18。這是產品決策整理與唯讀 Gate 查證，不是部署、owner 簽核或 implementation authorization。五項仍為 Catalog `NEEDS_HUMAN_REVIEW`；C01 的 `HUMAN_VERIFIED`／`E2E_ACCEPTED` 不變。`PASS` 只給已有明確證據的**該列**；不能由一列 PASS 推出整項可實作。`BLOCKED` 表示已知風險或必需的核准未完成；`UNKNOWN` 表示缺部署／runtime 證據；`NOT_APPLICABLE` 表示該 Gate 對該能力不適用。

## 繁體中文摘要與 Gate Matrix

使用者已定 C02／C03／C05 的 Dashboard 公式與最小輸出，C04 已選「今日結束」截止基準（`PRODUCT_BASELINE_CONFLICT_RESOLVED`），C06 已選**可信任公司身分**對應 Supplier 10／System Company 11 類。產品選擇不等於 Customer Backend 已部署該版本，也不等於原有 Dashboard 權限、Assistant 授權或資料揭露已核准。候選原始碼顯示 C06 query 可覆蓋公司類別，需優先由 Customer Backend／Security owner 修正或證明實際部署不受影響。

| Gate | C02 | C03 | C04 | C05 | C06 |
| --- | --- | --- | --- | --- | --- |
| Product Decision | PASS | PASS | PASS | PASS | PASS |
| Candidate Source Formula | PASS | PASS | PASS | PASS | PASS |
| Deployed Backend Verified | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Date/Timezone Verified | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |
| Company Scope Verified | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Backend Permission Verified | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Assistant Authorization Approved | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Disclosure Policy Approved | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |
| Business Labels Verified | PASS | PASS | PASS | PASS | BLOCKED |
| Ready for Implementation | BLOCKED | BLOCKED | BLOCKED | BLOCKED | BLOCKED |

**逐列證據、缺口、owner 與阻擋性（適用五項，個別例外另列）：**

| Gate | 來源與位置 | 尚缺／負責人 | 阻擋實作？ |
| --- | --- | --- | --- |
| Product Decision | 本輪使用者明示決策；[Human Review](./business-semantic-review-batch-01.md) C02–C06 Decision 段 | 無重複產品選擇；具名作業簽核若組織要求由產品 owner 補 | 此列否 |
| Candidate Source Formula | 候選 Backend `src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:68-86,116-269,332-380`、`dashboard-calculate-status-distribution.service.ts:45-163`、`src/common/utils/date.util.ts:351-383`；[verification](./business-semantic-verification-batch-01.md) | deployed formula 另見下列；Customer Backend 技術 owner | 此列否 |
| Deployed Backend Verified | [C01 acceptance](./work-orders-count-acceptance.md) 僅有三期間 E2E，明言未識別部署 commit；候選 `origin/refactor/project-structure` 仍 `PROVISIONALLY_ACCEPTED`；候選 Dockerfile／docker-compose 未提供可綁定 runtime 的 commit label | Customer deployment／release owner 提供目前 SPA 連接的 API deployment ID、不可變 image digest／release→Git SHA 對照，及 route/response trace；不得提供 token | 是，五項 `UNKNOWN` |
| Date/Timezone Verified | 候選 `src/common/utils/date.util.ts:6-13,351-383` 用 JS local time：今天、週一至今天、月初至今天，均以今日 23:59:59.999 結束；C04 只用 endDate | 部署 server TZ、DB `CreatedDate`／`DeliveryDate` 欄位時區／精度及界線測試；Customer Backend／DB owner | 是，五項 `UNKNOWN` |
| Company Scope Verified | 候選 `src/modules/dashboard/dashboard.controller.ts:23-48,63-87`、`dashboard-calculate-business.service.ts:20-66`、`src/core/interceptors/company-info.interceptor.ts:30-59`；詳見安全分析 | 技術／資安 owner 確認無 code／未知類別 fail-closed、Supplier 隔離、System Company 授權範圍；部署版與合法測試帳號跨公司負例 | 是；C06 有明確 override 風險 |
| Backend Permission Verified | 候選 `src/app.module.ts:77-79` 全域 `IDXAuthJwtGuard`；`src/core/guards/idx-auth-jwt.guard.ts:21-55,111-120` 驗 JWT 並載入 Permissions；`src/modules/dashboard/dashboard.controller.ts:11-87` 未見逐 endpoint permission decorator；`src/common/entities/auth/menu-permission.entity.ts:38-40` 有 Dashboard menu seed，但無 read 欄位 | Customer Auth／Backend owner 提供實際 Dashboard read permission 定義、角色與 endpoint enforcement 證據；不能把 `SCM_DASHBOARD` enum 當作 `menu:SCM_DASHBOARD:read` 已 enforced | 是，五項 `BLOCKED` |
| Assistant Authorization Approved | [C01 authority resolution](./work-orders-count-authority-resolution.md) 只證明 C01 的 Tool／policy／manifest 模式；本批沒有 exact ToolDefinition／CustomerToolPolicy | Assistant Security owner 核准 verified identity→permission claim mapping、每項 exact Tool permission、policy provisioning、fail-closed 測試 | 是，五項 `BLOCKED` |
| Disclosure Policy Approved | 候選 `src/modules/dashboard/types/dashboard.type.ts:21-59,78-99` API 有比較欄位／分布；產品只准最小欄位 | Security／Privacy owner 核准 count、百分比、小母數／小 cell、公司總數／期間等 allowlist；實際 response 投影測試 | 是，五項 `BLOCKED` |
| Business Labels Verified | C02–C05 正式名稱、C03 僅「完工」、C04 答案限定語、C05 百分比均由本輪使用者明示；C06 Frontend `utils/status/statusLabel.ts:15-60` 是來源而非業務簽核 | C06 每個 code→label 需業務 owner 具名批准、版本化，未知 enum fail-closed | 只阻擋 C06 |
| Ready for Implementation | 上述逐項 Gate 的 AND 條件 | 各能力各自關閉；不用等 C06 才允許已關閉的 C02–C05 | 五項目前皆阻擋 |

## 部署與路由證據邊界

Frontend 既有 `composables/api/dashboard.ts`／分析 artifact 使用 `/Dashboard/KPIStats`，候選 Backend `src/modules/dashboard/dashboard.controller.ts:63` 註冊 `/Dashboard/KpiStats`。C01 E2E 證明其**既有固定操作**在當時環境 `/Dashboard/KPIStats` 可用，但不識別後端 Git SHA、proxy 大小寫行為或 C02–C06 response。最小部署證據是 release／image digest→Git SHA 的不可變對照、SPA 實際 API 服務 ID、該服務的 route table／受控無敏感資料 trace，以及五欄 KPI 與分布 response contract 測試。未取得前保留 `PROVISIONALLY_ACCEPTED`，不猜 commit、不呼叫真實 Customer business API。

## 公司身分、授權與 C06 override 安全分析

候選全域 JWT guard 只完成身分驗證；`CompanyInfoInterceptor` 由 token 的 `UUID_User` 查 company list，取第一筆，查不到／例外會設 `Company=null`。它未在此處 fail-closed (`src/core/interceptors/company-info.interceptor.ts:30-59`)。`standardizeDtoParams` 以 JWT 公司資訊為候選來源，但 KPI 路由 `allowCompanyCategoryOverride=false` 僅強制 category 來自 JWT；若 category 為 Supplier 而 Company.Code 缺失，`dto.CompanyCode` 仍可能補入。`buildCompanyFilter` 對 Supplier 有 code 才加 `VendorCode`，其他類別有 code 也加，**無 code 則 `{}`**；因此不能在未知／無 code 時宣告公司隔離安全 (`src/modules/dashboard/dashboard.controller.ts:23-48,69-86`; `dashboard-calculate-business.service.ts:53-66`)。C02–C05 均須獨立 runtime/owner 證明 fail-closed；C04 額外核對排除狀態。

C06 分布路由使用 `standardizeDtoParams` 預設 `allowCompanyCategoryOverride=true`：`dto.CompanyCategory = dto.CompanyCategory || jwt.Company.Category`。DTO 明列可選 `CompanyCategory`、`CompanyCode` (`src/modules/dashboard/dtos/dashboard.dto.ts:43-64`)。若 Supplier caller query 指定 `CompanyCategory=SystemCompany`，標準化會清掉 CompanyCode；分布 service 的 `statusFilter` 便用 System Company 11 類，而 `buildCompanyFilter` 得到空 code 回 `{}`，**候選原始碼存在跨公司聚合讀取路徑**。這是靜態風險證據，不聲稱已在部署環境重現。若 query 是未知合法 enum，`statusFilter` 拒絕；若 JWT 公司缺失，query 仍可能指定合法類別，風險更高。`C06_COMPANY_SCOPE_GATE=BLOCKED`。

固定 Customer-local Connector operation 可設空閉合輸入、只發固定 `TimeRange`，不接受 LLM/user 的 `CompanyCategory`、`CompanyCode`、`VendorCode`，並由可信任 native session 帶身分；這能封閉**Assistant 呼叫面**，不能修補其他 caller 可直接送 query 的 Backend 問題，也不能替代 Backend 公司綁定。建議 Customer Backend owner 最小修復：在 Dashboard endpoint 從已驗證身分強制取得 category/code，拒絕缺身分／缺 Supplier code／未知 category，拒絕或忽略 client company override，System Company 全公司查詢須有明確授權；加 Supplier→SystemCompany override、無公司、未知類別及跨 VendorCode 負例。Security owner 審核後才可重評此 Gate。本輪不改 Customer Backend。

Assistant 分層設計（**計畫，未 provision**）：Capability Pack／Binding 只接受已驗證 Customer/integration/HostApp scope 與固定 period enum；ToolDefinition 宣告唯讀及精確 permission；CustomerToolPolicy 對每項／期間進行 Customer 授權；Gateway／Identity Bridge 提供可信任使用者／native session 而非 LLM 文字；Connector 固定 method/path/query、禁 company 參數，驗證 upstream response 並投影 allowlist。各層應 fail-closed；C01 現有模式不是本批的授權替身。見 [C01 authority resolution](./work-orders-count-authority-resolution.md) 與 `specs/011-customer-capability-semantic-discovery/plan.md` 的 verified scope／permission invariant。

## 時間、公式、response 與最小揭露

canonical `today|this_week|this_month` 只映射固定 API 值 `today|thisWeek|thisMonth`。候選 `src/common/utils/date.util.ts:351-383` 期間端點用服務本地時區；DB 時區與部署 TZ 未核實。下表中的 `/Data/...` 是基於候選 controller `Result.ok` 與 C01 接受的 response shape 所提出的**待部署核實 pointer**，不是 C02–C06 runtime 證據。

| 能力 | 候選公式／無資料 | 待核實 pointer 與唯一允許輸出 | 答案／契約限制 |
| --- | --- | --- | --- |
| C02 | `CreatedDate` 期間、目前 `IN_PRODUCTION`，不含 `PRODUCTION_IN_PROGRESS`；count 無資料為 0 | `/Data/InProductionOrders/Current` → 非負整數 count | 不回比較欄位或工單；只在公司／權限 Gate 關閉後使用 |
| C03 | `CreatedDate` 期間、目前 `COMPLETED`；count 無資料為 0 | `/Data/CompletedOrders/Current` → 非負整數 count | 僅「完工」已核對；「完成／結案」走澄清或拒答 |
| C04 | `DeliveryDate < 今日 23:59:59.999`，排三狀態，無期間下界；三 period 可能同值；count 無資料為 0 | `/Data/OverdueOrders/Current` → 非負整數 count | 安全說法：「依 Dashboard 口徑，以今日結束為截止，逾期工單數為 N 張」；不得稱「此刻已逾期」或「本週新增逾期」 |
| C05 | 同公司／期間 `COMPLETED` ÷ 非 `ARCHIVE` 總數 ×100；零分母 0，兩位小數 | `/Data/AvgCompletionRate/Current` → 百分比 number，不是整數 count | 不回分子、分母、比較欄位；LLM 不計算，小母數限制待 Security owner |
| C06 | `CreatedDate` 期間；Supplier 10／System Company 11 狀態；零筆各狀態 count/percentage 0；Backend 整數比例與最大項差額調整 | `/Data/StatusDistribution[]` 每項 `Status/Count/Percentage`；`/Data/TotalOrders`；實際 wrapper 待核實 | 固定最多 11 項；核准 enum／label、必要總數／期間；未知 enum、缺少／重複項、負值、count 加總不等於 total、非零 total 比例不等於 100 應 fail-closed；不輸出 raw rows／VendorCode；小 cell 待核准 |

來源：候選 `src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:116-269`、`dashboard-calculate-business.service.ts:20-45,53-66`、`dashboard-calculate-status-distribution.service.ts:45-163`、`src/common/utils/math.util.ts:105-140`、`src/modules/dashboard/types/dashboard.type.ts:21-99`。C06 內部 `find` 讀 raw rows，但 response 只有聚合；Connector 不得把原始 response 以外的資料或額外欄位帶回。Backend percentage 已存在，LLM 不重算。對 C06 缺少狀態的處理須與實際部署 contract 比較：候選 code 會列出零 count 項，不能擅自補或刪。

## C06 Frontend label 來源（僅 `LABEL_SOURCE_FOUND`，非核准）

候選 Backend `src/common/entities/types/order.type.ts:32-48` enum 與 `dashboard-calculate-status-distribution.service.ts:131-163` 的狀態集合；Frontend `HEAD:utils/status/statusLabel.ts:15-60` 給出下列顯示字，`pages/dashboard/(components)/StatusChart.vue:312-345` 呼叫 `getStatusLabel`。Frontend `HEAD` 是本地檢視的來源版本，**未確認為目前部署 SPA**；下表請業務 owner 逐一核准，不得標為 `HUMAN_VERIFIED`。

| enum code | Frontend 顯示 label 候選 | Supplier | System Company |
| --- | --- | --- | --- |
| `internalPendingSend` | 新模待發送 | — | ✓ |
| `vendorPendingReceive` | 廠商待收貨 | ✓ | ✓ |
| `vendorReceivedPendingProduction` | 待生產 | ✓ | ✓ |
| `inProduction` | 生產中 | ✓ | ✓ |
| `productionCompletedPendingShip` | 廠商待出貨 | ✓ | ✓ |
| `vendorShippedInternalPendingReceive` | 新模待收貨 | ✓ | ✓ |
| `internalReceived` | 新模已收貨 | ✓ | ✓ |
| `completed` | 完工 | ✓ | ✓ |
| `receiveInProgress` | 收發進行中 | ✓ | ✓ |
| `productionInProgress` | 生產進行中 | ✓ | ✓ |
| `deliveryInProgress` | 交付進行中 | ✓ | ✓ |

`archive` 雖有 Frontend 標籤「封存」，不在候選 C06 10／11 類中，不得自行加到 breakdown。Frontend `getStatusLabel` 找不到 code 會回傳原 code (`utils/status/statusLabel.ts:105-116`)；Assistant contract 應對未知 enum fail-closed，而非直接輸出未核准字串。

## 個別 readiness 與後續 implementation 計畫（本輪不執行）

- **C02、C05：**候選公式／產品決策完整，可優先取得部署、公司、Backend read permission、Assistant authorization、disclosure 簽核；兩項各自 Gate 關閉才成為第一個子集合。C05 使用百分比 schema。
- **C03、C04：**產品決策也完整，不必等待 C06。相同安全 Gate 關閉後可與 C02／C05 一次規劃四個 KPI。C03 需固定語彙／澄清測試；C04 需三期間同值可能性與限定語測試。
- **C06：**須先解決 Backend query override 的跨公司風險、批准 11 個 code→label 候選與小 cell 政策，再作獨立 breakdown 設計；不得被四個 KPI 的 Gate PASS 帶過。

對每個獲准項目，後續**獨立核准的 implementation** 才可新增 Customer-scoped Capability Pack 與安全語彙／period mapping、逐 period exact Binding、唯讀 ToolDefinition、CustomerToolPolicy provisioning、Customer-local 固定 Connector operation、response allowlist/schema，並完成 contract／integration／eval（含跨公司、權限拒絕、未知欄位、邊界）及最後 Real Customer E2E acceptance。共用執行模式不共用業務定義或授權。本輪沒有建立／啟用上述任何內容。
