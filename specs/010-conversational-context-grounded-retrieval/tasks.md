# Tasks: Feature 010 — Conversational Context & Grounded Retrieval

**Canonical Feature Path**: `specs/010-conversational-context-grounded-retrieval`  
**Input**: `spec.md`, `design.md`, and `plan.md` in `specs/010-conversational-context-grounded-retrieval/`  
**Implementation Status**: Phase 4 T034–T043 complete; Phase 5 not started
**Testing Rule**: For every changed runtime behavior, run the named focused test first and retain authentic RED evidence, then implement and retain GREEN evidence.

## Format

- Every task uses `- [ ] TNNN [P?] [US?] Description with exact path`.
- `[P]` is used only for different-file work whose predecessors are complete.
- Story labels appear only in Phases 4–6 and map to the five stories in `spec.md`.

## Canonical Seven-Phase Model

1. **Phase 1 — Baseline, repository inventory, RED fixtures, scope guards**
2. **Phase 2 — Shared contracts and bounded conversation-context foundation**
3. **Phase 3 — Grounded retrieval contracts and routing**
4. **Phase 4 — Semantic follow-up and retrieval re-entry**
5. **Phase 5 — RAG retrieval and document evidence normalization**
6. **Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly**
7. **Phase 7 — Cross-cutting security, compatibility and local backend acceptance**

## Canonical User Stories

1. **US1 — Semantic follow-up and retrieval re-entry**
2. **US2 — Document-only grounded retrieval**
3. **US3 — Tool-only grounded retrieval**
4. **US4 — Hybrid grounded retrieval and coverage**
5. **US5 — Eligible prior grounded-context reuse**

## Phase 1 — Baseline, repository inventory, RED fixtures, scope guards

- [X] T001 Record Feature 007/008/009, RAG, Tool, evidence, AnswerDecision/GroundingCheck, SSE, history, and LLM-seam baseline commands/results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [X] T002 [P] Add a scope guard proving Feature 009 T126–T142, manifest, Gateway, Identity Bridge, schema, public contracts, and external repositories remain untouched in `test/contract/feature010-scope-boundary.contract.spec.ts`
- [X] T003 [P] Add RED bounded-context, incomplete-pair, and prohibited-source fixtures in `test/unit/conversation-context-loader.service.spec.ts`
- [X] T004 [P] Add RED routing-mode, four-need, and one-Tool-need fixtures in `test/unit/grounded-retrieval-router.service.spec.ts`
- [X] T005 [P] Add RED INHERIT/REPLACE/NEW_TOPIC/CLARIFY fixtures in `test/unit/follow-up-semantic-resolver.service.spec.ts`
- [X] T006 [P] Add RED document normalization, citation, and prompt-like-content fixtures in `test/unit/grounded-document-evidence.normalizer.spec.ts`
- [X] T007 [P] Add RED Tool normalization and raw/pre-projection rejection fixtures in `test/unit/grounded-tool-evidence.normalizer.spec.ts`
- [X] T008 [P] Add RED Hybrid COMPLETE/PARTIAL/INSUFFICIENT fixtures in `test/unit/grounded-context-bundle.service.spec.ts`
- [X] T009 [P] Add RED prior document/Tool/Hybrid eligibility fixtures in `test/unit/prior-grounded-evidence-eligibility.service.spec.ts`
- [X] T010 Add RED document-only, Tool-only, Hybrid, follow-up, recall, and call-count scenarios in `test/integration/feature010-grounded-retrieval.spec.ts`

**Checkpoint**: Existing suites pass; T003–T010 fail only for missing Feature 010 behavior; no production file has changed.

### Phase 1 execution evidence — blocked at T001 (2026-09-16)

T001 began from branch `010-conversational-context-grounded-retrieval` at commit `51508ce79daf8b45ce737a59d6253d7154e9ef7d`. The only entry worktree item was the pre-existing untracked `apps/customer-connector-runtime/test/fixtures/phase6-upstream.key`; it remains untouched. Both Spec Kit resolver forms completed with exit 0 and resolved this canonical feature directory plus `spec.md`, `design.md`, `plan.md`, and `tasks.md`:

```text
.specify/scripts/bash/check-prerequisites.sh --json --require-tasks --include-tasks
.specify/scripts/bash/check-prerequisites.sh --paths-only
```

Protected entry SHA-256 values:

```text
Feature 007: spec=030f899f46d94d15b1357fb62de599e578a22cae5c388ddd35f57f194fa997cd
             design=22439db8e4d7154d24311e41ecdea05c22d55edca159076779024a89c33be369
             plan=cf3a2d5c36345eea6d61b7c26ce9cda20a4503cbc1a6b748a478fda3b0c9f9ea
             tasks=eb6f7c4cded0e704fff9ef9e46dda7e4d6c79ab22da86502b8f33c0692b3b269
Feature 008: spec=59fb07a7d885d8b754bc23c1e8adf89c3100fab4eee9c753381010c0822b1cce
             design=d50bb4655b94a6fcd3dc4f56baa46609bce795d91de9b812a0fbfd96eaaa83b4
             plan=53e32cc7a9b19a9a61304a999388758e8b288aec4197fb513e6b5de0f7772833
             tasks=4859a4052d9510e9ee9cd8de46588eade96f0247e87c0a61b7e3b430793a6b8f
Feature 009: spec=d73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73
             design=bbec3cd75fa7fa00cb298d1fa4c7ddd713d3dea870924b4c0a1a625986ada6fb
             plan=00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1
             tasks=ebb7089a7d2af47cdcb7e7926d3f8b0376de906a6d0c7d43c7520710d804087a
Feature 010: spec=3c33d6737768d59d6b62f907d77be06fea2b8b6c145392527d473019436c9346
             design=c060bcf6a9e305fbecc75697410642f261ded88eb9230ad9d36e5b9b5c02500f
             plan=c6d151ca35e53655fefb2cfde53879208cfb3e3642d0b94df68b9b74d49835e5
             tasks=b8a974d43790aa84eed53ce77275708acd22505d8e0bf31a2c6e1c31ec2835fd
Feature 009 manifest=1d1747eb11b82ae2179cb78eca7d5707fd2dcb6a4a604dbb37f373dd05825352
Prisma schema=e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733
Prisma migration inventory=8a93d1082c2696f8b50af5adbe4e0128a8f984894d94f6d30e02f66d6b2c58ba
Gateway source/test inventory=0354af851312a8fb65bfd4c0ffe3b81e199267f3086fb06bb57f84871387dde3
Identity Bridge source/test inventory=d3cc54a76d8b52e225529e8dbdd82c33601b608de91b2230790218a1a89013f3
Assistant DTO/SSE/history inventory=55a95414016374204bd7adfdfaabe005e2a878e8c06358a587acca86232a333d
.specify/feature.json=718abaacae7e402d4d44998e680abde71aaa88fa21f72c481f4078fee4249bfd
```

Baseline command evidence captured before any Feature 010 fixture or production change:

| Command | Result |
|---|---|
| `npm --prefix apps/identity-bridge test -- --runInBand` | Sandbox: exit 1, 40/41 suites and 376/380 tests passed; four listener cases failed only with `listen EPERM 127.0.0.1`. Identical approved local rerun: exit 0, 41 suites / 380 tests passed. |
| `npm --prefix apps/identity-bridge run build` | Exit 0. |
| `npm --prefix apps/identity-bridge run typecheck` | Exit 0. |
| `npm --prefix apps/gateway test -- --runInBand --runTestsByPath test/identity-bridge/feature007-compatibility.spec.ts test/backend-client/gateway-trust-chain-wiring.spec.ts test/integration/feature004-gateway-backend.e2e.spec.ts` | Exit 0; 1 suite / 4 tests passed, 2 suites / 14 tests intentionally gated or skipped. |
| `npm --prefix apps/gateway run build` | Exit 0. |
| `npm run test:unit -- --runInBand` | Exit 0; 81 suites passed, 1 skipped; 564 tests passed, 3 skipped. |
| `npm run test:contract -- --runInBand` | Exit 0; 10 suites passed, 3 skipped; 44 tests passed, 39 skipped. |
| `RUN_CUSTOMER_US1_TESTS=true npm run test:contract -- --runInBand` | Sandbox: exit 1 only from listener `EPERM`. Identical approved local rerun: exit 0; 13 suites / 83 tests passed. |
| `npm run test:eval -- --runInBand` | Exit 0; 1 suite passed, 1 skipped; 10 tests passed, 3 skipped. |
| `npm run test:e2e -- --runInBand --runTestsByPath test/e2e/gateway-backend-trust-chain.e2e-spec.ts` | Exit 0; 1 suite / 1 test passed. |
| `npm --prefix apps/customer-connector-runtime test -- --runInBand` | Sandbox: exit 1, 30 suites / 349 tests passed and 5 suites / 8 tests failed only with listener `EPERM`. Identical approved local rerun: exit 0; 35 suites / 357 tests passed. |
| `npm --prefix apps/customer-connector-runtime run build` | Exit 0. |
| `npm --prefix apps/customer-connector-runtime run typecheck` | Exit 0. |
| `npm run build` | Exit 0. |
| `npm run typecheck` | Exit 0. |
| `npm run test:integration -- --runInBand` | Exit 1 after 53 suites passed and 17 skipped; 187 tests passed, 131 skipped, 2 failed. |
| `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature009-customer-b-portability.spec.ts test/integration/productized-transport-dark.spec.ts` | Identical approved local run: exit 1; both isolated predecessor tests failed with the same semantic results. |

