# Tasks: Feature 005 — Managed Identity Exchange

**Input**: `spec.md`, `design.md`, and `plan.md` in this directory.  
**Scope**: Feature 005 only. Feature 004 remains unchanged; it continues to verify managed JWTs and owns `IntegrationBinding` Customer/HostApp admission.

## Execution Rules

- Complete each phase gate before starting dependent work. The dependency model appears in **Dependencies and Parallel Work** below.
- Every named test task must be written and observed failing before its corresponding implementation task begins. `[P]` means only that the task is independently parallelizable after its listed dependencies; phase gates remain sequential.
- Security-boundary implementation tasks name their preceding failing test or their same-task verification. Use the existing migration-backed registry database helper; do not create a parallel test infrastructure.
- No task authorizes Customer resolution, `IntegrationBinding` authority changes, Feature 004 verifier/JWKS changes, Gateway internal signer/key reuse, browser identity authority, raw-native-credential persistence, SDK work, Customer-specific branches, or IDX production enablement.

## Phase 1 — Contract, Persistence, and Domain Foundation

**Goal**: Establish additive, non-authoritative Feature 005 records and pure contracts.  
**Covered plan scope**: Phase 1.  
**Dependencies**: None.  
**Acceptance gate**: `MANAGED_EXCHANGE_FOUNDATION_READY` — additive persistence validates; selectors/version history are safe; no Customer, secret, or native-credential authority exists.

- [x] T001 Create security/contract scaffolding in `apps/gateway/test/managed-identity-exchange/domain-contracts.spec.ts`
  - Goal: Define the failing boundary tests for immutable values, strict exchange request/error envelopes, opaque selector non-authority, no native-credential/audit persistence, and managed-versus-Gateway signing separation.
  - Implementation: Add test-only contract factories and source guards; do not add runtime code.
  - Tests: `domain-contracts.spec.ts` fails before T005 domain contracts exist.
  - Depends on: none.
  - Done when: The intended domain/public boundaries are executable and redaction assertions are explicit.

- [x] T002 Create Feature 005 Prisma models and enums in `prisma/schema.prisma`
  - Goal: Model provider instances, versioned exchange configs/selectors, admission/permission policies, permission sources, managed issuer/signing keys, and separate audit events.
  - Implementation: Add typed lifecycle/status/version/replacement fields, safe references only, structural `integrationId` FK, globally unique `publicSelector`/managed `kid`, and no `customerId`, native credential, JWT, private key, or arbitrary secret fields.
  - Tests: Satisfy T001 schema/source guards; run `npx prisma validate` after the migration task.
  - Depends on: T001.
  - Done when: The schema represents the plan's authorities without a canonicalization-policy phantom or Gateway signing/audit relation.

- [x] T003 Add the additive Feature 005 root migration and PostgreSQL active-state constraints in `prisma/migrations/<timestamp>_managed_identity_exchange/migration.sql`
  - Goal: Enforce selector uniqueness, version histories, FK/index constraints, one enabled-active config/policy/key per applicable anchor, and one V1 active managed issuer.
  - Implementation: Create only additive tables/enums/indexes/checks, including partial unique indexes for active rows; preserve existing lineage and Feature 002–004 tables.
  - Tests: Write migration-backed v1→v2, stale-selector, active selector collision, policy-history, and dual-active transaction tests in `apps/gateway/test/managed-identity-exchange/persistence.spec.ts` first.
  - Depends on: T002.
  - Done when: Migration-backed tests prove history is retained, stale selectors fail closed, and two committed active rows cannot exist.

- [x] T004 Implement migration-backed persistence coverage in `apps/gateway/test/managed-identity-exchange/persistence.spec.ts`
  - Goal: Prove selector/version and partial-unique behavior against the real isolated registry database.
  - Implementation: Use `test/support/gateway-registry-db.helper.ts`; test same integration replaced v1 plus active v2, global selector collision across integrations, and one active policy per selected configuration.
  - Tests: Run with the existing registry DB gate plus `npx prisma validate` and `npm run prisma:generate`.
  - Depends on: T003.
  - Done when: The schema gate supplies direct DB evidence rather than application-only uniqueness claims.

