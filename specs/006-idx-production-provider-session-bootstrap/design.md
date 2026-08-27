# Feature 006 Design: IDX Production Provider Session Bootstrap

**Status**: Design only  
**Scope**: Production-enable the reusable IDX provider path in Feature 005. No production code, migration, Feature 004/002 change, Customer deployment, or SDK implementation is included.

## 1. Current Architecture and Compatibility Finding

Feature 005 already provides the authority-preserving managed exchange pipeline:

```text
public integration selector + opaque native credential
  → active exchange configuration and Provider Instance
  → provider adapter / delegated transport
  → VerifiedExternalIdentity
  → exact verified-anchor admission
  → permission policy and normalization
  → canonical six claims and managed RS256 JWT
```

Feature 004 remains a separate downstream boundary:

```text
managed RS256 JWT
  → registered upstream trust profile / exactly-one decision
  → IntegrationBinding integrationId → customerId and allowedHostApp
  → Gateway internal identity
  → existing Backend session route
```

The IDX adapter is currently registered but intentionally disabled. Three narrow Feature 005 extensions are required to enable it:

1. The persisted and runtime delegated request policy currently permits only `POST`; IDX MenuDetail requires a fixed registered `GET` request.
2. `idx_delegated` has no active provider-contract version or adapter implementation.
3. `TrustedPermissionMaterial` and the permission pipeline support only scalar values or a separate Permission Source; they cannot safely carry and directly normalize validated structured MenuDetail data.

These are extensions at established Feature 005 provider/permission boundaries. They do not require a broader framework redesign, do not make native IDX claims authoritative before delegated verification, and do not change Feature 004.

## 2. Target Architecture and Ownership

```text
IDX native AccessToken
  │ once, as Authorization: Bearer
  ▼
Feature 005 registered IDX Provider Instance
  └─ hardened delegated HTTPS transport (GET, fixed destination)
       ▼
     IDX protected MenuDetail response
       ▼
     strict IDX response validator
       ├─ accepted credential → post-acceptance native claim parser
       │    → subject / organization / idx_entry VerifiedExternalIdentity
       └─ immutable IDX MenuDetail trusted material
            → IDX normalizer → NormalizedPermission[]
            → existing scope projector → permission_scopes
  ▼
existing admission → canonicalization → managed issuer
  ▼
unchanged Feature 004 → internal identity → existing session route
```

| Component | Ownership and responsibility |
| --- | --- |
| IDX Provider Instance | Feature 005 server-provisioned endpoint and fixed IDX contract; never browser or Customer runtime input. |
| Delegated transport | Feature 005; performs one bounded HTTPS request and preserves existing SSRF/DNS/rebinding/redirect/content-type/body/deadline protections. |
| IDX adapter | Feature 006 provider-local logic: validates MenuDetail, then parses the already-accepted native credential and creates immutable verified identity/material. |
| Admission | Existing Feature 005 exact-anchor service; compares verified `idx_entry` only to selected integration policy. |
| IDX normalizer | Feature 006 provider-local mapping from closed MenuDetail material to existing generic normalized permissions. |
| Scope projector and issuer | Existing Feature 005; produces `menu:<MenuID>:<action>` and the managed six-claim JWT. |
| Customer and HostApp admission | Unchanged Feature 004 IntegrationBinding and trust-profile path. |
| Host/SDK | Supplies current native credential, exchanges it, and calls existing session API. SDK source work is outside this repository. |

Dependency direction remains inward: provider-local IDX code imports Feature 005 domain ports/types and the guarded transport only. Domain, admission, canonicalization, permission projection, Feature 004, Customer, Backend, and SDK layers do not import IDX claim, MenuDetail, or native-JWT details.

## 3. IDX Provider Contract and Source Placement

The provider registry continues to resolve `idx_delegated`; Feature 006 replaces only the disabled adapter implementation. The active contract is a fixed allowlisted tuple:

