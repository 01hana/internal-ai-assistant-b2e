# Shinmone Business Semantic Catalog — review candidate inventory

**Scope:** `customer-shinmone-scm-local` / `shinmone-scm-assistant-local` / `shinmone-scm`. **Compiled:** 2026-10-16 from existing analysis artifacts only. This catalog is documentation and batch planning, not a Capability Pack, Tool registry, permission policy, Connector manifest, or deployment instruction. It does not activate a candidate. The historical Backend/Frontend analyses predate the accepted [three-period `work-orders.count`](./work-orders-count-acceptance.md); their old “unsupported count” conclusion must not override that acceptance. `origin/refactor/project-structure` remains `PROVISIONALLY_ACCEPTED` as a deployed-source candidate, not a confirmed deployed commit.

```text
TOTAL_DOMAINS=5
TOTAL_CAPABILITY_CANDIDATES=18
HUMAN_VERIFIED=1
NEEDS_HUMAN_REVIEW=17
AI_INFERRED=0
E2E_ACCEPTED=1
EXECUTION_CANDIDATE=17
NO_EXECUTION_PATH=0
BATCH_1_CANDIDATE_COUNT=5
BATCH_2_CANDIDATE_COUNT=7
BLOCKED_COUNT=5
```

Counts cover the 18 rows in the candidate table: one accepted reference, five Batch 1 review candidates, seven Batch 2 review candidates, and five Later/Blocked candidates. `AI_INFERRED=0` is the *row-level review status*: proposed labels/meanings remain hypotheses inside rows marked `NEEDS_HUMAN_REVIEW`; it does not mean the draft contains no AI-assisted suggestions. `EXECUTION_CANDIDATE` means source evidence suggests an API/field to investigate, **not** a reviewed, enabled Assistant path. No candidate beyond `work-orders.count` has an approved Tool/Binding/manifest here.

## Evidence index and limits

The following roots are local source references, not copied runtime artifacts:

- `B = /Users/evalin/Documents/my proj/B2E/idx-shinmone-scm-backend/.ai-onboarding-analysis/`
- `F = /Users/evalin/Documents/ideaxpress proj/idx-shinmone-scm-frontend/.ai-onboarding-analysis/frontend-semantic-crosscheck/`
- `A = docs/customer-onboarding/shinmone/` in this repository.

| ID | Existing artifact / purpose | Current or historical; can establish | Cannot establish |
| --- | --- | --- | --- |
| B1 | `B/source-inventory.md`, `B/api-inventory.md` — working-tree Backend inventory | Historical 2026-10-08 technical route/DTO/service facts: six reads, five writes; Kanban and announcement ambiguity; user/role/operation-log shapes. | Complete deployed API surface; Dashboard support absent from that working tree is not global absence; business approval or effective deployed permission. |
| B2 | `B/business-concepts.yaml`, `B/capability-candidates.yaml`, `B/semantic-evals.yaml`, `B/human-review.md` — proposals and review queue | Historical candidate grouping, example utterances, technical gaps, question IDs HR-001–012. | Human-verified meaning, registered Tool, production support; old `work-orders.count=UNSUPPORTED` is superseded. |
| B3 | `B/cross-branch-api-source-investigation.md` — local Git-object comparison | Historical 2026-10-15 executable Dashboard/Outsource source candidates, six KPI raw fields, time/date calculation candidates, status-distribution/alert routes, Auth Backend split, and branch conflicts. | Remote freshness, deployed commit identity, approved business meaning, per-capability Assistant permission, safe disclosure. |
| F1 | `F/frontend-source-inventory.md`, `F/api-usage-crosscheck.md` — UI/API usage | Historical relative paths, request values, consumed fields, UI labels, client-side filters; `/User*` and `/AuthUser*` are different service surfaces per B3. | Server-side authorization, Backend calculation, Tool permission or disclosure approval. |
| F2 | `F/ui-vocabulary.yaml`, `F/capability-crosscheck.yaml`, `F/frontend-review-findings.md` — vocabulary and unresolved mappings | Historical wording, six initial candidate cross-checks, `/Dashboard*`, `/Log/Login`, `/Outsource*` usage and source conflicts. | Synonym equivalence, deployed source owner, business meaning, production acceptance. Its local lint failure was pre-existing in that Frontend analysis, not this catalog's validation. |
| A1 | [`work-orders-count-authority-resolution.md`](./work-orders-count-authority-resolution.md) — pre-implementation gap analysis | Historical decision trail, CreatedDate/company-scope questions, prior route-casing conflict. | Current day/week support or current E2E status. |
| A2 | [`work-orders-count-acceptance.md`](./work-orders-count-acceptance.md) — human E2E closure | Current accepted scope, approved count semantics, three periods and human-reported matching Dashboard results. | Exact deployed Backend Git commit, approval of other KPI fields or permissions. |
| P1 | [Capability Pack](../../../customer-capability-packs/shinmone-scm-local/1.0.0.json), [Tool seed](../../../scripts/seed.ts), [three manifests](../../../apps/customer-connector-runtime/integrations/shinmone/) and [Customer tests](../../../test/integration/feature011-capability-resolution.spec.ts) | Current repository's exact `work-orders.count` semantics/bindings, read-only Tool definitions, fixed operation mapping, automated regression. | Other KPI Tool/Binding existence; real account's permissions; other raw response fields' disclosure approval. |