- [x] T005 Implement pure Feature 005 domain values, ports, and typed errors in `apps/gateway/src/managed-identity-exchange/domain/`
  - Goal: Provide immutable `VerifiedExternalIdentity`, `VerifiedAnchor`, canonical managed identity, normalized permissions, adapter/issuer/audit ports, and credential/denial/infrastructure/issuance errors.
  - Implementation: Keep Prisma records, raw DTOs, IDX claims, Customer code, Gateway internal signing, and Feature 004 resolver imports outside this directory.
  - Tests: Make T001 contract tests pass; add focused immutability/unit tests alongside `domain-contracts.spec.ts`.
  - Depends on: T001.
  - Done when: All core interfaces are provider-neutral and expose no browser/native credential authority after verification.

- [x] T006 Implement Feature 005 persistence repositories in `apps/gateway/src/managed-identity-exchange/persistence/`
  - Goal: Add narrow repositories for every managed model, including `findEnabledActiveByPublicSelector`, transaction-scoped lookup/mutation, and audit persistence.
  - Implementation: Return managed records only; lookup follows `publicSelector → active config → integrationId`, with no Customer resolution or binding/HostApp admission decision.
  - Tests: Extend `persistence.spec.ts` for repository lookup and inactive/replaced selector exclusion.
  - Depends on: T004, T005.
  - Done when: Runtime and later control-plane services can use typed repositories without direct Prisma orchestration.

## Phase 2 — Control Plane, Lifecycle, and Readiness

**Goal**: Provide direct-only, transactional configuration and fail-closed readiness.  
**Covered plan scope**: Phase 2.  
**Dependencies**: Phase 1.  
**Acceptance gate**: `MANAGED_EXCHANGE_READINESS_READY` — invalid, ambiguous, disabled, incomplete, or IDX-unvalidated configuration cannot become ready.

- [ ] T007 Implement provider-instance lifecycle provisioning in `apps/gateway/src/commands/provision-managed-identity-provider.ts`
  - Goal: Create/update/disable/version provider instances using registered types and validated fixed contracts.
  - Implementation: Apply pre-validation, conditional transaction mutation, safe post-commit audit/invalidation, and no controller/raw-SQL lifecycle path.
  - Tests: Add failing provider lifecycle/contract validation cases in `apps/gateway/test/managed-identity-exchange/provisioning.spec.ts`.
  - Depends on: T006.
  - Done when: Invalid provider endpoint/contract records cannot be enabled.

- [ ] T008 Implement exchange-configuration provisioning and atomic replacement in `apps/gateway/src/commands/provision-managed-integration-exchange-config.ts`
  - Goal: Server-generate an immutable new `publicSelector`; create successors with a higher version and atomically replace the active predecessor.
  - Implementation: Reject caller-supplied/reused selectors and in-place anchor mutation; commit successor activation and predecessor replacement together.
  - Tests: Extend `provisioning.spec.ts` with selector generation, fresh selector per successor, stale selector 401 lookup, rollback, and no dual/no-active committed interval cases.
  - Depends on: T006, T007.
  - Done when: Selector lookup is only a safe browser lookup, never structural identity authority.

- [ ] T009 Implement admission-policy and permission-policy/source lifecycle commands in `apps/gateway/src/commands/provision-managed-*.ts`
  - Goal: Provision versioned exact-anchor admission policies and validated permission source/policy records under one configuration.
  - Implementation: Preserve version history; validate lifecycle and references; do not introduce arbitrary mapping expressions, native credential inputs, or Customer/HostApp authority.
  - Tests: Add policy history, disabled record, ambiguous active policy, and unsafe source-contract negatives to `provisioning.spec.ts`.
  - Depends on: T006, T008.
  - Done when: Each selected config can have exactly one deterministic active policy of each applicable kind.

- [ ] T010 Implement managed issuer and signing-key lifecycle configuration in `apps/gateway/src/commands/provision-managed-upstream-issuer.ts` and `apps/gateway/src/commands/provision-managed-upstream-signing-key.ts`
  - Goal: Directly provision separate managed issuer/key metadata before runtime issuance exists.
  - Implementation: Require RS256, exact issuer/audience, public JWK, safe key reference, globally unique `kid`, lifecycle/version checks, and no Gateway key identity/material reuse.
  - Tests: Add lifecycle and key-reference validation cases in `provisioning.spec.ts`.
  - Depends on: T006.
  - Done when: Issuer/key configuration is lifecycle controlled but remains separate from Gateway internal signing.

