# Feature 002 — Implementation Inventory and Feature 001 Regression Baseline

**Tasks completed**: T001–T004. T003 completed the documentation-only retained-data mapping runbook; T004 completed a read-only reset/seed safety inventory.  
**Evidence date**: 2026-08-03.  
**Method**: static, read-only inspection of the repository. No test, seed, migration, DB-reset, other DB-writing command, or T005+ command was executed.

## 1. Repository Baseline

| Area | Existing repository evidence | Feature 002 disposition |
| --- | --- | --- |
| Identity | `src/identity/identity.guard.ts`, extractor, validator, types, errors and module | Header-era identity is replaced in T010–T016; CustomerScope follows in T017–T020. |
| Assistant/session/message/history/SSE | `src/assistant/{session,message,history,context,planning,answer,runtime,sse}/**`, `assistant.controller.ts` | Core behavior exists; extend and customer-scope in T034–T041. |
| Retrieval/RAG/evidence | `src/retrieval/**`, `src/evidence/evidence-ref.service.ts` | Retrieval and evidence exist; migrate/scoped in T026–T027 and T042–T049. |
| Tools/permissions | persisted `ToolDefinition`, `src/tools/**`, `src/permissions/**`, mock connector adapter | Preserve global ToolDefinition; add CustomerToolPolicy/scope in T028 and T050–T057. |
| Approval/action/escalation | `src/approvals/**` | Existing workflows extend with Customer scope in T029 and T058–T063. |
| Feedback/review/audit | `src/feedback/**`, `src/audit/**`, `src/common/logger/redaction.util.ts` | Existing functionality extends with Customer scope in T029 and T064–T069. |
| Prisma | 21 models in `prisma/schema.prisma`; no `Customer` model or `customerId` fields | Ownership schema/migration is T025–T033. |
| Migrations | `20260615044944_init`, `20260621000000_add_escalation_expired_status` | Customer/policy migration is not present; T030–T031. |
| Seeds / DB safety | `scripts/seed.ts`, `scripts/test-db-init.ts`, `scripts/test-db-safety.ts`, `scripts/us1-test-fixtures.ts` | Existing seed and safety guard extend in T032 and T070–T075. |
| Test helpers | `test/support/us1-db-test.helper.ts`, `test/support/us1-test-app.helper.ts` | Customer fixtures are not present; T005 and T021. |
| Tests | unit, integration, contract, e2e and eval suites exist under `test/**` | Regression baseline is recorded below; Feature 002 cases start at T005. |
| Package commands | `test`, `test:unit`, `test:integration`, `test:contract`, `test:e2e`, `test:eval`, `test:db:init`, Prisma commands | See regression baseline below. |
| Customer / CustomerScope / CustomerToolPolicy | **Not found in current repository** | T019–T020, T025 and T028. |
| Knowledge organization/visibility/scope policy | **Not found in current repository** | T026, T043 and T046–T048. |
| Gateway runtime | **Not found in current repository** | Explicitly out of scope; T082 is verification only. |

## 2. Identity Inventory