No Backend or Frontend source tree was recrawled. `TARGETED_SOURCE_LOOKUP_COUNT=0`: existing artifacts supplied the technical shape used below. Source conflicts are retained rather than silently reconciled.

## Business domain map and granularity

| Domain (user concept, not controller) | Business objects and observed operations | Catalog treatment |
| --- | --- | --- |
| Dashboard / 工單 KPI | 工單 aggregate metrics, status distribution, alert-order list; `NewOrders`, `InProductionOrders`, `CompletedOrders`, `TodayShipments`, `OverdueOrders`, `AvgCompletionRate` observed under one KPI response (B3/F1). | Six metrics are technical observations, not six approved meanings. Existing new-order count is one capability with `timeRange`, not three utterance-specific capabilities. Distribution and alert list are distinct user needs/output shapes. |
| Platform announcement | Current platform announcement via Backend setting candidate; no active Frontend usage (B1/F1). | One candidate, not separate `/Kanban` and `/Setting/AnnouncementTest` capabilities. Source choice remains open. |
| Company identity and roles | Company user list/detail and role options (B1/B3/F1). | List/detail/role-list are separate bounded user needs. `/AuthUser*` and `/User*` are distinct service surfaces; no route alias or shared enforcement is assumed. Individual profile fields are not separate capabilities. |
| Audit / activity history | Backend system-operation logs, Frontend login logs, and work-order change history (B1/F1/B3). | Three distinct event types; do not merge their `Success/Failed` versus `success/fail` statuses, permission or disclosure rules. |
| Outsource / 工單 records | Outsource list, master detail, change history, process-condition detail (B3/F1). | One list and one detail need rather than a capability per `Status`, `WorkOrderNo`, vendor or date field. Process detail and history retain distinct identifiers/data sensitivity pending review. |

Kanban's DTO-only `PendingPurchase`, `PendingReceipt`, `PendingShipment`, `PendingOrder`, `UnfinishedWorkOrder` and entity-only outsource concepts are recorded as **excluded observations**, not capabilities: B1 found no active executable Kanban metrics and B3 found a different Dashboard source. Backend's five write routes are inventory-only and outside read-only planning. These exclusions prevent counting a response field, entity or write endpoint as an Assistant capability by default.

## Candidate catalog

Every row has `Semantic Review Status` = `HUMAN_VERIFIED` only for C01, otherwise `NEEDS_HUMAN_REVIEW`; every unapproved label/meaning/example is a *candidate*, not approved vocabulary. `Execution Readiness` uses only planning values: `NOT_ASSESSED` (path unexamined), `NO_EXECUTION_PATH` (no approved executable mapping), `EXECUTION_CANDIDATE` (API/response evidence but no human approval/implementation), `EXECUTION_READY` (reviewed exact path pending real E2E), `E2E_ACCEPTED` (human-approved E2E). The readiness value grants nothing at runtime.