- [ ] T011 Implement read-only readiness validation in `apps/gateway/src/managed-identity-exchange/persistence/managed-exchange-readiness.validator.ts`
  - Goal: Require enabled binding/config/provider, deterministic admission, canonical fields/org strategy, valid permission mode, active managed issuer/key, and compatible active Feature 004 profile.
  - Implementation: For `required`, require source/adapter/normalizer/projection; for `allow_empty`, permit no source but validate one if configured; keep IDX not-ready without its authoritative external contract.
  - Tests: Write readiness-positive and fail-closed matrix tests first in `apps/gateway/test/managed-identity-exchange/readiness.spec.ts`.
  - Depends on: T007–T010.
  - Done when: Readiness has no mutations, decoding, fallback, Customer lookup, or Gateway internal signer use.

- [ ] T012 Complete DB-backed control-plane and readiness regression gate in `apps/gateway/test/managed-identity-exchange/{provisioning,readiness}.spec.ts`
  - Goal: Exercise lifecycle rollback, post-commit behavior, disabled dependencies, selector collision, and Feature 004 compatibility prerequisites.
  - Implementation: Use the existing isolated registry database helper only.
  - Tests: Run focused DB suites, Prisma validate/generate, and Phase 1 guards.
  - Depends on: T011.
  - Done when: `MANAGED_EXCHANGE_READINESS_READY` criteria are all demonstrably satisfied.

## Phase 3 — Admission and Canonicalization

**Goal**: Convert only admitted verified identity into the six-claim managed identity with V1 empty roles.  
**Covered plan scope**: Phase 3.  
**Dependencies**: Phase 2 gate.  
**Acceptance gate**: `MANAGED_ADMISSION_CANONICALIZATION_READY` — exact verified-anchor admission and deterministic canonicalization pass without Customer or browser authority.

- [ ] T013 Add selector A→B replay and exact-anchor admission tests in `apps/gateway/test/managed-identity-exchange/integration-admission.spec.ts`
  - Goal: Prove one verified identity admitted to A cannot obtain a B token merely by changing the selector.
  - Implementation: Cover missing/unsupported/empty/ambiguous policies and server-owned anchor matching; tests must fail before the service is added.
  - Tests: `integration-admission.spec.ts`.
  - Depends on: T012.
  - Done when: Public selector success alone cannot authorize integration admission.

- [ ] T014 Implement exact verified-anchor admission in `apps/gateway/src/managed-identity-exchange/admission/integration-admission.service.ts`
  - Goal: Evaluate exactly one selected active policy against adapter-declared immutable anchors.
  - Implementation: Reject instead of inferring provider-native claims; do not read Customer, binding Customer data, HostApp admission data, or browser context.
  - Tests: Make T013 pass and add source guards for authority separation.
  - Depends on: T013.
  - Done when: A selector-replay attempt stops before canonicalization and issuance.

- [ ] T015 Add canonicalization source and empty-role tests in `apps/gateway/test/managed-identity-exchange/canonicalization.spec.ts`
  - Goal: Specify verified subject, verified/fixed organization, configured integration/HostApp, valid empty scopes, and fixed `roles: []` behavior.
  - Implementation: Include browser/native claims, missing org strategy, blank fields, and Customer-like claim non-authority negatives.
  - Tests: `canonicalization.spec.ts` fails before implementation.
  - Depends on: T012.
  - Done when: The test suite directly names every canonical claim's sole allowed source.

- [ ] T016 Implement canonicalization in `apps/gateway/src/managed-identity-exchange/canonicalization/managed-canonicalization.service.ts`
  - Goal: Produce `integration_id`, `sub`, `org_id`, `host_app`, `roles: []`, and permission scopes only from trusted/admitted input.
  - Implementation: Use typed configuration authority; never create a separate policy entity, resolve Customer, decide final binding HostApp admission, or infer roles.
  - Tests: Make T015 pass and retain T013 replay prevention.
  - Depends on: T014, T015.
  - Done when: Canonical identities are deterministic, nonblank, immutable, and Feature 004-compatible.

## Phase 4 — Delegated Provider Transport

**Goal**: Add a provider-neutral, registered-only delegated verification boundary.  
**Covered plan scope**: Phase 4.  
**Dependencies**: T017–T020 may begin after Phase 1; T021 and this phase gate require Phase 2 readiness.  
**Acceptance gate**: `MANAGED_DELEGATED_TRANSPORT_READY` — registered transport rejects SSRF/rebind/redirect/timeout/response hazards and native credentials have one permitted destination.

