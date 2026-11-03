# Shinmone `work-orders.count` — Authority Resolution & Gap Analysis

**Analysis date:** 2026-10-15

> Historical pre-implementation snapshot. The day/week gap and unverified E2E
> statements below describe this analysis date only. See the later
> [three-period acceptance record](./work-orders-count-acceptance.md) for current
> support and human-reported Real Customer E2E status; the deployed Backend
> commit remains provisional.

**Scope:** read-only inspection of this repository and the human-verified business definition supplied for this review.
**Status:** analysis artifact only. This document is not a Capability Pack, ToolDefinition, Connector manifest, runtime loader input, deployment approval, or independent source of execution authority.

The existing Feature 008 Tool, Feature 009 Connector, and Feature 011 capability contracts remain authoritative. No registry, binding, operation, policy, test, or runtime file was changed in this analysis.

## Human-Verified Business Definition

The following business semantics were supplied as already human-reviewed for this analysis and are **not** classified as AI inference:

| Item | Human-verified meaning |
| --- | --- |
| Capability | `work-orders.count`: 查詢指定期間內的新增工單數量 |
| Label / object | 新增工單數 / 工單 |
| Date basis | `CreatedDate` means 工單建立日期 |
| Supported periods | `today`: server-local current day; `thisWeek`: server-local Monday through today; `thisMonth`: server-local first day of month through today |
| Timezone policy | `SERVER_LOCAL_TIME` |
| Company scope | Current authenticated company identity and existing Backend rules |
| System Company | Existing Backend system-company filtering semantics |
| Supplier | Existing Backend `VendorCode` plus status filtering semantics; supplier filtering is an established business rule |
| Candidate execution source | `GET /Dashboard/KpiStats`, result `$.Data.NewOrders.Current` |
| Candidate source status | `origin/refactor/project-structure` is `PROVISIONALLY_ACCEPTED` as the main source candidate; its deployed commit has not been externally confirmed. |

This repository does not contain the named Backend refactor branch or Backend implementation. Its local Git refs do not include `origin/refactor/project-structure`. The human-approved statements above establish the business target for comparison; this inspection cannot independently prove the Backend's deployed code, date calculation, company filtering, or route registration. These require source/deployment evidence before real E2E acceptance.

## Existing Authority Chain