| Field | Required value |
| --- | --- |
| Provider type | `idx_delegated` |
| Response contract version | `idx-menu-detail/v1` |
| Endpoint | Provisioned HTTPS URI only |
| Method | `GET` |
| Credential placement | `authorization_bearer` |
| Accepted response | JSON only, bounded by the existing 256 KiB limit |
| Deadline | Provisioned, integer, 1–5,000 ms under the existing transport bound |
| Declared verified anchor | exactly `idx_entry` |

The implementation later belongs under the existing `apps/gateway/src/managed-identity-exchange/` boundary:

- `providers/`: IDX contract validator, strict MenuDetail validator, IDX adapter, and the narrow GET-capable delegated policy/transport change.
- `domain/`: the closed trusted-material discriminated variant and immutable constructors.
- `permissions/`: IDX normalizer and the provider-trusted-material policy path.
- `persistence/`: contract/readiness/activation validation changes only; no Customer-aware persistence behavior.
- `managed-identity-exchange.module.ts`: registers the IDX normalizer and adapter using existing composition.

No endpoint address, secret, selector, Entry UUID, Customer ID, or HostApp value is a source constant. Those values are provisioned records.

### 3.1 Transport and Contract Extension

`ManagedHttpMethod` currently contains only `POST`, and activation, endpoint policy, and transport all enforce POST. Later implementation adds `GET` through a migration, then changes those guards to recognize exactly two fixed tuples:

| Provider tuple | Method | Existing/new behavior |
| --- | --- | --- |
| `delegated_http` + `delegated-http/v1` | `POST` | Unchanged |
| `idx_delegated` + `idx-menu-detail/v1` | `GET` | New, fixed IDX capability |

No arbitrary method, provider type, headers, content type, retry, redirect behavior, or URL mapper is added. The transport receives the validated stored method and retains its single request, pre-resolution and connection-time destination validation, response body limit, deadline, JSON-only response acceptance, and redaction behavior.

The provider-contract registry adds only the closed `idx-menu-detail/v1` contract schema. Its contract configuration identifies fixed response semantics and forbids JSONPath, expressions, browser input, credential/header extraction rules, and raw native-JWT configuration.

### 3.2 Delegated Verification and Native Claim Parsing

The IDX adapter performs operations in this fixed order:

1. Validate the selected Provider Instance against the IDX tuple before sending the credential.
2. Use the existing hardened transport to send the exact native AccessToken once to the configured MenuDetail endpoint.
3. Require successful HTTP status, JSON content, application `Code == 200`, and a strict MenuDetail schema.
4. Only after step 3, structurally parse the same native JWT payload without local signature/key/JWKS/ES512 validation.
5. Require nonblank `sub`, `UUID_User`, `UUID_Company`, and `UUID_Entry`, with `sub === UUID_User`.
6. Construct `VerifiedExternalIdentity` with `subject = sub`, `organization = UUID_Company`, anchor `{ kind: "idx_entry", value: UUID_Entry }`, and constrained IDX trusted material.

The parser reads no authority from `iss`, `aud`, `exp`, `nbf`, `iat`, `Permissions`, `Permission_Hash`, `UserType`, or `IsAdmin`; the protected endpoint acceptance is the sole native credential-validity decision. `UserType` and `IsAdmin` never create roles, so V1 canonical roles remain `[]`.

### 3.3 Failure Classification

The transport/adapter boundary must preserve sufficient typed outcomes internally while retaining the existing generic public projector:

| IDX/transport outcome | Internal managed-exchange outcome | Public result |
| --- | --- | --- |
| HTTP 401 | credential invalid | existing generic 401 `EXCHANGE_IDENTITY_INVALID` |
| HTTP 403 | identity denied | existing generic 403 `EXCHANGE_IDENTITY_DENIED` |
| HTTP 500 or 503 | infrastructure unavailable | existing generic 503 `EXCHANGE_SERVICE_UNAVAILABLE` |
| timeout, DNS, connection, deadline, unsafe destination, redirect, bad content type, oversized body | infrastructure unavailable | existing generic 503 |
| HTTP success with `Code != 200` or invalid MenuDetail schema | infrastructure unavailable / malformed provider response | existing generic 503 |
| post-acceptance invalid/mismatched required native claims | credential invalid | existing generic 401 |

