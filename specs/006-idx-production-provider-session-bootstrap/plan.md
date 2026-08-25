# Feature 006 — IDX Production Provider Session Bootstrap Implementation Plan

**Feature**: `006-idx-production-provider-session-bootstrap`  
**Status**: Implementation plan — no implementation in this batch  
**Authority order**: Constitution 2.0.0 → Feature 006 `spec.md` → Feature 006 `design.md` → this plan → accepted Feature 005 and Feature 004 contracts.

## 1. Implementation Context

Feature 006 production-enables the reusable `idx_delegated` provider capability through Feature 005's existing managed identity exchange. Its fixed authority sequence is:

```text
native IDX AccessToken
  → registered IDX MenuDetail verification
  → verified IDX identity + constrained menu material
  → existing exact-entry admission
  → existing canonicalization and managed issuer
  → unchanged Feature 004 trust/profile/binding chain
  → existing /api/v1/assistant/sessions route
```

Feature 005 broader redesign: **NO**.  
Feature 005 additive provider/permission extension: **YES**.  
Feature 004 production modification: **NO**.

Feature 004 remains the exclusive owner of managed-upstream JWT verification, exactly-one trust profile decision, `IntegrationBinding.integrationId → customerId`, `allowedHostApp`, and Gateway internal JWT issuance. Feature 006 does not modify Feature 002, Customer authority, the existing session route, or SDK source.

## 2. Additive Contracts and Persistence

### Public and internal contracts

| Contract | Additive behavior | Existing behavior retained |
| --- | --- | --- |
| Provider tuple | `idx_delegated` + `idx-menu-detail/v1` + HTTPS `GET` + bearer + JSON + `idx_entry` | `delegated_http` + `delegated-http/v1` remains HTTPS `POST` + bearer + JSON |
| Provider result | IDX adapter yields a verified identity only after MenuDetail accepts the exact native credential | Generic delegated adapter result is unchanged |
| `TrustedPermissionMaterial` | Closed immutable `idx-menu-detail/v1` semantic menu records | Existing scalar `kind`/`reference`/`values` material remains valid |
| Permission mode | `provider_trusted`: direct, admitted provider material; no Permission Source call | `allow_empty` and `required` retain their accepted semantics |
| Public exchange errors | Existing generic 401/403/503 projection | No raw IDX body, status diagnostics, token, or MenuDetail payload disclosure |

### Migration scope

Create one additive root Prisma migration extending only:

- `ManagedHttpMethod`: add `GET` while retaining `POST`.
- `ManagedPermissionMode`: add `provider_trusted` while retaining `allow_empty` and `required`.

No table, Customer model, native-token field, MenuDetail payload field, SDK model, or audit-payload field is added. Existing migration lineage, active-state constraints, versioning, and replacement semantics remain intact.

## 3. Dependency-Ordered Implementation Batches

### Batch A — Failing-first contract and migration coverage

1. Add focused tests for the fixed IDX tuple, GET request execution, existing POST regression, closed material rejection, provider-trusted no-source behavior, and readiness failures before runtime implementation changes.
2. Add migration-backed tests proving existing Provider Instance and permission-policy values remain valid after enum extension.
3. Add the additive enum migration, update Prisma schema/generated client, and validate/generate Prisma artifacts.

**Gate**: Current Feature 005 paths pass unchanged; `GET` and `provider_trusted` are representable but no IDX configuration becomes ready until later batches register the fixed contract.

### Batch B — Fixed IDX contract and safe GET transport

1. Extend provider-contract, activation, and endpoint policy allowlists to accept exactly:
   `idx_delegated`, `idx-menu-detail/v1`, `GET`, `authorization_bearer`, JSON, and declared `idx_entry` only.
2. Extend the existing delegated transport request-method type and execution path to use the validated stored method. Preserve one credential forward, HTTPS-only policy, pre-request DNS check, connection-time DNS check, redirect denial, JSON content type, 256 KiB body bound, 5-second maximum deadline, and no retry.
3. Preserve `delegated_http/v1` POST tests byte-for-byte in behavior; no generic method/header/URL configuration is introduced.
4. Preserve typed result distinctions: transport returns credential invalid for 401, identity denied for 403, and infrastructure unavailable for 500/503/network/deadline/unsafe/malformed transport conditions. Update exchange orchestration only to retain the existing denial category rather than collapsing it.

**Gate**: IDX credentials can reach only a fixed registered GET endpoint, once; the generic delegated provider remains unchanged.

### Batch C — IDX adapter, response validation, and identity material

1. Replace the disabled IDX adapter with a provider-local implementation using the hardened transport and active IDX contract registry entry.
2. Add a strict MenuDetail validator: require successful HTTP/JSON transport, application `Code == 200`, valid `Data` array, nonblank `MenuID`, and only supported MenuPermission operation values. Reduce valid records immediately to frozen semantic `{ menuId, actions }` values.
3. Parse the exact native JWT only after MenuDetail validation. Require nonblank `sub`, `UUID_User`, `UUID_Company`, and `UUID_Entry`; require `sub === UUID_User`; create subject, organization, and sole `idx_entry` anchor.
4. Do not locally validate ES512, select keys/JWKS, trust token times alone, derive roles from `UserType`/`IsAdmin`, or use native `Permissions`/`Permission_Hash` as authority.
5. Extend the domain material constructor/validator to a discriminated `idx-menu-detail/v1` variant. Permit only normalized semantic records/actions; reject UUIDs, raw claims, native credential, HTTP data, metadata bags, unknown keys, and arbitrary nested payloads.

**Gate**: Validated MenuDetail is reduced before it leaves the adapter; raw response/token data has no persistence, audit, log, error, telemetry, or Permission Source path.

### Batch D — Provider-trusted permissions, admission, and readiness

