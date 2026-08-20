# Feature 005 — Managed Identity Exchange Implementation Plan

**Feature**: `005-managed-identity-exchange`  
**Status**: Implementation plan — no implementation in this batch  
**Authority order**: Constitution 2.0.0 → Feature 005 `spec.md` → Feature 005 `design.md` → this plan → accepted Feature 002/003/004 contracts.

## 1. Implementation Context

Feature 005 is an isolated `ManagedIdentityExchangeModule` in `apps/gateway`; it is not a new deployable. Its authority-producing sequence is fixed:

```text
native credential
  → registered Identity Provider verification
  → VerifiedExternalIdentity
  → Integration Admission
  → canonicalization
  → permission pipeline
  → managed canonical JWT issuance
  → unchanged Feature 004 verification and binding resolution
```

Feature 004 remains the sole verifier of managed JWTs and the sole owner of `IntegrationBinding.customerId` and `IntegrationBinding.allowedHostApp` admission. Feature 005 never resolves Customer, calls `CanonicalIdentityResolver`, or alters Feature 004 verifier/JWKS/trust-profile behavior.

## 2. Source Placement and Reuse

Create `apps/gateway/src/managed-identity-exchange/` with:

- `managed-identity-exchange.module.ts`, `exchange.controller.ts`, `exchange.service.ts`, request validation, and public error projection.
- `domain/` for immutable identity/anchor/canonical/permission values, ports, and typed errors.
- `persistence/` for repositories, activation/readiness validators, and a Feature 005-specific audit writer.
- `providers/` for the provider registry, delegated HTTP transport/adapter, and IDX disabled adapter shell.
- `admission/`, `canonicalization/`, `permissions/`, and `issuer/` for isolated runtime services.
- Direct-only Feature 005 commands under `apps/gateway/src/commands/`, matching existing trust-profile command conventions.
- Tests under `apps/gateway/test/managed-identity-exchange/`, using `test/support/gateway-registry-db.helper.ts`, the ephemeral RSA fixture, and test-only provider servers.

Reuse Prisma access, request-id normalization behavior, transaction/post-commit patterns, safe-code validation, the low-level signing key-reference loader, public-JWKS serialization approach, and exported `assertPublicDestination` classification. Do not reuse `GatewaySigningKey`, Gateway internal issuer/key/kid, `GatewayIdentityAuditEvent`, or Gateway internal JWKS authority.

## 3. Persistence and Migration Plan

Add one additive root Prisma migration for:

| Model | Ownership and key constraints |
| --- | --- |
| `ManagedIdentityProviderInstance` | reusable provider type, registered endpoint/contract, lifecycle/version |
| `ManagedIntegrationExchangeConfig` | opaque row ID, globally unique server-generated `publicSelector`, versioned `integrationId` FK to `IntegrationBinding`, provider reference, typed HostApp/organization authority |
| `ManagedIntegrationAdmissionPolicy` | versioned exact-anchor policy per integration-configuration row |
| `ManagedPermissionSourceInstance` | reusable source type/config, optional provider link, `serviceCredentialReference` only |
| `ManagedPermissionPolicy` | versioned selected source/normalizer/projection policy per integration configuration |
| `ManagedUpstreamIssuer` | exact issuer/audience/JWKS authority, lifecycle/version |
| `ManagedUpstreamSigningKey` | public JWK, key reference, lifecycle/version; no private material |
| `ManagedExchangeAuditEvent` | redacted exchange lifecycle outcome without Customer or payload material |

All models use opaque IDs, timestamps, enabled/lifecycle state, and versions where replacement applies. No model stores `customerId`, raw native credentials, authorization headers, issued JWTs, private keys, or arbitrary secret blobs. `serviceCredentialReference` and signing `keyReference` are references only.

`ManagedIntegrationExchangeConfig` separates four concerns:

- Row identity is its opaque `id`.
- `publicSelector` is a nonblank, non-secret, globally unique, server-generated opaque browser lookup reference. It is never derived from `customerId`, native credentials, or browser authority and is never reused by another configuration version.
- `integrationId` is an indexed structural FK to `IntegrationBinding.integrationId` and the sole Feature 005 source for canonical `integration_id`; it is never inferred from selector text or native credentials.
- `version` plus lifecycle/replacement metadata preserves history for the same integration anchor.

Runtime resolves only `publicSelector → one enabled active configuration → config.integrationId`. Unknown, replaced, or disabled selectors have no active lookup result and become the existing generic non-enumerating 401 outcome before provider verification.

