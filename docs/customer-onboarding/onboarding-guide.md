# Customer AI Assistant Onboarding Guide

## Purpose

This guide explains how to use
[`onboarding-spec-template.md`](./onboarding-spec-template.md) when onboarding a
new Customer. It is a documentation workflow, not authorization to change a
runtime, deploy configuration, register a Tool, activate a Capability Pack, or
invoke a Customer API.

For a first read-only business capability, use the
[`capability-onboarding-checklist.md`](./capability-onboarding-checklist.md) for
the execution sequence and [`customer-artifact-map.md`](./customer-artifact-map.md)
for artifact ownership. The
[`review-checklist.md`](./review-checklist.md) remains the release review gate;
the [Shinmone acceptance record](./shinmone/work-orders-count-acceptance.md)
is one bounded Customer example, not a template of business rules.

Keep one Customer and one reviewed integration scope per onboarding record.
Preserve source evidence and review status from discovery through acceptance.

## Status And Promotion Rule

Use only the template's closed statuses: `AUTO_EXTRACTED`, `AI_INFERRED`,
`HUMAN_VERIFIED`, `NEEDS_HUMAN_REVIEW`, `UNSUPPORTED`, and `DEPRECATED`.

Technical facts may be auto-extracted from reliable sources. Business meanings
may be drafted as `AI_INFERRED`, but only `HUMAN_VERIFIED` semantics may advance
into production capability design. A verified statement remains bounded to its
recorded source, scope, owner, and review date.

## Step 1 — Collect Available Sources

Inventory OpenAPI/Swagger, Backend source, Frontend API clients, SDKs, Postman
Collections, integration tests, and existing documentation. Record versions,
commits, locations, owners, capture dates, access restrictions, and known gaps.
Add human interviews as explicit sources rather than unattributed notes.

