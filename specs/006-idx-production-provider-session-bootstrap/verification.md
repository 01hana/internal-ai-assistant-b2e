# Feature 006 Verification

## Scope and conclusion

Phase 18 was executed against the current working tree on 2026-08-27. T042, T043, and T044 passed after narrowly scoped test/fixture and lint-compliance corrective iterations. An isolated three-run repeatability check did not reproduce the one E2E database-setup timeout; the subsequent full T043 rerun and all final T044 gates passed.

`IDX_PROVIDER_CAPABILITY_READY=YES` for this server-side, synthetic-fixture verification run. The final corrective iteration changed only two provider-local validation implementations for lint compliance, their focused tests, and the signing source guard; it did not change Feature 006 authority or runtime semantics.

## Environment

- Repository: `internal-ai-assistant.com`; gateway Jest configuration: `apps/gateway/jest.config.cjs`.
- Focused verification used production-shaped synthetic IDX fixtures only. It made no request to a real IDX endpoint, Customer domain, Customer credential, or production DNS name.
- DB verification used the existing `test/support/gateway-registry-db.helper.ts`. The helper loads `.env.test`, creates disposable `*_test` PostgreSQL databases, applies the canonical Prisma migration lineage, and drops each database after use.
- `RUN_GATEWAY_REGISTRY_DB_TESTS=true` was used for the DB-backed rerun. The initial sandboxed run could not spawn the helper's `npx prisma migrate deploy` child process (`EPERM`); the same command was rerun outside that sandbox. The rerun reached database assertions and is the authoritative T043 result.

## T042 - Focused Feature 006 verification

| Command | Result | Tests | Skips | Evidence |
| --- | --- | ---: | ---: | --- |
| `npm --prefix apps/gateway test -- --runInBand test/managed-identity-exchange/idx-provider-contract.spec.ts test/managed-identity-exchange/persistence.spec.ts test/managed-identity-exchange/delegated-transport.spec.ts test/managed-identity-exchange/delegated-provider.spec.ts test/managed-identity-exchange/idx-delegated-provider.spec.ts test/managed-identity-exchange/idx-menu-detail.validator.spec.ts test/managed-identity-exchange/domain-contracts.spec.ts test/managed-identity-exchange/permission-idx-fixture.spec.ts test/managed-identity-exchange/permission-pipeline.spec.ts test/managed-identity-exchange/permission-normalization.spec.ts test/managed-identity-exchange/phase2a-composition.spec.ts test/managed-identity-exchange/idx-disabled.spec.ts test/managed-identity-exchange/integration-admission.spec.ts test/managed-identity-exchange/readiness.spec.ts test/managed-identity-exchange/feature005-security.spec.ts test/managed-identity-exchange/exchange-audit-module.spec.ts test/managed-identity-exchange/feature004-compatibility.spec.ts test/managed-identity-exchange/exchange.service.spec.ts test/integration/feature004-gateway-backend.e2e.spec.ts` | PASS | 673 passed, 0 failed | 51 skipped in 2 suites | Final current-tree rerun: 17 of 19 suites passed in 2.204 s. |

The current lint-compliance-tree T042 refresh passed: 673 tests passed, 0 failed, 51 DB-gated skips in 2 suites; 17 of 19 suites passed in 2.204 s. The additional four passing cases prove that both validators reject U+001F and U+007F in addition to the existing U+0000 coverage.

The focused suites collectively passed the fixed IDX contract (`idx_delegated`, `idx-menu-detail/v1`, `GET`, bearer, JSON, sole `idx_entry`), retained delegated HTTP POST behavior, and exercised the guarded transport's one-send, no-retry, destination, redirect, content-type, body-limit, deadline, and DNS/rebinding controls. They also covered typed 401/403/infrastructure failures, strict MenuDetail reduction, post-acceptance native-claim parsing, `sub === UUID_User`, organization and entry mapping, no native role/permission authority, immutable trusted material, zero Permission Source calls for `provider_trusted`, deterministic menu scopes, exact admission, readiness, redaction/source guards, two-integration isolation, managed JWT compatibility, native-token session rejection, and session continuity semantics.

T042 is complete and recorded as checked in `tasks.md`.

