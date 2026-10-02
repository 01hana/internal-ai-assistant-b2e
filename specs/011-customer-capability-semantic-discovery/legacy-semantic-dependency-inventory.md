# Feature 011 pre-cutover legacy semantic dependency inventory

Status: T061–T064 historically stopped before cutover. Human product-scope adjudication has since defined Customer A and B as synthetic test-only Customers; Shinmone deployment metadata review is required for T065. No pack or request-path authority was changed.

## Request path and authority

Assistant message → `RuleBasedQueryUnderstandingPipeline.process` → tokenizer/domain lexicon, entity and time extraction, follow-up frame → `ToolDiscoveryService.discover` → `ToolRegistryService.listDiscoveryCatalogForCustomer` → `x-assistant-discovery-v1` metadata matching and legacy argument binding → candidate Tool → Feature 010 planning → Feature 008 permission/policy/schema gate and runtime. The registry query filters active, read-only, side-effect-free Tools by CustomerToolPolicy. Seed and `test/support/us1-test-app.helper.ts` establish the test catalog; they do not establish the complete contents of any deployed database. Tool identity is an execution target, not proof of semantic equivalence.

## Supported-path classification

One row is one scoped, repository-observed semantic path. A `MIGRATED` row requires the same meaning, scope, canonical parameters, binding and direct acceptance; a passing test against a *different* wording or scope does not suffice. Customer A/B rows are `EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH` because those scopes are synthetic test-only fixtures used for portability, isolation and regression verification, never actual deployed Customer support commitments. Their tests and packs remain required; this is not deprecation, dropped support or an excuse to weaken coverage.

| ID | Classification | Scoped legacy behavior and target | Legacy evidence | Pack/direct acceptance evidence or gap |
| --- | --- | --- | --- | --- |
| P01 | MIGRATED_TO_CUSTOMER_CAPABILITY_PACK | Shinmone local monthly new work-order count → `work-orders.monthly-new-count@1.0.0` | `test/integration/shinmone-reference-vertical.spec.ts`; `scripts/seed.ts` | `customer-capability-packs/shinmone-scm-local/1.0.0.json`; `test/integration/feature011-capability-resolution.spec.ts` covers the same monthly question, `this_month`, exact binding, empty arguments. |
| P02 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP order status, “請幫我查 SO-10001 訂單目前狀態” → `mock.orders.status.lookup@1.0.0` | `test/integration/tool-discovery-mock-equivalence.spec.ts`; `test/integration/authorized-evidence-answer.spec.ts`; `scripts/seed.ts` | `test/fixtures/capability-packs/customer-a-reference.v1.json` has an order capability; exact wording currently returns `CAPABILITY_NOT_RECOGNIZED` in direct resolution. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain both test paths. |
| P03 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP work-order progress, “請查 WO-20002 工單進度” → `mock.work-orders.progress.lookup@1.0.0` | `test/integration/tool-discovery-mock-equivalence.spec.ts`; `scripts/seed.ts` | `test/fixtures/capability-packs/customer-a-reference.v1.json` and `test/integration/feature011-customer-b-portability.spec.ts` cover the same progress meaning, identifier and target. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain tests. |
| P04 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP inventory *availability*, “請查 SKU-DEMO-RED 庫存可用量” → `mock.inventory.availability.lookup@1.0.0` | `test/integration/tool-discovery-mock-equivalence.spec.ts`; `scripts/seed.ts` | `test/fixtures/capability-packs/customer-a-reference.v1.json` and `test/integration/feature011-customer-b-portability.spec.ts` cover this wording and `itemRef` mapping. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain tests. |
| P05 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP inventory “請查 SKU-DEMO-RED 目前庫存” → `mock.inventory.availability.lookup@1.0.0` | `test/integration/feature010-tool-retrieval.spec.ts`; `test/integration/authorized-tool-execution.spec.ts`; `test/integration/feature010-hybrid-retrieval.spec.ts` | Customer A pack direct semantic resolution of this exact legacy request returns `CAPABILITY_NOT_RECOGNIZED`. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain Tool/Hybrid regressions. |
| P06 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP business-partner history, “請查這筆客戶歷史” → `mock.business-partner.history.lookup@1.0.0` | `test/integration/tool-discovery-mock-equivalence.spec.ts`; `scripts/seed.ts` | `test/fixtures/capability-packs/customer-a-reference.v1.json` and `test/integration/feature011-customer-b-portability.spec.ts` cover the same meaning and target. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain tests. |
| P07 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer B `integration-erp/erp`, “請查 SKU-B-001 庫存” and SKU follow-up → `inventory.stock-on-hand@1.0.0` | `test/integration/feature010-followup-routing.spec.ts`; `test/integration/feature009-customer-isolation.spec.ts` | Customer B pack is in the same scope but direct semantic resolution of the seed wording returns `CAPABILITY_NOT_RECOGNIZED`; direct “現量” acceptance is not equivalent. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain follow-up tests. |
| P08 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer B `inventory-b/customer-b-inventory`, “請查 SKU-B-001 庫存” → `inventory.stock-on-hand@1.0.0` | `test/integration/feature009-customer-b-portability.spec.ts` | `test/fixtures/capability-packs/customer-b-inventory.v1.json` is scoped to `integration-erp/erp`, not this fixture integration/HostApp. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain isolation tests. |
| P09 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Customer A ERP “請查這個月新增工單數” monthly follow-up seed; seeded candidate target `work-orders.monthly-new-count@1.0.0` (seed execution is not asserted) | `test/integration/feature010-followup-routing.spec.ts`; `test/support/us1-test-app.helper.ts`; `scripts/seed.ts` | The test proves context-seed use but does not assert a seed ToolCall. Customer A pack lacks a count capability and Shinmone is another verified scope. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain follow-up tests. |
| P10 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Direct-only Customer B `integration-erp/erp` “查詢料件的庫存現量” → `inventory.stock-on-hand@1.0.0` | `test/integration/feature011-customer-b-portability.spec.ts` | `test/fixtures/capability-packs/customer-b-inventory.v1.json` and direct integration cover distinct vocabulary, bounded `itemRef`, mapping and exact Tool. Synthetic test-only Customer scope for portability/isolation/regression, never a deployed support commitment; retain direct acceptance. |
| P11 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Synthetic `generic.monthly-status.lookup` metadata and mappings in isolated unit fixtures | `test/unit/tool-discovery.service.spec.ts`; `test/support/tool-discovery.fixture.ts` | No seeded active Customer policy or observed Assistant request path for this synthetic Tool. Keep as legacy matcher test, not a migration claim. |
| P12 | EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH | Seeded write operations (`mock.orders.status.update`, `mock.orders.cancel`) | `scripts/seed.ts`; `src/tools/tool-registry.service.ts` | Discovery filters write/side-effect operations; V1 packs are read-only Tool-backed. Existing write/risk authorization remains separate. |