- [ ] T017 [P] Define delegated endpoint and transport security tests in `apps/gateway/test/managed-identity-exchange/delegated-transport.spec.ts`
  - Goal: Establish failing coverage for HTTPS, URL credentials/fragments, private/special-use/mixed DNS, rebinding, redirects, MIME/body limits, deadline, and no retry after native forwarding.
  - Implementation: Inject DNS/request/clock doubles and only test-local loopback fixture transport.
  - Tests: `delegated-transport.spec.ts`.
  - Depends on: T006.
  - Done when: The suite has deterministic adversarial cases before transport code exists.

- [ ] T018 Implement registered delegated endpoint validation in `apps/gateway/src/managed-identity-exchange/providers/delegated-endpoint.policy.ts`
  - Goal: Validate provisioned endpoint/method/content/timeout/contract data before enablement.
  - Implementation: Reuse Feature 004's exported public-destination classification primitive unchanged; reject browser-provided routes, headers, extraction/mapping rules, credentials, and fragments.
  - Tests: Make applicable T017 registration negatives pass.
  - Depends on: T017.
  - Done when: Only a fixed registered identity-provider endpoint can receive a native credential.

- [ ] T019 Implement hardened delegated transport in `apps/gateway/src/managed-identity-exchange/providers/delegated-http.transport.ts`
  - Goal: Execute pre- and connection-time DNS validation, one fixed deadline, bounded response parsing, strict MIME/status, and redirect denial.
  - Implementation: Use Feature 005-owned request construction/typed errors; no automatic retry after forwarding and no Feature 004 transport refactor.
  - Tests: Make all T017 transport/rebind cases pass.
  - Depends on: T017, T018.
  - Done when: Transport errors are typed, generic externally, and never retain native credential diagnostics.

- [ ] T020 Implement the fixed `delegated-http/v1` adapter and registry in `apps/gateway/src/managed-identity-exchange/providers/`
  - Goal: Verify native credentials via fixed provisioned response contract and return only `VerifiedExternalIdentity`/typed outcome.
  - Implementation: Require nonblank verified subject, declared anchors, optional verified organization/trusted permission reference; prohibit arbitrary JSONPath, expression evaluation, decode-only trust, and core provider branches.
  - Tests: Add adapter contract/rejected/unavailable/malformed tests in `apps/gateway/test/managed-identity-exchange/delegated-provider.spec.ts`.
  - Depends on: T019, T005.
  - Done when: Adapters never canonicalize, issue, or select integrations.

- [ ] T021 Implement disabled IDX adapter shell and synthetic-only contract in `apps/gateway/src/managed-identity-exchange/providers/idx-delegated-verification.adapter.ts`
  - Goal: Represent IDX as a known but fail-closed provider type pending validated external contract.
  - Implementation: Reject production readiness without endpoint/method/authenticated schemas/failure semantics/anchors; add no ES512/JWKS/decode-only/kid/UUID/UserType logic.
  - Tests: Add source/readiness tests in `apps/gateway/test/managed-identity-exchange/idx-disabled.spec.ts`.
  - Depends on: T020, T011.
  - Done when: IDX is testable as disabled and has no external production dependency in CI.

## Phase 5 — Permission Sources and Projection

**Goal**: Resolve permissions solely from admitted trusted context, with safe absence/outage semantics.  
**Covered plan scope**: Phase 5.  
**Dependencies**: T022–T027 require the Phase 2 and Phase 3 gates. T028 additionally requires T021; this phase's acceptance gate therefore cannot pass until T028 completes.  
**Acceptance gate**: `MANAGED_PERMISSION_PIPELINE_READY` — no Permission Source sees browser credentials; absence, authoritative empty result, outage, and semantic denial are distinguished.

- [ ] T022 Implement permission source repositories and registry in `apps/gateway/src/managed-identity-exchange/{persistence,permissions}/`
  - Goal: Resolve enabled sources/adapters/normalizers by server-owned policy only.
  - Implementation: Expose typed source input and `serviceCredentialReference` only; do not accept raw request/native values.
  - Tests: Add repository/registry tests in `apps/gateway/test/managed-identity-exchange/permission-source.spec.ts`.
  - Depends on: T012, T016.
  - Done when: Source selection cannot be controlled by selector text, browser data, or native claims.

- [ ] T023 Add Permission Source native-credential boundary tests in `apps/gateway/test/managed-identity-exchange/permission-source.spec.ts`
  - Goal: Prove contracts requesting browser Authorization, raw native credential/JWT, or callback data are rejected and sources receive none.
  - Implementation: Include static source guards and a test adapter capture assertion.
  - Tests: `permission-source.spec.ts` must fail before adapter input is implemented.
  - Depends on: T022.
  - Done when: Native credentials are documented and enforced as forwarded only once to the selected identity Provider.