| ID / Domain / Business object | Capability candidate key; safe label / business meaning / user need | Canonical parameters and recognized values; candidate data source / relevant fields | Status / readiness / batch | Existing Tool, Binding, Connector; evidence; open Human Review |
| --- | --- | --- | --- | --- |
| C01 Dashboard / 工單 | **`work-orders.count`**; **新增工單數** — approved count by `CreatedDate`; “今天／本週／本月新增多少工單？” | Required `timeRange`: `today`, `this_week`, `this_month`; `GET /Dashboard/KPIStats`, `/Data/NewOrders/Current` → `count`. | `HUMAN_VERIFIED` / `E2E_ACCEPTED` / Reference | Exact today/weekly/monthly Tools, Bindings and manifests in P1; A2 human E2E `PASS`. No rename, implementation or re-review requested. |
| C02 Dashboard / 工單 | `work-orders.in-production-count` 生產中工單數；產品已定 `CreatedDate` 期間＋目前單一 `IN_PRODUCTION`，不含混合狀態；只回 Current。 | 三期間；`InProductionOrders.Current` (B3/F1)。 | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 1 | 產品決策已記錄；部署、公司隔離、Dashboard 權限與 Assistant 授權 Gate 未關，見 Gate Report。 |
| C03 Dashboard / 工單 | `work-orders.completed-count` 完工工單數；產品已定 `CreatedDate` 期間＋目前 `COMPLETED`；只回 Current，「完成／結案」不自動同義。 | 三期間；`CompletedOrders.Current` (B3/F1)。 | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 1 | 產品決策已記錄；部署與安全 Gate 未關，見 Gate Report。 |
| C04 Dashboard / 工單 | `work-orders.overdue-count` 逾期工單數；產品選 Dashboard 當日結束 `DeliveryDate` 截止、排三狀態；不得說即時或期間新增。 | 三期間共用今日結束上界、無下界；`OverdueOrders.Current` (B3/F1)；`PRODUCT_BASELINE_CONFLICT_RESOLVED`。 | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 1 | 產品已決；部署、時區、公司隔離及授權 Gate 未關，見 Gate Report。 |
| C05 Dashboard / 工單 | `work-orders.average-completion-rate` 平均完工率；產品已定同期完成數／非歸檔總數×100、零分母 0、兩位小數；只回 Backend Current 百分比。 | 三期間；`AvgCompletionRate.Current` (B3/F1)，不可用整數 count schema。 | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 1 | 產品已決；部署、公司隔離、權限與小母數揭露 Gate 未關，見 Gate Report。 |
| C06 Dashboard / 工單狀態 | `work-orders.status-distribution` 工單狀態分布；產品已定依可信任公司身分 Supplier 10／System Company 11 類、不統一；只回核准 label/code、Backend count/percentage。 | 三期間；`GET /Dashboard/OrderStatusDistribution`；Backend 不回中文 label (B3/F1)。 | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 1 | 公司類別 query override、正式 label、小 cell 與授權 Gate 未關；獨立 bounded breakdown。 |
| C07 Dashboard / 出貨 | `shipments.count`; candidate 出貨數 — “本週出貨幾筆？” Name `TodayShipments` conflicts with week/month UI labels; B3 says CreatedDate plus shipped status. | Proposed `timeRange` not approved; KPI `TodayShipments.Current` (B3), UI `todayShipments` (F1/F2). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Later/Blocked | None. B3/F1/F2; Q5: actual event/date basis, whether non-today periods are valid. Do not equate creation with shipment without approval. |
| C08 Dashboard / 預警工單 | `work-orders.alert-list`; candidate 預警工單清單 — “有哪些逾期或即將到期的工單？” Raw-record list, not C04 aggregate. | Candidate alert category and pagination/limit, not approved; `GET /Dashboard/AlertOrder`, overdue/upcoming/urgent lists (B3/F1). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B3/F1; Q6: scope, identifiers, due dates, limits and field allowlist. |
| C09 Platform announcement / 公告 | `platform-announcement.read`; candidate 平台公告 — “目前有什麼公告？” Not a publish/update operation. | No parameter established; Backend `GET /Setting/AnnouncementTest` candidate, uncertain `Data.SupplyChainPlatformAnnouncement`; `/Kanban` is unusable/unconfirmed in B1; F1 shows neither used. | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B1/B2/F1; Q7: authoritative endpoint, shape, visibility and whether a test-named route is production eligible. |
| C10 Company identity / 使用者集合 | `company-users.list`; candidate 公司使用者清單 — “公司有哪些使用者？” Detail fields are not separate capabilities. | Implicit verified company (not caller-supplied); Backend `GET /AuthUser`, Frontend `GET /User?UUID_Company=…` are separate service surfaces (B1/B3/F1). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B1/B2/B3/F1; Q8: select actual service, server scope, role and minimized output. Do not merge routes as aliases. |
| C11 Company identity / 使用者 | `company-user.detail`; candidate 使用者資料 — “查已知 UUID 的帳號資料？” Not a name-search Tool. | Candidate `userUuid` exact UUID; Backend `/AuthUser/:UUID`, Frontend `/User/{UUID}` separate (B1/B3/F1); broad account/contact/role fields. | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Later/Blocked | None. B1/B2/B3/F1; Q9: record-level company isolation and PII allowlist. Backend inventory says no local membership filter on detail. |
| C12 Company identity / 角色 | `user-roles.list`; candidate 使用者角色清單 — “有哪些可見角色？” “可指派” is not yet proven equivalent. | No parameter established; Backend `/AuthUser/Role`, Frontend `/User/RoleOption` separate (B1/B3/F1), labels/IDs/memos differ. | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B1/B2/B3/F1; Q10: global/company/caller-visible/assignable meaning and disclosed fields. |
| C13 Audit / 系統操作 | `operation-logs.search`; candidate 操作紀錄查詢 — “查今天失敗的操作？” Not a login-log search. | Candidate `outcome={Success,Failed}`, category/type/actor and start/end time; Backend `GET /Log/SystemOperation`, `Data[]` with content/metadata (B1/B2). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Later/Blocked | None. B1/B2/F1; Q11: retention, completeness, raw content/metadata redaction, permission and cap. |
| C14 Audit / 登入事件 | `login-logs.search`; candidate 登入記錄 — “查近七日登入失敗紀錄？” Separate from C13. | Candidate date range/outcome; Frontend `GET /Log/Login`, visible time/account/IP/status; seven-day cap is **UI-only**, not proven Backend rule (F1/F2). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. F1/F2; Q12: API owner, server cap, IP/identity disclosure and permission. |
| C15 Outsource / 工單集合 | `outsource-work-orders.list`; candidate 委外工單清單 — “列出目前可看的工單？” Not a capability per list column or filter. | Candidate `view={all,materials,production,delivery,archive}` and reviewed bounded filters; Frontend `GET /Outsource`, B3 executable refs; summary/status/vendor fields. | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B3/F1/F2; Q13: deployed owner, company/vendor scope, paging and field allowlist. |
| C16 Outsource / 工單 | `outsource-work-orders.detail`; candidate 委外工單明細 — “這張工單有哪些明細？” No separate capabilities for status/date/vendor/number. | Candidate master `workOrderUuid`; `GET /Outsource/:UUID`, nested `Details[]`/`ProcessDetails[]` (B3/F1). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Batch 2 | None. B3/F1; Q14: record ownership, allowed master/detail fields, UUID resolution and bounds. |
| C17 Outsource / 工單異動 | `outsource-work-orders.change-history`; candidate 工單異動紀錄 — “這張工單有哪些異動？” Distinct from system/login logs. | Candidate `workOrderUuid` and bounded time/filter; `GET /Outsource/:UUID/Log`, `Logs[]` (B3/F1). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Later/Blocked | None. B3/F1; Q15: B3 branch conflict where route is `@Public()` in later refs, record-level scope and redaction. |
| C18 Outsource / 加工條件 | `outsource-work-orders.process-conditions`; candidate 工單加工條件 — “這項明細的加工要求？” Different detail UUID and potentially sensitive memos. | Candidate `detailUuid`; `GET /Outsource/Detail/:UUID/ProcessDetail`, condition/requirement/internal/vendor memo fields (B3/F1). | `NEEDS_HUMAN_REVIEW` / `EXECUTION_CANDIDATE` / Later/Blocked | None. B3/F1; Q16: parent ownership check, field-level confidentiality and bounded output. |

