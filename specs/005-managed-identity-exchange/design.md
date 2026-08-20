# Feature 005 — Managed Identity Exchange Design

**Feature**: `005-managed-identity-exchange`  
**Status**: Design — no implementation in this batch  
**Authority order**: Constitution 2.0.0 → Feature 005 `spec.md` → this design → accepted Feature 002/003/004 contracts.

## 1. Context, Goals, and Non-Goals

Feature 005 adds an optional managed server-side path for native credentials that cannot directly satisfy Feature 004's canonical upstream JWT contract. It produces a short-lived canonical upstream JWT; the existing Feature 004 Gateway then verifies it, resolves the Customer through `IntegrationBinding`, and issues the existing internal JWT consumed by Feature 002.

Goals:

- Onboard supported external identity systems through provider-instance configuration rather than Customer-specific code.
- Verify native credentials server-side before any canonical identity, integration admission, permission projection, or token issuance.
- Keep provider verification, integration admission, canonicalization, permission integration, and managed signing independently controlled and auditable.

Non-goals:

- Customer resolution, `IntegrationBinding.customerId`, HostApp admission, Feature 004 trust-profile verification/candidate selection/JWKS policy, Gateway internal signing, or Feature 002 CustomerScope.
- SDK API definition, browser exchange orchestration, IDX Auth Backend changes, Customer Backend/Auth Backend/IdP changes, local IDX ES512 verification, or Customer business connectors.

## 2. Existing Architecture Constraints

### CURRENT

- Gateway already exposes fixed Assistant routes and uses `UpstreamTokenVerifier → CanonicalIdentityResolver → GatewayBackendClient`.
- Feature 004 runtime uses database-backed `RegisteredUpstreamTrustProfile`, bounded unverified `iss`/`kid` routing, profile-scoped verification, and exactly one `VerifiedProfileDecision`.
- `CanonicalIdentityResolver` alone resolves `IntegrationBinding.integrationId → customerId`, checks binding enablement, and compares verified `host_app` to `IntegrationBinding.allowedHostApp`.
- Gateway internal JWT signing uses `GatewaySigningKey`, `GatewaySigningKeyRepository`, `SigningKeyProvider`, active/retiring key lifecycle, and `/.well-known/jwks.json`. Its private key material is referenced, never persisted.
- Gateway has direct-only provisioning/lifecycle commands, transaction-backed persistence, post-commit audit/invalidation patterns, a root Prisma lineage, and a strict safe audit writer.

### TARGET

```text
Host Frontend
  → POST /api/v1/identity/exchange (opaque native credential + selector)
  → ManagedIdentityExchangeModule
  → registered integration exchange configuration
  → Provider Instance → Provider Adapter
  → VerifiedExternalIdentity
  → Integration Admission Policy
  → Canonicalization + optional Permission Integration
  → Managed upstream JWT + managed JWKS
  → unchanged Feature 004 Gateway verifier/binding/internal JWT
  → unchanged Feature 002 Backend CustomerScope
```

### UNCHANGED

- Feature 004 TrustProfile persistence, profile activation, candidate resolution, JWKS transport, verifier, exact-one decision, binding resolver, four Assistant routes, and direct canonical-JWT path.
- Feature 003 Gateway-to-Backend internal issuer, signing keys, public JWKS, key lifecycle, and narrow Backend transport.
- Feature 002 internal-JWT verification, request identity context, CustomerScope, and Customer-qualified data behavior.
- Existing SDK public contract; this repository has no SDK implementation.

## 3. Deployment Placement Decision

**Decision: V1 is an isolated `ManagedIdentityExchangeModule` inside `apps/gateway`.**

This is the smallest productizable deployment in the current monorepo: Gateway is the existing public Nest application, owns the root identity-control-plane database, already provides request-id/error/JWKS patterns, and is the immediate downstream verifier. A new deployable would add an unproven operational boundary, duplicate configuration and database connectivity, and require a new service-to-service path without reducing the native-credential trust surface.