- [ ] T024 Implement trusted-input Permission Source adapter boundary in `apps/gateway/src/managed-identity-exchange/permissions/permission-source-adapter.registry.ts`
  - Goal: Pass only admitted identity, trusted material/reference, server-owned integration context, and controlled service credential reference.
  - Implementation: Reject forbidden contract capabilities both at validation and runtime.
  - Tests: Make T023 pass.
  - Depends on: T023.
  - Done when: A source cannot gain a native credential through any adapter path.

- [ ] T025 Implement immutable normalizer and constrained scope projection in `apps/gateway/src/managed-identity-exchange/permissions/`
  - Goal: Convert only trusted source material to immutable `NormalizedPermission[]` and then allowed Feature 004 scope strings.
  - Implementation: Use registered normalizer/projection contracts; no arbitrary mapping, role projection, UUID hardcoding, or raw provider response persistence.
  - Tests: Add normalizer/projection validity and semantic-denial tests in `apps/gateway/test/managed-identity-exchange/permission-normalization.spec.ts`.
  - Depends on: T024.
  - Done when: V1 roles remain empty and scopes have an explicit trusted projection.

- [ ] T026 Specify permission absence, authoritative-empty, outage, and required-mode failures in `apps/gateway/test/managed-identity-exchange/permission-pipeline.spec.ts`
  - Goal: Make `allow_empty` no-source and successful empty source distinct from configured source timeout/5xx/malformed/unavailable and semantic denial.
  - Implementation: Require no JWT on failure; assert 503 for configured availability failures and 403 for semantic/projection denial.
  - Tests: `permission-pipeline.spec.ts` fails before pipeline orchestration.
  - Depends on: T025.
  - Done when: No configured outage can silently produce `permission_scopes: []`.

- [ ] T027 Implement permission policy pipeline in `apps/gateway/src/managed-identity-exchange/permissions/managed-permission.service.ts`
  - Goal: Enforce `allow_empty`/`required` semantics and use only admitted trusted input.
  - Implementation: Skip outbound work only for `allow_empty` without a source; any configured source failure stops issuance with the correct typed category.
  - Tests: Make T026 pass.
  - Depends on: T026.
  - Done when: Empty scopes are authorized only by policy absence or successful authoritative empty output.

- [ ] T028 Add synthetic IDX permission normalizer fixture and Phase 5 regression gate in `apps/gateway/test/managed-identity-exchange/`
  - Goal: Exercise adapter/normalizer mechanics without a production IDX endpoint, UUID mapping, or role mapping.
  - Implementation: Keep the fixture test-only and server-controlled.
  - Tests: Run permission source, normalizer, pipeline, readiness, and authority/redaction guards.
  - Depends on: T027, T021.
  - Done when: `MANAGED_PERMISSION_PIPELINE_READY` is met with IDX production still blocked.

## Phase 6 — Managed Signing and JWKS

**Goal**: Issue separate short-lived managed RS256 JWTs and publish only their public keys.  
**Covered plan scope**: Phase 6.  
**Dependencies**: T029 may begin after T006 and T010. T030 follows T029, and T032 may proceed after T029 alongside the T030 → T031 chain. T031 and this phase's final gate additionally require T016; T033 completes the gate after T031 and T032.  
**Acceptance gate**: `MANAGED_SIGNING_DOMAIN_READY` — managed issuer/key/kid/JWKS are cryptographically and operationally distinct from Gateway internal signing.

- [ ] T029 [P] Implement managed signing-key repository/provider in `apps/gateway/src/managed-identity-exchange/issuer/`
  - Goal: Resolve exactly one active managed key and safely load only its referenced private material through a low-level loader boundary.
  - Implementation: Keep Feature 005 models/repository separate from `GatewaySigningKey` and do not expose key references/private material.
  - Tests: Add key lifecycle/provider tests in `apps/gateway/test/managed-identity-exchange/managed-signing.spec.ts`.
  - Depends on: T006, T010.
  - Done when: Active/retiring/public key lifecycle can be evaluated without Gateway internal signing authority.