## T043 - DB-backed and compatibility regressions

| Command | Result | Tests | Skips | Evidence |
| --- | --- | ---: | ---: | --- |
| `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/managed-identity-exchange/*.spec.ts test/integration-registry/*.spec.ts test/upstream-auth/*.spec.ts test/backend-client/*.spec.ts test/integration/feature004-gateway-backend.e2e.spec.ts test/integration/multi-profile-trust-chain.spec.ts` | FAIL | 1,342 passed, 2 failed | 0 | 58 passed, 2 failed of 60 suites in 166.456 s. DB-gated cases executed. |

The command included the complete managed-identity-exchange suite plus Feature 004 registry, upstream-auth, backend-client, direct/compatibility, and Gateway-to-Backend E2E coverage. It was not a live IDX test.

Blocking failures:

1. `test/managed-identity-exchange/feature004-compatibility.spec.ts`: the IDX unrelated-compatible-profile case calls `registeredUpstreamTrustProfile.createMany` with `integrationId = fixture-unrelated-integration`, but no referenced IntegrationBinding exists. PostgreSQL correctly rejects the foreign-key write. Smallest corrective scope: add the required fixture control-plane IntegrationBinding (and its required Customer fixture relation) for that unrelated profile before it is inserted. This is test-fixture setup, not a Feature 004 runtime change.
2. `test/managed-identity-exchange/synthetic-delegated-provider.spec.ts`: the `credential-403` scenario expects `ManagedExchangeCredentialError` but receives `ManagedExchangeIdentityDeniedError`. Smallest corrective scope: align the generic delegated provider regression expectation with the established 403 identity-denied classification, while preserving the one-send and redaction assertions. This is a test expectation correction, not a runtime behavior workaround.

Because both failures occur in required T043 coverage, T043 remains unchecked. The full Feature 005 non-IDX regression, direct Feature 004 regression, two-integration reuse acceptance, managed IDX-to-real-Feature-004 compatibility, and Gateway-to-Backend IDX session E2E cannot be declared green as a Phase 18 aggregate, even though the selection executed and its other tests passed.

### Corrective iteration

Initial T043 execution: 1,342 passed, 2 failed, 0 skipped.

- The stale generic delegated HTTP 403 expectation was aligned from `ManagedExchangeCredentialError` to the established `ManagedExchangeIdentityDeniedError` contract. Its existing one-request, no-retry, fixed-routing, and redaction assertions were retained.
- The unrelated Feature 004 trust-profile test fixture now creates only its required synthetic Customer and IntegrationBinding foreign-key records before profile insertion. The selected managed token remains bound to `fixture-integration-idx-a`; no Feature 005 configuration or authority was created for the unrelated integration.

The targeted corrective command `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/managed-identity-exchange/synthetic-delegated-provider.spec.ts test/managed-identity-exchange/feature004-compatibility.spec.ts` passed: 2 suites, 48 tests, 0 failures, 0 skips.

| Command | Result | Tests | Skips | Evidence |
| --- | --- | ---: | ---: | --- |
| `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/managed-identity-exchange/*.spec.ts test/integration-registry/*.spec.ts test/upstream-auth/*.spec.ts test/backend-client/*.spec.ts test/integration/feature004-gateway-backend.e2e.spec.ts test/integration/multi-profile-trust-chain.spec.ts` | PASS | 1,344 passed, 0 failed | 0 | 60 of 60 suites passed in 147.641 s. All DB-gated owners executed through the existing helper. |

The authoritative rerun includes Feature 005 non-IDX delegated HTTP, `allow_empty`, required Permission Source, synthetic normalizer, generic admission, canonicalization, managed issuer, readiness, audit/error projection, and composition/registry regressions. It also includes direct Feature 004 profile resolution, IntegrationBinding Customer/HostApp authority, Gateway internal JWT and Backend/CustomerScope behavior; Feature 006 two-integration reuse; managed IDX JWT verification through real Feature 004; and the Gateway-to-Backend existing-session-route E2E and re-exchange continuity coverage. Each is PASS under synthetic/local test infrastructure only.

T043 is complete and recorded as checked in `tasks.md`.

### Lint-compliance corrective iteration