Co-location does not merge trust domains. The module has its own controller, persistence/repositories, provider registry, outbound transport, audit events, managed issuer, signing-key records, JWKS endpoint, and lifecycle commands. It never imports or uses Gateway internal signing-key records/resolvers for managed issuance. Provider outbound networking is limited to the exchange module. A future separate deployable can preserve these interfaces and move the module when independent scaling or network isolation warrants it.

## 4. Authority Ownership

| Decision/value | Authority | Non-authority |
| --- | --- | --- |
| Integration selection | Registered exchange configuration found by public selector | Selector itself, native issuer/audience, browser context |
| Provider routing | Selected configuration's Provider Instance | Native claims, browser URL/header, arbitrary endpoint |
| Native credential validity | Provider Adapter after its registered verification contract succeeds | Decoded payload, browser assertion, `validated` flag |
| Integration admission | Registered Integration Admission Policy over verified anchors | Provider success alone, selector alone |
| `integration_id` | Selected, admitted registered integration configuration | Native claims, browser input |
| `host_app` projection | Typed `ManagedIntegrationExchangeConfig` canonical authority; Feature 004 later owns admission | Browser/native claims; Feature 005 is not HostApp admission owner |
| `sub` | Provider-verified subject in VerifiedExternalIdentity | Raw token/payload/browser input |
| `org_id` | Verified organization or typed deterministic single-org authority on the selected configuration | Selector inference, guessed mapping, browser input |
| Roles | V1 fixed empty collection | Browser data, native role material, guessed mappings |
| Permission scopes | Selected integration's registered permission policy over trusted, admitted inputs | Browser data, guessed mappings |
| Customer | Feature 004 IntegrationBinding | Exchange configuration, issuer, provider, organization |
| Managed JWT signing | Managed issuer/key lifecycle | Gateway internal signer/key/`kid`, browser |

## 5. Public Exchange API

### Route and request

`POST /api/v1/identity/exchange`

- `Authorization: Bearer <native credential>` is the only credential transport.
- `x-request-id` is normalized by the server; `traceparent` may be accepted only for tracing.
- The JSON body is exactly `{ "integrationSelector": "nonblank public lookup reference" }`.
- Any missing/malformed bearer credential, malformed selector, or additional body field is rejected. The request does not accept `customerId`, canonical `integration_id`, canonical `host_app`, roles, permission scopes, provider URL, issuer, JWKS URI, arbitrary headers, or provider configuration.

### Success response

`200 OK` returns only:

```json
{
  "accessToken": "<short-lived managed canonical upstream JWT>",
  "tokenType": "Bearer",
  "expiresIn": 300,
  "requestId": "<normalized request id>"
}
```

`accessToken` is a Feature 004 upstream credential, not a Gateway internal JWT. The five-minute lifetime is the V1 fixed default and must not exceed the platform's configured managed-token maximum.

### Public failures

| Condition class | HTTP | Stable public code | Public behavior |
| --- | --- | --- | --- |
| Malformed request/body/authorization form | 400 | `EXCHANGE_REQUEST_INVALID` | Generic request error |
| Unknown/disabled selector, provider rejection, invalid credential, admission rejection | 401 | `EXCHANGE_IDENTITY_INVALID` | One non-enumerating denial envelope |
| Verified identity cannot satisfy required canonicalization or required permission policy | 403 | `EXCHANGE_IDENTITY_DENIED` | Generic issuance denial |
| Provider or configured Permission Source not ready/unavailable, malformed provider/source response, managed issuer/key unavailable, issuance infrastructure failure | 503 | `EXCHANGE_SERVICE_UNAVAILABLE` | Generic service envelope |

No response exposes Customer, provider instance, endpoint, issuer, key, anchors, permissions, or raw external diagnostics.

## 6. Exchange Runtime Sequence

Every exchange follows this ordered sequence:

1. Receive the exchange request.
2. Validate the strict request shape, Bearer credential form, and nonblank selector.
3. Load the current enabled `ManagedIntegrationExchangeConfig` selected by that public lookup value.
4. Load its current enabled Provider Instance.
5. Validate the configuration's current exchange-readiness dependencies.
6. Resolve the Provider Adapter from the server-owned `providerType`.
7. Verify the opaque native credential.
8. Produce immutable `VerifiedExternalIdentity` only on verification success.
9. Apply the selected Integration Admission Policy to its verified anchors.
10. Canonicalize `integration_id`, `sub`, `org_id`, and `host_app` from the admitted configuration and verified identity.
11. Apply the V1 role behavior (`roles: []`).
12. Execute the optional registered Permission Source only when the selected policy has a configured source; an `allow_empty` policy without one produces the trusted empty-scope result without an outbound call.
13. Normalize and project trusted permission material into `permission_scopes`.
14. Load the active Managed Upstream Issuer and signing key.
15. Issue the short-lived canonical upstream JWT.
16. Persist the safe success audit outcome.
17. Return the managed credential.

Any failure stops the sequence: no later authority-producing step may execute, and no managed JWT is returned. In particular, verification MUST precede admission; admission MUST precede canonicalization and issuance; permission work MUST receive only trusted, admitted context; a configured Permission Source failure never falls back to empty scopes; and signing is the final authority-producing step.

Outbound provider or permission-source calls are never held inside a long-running database transaction. Runtime reads and validates the current dependencies before signing from that validated snapshot. The success audit is persisted after signing and before the response is returned; if that persistence fails, the exchange returns only its generic failure and discards the unsent token. The design does not claim atomicity between cryptographic signing and audit persistence, and it does not wrap outbound calls in a database transaction.

## 7. Provider Adapter Model

`IdentityProviderAdapter` is the provider registry boundary. The exchange core resolves an adapter from the Provider Instance's stable `providerType`; it contains no provider-specific conditions.

```text
VerifyNativeCredentialInput
  { nativeCredential, providerInstancePolicy, requestId }
  → IdentityProviderAdapter.verify()
  → VerifiedExternalIdentity | typed verification failure
```

`VerifiedExternalIdentity` is immutable and contains:

- `subject`: required provider-verified stable subject authority.
- `organization?`: optional provider-verified organization authority.
- `roles?`: optional provider-verified role material, not a canonical role decision.
- `permissionMaterial?`: optional trusted provider-specific permission reference/material, never a complete raw response.
- `anchors`: required immutable `VerifiedAnchor[]`, each `{ kind, value }`, with nonblank normalized opaque values.
- `providerSubjectReference?`: safe hashed/reference-only audit value where policy permits.

Anchors are admission metadata, not Customer identity. Adapters declare their supported anchor kinds; examples include tenant, audience, resource, organization, and subject namespace. The core only performs policy matching over declared opaque kinds/values and never reads provider-native claim names.

Verification failures are typed as `rejected`, `unavailable`, or `malformed_response`. They never carry raw credential, raw payload, or endpoint diagnostic into public errors or persistent audit.

## 8. Persistence Model

Feature 005 extends the root Prisma lineage additively. All records have opaque IDs, timestamps, `enabled`, lifecycle (`draft`, `active`, `disabled`, `replaced` where replacement applies), version, and safe replacement/audit traceability. No Feature 005 model holds `customerId` or a Customer relation.