| Path and symbol | Current behavior | Feature 002 target | Follow-up |
| --- | --- | --- | --- |
| `src/identity/identity-context.extractor.ts` — `IDENTITY_HEADER_NAMES`, `extract` | Reads five public identity headers: `x-actor-id`, `x-host-app`, `x-organization-id`, `x-role`, `x-permission-scopes`; maps them directly to request identity. | Verify Gateway internal JWT only; public headers cannot create, supplement, override, or fallback identity. | T005–T009, T011–T015 |
| `src/identity/identity-context.types.ts` — `ActorContext`, `HostAppContext`, `CompanyBoundary`, `RequestIdentityContext` | Actor has one `role`; CompanyBoundary is only organizationId; requestId is inside identity context. | Canonical context contains Customer/integration, organization, host app, actor roles/scopes, auth metadata and separate requestId. | T013–T016 |
| `src/identity/identity-context.validator.ts` — `validateActorContext`, `validateRequestIdentityContext` | Requires non-empty `role`, non-empty `permissionScopes`, and non-empty `requestId`; treats all missing values as identity-context failures. | Empty authorization arrays become valid verified identity; token failures are 401 and verified claim failures 403; requestId is tracing-only. | T006–T009, T014, T016 |
| `src/identity/identity.guard.ts` — `canActivate` | Calls the header extractor as the protected-endpoint identity authority. | Guard performs Bearer/JWKS validation and stores only verified canonical context. | T011–T015 |
| `src/identity/identity-context.extractor.ts` — `getIdentityContext` | Request accessor exposes header-derived identity context. | Accessor exposes only canonical verified context; consumers must not reconstruct identity. | T013, T016, T019 |
| `src/common/request-id/request-id.{middleware,interceptor,util}.ts` | Request ID is normalized by trusted request-id layer, but validator also requires it as identity input. | Retain tracing/correlation behavior; remove identity authority. | T009, T016 |
| `src/assistant/assistant.controller.ts`, `src/permissions/tool-permission-precheck.service.ts`, `src/retrieval/retrieval.service.ts`, `src/audit/audit-writer.service.ts` | Consume `identityContext.company`, host app and single actor role/scopes. | Consume canonical context and CustomerScope; no controller/service assembly from payload/headers. | T016, T019–T020 |
| `test/unit/identity-context-validation.spec.ts` | Covers `role` and asserts empty `permissionScopes` is invalid. | Retire that assertion; replace with JWT canonical-claim validation allowing empty arrays. | T007, T014 |
| 27 test files / 127 literal occurrences | Existing test fixtures and endpoint tests send public identity headers. | Replace with signed internal-JWT fixtures; never retain headers as a fallback. | T005–T009 and T076–T079 |

**Public identity-header count**: five distinct production header reads in one extractor (`IDENTITY_HEADER_NAMES`); 27 test files contain 127 literal header occurrences. The latter are legacy contract coverage, not a valid production authority.

## 3. Customer-Owned Query and Constraint Inventory

| Entity / area | Path and current query or constraint | Risk | Feature 002 handling | Task |
| --- | --- | --- | --- | --- |
| Sessions | `assistant-session.service.ts` — `findFirst` filters by id + organizationId + hostApp + actorId | Organization/host/actor are insufficient as the outer boundary. | Customer-first session predicates; preserve safe not-found. | T038, T041 |
| Messages | `assistant-message.repository.ts` — create/list by `sessionId`; completion updates bare message ID | Child reads/writes rely on parent/global IDs instead of Customer-qualified relation. | Customer-qualified message persistence and parent traversal. | T039–T040 |
| History | `assistant-history.service.ts` — tool calls by sessionId and evidence by message IDs after session lookup | Follow-on records have no direct Customer constraint. | Scope all history related queries before materialization. | T039, T049 |
| Feedback | `feedback-event.service.ts` — `assistantMessage.findUnique({ id })`; tool/evidence list by messageId | Bare message lookup occurs before scoped session check; related lists lack Customer predicate. | CustomerScope-first message/evidence/tool access. | T067 |
| Review | `review-item.service.ts` — two `reviewItem.findUnique({ id })`; list/query behavior additionally evaluates JSON metadata organization/host values in application code | Global IDs and metadata are used as isolation input. | Direct customerId + Customer-first queries; metadata never establishes isolation. | T068 |
| Approval | `approval-request.service.ts` — `approvalRequest.findUnique({ id })`, then session lookup | Bare workflow resource lookup; global idempotency unique. | Scope before get/transition/retry; customer-scoped idempotency. | T029, T061 |
| Action draft | `action-draft.service.ts` — `actionDraft.findUnique({ id })`, then session lookup | Bare workflow lookup; global idempotency unique. | Scope before transition/side effect; customer-scoped idempotency. | T029, T062 |
| Escalation | `escalation-request.service.ts` — `escalationRequest.findUnique({ id })`, then session lookup | Bare global workflow lookup. | Customer-first get/list/transition. | T029, T063 |
| Tool calls | `side-effect-execution-guard.service.ts` — `toolCall.findFirst({ idempotencyKey })`; schema `@@unique([idempotencyKey])` | One Customer can suppress or observe another Customer's idempotent side effect. | Customer-scoped ToolCall lookup/unique key and precheck. | T029, T052, T056 |
| Approval/action idempotency | `ApprovalRequest` and `ActionDraft` each have `@@unique([idempotencyKey])` | Same global-key collision risk. | Customer-scoped unique keys and retry checks. | T029, T058–T062 |
| Knowledge source/version | `KnowledgeDocument @@unique([sourceKey, version])`; `scripts/seed.ts` `findUnique(sourceKey_version)` | Different Customers cannot own identical source/version; seed is global. | Customer-scoped source/version and policy-aware seed. | T026–T027, T032, T042, T070–T073 |
| Parent/multi-aggregate relations | Existing schema relations use global IDs and several cascades/set-null relations (session/message/document/chunk/retrieval/workflow) | Database cannot prove related rows share a Customer. | Customer-qualified parent keys/composite integrity, preserving parent-owned strategy where appropriate. | T025–T030, T037, T044 |
| Audit | `AuditEvent` stores organization/host/actor and optional references, but no customerId | Audit ownership cannot prove Customer boundary. | Direct Customer audit ownership and scoped references. | T029, T063, T069 |