| Layer | Current evidence and resolution |
| --- | --- |
| Customer Capability Pack | [`customer-capability-packs/shinmone-scm-local/1.0.0.json`](../../../customer-capability-packs/shinmone-scm-local/1.0.0.json) declares an active `READ_ONLY_TOOL` capability `work-orders.count` scoped to `customer-shinmone-scm-local` / `shinmone-scm-assistant-local` / `shinmone-scm`. This is the product-owned pack, not a test fixture. |
| Business vocabulary / semantic profile | The pack has one `zh-TW` profile: `safeLabel=工單新增數量`, aliases `工單新增數量`, `新開立`, `新增幾張`; resource terms `工單`, `維修工單`; metric terms `新增數量`, `新增`, `數量`; one monthly example. It has no explicit prose business description, `CreatedDate` basis, company rule, or all-period example set. |
| Canonical parameter | Required enum `timeRange` declares `this_month` (`本月`, `這個月`, `本月份`) and `today` (`今天`). It does not declare `this_week` / `thisWeek` or week aliases. Current pack notation is snake case; the human-approved Backend notation is camel case. |
| Capability → Tool Binding | One active binding accepts only `timeRange=this_month` via `ENUM_VALUE_IN`, targets exact `work-orders.monthly-new-count@1.0.0`, and sets `mappings=[]`. The resolved Tool candidate has `{}` arguments. [`CapabilityBindingResolverService`](../../../src/capabilities/capability-binding-resolver.service.ts) rejects unconsumed supplied parameters and returns `CAPABILITY_UNAVAILABLE` without a compatible binding. |
| ToolDefinition / Tool Registry | [`scripts/seed.ts`](../../../scripts/seed.ts) defines the reference Tool as active, read-only, side-effect-free, with empty input schema, output `{metricKey, period, count}`, `connectorKey=business`, and required `menu:SCM_DASHBOARD:read`. [`ToolRegistryService`](../../../src/tools/tool-registry.service.ts) resolves the exact version and rechecks active/read-only status. This repository definition is evidence of intended registration; it is not a fresh read of a live deployment database. |
| Customer Tool Policy / permission | [`CustomerToolPolicyService`](../../../src/tools/customer-tool-policy.service.ts) requires an enabled Customer policy row. [`ToolPermissionPrecheckService`](../../../src/permissions/tool-permission-precheck.service.ts) checks Tool and policy roles/scopes against verified current scope. The prior Feature 011 deployment metadata review records one allowed active Tool row at that snapshot in [`legacy-semantic-dependency-inventory.md`](../../../specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md); current deployment state was not re-queried in this round. |
| Central Connector selection | The [`ProductizedBusinessConnectorAdapter`](../../../src/connectors/productized-business/productized-business-connector.adapter.ts) checks Customer/integration/HostApp, Connector key/instance, exact operation identity, trusted execution input, and an exact executable Tool before invoking the signed transport. |
| Customer-local operation | [`work-orders.monthly-new-count.manifest.json`](../../../apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json) fixes `GET_QUERY_V1`, path `/Dashboard/KPIStats`, `TimeRange=thisMonth`, and zero dynamic argument mappings. The operation input schema is an empty closed object. The upstream service reference is deployment-controlled, not user/model-supplied. |
| Response | The manifest validates `Code=200` and extracts `/Data/NewOrders/Current` as non-negative integer `count`; it derives `period=thisMonth` from fixed query and `metricKey` from operation key. [`ManifestResponseExtractor`](../../../apps/customer-connector-runtime/src/upstream/response-extractor.ts) uses exact case-sensitive object keys. There is **no** `NewOrders.Current → newOrders.current` casing normalization. It projects the raw PascalCase field to canonical `count`. |

No second Capability or Tool registry was found or introduced. `work-orders.new-count` does not exist as a replacement capability and is not proposed for this round.

## TimeRange Support

`SEMANTICALLY_RECOGNIZED` means the scoped Feature 011 pack can produce a valid canonical `timeRange`. `EXECUTION_BINDING_AVAILABLE` means an active compatible binding can release the exact current Tool candidate. Backend support alone does not establish Assistant execution support.

| Human-approved period | Pack / aliases | `SEMANTICALLY_RECOGNIZED` | `EXECUTION_BINDING_AVAILABLE` | Observed outcome |
| --- | --- | --- | --- | --- |
| `today` | `today`, `今天` | **YES** | **NO** | Direct resolution test expects `CAPABILITY_UNAVAILABLE / NO_COMPATIBLE_ACTIVE_BINDING`, zero Tool candidate and zero Customer request. |
| `thisWeek` | No week value/aliases in this pack | **NO** | **NO** | No week binding, Tool variant, or Connector operation was found. Generic Query Understanding recognizes `本週` as `this_week`, but that does not add a value to the scoped capability pack or authorize execution. |
| `thisMonth` | `this_month`, `本月` / `這個月` / `本月份` | **YES** | **YES** | Exact monthly binding consumes the canonical value; Tool takes `{}`. Connector sends fixed upstream `thisMonth`. |

The ToolDefinition cannot accept a dynamic period: its input schema has no fields and its output schema pins `period` to `thisMonth`. The Customer-local manifest likewise fixes `TimeRange=thisMonth`. Any later support for day/week needs separately reviewed changes to existing authoritative artifacts; it cannot be inferred from the Backend's reported range support.

## Execution Mapping And Result Casing

The inspected monthly chain is:

```text
verified Customer/integration/HostApp
→ scoped work-orders.count + timeRange=this_month
→ active monthly-only binding
→ exact work-orders.monthly-new-count@1.0.0 + {}
→ existing Tool policy / permission checks
→ Customer-local manifest: GET /Dashboard/KPIStats?TimeRange=thisMonth
→ raw $.Data.NewOrders.Current
→ canonical { metricKey, period: "thisMonth", count }
→ existing central projection / evidence / answer path
```

The manifest and its contract test prove the request method/path/query and extraction within this repository. The vertical integration test observes a synthetic upstream request with exactly `GET /Dashboard/KPIStats?TimeRange=thisMonth` and a PascalCase `Data.NewOrders.Current` response; it is not a real Shinmone Backend E2E test. The manifest contract test rejects `newOrders`, `current`, and a camelCase-only response. It does not normalize raw response casing.

The human-supplied Backend source candidate declares `/Dashboard/KpiStats`, while the Frontend source and this manifest use `/Dashboard/KPIStats`. This is a **route casing compatibility conflict to verify**, not evidence that either route currently fails. Confirm the deployed route registration and actual server/proxy case handling with the technical owner; do not silently change the manifest path.

## Company Scope And Time Ownership

[`createCustomerScopeFromIdentityContext`](../../../src/identity/customer-scope.factory.ts) derives Customer, integration, organization, HostApp, actor, roles, and permission scopes from accepted identity. The central adapter carries `organizationId` and `actorId` in its signed trusted context, and [`ConnectorInvocationService`](../../../apps/customer-connector-runtime/src/invocation/connector-invocation.service.ts) checks that context against the service proof and a Customer-local binding lease. The Shinmone credential provider checks accepted subject/organization against the trusted binding context; the local bearer application strategy attaches that Customer-local native credential to the fixed upstream request.

Neither the pack, binding, empty Tool input, nor manifest offers `CompanyCode`, `VendorCode`, date start/end, or a free-form company argument. This inspected Assistant chain offers no observed user/LLM company-scope override. The final System Company and Supplier `VendorCode` + status filtering are delegated to the Backend under the human-approved rule, but their actual deployed enforcement cannot be verified from this repository. Do not treat the Assistant's signed context alone as proof of Backend filtering.

For this capability's executable monthly path, Assistant passes a canonical `timeRange` into the binding decision, then `{}` to the Tool. The Connector sends the fixed `TimeRange=thisMonth`; it sends no computed dates. Customer Backend owns `CreatedDate`, server-local timezone, and period boundaries under the approved business definition. The generic [`time-range.parser.ts`](../../../src/query-understanding/time-range.parser.ts) computes date ranges for generic Query Understanding, but the inspected Shinmone monthly Tool/Connector mapping does not use those dates as execution arguments. No duplicated Customer-specific execution-date calculation was found on this path. Day/week execution does not yet exist, so its future ownership still needs design review.

## Test And Evaluation Coverage

| Evidence | What it proves | Limit |
| --- | --- | --- |
| [`feature011-capability-resolution.spec.ts`](../../../test/integration/feature011-capability-resolution.spec.ts) | Four monthly paraphrases resolve to `work-orders.count`, `this_month`, exact Tool and `{}`; `today` is recognized but unavailable; missing/invalid/conflicting cases avoid execution. | Direct resolver harness; no `thisWeek` case or day/week execution. |
| [`feature011-capability-resolution.eval.spec.ts`](../../../test/eval/feature011-capability-resolution.eval.spec.ts) | Three monthly paraphrases, negative/ambiguous/missing/invalid/conflicting and follow-up behavior. | Synthetic in-memory catalog, not the product pack binding or live API. |
| [`feature011-feature010-cutover.spec.ts`](../../../test/integration/feature011-feature010-cutover.spec.ts) | Monthly Tool candidate enters existing routing; `today` produces no Tool candidate or legacy fallback. | No week path or live Backend result. |
| [`shinmone-manifest.spec.ts`](../../../apps/customer-connector-runtime/test/integrations/shinmone-manifest.spec.ts) | Fixed GET/query, PascalCase extraction, bounded output, wrong-casing rejection. | Customer-local unit/contract fixture. |
| [`shinmone-reference-vertical.spec.ts`](../../../test/integration/shinmone-reference-vertical.spec.ts) | Synthetic Bridge/Gateway/Connector vertical path sends the fixed monthly request and releases a count. | Uses synthetic identity, local upstream, test pack/Tool data; not real Backend E2E. |