| Entity | Essential typed authority fields | Controlled configuration |
| --- | --- | --- |
| `ManagedIdentityProviderInstance` | `providerType`, `endpointUri`, HTTP method, credential placement, timeout, response contract version, enabled/lifecycle/version | constrained adapter contract document and declared anchor kinds |
| `ManagedIntegrationExchangeConfig` | `integrationId` (unique existing binding reference), provider-instance ID, canonical host-app projection, organization mode, fixed organization when single-org, enabled/lifecycle/version | none for identity authority |
| `ManagedIntegrationAdmissionPolicy` | integration-config ID, policy version, enabled/lifecycle | constrained exact anchor requirements `{ kind, allowedValues }[]` |
| `ManagedPermissionSourceInstance` | `sourceType`, controlled endpoint/config reference, optional Provider Instance reference, deployment-controlled `serviceCredentialReference?`, adapter-contract reference, enabled/lifecycle/version | constrained source-specific contract; no Customer authority or secret material |
| `ManagedPermissionPolicy` | integration-config ID, mode `allow_empty` or `required`, optional permission-source-instance ID, normalizer type/reference, projection-contract version, enabled/lifecycle/version | constrained source-to-scope projection contract |
| `ManagedUpstreamIssuer` | issuer, exact audience, public JWKS URI, enabled/lifecycle/version | no Customer/profile authority |
| `ManagedUpstreamSigningKey` | issuer ID, `kid`, public JWK, key reference, key status, activation/retirement timestamps | no private key material |
| `ManagedExchangeAuditEvent` | request ID, integration reference, provider type/instance reference, outcome/reason category, admission/projection/issuance result, safe `jti`/`kid`, latency category | no metadata/payload bag |

Provider and permission-source contract documents are constrained at provisioning: fixed schema/version, fixed method and server-to-server credential placement where applicable, fixed response extraction fields approved by their adapter, declared anchor kinds, and no arbitrary JSONPath/expression language. A Permission Source contract cannot request browser Authorization, a raw native credential/JWT, or browser callback data; only a controlled service-credential/key reference may be configured, and its secret material is never stored in ordinary database configuration. Security-critical relationship, lifecycle, issuer, audience, endpoint, organization mode, permission mode, source selection, normalizer selection, and projection-contract fields remain typed columns.

`ManagedIntegrationExchangeConfig.integrationId` is a structural foreign key to `IntegrationBinding.integrationId`. Its typed fields are the complete V1 canonicalization authority: the integration anchor, canonical HostApp projection, organization mode, and fixed organization value when `single_org` applies. No separate `ManagedCanonicalizationPolicy` entity or lifecycle exists. Provisioning may validate that its projected HostApp is compatible with the binding's current allowed HostApp, but it never reads or derives Customer and runtime does not use it as HostApp admission; Feature 004 remains the final admission owner.

## 9. Integration Admission and Canonicalization

### Admission

After verification, `IntegrationAdmissionService` evaluates exactly one registered policy for the selected active integration configuration. Every requirement is an exact match against an adapter-declared verified anchor. An empty, unsupported, missing, or non-deterministic policy denies issuance.

```text
selector A → config A → shared provider P → VerifiedExternalIdentity(anchors)
  → policy A accepts → canonical JWT integration_id=A

selector B → config B → same provider P → same identity
  → policy B rejects → no JWT
```

This closes selector replay without making the core understand IDX, OIDC, tenant, audience, or other provider-native claims.

### Canonicalization

The selected admitted configuration and identity produce only the Feature 004 contract:

| Claim | Source | Failure behavior |
| --- | --- | --- |
| `integration_id` | Selected registered integration configuration | Missing/disabled/admission failure denies |
| `sub` | VerifiedExternalIdentity subject | Missing/blank denies |
| `org_id` | Verified organization, otherwise typed fixed single-org authority on the configuration | Neither source denies |
| `host_app` | Typed canonical HostApp projection on the configuration | Missing/blank denies; Feature 004 later enforces binding equality |
| `roles` | V1 fixed empty collection | Always `[]`; no role mapping is evaluated |
| `permission_scopes` | Permission projection | Empty only for no configured `allow_empty` source or authoritative empty result; configured-source infrastructure failure is 503 and semantic projection denial is 403 |

The canonicalizer does not add `customer_id`, native claims, raw provider material, selector values, arbitrary browser fields, or directly copied native roles. V1 does not infer roles from `UserType`, `IsAdmin`, or any other provider-native field. A future typed, server-controlled provider-role projection may be designed as an adapter/projection extension, but it is not V1 configuration or readiness authority.

## 10. Permission Integration