The two integration failures predate every Feature 010 edit and are not missing imports, compilation, fixture/bootstrap, database, or sandbox-listener failures:

```text
test/integration/feature009-customer-b-portability.spec.ts
  expected tool_call_completed/evidence_attached; observed tool_call_failed
  FAIL_REASON=UNRELATED_REGRESSION

test/integration/productized-transport-dark.spec.ts
  expected CONNECTOR_BINDING_INVALID; observed CONNECTOR_UNAVAILABLE
  FAIL_REASON=UNRELATED_REGRESSION
```

These failures block the required `PREDECESSOR_BASELINE=PASS` gate. Under the Phase 1 dependency and authentic-RED rules, T001 is not complete, T002–T010 have not started, no Feature 010 RED fixture or helper has been created, and no task checkbox has been changed. The baseline covers Feature 007 identity/session, Feature 008 Tool/projection/evidence, Feature 009 through T125, existing RAG and Tool runtime paths, EvidenceRef, AnswerDecision/GroundingCheck, SSE/history, and the LLM abstraction seam; the only failure is the isolated Feature 009 predecessor behavior above. Feature 009 T126–T142 remain unchecked.

```text
ENTRY_T001_STATUS=BLOCKED
ENTRY_T002_T010_STATUS=NOT_STARTED
ENTRY_REPOSITORY_INVENTORY_RECORDED=YES
ENTRY_PREDECESSOR_BASELINE=FAIL
ENTRY_FEATURE010_RED_FIXTURES=NOT_STARTED
ENTRY_FEATURE009_T126_T142_UNCHANGED=YES
ENTRY_PUBLIC_CONTRACT_BASELINE=PASS
ENTRY_PRODUCTION_FEATURE010_BEHAVIOR_IMPLEMENTED=NO
ENTRY_PHASE_2_STARTED=NO
ENTRY_FEATURE010_SPECIFICATION_READY=YES
ENTRY_FEATURE010_IMPLEMENTATION_STARTED=YES
ENTRY_FEATURE010_TASK_EXECUTION_STARTED=YES
ENTRY_HIGHEST_COMPLETED_TASK=NONE
ENTRY_BLOCKED_TASK=T001
ENTRY_NEXT_TASK=T001
ENTRY_NEXT_TASK_AUTHORIZED=YES
```

### T001 predecessor-regression resolution evidence (2026-09-16)

Diagnosis confirmed that both failures diverged at `ConnectorInvocationService`'s fail-closed runtime-readiness check, before binding lookup, credential resolution, manifest preparation, or upstream execution. Production readiness behavior was correct; the integration fixtures had not activated the test-only readiness dependencies required to reach their intended accepted Feature 009 assertions.

- `test/integration/feature009-customer-b-portability.spec.ts`: the complete Customer B configuration intentionally uses `test_loopback_tls`, which cannot satisfy production/staging readiness. The fixture omitted the explicit `upstream` and `invocationRoute` test readiness activation already used by the accepted Shinmone local vertical. Restoring those fixture-only flags allows the required generic Customer B POST-query path to execute without weakening runtime readiness.
- `test/integration/productized-transport-dark.spec.ts`: `validRuntimeEnvironment()` is a base trust/configuration fixture, not a complete Phase 5 business configuration. The dark-transport test therefore received `CONNECTOR_UNAVAILABLE` before its intended real unknown-binding lookup. The fixture now explicitly activates only its unrelated test dependencies and asserts a ready snapshot before sending the signed request; the real route, authenticator, and binding store still produce the approved `CONNECTOR_BINDING_INVALID` result.

Verification evidence:

| Command | Result |
|---|---|
| `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature009-customer-b-portability.spec.ts test/integration/productized-transport-dark.spec.ts` | Exit 0; 2 suites / 2 tests passed. |
| `npm run test:integration -- --runInBand` | Exit 0; 55 suites passed, 17 gated suites skipped; 189 tests passed, 131 skipped. |
| `npm run test:unit -- --runInBand --runTestsByPath test/unit/connector-deployment.registry.spec.ts test/unit/connector-network-policy.spec.ts test/unit/connector-service-auth.signer.spec.ts test/unit/connector-transport.client.spec.ts test/unit/productized-business-connector.adapter.spec.ts test/unit/productized-business-connector.module.spec.ts test/unit/tool-call.service.spec.ts test/unit/tool-discovery.service.spec.ts test/unit/tool-permission-precheck.service.spec.ts test/unit/tool-registry.service.spec.ts test/unit/evidence-ref.service.spec.ts test/unit/permission-filtering.spec.ts` | Exit 0; 12 suites / 146 tests passed. |
| `npm run test:integration -- --runInBand --runTestsByPath test/integration/authorized-evidence-answer.spec.ts test/integration/authorized-tool-execution.spec.ts test/integration/customer-tool-permission.spec.ts test/integration/customer-tool-policy.spec.ts test/integration/permission-denied-safe-response.spec.ts test/integration/productized-adapter-projection.spec.ts test/integration/tool-discovery-mock-equivalence.spec.ts test/integration/tool-execution-failed-sse.spec.ts test/integration/tool-failure-safe-response.spec.ts` | Exit 0; 8 suites / 18 tests passed, 1 gated suite / 9 tests skipped. |
| `npm --prefix apps/customer-connector-runtime test -- --runInBand` | Sandbox preserved the known listener-only result: 30 suites / 349 tests passed and 5 suites / 8 tests failed with `listen EPERM`; identical approved local rerun exited 0 with 35 suites / 357 tests passed. |
| `npm run build && npm run typecheck` | Exit 0. |
| `npm --prefix apps/customer-connector-runtime run build && npm --prefix apps/customer-connector-runtime run typecheck` | Exit 0. |
| `git diff --check` | Exit 0. |

The earlier T001 unit, contract, gated public-contract, eval, Identity Bridge, Gateway, focused trust-chain e2e, build, typecheck, inventory, and protected-hash evidence remains valid. Feature 009 T126–T142 remain unchecked; its specification/design/plan/tasks, manifest, Prisma schema, Gateway, Identity Bridge, public contracts, external repositories, and staging remain unchanged. No Feature 010 runtime behavior or RED fixture was introduced, and T002 was not started.

```text
PREDECESSOR_REGRESSION_1=PASS
PREDECESSOR_REGRESSION_2=PASS
ROOT_INTEGRATION_BASELINE=PASS
REPOSITORY_INVENTORY_RECORDED=YES
PREDECESSOR_BASELINE=PASS
FEATURE010_RED_FIXTURES=NOT_STARTED
FEATURE009_T126_T142_UNCHANGED=YES
PUBLIC_CONTRACT_BASELINE=PASS
FEATURE010_PRODUCTION_BEHAVIOR_IMPLEMENTED=NO
PHASE_2_STARTED=NO
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=YES
FEATURE010_TASK_EXECUTION_STARTED=YES
T001_STATUS=COMPLETE
T002_STATUS=NOT_STARTED
HIGHEST_COMPLETED_TASK=T001
NEXT_TASK=T002
NEXT_TASK_AUTHORIZED=NO
```

### Phase 1 T002–T010 completion evidence (2026-09-17)

Preflight was repeated before adding RED fixtures. Both repaired predecessor cases passed together (exit 0; 2 suites / 2 tests), and the complete root integration baseline passed (exit 0; 55 suites passed, 17 gated suites skipped; 189 tests passed, 131 skipped):

```text
npm run test:integration -- --runInBand --runTestsByPath test/integration/feature009-customer-b-portability.spec.ts test/integration/productized-transport-dark.spec.ts
npm run test:integration -- --runInBand
```

One test-only dynamic loader was added at `test/support/feature010-red-contract.helper.ts`. It converts only a missing target module or expected export into the typed diagnostic `MISSING_FEATURE010_BEHAVIOR [Tnnn]: <capability>`; nested dependency, syntax, transformation, TypeScript, fixture, and bootstrap errors propagate unchanged.

T002 permanent guard evidence:

| Task | Command | Result | Classification |
|---|---|---|---|
| T002 | `npm run test:contract -- --runInBand --runTestsByPath test/contract/feature010-scope-boundary.contract.spec.ts` | Exit 0; 1 suite / 5 tests passed. | `TASK_STATUS=COMPLETE / TEST_EXPECTED_STATE=GREEN` |

