# Shinmone Batch 01 業務語意與技術查證（C02–C06）

查證日：2026-10-18；本輪 Gate 補充見 [Gate Report](./business-semantic-batch-01-gate-report.md)。這是 documentation／planning，不是 implementation approval。五項在 [Catalog](./business-semantic-catalog.md) 均維持 `NEEDS_HUMAN_REVIEW`；[C01 acceptance](./work-orders-count-acceptance.md) 的 Real Customer E2E PASS 原樣保留，不能外推為本批授權。

## 摘要與證據位階

產品決策來自本輪 Human Product Review，詳見 [Batch 01 review](./business-semantic-review-batch-01.md)。技術結論是對 Backend Git object `origin/refactor/project-structure` 的**候選原始碼行為**，不是已確認部署行為；該 ref 仍為 `PROVISIONALLY_ACCEPTED`。既有 Backend sibling repo 的 `.ai-onboarding-analysis/cross-branch-api-source-investigation.md` 與 Frontend sibling repo 的 `.ai-onboarding-analysis/frontend-semantic-crosscheck/api-usage-crosscheck.md` 已重用；本輪只做 Dashboard 相關的定點唯讀查證。Frontend `/Dashboard/KPIStats` 與候選 Backend controller `/Dashboard/KpiStats` 大小寫不同；C01 E2E 只證明其固定操作在當時環境可用，不能證明 C02–C06 的部署公式。另一 `/Kanban` inventory 與 Frontend `/Dashboard*` 欄位也不一致，不選其中一支當權威。

`MATCH` 表示**候選原始碼中的所述公式／輸出**符合已確認產品要求，不含部署、資安或 Tool 授權；`CONFLICT` 表示有來源支持的語意差距；`UNKNOWN` 表示不足以判定。`PRODUCT_DECISION_CONFIRMED`、`TECHNICAL_EVIDENCE_CONFIRMED`、`SECURITY_REVIEW_PENDING`、`HUMAN_REVIEW_PENDING` 僅為文件追蹤標籤，不是新增 runtime status。C04 的歷史 `BUSINESS_SEMANTIC_CONFLICT` 已因使用者選擇 Dashboard baseline 改記 `PRODUCT_BASELINE_CONFLICT_RESOLVED`；僅產品選擇已解，不表示 Gate PASS。

| Capability | 產品決策 | Backend 實際公式／行為（候選 ref） | 是否一致 | 待決問題 | 可否進實作 |
| --- | --- | --- | --- | --- | --- |
| C02 `work-orders.in-production-count` | 期間內 `CreatedDate` 建立、目前單一 `IN_PRODUCTION`（不含混合狀態）；三期間；Dashboard read；只回 `Current` 整數 | 單一 `IN_PRODUCTION`；`CreatedDate` 所選期間；KPI 有 `Current` | `MATCH`（候選公式） | 部署版、時區、公司隔離及正式授權／揭露 | 否；Gate 未關 |
| C03 `work-orders.completed-count` | 期間內 `CreatedDate` 建立、目前 `COMPLETED`；三期間；Dashboard read；只回 `Current` 整數；「完成／結案」不自動同義 | 單一 `COMPLETED`；`CreatedDate` 期間；KPI 有 `Current` | `MATCH`（候選公式） | 部署版、時區、公司隔離及正式授權／揭露 | 否；Gate 未關 |
| C04 `work-orders.overdue-count` | **產品已選 A**：`DeliveryDate < 今日結束`、排三狀態、三期間、Dashboard read、只回 `Current`；不得說即時或期間新增 | 三個 `TimeRange` 均以今天 23:59:59.999 為上限、無期間下界，故 `Current` 可能相同 | `MATCH`（產品 baseline 已選；歷史衝突 `PRODUCT_BASELINE_CONFLICT_RESOLVED`） | 部署版、時區、公司隔離及正式授權／答案措辭 | 否；Gate 未關 |
| C05 `work-orders.average-completion-rate` | 指定期間完工數 ÷ 同期非歸檔總數 ×100；零分母 0、兩位小數；Dashboard read；只回 Backend 百分比 | 同期 `COMPLETED` ÷ 同期非 `ARCHIVE` 工單 ×100；零分母 0；小數兩位；`Current:number` | `MATCH`（候選公式） | 部署版、時區、公司隔離、小母數政策及正式授權 | 否；Gate 未關 |
| C06 `work-orders.status-distribution` | 按可信任公司身分 Supplier 10／System Company 11 類；三期間；Dashboard read；只回核准 code/label、Backend count/percentage，無明細 | `CreatedDate`；10／11 類；`Status/Count/Percentage/TotalOrders`；Backend 整數百分比 | `MATCH`（候選數值公式）；正式 label `UNKNOWN` | 公司類別 override、label 業務核准、部署版、小 cell／授權 | 否；需獨立 breakdown contract |