Use FK/index/unique constraints for configuration relationships, model versions, managed `kid`, and audit lookup. `ManagedIntegrationExchangeConfig` uses `@@unique([integrationId, version])`, not global `UNIQUE(integrationId)`, plus global `UNIQUE(publicSelector)`. Add migration-level partial unique indexes/checks for one enabled active exchange configuration per integration, one active admission policy per configuration, one active permission policy per configuration, one active signing key per issuer, and one V1 active managed issuer. Admission and permission policies similarly use opaque row IDs, `integrationConfigId` business anchors, `@@unique([integrationConfigId, version])`, replacement lineage, and a partial unique active-policy constraint.

Application activation validators enforce contract semantics, cross-table Gateway signing collision checks, legal lifecycle transitions, Feature 004 trust-profile compatibility, and successor completeness; no raw SQL is used as a lifecycle path. PostgreSQL partial indexes enforce committed active-state cardinality.

## 4. Domain and Port Plan

Implement pure domain contracts before HTTP and Prisma orchestration:

- `VerifiedExternalIdentity`, `VerifiedAnchor`, canonical managed identity, `NormalizedPermission`.
- `IdentityProviderAdapter` plus provider registry.
- `PermissionSourceAdapter`, source registry, `PermissionNormalizer`, and scope projection port.
- Integration admission, canonicalization, managed token issuer, managed signing-key provider, and audit ports.
- Typed credential, denial, infrastructure, and issuance errors.

Domain code cannot import Prisma records, raw controller inputs, IDX claim models, Customer code, Gateway internal signing implementation, or Feature 004 resolver authority. Provider-specific behavior enters only through adapters.

## 5. Provisioning and Readiness Plan

Implement direct-only control-plane commands/services for provider instances, exchange configurations, admission policies, permission-source instances, permission policies, managed issuers, and managed signing keys. Exchange-configuration creation generates its own `publicSelector`; callers cannot supply, preserve, or repurpose browser lookup authority. Each command validates first, performs conditional mutation inside a Prisma transaction, and attempts safe audit/invalidation only after commit. No Feature 005 administration controller is added.

Configuration replacement creates a fully validated successor row with a fresh selector and higher version. In one transaction, it re-reads state, marks the active predecessor `replaced`/disabled, activates the successor, and commits. The transaction prevents a committed dual-active or no-active interval; the predecessor selector fails closed after commit. Admission and permission policy replacement use the same versioned-successor rule under their selected configuration row.

`ManagedExchangeReadinessValidator` must require:

1. enabled existing `IntegrationBinding`;
2. active exchange configuration and validated active Provider Instance;
3. exactly one deterministic active admission policy;
4. nonblank configured HostApp and verified-or-fixed organization strategy;
5. explicit permission mode; `required` adds active source, source adapter, normalizer, and projection contract; `allow_empty` may omit a source but validates a configured one;
6. active managed issuer and exactly one valid active managed signing key;
7. compatible enabled active Feature 004 trust profile anchored to the same integration; and
8. a validated external IDX contract before IDX may become production-ready.

Readiness is read-only and fail-closed: it never auto-provisions, decodes credentials, chooses a fallback integration/profile, or uses Gateway internal signing.

## 6. Runtime Implementation Plan

### Admission and canonicalization

Evaluate only adapter-declared verified anchors against the selected integration policy by exact match. Empty, missing, unsupported, or ambiguous policy rejects. A credential admitted to selector A is denied for selector B unless B independently accepts its verified anchors.

Canonicalization uses only selected configuration `integrationId`, verified subject, verified organization or fixed single-org configuration, and configured HostApp. V1 always emits `roles: []`; permission scopes come only from the permission pipeline. It does not resolve Customer, accept browser values, or introduce a canonicalization-policy model.

### Delegated transport and provider framework

Implement Feature 005's own registered HTTPS transport. It may import Feature 004's public-destination classifier but must not refactor or alter Feature 004 transport behavior. It owns endpoint registration, request construction, response handling, and typed errors.

Require HTTPS and reject URL credentials/fragments, redirects, private/link-local/loopback/multicast/unspecified/reserved destinations, mixed DNS answers, DNS rebinding, non-allowlisted content types, oversized bodies, and deadline expiry. Validate DNS before request and during connection; use one bounded end-to-end deadline and no retry after native-credential forwarding. Browser data never selects endpoints, headers, extraction behavior, or transport policy. A native credential is sent only once to the selected registered Identity Provider endpoint.

Implement `delegated-http/v1` with a fixed provisioned contract version and fixed verified result shape: nonblank subject, optional organization, declared anchors, and optional trusted permission reference. Classify outcomes as rejected, unavailable, or malformed response. Do not permit JSONPath, expressions, decode-only trust, or dynamic mapping.