The guard pins the accepted Feature 009 spec/design/plan/tasks and manifest hashes, Prisma schema/migration inventory, Gateway and Identity Bridge trees, frozen Feature 010 spec/design/plan, Assistant HTTP/DTO/SSE/history/package boundaries, T126–T142 unchecked state, one-worktree/no-submodule/no-local-frontend constraints, absence of `lastMonth`, and the 83-task sequential contract. `tasks.md` remains mutable execution evidence and T011 remains unchecked.

Focused authentic RED evidence:

| Task | Exact focused command | Result | Missing behavior observed |
|---|---|---|---|
| T003 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/conversation-context-loader.service.spec.ts` | Exit 1; 1 suite, 3/3 expected failures. | Newest-four/chronological reconstruction; exact five-dimension active scope; recursive prohibited-source/no-prose-fact cases each emitted `MISSING_FEATURE010_BEHAVIOR [T003]: bounded scoped conversation context loading`. |
| T004 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-retrieval-router.service.spec.ts` | Exit 1; 1 suite, 8/8 expected failures. | CONTEXT_ONLY, RAG, TOOL, HYBRID, CLARIFY, INSUFFICIENT, four-need overflow, and one-Tool/no-recursion cases each emitted `MISSING_FEATURE010_BEHAVIOR [T004]: bounded non-authoritative grounded retrieval routing`. |
| T005 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/follow-up-semantic-resolver.service.spec.ts` | Exit 1; 1 suite, 7/7 expected failures. | INHERIT, REPLACE, NEW_TOPIC, CLARIFY, explicit-value precedence, contradictory frame, and tied-compatible-frame cases each emitted `MISSING_FEATURE010_BEHAVIOR [T005]: deterministic semantic follow-up resolution`. |
| T006 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-document-evidence.normalizer.spec.ts` | Exit 1; 1 suite, 6/6 expected failures. | Bounded stable normalization, EvidenceRef linkage, four malformed provenance variants, and untrusted prompt-like evidence each emitted `MISSING_FEATURE010_BEHAVIOR [T006]: bounded document evidence normalization`; no embedded citation field is required. |
| T007 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-tool-evidence.normalizer.spec.ts` | Exit 1; 1 suite, 14/14 expected failures. | Valid `status=success` / `executionStatus=executed` projected Tool evidence; canonical failed/blocked/pending/not-executed lifecycle states; permission-denied and evidence-conflict result states; failed projection; detached evidence; raw, pre-projection, undeclared, credential, and permission-snapshot rejection each emitted `MISSING_FEATURE010_BEHAVIOR [T007]: projected-only Tool evidence normalization`. |
| T008 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-context-bundle.service.spec.ts` | Exit 1; 1 suite, 9/9 expected failures. | COMPLETE/PARTIAL/INSUFFICIENT, exact `requestedNeeds[].id` to `needResults[].needId` separation/linkage, stable linked immutable assembly, and four recursive authority-rejection cases each emitted `MISSING_FEATURE010_BEHAVIOR [T008]: safe immutable GroundedContextBundleV1 assembly`. |
| T009 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/prior-grounded-evidence-eligibility.service.spec.ts` | Exit 1; 1 suite, 11/11 expected failures. | Eligible document and canonical successful/executed Tool items, independent complete/incomplete Hybrid eligibility information, plus prose, stale, revoked, failed, raw, malformed, ungrounded, and cross-Customer rejection cases each emitted `MISSING_FEATURE010_BEHAVIOR [T009]: current-authorized prior grounded evidence reuse`; mode and coverage selection are not assigned to this service. |
| T010 | `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-grounded-retrieval.spec.ts` | Exit 1; 1 suite; 2 GREEN harness cases passed and 8 authentic RED cases failed. | Existing document-only and Tool-only paths passed exact lane-count/evidence checks. Hybrid, compatible follow-up re-entry, ambiguous CLARIFY metadata, document/Tool/Hybrid zero-call recall, unsupported-lastMonth metadata, and safe persisted bundle metadata failed on direct missing Feature 010 behavior. Every failing test is labeled `FAIL_REASON=MISSING_FEATURE010_BEHAVIOR`. |

All T003–T009 files transformed and compiled before emitting the typed missing-capability diagnostic. T010 bootstrapped the existing `createUs1TestAppWithState` runtime and exercised HTTP/SSE plus in-memory persistence; it did not add a second runtime or a public bundle response. No skip/todo, unconditional throw, weakened expectation, database failure, missing static import, or environment failure is accepted as RED. Totals after contract reconciliation: 58 unit RED assertions plus 8 integration RED assertions, all authentic; 2 T010 predecessor/setup assertions remain GREEN.

Phase 1 contract reconciliation on 2026-09-17 confirmed and corrected five fixture mismatches without changing frozen product scope or task definitions: T006 keeps `GroundedDocumentEvidence` separate from `GroundedCitation`; T008 uses `RetrievalNeed.id` linked to `GroundedRetrievalNeedResult.needId`; T009 reports item eligibility without selecting `CONTEXT_ONLY` or coverage; T010 reuses persisted `structured_record` Tool EvidenceRefs and requires only the approved safe metadata subset, not transient citations. T007/T009 now use the existing ToolCall lifecycle (`status=success`, `executionStatus=executed`) and model denial/conflict as decision/grounding outcomes rather than invented ToolCall statuses. Corrected reruns: T002 5/5 GREEN; T003–T009 respectively 3/3, 8/8, 7/7, 6/6, 14/14, 9/9, and 11/11 authentic RED; T010 2 GREEN and 8 authentic RED. Post-correction predecessor results remained GREEN: unit 564 passed/3 skipped, repaired Feature 009 pair 2/2 passed, integration 189 passed/131 skipped, gated contracts 83/83 passed, and eval 10 passed/3 skipped.

Predecessor and compatibility reruns after fixture creation:

| Command | Result |
|---|---|
| Explicit predecessor unit inventory via `npm run test:unit -- --runInBand --runTestsByPath <all 82 predecessor unit files>` excluding the seven Feature 010 RED files | Exit 0; 81 suites passed, 1 skipped; 564 tests passed, 3 skipped. |
| Explicit predecessor contract inventory via `npm run test:contract -- --runInBand --runTestsByPath <13 predecessor contract files>` excluding T002 | Sandbox failed only on listener `EPERM`; identical approved local rerun exit 0; 10 suites passed, 3 skipped; 44 tests passed, 39 skipped. |
| `RUN_CUSTOMER_US1_TESTS=true npm run test:contract -- --runInBand --runTestsByPath <13 predecessor contract files>` | Approved local run exit 0; 13 suites / 83 tests passed. |
| Explicit predecessor integration inventory via `npm run test:integration -- --runInBand --runTestsByPath <72 predecessor integration files>` excluding T010 | Sandbox failed only on listener/database-connect `EPERM`; identical approved local rerun exit 0; 55 suites passed, 17 skipped; 189 tests passed, 131 skipped. |
| Explicit eval inventory via `npm run test:eval -- --runInBand --runTestsByPath test/eval/customer-rag-isolation.eval.spec.ts test/eval/internal-assistant-core.eval.spec.ts` | Sandbox failed only on listener `EPERM`; identical approved local rerun exit 0; 1 suite passed, 1 skipped; 10 tests passed, 3 skipped. |
| `npm run test:unit -- --runInBand --runTestsByPath test/unit/connector-deployment.registry.spec.ts test/unit/connector-network-policy.spec.ts test/unit/connector-service-auth.signer.spec.ts test/unit/connector-transport.client.spec.ts test/unit/productized-business-connector.adapter.spec.ts test/unit/productized-business-connector.module.spec.ts test/unit/tool-call.service.spec.ts test/unit/tool-discovery.service.spec.ts test/unit/tool-permission-precheck.service.spec.ts test/unit/tool-registry.service.spec.ts test/unit/evidence-ref.service.spec.ts test/unit/permission-filtering.spec.ts` | Exit 0; 12 suites / 146 tests passed. |
| Focused integration inventory for the repaired pair plus Tool, connector, projection, EvidenceRef, permission, transport, RAG, SSE, and history paths | Exit 0; 13 suites passed, 3 gated suites skipped; 26 tests passed, 11 skipped. |
| `npm run build` / `npm run typecheck` | Both exit 0. |
| `npm --prefix apps/customer-connector-runtime run build` / `npm --prefix apps/customer-connector-runtime run typecheck` | Both exit 0. |
| `git diff --check` | Exit 0. |

The exact shell inventories represented by the three bounded placeholders above were:

```zsh
unit_files=(${(f)"$(rg --files test/unit | rg '\.spec\.ts$' | rg -v 'conversation-context-loader\.service\.spec\.ts|grounded-retrieval-router\.service\.spec\.ts|follow-up-semantic-resolver\.service\.spec\.ts|grounded-document-evidence\.normalizer\.spec\.ts|grounded-tool-evidence\.normalizer\.spec\.ts|grounded-context-bundle\.service\.spec\.ts|prior-grounded-evidence-eligibility\.service\.spec\.ts')"}); npm run test:unit -- --runInBand --runTestsByPath ${unit_files[@]}
contract_files=(${(f)"$(rg --files test/contract | rg '\.spec\.ts$' | rg -v 'feature010-scope-boundary\.contract\.spec\.ts')"}); npm run test:contract -- --runInBand --runTestsByPath ${contract_files[@]}
contract_files=(${(f)"$(rg --files test/contract | rg '\.spec\.ts$' | rg -v 'feature010-scope-boundary\.contract\.spec\.ts')"}); RUN_CUSTOMER_US1_TESTS=true npm run test:contract -- --runInBand --runTestsByPath ${contract_files[@]}
integration_files=(${(f)"$(rg --files test/integration | rg '\.spec\.ts$' | rg -v 'feature010-grounded-retrieval\.spec\.ts')"}); npm run test:integration -- --runInBand --runTestsByPath ${integration_files[@]}
```

The exact focused integration regression command was:

```text
npm run test:integration -- --runInBand --runTestsByPath test/integration/feature009-customer-b-portability.spec.ts test/integration/productized-transport-dark.spec.ts test/integration/authorized-evidence-answer.spec.ts test/integration/authorized-tool-execution.spec.ts test/integration/customer-tool-permission.spec.ts test/integration/customer-tool-policy.spec.ts test/integration/permission-denied-safe-response.spec.ts test/integration/productized-adapter-projection.spec.ts test/integration/tool-discovery-mock-equivalence.spec.ts test/integration/tool-execution-failed-sse.spec.ts test/integration/tool-failure-safe-response.spec.ts test/integration/rag-sop-field-explanation.spec.ts test/integration/retrieval-run-candidates.spec.ts test/integration/message-history-evidence-link.spec.ts test/integration/customer-message-history.spec.ts test/integration/customer-sse-isolation.spec.ts
```

Final protected hashes equal the Phase 1 entry values: Feature 009 spec `d73dfe52…`, design `bbec3cd7…`, plan `00fc5b55…`, tasks `ebb7089a…`, manifest `1d1747eb…`; Prisma schema `e1467399…`; Feature 010 spec `3c33d673…`, design `c060bcf6…`, plan `c6d151ca…`; Assistant controller `0ad4fada…`, DTO `3c2f59a2…`, SSE event types `9a580049…`, Assistant SSE types `e3020a68…`, history types `06acd4f1…`, package inventory `970e99f6…`, and `.specify/feature.json` `718abaac…`. The T002 tree hashes also remain equal for migrations `8a93d108…`, Gateway `0354af85…`, and Identity Bridge `d3cc54a7…`.

Phase 1 changed-path inventory is limited to the mutable `tasks.md`, the two accepted predecessor fixture repairs, nine Feature 010 test files, and one test-only RED helper. The pre-existing untracked `apps/customer-connector-runtime/test/fixtures/phase6-upstream.key` remains untouched. There is no production source, schema/migration, public contract, Feature 009 planning/manifest/capability, Gateway, Identity Bridge, external repository, or staging diff.

```text
T001_T010_STATUS=COMPLETE
REPOSITORY_INVENTORY_RECORDED=YES
PREDECESSOR_BASELINE=PASS
FEATURE010_SCOPE_GUARD=PASS
FEATURE010_RED_FIXTURES=CAPTURED
FEATURE010_RED_FAILURES_AUTHENTIC=YES
FEATURE009_T126_T142_UNCHANGED=YES
PUBLIC_CONTRACT_BASELINE=PASS
PRODUCTION_FEATURE010_BEHAVIOR_IMPLEMENTED=NO
PHASE_2_STARTED=NO
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=YES
FEATURE010_TASK_EXECUTION_STARTED=YES
HIGHEST_COMPLETED_TASK=T010
NEXT_TASK=T011
NEXT_TASK_AUTHORIZED=NO
```

---

## Phase 2 — Shared contracts and bounded conversation-context foundation

- [X] T011 Define immutable semantic-frame, provenance, follow-up-decision, safe-turn, and safe-reason types in `src/assistant/conversation/conversation.types.ts`
- [X] T012 [P] Define context, need, chunk, ToolCall, evidence, freshness, depth, item, string, and byte limits in `src/assistant/conversation/conversation-limits.ts`
- [X] T013 [P] Implement recursive prohibited-key/value and bounded plain-value guards in `src/assistant/conversation/conversation-source-guard.ts`
- [X] T014 [P] Implement active Customer/session/organization/HostApp/actor-qualified context reads in `src/assistant/conversation/conversation-context.repository.ts`
- [X] T015 Implement deterministic newest-first four-exchange/four-evidence selection and incomplete-pair exclusion in `src/assistant/conversation/conversation-context-loader.service.ts`
- [X] T016 Implement safe semantic-frame reconstruction from QueryUnderstandingResult without Tool/permission authority in `src/assistant/conversation/conversation-semantic-reconstructor.service.ts`
- [X] T017 [P] Add safe context-loaded/rejected audit helpers in `src/assistant/conversation/conversation-audit.service.ts`
- [X] T018 Complete nested-prohibited, malformed/cyclic, bounds, ordering, and no-prose-fact unit coverage in `test/unit/conversation-context-loader.service.spec.ts`
- [X] T019 Add active/closed-session and colliding Customer/session/organization/HostApp/actor isolation coverage in `test/integration/feature010-context-isolation.spec.ts`
- [X] T020 Register the bounded conversation providers without a controller or public route in `src/assistant/assistant.module.ts`
- [X] T021 Wire safe prior semantic context into query understanding without prior authority in `src/query-understanding/query-understanding.module.ts`
- [X] T022 Add contract assertions for four-exchange/four-reference limits and prohibited source categories in `test/contract/feature010-conversation-context.contract.spec.ts`
- [X] T023 Run T018–T022 and record Phase 2 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Phase 2 supplies bounded guarded context before routing; it performs no factual reuse or retrieval.

### Phase 2 execution evidence — T011–T023 complete (2026-09-17)

T003 was rerun before implementation and failed only with three typed `MISSING_FEATURE010_BEHAVIOR [T003]` diagnostics. The original three assertions were retained; the completed T018 suite now has seven GREEN tests covering newest-four selection, chronological reconstruction, incomplete-pair and exact-scope exclusion, recursive prohibited material, malformed/cyclic/unsupported/bounded values, safe EvidenceRef candidate projection, deep immutability, non-authoritative semantic reconstruction, no Assistant-prose facts, and bounded audit metadata.

| Task/gate | Exact command or evidence | Result |
|---|---|---|
| T011–T017 | `npm run typecheck` plus T018/T019 focused execution | Immutable contracts, canonical limits, recursive guard, exact active-scope repository, bounded loader, semantic reconstructor, and safe audit helpers compiled and passed. |
| T018/T019/T022 | `npx jest --config jest.config.ts --runTestsByPath test/unit/conversation-context-loader.service.spec.ts test/integration/feature010-context-isolation.spec.ts test/contract/feature010-conversation-context.contract.spec.ts --runInBand` | Exit 0; 3 suites / 34 tests passed. T018=7, T019=8, T022=19. |
| T020/T021 | `npx jest --config jest.config.ts --runTestsByPath test/unit/assistant-planning.service.spec.ts test/unit/query-understanding-pipeline-wiring.spec.ts test/unit/conversation-context-loader.service.spec.ts test/integration/assistant-planning.spec.ts --runInBand` | Exit 0 before final T018 expansion; 4 suites / 8 tests passed. The final focused Phase 2 rerun and typecheck also passed. Prior context is an internal readonly input and does not enter candidate Tool or permission authority persistence. |
| T002 permanent scope guard | `npx jest --config jest.config.ts --runTestsByPath test/contract/feature010-scope-boundary.contract.spec.ts --runInBand` | Final exit 0 after completion recording; 1 suite / 5 tests passed. |
| Remaining RED unit contracts | Each T004–T009 file run independently with `npx jest --config jest.config.ts --runTestsByPath <file> --runInBand` | Expected exit 1 only through typed missing-capability diagnostics: T004 8/8, T005 7/7, T006 6/6, T007 14/14, T008 9/9, T009 11/11. |
| T010 later-phase integration | `npx jest --config jest.config.ts --runTestsByPath test/integration/feature010-grounded-retrieval.spec.ts --runInBand` | Expected exit 1; 2 existing document/Tool setup cases passed and 8 authentic later-phase cases remained RED. |
| Predecessor unit inventory | `npm run test:unit -- --runInBand --testPathIgnorePatterns='grounded-retrieval-router|follow-up-semantic-resolver|grounded-document-evidence|grounded-tool-evidence|grounded-context-bundle|prior-grounded-evidence-eligibility'` | Final exit 0; 82 suites passed, 1 skipped; 572 tests passed, 3 skipped. |
| Predecessor contract inventory | `npm run test:contract -- --runInBand` | Exit 0; 12 suites passed, 3 skipped; 68 tests passed, 39 skipped. |
| Gated public contracts | `RUN_CUSTOMER_US1_TESTS=true npm run test:contract -- --runInBand` | Sandbox listener attempt failed only with `EPERM`; identical approved local rerun exited 0 with 15 suites / 107 tests passed. |
| Predecessor integration inventory | `npm run test:integration -- --runInBand --testPathIgnorePatterns='feature010-grounded-retrieval'` | Exit 0; 56 suites passed, 17 skipped; 197 tests passed, 131 skipped. |
| Eval inventory | `npm run test:eval -- --runInBand` | Exit 0; 1 suite passed, 1 skipped; 10 tests passed, 3 skipped. |
| Direct Tool/connector/projection/evidence/permission unit regressions | Phase 1 exact 12-file `--runTestsByPath` inventory | Exit 0; 12 suites / 146 tests passed. |
| Direct Tool/transport/RAG/SSE/history integration regressions | Phase 1 exact 16-file `--runTestsByPath` inventory | Exit 0; 13 suites passed, 3 gated suites skipped; 26 tests passed, 11 skipped. |
| Compile and diff gates | `npm run build`; `npm run typecheck`; `git diff --check` | Exit 0 for all commands. |

The final combined Phase 2 rerun covered T002, T018–T022, Query Understanding wiring, and Assistant planning integration with exit 0: 7 suites / 45 tests passed.

Created production files are limited to the seven files under `src/assistant/conversation/`. Modified production files are limited to internal Assistant planning/module and Query Understanding module/type wiring. Tests add the Phase 2 isolation and contract suites and minimally extend the existing test application, Assistant planning, Query Understanding wiring, T003 loader, and permanent T002 guard. No schema/migration, public route/DTO/SSE/history contract, retrieval execution, Tool execution authority, Feature 009 plan/capability, Gateway, Identity Bridge, external repository, staging, long-term memory, Hybrid, bundle, LLM, or Feature 011 implementation was added.

```text
T011_T023_STATUS=COMPLETE
PHASE2_BOUNDED_CONTEXT=PASS
MAX_COMPLETED_EXCHANGES=4
MAX_PRIOR_EVIDENCE_REFS=4
CONTEXT_SCOPE_ISOLATION=PASS
PROHIBITED_CONTEXT_MATERIAL=REJECTED
ASSISTANT_PROSE_FACT_SOURCE=NO
CROSS_SESSION_MEMORY=NO
LONG_TERM_MEMORY=NO
RETRIEVAL_EXECUTED=NO
TOOL_EXECUTED_BY_PHASE2=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
PHASE_3_STARTED=NO
HIGHEST_COMPLETED_TASK=T023
NEXT_TASK=T024
NEXT_TASK_AUTHORIZED=NO
```

---

## Phase 3 — Grounded retrieval contracts and routing

- [X] T024 Define RetrievalMode, discriminated RetrievalNeed, GroundedRetrievalPlan, RetrievalCoverage, and need-result contracts in `src/retrieval/grounded-retrieval.types.ts`
- [X] T025 [P] Define GroundedDocumentEvidence, GroundedToolEvidence, GroundedCitation, and GroundedContextBundleV1 with separate safe requestedNeeds and needResults in `src/assistant/grounding/grounded-context-bundle.types.ts`
- [X] T026 [P] Add exact internal contract tests for all modes, coverage states, discriminants, bundle version, requested-need/result linkage, complete Feature 011 consumer fields, and prohibited authority fields in `test/contract/grounded-context-bundle.contract.spec.ts`
- [X] T027 Extend existing sentence/subtask decomposition with a deterministic four-need cap in `src/query-understanding/query-task-decomposer.ts`
- [X] T028 Implement deterministic CONTEXT_ONLY/RAG/TOOL/HYBRID/CLARIFY/INSUFFICIENT mode selection without execution authority in `src/retrieval/grounded-retrieval-router.service.ts`
- [X] T029 Enforce one Tool need, unsupported overflow, stable need IDs, and no retries/recursion in `src/retrieval/grounded-retrieval-router.service.ts`
- [X] T030 Add bounded retrieval-plan audit helpers without query/evidence content in `src/retrieval/grounded-retrieval-audit.service.ts`
- [X] T031 Register router/contracts in the existing retrieval module without adding a provider implementation in `src/retrieval/retrieval.module.ts`
- [X] T032 Complete table-driven routing, compound-query, overflow, ambiguity, and authority tests in `test/unit/grounded-retrieval-router.service.spec.ts`
- [X] T033 Run T026/T032 and record Phase 3 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Routing is deterministic and auditable but cannot execute RAG, Tool, connector, or LLM work.

### Phase 3 execution evidence — T024–T033 complete (2026-09-17)

T004 was rerun before implementation and failed authentically with exit 1: all 8/8 cases emitted only `MISSING_FEATURE010_BEHAVIOR [T004]: bounded non-authoritative grounded retrieval routing`. After T024–T031, the expanded T032 suite passed with 14/14 tests. The router deterministically selects all six modes, chooses a lane from uncovered needs, uses stable ordinal need IDs, admits at most four needs, replaces overflow with an explicit bounded unsupported sentinel, retains at most one Tool semantic need, strips authority-bearing input, emits no retry/child/next-plan surface, and is deeply immutable. `CONTEXT_ONLY` consumes only a caller-supplied complete-coverage signal and performs no eligibility or freshness evaluation.

| Task/gate | Exact command | Result |
|---|---|---|
| T024–T025 compile | `npm run typecheck` | Exit 0; retrieval, need-result, evidence, citation, and `GroundedContextBundleV1` contracts compile with distinct `requestedNeeds[].id` / `needResults[].needId` linkage. |
| T026 | `npm run test:contract -- --runInBand --runTestsByPath test/contract/grounded-context-bundle.contract.spec.ts` | Exit 0; 1 suite / 5 tests passed. All modes, coverage states, discriminants, bundle version, provenance, citations, locale, Feature 011 view, readonly shapes, and authority-field absence passed. |
| T027 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-retrieval-router.service.spec.ts test/unit/query-task-decomposer.spec.ts` | Exit 0; 2 suites / 21 tests passed at the decomposition checkpoint, including 8 decomposer tests. Existing subtask behavior stayed compatible; deterministic retrieval decomposition and overflow sentinel coverage passed. |
| T028–T032 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/grounded-retrieval-router.service.spec.ts` | Exit 0; 1 suite / 14 tests passed. CONTEXT_ONLY, RAG, TOOL, HYBRID, CLARIFY, INSUFFICIENT, uncovered-need selection, four-need and one-Tool bounds, compound input, stable repeated output, authority sanitization, deep immutability, safe audit metadata, and no recursion/retry passed. |
| Phase 2 gates | Focused T002, T018, T019, and T022 commands | Exit 0: T002 5/5, T018 10/10, T019 8/8, T022 21/21. Four-exchange/four-reference bounds, nested evidence identity bound, and scope isolation remain green. |
| Query Understanding | `npm run test:unit -- --runInBand --runTestsByPath test/unit/query-task-decomposer.spec.ts test/unit/query-understanding-pipeline-wiring.spec.ts test/unit/query-understanding.service.spec.ts test/unit/assistant-planning.service.spec.ts` | Exit 0; 4 suites / 19 tests passed. |
| Retrieval/Tool unit regressions | Focused deterministic retrieval, RetrievalService, discovery/equivalence, registry, permission, EvidenceRef, and filtering inventory | Exit 0; 8 suites / 97 tests passed. |
| Retrieval/Tool integration regressions | Focused authorized evidence/Tool, Customer RAG/retrieval/Tool, conflict, history, transport, SOP, RetrievalRun, and discovery inventory | Exit 0; 9 suites / 20 tests passed; 4 gated suites / 24 tests skipped. |
| Predecessor unit inventory | `npm run test:unit -- --runInBand --testPathIgnorePatterns='follow-up-semantic-resolver|grounded-document-evidence|grounded-tool-evidence|grounded-context-bundle.service|prior-grounded-evidence-eligibility'` | Exit 0; 83 suites passed, 1 skipped; 591 tests passed, 3 skipped. |
| Contract inventory | `npm run test:contract -- --runInBand` | Exit 0; 13 suites passed, 3 skipped; 75 tests passed, 39 skipped. |
| Predecessor integration inventory | `npm run test:integration -- --runInBand --testPathIgnorePatterns='feature010-grounded-retrieval'` | Exit 0; 56 suites passed, 17 skipped; 197 tests passed, 131 skipped. |
| Phase 3 focused lint | `npx eslint src/retrieval/grounded-retrieval.types.ts src/retrieval/grounded-retrieval-router.service.ts src/retrieval/grounded-retrieval-audit.service.ts src/retrieval/retrieval.module.ts src/assistant/grounding/grounded-context-bundle.types.ts src/query-understanding/query-task-decomposer.ts test/contract/grounded-context-bundle.contract.spec.ts test/unit/grounded-retrieval-router.service.spec.ts test/unit/query-task-decomposer.spec.ts` | Exit 0 with no findings. |
| Compile/diff gates | `npm run build`; `npm run typecheck`; `git diff --check` | Exit 0 for all commands. |

Later-phase RED state remains authentic and unchanged: T005 7/7, T006 6/6, T007 14/14, T008 9/9, and T009 11/11 fail only through their typed missing-capability diagnostics. T010 still has 2 existing document/Tool setup cases GREEN and 8 later-phase scenarios RED. The new bundle types do not provide a bundle assembly service.

The router has no dependency on `RetrievalService`, Tool runtime, connectors, or LLM services; focused route calls leave their observable invocation state untouched. The audit helper writes only mode, bounded counts/kinds, normalized safe reason codes, and duration. It does not persist query text, document content, projected values, Tool arguments/keys, permissions, connector data, or evidence payloads. `RetrievalModule` registers the router and audit helper internally while retaining its prior exports and deterministic provider selection.

Frozen Feature 010 spec/design/plan hashes remain `3c33d673…`, `c060bcf6…`, and `c6d151ca…`; `.specify/feature.json` remains `718abaac…`. T002 confirms the public Assistant/API/SSE/history, schema/migrations, Feature 009, Gateway, Identity Bridge, worktree, submodule, external-frontend, and staging boundaries. Feature 009 T126–T142 remain unchecked. The pre-existing untracked `apps/customer-connector-runtime/test/fixtures/phase6-upstream.key` remains untouched.

```text
T024_T033_STATUS=COMPLETE
RETRIEVAL_CONTRACTS=PASS
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=PASS
RETRIEVAL_MODE_ROUTING=PASS
MAX_RETRIEVAL_NEEDS=4
MAX_TOOL_NEEDS=1
STABLE_NEED_IDS=PASS
ROUTER_EXECUTION_AUTHORITY=NO
ROUTER_RECURSION=NO
RAG_EXECUTED_BY_PHASE3=NO
TOOL_EXECUTED_BY_PHASE3=NO
CONNECTOR_EXECUTED_BY_PHASE3=NO
LLM_EXECUTED_BY_PHASE3=NO
PHASE2_BOUNDED_CONTEXT_REGRESSION=PASS
PUBLIC_ASSISTANT_API_CHANGE=NO
PHASE_4_STARTED=NO
HIGHEST_COMPLETED_TASK=T033
NEXT_TASK=T034
NEXT_TASK_AUTHORIZED=NO
```

---

## Phase 4 — Semantic follow-up and retrieval re-entry

**Story**: US1 — Semantic follow-up and retrieval re-entry

- [X] T034 [P] [US1] Add explicit-override, omission-only inheritance, incompatible-topic, contradiction, and tied-frame cases in `test/unit/follow-up-semantic-resolver.service.spec.ts`
- [X] T035 [P] [US1] Add `那申請期限呢？`, `那個呢？`, compatible entity replacement, and `上個月呢？` routing cases in `test/integration/feature010-followup-routing.spec.ts`
- [X] T036 [P] [US1] Add tests proving prior Tool keys, permissions, RAG scores, and document claims never enter authority inputs in `test/unit/follow-up-retrieval-authority.guard.spec.ts`
- [X] T037 [US1] Implement INHERIT, REPLACE, NEW_TOPIC, and CLARIFY resolution in `src/assistant/conversation/follow-up-semantic-resolver.service.ts`
- [X] T038 [US1] Integrate current explicit-frame extraction and bounded prior frames in `src/query-understanding/rule-based-query-understanding.pipeline.ts`
- [X] T039 [US1] Convert resolved semantics back into non-authoritative routing inputs in `src/retrieval/grounded-retrieval-router.service.ts`
- [X] T040 [US1] Route document needs to canonical RAG intent and Tool needs to generic discovery signals in `src/assistant/planning/assistant-planning.service.ts`
- [X] T041 [US1] Persist safe resolution kind/provenance/reason audit metadata in `src/assistant/conversation/conversation-audit.service.ts`
- [X] T042 [US1] Complete zero-retrieval ambiguity and zero-ToolCall unsupported-last-month integration coverage in `test/integration/feature010-followup-routing.spec.ts`
- [X] T043 [US1] Run T034–T036/T042 and existing discovery/query-understanding evals; record US1 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Follow-ups re-enter current retrieval routing and inherit no execution authority.

### Phase 4 execution evidence — T034–T043 complete (2026-09-17)

T005 was captured before implementation as an authentic missing-capability RED: exit 1 with all 7/7 original cases failing only through `MISSING_FEATURE010_BEHAVIOR [T005]`. The completed resolver suite retains those cases and adds provenance, document-aspect replacement, inherited-topic discard, and vague-deixis coverage.

| Task/gate | Exact command | Result |
|---|---|---|
| T034/T037 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/follow-up-semantic-resolver.service.spec.ts` | Exit 0; 1 suite / 11 tests passed. INHERIT, REPLACE, NEW_TOPIC, CLARIFY, explicit-current precedence, omission-only inheritance, original-message provenance, contradiction, tied frames, and vague deixis passed. |
| T035/T042 | `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-followup-routing.spec.ts` | Exit 0; 1 suite / 4 tests passed. Travel-policy aspect replacement routed to one RAG run and zero ToolCalls; vague deixis made zero calls; Customer B SKU replacement executed exactly one newly discovered/current-authorized ToolCall; `last_month` resolved but made zero calls. |
| T036 | `npm run test:unit -- --runInBand --runTestsByPath test/unit/follow-up-retrieval-authority.guard.spec.ts` | Exit 0; 1 suite / 3 tests passed. Prior Tool keys, permission results, connector/raw data, RAG score, and document claims were discarded before resolver, discovery, and router authority inputs; an independent `this_month` request retained legacy discovery behavior. |
| T038–T041 focused GREEN | `npm run test:unit -- --runInBand --runTestsByPath test/unit/follow-up-semantic-resolver.service.spec.ts test/unit/follow-up-retrieval-authority.guard.spec.ts test/unit/grounded-retrieval-router.service.spec.ts test/unit/query-understanding.service.spec.ts test/unit/query-task-decomposer.spec.ts test/unit/query-normalization.spec.ts test/unit/assistant-planning.service.spec.ts` | Exit 0; 7 suites / 52 tests passed. Resolved semantic frames re-enter document routing or current Tool discovery, and safe resolution/planning audit metadata is recorded. |
| Planning integration | `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-followup-routing.spec.ts test/integration/assistant-planning.spec.ts` | Exit 0; 2 suites / 5 tests passed. |
| T002/T022/T026 contracts | `npm run test:contract -- --runInBand --runTestsByPath test/contract/feature010-scope-boundary.contract.spec.ts test/contract/feature010-conversation-context.contract.spec.ts test/contract/grounded-context-bundle.contract.spec.ts` | Exit 0; 3 suites / 31 tests passed. Public boundaries, frozen plans, Feature 009, and bundle type contracts remain protected. |
| Phase 2/3 focused regression | `npm run test:unit -- --runInBand --runTestsByPath test/unit/conversation-context-loader.service.spec.ts test/unit/query-understanding-pipeline-wiring.spec.ts test/unit/grounded-retrieval-router.service.spec.ts`; `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-context-isolation.spec.ts` | Exit 0; unit 3 suites / 27 tests and integration 1 suite / 8 tests passed. |
| Later-phase RED state | T006, T007, T008, and T009 run separately with their existing focused `npm run test:unit -- --runInBand --runTestsByPath <file>` commands | Expected exit 1 only through typed missing-capability diagnostics: T006 6/6, T007 14/14, T008 9/9, T009 11/11. No evidence normalization, reuse, or bundle assembly exists. |
| T010 later-phase integration | `npm run test:integration -- --runInBand --runTestsByPath test/integration/feature010-grounded-retrieval.spec.ts` | Expected exit 1; 2 setup proofs passed and 8 Hybrid/reuse/bundle-oriented cases remained RED. Phase 4 follow-up behavior is asserted through its dedicated internal planning/audit integration suite rather than new AnswerDecision/SSE metadata. |
| Predecessor unit inventory | `npm run test:unit -- --runInBand --testPathIgnorePatterns='grounded-document-evidence.normalizer|grounded-tool-evidence.normalizer|grounded-context-bundle.service|prior-grounded-evidence-eligibility'` | Exit 0; 85 suites passed, 1 skipped; 606 tests passed, 3 skipped. |
| Predecessor integration inventory | `npm run test:integration -- --runInBand --testPathIgnorePatterns='feature010-grounded-retrieval'` | Exit 0; 57 suites passed, 17 skipped; 201 tests passed, 131 skipped. |
| Contract/eval inventories | `npm run test:contract -- --runInBand`; `npm run test:eval -- --runInBand` | Both exit 0. Contracts: 13 passed / 3 skipped suites, 75 passed / 39 skipped tests. Evals: 1 passed / 1 skipped suite, 10 passed / 3 skipped tests. |
| Compile/diff gates | `npm run build`; `npm run typecheck`; `git diff --check` | Exit 0 for all commands. |
| Phase 4 focused lint | `npx eslint <20 changed Phase 4 source/test paths>` | Exit 0 with no findings. Full `npm run lint` still reports only the four documented unrelated pre-existing errors in connector-runtime, Identity Bridge, and productized transport files. |