## Non-executable and non-authority observations

- `last_month` is parsed and then handled as an unsupported/clarification route when no candidate exists (`time-range.parser.ts`, pipeline, planning; `feature010-followup-routing.spec.ts`). No Tool-backed migration is claimed from this negative route.
- `missing_order_identifier` is a legacy blocking clarification in `clarification-need.generator.ts`; it is not a migrated capability, and P02's missing-parameter acceptance is still needed.
- Policy-denied, missing-schema, inactive, write-risk and permission failures are downstream authorization/safety behavior, not evidence that their semantic paths are unsupported. Tool metadata in persistence/unit fixtures is non-request-time unless the same behavior appears in a request-path test.
- The repository cannot prove absence of additional deployed ToolDefinitions or CustomerToolPolicies. A production DB inventory or explicit human scope decision is required before claiming `UNMIGRATED_SUPPORTED_TOOL_SEMANTIC_PATHS=0`.

## Deployment registry scope decision

- **Product-scope decision (2026-10-01):** Customer A and Customer B are `SYNTHETIC_TEST_ONLY_SCOPE`, never actual deployed Customer support commitments. Their fixture packs, direct acceptance, legacy regression, portability, collision and isolation tests are retained in full; no production Core exception is introduced.
- **Actual compatibility scope:** `customer-shinmone-scm-local` / `shinmone-scm-assistant-local` / `shinmone-scm`. The existing CustomerToolPolicy authority is keyed by `customerId` and ToolDefinition ID, not integrationId or hostApp. P01 is the only repository-evidenced migrated deployment semantic path.
- **Repository limit:** checked-in seed and tests cannot establish the complete live ToolDefinition/CustomerToolPolicy rows. The human confirmed the repository `.env` is the current Shinmone local Backend DB configuration; that confirmation does not substitute for reading its metadata.
- **Read-only review attempted 2026-10-01:** `DB_METADATA_QUERY_STATUS=FAILED_SAFE`; the local PostgreSQL socket readiness check was unavailable in this execution environment. No Tool/policy rows, schema JSON, credentials, connection string, or business data were printed. No DB write, ToolCall, or Customer request occurred.
- **Earlier normalized result:** `NOT_VERIFIED`; extra deployment semantic paths `UNKNOWN`. This was the genuine state before the following human-supplied review.
- **Human metadata review, 2026-10-01:** the operator ran the prescribed read-only command from the repository root against the confirmed current Shinmone Backend DB. The returned status was `PASS`; the verified Customer scope exists and has exactly one CustomerToolPolicy row. Its sole policy-allowed Tool is `work-orders.monthly-new-count@1.0.0`, active, `read`, side-effect-free and enabled, with present and valid `x-assistant-discovery-v1` metadata. This is normalized configuration metadata only; no raw schema or business data is recorded.
- **Repository reconciliation:** P01's product-owned pack defines `work-orders.count`, `timeRange=this_month`, the exact `work-orders.monthly-new-count@1.0.0` target and `mappings=[]`. `test/integration/feature011-capability-resolution.spec.ts` directly accepts the monthly question and validates `{}` arguments. The one deployed discoverable Tool therefore matches P01; no additional active policy-allowed request-time semantic Tool appears in the reviewed snapshot.
- `DEPLOYMENT_TOOL_POLICY_METADATA_REVIEWED=YES`; `DEPLOYMENT_POLICY_ROW_COUNT=1`; `EXTRA_DEPLOYMENT_SEMANTIC_PATHS=0`; `DEPLOYMENT_SEMANTIC_COVERAGE=COMPLETE_FOR_CURRENT_SNAPSHOT`. This is evidence for the reviewed 2026-10-01 snapshot, not a guarantee against later DB changes.