The current exchange service must preserve the existing identity-denied error category returned from provider verification rather than collapsing IDX 403 into infrastructure failure. No IDX HTTP body/status is copied to a public response.

## 4. Verified Identity, Admission, and Permissions

### 4.1 Closed IDX Trusted Material

The narrow extension is a discriminated, immutable `TrustedPermissionMaterial` variant, such as `idx-menu-detail/v1`, containing only a frozen list of validated semantic menu records:

```text
kind: idx-menu-detail/v1
menus: [{ menuId, actions }]
```

`actions` can contain only the fixed lowercase action set. It cannot contain raw MenuDetail objects, IDX UUIDs, native claims, unknown fields, arbitrary nested values, or response metadata. The validator consumes the raw response, validates allowed fields and Y operation values, derives the semantic records, freezes them, and lets the raw response fall out of scope. It is neither persisted nor included in audit events, diagnostics, errors, or telemetry.

The domain material validator and the managed permission pipeline are the exact Feature 005 interfaces that must change. They will accept the closed discriminated variant while retaining validation for the existing scalar material. The change remains provider-local because only IDX adapter/normalizer create or accept the `idx-menu-detail/v1` variant.

### 4.2 Provider-Trusted Permission Path

Add a third, explicit managed permission-policy mode, `provider_trusted`, for material produced by an admitted identity provider during the same verification exchange. It has these invariants:

- `permissionSourceInstanceId` is null; no Permission Source adapter is selected or called.
- A registered normalizer type and the existing projection contract are required.
- The admitted identity must contain exactly valid `idx-menu-detail/v1` material; absent, wrong-kind, or malformed material fails closed.
- Only the IDX normalizer may consume the IDX material kind.
- Existing `allow_empty` and `required` source-backed behavior remains unchanged.

This is preferable to modeling MenuDetail as a separate Permission Source: it prevents a second destination, avoids forwarding the native token, and proves permissions came from the same request that accepted the credential. A later implementation requires a migration to add the policy enum value and then updates lifecycle/readiness validation to enforce this closed mode.

### 4.3 IDX Normalization and Projection

The strict validator requires every accepted menu record to have a nonblank `MenuID`. It creates `read` for every menu and adds each operation whose value is exactly `Y`:

```text
Insert → insert     Update → update     Delete → delete
Print  → print      Import → import     Export → export
Copy   → copy       Approval → approval
```

The IDX normalizer sorts by `MenuID` and fixed action order (`read`, then the listed operations), removes duplicate `(menuId, action)` pairs, and yields existing `NormalizedPermission` values with `subject = menu:<MenuID>`. The existing generic scope projector emits `menu:<MenuID>:<action>` without Customer ID, integration ID, IDX UUID, UserType, or IsAdmin. This preserves deterministic scope ordering without altering generic projection behavior.

### 4.4 Admission and Replay Prevention

The selector resolves only the server-owned active exchange configuration. After IDX verifies the credential, existing exact admission evaluates that configuration's registered anchor requirement against the only IDX-produced anchor:

```text
selector B → configuration B → expected idx_entry B
IDX credential accepted for Entry A → verified idx_entry A
exact admission mismatch → no canonicalization, permission projection, or issuance
```

Neither selector, `UUID_Company`, nor any native permission/role claim can bypass this comparison. Customer resolution is still downstream and exclusively Feature 004's verified `integration_id` binding.

## 5. Readiness, Handoff, and Session Bootstrap

### 5.1 Runtime Readiness

The existing read-only Feature 005 readiness validator remains the runtime gate. It must consider an IDX integration ready only when all of the following are true:

1. The existing Feature 004 IntegrationBinding is enabled.
2. Exactly one active exchange configuration selects an enabled active `idx_delegated` Provider Instance.
3. The Provider Instance satisfies the fixed IDX contract, HTTPS public-destination policy, GET method, bearer placement, deadline bound, `idx-menu-detail/v1`, and sole `idx_entry` capability.
4. Exactly one active admission policy requires the expected `idx_entry` value.
5. Configured canonical HostApp and verified-organization mode are valid.
6. Exactly one active `provider_trusted` policy requires the registered IDX normalizer and existing scope projection contract.
7. Exactly one active managed issuer/key and exactly one compatible enabled Feature 004 trust profile exist.