Identity verification and permission integration are separate. `PermissionSourceAdapter` is resolved from the server-owned `ManagedPermissionSourceInstance.sourceType` and exposes a provider-neutral boundary:

```text
ResolvePermissionInput
  { admittedIdentity, trustedPermissionReference?, trustedPermissionMaterial?,
    serverOwnedIntegrationContext, serviceCredentialReference?, permissionSourcePolicy, requestId }
  → PermissionSourceAdapter.resolve()
  → TrustedPermissionMaterial | typed source failure
```

Permission Source input contains only the admitted `VerifiedExternalIdentity`, trusted permission reference/material, server-owned integration context, and—when required—deployment-controlled service authentication by reference. It never contains a raw native credential, browser Authorization header, raw native JWT, or browser credential-callback result. Provisioning and runtime reject any Permission Source contract that requests such input. Browser input cannot select a permission endpoint, forwarding rule, adapter, normalizer, projection, or service credential.

`PermissionNormalizer` is a separate registry boundary. It converts only source-specific `TrustedPermissionMaterial` into immutable provider-neutral `NormalizedPermission[]` entries `{ subject, action }`; exchange core never interprets IDX UUIDs, SCM menu IDs, OIDC native claims, or Customer-specific permission names. The selected `ManagedPermissionPolicy` explicitly binds an integration configuration to its permission mode, optional source instance, normalizer, and constrained projection contract, which maps only approved normalized permissions to canonical scopes.

`ManagedPermissionPolicy.mode` is explicit. In `allow_empty`, an intentionally unconfigured source is an operator-selected `permission_scopes: []` result; a configured source may also return an authoritative empty permission set, which yields `[]`. A timeout, network/5xx failure, malformed response, unavailable adapter/normalizer, or invalid/untrusted material from a configured source is never treated as empty: it fails closed as generic 503 infrastructure unavailability. `required` requires an enabled source instance, available adapter and normalizer, and valid projection contract; absent or unavailable source conditions fail closed as generic 503 infrastructure unavailability, while normalization or projection semantic denial is a generic 403 issuance denial. In either mode, malformed or untrusted material never becomes scopes. IDX normalization, when configured, owns UUID/menu interpretation and produces semantic implicit read plus verified insert/update/delete/print/import/export/copy/approval actions; exchange core does not contain UUID or SCM mappings.

## 11. Delegated HTTP Provider and IDX Reference

### `delegated-http`

V1 provides a reusable `delegated-http` provider type. A Provider Instance fixes its HTTPS endpoint, method, bearer credential placement, allowed request headers, timeout, response content type/size, contract schema/version, success/unauthorized matching, verified identity extraction, and verified-anchor extraction. Browser input cannot change any of these values.

Provisioning validates URI and contract structure; runtime verifies the response again; only a validated, enabled instance can become production active. The exchange does not operate as a proxy and sends no browser-defined headers other than the native credential through the registered placement.

### Transport security

The dedicated transport reuses Feature 004's source-policy and public-destination security principles, not the JWKS document transport implementation:

- HTTPS only; URL credentials/fragments, redirects, loopback/private/link-local/multicast/unspecified/reserved destinations, and mixed DNS answers are rejected.
- Pre-request DNS validation and connection-time re-resolution enforce rebinding protection.
- A fixed five-second end-to-end deadline covers DNS, connection, headers, and streaming body; response body is bounded at 256 KiB and content type is contract-allowed.
- Provider 5xx, network errors, timeout, abort, malformed/ambiguous response, and extraction failure are unverified infrastructure failures.
- A native credential is forwarded once only to the selected registered Identity Provider endpoint; automatic retry is prohibited because credential forwarding may not be idempotent or safe. Permission Sources never receive it.

### IDX adapter

`IdxDelegatedVerificationAdapter` is an adapter implementation, not core behavior. It delegates the opaque IDX credential to a configured IDX Auth verification API and maps only its validated contract result to `VerifiedExternalIdentity`/declared anchors. It performs no ES512 verification, `kid` handling, key discovery, decode-only trust, endpoint guessing, UserType/IsAdmin role inference, or permission UUID mapping in core.