**Bare global-ID query count**: six `findUnique({ id })` sites across approval, action draft, escalation, feedback message, and two review-item flows. This count excludes secondary `findFirst`/`findMany` calls that are also Customer-incomplete and listed above.

**Global unique-key issues**: three idempotency uniques (`ToolCall`, `ApprovalRequest`, `ActionDraft`) and one knowledge unique (`KnowledgeDocument[sourceKey, version]`). `ToolDefinition[name, version]` is intentionally global and is preserved.

## 4. RAG Inventory

| Component | Current behavior | Feature 002 target | Task |
| --- | --- | --- | --- |
| KnowledgeDocument / KnowledgeChunk | Document has source/version/status/metadata; Chunk has enabled/document/content/embedding fields. Neither has customerId, organization applicability, visibility or required scopes. | Persist valid policy on document only; chunk inherits through relation. | T026, T046 |
| Chunking | `knowledge-chunking.service.ts` creates content chunks by documentId only. | Preserve chunking semantics; map document policy through the relation. | T046 |
| Retrieval input | `retrieval-provider.interface.ts` provides organizationId but no Customer, visibility or scope policy. | Canonical scope supplies Customer, organization and permission input. | T047 |
| Candidate selection / ranking | `deterministic-retrieval.provider.ts` first queries every enabled chunk whose document is active; it then materializes title, content, sourceKey, metadata and score, filters/ranks in memory. | Data-layer pre-candidate order: Customer → visibility/organization → required scopes ALL → candidate selection → ranking. | T043, T047 |
| Retrieval persistence | `retrieval.service.ts` persists run/candidates after provider results and writes selected IDs/source keys to audit metadata. | Persist only authorized Customer candidates/runs/evidence; safe no-evidence on denied policy. | T027, T048–T049 |
| Evidence | `evidence-ref.service.ts` records document/chunk IDs, title/sourceKey/snippet after candidate selection. | Customer-qualified evidence references and relations. | T027, T044, T049 |
| No-answer | `RetrievalRun.noAnswerReason` is set when no selected candidates. | Preserve no-evidence behavior without implying inaccessible/other-Customer documents. | T042–T045, T048 |

**Current filter order**: `enabled=true` → `document.status=active` → materialize all matching chunk/document content and metadata → keyword score → in-memory score filter/ranking. No Customer, organization, visibility, permission, or HostApp policy filter exists.

## 5. Tool, Workflow, Quality, and Redaction Inventory

