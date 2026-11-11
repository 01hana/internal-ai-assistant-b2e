# First Read-only Customer Capability Onboarding Checklist

Use this process checklist with the [specification template](./onboarding-spec-template.md), [artifact map](./customer-artifact-map.md), and [release review checklist](./review-checklist.md). Check a box only with scoped evidence, owner and review date. The labels indicate who may prepare evidence, not who can authorize production. Documentation completion never creates runtime authority.

**Labels:** `AUTO_EXTRACTABLE` = source-backed technical fact can be extracted; `AI_ASSISTED` = draft or comparison only; `HUMAN_REVIEW_REQUIRED` = responsible owner must approve; `RUNTIME_PROVISIONING` = use the existing exact authority workflow; `REAL_E2E_REQUIRED` = authorized real Customer validation.

1. **Source discovery** — `AUTO_EXTRACTABLE`, `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`
   - [ ] Record available OpenAPI/official contract, Backend implementation/DTO/tests, Frontend usage/SDK, business documents and interviews with versions, owners and conflicts. Neither Frontend nor Backend *repository* is mandatory; use the [source tiers](./customer-artifact-map.md#source-discovery-no-mandatory-frontend--backend-pair) for the fact at issue. Frontend is conditional for UI terms, actual usage/filters, user concepts or conflicts.
   - [ ] Mark missing or conflicting technical evidence and unresolved business meaning for Human Review; do not infer meaning from names. Collect no secrets or raw Customer data.
2. **Business semantic review** — `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`
   - [ ] Obtain approval for label, business object/meaning, date basis, time and timezone semantics, company/organization scope, sensitivity/disclosure, permission and unsupported boundaries. Record reviewer and date; `AI_INFERRED` is not approval.
3. **Capability definition** — `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Add only the approved Customer-scoped Capability Pack definition and semantic profile. Keep Customer vocabulary/examples in the pack, not Generic Core. Validate the pack through the existing loader and scope.
4. **Parameter definition** — `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Define required/optional canonical parameters, approved values/aliases, invalid/conflicting/missing behavior and non-executable recognized values. If no parameter is needed, record that explicitly. Never silently substitute a period.
5. **Binding** — `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Bind each executable parameter combination to an active exact Tool version with closed reviewed constraints/mappings. Assert no fallback and no Customer-crossing candidate.
6. **ToolDefinition** — `AUTO_EXTRACTABLE`, `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Reference or register the product-owned global exact Tool contract; check active/read-only status, closed input/output schema, side-effect flags, required permissions and result policy. Registration alone grants no Customer execution.
7. **CustomerToolPolicy** — `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Provision an enabled policy for the exact Customer and ToolDefinition through the operator-only command. Review roles and additional scopes, verify Tool permissions against trusted identity, and prove an absent/disabled/foreign policy denies execution. Never use a wildcard or synthetic fixture as Customer authority.
8. **Connector manifest** — `AUTO_EXTRACTABLE`, `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Customer-local registration loads each fixed operation. Review exact method/path/query, argument mapping, response schema and extraction, limits, error behavior, credential profile and destination policy. Test wrong shape/casing; allow no arbitrary model-supplied URL, method or business filter.
9. **Customer identity and scope** — `HUMAN_REVIEW_REQUIRED`, `RUNTIME_PROVISIONING`
   - [ ] Verify Customer/integration/HostApp records, accepted actor/organization context, credential ownership and exact deployment binding. Confirm permissions come from trusted admission, not the Assistant or LLM.
10. **Automated tests** — `AI_ASSISTED`, `HUMAN_REVIEW_REQUIRED`
   - [ ] Run pack/schema, positive paraphrase, missing/invalid/conflicting/unsupported, ambiguity, write-style, permission/foreign-Customer, exact Tool/Connector contract and vertical regression tests. Record scoped results and any skips or pre-existing failures.
11. **Real E2E** — `HUMAN_REVIEW_REQUIRED`, `REAL_E2E_REQUIRED`
   - [ ] An authorized human validates each approved request from Customer context: semantic value, exact Tool/policy, Connector operation, real upstream request/extraction, company-scoped answer and comparison with the business system. Validate deployed route casing and account permissions without placing credentials or raw data in the record.
12. **Acceptance closure** — `HUMAN_REVIEW_REQUIRED`
   - [ ] Record passed/failed matrix, bounded evidence summary, non-blocking backlog, scope, environment, reviewer/date if known, and deployed commit identity separately. Do not call a provisional source ref confirmed merely because runtime E2E passed. Attach the [release review checklist](./review-checklist.md); do not activate an unapproved next capability.

**Hard stop:** If normal onboarding needs a Customer-specific Generic Resolver/Tool/permission/Connector branch, a Gateway or Identity bypass, schema/public-contract change, or a second registry, request architecture review. The [Shinmone accepted example](../../customers/shinmone/docs/work-orders-count-acceptance.md) demonstrates exact bounded operations, not an invitation to copy its business vocabulary into another Customer.