- [ ] T030 Add signer-domain collision and public-key tests in `apps/gateway/test/managed-identity-exchange/managed-signing.spec.ts`
  - Goal: Reject Gateway key references, equivalent public material, Gateway `kid`, or issuer identity reuse; require public-only JWKS serialization.
  - Implementation: Add failing cross-domain registration and redaction cases before signer implementation.
  - Tests: `managed-signing.spec.ts`.
  - Depends on: T029.
  - Done when: Managed/Gateway signing-domain separation is direct test evidence.

- [ ] T031 Implement managed RS256 issuer in `apps/gateway/src/managed-identity-exchange/issuer/managed-upstream-token-issuer.ts`
  - Goal: Sign only six canonical claims using exact audience, nonblank managed `kid`, generated `jti`, and fixed ≤5-minute TTL.
  - Implementation: Reject noncanonical input and never issue Gateway internal JWTs or select integrations.
  - Tests: Make T030 tests pass; add issuer/audience/TTL/claim-shape signature tests.
  - Depends on: T030, T016.
  - Done when: Issued tokens are Feature 004-shaped upstream JWTs only.

- [ ] T032 [P] Implement the managed JWKS service/controller in `apps/gateway/src/managed-identity-exchange/issuer/{managed-jwks.service.ts,managed-jwks.controller.ts}`
  - Goal: Publish public active/retiring/published managed keys at `/.well-known/managed-identity-exchange-jwks.json` with bounded cache control.
  - Implementation: Exclude private fields, references, Gateway keys, and internal JWKS endpoint reuse.
  - Tests: Add endpoint/cache-control/private-material exclusion tests in `apps/gateway/test/managed-identity-exchange/managed-jwks.spec.ts`.
  - Depends on: T029.
  - Done when: The endpoint exposes only valid managed public JWKs.

- [ ] T033 Complete managed signing/JWKS lifecycle and signature regression gate in `apps/gateway/test/managed-identity-exchange/{managed-signing,managed-jwks}.spec.ts`
  - Goal: Verify key replacement, disabled/invalid states, signing isolation, exact claims, and public JWKS visibility.
  - Implementation: Run no production integration composition yet.
  - Tests: Focused signing/JWKS suites plus Phase 1 DB tests.
  - Depends on: T031, T032.
  - Done when: `MANAGED_SIGNING_DOMAIN_READY` is satisfied.

## Phase 7 — Exchange API, Orchestration, Errors, and Audit

**Goal**: Compose the ordered exchange path into a strict public API without altering Feature 004.  
**Covered plan scope**: Phase 7.  
**Dependencies**: All required Phase 2–6 gates.  
**Acceptance gate**: `MANAGED_EXCHANGE_API_READY` — all 17 ordered steps, fail-closed errors, request IDs, and redacted audit behavior pass.

- [ ] T034 Add ordered 17-step exchange-service tests in `apps/gateway/test/managed-identity-exchange/exchange.service.spec.ts`
  - Goal: Require lookup/readiness → provider verification → identity → admission → canonicalization → permissions → issuer/key → signing → success audit → response order.
  - Implementation: Assert every failure stops later steps, provider calls are outside transactions, and success-audit failure withholds the already-created token.
  - Tests: `exchange.service.spec.ts` fails before service composition.
  - Depends on: T028, T033.
  - Done when: Reference equality/trusted-context boundary evidence covers the full authority sequence.

- [ ] T035 Implement managed exchange orchestration in `apps/gateway/src/managed-identity-exchange/exchange.service.ts`
  - Goal: Compose selected active configuration, registry/provider, readiness, admission, canonicalization, permission pipeline, issuer, and audit exactly once in the prescribed order.
  - Implementation: No calls to Feature 004 candidate/resolver/internal issuer and no Customer lookup; signing is the final authority-producing step.
  - Tests: Make T034 pass.
  - Depends on: T034.
  - Done when: The service returns only a managed credential result or typed safe failure.

- [ ] T036 Add strict API/public-error/redaction tests in `apps/gateway/test/managed-identity-exchange/exchange.controller.spec.ts`
  - Goal: Specify Bearer-only input, exact body, request-ID/trace behavior, 400/401/403/503 non-enumerating envelopes, and no native/JWT/endpoint/key/anchor/Customer leakage.
  - Implementation: Cover unknown/disabled selector equivalence, provider rejection, admission denial, permission denial/outage, and issuer/audit infrastructure failures.
  - Tests: `exchange.controller.spec.ts` fails before controller/projector implementation.
  - Depends on: T035.
  - Done when: Public response semantics are security-tested independently of Feature 004 Assistant routes.

