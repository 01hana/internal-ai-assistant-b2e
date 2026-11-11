# Shinmone Business Semantic Review — Batch 01

**Purpose:** obtain only the decisions needed to assess five bounded Dashboard candidates, C02–C06 in the [Business Semantic Catalog](./business-semantic-catalog.md). This is a review worksheet, not implementation approval. `work-orders.count` (C01) is already `HUMAN_VERIFIED`/`E2E_ACCEPTED` and is not being re-reviewed. No candidate below has a Tool, CustomerToolPolicy, Binding or Connector operation merely because its field appears beside `NewOrders`.

**Reviewer / role:** 使用者提供產品決策；具名技術／資安／業務 owner 尚未簽核 · **Decision date:** 正式簽核日待補（本輪記錄於 2026-10-18） · **Environment / source version reviewed:** Backend `origin/refactor/project-structure` 候選 Git object，仍為 `PROVISIONALLY_ACCEPTED`；部署版本待確認。`PRODUCT_DECISION_CONFIRMED` 等是本文件追蹤標籤，**不是** runtime authority status。Catalog 的 C02–C06 仍為 `NEEDS_HUMAN_REVIEW`。逐項證據、差距見 [技術查證](./business-semantic-verification-batch-01.md) 與 [Gate Report](./business-semantic-batch-01-gate-report.md)。

## Shared decision boundary for C02–C06

The existing cross-branch investigation (`B/cross-branch-api-source-investigation.md`, root defined in the Catalog) found executable `GET /Dashboard/KpiStats` with `TimeRange=today|thisWeek|thisMonth` and raw PascalCase KPI fields. The Frontend cross-check (`F/api-usage-crosscheck.md`) observed `/Dashboard/KPIStats`, the three period selections and Chinese UI labels. The accepted C01 mapping confirms current-environment route compatibility for **its own** fixed operation. None of that approves the other metrics' formulas, permissions, disclosure or a future deployed commit. `origin/refactor/project-structure` remains `PROVISIONALLY_ACCEPTED`.

下列 Q1–Q4 及各節「focus」為**原始審查提問留存**，不是本輪要重新詢問使用者的待決產品選擇；已決答案以各節 **Decision** 和 Gate Report 為準。僅部署／技術／資安／正式標籤核准等未關項需後續 owner 處理。原始審查問題如下：

1. **Q1 — formal meaning:** What is the official user-facing name, business object, unit and inclusion/exclusion formula? Is the question a legitimate Assistant need, or `UNSUPPORTED`?
2. **Q2 — time and company:** Are `today`/`thisWeek`/`thisMonth` all valid for this metric? Which business date, server timezone and period boundary apply? Confirm System Company/Supplier filtering, including status and `VendorCode`, rather than inheriting C01 by proximity.
3. **Q3 — permission and disclosure:** Which verified role/scope permits this metric? May Assistant return only `Current`, or also `Previous`, `Change`, `ChangePercentage`, `Trend`/status breakdown? Are low counts or supplier/company comparisons sensitive?
4. **Q4 — execution design:** Is a new exact read-only Tool + fixed Customer-local operation appropriate for each approved period, or is a different bounded contract needed? Identify the authoritative deployed API/response shape and owner; do not authorize dynamic `TimeRange` or user-supplied company filters.

## C02 — `work-orders.in-production-count`

**Observed, not approved:** `Data.InProductionOrders.Current`; UI labels 今日／本週／本月生產中工單. Source investigation associates a technical `IN_PRODUCTION` status with a created-date-based KPI calculation, but branch/model identity is not confirmed as deployed.

- **Q1 focus:** Does “生產中” mean exactly that status, several workflow statuses, or a snapshot of all currently in production? What is counted?
- **Q2 focus:** Does a weekly/monthly card count *orders created during the period and now in production*, or *orders that entered production during the period*?
- **Q3 focus:** Can the Dashboard read scope be approved for this metric specifically, with `Current` only?
- **Q4 focus:** If approved, may the C01 fixed-KPI-operation pattern be reused with a distinct response pointer and exact Tool, after separate contract review?

**Decision:** `PRODUCT_DECISION_CONFIRMED`：正式名稱「生產中工單數」；指定期間內按 `CreatedDate` 建立、查詢時單一 `IN_PRODUCTION`，**不含** `PRODUCTION_IN_PROGRESS`；`today`／`this_week`／`this_month`（API 值為 `today`／`thisWeek`／`thisMonth`）；僅有 Dashboard 檢視權限者可查；Assistant 只回 `Current` 整數，不回前期、變化、趨勢或原始工單。`TECHNICAL_EVIDENCE_CONFIRMED`：候選公式吻合。`SECURITY_REVIEW_PENDING`：真實 Dashboard read permission、公司隔離、Assistant 授權及揭露簽核。`HUMAN_REVIEW_PENDING`：部署 source／時區與具名 owner 確認；未授權實作。**不再詢問是否改計期間內進入生產。**