## 共通路徑、時間與公司邊界

- 候選 Backend controller `src/modules/dashboard/dashboard.controller.ts:63-87` 提供 `GET /Dashboard/KpiStats` 與 `GET /Dashboard/OrderStatusDistribution`；`standardizeDtoParams` 在 `:23-48` 從 JWT 公司資訊取得 category、非 System Company 的 code 與公司設定期間。KPI 路由使用 `allowCompanyCategoryOverride=false`，分布路由使用預設 `true`；**後者可由 query 的 `CompanyCategory` 優先覆蓋 JWT 類別**，若指定 System Company 則清掉 code，候選 source 顯示跨公司聚合讀取風險，Gate `BLOCKED`（詳見 Gate Report）。DTO `src/modules/dashboard/dtos/dashboard.dto.ts:18-64` 列三種 TimeRange 及可選公司欄位；固定操作不得開放使用者自填 company filter。
- `src/common/utils/date.util.ts:6-13,351-383`：`today` 是今日 00:00 至 23:59:59.999；`thisWeek` 週一至**今天結束**；`thisMonth` 月初至**今天結束**，不是週末／月末；用 JS local time，服務執行時區尚未確認。C02、C03、C05、C06 依 `CreatedDate` 篩期間；C04 使用 `DeliveryDate` 的上限，沒有起點下限。
- `src/modules/dashboard/services/dashboard-calculate-business.service.ts:20-45,53-66`：指定狀態時排 `ARCHIVE`，未指定時排 `ARCHIVE`；Supplier 有 code 時 `VendorCode=companyCode`，其他類別若 code 存在亦依 `VendorCode` 篩，無 code 則不加 VendorCode 篩選。這是 source fact，System Company／Supplier 可見範圍與空 code 的安全性仍待審核。
- `src/modules/dashboard/types/dashboard.type.ts:21-59,78-99`：KPI 是 `Current/Previous/Change/Trend/ChangePercentage?`，分布是 `Status/Count/Percentage` 和 `TotalOrders`。只取 allowlisted 欄位，其他比較欄位不得因 API 有提供就洩露。候選原始碼沒有證明 `menu:SCM_DASHBOARD:read` 對五項的 endpoint enforcement 或 Assistant 授權；Frontend 顯示權限不是授權證據。`src/common/entities/auth/types/menu.type.ts:6` 僅證明 `SCM_DASHBOARD` menu enum 存在。

## 逐項技術證據與未決事項

### C02 — `MATCH`（候選來源）

`src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:126-132,332-380` 以唯一 `OrderMasterStatus.IN_PRODUCTION` 呼叫通用 KPI；通用計數使用上述 `CreatedDate`、公司過濾與當期／比較期。`src/common/entities/types/order.type.ts:32-48` 中 `IN_PRODUCTION='inProduction'` 與 `PRODUCTION_IN_PROGRESS='productionInProgress'` 是兩個狀態；候選公式**不**含後者。若產品所謂「生產中」其實要算混合狀態，須重新決策，不能偷偷擴充。可只映射 `Data.InProductionOrders.Current`，但部署／權限未決。

### C03 — `MATCH`（候選來源）；同義詞 `UNKNOWN`

`src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:116-119,332-380` 只計 `COMPLETED`，依 `CreatedDate`，不按完成事件日期。`src/common/entities/types/order.type.ts:41,48` 將 `COMPLETED` 與 `ARCHIVE` 分列；候選公式沒有「結案」獨立狀態。此事**不足以**核准「完工／完成／結案」可互作 Assistant utterance。同時 `Data.CompletedOrders.Current` 仍是輸出候選，產品尚未最終簽核只回 Current。

### C04 — `PRODUCT_BASELINE_CONFLICT_RESOLVED`（產品改選 Dashboard 當日結束口徑）