| Capability | Existing behavior | Feature 002 disposition | Task |
| --- | --- | --- | --- |
| ToolDefinition and registry | Persisted global Prisma model; `ToolRegistryService` lists/resolves active DB records; seed upserts `name/version`. | PRESERVE global product contract; add CustomerToolPolicy by stable ID. | T028, T050, T054 |
| Permission precheck | `ToolPermissionPrecheckService` requires all tool scopes and audits denial. | Preserve ALL-style precheck; add canonical CustomerScope and Customer policy. | T051, T055 |
| Tool lifecycle / side effect guard | Runtime ToolCall lifecycle and side-effect idempotency guard exist. | Extend Customer-first checks before connector/side effect. | T052, T056–T057 |
| Approval/action/escalation | Existing state machines, controllers and audit flows exist. | Extend queries/transitions/retries with Customer scope. | T058–T063 |
| Feedback/review | Feedback links message/tool/evidence; review supports list/get/transition. | Extend direct ownership and remove metadata-only isolation. | T064–T068 |
| Audit / redaction | Audit writer stores organization/host/actor and redacts metadata/permission result using `redactSecrets`. | Preserve redaction; add customer ownership/traceability. | T057, T063, T066, T069 |
| Connector credentials / instances | **Not found in current repository** | Out of scope; do not add. | None |

## 6. Feature 001 Compatibility / Supersession Matrix

| 001 requirement/task | Existing implementation files | Existing behavior | 002 handling | 002 task | Regression expectation |
| --- | --- | --- | --- | --- | --- |
| API routes and response envelope | `assistant.controller.ts`, `response-envelope.interceptor.ts` | Assistant routes and common envelope exist. | PRESERVE | T008, T034–T041 | Existing route/envelope semantics remain; identity transport updates. |
| SSE contract | `src/assistant/sse/**`, `assistant-messages-sse.contract.spec.ts` | SSE events and error handling exist. | PRESERVE | T008, T036, T041 | Guard failures remain JSON envelope before SSE; valid event contract remains. |
| PageContext | `page-context/**` | Existing page input/mapping. | PRESERVE | T037, T040 | No Customer identity inferred from page input. |
| Context state and ExecutionPlan | `context/**`, `planning/**` | Parent-owned conversation records exist. | PRESERVE | T037, T040 | Access only through scoped parent session/message. |
| Evidence, grounding, no-answer, clarification | `evidence/**`, `answer/**` | Evidence/no-answer gates and grounding paths exist. | PRESERVE | T042–T049 | Preserve output semantics; Customer-scope relations. |
| Tool lifecycle | `tool-call.service.ts`, `side-effect-execution-guard.service.ts` | Registry, permission, risk and side-effect flow exist. | PRESERVE | T050–T057 | No Customer bypass; denial remains before side effect. |
| Approval state machine | `approvals/**` | Approval/action/escalation state transitions exist. | PRESERVE | T058–T063 | Same state semantics with Customer-first access. |
| Feedback/review | `feedback/**` | Existing feedback and review linkage. | PRESERVE | T064–T068 | Preserve workflows; Customer scope replaces metadata boundary. |
| Logger redaction / health/readiness | `redaction.util.ts`, `health-readiness.controller.ts` | Redaction and non-business infrastructure endpoints exist. | PRESERVE | T009, T066, T082 | No raw token; health/readiness stay non-business. |
| Session/message/history | `assistant/{session,message,history}/**` | Organization/host/actor visibility and global child IDs. | EXTEND | T034–T041 | Same endpoints with Customer-first access. |
| Retrieval/RAG | `retrieval/**`, `evidence/**` | Global active-chunk retrieval. | EXTEND | T042–T049 | Preserve answer/no-answer flow with pre-candidate policy filtering. |
| Tool permission | `tool-permission-precheck.service.ts` | Existing scope precheck without Customer policy. | EXTEND | T050–T057 | Add CustomerToolPolicy; preserve denied-before-side-effect. |
| Approval/action/escalation and audit | `approvals/**`, `audit/**` | Existing lifecycle/audit without customerId. | EXTEND | T058–T063 | Customer-first reads/transitions/audit. |
| Feedback/review/audit | `feedback/**`, `audit/**` | Existing records without customerId; review uses metadata. | EXTEND | T064–T069 | Direct Customer ownership; no metadata authority. |
| Public identity-header authority | `identity-context.extractor.ts`, `identity.guard.ts` | Header values create trusted context. | REPLACE | T005–T015 | JWT only; no header fallback. |
| Host decides canonical identity | header extractor + Host header inputs | Host supplies actor/org/role/scopes. | REPLACE | T011–T016 | Gateway claims decide canonical identity. |
| Single role | `ActorContext.role` and tests | One string role is mandatory. | REPLACE | T007, T013–T014 | `roles: string[]`; no single-role compatibility shim. |
| Non-empty permission scopes | validator and `identity-context-validation.spec.ts` | Empty scopes invalid. | REPLACE | T007, T014, T051 | Empty scopes valid verified identity, with authorization denial where needed. |
| Organization-only outer boundary | `CompanyBoundary`, session/audit filters | organizationId/hostApp/actor are isolation boundary. | REPLACE | T019–T020, T025, T034–T069 | Customer is outermost boundary. |
| requestId identity requirement | validator `validateRequestIdentityContext` | Missing requestId invalidates identity. | REPLACE | T009, T013–T016 | RequestId is tracing/audit correlation only. |
| Global resource lookup and global RAG query | listed in sections 3–4 | Bare IDs/global chunks are queried before Customer policy. | REPLACE | T020, T038–T069 | Customer-first access and pre-candidate RAG filters. |
| Prisma ownership | `prisma/schema.prisma` | No Customer root/customerId. | MIGRATE | T025–T031 | Additive schema → explicit mapping/backfill → validate → enforce. |
| Idempotency/source version | schema and `scripts/seed.ts` | Global unique keys. | MIGRATE | T027, T029–T032, T052, T070–T075 | Same key/version may coexist across Customers. |
| Customer-qualified relations | schema relations | Relations use global parent IDs. | MIGRATE | T025–T030, T044 | Database integrity proves same Customer where needed. |
| Knowledge policy / seeds | Knowledge models and `scripts/seed.ts` | No ownership/policy fields. | MIGRATE | T026, T030–T032, T070–T075 | Explicit ownership/policy; invalid/unmapped documents deny/retrieval block. |
| Header-authority tests | 27 test files with header literals | Tests encode old trusted-header contract. | RETIRE | FR-001–FR-005; T005–T009 | Replace with signed JWT fixtures; never restore header fallback. |
| Single-role tests | `identity-context-validation.spec.ts` and identity fixtures | Tests require `role`. | RETIRE | FR-003, FR-006; T007, T013–T014 | Replace with `roles[]` claim tests. |
| Non-empty scope tests | `identity-context-validation.spec.ts` | Tests reject `permissionScopes: []`. | RETIRE | FR-003, FR-006; T007, T014, T051 | Replace with valid-empty-array/authorization-denial tests. |
| requestId-invalid identity tests | `identity-context-validation.spec.ts` | Missing requestId treated as identity invalid. | RETIRE | FR-007; T009, T013–T016 | Replace with tracing normalization tests. |