Implement `IdxDelegatedVerificationAdapter` only as a strict contract-validation shell with production-disabled/fail-closed behavior and synthetic test support. Do not guess endpoints, verify ES512 locally, decode native JWTs as authority, handle `kid`/public keys, map UUIDs, or infer roles from UserType/IsAdmin.

### Permission pipeline

Implement source registry, source-instance repository, normalizer registry, permission policy validation, immutable normalized permissions, and constrained projection. A Permission Source receives only admitted identity, trusted reference/material, server-owned integration context, and a deployment-controlled service credential reference resolved by a secret/key provider. It never receives browser Authorization, raw native credentials/JWTs, or callback tokens; contracts requesting them are rejected during validation and at runtime.

`allow_empty` permits only no configured source or a successful authoritative empty result. A configured-source timeout, 5xx, malformed response, unavailable adapter/normalizer, or invalid material is generic 503 and never degrades to empty scopes. `required` source absence/unavailability is generic 503; normalization/projection semantic denial is generic 403. Implement framework and synthetic coverage now; IDX permission production enablement remains blocked on its authoritative server-side contract and menu mapping.

### Managed signing and JWKS

Implement a Feature 005-only RS256 issuer with exact audience, five-minute TTL, nonblank managed `kid`, generated `jti`, and only the six Feature 004 canonical claims. A managed key repository/provider may delegate only low-level key-reference loading to the existing safe loader.

Registration rejects Gateway key references, equivalent public material, Gateway `kid`, Gateway issuer identity, and duplicate managed keys. Publish managed public keys only at `GET /.well-known/managed-identity-exchange-jwks.json`; show valid published/active/retiring public keys with bounded cache-control. Never expose private material, key references, or Gateway internal keys.

### Orchestration, controller, and audit

Implement `ManagedIdentityExchangeService` only after the preceding pieces and follow the accepted 17-step sequence exactly. Its first configuration step looks up exactly one enabled active `ManagedIntegrationExchangeConfig` by the request `integrationSelector`, then takes `integrationId` only from that record. Controllers do not orchestrate; providers do not canonicalize; canonicalizers do not resolve Customer; permission adapters do not issue JWTs; issuers do not select integrations.

Expose `POST /api/v1/identity/exchange` with exact body `{ integrationSelector }`, Bearer-only native credential, normalized `x-request-id`, optional trace propagation, and strict extra-field rejection. Return only `{ accessToken, tokenType, expiresIn, requestId }`.

Project only these public errors:

- 400 `EXCHANGE_REQUEST_INVALID`
- 401 `EXCHANGE_IDENTITY_INVALID`
- 403 `EXCHANGE_IDENTITY_DENIED`
- 503 `EXCHANGE_SERVICE_UNAVAILABLE`

Write one safe lifecycle outcome per exchange rather than one transaction per step. Record selection, verification, admission, canonicalization, role-empty handling, permission, and issuance classifications without native tokens, JWTs, raw provider responses, full permissions, secrets, or Customer IDs. If a token is signed but success-audit persistence fails, discard the unsent token and return generic 503.

## 7. Implementation Batches and Dependencies

```text
Batch A → Batch B → Batch C ─┐
Batch A → Batch D ──────────┼→ Batch G → Batch H
Batch A → Batch E ──────────┤
Batch A → Batch F ──────────┘
```

| Batch | Scope | Dependencies | Acceptance gate |
| --- | --- | --- | --- |
| A | Contract/security scaffolding, migration, selector lookup repository, repositories, pure domain ports | none | additive versioned persistence; no Customer/secret/native-token authority |
| B | Provisioning validators, versioned replacement, direct commands, lifecycle, readiness | A | invalid, ambiguous, disabled, or stale-selector configuration cannot become ready or resolve |
| C | Admission and canonicalization | A, B | exact verified-anchor admission and deterministic six claims with empty roles |
| D | Delegated HTTPS transport and generic provider | A | SSRF/DNS/rebinding/redirect/timeout/response security gate; no decode-only path |
| E | Permission source/normalizer/projection framework | A, B, C | absence/authoritative-empty/outage semantics and credential boundary gate |
| F | Managed signing lifecycle and separate JWKS | A, B | Gateway/managed signer separation and public-JWKS gate |
| G | Orchestrator, controller, error mapping, safe audit | B–F | strict endpoint and ordered runtime gate |
| H | Feature 004 compatibility, synthetic integration, full regressions | G | managed JWT through unchanged Feature 004; direct path unchanged |

Each batch starts with focused failing boundary tests and completes its unit, persistence, and static authority checks before a dependent batch begins.

## 8. Test Plan