`src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:212-269` 對 `DeliveryDate` 作 `LessThan(currentEndDate)`，排 `COMPLETED`、`ARCHIVE`、`INTERNAL_PENDING_SEND`，套用公司過濾，並回傳 `Current` 等 KPI 欄位。`src/common/utils/date.util.ts:351-383` 把三種當期的 endDate 都設為**今天 23:59:59.999**；無期間起點下界，故三個 `Current` 可能相同，也可能包括今天稍後才到期者。使用者已明確選擇這個 Dashboard baseline，先前「查詢當下」與來源不符的產品衝突記為 `PRODUCT_BASELINE_CONFLICT_RESOLVED`；不等於部署、時區、公司隔離或授權 Gate PASS。安全答案需說「依 Dashboard 口徑，以今日結束為截止的逾期工單數」，不得說「此刻已逾期」或「本週新增逾期」。候選服務只看**目前**狀態，不能證明歷史快照。

### C05 — `MATCH`（候選來源）

`src/modules/dashboard/services/dashboard-calculate-kpi.service.ts:139-205`：分子 `countOrdersByStatus(COMPLETED)`、分母 `countOrdersByStatus(null)`，均使用所選 `CreatedDate` 期間與同一公司條件；分母由 `src/modules/dashboard/services/dashboard-calculate-business.service.ts:33-45` 排 `ARCHIVE`。`Current = Math.round((分子/分母×100)×100)/100`，分母 0 時是數值 `0`；`src/modules/dashboard/types/dashboard.type.ts:49-59` 指定 `Current:number`。名稱雖為「平均」，來源不是逐筆完成率平均，而是完成件數比例；因產品明確沿用 Dashboard 算法，此處符合，但呈現應標百分比，不可把 25 解成 0.25 或讓 LLM 推算。實際 runtime JSON 型態仍須技術 owner 驗收。

### C06 — 候選公式 `MATCH`；label 與安全 Gate 未關

`src/modules/dashboard/services/dashboard-calculate-status-distribution.service.ts:45-63,73-124,131-163`：選定期間內 `CreatedDate`、`Status In(statuses)`、公司過濾；內部讀工單後只輸出逐狀態 `{Status,Count,Percentage}` 及 `TotalOrders`，含零件數狀態。Supplier 10 類、System Company 11 類（多 `INTERNAL_PENDING_SEND`），均未含 `ARCHIVE`；`src/common/entities/types/order.type.ts:32-48` 列 enum code。使用者已批准**依可信任公司身分使用不同分類**，不再要求統一。來源 API 不給中文 label；Frontend `utils/status/statusLabel.ts:15-60` 有顯示對照，卻**沒有業務 owner 核准證據**。詳細對照及 C06 query override 風險見 Gate Report。

`src/common/utils/math.util.ts:105-140`：總數 0 時所有比例 0；其餘各項先四捨五入為整數百分比，再將差額調整至最大項，使加總 100（同分時取先出現項）。Backend 已計算比例，LLM 不需也不應自行計算。安全輸出應是獨立 bounded breakdown schema：固定最多 11 個 enum 類別、每項非負整數 count 與 Backend percentage、total/timeRange，不含個別工單或內部 `find` 的 raw rows；需檢驗 count 合計、百分比零值／總和及 small-cell policy。分布路由的公司類別覆蓋可能性尤其須審核。

## 批次實作可行性與 gate

C02／C03／C05 在**條件通過後**可借用 C01 的 fixed read-only KPI operation 架構與固定 `today|thisWeek|thisMonth` 參數設計；每一能力仍需各自的 exact ToolDefinition、Binding、CustomerToolPolicy、Connector manifest operation、response pointer／型別與測試，不能共用 C01 的業務定義或授權。C05 是百分比數值，不可沿用整數 `count` schema。C04 的語意衝突須先解決；C06 需另立 bounded breakdown schema 與權限／小 cell 測試，不適合套 count-only operation。

**本輪可進 production implementation：無。** 產品決策均已完成；最小可控的**條件式**下一批可先考慮 C02、C05，若 C02–C05 各自的部署／公司／權限／揭露 Gate 均關閉，也可一次規劃四個 KPI。C06 因獨立 breakdown、公司類別 override、label 與小 cell 政策而分開處理。所有候選仍須先確認部署 commit、endpoint/response、公司及時區、Dashboard 權限到 Assistant 授權映射與 owner 簽核；未完成前不得建立或啟用 Tool／policy／manifest。
