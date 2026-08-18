# Feature 004 Verification

## Environment

T061 used `RUN_GATEWAY_REGISTRY_DB_TESTS=true` for registry-backed tests and `RUN_CUSTOMER_US1_TESTS=true` for conditional CustomerScope tests. This record contains results from this run only; critical conditional suites were explicitly enabled.

## Executed verification matrix

| Item | Actual command / suite | Result | Exit criteria |
| --- | --- | --- | --- |
| Gateway normal | `npm --prefix apps/gateway run test -- --runInBand --json --outputFile=/tmp/feature004-gateway-normal.json` | PASS: 43/49 suites, 466/504 tests; 6 suites/38 tests skipped only for registry DB gating | Baseline |
| Gateway DB-enabled | `RUN_GATEWAY_REGISTRY_DB_TESTS=true npm --prefix apps/gateway run test -- --runInBand` | PASS: 49/49 suites, 504/504 tests; 0 failed/skipped | Baseline |
| DB A/B profile chain | `... test/integration/multi-profile-trust-chain.spec.ts` | PASS: 10 tests, no skips | 1–7, 12, 17 |
| DB Gateway→Backend E2E | `... test/integration/feature004-gateway-backend.e2e.spec.ts` | PASS: 2 tests, no skips | 13–16 |
| DB local-signing/JWKS smoke | `... test/integration/local-signing-jwks.spec.ts` | PASS: 4 tests, no skips | Runtime regression |
| DB lifecycle | `... test/integration-registry/trust-profile-lifecycle.spec.ts` | PASS: 13 tests | 7–8 |
| DB repository/cache/audit/binding | `... trust-profile-repository.spec.ts customer-binding-isolation.spec.ts trust-profile-cache.spec.ts upstream-profile-audit-persistence.spec.ts` | PASS: 16 tests | 5–8, 18 |
| Security boundary set | parser, candidate, profile verifier, JWKS source/transport, multi-profile, Direct/Exchange, telemetry, redaction, controller suites | PASS: 12 suites, 132 tests, 0 skips/failures | 1–4, 9–11, 17–18 |
| Authority/runtime/routes set | resolver, activation/persistence/provisioning/readiness, config/bootstrap/docs, wiring, handler/client/read-restore/security suites | PASS: 13 suites, 208 tests, 0 skips/failures | 5–8, 12–14 |
| Feature002/assistant set | internal-identity contract, assistant create/SSE, CustomerScope factory/predicate/context suites | PASS: 6 suites, 54 tests, 0 skips/failures | 13–16 |
| Explicit Customer gate | session isolation, history, SSE, integration isolation suites with `RUN_CUSTOMER_US1_TESTS=true` | PASS: 5 suites, 41 tests, 0 skips/failures | 16 |

The normal-suite skips are acceptable only because every registry-DB suite was explicitly enabled and passed. No security-critical gate is skipped.

## Security and authority evidence

- Routing/candidate tests prove unverified routing exposes only `iss` plus optional non-authoritative `kid`, with issuer-only candidate lookup and no Customer, integration, HostApp, request-body/query, or page-context authority.
- Profile verification covers RS256, nonblank kid, exact issuer/audience, time and canonical claims, valid empty collections, invalid signatures, unknown-key bounded refresh, rotation, cache isolation, and infrastructure failures.
- JWKS source/transport suites cover production HTTP rejection, URL credentials/fragments, loopback/private/link-local/multicast/unspecified addresses, mixed DNS answers, re-resolution/rebinding, connection-time validation, redirect rejection, timeout, response-size limits, JSON/JWKS validation, and production loopback prohibition.
- Multi-profile suites cover zero/one/multiple decisions, shared issuer/JWKS/key, integration/profile mismatch, disabled profiles, no first-match selection, and infrastructure fail-closed behavior.
- Schema/static, resolver, DB, and E2E evidence proves `IntegrationBinding.customerId` is the sole Customer authority and `allowedHostApp` the sole HostApp admission authority. Disabled profile and disabled binding remain distinct boundaries.
- Lifecycle/cache evidence covers atomic replacement/rollback, post-commit invalidation, bounded candidate caching, no stale-on-error, restart reload, and direct IntegrationBinding database reads.
- Config/bootstrap/wiring evidence proves legacy issuer/audience/JWKS values are bootstrap-only; active composition uses `MultiProfileUpstreamTokenVerifier`, with no legacy verifier, fallback, or startup auto-bootstrap.
- Telemetry, controller, redaction, and backend-client suites prove generic 401/403/503 handling, no profile/Customer enumeration, safe audit context, and no Authorization/JWT/claim/key/JWKS/URI-secret/database/transport leakage.