Against the supplied coverage targets, monthly is **partial but meaningful**: several natural paraphrases exist, including “這個月新增幾張工單？”. The exact three target phrasings are not all present. Today has one explicit recognized-but-unavailable case, without the proposed paraphrase breadth. Week coverage and execution are missing. Overall `SEMANTIC_EVAL_COVERAGE=PARTIAL`.

## Gap Matrix

Values describe agreement with the human-verified target. `MATCH` for a monthly-only mapping is scoped explicitly to the executable monthly path. `NEEDS_HUMAN_REVIEW` denotes missing external proof, not a confirmed defect.

| Key | Value | Evidence / gap | Recommended change or confirmation |
| --- | --- | --- | --- |
| `CAPABILITY_BUSINESS_MEANING` | `PARTIAL` | Label, aliases, resource and metric terms clearly indicate *new* work-order count, rather than all existing orders. Pack lacks an explicit all-period business description, `CreatedDate` basis, and approved scope wording; its sole example is monthly. | Review a precise Customer-owned semantic description and period examples within the existing pack when implementation is authorized. |
| `TODAY_SEMANTIC_SUPPORT` | `MATCH` | `today` / `今天` declared and directly tested. | Expand paraphrase evals. |
| `TODAY_EXECUTION_SUPPORT` | `MISSING` | Only `this_month` binding and monthly fixed Tool/manifest exist. | Design/review a compatible day execution path through existing authority; retain unavailable until then. |
| `THIS_WEEK_SEMANTIC_SUPPORT` | `MISSING` | Week value and aliases absent from scoped pack. | Add reviewed canonical value/aliases only through existing pack workflow. |
| `THIS_WEEK_EXECUTION_SUPPORT` | `MISSING` | No compatible binding, Tool input/variant, or manifest operation. | Design/review a week execution path through existing authority. |
| `THIS_MONTH_SEMANTIC_SUPPORT` | `MATCH` | `this_month` and three aliases declared. | Add coverage, not a new authority. |
| `THIS_MONTH_EXECUTION_SUPPORT` | `MATCH` | Exact monthly binding, zero arguments, exact Tool and fixed Connector operation. | Retain current path. |
| `TOOL_MAPPING` | `MATCH` | Exact `work-orders.monthly-new-count@1.0.0`; empty input and monthly output. | Retain for monthly. |
| `CONNECTOR_MAPPING` | `PARTIAL` | Monthly GET and fixed query match one approved period; day/week have no mapping. | Review additional fixed operations or compatible existing Tool contract design, without dynamic arbitrary requests. |
| `RESULT_EXTRACTION` | `MATCH` | `/Data/NewOrders/Current` → canonical `count`; no raw casing rewrite. | Verify against deployed Backend response. |
| `COMPANY_SCOPE_ENFORCEMENT` | `NEEDS_HUMAN_REVIEW` | Verified scope and Customer-local credential binding are visible; final Backend System Company/Supplier filters are not in this repo. No Assistant override was found. | Inspect candidate Backend implementation and deployed commit; run authorized company-scope E2E cases. |
| `TIME_RANGE_OWNERSHIP` | `MATCH` | Monthly execution sends only fixed canonical upstream period; no Assistant-calculated dates. | Verify Backend `CreatedDate`/server-local boundaries; preserve ownership for future periods. |
| `ROUTE_CASING_COMPATIBILITY` | `CONFLICT` | Backend candidate `/Dashboard/KpiStats` versus Frontend/manifest `/Dashboard/KPIStats`; runtime compatibility unknown. | Confirm deployed route/proxy behavior and request trace before changing any path. |
| `SEMANTIC_EVAL_COVERAGE` | `PARTIAL` | Monthly paraphrases and today unavailable checks exist; week and full day/week paraphrase sets do not. | Add multi-phrase positive/negative/unavailable and real E2E cases after approval. |
| `NAMING_DEBT` | `PARTIAL` | `work-orders.count` is broad by name, while label/profile says new count. | Record as naming debt; do not rename or create `work-orders.new-count` in this analysis. |
| `SECURITY_GAP` | `NOT_APPLICABLE` | No verified Assistant-side company override or other security breach found. Backend filtering proof remains open under `COMPANY_SCOPE_ENFORCEMENT`. | Escalate as `SECURITY_GAP` only if Backend inspection/E2E reveals an actual bypass. |
| `ARCHITECTURE_GAP` | `NOT_APPLICABLE` | Gaps can be addressed within existing Feature 008/009/011 ownership; no authority redesign is evidenced. | Preserve current boundaries. |