- Replaced the two provider-local `no-control-regex` expressions with local code-point helpers that reject exactly ASCII code points 0 through 31 and 127. The IDX claim parser continues to return the original untrimmed claim string after its existing nonblank check; MenuDetail continues to trim `MenuID` before the existing validation/return path.
- Added narrow regression values for U+001F and U+007F alongside the existing U+0000 coverage. The targeted command `npm --prefix apps/gateway test -- --runInBand test/managed-identity-exchange/idx-delegated-provider.spec.ts test/managed-identity-exchange/idx-menu-detail.validator.spec.ts test/signing/signing-key-provider.spec.ts` passed: 3 suites, 228 tests, 0 failures, 0 skips.
- Refined the signing source guard to exact forbidden identifier tokens. Its self-test proves it still detects `GATEWAY_PRIVATE_KEY`, `GATEWAY_PRIVATE_KEY_PEM`, `PRIVATE_JWK`, and `JWT_SIGNING_SECRET`, while allowing the defensive `PRIVATE_JWK_MEMBERS` private-JWK rejection constant.
- `npm run lint` passed after these changes.
- The required focused T042 refresh passed: 673 passed, 0 failed, 51 DB-gated skips in 2 suites. The four additional passing cases cover U+001F/U+007F for IDX claims and MenuID. The skips remain `DB_GATED_AND_RERUN`.

The required current-tree T043 refresh used the same DB-backed command and helper as the authoritative pass. It failed: 59 suites passed, 1 failed of 60; 1,347 tests passed, 1 failed of 1,348; 0 skips; 157.344 s. The only failure was `test/integration/feature004-gateway-backend.e2e.spec.ts`, where the first `beforeEach` exceeded Jest's existing 5,000 ms hook timeout while `createGatewayRegistryDatabase` created the disposable database and applied migrations. No product, IDX adapter, Feature 004, Backend, or session assertion failed.

No timeout was increased to hide the failure. Smallest corrective scope: investigate and stabilize the repository-prescribed disposable DB setup/migration duration for that E2E hook, then rerun the T043 DB selection. Until it passes, the refreshed Feature 004/session E2E aggregate and final readiness are blocked.

### DB setup flake verification

The failing E2E suite was run alone three times with the existing DB flag, DB helper, Jest configuration, and 5,000 ms hook timeout. No source, database helper, test-harness, or timeout configuration changed between runs.

| Run | Command | Result | Tests | Skips | Duration | Failure phase |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 1 | `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/integration/feature004-gateway-backend.e2e.spec.ts` | PASS | 4 passed, 0 failed | 0 | 11.222 s | Not applicable |
| 2 | `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/integration/feature004-gateway-backend.e2e.spec.ts` | PASS | 4 passed, 0 failed | 0 | 9.3 s | Not applicable |
| 3 | `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway test -- --runInBand test/integration/feature004-gateway-backend.e2e.spec.ts` | PASS | 4 passed, 0 failed | 0 | 9.781 s | Not applicable |

The prior timeout was not reproducible in three isolated executions and no timeout or harness change was made. It is classified `TRANSIENT_DB_SETUP_TIMING_FLAKE`; the only confirmed phase in the failed run was `createGatewayRegistryDatabase`/migration setup within `beforeEach`.

The required current-tree T043 command was then rerun: 60 of 60 suites passed, 1,348 tests passed, 0 failed, 0 skipped, in 153.337 s. It restores full Feature 005 non-IDX coverage, direct Feature 004 coverage, DB-backed migration/readiness, two-integration IDX reuse, managed IDX-to-real-Feature-004 compatibility, and Gateway-to-Backend session E2E to GREEN on the current tree.

## T044 - Tooling/build/source guards

| Command | Result | Reason |
| --- | --- | --- |
| `npx prisma validate` | PASS | Final current-tree schema validation passed. |
| `npm run prisma:generate` | PASS | Final current-tree root and gateway client generation passed; immediate status/diff review found no generated-client changes. |
| `npm run typecheck` | PASS | Final current-tree `tsc --noEmit -p tsconfig.json` passed. |
| `npm run lint` | PASS | Final current-tree ESLint passed after the behavior-preserving control detection rewrite. |
| `npm run build` | PASS | Final current-tree root Nest build passed. |
| `npm run build:gateway` | PASS | Final current-tree gateway Nest build passed. |
| `npm --prefix apps/gateway run test:unit` | PASS | 70 of 79 suites passed; 1,387 tests passed; 0 failed; 9 DB-gated suites and 108 tests skipped. |
| `git diff --check` | PASS | Final current-tree whitespace validation passed. |