The in-memory Prisma test helper now normalizes Prisma JSON-null sentinels to the database-equivalent `null`; this permits the existing scoped context repository to reconstruct persisted semantic frames without changing production context semantics. No schema, endpoint, DTO, SSE/history shape, Feature 009 manifest/task, connector capability, external repository, staging state, evidence eligibility, current-authority reuse, Hybrid execution, bundle assembly, or LLM behavior changed. T044 remains unchecked and unauthorized.

```text
T034_T043_STATUS=COMPLETE
SEMANTIC_FOLLOWUP=PASS
FOLLOWUP_DECISIONS_DETERMINISTIC=YES
EXPLICIT_CURRENT_VALUES_WIN=YES
OMISSION_ONLY_INHERITANCE=PASS
NEW_TOPIC_DISCARDS_INHERITED_TOPIC=PASS
AMBIGUOUS_FOLLOWUP_CLARIFY=PASS
FOLLOWUP_REENTERS_RETRIEVAL_ROUTING=YES
DOCUMENT_FOLLOWUP_ROUTE=RAG
COMPATIBLE_TOOL_FOLLOWUP_REENTERS_DISCOVERY=YES
PREVIOUS_TOOLCALL_EXECUTION_AUTHORITY=NO
PRIOR_PERMISSION_AUTHORITY=NO
PRIOR_DOCUMENT_FACT_AUTHORITY=NO
LAST_MONTH_SEMANTIC_RESOLUTION=SUPPORTED
LAST_MONTH_EXECUTION_CAPABILITY=NO
LAST_MONTH_TOOLCALL_COUNT=0
MAX_RETRIEVAL_NEEDS=4
MAX_TOOL_NEEDS=1
PUBLIC_ASSISTANT_API_CHANGE=NO
PHASE_5_STARTED=NO
HIGHEST_COMPLETED_TASK=T043
NEXT_TASK=T044
NEXT_TASK_AUTHORIZED=NO
```