1. Extend activation and policy validation for `provider_trusted`: `permissionSourceInstanceId` must be null; registered IDX normalizer and existing projection contract are mandatory; source-backed configuration is rejected.
2. Extend `ManagedPermissionService` to consume only admitted identity material for this mode and never resolve or invoke a Permission Source. Missing, wrong-kind, or invalid material fails closed.
3. Add the IDX normalizer. For each `MenuID`, emit `read`, then enabled `insert`, `update`, `delete`, `print`, `import`, `export`, `copy`, and `approval`; sort by MenuID plus fixed action order and deduplicate before using the existing generic scope projector.
4. Reuse existing exact verified-anchor admission unchanged. Provisioned `idx_entry` requirements compare against the adapter-produced anchor; selector A with Entry A cannot satisfy selector B's Entry B policy.
5. Register the adapter and normalizer in module composition; extend readiness so an IDX integration requires active binding/config/provider, exact IDX contract/anchor, valid HostApp/organization strategy, valid provider-trusted policy/normalizer/projection, active issuer/key, and one compatible Feature 004 trust profile. Readiness remains read-only and makes no IDX call.

**Gate**: IDX permissions use only validated same-request material, `permission_scopes` are deterministic `menu:<MenuID>:<action>`, and no selector replay can cross integrations.

### Batch E — End-to-end evidence, rollout, and documentation

1. Add production-shaped fixture integration coverage: native IDX fixture → exchange → managed JWT → real Feature 004 verifier/profile/binding → Gateway internal identity → existing Backend create-session operation → `sessionId`.
2. Add Host/SDK contract documentation only: Host opaque current-token callback → exchange → managed JWT → existing session endpoint; re-exchange when managed credential expires. Do not create SDK files, store native tokens, or handle RefreshTokens.
3. Record deployment order: deploy additive migration and dormant capability; provision Provider Instance, exchange config, Entry admission policy, provider-trusted policy, managed issuer/key, TrustProfile, and IntegrationBinding; execute readiness; enable each integration separately.
4. Roll back by disabling/replacing the IDX Provider Instance or exchange configuration/policies. Existing direct Feature 004, generic delegated provider, and prior `allow_empty`/`required` integrations remain operational; do not remove enum values or alter existing configuration during rollback.

## 4. Test Strategy and Acceptance Gates

| Area | Required evidence |
| --- | --- |
| Migration | Enum extension applies cleanly; old `POST`, `allow_empty`, and `required` records/readiness behavior remain valid; no new sensitive persistence exists. |
| Provider/transport | Fixed IDX GET tuple passes; unknown tuple/GET generic provider fails; POST generic regression, HTTPS/SSRF/DNS/rebinding/redirect/bounds/deadline/no-retry remain enforced. |
| Verification | Endpoint acceptance occurs before claim parsing; 401, 403, 500, 503, network, deadline, malformed HTTP success, `Code != 200`, and invalid native claims use the required typed/public outcomes. |
| Identity/admission | `sub`/`UUID_User` mismatch, missing Company/Entry, and selector A→B Entry replay issue no managed JWT. |
| Permissions | MenuDetail schema rejection, implicit read, all eight Y operations, deterministic ordering/deduplication, no UUID/Customer/integration/role data in scopes, and closed-material rejection. |
| Boundary safety | No Permission Source invocation in `provider_trusted`; no raw token/MenuDetail logging, audit, persistence, telemetry, public response, or static forbidden import. |
| Compatibility | Two independently provisioned IDX integrations reuse the adapter; Feature 005 non-IDX suites and direct Feature 004 route remain green. |
| Session | Managed IDX JWT traverses real Feature 004 and existing `/api/v1/assistant/sessions`; re-exchange preserves session semantics where supported by existing API behavior. |
| Readiness | Every missing/disabled/ambiguous IDX prerequisite fails closed without external IDX calls or Customer deployment inference. |

CI uses fixtures only; no external IDX production endpoint, Customer domain, credential, Entry UUID, selector, or SDK repository is required.

## 5. Verification and Completion

Run the focused IDX/provider/permission/readiness/session suites, then the full Feature 005 managed-exchange regression and Feature 004 direct/compatibility regression. Use the existing registry DB-test helper and `RUN_GATEWAY_REGISTRY_DB_TESTS=true` for migration/readiness evidence.

Run the Prisma validate/generate gate and these final commands after implementation:

```text
npx prisma validate
npm run prisma:generate
npm run typecheck
npm run lint
npm run build
npm run build:gateway
npm --prefix apps/gateway run test:unit
git diff --check
```

Run the required DB-backed/root regression selection and record any skips with an explicit reason; no required IDX, Feature 005, or Feature 004 acceptance suite may be skipped. Complete source/redaction guards and preserve safe public error assertions before declaring provider capability ready.

## 6. Constitution Check

- **Trusted identity boundary**: PASS. IDX claims become usable only after protected endpoint acceptance; Customer authority remains Feature 004.
- **Customer isolation**: PASS. No Customer model/value or Customer-specific branch is added; existing binding and Backend scope remain downstream.
- **Security/audit**: PASS. Native credentials and raw MenuDetail payloads are one-hop/transient only and excluded from logs, audit, persistence, telemetry, and public errors.
- **API/embedability**: PASS. Existing exchange/session APIs and opaque Host credential-provider contract are preserved; no SDK implementation is fabricated.
- **Testing/regression**: PASS subject to the ordered focused, DB-backed, direct-path, and full regression gates above.

FEATURE006_PLAN_READY=YES
FEATURE005_BROADER_REDESIGN_REQUIRED=NO
FEATURE005_ADDITIVE_EXTENSION_REQUIRED=YES
FEATURE004_MODIFICATION_REQUIRED=NO