The earlier lint and source-guard failures were corrected as described above. The 108 gateway-unit skips in 9 DB-gated suites are `DB_GATED_AND_RERUN` because their owning DB-backed cases executed in the immediately preceding current-tree T043 pass. No required skip is unclassified. T044 is complete and recorded as checked in `tasks.md`.

## Skip classification

| Execution | Skips | Classification | Subsequently executed elsewhere |
| --- | ---: | --- | --- |
| T042 focused non-DB command | 51 tests in 2 DB-gated suites | `DB_GATED_AND_RERUN` | Yes. The immediately following current-tree T043 reran the owning broader suites with `RUN_GATEWAY_REGISTRY_DB_TESTS=true` and passed with zero skips. |
| Gateway unit command | 108 tests in 9 DB-gated suites | `DB_GATED_AND_RERUN` | Yes. The immediately preceding current-tree T043 passed the owners with `RUN_GATEWAY_REGISTRY_DB_TESTS=true`. |
| T043 DB-backed authoritative rerun | 0 | Not applicable | Not applicable. |

There are no unexplained skips. All ordinary-run DB-gated cases were exercised by the passing T043 authoritative rerun.

## Production diff review

The Phase 18 baseline working tree contained prior Feature 006 implementation/test/documentation changes and one untracked synthetic two-integration fixture. The two corrective iterations changed `synthetic-delegated-provider.spec.ts`, `feature004-compatibility.spec.ts`, the two provider-local validator files, their focused tests, the signing source guard, this verification report, and Phase 18 checkboxes in `tasks.md`.

No Feature 006 verification change modified Feature 004 verifier/resolver behavior, IntegrationBinding authority, GatewayBackendClient session architecture, Backend session code, Feature 002 CustomerScope, or SDK source. The only production-source edits are `LINT_COMPLIANCE_BEHAVIOR_PRESERVING_CHANGE`: two local ASCII control-detection helpers. `npm run prisma:generate` introduced no generated diff. Status review found no unexpected generated artifact, log, snapshot, credential file, or SDK file. The untracked IDX fixture uses synthetic `fixture-*` identifiers and `.example.test` endpoints only; it contains no real AccessToken, RefreshToken, authorization credential, production IDX endpoint/domain, real Entry UUID, username/password, production selector, or private signing secret. Focused security/redaction guards passed in T042. The refined source guard proves exact raw-private-key identifiers remain forbidden while `PRIVATE_JWK_MEMBERS` remains present as a defensive private-JWK rejection mechanism.

## Capability vs Customer deployment boundary

The passing focused evidence uses synthetic fixtures only. It does not validate a real IDX credential, endpoint, Customer domain, Customer deployment, Host callback implementation, or SDK implementation.

The permitted conclusion is only: Feature 006 reusable IDX provider capability is ready under verified server-side contracts and synthetic acceptance evidence. It does not establish `CUSTOMER_PRODUCTION_DEPLOYMENT_READY`.

## Final gate

| Gate | Result |
| --- | --- |
| Focused Feature 006 | PASS |
| Feature 005 regression | PASS |
| Feature 004 regression | PASS |
| DB-backed migration/readiness | PASS |
| Two-integration reuse | PASS |
| Managed IDX -> Feature 004 | PASS |
| Gateway -> Backend session E2E | PASS |
| Redaction/security | PASS (T042 focused guards) |
| Prisma validate/generate | PASS (no generated diff) |
| Typecheck | PASS |
| Lint | PASS |
| Root build | PASS |
| Gateway build | PASS |
| Gateway unit | PASS (1,387 passed; 108 DB-gated skips rerun in T043) |
| git diff --check | PASS |
| Required unclassified skips | 0 |

`IDX_PROVIDER_CAPABILITY_READY=YES`