- [ ] T037 Implement controller, DTO validation, and Feature 005 error projector in `apps/gateway/src/managed-identity-exchange/{exchange.controller.ts,exchange-request.validation.ts,exchange-error.projector.ts}`
  - Goal: Expose only `POST /api/v1/identity/exchange` and `{ accessToken, tokenType, expiresIn, requestId }` success output.
  - Implementation: Normalize request ID; reject extra authority-like body fields; preserve optional trace only for tracing; do not modify existing Gateway operation projector.
  - Tests: Make T036 pass.
  - Depends on: T036.
  - Done when: Controller public behavior is generic and non-enumerating.

- [ ] T038 Implement Feature 005 audit writer/module composition and API gate in `apps/gateway/src/managed-identity-exchange/{persistence/managed-exchange-audit.writer.ts,managed-identity-exchange.module.ts}`
  - Goal: Persist one safe exchange outcome with no native credentials, Authorization, managed JWT, raw response, permission payload, secret, or Customer ID; register only Feature 005 routes/services.
  - Implementation: Keep managed writer/model distinct from `GatewayIdentityAuditEvent`; add module wiring without replacing Feature 004 trust paths.
  - Tests: Add audit-write/redaction/request-ID integration tests and run T034–T037 suites.
  - Depends on: T037.
  - Done when: `MANAGED_EXCHANGE_API_READY` holds and success-audit failure returns generic 503 with no token.

## Phase 8 — Feature 004 Compatibility and Final Verification

**Goal**: Prove generic managed exchange works through the unchanged Feature 004 chain while direct Feature 004 remains intact.  
**Covered plan scope**: Phase 8.  
**Dependencies**: Phase 7 gate.  
**Acceptance gate**: `FEATURE005_FRAMEWORK_IMPLEMENTATION_READY` may be set only after T045 passes; IDX production remains independently deferred.

- [ ] T039 Create a synthetic delegated Identity Provider fixture in `apps/gateway/test/managed-identity-exchange/fixtures/synthetic-delegated-provider.fixture.ts`
  - Goal: Provide test-only verified/rejected/malformed/timeout/5xx/oversized delegated responses and declared anchors/organization/trusted reference.
  - Implementation: Use isolated test transport/listener; never add Customer labels, production URL/secrets, or browser-selected routing.
  - Tests: Add fixture contract tests in `apps/gateway/test/managed-identity-exchange/synthetic-delegated-provider.spec.ts`.
  - Depends on: T038.
  - Done when: Generic provider behavior can test all transport/adapter categories without external infrastructure.

- [ ] T040 Create a synthetic Permission Source fixture in `apps/gateway/test/managed-identity-exchange/fixtures/synthetic-permission-source.fixture.ts`
  - Goal: Supply trusted material, authoritative empty results, semantic denials, and controlled outages for policy testing.
  - Implementation: Capture adapter inputs to enforce no native credential/browser Authorization forwarding.
  - Tests: Add fixture tests to `apps/gateway/test/managed-identity-exchange/synthetic-permission-source.spec.ts`.
  - Depends on: T039, T028.
  - Done when: Required/allow-empty safety evidence is deterministic and test-only.

- [ ] T041 Add managed JWT → unchanged Feature 004 chain integration tests in `apps/gateway/test/managed-identity-exchange/feature004-compatibility.spec.ts`
  - Goal: Verify a managed JWT through real Feature 004 profile verification/exact-one decision and `CanonicalIdentityResolver`, then assert binding-derived Customer/HostApp admission.
  - Implementation: Include compatible profile, wrong/missing profile, shared issuer/key exact-one behavior, and no direct invocation/modification of Feature 004 internals.
  - Tests: DB-gated `feature004-compatibility.spec.ts` fails before compatibility composition.
  - Depends on: T038–T040.
  - Done when: Managed output is merely another canonical upstream JWT at Feature 004's existing public boundary.

- [ ] T042 Implement multi-integration/profile isolation evidence in `apps/gateway/test/managed-identity-exchange/feature004-compatibility.spec.ts`
  - Goal: Prove one adapter can serve A/B configs while replay, selector collision, profile ambiguity, wrong anchor, and cross-Customer attempts fail closed.
  - Implementation: Use independent configuration/profile/binding rows and identical lower-level identity fields where useful; never add A/B production branching.
  - Tests: Run with existing registry DB gate and Feature 004 multi-profile/resolver suites.
  - Depends on: T041.
  - Done when: Customer isolation derives only from existing Feature 004 binding resolution.