---

## Phase 5 — RAG retrieval and document evidence normalization

**Story**: US2 — Document-only grounded retrieval

- [ ] T044 [P] [US2] Add travel-subsidy and existing SOP document-only RED cases with zero ToolCalls in `test/integration/feature010-document-retrieval.spec.ts`
- [ ] T045 [P] [US2] Add active/versioned provenance, two-chunk cap, citation, malformed metadata, and deterministic ordering cases in `test/unit/grounded-document-evidence.normalizer.spec.ts`
- [ ] T046 [P] [US2] Add prompt-like text, control-character, authority-claim, token, proof, and connector-reference cases in `test/unit/document-evidence-source-guard.spec.ts`
- [ ] T047 [P] [US2] Add colliding-ID Customer/organization/permission pre-filter isolation cases in `test/integration/feature010-rag-isolation.spec.ts`
- [ ] T048 [US2] Extend attached document EvidenceRef safe summaries with document version provenance in `src/evidence/evidence-ref.service.ts`
- [ ] T049 [US2] Implement bounded UNTRUSTED_DOCUMENT_EVIDENCE normalization from selected EvidenceRefs in `src/retrieval/grounded-document-evidence.normalizer.ts`
- [ ] T050 [US2] Implement document source guards that prevent content/metadata from becoming instruction or authority in `src/retrieval/document-evidence-source-guard.ts`
- [ ] T051 [US2] Implement per-need canonical RetrievalService execution with the existing two-candidate limit in `src/retrieval/grounded-document-retrieval.service.ts`
- [ ] T052 [US2] Add stable document citation mapping and safe RAG audit metadata in `src/retrieval/grounded-document-evidence.normalizer.ts`
- [ ] T053 [US2] Preserve existing RetrievalRun/Candidate and no-evidence behavior while returning normalized need results in `src/retrieval/retrieval.service.ts`
- [ ] T054 [US2] Run T044–T047 and existing RAG/document-answer/isolation/eval suites; record US2 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Document-only requests yield authorized normalized evidence/citations with zero ToolCalls and no document-derived authority.