**Matrix counts**: PRESERVE 9; EXTEND 5; REPLACE 7; MIGRATE 4; RETIRE 4; total 29 rows. Each matrix row is counted once even when it names multiple related concepts.

## 7. Feature 001 Regression Baseline

No baseline command was executed in T002. `test:db:init`, `prisma:migrate`, `prisma:deploy`, and `prisma:seed` can write/reset databases and are recorded only. Other test commands were also not run because this batch establishes classification rather than test execution.

| Command / suite | Current status | Classification | Feature 002 expectation | Task |
| --- | --- | --- | --- | --- |
| `npm run test:unit` — session/history/context/planning/answer/page-context | Existing unit coverage present. | UNCHANGED_REGRESSION | Preserve behavior and update identity fixture types as consumers migrate. | T007, T034–T041, T076 |
| `npm run test:integration` — session/history/SSE/page context | Existing Feature 001 integration coverage present. | UPDATED_CONTRACT | Signed Customer A/B identity and safe cross-Customer cases replace header authority. | T034–T041, T077 |
| `npm run test:contract` — sessions/messages/SSE | Existing endpoint and SSE contract coverage present. | UPDATED_CONTRACT | Preserve envelope/SSE; assert 401/403 JWT errors before orchestration. | T008, T034–T036, T078 |
| `npm run test:integration` — retrieval/evidence/no-answer | Existing RAG/evidence suites present. | UPDATED_CONTRACT | Add Customer/policy pre-candidate filtering and disclosure-negative cases. | T042–T049, T077 |
| `npm run test:eval` — `internal-assistant-core.eval.spec.ts` | Existing evaluation suite present. | UPDATED_CONTRACT | Retain answer/no-answer quality while adding Customer RAG isolation eval. | T045, T079 |
| Tool registry, permission masking and tool execution suites | `tool-registry`, `tool-permission-precheck`, authorized/denied tool integration tests exist. | UPDATED_CONTRACT | Preserve global ToolDefinition; add CustomerToolPolicy and scoped idempotency. | T050–T057 |
| Approval/action/escalation suites | Contract/integration workflow tests exist. | UPDATED_CONTRACT | Preserve state machine; add Customer-first get/list/transition/retry. | T058–T063 |
| Feedback/review/audit/redaction suites | Existing contract/integration/unit redaction coverage present. | UPDATED_CONTRACT | Add direct Customer ownership and retain redaction. | T064–T069 |
| Health/readiness contract suite | `health-readiness.contract.spec.ts` exists. | UNCHANGED_REGRESSION | Remains non-business/non-Customer-data endpoint. | T076 |
| `npm run test:e2e` — `app.e2e-spec.ts`, `non-functional.e2e-spec.ts` | Existing end-to-end coverage uses legacy headers. | UPDATED_CONTRACT | Preserve full flow and replace identity fixture transport; add A/B isolation. | T037, T079 |
| Header-authority and single-role identity tests | `identity-context-validation.spec.ts`, header-based endpoint tests | Old contract is explicitly encoded. | RETIRED_BY_002 | Replace rather than retain; no fallback. | T005–T009, T014–T015 |
| Empty permission-scope invalidity test | `identity-context-validation.spec.ts` | Old contract explicitly rejects an empty array. | RETIRED_BY_002 | Replace with valid empty arrays and operation-level denial. | T007, T014, T051 |
| Organization-only boundary suites | `organization-boundary.spec.ts`, session visibility tests | Existing tests validate lower-level boundary only. | RETIRED_BY_002 | Keep useful assertions only after converting to two Customers sharing organization/actor/HostApp. | T034–T045 |
| DB reset/seed/migration policy tests | No Customer ownership/policy migration suite exists. | NEW_002_COVERAGE | Create deterministic A/B fixtures, mapping preflight and enforcement coverage. | T021–T024, T070–T075 |
| CustomerScope and JWT/JWKS verification suites | **Not found in current repository** | NEW_002_COVERAGE | Add canonical token/CustomerScope fixtures and tests before implementation. | T005–T020 |
| `npm run test` aggregate | Runs all Jest tests; suitability depends on DB/env setup. | UNKNOWN_REQUIRES_REVIEW | Run after focused suites and after fixture migration; do not treat as initial baseline. | T076–T081 |
| `npm run test:db:init`, `npm run prisma:migrate`, `npm run prisma:seed` | Destructive/state-changing DB commands. | UNKNOWN_REQUIRES_REVIEW | Do not execute in T001/T002; use only under T030–T033/T070–T081 safeguards. | T030–T033, T070–T081 |