## Fixtures, E2E, and Feature002

Direct and Token Exchange fixture tests prove generic canonical upstream identities; the Exchange fixture validates opaque native credentials server-side without Customer mapping, browser signing, or production credentials.

The DB A/B chain and E2E prove Direct A and Exchange B execute create, read, history, and SSE through Gateway HTTP, multi-profile verification, canonical binding, real internal signing, Backend HTTP, Backend Nest `RemoteJwksInternalIdentityTokenVerifier`, and CustomerScope. Internal JWTs are fresh per operation and contain binding-owned customer/integration claims. Upstream credentials are not forwarded. Request IDs propagate. A→B and B→A denial, foreign-vs-missing non-enumeration, unchanged Customer B state after rejected A work, and non-authoritative public customer/integration headers are all covered.

The direct Feature002 contract confirms `InternalIdentityTokenIssuer` → `RemoteJwksInternalIdentityTokenVerifier` → canonical validation → RequestIdentityContext → CustomerScope, including RS256/kid/issuer/audience/time/jti and fail-closed invalid-token cases.

## Prisma, tooling, and static scans

`npx prisma validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run build`, `npm run build:gateway`, `npm run lint`, and `git diff --check` all passed. Prisma generated root and Gateway clients; DB suites applied the migration lineage.

Production Gateway scans found no `Shinmone`, `customer-a`, `customer-b`, `integration-a`, or `integration-b` core branch labels. The trust-profile schema has neither `customerId` nor `allowedHostApp`; the multi-profile verifier has no binding/resolver/Customer dependency; the candidate resolver only uses `findEnabledByIssuer`; and active Gateway composition has no legacy verifier or legacy runtime upstream-config reference.

The T051 local signing/JWKS smoke compatibility update seeds a Customer → IntegrationBinding → active RS256 profile only as the persisted profile-only runtime prerequisite. Readiness remains fail closed, its HTTPS profile URI is not fetched, the legacy upstream trio is absent from that test environment, and original signing/JWKS visibility, cache-control, and redaction checks pass.

## Exit-Criterion Evidence Matrix

| # | Criterion | Evidence | Status |
| --- | --- | --- | --- |
| 1 | Distinct integrations coexist | DB A/B chain and E2E | PASS |
| 2 | Shared IdP/JWKS/key safe | DB A/B shared-authority cases | PASS |
| 3 | Exactly-one decision accepts | Multi-profile and DB A/B suites | PASS |
| 4 | Zero/multiple fail closed | Multi-profile and DB ambiguity cases | PASS |
| 5 | Binding sole Customer authority | Schema/static, resolver, DB, E2E | PASS |
| 6 | Binding sole HostApp authority | Resolver and DB HostApp cases | PASS |
| 7 | Profile/binding disablement distinct | Lifecycle, resolver, DB A/B | PASS |
| 8 | Legacy runtime authority removed | Config/bootstrap/wiring suites | PASS |
| 9 | Direct JWT generic fixture | Direct fixture suite | PASS |
| 10 | Token Exchange generic fixture | Exchange fixture suite | PASS |
| 11 | Browser/SDK non-authority | Parser/candidate/controller/E2E | PASS |
| 12 | No Customer-specific Gateway core | Static scan and authority guards | PASS |
| 13 | Four Gateway→Backend operations | Handler/client/read-restore/E2E | PASS |
| 14 | Fresh internal JWT per operation | Client and E2E | PASS |
| 15 | Production Feature002 remote verifier | Contract and E2E runtime provider | PASS |
| 16 | CustomerScope A/B isolation | Explicit Customer gate and E2E | PASS |
| 17 | JWKS/SSRF security gate | Source-policy, transport, profile suites | PASS |
| 18 | Audit/no-enumeration/redaction | Telemetry/redaction/controller/E2E | PASS |

T061 records evidence only; the T062 final acceptance decision is recorded below.

## Final Acceptance

T062 evaluation: PASS

`FEATURE004_IMPLEMENTATION_ACCEPTANCE_GATE=PASS`

- All 18 evidence criteria are PASS; none is FAIL or INCOMPLETE.
- The authoritative specification, design, plan, tasks, and verification evidence are consistent.
- `IntegrationBinding.customerId` remains the sole Customer authority, and `IntegrationBinding.allowedHostApp` remains the sole HostApp admission authority.
- No Customer-specific Gateway core logic exists, no security-critical suite was skipped, and T062 required no production change.