- **Unit/domain**: immutable identity/anchors, registries, exact admission, canonicalization failure, empty roles, normalization/projection, lifecycle, readiness, and typed errors.
- **Contract/API**: strict body/Bearer validation, request ID/trace propagation, response schema, generic 400/401/403/503 envelopes, non-enumeration, and redaction.
- **Security**: forged/decodable credentials, selector replay, browser authority values, forwarding only to the registered identity endpoint, permission-source credential rejection, SSRF, redirects, mixed/rebound DNS, timeout/body/content failures, no retry, signer isolation, and safe audit/errors.
- **Persistence/control plane**: migration-backed isolated registry databases; constraints, lifecycle rollback, disabled/invalid contracts, post-commit behavior, and lack of secret/native-token persistence. Prove one integration can retain replaced v1 plus active v2, two active versions are rejected, active selector collision is rejected globally, replaced/disabled selectors do not resolve, selector collision cannot cross-canonicalize integrations, and admission/permission policies preserve history while allowing one active version per configuration.
- **Synthetic provider**: test-only delegated provider server with valid/rejected identity, anchors, optional organization, timeout, 5xx, malformed/oversized response, authoritative empty permissions, and source outage. IDX external infrastructure is never required in CI.
- **Integration**: same adapter for multiple integrations, A-to-B selector rejection, required/allow-empty permissions, managed issuer/JWKS, Feature 005 JWT through existing `MultiProfileUpstreamTokenVerifier` and `CanonicalIdentityResolver`, plus concurrent direct Feature 004 authentication.

Run focused Gateway suites, DB-gated registry suites, `npx prisma validate`, `npm run prisma:generate`, root typecheck/lint/build, Gateway build, and Feature 004 regression suites.

## 9. Feature 004 Compatibility, Rollout, and Gates

Feature 005 does not provision or change Feature 004 profiles. Its readiness check reads compatible active profiles only. Rollout is ordered:

1. Deploy additive migration and dormant Feature 005 module.
2. Provision managed issuer/key and verify the managed JWKS endpoint.
3. Provision matching Feature 004 trust profiles through existing Feature 004 control-plane ownership.
4. Provision provider, a newly generated-selector exchange configuration, admission, and permission policy/source.
5. Validate readiness and enable a synthetic non-IDX integration.
6. Prove managed exchange → unchanged Feature 004 verifier/binding → Gateway internal JWT → Backend CustomerScope.
7. Enable IDX only after its external verification and optional permission contracts are authoritative and validated.

Rollback disables Feature 005 configuration/issuer/key through Feature 005 lifecycle controls. It never changes Feature 004 fallback, verifier behavior, or Gateway internal signing.

**Framework Done** requires migration, lifecycle-controlled configuration, domain/provider framework, admission, canonicalization, permission framework, managed issuer/JWKS, exchange API, synthetic provider coverage, Feature 004 compatibility, direct Feature 004 regression, and all security/redaction gates.

**IDX Production Ready** additionally requires an authoritative IDX endpoint, method, authenticated success/failure schema, validated anchors, and—if permissions are enabled—a server-side permission contract and authoritative UUID-to-semantic mapping. Until then IDX is disabled and fail-closed.

## 10. Risks and Non-Goals

| Risk | Mitigation | Evidence |
| --- | --- | --- |
| Selector replay | exact verified-anchor admission | A-to-B integration tests |
| Provider SSRF/rebinding | registered endpoint policy plus pre/connection DNS checks | adversarial transport tests |
| Permission outage silently grants access | distinguish absence, empty result, and outage | 503/no-token tests |
| Configuration version/selector collision | unique selector, versioned anchor, transactional replacement, partial active uniqueness | migration-backed replacement/lookup tests |
| Signing-domain collapse | separate models, references, issuer, kid, and JWKS | registration/static tests |
| Feature 004 ambiguity | existing exact-one decision with per-integration profile | managed-to-Feature-004 integration tests |
| IDX assumptions leak into core | disabled IDX shell and external contract gate | static/source and readiness tests |

Do not implement Feature 004 trust changes, Gateway acceptance of native IDX JWTs, local IDX ES512 verification, browser identity mapping/customer authority, Customer-specific branches, permission UUID hardcoding, native-token forwarding to Permission Sources, Gateway-key reuse, arbitrary provider URLs/mappers, SDK work, Customer Backend work, or business connectors.

No blocking incompatibility was found: current `IntegrationBinding`, Feature 004 trust-profile reads, Prisma migration lineage, lifecycle patterns, signing/JWKS patterns, hardened destination classification, audit conventions, and isolated DB helpers support this plan. Feature 004 modification required: **NO**.

`FEATURE005_PLAN_READY=YES`

`FEATURE005_PLAN_CLEANUP_READY=YES`