## Parameter catalog (Shinmone-scoped)

Only C01's `timeRange` is approved and executable. Reusing its *name* elsewhere is a review question, not automatic equivalence of date basis, comparison period, or backend filtering.

| Candidate parameter / business meaning | Recognized aliases or technical values | Executable now? | Used by; evidence; semantic status |
| --- | --- | --- | --- |
| `timeRange` / C01 CreatedDate count period | `today` 今日/今天; `this_week` 本週/這週/這個禮拜; `this_month` 本月/這個月/本月份. Upstream fixed `today`/`thisWeek`/`thisMonth`. | **YES, C01 only** | C01; A2/P1; `HUMAN_VERIFIED`. C02–C07/C06 may propose a similarly named parameter after separate metric-specific review (B3/F1). |
| `view` / Outsource UI work area | Technical `all`, `materials`, `production`, `delivery`, `archive`; UI tabs/labels in F1/F2. | NO Assistant mapping | C15; B3/F1/F2; `NEEDS_HUMAN_REVIEW` (status sets differ by company category and ref). |
| `workOrderUuid` / selected master record | UUID handoff from list to detail/log; not free-text work-order number. | NO | C16/C17; B3/F1; `NEEDS_HUMAN_REVIEW` for current-company ownership and natural-language resolution. |
| `detailUuid` / selected process detail | Path UUID for process detail; not interchangeable with master UUID. | NO | C18; B3/F1; `NEEDS_HUMAN_REVIEW`. |
| `userUuid` / exact user identifier | Backend `/AuthUser/:UUID` and Frontend `/User/{UUID}` technical identifiers; no proven name→UUID API. | NO | C11; B1/B3/F1; `NEEDS_HUMAN_REVIEW`. |
| `outcome` / event result | Operation log: `Success`/`Failed` (B1); login log UI: `success`/`fail` (F1). **Not merged.** | NO | C13/C14 respectively; `NEEDS_HUMAN_REVIEW` for cross-source meaning. |
| Event time start/end / search interval | Backend operation log inclusive timestamps (B1); login UI “近7日” and max-seven-day validation are client-only (F1). | NO | C13/C14; `NEEDS_HUMAN_REVIEW` for server limits/timezone. |
| Operation-log category/type/actor/text | Backend optional technical filters; category/type vocabularies and substring behavior need review. | NO | C13; B1/B2; `NEEDS_HUMAN_REVIEW`. |
| Shipment/delivery/vendor/status list filters | B3/F1 observe technical query fields and UI labels; supplier `VendorCode` belongs to trusted Backend context, **not** a user/LLM scope override. | NO | C15; B3/F1; `NEEDS_HUMAN_REVIEW` for filter allowlist and company boundary. |