## Dependency anchors

The architecture guard treats each line below as a stable `relative path + named dependency category + occurrence count` declaration. It rescans `src`, `test`, and `scripts` (excluding the guard itself), rejects a new/unregistered anchor, count drift, duplicate entry or wildcard; this is not a whole-tree hash or line-number guard. Categories cover direct discovery, extension metadata, generic-owned vocabulary, identifiers, Customer-specific branches and legacy argument binding.

| Relative path | Anchor counts |
| --- | --- |
| `scripts/seed.ts` | `metadata=3,bindings=1` |
| `src/assistant/planning/assistant-planning.service.ts` | `branches=1` |
| `src/query-understanding/clarification-need.generator.ts` | `branches=1` |
| `src/query-understanding/default-tokenizer.adapter.ts` | `vocabulary=6,identifiers=2` |
| `src/query-understanding/domain-lexicon.ts` | `vocabulary=7,branches=1` |
| `src/query-understanding/entity-extractor.ts` | `identifiers=6` |
| `src/query-understanding/query-normalizer.ts` | `vocabulary=2` |
| `src/query-understanding/rule-based-query-understanding.pipeline.ts` | `discovery=3,branches=8` |
| `src/query-understanding/time-range.parser.ts` | `branches=1` |
| `src/tools/tool-discovery.service.ts` | `discovery=2,metadata=4,bindings=6` |
| `src/tools/tool-registry.service.ts` | `discovery=1` |
| `src/tools/tool-registry.types.ts` | `bindings=3` |
| `src/tools/tools.module.ts` | `discovery=3` |
| `test/eval/feature011-capability-resolution.eval.spec.ts` | `branches=1` |
| `test/integration/feature010-followup-routing.spec.ts` | `branches=1` |
| `test/integration/query-understanding-persistence.spec.ts` | `metadata=1` |
| `test/integration/tool-discovery-mock-equivalence.spec.ts` | `metadata=1` |
| `test/support/tool-discovery.fixture.ts` | `discovery=4,metadata=1,bindings=1` |
| `test/support/us1-test-app.helper.ts` | `metadata=2,bindings=1` |
| `test/unit/assistant-context-state.spec.ts` | `branches=2` |
| `test/unit/assistant-readonly-runtime.service.spec.ts` | `metadata=3` |
| `test/unit/capability-follow-up-frame.spec.ts` | `branches=1` |
| `test/unit/chinese-tokenizer.spec.ts` | `vocabulary=2` |
| `test/unit/follow-up-retrieval-authority.guard.spec.ts` | `metadata=2` |
| `test/unit/query-understanding-pipeline-wiring.spec.ts` | `discovery=4` |
| `test/unit/query-understanding-placeholder.spec.ts` | `metadata=1` |
| `test/unit/query-understanding.service.spec.ts` | `metadata=2` |
| `test/unit/tool-discovery-equivalence.spec.ts` | `metadata=2` |
| `test/unit/tool-discovery.service.spec.ts` | `discovery=4,metadata=13,bindings=5` |
| `test/unit/tool-registry.service.spec.ts` | `discovery=1` |

## Gate decision

Historical T061–T064 decision: P02, P05, P07, P08 and P09 were treated as blockers before human product-scope adjudication. That historical observation remains valid; the subsequent decision classifies every Customer A/B scope here as synthetic test-only, not deployed support. The human-reviewed deployment metadata reconciles the sole current Shinmone semantic Tool with P01, leaving zero current-snapshot inventory blockers. T065 still requires its full regression gate before being marked complete. Do not alter production behavior or packs under this inventory authorization.