- [ ] T043 Add direct Feature 004 path regression in `apps/gateway/test/managed-identity-exchange/direct-feature004-regression.spec.ts`
  - Goal: Demonstrate Direct JWT fixture authentication remains operational without Feature 005 exchange invocation or fallback.
  - Implementation: Assert active Feature 004 verifier/profile chain does not import/use Feature 005 controller/service for direct onboarding.
  - Tests: Existing direct JWT, multi-profile, handler/wiring, and new regression suite.
  - Depends on: T042.
  - Done when: Feature 005 is additive and never becomes a direct-path replacement.

- [ ] T044 Run end-to-end security, redaction, and negative integration matrix in `apps/gateway/test/managed-identity-exchange/feature005-security.spec.ts`
  - Goal: Consolidate forged/decodable credential, selector replay, SSRF/rebind, no retry, permission outage, signing-domain isolation, public error, audit redaction, and no-Customer-authority evidence.
  - Implementation: Add static scans covering Feature 005 source paths and confirm no forbidden Feature 004/Customer/IDX logic.
  - Tests: `feature005-security.spec.ts` plus focused suites must fail for a deliberately unsafe test double before final verification.
  - Depends on: T043.
  - Done when: All security properties have reproducible focused evidence.

- [ ] T045 Complete the Feature 005 framework verification and rollout gate in `specs/005-managed-identity-exchange/verification.md`
  - Goal: Record executed commands/results for focused Gateway, DB-gated registry, Prisma validation/generation, root typecheck/lint/build, Gateway build, Feature 004 regression, and source/redaction scans.
  - Implementation: Document managed issuer/JWKS, readiness/lifecycle, API, synthetic providers, Feature 004 compatibility, direct-path preservation, and rollout/rollback evidence; do not claim IDX production readiness.
  - Tests: Run the full Phase 1–8 matrix and classify every skip; a critical failure/skip blocks the marker.
  - Depends on: T044.
  - Done when: All framework criteria pass, `FEATURE005_FRAMEWORK_IMPLEMENTATION_READY` is eligible to be set to `YES`, and Feature 004 remains unmodified.

## Dependencies and Parallel Work

```text
Phase 1 → Phase 2 → Phase 3
    ├─→ Phase 4: T017 → T018 → T019 → T020; T021 also requires T011
    └─→ Phase 6: T029 → T030 → T031; T032 after T029; T031 also requires T016; T033 joins T031 + T032

Phase 2 + Phase 3 → Phase 5: T022 → T027
T027 + T021 → T028 → Phase 5 gate

T028 + T033 → Phase 7 → Phase 8
```

- T017 may proceed after Phase 1 and independently from Phase 2 work. T018–T020 remain sequential; T021 additionally requires T011.
- T029 may proceed after T006 and T010, independently from non-conflicting Phase 3–5 work. After T029, T032 may proceed alongside the T030 → T031 chain; T031 additionally requires T016, and T033 joins T031 with T032.
- T022–T027 begin after the Phase 2 and Phase 3 gates. T028 additionally waits for T021, so `MANAGED_PERMISSION_PIPELINE_READY` indirectly requires the Phase 4 IDX-shell task. Phase 7 starts only after T028 and T033 provide their transitive prerequisites; Phase 8 follows the Phase 7 gate.

## Verification Commands at Phase Gates

- Focused: `npm --prefix apps/gateway run test -- --runInBand <relevant spec paths>`.
- Migration-backed suites: use the existing `RUN_GATEWAY_REGISTRY_DB_TESTS=true` convention and `test/support/gateway-registry-db.helper.ts`.
- Tooling/final: `npx prisma validate`, `npm run prisma:generate`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run build:gateway`.
- Regression: run the existing Feature 004 profile, resolver, JWKS, trust-chain, direct-JWT, and Gateway→Backend coverage after Phase 8.

## Completion Metadata

- `FEATURE005_FRAMEWORK_IMPLEMENTATION_READY`: defined only. Set to `YES` exclusively after T045 and every framework gate passes.
- `FEATURE005_IDX_PRODUCTION_READY`: **BLOCKED / DEFERRED**. It requires an authoritative external IDX endpoint, method, authenticated success/failure schemas, validated anchor extraction, and—if permissions are enabled—a server-side permission contract plus authoritative UUID-to-semantic mapping. It is not a Framework implementation task.

Feature 004 modification required: **NO**.