## C03 — `work-orders.completed-count`

**Observed, not approved:** `Data.CompletedOrders.Current`; UI labels 今日／本週／本月完工工單. Technical source refers to `COMPLETED`; it does not by itself approve “completed during period” as the meaning.

- **Q1 focus:** Are “完工”, “完成”, and “結案” distinct business states? Which statuses count and are archived/deleted records excluded?
- **Q2 focus:** Is the selected period based on `CreatedDate`, completion date, or another event? Does Supplier use the same definition?
- **Q3 focus:** Who may see this aggregate and which comparison fields, if any, may be disclosed?
- **Q4 focus:** Does a separate exact Tool/manifest per approved period fit, or would the approved meaning require an API not present in this KPI field?

**Decision:** `PRODUCT_DECISION_CONFIRMED`：正式名稱「完工工單數」；指定期間內 `CreatedDate` 建立、查詢時狀態 `COMPLETED`；三期間；僅 Dashboard 檢視權限者可查；Assistant 只回 `Current` 整數，不回比較或原始工單。**只有「完工」已確認對應 `COMPLETED`；「完成／結案」不得自動當同義詞，含糊提問須澄清或拒答。**`TECHNICAL_EVIDENCE_CONFIRMED`：候選公式吻合。`SECURITY_REVIEW_PENDING`：真實權限、公司隔離、Assistant 授權／揭露。`HUMAN_REVIEW_PENDING`：部署 source／時區與具名 owner 確認；未授權實作。不再要求產品重決同義詞或前期比較。

## C04 — `work-orders.overdue-count`

**Observed, not approved:** `Data.OverdueOrders.Current`; UI labels 今日／本週／本月逾期工單. The historical Backend analysis says `DeliveryDate < range end` with status exclusions, not necessarily a lower bound at range start.

- **Q1 focus:** Is this “currently overdue as of the selected period end”, “became overdue in the period”, or another definition? Which due date and statuses apply?
- **Q2 focus:** Are today/week/month three genuine business periods here, or does the UI selector only alter a snapshot cutoff? Confirm timezone and company/supplier behavior.
- **Q3 focus:** Is a count-only answer allowed to all Dashboard readers, and are comparison figures allowed?
- **Q4 focus:** Can the fixed KPI response be used without misleading labels, or must the semantic/Tool design wait for another source?

**Decision:** `PRODUCT_DECISION_CONFIRMED` + `PRODUCT_BASELINE_CONFLICT_RESOLVED`：使用者選 A，正式名稱「逾期工單數」，明確採 Dashboard `DeliveryDate < 今天 23:59:59.999`，排 `COMPLETED`／`ARCHIVE`／`INTERNAL_PENDING_SEND`，**沒有期間起點下界**；保留今天／本週／本月選項，即使三個 `Current` 可能相同。僅 Dashboard 檢視權限者可查，Assistant 只回 `Current`。不得說「查詢當下已逾期」或「本週新增逾期」；答案須明示「以今日結束為截止、依 Dashboard 口徑」。先前 `BUSINESS_SEMANTIC_CONFLICT` 是歷史發現，**產品選擇已解決，不代表 Gate PASS**。`TECHNICAL_EVIDENCE_CONFIRMED`：候選公式吻合。`SECURITY_REVIEW_PENDING`：真實權限、公司隔離與 Assistant 授權。`HUMAN_REVIEW_PENDING`：部署 source／服務時區、具名技術及資安 owner 確認；未授權實作。

## C05 — `work-orders.average-completion-rate`

**Observed, not approved:** `Data.AvgCompletionRate.Current`; UI labels 今日／本週／本月平均完工率. The source investigation describes a completed/total ratio over selected records; official denominator, unit, zero-case and rounding are unreviewed.

- **Q1 focus:** What is the numerator/denominator and why is this an “average”? Is output a fraction or percent, and how are zero denominators/rounding handled?
- **Q2 focus:** Which records and date basis enter each period? Does company category change numerator or denominator?
- **Q3 focus:** May Assistant disclose only current rate, or also comparison/trend; is suppression needed for tiny cohorts?
- **Q4 focus:** Can a bounded numeric Tool result represent the approved rate, with a new exact contract rather than reusing C01's integer `count` schema?