This is provider/runtime readiness only. It does not claim a Customer deployment, provision secret material, invoke IDX, or decide Customer production readiness.

### 5.2 Managed Credential and Existing Session Route

Server-side integration evidence follows the existing path with no IDX-specific session route:

```text
IDX-managed canonical JWT
  → Feature 004 upstream verifier
  → exactly-one profile / IntegrationBinding Customer + HostApp admission
  → Gateway internal JWT
  → existing GatewayBackendClient create-session operation
  → POST /api/v1/assistant/sessions
  → sessionId
```

The test harness must use the real Feature 004 verifier and existing route/Backend client composition. It verifies only that Feature 006 output is accepted as another valid managed upstream JWT; it must not alter Feature 004 or Backend logic.

### 5.3 Host/SDK Contract

The final external contract is:

1. The Host authenticates the user through its existing IDX flow, selects or already owns the authorized Entry, and owns the current native IDX AccessToken and RefreshToken lifecycle.
2. The client obtains the current native AccessToken through the established opaque Host credential-provider callback. The callback is conceptual: no SDK interface or method name is defined here.
3. The client calls `POST /api/v1/identity/exchange` with `Authorization: Bearer <current native IDX AccessToken>` and body `{ "integrationSelector": "<provisioned selector>" }`.
4. Feature 005 validates the server-owned selected configuration and delegates the exact native credential once to its registered IDX protected endpoint. On success it returns a short-lived managed RS256 JWT.
5. The client stops using the native IDX AccessToken for Assistant authentication and calls existing `POST /api/v1/assistant/sessions` with `Authorization: Bearer <managed Feature 005 JWT>`.
6. Server-side only, Feature 004 verifies the managed JWT, resolves Customer and allowed HostApp through `integration_id → IntegrationBinding`, and Gateway creates its own internal identity JWT for Backend.
7. Backend performs the unchanged session operation and the client receives `sessionId`.

| Value | Owner and purpose | Allowed destination | Prohibited destination / use |
| --- | --- | --- | --- |
| Native IDX AccessToken | Host authentication system; exchange input only | `POST /api/v1/identity/exchange` | Assistant session route, Backend, Permission Source, and Feature 006 persistence |
| Managed Feature 005 JWT | Feature 005 managed identity exchange; short-lived upstream credential for Feature 004 | Existing authenticated Assistant Gateway APIs, including `POST /api/v1/assistant/sessions` | Backend; Gateway converts it to an internal identity JWT first. It contains canonical authority only and no Customer ID. |
| `sessionId` | Existing Assistant session system; conversation identifier | Existing authenticated session operations | Authentication, authorization, bearer credential, native-credential substitute, or managed-JWT substitute |

A `sessionId` alone grants no access; existing session requests still require an accepted authentication credential. No IDX-specific session endpoint is introduced.

When a managed JWT expires or a new managed credential is otherwise required, the client asks the opaque Host callback for the current native AccessToken and repeats exchange using the same provisioned selector. The server issues a new managed credential/JTI. Re-exchange itself does not create, destroy, or receive a `sessionId`; it renews authentication only. A new managed JWT may access an existing session only when the resolved identity and existing session authorization rules permit it. Phase 16 proved this continuity for the same accepted identity and scope; it does not override denials caused by identity, integration, Customer binding, HostApp, or session-authorization changes.

The selector is server-owned configuration selection only. It is not identity, Entry, Customer, endpoint, or permission authority. The client supplies neither endpoint URI, Entry override, Customer ID, nor permission mapping. The selected Provider Instance owns endpoint URI, GET method, bearer placement, contract version, timeout, and security policy; the verified `idx_entry` must still satisfy the selected admission policy.