Neither a Frontend repository nor a Backend repository is universally required.
Prefer an official API contract or authoritative Backend source for technical
shape; use Backend implementation/DTO/tests when needed, and inspect Frontend
usage when UI vocabulary, real usage, actual filters, user-facing concepts, or
source conflicts need evidence. Business documents/interviews and Human Review
settle unresolved semantics. See the [source tiers](./customer-artifact-map.md#source-discovery-no-mandatory-frontend--backend-pair).

Do not collect secrets or copy live Customer data into the onboarding record.
If sources disagree, retain both claims and create a blocking Human Review
Question where the conflict affects semantics, safety, mapping, or activation.

## Step 2 — Build The Technical Inventory

Use Codex or approved tooling to extract operations, methods, paths, request
shapes, response shapes, error behavior, and authentication requirements. Mark
direct observations `AUTO_EXTRACTED` and link each item to exact source evidence.

Automation may identify a field's type and location; it must not infer business
meaning from names such as `status`, `count`, or `value`. Keep unknown
`businessMeaning` values null and mark them `NEEDS_HUMAN_REVIEW`.

## Step 3 — Create Business Semantic Candidates

Draft candidate concepts, vocabulary, capabilities, parameters, output meanings,
and examples from the available evidence. Mark all machine-proposed business
meaning `AI_INFERRED`. Keep the design domain-neutral: describe what the Customer
actually calls and means, without forcing a standard industry taxonomy.

Separate a user-facing business capability from any API endpoint. Also separate
values the Assistant can recognize from values an approved binding can execute.

## Step 4 — Surface Uncertainty

Mark missing, weak, ambiguous, stale, or conflicting claims
`NEEDS_HUMAN_REVIEW`. Add a specific Human Review Question with source, subject,
reason, blocking flag, and responsible owner. Do not fill gaps with conventions,
nearby endpoint behavior, another Customer's semantics, or an AI guess.

## Step 5 — Conduct Human Review

The technical owner validates source interpretation, API behavior, mapping, and
operational limits. The business owner validates concepts, terminology,
capability boundaries, parameters, measures, time semantics, and output meaning.
Security/permission owners validate sensitivity, minimization, roles, scopes,
policies, credential ownership, and Customer isolation.

Record the reviewer and date. Resolve conflicts explicitly; never promote an
item merely because all questions were discussed.

## Step 6 — Promote Verified Semantics Only

Promote only `HUMAN_VERIFIED` business semantics into production capability
design. `AUTO_EXTRACTED` technical facts still require the appropriate runtime
contract and deployment reviews. `AI_INFERRED` and `NEEDS_HUMAN_REVIEW` content
may remain in the working record but must not become production authority.

## Step 7 — Select The Correct Lane

Classify each verified user need without changing existing routing authority:

| Lane | Use when | Boundary |
| --- | --- | --- |
| Tool | A supported canonical business operation requires approved execution. | Must use an existing registered Tool and all current policy, permission, projection, and evidence checks. |
| RAG / knowledge | The answer comes from authorized SOPs, manuals, policies, FAQs, procedures, or documents. | Must use the existing Customer/organization/permission-filtered retrieval and evidence path. |
| Meta / Help | The user asks what the scoped Assistant can do or how to ask. | Use current active, discoverable, authorized metadata; no Customer business API call. |
| Conversation | The request depends on compatible current-scope follow-up context. | Conversation is context only, never identity, permission, Tool, or evidence authority. |
| Clarification | Required meaning is missing, invalid, conflicting, ambiguous, or unsupported. | Ask a bounded question or return the authoritative typed outcome; execute nothing. |

Do not create a second Tool registry, RAG stack, agent loop, fallback operation,
or model-selected URL/API path to accommodate a lane.

## Step 8 — Design Capability, Binding, And Connector Mapping

Define the Customer-owned capability and semantic profile first. Then define a
Central Customer-scoped binding to an existing registered, approved,
schema-compatible canonical Tool contract. Account for every supplied canonical
parameter through a closed mapping or reviewed semantic constraint.

Separately document the Customer-local fixed operation mapping, response
validation/extraction/normalization, limits, safe errors, and credential-provider
ownership. Native credentials, refresh, and revocation remain Customer-local.
The Central Assistant never stores them. The onboarding record must not contain
secret values or a live `connectorContextRef`.

## Step 9 — Build The Semantic Evaluation Dataset

For every capability, cover multiple positive paraphrases plus negative,
ambiguous, missing-parameter, unsupported-parameter, and follow-up cases. Include
expected intent, capability, canonical parameters, and execute/clarify/unavailable
outcome. Add cross-Customer collision/isolation cases without materializing a
shared cross-Customer candidate pool.

Acceptance cannot rely on one magic sentence. Failures must prove zero unintended
Tool calls and zero Customer business requests where execution is not approved.

## Step 10 — Run End-To-End Acceptance

Validate the full approved path and its fail-closed alternatives:

1. Verified request scope selects only the intended Customer/integration/HostApp.
2. Scoped semantics resolve the expected capability and canonical parameters.
3. Binding lookup stays in the same verified scope and references an exact Tool version.
4. Existing Tool Registry, CustomerToolPolicy, input schema, risk, permission, and approval controls still apply.
5. Customer-local Connector Runtime alone owns fixed upstream mapping and native credentials.
6. Returned data is validated, bounded, minimized, projected, and evidenced through existing authority.
7. Negative, ambiguous, missing, unsupported, unauthorized, stale, and cross-Customer cases fail closed.
8. Discovery/help output exposes no internal Tool key, endpoint, credential, topology, or permission implementation.
9. The semantic evaluation dataset passes without Customer-specific Core branches.
10. Human owners approve production activation and record evidence/date separately.

Use [`review-checklist.md`](./review-checklist.md) as the release gate. Creating
or completing an onboarding document does not itself activate production.

## Source Availability Does Not Decide Review Effort

Having OpenAPI does not remove human review: an API schema can establish
technical structure while omitting or misrepresenting business semantics,
sensitivity, authorization, aggregation, or lifecycle meaning.

Lacking OpenAPI does not require fully manual inventory. Backend source,
Frontend clients, SDKs, Postman Collections, tests, and existing documents can
still establish source-backed technical facts. Their business interpretation
must follow the same evidence and human-verification gates.

## Stop Conditions

Stop at the documentation layer and request human review when onboarding would
require changing Feature 008–012 authority, `GroundedContextBundleV1`, public
HTTP/SSE contracts, Gateway, Identity Bridge, Connector binding lifecycle,
Prisma schema, Customer Tool policy **model** (as opposed to provisioning an
approved exact Customer policy), or the permission model. Also stop when a
new agent loop, long-term memory, Tool registry, RAG stack, LLM Tool authority,
or arbitrary URL/API execution appears necessary.

Any future conversion of this information model into a runtime loader schema,
automatic Capability Pack generator, Tool/Connector change, or Customer
production configuration is separate work requiring explicit human review.