## Vocabulary consolidation (all Shinmone-scoped)

| Group | Observed / approved terms | Equivalence boundary |
| --- | --- | --- |
| Business objects | `工單` (C01 approved), `委外工單` / `Outsource` / refactored `Order` (B3/F2), 使用者/帳號 (B1/F2), 角色 (B1/F2), 系統操作日誌 (B1), 登入記錄 (F1), 公告 (B1). | `工單`, `委外工單`, `訂單` and Backend model names are not automatically identical. `/User*` and `/AuthUser*` are separate service surfaces. |
| Metric terms | Approved 新增工單數 for C01; observed 生產中工單、完工工單、逾期工單、出貨數、平均完工率, 狀態分布 (B3/F1/F2). | UI labels and response names are evidence of usage, not approved formulas. `TodayShipments` versus dynamic week/month labels is open. |
| Action terms | 查詢、列出、看明細、搜尋、篩選 (B2/F1). Backend also has create/update/active-change routes (B1). | Write verbs are not read-only capability authorization. |
| Status terms | Dashboard `InProductionOrders`/`CompletedOrders` and Outsource UI status labels including 生產中、完工、封存 (B3/F2); operation-log `Success/Failed` versus login-log `success/fail` (B1/F1). | “完成”, “結案”, “完工” are **not** auto-synonyms. Dashboard KPI status, master status, and login/operation outcome require separate review. |
| Time terms | C01 today/this_week/this_month approved; dashboard UI 今日/本週/本月 observed (A2/F2); login UI 近7日 (F1). | Same word does not prove same date basis, timezone, range cap or comparison period across capabilities. |

## Permission and disclosure matrix

**No inherited permission from a shared endpoint.** C02–C06 的產品方向已定為「具 Dashboard 檢視權限者可查」，但這不是已驗證的 Backend endpoint enforcement、`menu:SCM_DASHBOARD:read` 對應、Assistant 授權或 Customer policy provision。只有 C01 有既有 exact Customer policy；Frontend 可見性不是權限證據。詳見 [Gate Report](./business-semantic-batch-01-gate-report.md)。