### Regression suites that must be preserved

- Session/message/history and SSE endpoint/envelope behavior.
- PageContext, AssistantContextState, ExecutionPlan, grounding/evidence, no-answer and clarification behavior.
- ToolDefinition registry, permission masking, tool lifecycle and denied-before-side-effect behavior.
- ActionDraft, ApprovalRequest, EscalationRequest state machines.
- Feedback/review linkage, audit traceability, logger/observability redaction, health/readiness, e2e and eval behavior.

### Suites that must be updated or retired

- All trusted public-header identity fixtures/tests, single-role expectations, non-empty-scope identity validation and requestId-as-identity assertions.
- Organization-only outer-boundary assertions; convert to Customer A/B sharing organizationId, actorId and HostApp.
- Global ID/idempotency/source-version and global active-knowledge retrieval assumptions.

## 8. Open Repository Observations

- `src/generated/prisma/**` is generated output from the current no-Customer schema and must be regenerated only in T033.
- README currently documents header-based assistant smoke calls; Feature 002 changes its contract later, but this batch does not edit README.
- The repository has no Gateway internal-JWT verifier or customer policy implementation; this is expected Feature 002 work, not an inventory defect to fix now.
- The aggregate `npm run test` and DB-backed commands require environment review before execution; no safe read-only test command was needed to establish this baseline.