---

## Phase 6 — Tool + Hybrid retrieval and Grounded Context Bundle assembly

### US3 — Tool-only grounded retrieval

- [ ] T055 [P] [US3] Add current-discovery/policy/permission/one-ToolCall/projected-evidence RED cases in `test/integration/feature010-tool-retrieval.spec.ts`
- [ ] T056 [P] [US3] Add success-without-projection, raw response, undeclared field, blocked, denied, failed, and conflicted cases in `test/unit/grounded-tool-evidence.normalizer.spec.ts`
- [ ] T057 [US3] Implement projected EvidenceRef-only Tool normalization in `src/assistant/grounding/grounded-tool-evidence.normalizer.ts`
- [ ] T058 [US3] Adapt one TOOL need to the existing generic discovery/read-only runtime path in `src/assistant/grounding/grounded-tool-retrieval.service.ts`
- [ ] T059 [US3] Enforce one Tool need/ToolCall and current ToolDefinition/policy/permission checks in `src/assistant/grounding/grounded-tool-retrieval.service.ts`

### US4 — Hybrid grounded retrieval and coverage

- [ ] T060 [P] [US4] Add Tool+RAG COMPLETE, Tool-only PARTIAL, RAG-only PARTIAL, all-failed INSUFFICIENT, and multi-Tool rejection cases in `test/integration/feature010-hybrid-retrieval.spec.ts`
- [ ] T061 [P] [US4] Add exact requested-need/result mapping, coverage, unsupported-need, deterministic merge, deduplication, citation-order, and immutability cases in `test/unit/grounded-context-bundle.service.spec.ts`
- [ ] T062 [US4] Implement bounded declared-lane coordination with no retry/recursion in `src/assistant/grounding/hybrid-retrieval-coordinator.service.ts`
- [ ] T063 [US4] Implement COMPLETE/PARTIAL/INSUFFICIENT/CLARIFY coverage evaluation in `src/assistant/grounding/retrieval-coverage.service.ts`
- [ ] T064 [US4] Implement deterministic evidence merge, deduplication, citation mapping, and deep-freeze assembly in `src/assistant/grounding/grounded-context-bundle.service.ts`