| IDs | Permission known? / source | Output sensitivity; raw detail vs aggregate | Company scope / cross-company risk / human review |
| --- | --- | --- | --- |
| C01 | YES: ToolDefinition, CustomerToolPolicy and A2; `menu:SCM_DASHBOARD:read`. | Bounded aggregate integer only. | Approved Backend authenticated-company semantics; E2E accepted for stated scope. |
| C02–C05 | 產品已定 Dashboard read 使用者可查；Backend enforcement、Assistant exact authorization／policy 均未批准。 | C02–C04 只准 `Current` 整數；C05 只准 Backend `Current` 百分比；不准比較或 raw orders，最終揭露簽核待辦。 | 公司隔離、無 code fail-closed 及跨公司負例待 Customer Backend／Security owner；C04 產品 baseline 已決。 |
| C06 | 產品已定 Dashboard read 使用者可查；Backend enforcement／Assistant 授權未批准。 | 最多 11 類 bounded breakdown；Frontend label 不是業務核准；小 cell 政策待簽。 | query company category override 的跨公司風險已見候選 source；Gate `BLOCKED`。 |
| C07 | **NO**；本批未審查。 | 不繼承 C02–C06 的揭露決策。 | 仍需獨立審查。 |
| C08 | NO; B3/F1 only. | Raw alert-order lists/identifiers/dates: higher sensitivity than KPI aggregate. | Per-record company and supplier scoping, paging and field allowlist required. |
| C09 | NO; B1/F1 source/usage unresolved. | Announcement text candidate, likely lower sensitivity but audience not established. | Global versus company scope and production route require review. |
| C10–C12 | NO; B1/B3/F1 show technical auth context/fields, not Assistant policy. | Raw user/role data, PII/privilege metadata; no Frontend-visible field is automatically allowed. | Separate Auth service and current-company/record membership need approval; C11 high cross-company risk. |
| C13–C14 | NO; B1/F1 show different log systems. | Raw content/metadata or account/IP are sensitive. | Company filter, retention, redaction, role and maximum result count need review. |
| C15–C18 | NO; B3/F1 technical source only. | Raw business records, memos, vendors, process details, change history; field-by-field allowlist required. | B3 has supplier list filter but detail/log ownership unproven; C17 public-route branch conflict; C18 parent-detail scope unproven. |

## Human Review questions and batch decision

The [Batch 1 review sheet](./business-semantic-review-batch-01.md) asks Q1–Q4 for only C02–C06. The remaining questions stay here for later scoped review:

- **Q5 (C07):** Does `TodayShipments` count shipments or orders created with a shipped status? Is the week/month UI label formally valid, and what is its date basis?
- **Q6 (C08):** Which alert categories/records, fields, ordering, result cap, company/record permission and disclosure policy are approved?
- **Q7 (C09):** Is the current announcement a supported Assistant need, and is `/Setting/AnnouncementTest`, `/Kanban`, or neither the production source? What response shape and audience apply?
- **Q8 (C10):** Which Auth service route is authoritative for Assistant use? Is list scoping server-enforced? Which roles and minimal fields may be shown?
- **Q9 (C11):** How is a target UUID constrained to the request company, and what PII fields, if any, may be disclosed? Name lookup is not proven.
- **Q10 (C12):** Are role options global, caller-visible, company-scoped or assignable? May IDs/memos be exposed?
- **Q11 (C13):** What are operation-log category/type semantics, server limits/retention, and safe redaction for `Content`/`Metadata`?
- **Q12 (C14):** Who owns `/Log/Login`? Is seven days a server policy or UI-only? Who may see account/IP and how many rows?
- **Q13 (C15):** Which deployed `/Outsource` or refactored `/Order` source applies? What filters, company/vendor isolation, paging and summary fields are allowed?
- **Q14 (C16):** How does detail enforce record ownership, resolve a master UUID, bound nested arrays and minimize fields?
- **Q15 (C17):** Resolve guarded versus `@Public()` route conflict before any Assistant exposure; then decide event redaction/record scope.
- **Q16 (C18):** How does a detail UUID inherit the parent work-order company boundary, and may internal/vendor memos or requirements be disclosed?

**Batch 1 (five review candidates):** C02–C06, aggregate/bounded Dashboard measures with source evidence and a plausible exact fixed-operation pattern. The pattern is reusable, but each candidate needs its own approved metric semantics, output and permission; none reuses C01's Tool or policy automatically. C06 needs a different bounded-breakdown output design.

**Batch 2 (seven review candidates):** C08–C10, C12, C14–C16. These have list/detail or source-owner/disclosure questions; no implementation begins from this grouping.

**Later/Blocked (five):** C07, C11, C13, C17, C18 because of semantic conflict, PII/record isolation, unbounded/redactable logs, public-route discrepancy, or internal memo exposure. The blockers are review/design questions, not a declaration that the underlying Customer API is nonexistent.

**Already accepted:** C01 only. Existing API does not equal approved Assistant capability; one endpoint does not confer one permission or all-field disclosure. Do not implement Batch 1 before human decisions and separate implementation authorization. The citation-placeholder and unsupported-clarification UX backlog in A2 remains out of scope.