The exact IDX endpoint, method, authenticated response, invalid-token response, and 401/403 semantics are an **external production integration dependency**. An IDX Provider Instance lacking this validated contract remains draft/disabled and fails closed.

## 12. Managed Upstream Issuer and Feature 004 Topology

Managed issuance uses RS256, nonblank managed `kid`, fixed five-minute TTL, exact managed issuer/audience, public JWKS, canonical claims only, generated `jti`, and a separate `/.well-known/managed-identity-exchange-jwks.json` endpoint with public-key-only output and bounded cache-control.

`ManagedUpstreamSigningKey` is intentionally separate from `GatewaySigningKey`. Control-plane validation rejects a Gateway internal key reference, public JWK, private-key handle, issuer identity, or `kid` reused for managed signing. Common secret-manager, Prisma, public-JWKS publication, and lifecycle utility patterns may be reused, but not key authority or material.

V1 uses one active managed issuer, exact audience, and managed JWKS/key set across many managed integrations. Each integration has its own enabled Feature 004 `RegisteredUpstreamTrustProfile` anchored to its existing integration ID but may reference the shared issuer/audience/JWKS. Feature 004's repository allows shared policy across different integration anchors; its multi-profile verifier evaluates all issuer candidates and creates a decision only where verified `integration_id` equals the profile anchor. Thus a valid managed token yields exactly one decision; profile corruption or ambiguity remains Feature 004's generic fail-closed outcome. No source branch is added per integration.

## 13. Provisioning and Readiness

Direct-only control-plane commands/services, following existing trust-profile patterns, support create/update/disable/replace for provider instances, integration exchange configurations, admission policies, permission-source instances, permission policies, managed issuers, and managed signing keys. They use transactions for related state transitions and run safe audit/invalidation after commit. They are not public controllers or self-service APIs.

An integration becomes exchange-ready only when all are true:

1. existing enabled `IntegrationBinding` anchor;
2. enabled active exchange configuration and Provider Instance with validated contract;
3. deterministic active Integration Admission Policy;
4. typed canonical authority on the configuration: verified subject source, deterministic organization source, and nonblank host-app projection;
5. explicit permission policy (`required` or `allow_empty`); for `required`, an enabled active source instance, available source adapter and normalizer, and valid projection contract; for `allow_empty`, a source may intentionally be absent, while any configured source must be valid and enabled—runtime outage is not an empty-result fallback;
6. enabled managed issuer with one active distinct signing key and public JWKS;
7. compatible enabled active Feature 004 trust profile anchored to the same integration; and
8. for IDX, a validated exact delegated-verification contract.

Any missing/deactivated/invalid dependency makes exchange unavailable or denied; it never falls back to decoded credentials, a different integration, a direct Gateway profile, or Gateway internal signing.

## 14. Cache, Concurrency, Audit, and Errors

V1 has **no runtime configuration cache**. Every exchange reads current enabled configuration, policy, and active managed key from persistence. This makes disable/update effective on the next request and avoids stale cross-process configuration acceptance. If later caching is required, it must be process-local, short, version-aware, invalidated after committed mutations, and never serve stale data after a failed reload.

Audit records safe lifecycle/decision events at selection, verification, admission, canonicalization, role-empty handling, permission handling, issuance, and failure. Permission events distinguish operator-selected absent source, authoritative empty source result, configured-source infrastructure unavailability, normalization/projection denial, and successful projection without retaining source material. They may contain request ID, integration reference, provider type/instance reference, outcome/reason category, safe subject reference, `jti`, `kid`, and latency category. They never contain native credentials, authorization headers, refresh tokens, issued JWT strings, private keys, full provider responses, or complete native permission payloads.

Internal diagnostics retain typed errors: `invalid_request`, `integration_denied`, `provider_not_ready`, `verification_rejected`, `provider_unavailable`, `malformed_provider_response`, `admission_rejected`, `canonicalization_failed`, `permission_source_unavailable`, `permission_normalization_failed`, `permission_projection_denied`, `issuer_unavailable`, and `issuance_failed`. The controller maps only the safe categories described in the public API table.