### US5 — Eligible prior grounded-context reuse

- [ ] T065 [P] [US5] Add document active/version/access, Tool 900-second/current-authority, Hybrid item-by-item, and same-scope eligibility cases in `test/unit/prior-grounded-evidence-eligibility.service.spec.ts`
- [ ] T066 [P] [US5] Add zero-call document/Tool/Hybrid CONTEXT_ONLY recall and ineligible re-retrieval cases in `test/integration/feature010-prior-grounded-recall.spec.ts`
- [ ] T067 [US5] Implement document source/version/access and Tool lifecycle/freshness/current-authorization eligibility in `src/assistant/grounding/prior-grounded-evidence-eligibility.service.ts`
- [ ] T068 [US5] Implement CONTEXT_ONLY complete-coverage selection without Assistant-prose parsing in `src/assistant/grounding/prior-grounded-context.service.ts`

### Shared orchestration

- [ ] T069 [US4] Integrate context, router, prior reuse, canonical lanes, coverage, and bundle assembly in `src/assistant/message/assistant-message.service.ts`
- [ ] T070 [US4] Persist only safe bundle version/mode/coverage/need/evidence metadata through existing decision/grounding records in `src/assistant/answer/answer-decision.service.ts`
- [ ] T071 [US4] Register grounding services without adding a public controller or route in `src/assistant/assistant.module.ts`
- [ ] T072 [US4] Preserve existing AnswerDecision text as a compatibility sink and prove LlmExecutionService is not invoked in `test/integration/feature010-no-llm-generation.spec.ts`
- [ ] T073 [US4] Add safe route/lane/reuse/coverage/bundle audit events in `src/assistant/grounding/grounded-retrieval-audit.service.ts`
- [ ] T074 [US4] Run T055–T066/T072 and Tool/evidence/permission regressions; record US3–US5 GREEN evidence in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Checkpoint**: Tool-only, Hybrid, partial coverage, and prior reuse produce safe immutable bundles without a second runtime or LLM generation.

