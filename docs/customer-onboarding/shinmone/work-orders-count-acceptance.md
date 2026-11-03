# Shinmone `work-orders.count` Acceptance Record

**Recorded:** 2026-10-16. **Scope:** `customer-shinmone-scm-local` / `shinmone-scm-assistant-local` / `shinmone-scm`. **Status:** `WORK_ORDERS_COUNT_REAL_CUSTOMER_E2E=PASS`, based on the human's E2E acceptance report supplied for this record. The E2E run date, reviewer identity, trace IDs, and deployed Git commit were not supplied; this document does not invent them or independently re-run a Customer API call.

This record closes the three approved read-only periods in the current environment. It does not grant runtime authority, attest a production deployment, or promote the Backend source ref to a confirmed deployed commit. The earlier [authority resolution](./work-orders-count-authority-resolution.md) is a dated pre-implementation snapshot, not the current support matrix.

## Business Definition and Human Decisions

| Decision | Approved meaning |
| --- | --- |
| Capability and label | `work-orders.count` / 新增工單數; count newly created 工單 for the requested period. |
| Date basis | `CreatedDate` is the work-order creation date. |
| Period ownership | Customer Backend uses `SERVER_LOCAL_TIME`: `today` = local current day; `thisWeek` = local Monday through today; `thisMonth` = local first day of month through today. Assistant supplies no date boundaries. |
| Company scope | Authenticated company identity and existing Customer Backend rules are authoritative. System Company uses existing system-company filtering; Supplier uses existing `VendorCode` plus status filtering. Neither LLM nor Assistant supplies a company/supplier filter. |
| Permission | All three exact read-only Tools require `menu:SCM_DASHBOARD:read`; real user possession remains an identity/permission decision, not a semantic decision. |
| Disclosure boundary | Only the bounded canonical `{metricKey, period, count}` result enters central projection/evidence. No raw response, native credential, or company-filter argument is part of the Capability Pack. |
| Unsupported boundary | Other periods and other work-order measures are not implied by these three operations. No period fallback to monthly or dynamic `TimeRange` input is approved. |

## Technical Authority Chain

The [Customer Capability Pack](../../../customer-capability-packs/shinmone-scm-local/1.0.0.json) owns the `zh-TW` vocabulary, required canonical `timeRange` enum, and three Customer-scoped exact bindings. Generic semantic/parameter/binding services evaluate that pack without a Shinmone branch. The product-owned [ToolDefinitions](../../../scripts/seed.ts) are global contracts; the enabled policy rows for this Customer are separate Customer-scoped execution authority, provisioned by the existing [operator-only command](../../../scripts/provision-customer-tool-policy.ts). Tool Registry and permission precheck remain authoritative after binding resolution.

| Canonical `timeRange` | Exact ToolDefinition and Binding target | Customer-local fixed operation | Result extraction |
| --- | --- | --- | --- |
| `today` | `work-orders.today-new-count@1.0.0` | [`GET /Dashboard/KPIStats?TimeRange=today`](../../../apps/customer-connector-runtime/integrations/shinmone/work-orders.today-new-count.manifest.json) | `/Data/NewOrders/Current` → `count`; `period=today` |
| `this_week` | `work-orders.weekly-new-count@1.0.0` | [`GET /Dashboard/KPIStats?TimeRange=thisWeek`](../../../apps/customer-connector-runtime/integrations/shinmone/work-orders.weekly-new-count.manifest.json) | `/Data/NewOrders/Current` → `count`; `period=thisWeek` |
| `this_month` | `work-orders.monthly-new-count@1.0.0` | [`GET /Dashboard/KPIStats?TimeRange=thisMonth`](../../../apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json) | `/Data/NewOrders/Current` → `count`; `period=thisMonth` |