## 15. Testing Strategy

Future implementation must include:

- API contracts for strict request shape, Bearer-only credential transport, response shape, request ID, 400/401/403/503 projection, and redaction/no enumeration.
- Adapter contracts proving only verified identities/declared anchors leave adapters, unsupported provider type behavior, and no raw payload propagation.
- Security negatives for forged decodable credentials, selector A→B replay, browser authority fields, endpoint SSRF, redirects, mixed/rebound DNS, timeout, oversized/invalid/ambiguous response, disabled configuration, and signer-domain/key/`kid` reuse.
- Permission tests for independent identity-provider and permission-source instances, absent versus authoritative-empty versus unavailable `allow_empty` handling, required-source readiness/failure, and normalizer/projection boundaries. A Permission Source contract requesting browser-native credential forwarding must be rejected during provisioning/runtime and receive no credential; a configured `allow_empty` source timeout or 5xx must return generic 503, issue no managed JWT, and never downgrade to empty scopes.
- Persistence/control-plane tests for create/update/disable/replace, contract validation, atomic lifecycle outcomes, readiness, post-commit audit/invalidation, and absence of raw credential persistence.
- Integration tests for one adapter serving two integrations, a non-IDX delegated provider, IDX missing-contract denial, managed JWT entering unchanged Feature 004, exact-one profile behavior, and preserved direct Feature 004 onboarding.

## 16. Security Invariants and Rejected Alternatives

Invariants: exchange core does not import IDX-specific logic; parse native JWTs as authority; resolve `customerId`; accept browser provider URLs; route from unverified issuer; forward browser-native credentials to any destination other than the selected registered Identity Provider endpoint; expose browser credentials or raw native JWTs to Permission Sources; hardcode permission UUIDs; use Gateway internal signing material; or add Customer-specific branches. Customer-specific configuration exists only in control-plane persistence. Unsupported protocols require adapter extension.

Rejected alternatives:

1. **Gateway accepts every native JWT** — would mix protocol-specific verification into Feature 004 and weaken its profile contract.
2. **Browser decodes tokens and sends canonical claims** — makes browser-controlled data identity authority.
3. **Exchange implements IDX ES512 verification** — creates proprietary crypto behavior in product core without an authoritative key contract.
4. **Every Customer Backend builds the only exchange endpoint** — defeats the managed configuration-first product path; direct Feature 004 remains optional, not mandatory.
5. **Managed and Gateway internal signing share keys** — collapses upstream and service-to-service trust domains.
6. **Browser/native `iss` chooses provider endpoint** — creates attacker-controlled outbound trust and SSRF.
7. **Identity and permissions are one provider contract** — cannot support independent identity/authorization systems.
8. **One source branch per Customer** — makes onboarding implementation work instead of provisioning.

## 17. Open External Dependencies

- IDX delegated-verification endpoint, HTTP method, authenticated success schema, invalid-token schema, 401/403 behavior, and validated anchors remain externally owned production dependencies.
- The repository has no SDK source. SDK method names, native-to-exchange-to-Gateway orchestration, and optional memory cache remain a later SDK-scoped design.
- Production provider contracts and managed issuer deployment URLs/key references require deployment-controlled configuration; no browser-supplied values are accepted.

## 18. Design Cleanup Acceptance

`FEATURE005_DESIGN_CLEANUP_READY=YES` — the runtime sequence, permission-source lifecycle model, canonicalization authority, deterministic V1 role behavior, and persistence/provisioning/readiness alignment are documented without changing Feature 004.

`FEATURE005_DESIGN_FINAL_CLEANUP_READY=YES` — native credentials are limited to the selected registered Identity Provider endpoint, Permission Sources use trusted server-side inputs only, and `allow_empty` distinguishes configured absence, authoritative empty results, and infrastructure failure.