---

## Phase 7 — Cross-cutting security, compatibility and local backend acceptance

- [ ] T075 [P] Add unchanged Assistant HTTP/SSE event/payload and history-shape contract assertions in `test/contract/feature010-public-compatibility.contract.spec.ts`
- [ ] T076 [P] Add exact GroundedContextBundleV1 handoff assertions for current request, resolved meaning, mode, requested needs, need results, coverage, evidence, provenance, citations, locale, and prohibited execution-authority material in `test/contract/grounded-context-bundle.contract.spec.ts`
- [ ] T077 [P] Add cross-boundary token/proof/credential/connector/raw/pre-projection/authority sentinel scans in `test/integration/feature010-grounded-bundle-leak.spec.ts`
- [ ] T078 [P] Extend document/Tool/Hybrid/follow-up/ambiguous/unsupported-lastMonth/prior-recall/current-revocation/partial/insufficient/no-LLM routing evals in `test/eval/internal-assistant-core.eval.spec.ts`
- [ ] T079 Run unit, contract, integration, e2e, eval, typecheck, build, and lint commands and record exact results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T080 Re-run existing RAG/document-answer, Customer isolation, no-answer, history, SSE, and permission suites and record results in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T081 Re-run Feature 007 identity/session, Feature 008 Tool/projection/evidence, and Feature 009 local suites in `specs/010-conversational-context-grounded-retrieval/tasks.md`
- [ ] T082 Verify Feature 009 manifest/T126–T142, schema, `.specify/feature.json`, AGENTS, external repositories, and staging have no Feature 010 diff in `test/contract/feature010-scope-boundary.contract.spec.ts`
- [ ] T083 Record every Feature 010 Definition of Done gate, backend acceptance, Feature 011 readiness, and planning-freeze state while keeping final prose/Feature 009 release acceptance pending in `specs/010-conversational-context-grounded-retrieval/tasks.md`

**Final exit gate**:

```text
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
GROUNDED_CONTEXT_BUNDLE_CONTRACT=PASS
FEATURE010_FINAL_LLM_GENERATION=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
SSE_EVENT_OR_PAYLOAD_CHANGE=NO
ASSISTANT_HISTORY_SHAPE_CHANGE=NO
PRISMA_SCHEMA_CHANGE=NO
PROHIBITED_MATERIAL_LEAK=NO
FEATURE009_MANIFEST_CHANGED=NO
FEATURE009_T126_T142_EXECUTED=NO
FEATURE009_FINAL_RELEASE_ACCEPTANCE=PENDING
```

## Dependencies and Execution Order

```text
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7
```

| Story | Primary phase | Depends on | Independent acceptance |
|---|---:|---|---|
| US1 | 4 | Phases 2–3 | Follow-up re-enters routing; ambiguous/unsupported turns execute nothing |
| US2 | 5 | US1 routing + Phase 3 | Accessible document evidence/citations, zero ToolCalls |
| US3 | 6 | Phases 2–4 | One current-authorized ToolCall yields projected Tool evidence |
| US4 | 6 | US2 + US3 | Hybrid bundle reports COMPLETE/PARTIAL/INSUFFICIENT exactly |
| US5 | 6 | US2 + US3 + Phase 2 context | Eligible prior grounded evidence yields CONTEXT_ONLY with zero calls |

## Accepted Authority Invariants

```text
CONVERSATION_CONTEXT_OPERATION_AUTHORITY=NO
CONVERSATION_CONTEXT_PERMISSION_AUTHORITY=NO
RETRIEVAL_ROUTER_EXECUTION_AUTHORITY=NO
RAG_DOCUMENT_AUTHORITY=NO
RAG_CROSS_CUSTOMER_ACCESS=NO
TOOL_EXECUTION_USES_CURRENT_AUTHORITY=YES
FOLLOWUP_REENTERS_RETRIEVAL_ROUTING=YES
RAW_CONNECTOR_OUTPUT_IN_GROUNDED_BUNDLE=NO
PRE_PROJECTION_TOOL_DATA_IN_GROUNDED_BUNDLE=NO
DOCUMENT_PROVENANCE_REQUIRED=YES
TOOL_EVIDENCE_PROVENANCE_REQUIRED=YES
HYBRID_RETRIEVAL_SUPPORTED=YES
AUTONOMOUS_RETRIEVAL_LOOP=NO
ASSISTANT_PROSE_FACT_SOURCE=NO
GROUNDED_CONTEXT_BUNDLE_SAFE_FOR_GENERATION=YES
FEATURE010_FINAL_LLM_GENERATION=NO
FEATURE009_MANIFEST_CHANGED=NO
FEATURE009_T126_T142_EXECUTED=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
```

## Parallel Opportunities

- T002–T009 may run in parallel after T001.
- T012–T014/T017 may run in parallel before T015–T023 converge.
- T025–T027 may run in parallel before router implementation.
- T034–T036 may run in parallel before T037–T043.
- T044–T047 may run in parallel before RAG implementation.
- T055–T056, T060–T061, and T065–T066 are parallel RED groups after Phase 5; implementations converge at T069.
- T075–T078 may run in parallel before final suite execution.

## Implementation Strategy

```text
Intermediate RAG checkpoint: T001–T054
Feature 010 implementation scope: T001–T083
Feature 010 completion gate: Phase 7 / T083 PASS
Feature 011 readiness gate: Feature 010 backend local acceptance PASS
```

Phase 5 is only the intermediate RAG checkpoint. Phase 6 is mandatory for Tool normalization/integration, first-class Hybrid retrieval, retrieval coverage, prior grounded-context reuse, and `GroundedContextBundleV1`; Phase 7 is mandatory for Feature 010 backend acceptance and Feature 011 handoff validation. No task authorizes Feature 011 implementation, external UI work, Feature 009 staging, or final release acceptance.

Memory terminology is fixed: Short-term Conversation Context ≠ Long-term Memory ≠ RAG Knowledge Base. Feature 010 adds only bounded same-session context and no cross-session/user-profile memory, memory extraction, autonomous memory writing, or long-term-memory persistence.

## Feature 011 Handoff Boundary

Feature 010 tasks stop after producing and validating `GroundedContextBundleV1`. `Feature 011 — Grounded LLM Answer Synthesis` will own model-context assembly, system/generation policy, LLM invocation, natural answer generation, citation placement, claim validation, partial/unsupported wording, hallucination controls, token budgets, streaming, and final UX. No task in this file implements or invokes that successor behavior.

Feature 011 may be planned separately, but implementation readiness requires:

```text
GROUNDED_CONTEXT_BUNDLE_V1_CONTRACT=COMPLETE
PHASE_6_BEHAVIOR=COMPLETE
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

Feature 011 must not redesign conversation scope/isolation, semantic follow-up, retrieval routing, RAG authorization, Tool authority, evidence normalization, source provenance, retrieval coverage semantics, or `GroundedContextBundleV1`.

## Feature 010 Definition of Done

```text
BOUNDED_CONVERSATION_CONTEXT=PASS
SEMANTIC_FOLLOWUP=PASS
GROUNDED_RETRIEVAL_ROUTING=PASS
DOCUMENT_RAG_RETRIEVAL=PASS
TOOL_RETRIEVAL=PASS
HYBRID_RETRIEVAL=PASS
PRIOR_GROUNDED_CONTEXT_REUSE=PASS
RETRIEVAL_COVERAGE=PASS
GROUNDED_CONTEXT_BUNDLE_V1=PASS
CROSS_CUSTOMER_ISOLATION=PASS
PROHIBITED_MATERIAL_LEAK=NO
PUBLIC_ASSISTANT_API_CHANGE=NO
FEATURE010_FINAL_LLM_GENERATION=NO
FEATURE010_BACKEND_LOCAL_ACCEPTANCE=PASS
```

## Planning-Freeze Baseline State (before authorized implementation execution)

The following markers record the approved planning-freeze baseline only. Current execution status is recorded in the Phase 1 evidence above.

```text
FEATURE010_SPECIFICATION_READY=YES
FEATURE010_IMPLEMENTATION_STARTED=NO
```

## Task Summary

- Total tasks: 83
- Phase 1: 10
- Phase 2: 13
- Phase 3: 10
- US1 / Phase 4: 10
- US2 / Phase 5: 11
- Phase 6: 20 (`US3`: 5, `US4`: 11, `US5`: 4)
- Phase 7: 9
- Intermediate RAG checkpoint: T001–T054
- Feature 010 implementation scope: T001–T083
- Feature 010 completion gate: Phase 7 / T083 PASS
- Feature 011 readiness gate: Feature 010 backend local acceptance PASS
- All task IDs are sequential with no gaps; every task has a checkbox, exact path, valid optional `[P]`, and story labels only where applicable.