All three manifests have closed empty input schemas and no argument mappings. The [local authority generator](../../../dev/connector-local/generate-local-authority.mjs) lists all three exact adapter operations and mounted manifests; the [Shinmone integration registration](../../../apps/customer-connector-runtime/integrations/shinmone/shinmone-runtime.registration.ts) loads those manifests. Identity, trusted context, credential resolution, connector deployment and destination policy remain in their existing owners. Local preflight found the Customer/integration/HostApp binding and three active read-only definitions; its final DB check found three enabled Customer policy rows with no extra roles/scopes beyond each Tool's Dashboard requirement. Synthetic `customer-a` policies are not Shinmone authority.

## Real E2E Evidence Summary

The human reported that Assistant results matched the Shinmone Dashboard separately for `today`, `thisWeek`, and `thisMonth`. For each exact Connector Runtime operation, the reported execution reached `INVOCATION_CONTEXT_VALIDATED`, `MANIFEST_RESOLVED`, `CREDENTIAL_RESOLUTION_SUCCEEDED`, `UPSTREAM_REQUEST_STARTED`, `UPSTREAM_RESPONSE_RECEIVED`, `UPSTREAM_RESPONSE_SCHEMA_VALIDATED`, `RESULT_EXTRACTION_SUCCEEDED`, and `INVOCATION_RESPONSE_SENT`, all successfully. No token, raw Customer value, response body, or execution trace is copied into this record. Repository [semantic tests](../../../test/integration/feature011-capability-resolution.spec.ts), [vertical test](../../../test/integration/shinmone-reference-vertical.spec.ts), and [manifest contracts](../../../apps/customer-connector-runtime/test/integrations/shinmone-period-manifests.spec.ts) provide separate automated regression evidence; they are not substitutes for the human-reported real E2E.

| Acceptance key | Status |
| --- | --- |
| `BUSINESS_SEMANTICS` | `PASS` |
| `TODAY_SEMANTIC` / `TODAY_EXECUTION` / `TODAY_REAL_BUSINESS_MATCH` | `PASS` / `PASS` / `PASS` |
| `THIS_WEEK_SEMANTIC` / `THIS_WEEK_EXECUTION` / `THIS_WEEK_REAL_BUSINESS_MATCH` | `PASS` / `PASS` / `PASS` |
| `THIS_MONTH_SEMANTIC` / `THIS_MONTH_EXECUTION` / `THIS_MONTH_REAL_BUSINESS_MATCH` | `PASS` / `PASS` / `PASS` |
| `CUSTOMER_SCOPE` / `CUSTOMER_TOOL_POLICY` / `CONNECTOR_BINDING` | `PASS` / `PASS` / `PASS` |
| `REAL_CUSTOMER_API` / `RESPONSE_EXTRACTION` | `PASS` / `PASS` |
| `ROUTE_CASING_COMPATIBILITY` | `PASS_CURRENT_ENVIRONMENT` |
| `GENERIC_CORE_POLLUTION` | `NO` |

## Known Non-blocking Issues and Closure Boundary

- `origin/refactor/project-structure` remains `PROVISIONALLY_ACCEPTED`. Runtime E2E success does not identify or approve the deployed Backend Git commit. `/Dashboard/KPIStats` worked in the current environment; the source-candidate spelling `/Dashboard/KpiStats` and future deployments still require deployment-specific confirmation.
- `[citation-need-*]` placeholders may appear in UI; unsupported-business-request clarification wording needs improvement; overdue work orders are not onboarded. These are backlog items, not blockers or implied support for this capability. No fix is attempted here.
- The accepted result is bounded to this Customer scope, three approved periods, and the reported E2E environment. It is not a claim that every real account has Dashboard permission or that Backend filtering was independently source-audited in this repository.

**Final acceptance:** `WORK_ORDERS_COUNT_REAL_CUSTOMER_E2E=PASS` for the stated scope and current environment, on the human-provided acceptance evidence. `PRODUCTION_DEPLOYED_COMMIT_CONFIRMED=NO`.