Permissions are server-derived from the same accepted MenuDetail response and projected to `menu:<MenuID>:<action>` scopes. The client does not submit Assistant permissions or parse JWT `Permissions`, `Permission_Hash`, `UserType`, `IsAdmin`, or MenuDetail data to calculate roles/scopes. Customer is not supplied by the native credential, selector, `UUID_Company`, SDK, or Feature 005: Feature 004 alone resolves it through verified `integration_id → IntegrationBinding → customerId`.

The server credential transition is native IDX token → Feature 005 managed JWT → Feature 004 verified identity → Gateway internal JWT → Backend. Backend receives only the Gateway internal JWT; the SDK has no awareness of that internal credential.

#### Out of repository / future implementation

The authoritative SDK source/package is not present in this repository. Feature 006 therefore defines this integration contract only: it does not implement callback plumbing, SDK source, native AccessToken or RefreshToken persistence, native token refresh, browser storage, automatic managed-JWT renewal/retry scheduling, endpoint selection, a session manager, or Customer-specific SDK behavior. The Host owns credential lifecycle and storage according to its existing authentication system; the Assistant server, Feature 005, Feature 004, and this SDK contract do not receive or manage RefreshToken.

## 6. Security, Persistence, and Migration Impact

### Security Boundaries

- Native credential is forwarded once and only to a registered, validated IDX endpoint.
- IDX has no local ES512/JWKS/key verification, `kid` assumption, decode-only trust, or browser attestation path.
- No Permission Source receives native credential, authorization header, callback data, or raw native JWT.
- IDX material is semantically reduced immediately; raw MenuDetail payload, native token, claims, and response body are never persisted, logged, audited, returned, or placed in telemetry.
- Existing managed issuer remains distinct from Gateway internal signing. Feature 004 and Feature 002 stay unchanged.
- Provider source contains no Customer-specific selection, mapping, endpoint, secret, Entry UUID, or SCM behavior.

### Persistence and Migration Impact

Design creates no migration. Later implementation requires a limited migration to:

1. add `GET` to `ManagedHttpMethod`; and
2. add `provider_trusted` to `ManagedPermissionMode`.

No new Customer, IDX credential, raw MenuDetail, permission-payload, or SDK persistence table is needed. Existing Provider Instance, exchange config, admission policy, permission policy, issuer/key, and audit entities retain their ownership and lifecycle models.

## 7. Test Strategy and Rollout

Use production-shaped IDX fixtures with no live IDX dependency in CI. The implementation test matrix must cover:

- fixed GET/bearer/HTTPS contract validation and existing transport safety regressions;
- accepted-token-before-native-claim-parsing ordering;
- 401, 403, 500, 503, network, deadline, malformed-success, and application-code failures;
- strict identity claim consistency and no UserType/IsAdmin role inference;
- exact `idx_entry` admission and A-to-B selector replay denial;
- MenuDetail schema validation, implicit read, each supported action, deduplication, and deterministic scope ordering;
- closed trusted-material validation, direct provider-trusted normalization, and proof no Permission Source is invoked;
- no token/raw MenuDetail leakage in controller, audit, logging, telemetry, or errors;
- two IDX integrations sharing the adapter while retaining endpoint/Entry isolation;
- Feature 005 generic delegated-provider/direct-path regressions, Feature 004 compatibility, and real managed-JWT-to-existing-session-route coverage;
- re-exchange/session-continuity assertions only where existing Assistant API behavior can prove them; and
- full readiness fail-closed matrix.

Rollout is configuration-first: deploy the capability disabled; provision and validate an IDX Provider Instance, integration config, exact Entry admission policy, provider-trusted permission policy, managed issuer/key, Feature 004 trust profile, and IntegrationBinding; then enable the integration. A specific Customer is production-ready only after its separately provisioned endpoint, credentials, Host/SDK integration, and deployment validation succeed.

## Design Conclusion

`FEATURE006_DESIGN_READY=YES`  
`FEATURE005_BROADER_REDESIGN_REQUIRED=NO`  
`FEATURE004_MODIFICATION_REQUIRED=NO`