**Decision:** `PRODUCT_DECISION_CONFIRMED`：正式名稱「平均完工率」；分子為期間內 `CreatedDate` 建立且目前 `COMPLETED` 數，分母為同期建立且非 `ARCHIVE` 總數；乘 100、零分母回 0、兩位小數；三期間；僅 Dashboard 檢視權限者可查；Assistant 只回 Backend `Current` 百分比數值，不回分子分母／比較／趨勢，LLM 不自行計算。`TECHNICAL_EVIDENCE_CONFIRMED`：候選公式吻合，且不可用 C01 整數 count schema。`SECURITY_REVIEW_PENDING`：公司隔離、真實權限、Assistant 授權及小母數揭露。`HUMAN_REVIEW_PENDING`：部署 source／時區與具名 owner 確認；未授權實作。

## C06 — `work-orders.status-distribution`

**Observed, not approved:** a separate `GET /Dashboard/OrderStatusDistribution?TimeRange=…` route and Frontend 工單狀態分布 chart; cross-branch analysis reports counts/percentages and total. This is a bounded breakdown candidate, not one capability per status value.

- **Q1 focus:** Which status taxonomy, official labels and totals should a user hear? Are `生產中`, `完工`, `結案` distinct? What is the denominator?
- **Q2 focus:** Which business date and period semantics apply, and are company/supplier status sets identical?
- **Q3 focus:** Who may see per-status counts/percentages, especially small cells? What maximum number of categories may be returned?
- **Q4 focus:** Does this require a new reviewed breakdown Tool/schema/Connector operation rather than the C01 count-output pattern? Confirm raw response and deployed owner.

**Decision:** `PRODUCT_DECISION_CONFIRMED`：正式名稱「工單狀態分布」；依**可信任公司身分**，Supplier 10 類、System Company 11 類，不強制統一、不合併刪減或改名；三期間；僅 Dashboard 檢視權限者可查；Assistant 只回核准 status code／中文 label、Backend `Count`／`Percentage` 及必要總數／期間，不回個別工單、VendorCode 或公司 override；使用者／LLM 不得切換公司。`TECHNICAL_EVIDENCE_CONFIRMED`：候選 `CreatedDate`、`Status/Count/Percentage/TotalOrders`、零與整數比例調整；API **不含已核准中文 label**。`HUMAN_REVIEW_PENDING`：具體 code→label 的業務 owner 核准及部署 source；分類差異的產品選擇已完成。`SECURITY_REVIEW_PENDING`：公司類別 query override、真實權限、Assistant 授權、小 cell／bounded disclosure；未授權實作。

## Review outcome and next gate

| Candidate | Human decision (`HUMAN_VERIFIED` / `NEEDS_HUMAN_REVIEW` / `UNSUPPORTED`) | Evidence/reviewer/date | Separate implementation authorized? |
| --- | --- | --- | --- |
| C02 | `NEEDS_HUMAN_REVIEW` | `PRODUCT_DECISION_CONFIRMED`; `TECHNICAL_EVIDENCE_CONFIRMED`; `SECURITY_REVIEW_PENDING`; `HUMAN_REVIEW_PENDING`，2026-10-18 | No |
| C03 | `NEEDS_HUMAN_REVIEW` | `PRODUCT_DECISION_CONFIRMED`; `TECHNICAL_EVIDENCE_CONFIRMED`; `SECURITY_REVIEW_PENDING`; `HUMAN_REVIEW_PENDING`，2026-10-18 | No |
| C04 | `NEEDS_HUMAN_REVIEW` | `PRODUCT_DECISION_CONFIRMED`; `PRODUCT_BASELINE_CONFLICT_RESOLVED`; `TECHNICAL_EVIDENCE_CONFIRMED`; `SECURITY_REVIEW_PENDING`; `HUMAN_REVIEW_PENDING`，2026-10-18 | No |
| C05 | `NEEDS_HUMAN_REVIEW` | `PRODUCT_DECISION_CONFIRMED`; `TECHNICAL_EVIDENCE_CONFIRMED`; `SECURITY_REVIEW_PENDING`; `HUMAN_REVIEW_PENDING`，2026-10-18 | No |
| C06 | `NEEDS_HUMAN_REVIEW` | `PRODUCT_DECISION_CONFIRMED`; `TECHNICAL_EVIDENCE_CONFIRMED`; `SECURITY_REVIEW_PENDING`; `HUMAN_REVIEW_PENDING`，2026-10-18 | No |

產品口徑已由本輪確認；剩餘 Gate 是部署版本、時間區、實際 Backend permission／公司隔離、Assistant 授權及資料揭露 owner 簽核；C06 另需正式 label 簽核。只有逐項 Gate 關閉後，才由獨立 Batch Capability Implementation 請求規劃精確 pack／binding／Tool／policy／manifest 與測試。C07 `TodayShipments` 與 raw-record／PII／log 候選仍不在本批。