**Gap count convention:** eight actionable or unresolved rows among the first fourteen matrix entries: business meaning, today execution, both week rows, Connector mapping, company-scope proof, route casing, and semantic eval. Naming debt is tracked separately. `SECURITY_GAP_COUNT=0` and `ARCHITECTURE_GAP_COUNT=0` mean none was identified in the inspected evidence, not that uninspected deployed behavior has been certified.

## Recommended Changes And Acceptance Order

1. Obtain the exact deployed Backend commit and compare it with `origin/refactor/project-structure`; verify `/Dashboard/KpiStats` registration, actual accepted route casing, `CreatedDate` period boundaries under server-local time, authenticated company selection, System Company filtering, and Supplier `VendorCode` plus status filtering.
2. Keep the current monthly Tool and Connector path intact while expanding approved semantics and evaluation coverage in the existing Customer pack workflow. Preserve `work-orders.count`; treat its broad key as naming debt.
3. Design day/week executable support only through the current Capability → exact Tool → Customer-local manifest authority chain. Decide the reviewed canonical-to-upstream period mapping and output contracts before changing any production artifact. Never silently substitute monthly execution.
4. After separate implementation authorization, run scoped semantic tests and real E2E acceptance for all three periods, role/company variants, route casing, raw response shape, denial, and cross-Customer isolation.

This analysis does not automatically generate a Capability Pack, alter a Tool or Connector, establish deployed source authority, or activate Customer production configuration. Any proposal that changes Feature 011 resolver authority, Feature 008 Tool authority, Feature 009 Connector authority, or the security boundary needs separate human design review before implementation.

## Summary Fields

```text
AUTHORITY_RESOLUTION_COMPLETED=YES
HUMAN_VERIFIED_BUSINESS_DEFINITION_RECORDED=YES
CURRENT_CAPABILITY_FOUND=YES
CURRENT_BINDING_FOUND=YES
CURRENT_TOOL_FOUND=YES
CURRENT_CONNECTOR_MAPPING_FOUND=YES
BUSINESS_MEANING_MATCH=PARTIAL
TIME_RANGE_SUPPORT_MATCH=PARTIAL
EXECUTION_MAPPING_MATCH=PARTIAL
COMPANY_SCOPE_MATCH=NEEDS_HUMAN_REVIEW
GAP_COUNT=8
SECURITY_GAP_COUNT=0
ARCHITECTURE_GAP_COUNT=0
PRODUCTION_CODE_CHANGED=NO
PRODUCTION_CONFIG_CHANGED=NO
HUMAN_DECISION_REQUIRED=NO
NEXT_RECOMMENDED_ACTION=IMPLEMENT_APPROVED_WORK_ORDERS_COUNT_GAPS
```

`HUMAN_DECISION_REQUIRED=NO` means this analysis found no reason to redesign an existing authority boundary. The deployed-commit, Backend-filtering, and route-casing confirmations remain required evidence before implementation/production acceptance; `PROVISIONALLY_ACCEPTED` is not final deployed-source verification.