## 9. Reset and Seed Safety

| Operation | Actual command / implementation | Safety finding | Feature 002 follow-up |
| --- | --- | --- | --- |
| Prisma client generation | `npm run prisma:generate` | Writes generated client artifacts; not run in this batch. | T033 |
| Development migration | `npm run prisma:migrate` → `prisma migrate dev --name init` | Uses `DATABASE_URL` from `prisma.config.ts`; no repository DB-name guard prevents an operator from targeting a production-like URL. | T030–T031, T080 |
| Development seed | `npm run prisma:seed` → `scripts/seed.ts` | Uses the current `DATABASE_URL`; no environment/database-name guard. It upserts global `KnowledgeDocument[sourceKey, version]` and deterministic global ToolDefinition fixtures. | T032, T070–T075 |
| Test DB initialization | `npm run test:db:init` → `scripts/test-db-init.ts` | Loads `.env.test` first, requires `NODE_ENV=test`, `ALLOW_TEST_DB_RESET=true`, valid `DATABASE_URL`, and database name `assistant_test` or suffix `_test`; then deletes all listed baseline tables and reseeds. Not run in this batch. | T004 baseline; T021, T032, T070–T075 |

### Configuration and documentation alignment

- `prisma.config.ts` reads its datasource exclusively from `DATABASE_URL`, stores migrations in `prisma/migrations`, and sets `npm run prisma:seed` as its seed command.
- `package.json` exposes `prisma:migrate`, `prisma:seed`, and `test:db:init` consistently with those script entry points.
- `scripts/test-db-safety.ts` is not an independent executable package command. `scripts/test-db-init.ts` imports and calls `assertSafeTestDatabaseReset`; that function checks `NODE_ENV=test`, `ALLOW_TEST_DB_RESET=true`, a valid `DATABASE_URL`, and database name `assistant_test` or an `_test` suffix.
- `Not found in current package scripts`: a Prisma validate command. No script was added by this documentation task.
- README instructs separate `.env` and `.env.test`, requires `ALLOW_TEST_DB_RESET=true` for `test:db:init`, and distinguishes Docker host `postgres:5432` from host-side `localhost:5435` commands.
- README correctly describes `test:db:init` as destructive only behind its explicit test safety guard. README examples do not provide an equivalent DB-name guard for `prisma:migrate` or `prisma:seed`; operators must treat these as state-changing development commands.

### Deterministic seed and Feature 002 gaps

- Current seed deterministically upserts ToolDefinition fixtures and three active KnowledgeDocuments, then deletes/recreates their chunks.
- No Customer root, Customer A/B pair, `customerId`, customer-scoped duplicate source/version/idempotency fixture, or Customer-qualified relation fixture exists.
- KnowledgeDocument seed has no `visibility`, `organizationIds`, or `requiredPermissionScopes`; it cannot represent CUSTOMER/ORGANIZATION policy, empty scopes, ALL-scope policy, or invalid-policy fixture behavior.
- These gaps are intentional future work for T021, T024–T032, and T070–T075. This batch records them only.

### Batch execution status

No reset, migrate, generate, seed, test-DB initialization, or other database-writing command was executed in T003/T004. The existing test reset guard is sufficient for its current baseline purpose; broader migration/seed target validation remains a later operational concern and must not be implemented by this documentation batch.

## T001–T004 Completion Boundary

This inventory establishes the Feature 001 preservation/replacement baseline, records the T003 documentation-only mapping runbook, and records T004 reset/seed safety. It does not create a migration, modify code/schema/seed, add tests, run DB commands, or perform T005+ work.
