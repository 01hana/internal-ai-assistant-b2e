# Internal Backend AI Assistant Core

NestJS + TypeScript backend service for the v1 internal assistant core.

## Local Quickstart

### Prerequisites

- Node.js 22+
- npm
- Docker and Docker Compose
- PostgreSQL supplied by Docker Compose
- Prisma CLI through the repository npm scripts

### Environment Setup

Create local environment files without committing them:

```sh
cp .env.example .env
cp .env.example .env.test
```

`.env` is for the Compose app container. Keep its `DATABASE_URL` host as
`postgres`, because that hostname is resolved inside the Compose network.
Configure `.env.test` for a separate local test database and set
`ALLOW_TEST_DB_RESET=true` before running `npm run test:db:init`.

The tracked `.env.example` contains placeholders only. Do not commit `.env`
or `.env.test`, and never place real OpenAI API keys, connector secrets,
database credentials, production `DATABASE_URL` values, or customer data in
README files, fixtures, audit metadata, error responses, or logs.

### Gateway Local Integration

The browser-facing Gateway is a separate built process; it is not Backend
`localhost:3000`. Export the required `GATEWAY_*` values, including explicit
`GATEWAY_ALLOWED_ORIGINS` (for example `http://localhost:3001`) and
`GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED=true`. Its internal issuer/audience
and public JWKS URL must align with Backend `INTERNAL_IDENTITY_*` values, and
`GATEWAY_BACKEND_BASE_URL` must target the Backend listener.

Keep a local RSA private key only under ignored `.gateway-local-keys/` and set
`GATEWAY_SIGNING_KEY_REFERENCE` to its `file:` URL or relative path. Build and
start Gateway, then run its local-only lifecycle bootstrap in a second shell:

```sh
npm run build:gateway
npm --prefix apps/gateway run start
npm --prefix apps/gateway run signing:bootstrap:local
```

The bootstrap command is enabled only for `NODE_ENV=development` or `test` and
uses the existing `new → published → JWKS proof → active` lifecycle. It is
local development evidence only: it does not close Feature 003 GAP-001–GAP-004
or change the production rollout decision.

### Gateway Profile-only Upstream Trust

Gateway verifies browser `Authorization` credentials only against persisted
`RegisteredUpstreamTrustProfile` records. Runtime startup fails closed unless
storage contains at least one enabled, `active`, RS256 profile with a valid
issuer, audience, and registered JWKS policy. The runtime setting
`GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS` is platform-wide, must be an
integer from 0 through 300 seconds, and is not stored per profile.

`GATEWAY_UPSTREAM_JWT_ISSUER`, `GATEWAY_UPSTREAM_JWT_AUDIENCE`, and
`GATEWAY_UPSTREAM_JWKS_URI` are optional bootstrap-only migration inputs. They
are not required for profile-only runtime, including when absent or partially
present, and are never a verifier fallback. A complete legacy trio is required
only when an operator invokes `BootstrapLegacyUpstreamTrustProfileCommand` as a
deployment-controlled command/service operation; Gateway startup never invokes
it automatically.

To migrate one legacy upstream policy, first provision the existing
`IntegrationBinding`, then provide the complete legacy trio and explicitly
supply its `integrationId` to that controlled bootstrap operation. The anchor
is never inferred from a JWT, issuer, audience, JWKS URI, Customer, or HostApp.
Verify that an enabled, active `RegisteredUpstreamTrustProfile` was persisted,
then roll out profile-only Gateway runtime. The legacy trio may be removed from
normal deployment configuration after bootstrap.

A trust profile owns upstream verification policy only. After profile
verification, the request continues through `VerifiedUpstreamIdentity` and
`CanonicalIdentityResolver`; the existing `IntegrationBinding` remains the
sole Customer and HostApp admission authority before internal JWT issuance and
Backend access. Profiles contain neither `customerId` nor `allowedHostApp`.

Profile disablement changes `enabled=true, lifecycle=active` to
`enabled=false, lifecycle=disabled` and does not change
`IntegrationBinding.enabled`. Issuer migration uses a controlled atomic
replacement from an active predecessor plus draft successor to a replaced,
disabled predecessor plus active successor. V1 has no dual-issuer authority
window; normal signing-key rotation remains within one issuer/profile JWKS.

Bootstrap JWKS URIs still undergo the production registration policy: HTTPS is
required, credentials and fragments are rejected, unsafe local/private
destinations are rejected, and redirects are not trusted as a new source.
Deployment configuration does not bypass those checks.

Candidate policy records use a process-local trust-profile cache with a
30-second default and 60-second maximum TTL. Control-plane mutations invalidate
it; a process restart reloads records from storage, and an expired cache entry
whose storage refresh fails is not served. This cache contains neither JWKS
verification keys nor IntegrationBinding, Customer, or canonical identity data;
JWKS caching remains profile-scoped and IntegrationBinding reads remain direct
database reads in v1.

### Start the Local Baseline

Install dependencies and start the local app and database:

```sh
npm install
docker compose up --build -d
docker compose ps
```

Docker Compose is only the local development and test baseline. It is not a
production deployment design. Redis is optional and profile-based:

```sh
docker compose --profile redis up -d
```

The app container connects to PostgreSQL at `postgres:5432`. Commands run
from the host must use the mapped port `localhost:5435` instead. Before host
Prisma commands, use a local-only URL shaped like:

```sh
export DATABASE_URL='postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5435/<POSTGRES_DB>'
```

Then generate the client, apply local migrations, and load deterministic tool
and document fixtures:

```sh
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

Initialize the isolated test database separately. This command loads
`.env.test` first and is destructive only when its explicit safety guard is
enabled:

```sh
npm run test:db:init
```

## Health And Readiness Smoke

The infrastructure endpoints do not require identity headers. They return the
standard response envelope and preserve the supplied request ID.

```sh
curl -H 'x-request-id: req-smoke-health' http://localhost:3000/api/v1/health
curl -H 'x-request-id: req-smoke-readiness' http://localhost:3000/api/v1/readiness
```

Readiness reports `database`, `llm`, `retrieval`, `connector`, and
`approval_workflow`. The overall and dependency statuses are `healthy`,
`degraded`, or `unavailable`; reasons are safe reason codes rather than raw
dependency errors.

## Assistant SSE Smoke

All assistant routes require identity headers. The examples below use local
mock identities and must not be copied into a production integration.

```sh
ASSISTANT_HEADERS=(
  -H 'x-actor-id: actor-001'
  -H 'x-host-app: erp'
  -H 'x-organization-id: org-001'
  -H 'x-role: planner'
  -H 'x-permission-scopes: orders:read'
)
```

Create a session with the page context required for a structured order lookup.
Copy the returned `data.sessionId` into `SESSION_ID`.

```sh
curl -sS -X POST http://localhost:3000/api/v1/assistant/sessions \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-session-orders' \
  "${ASSISTANT_HEADERS[@]}" \
  --data '{
    "pageContext": {
      "module": "orders",
      "entityType": "order",
      "entityId": "SO-10001",
      "visibleColumns": ["status", "customerName"]
    }
  }'

export SESSION_ID='<data.sessionId>'
```

### Mock Connector Structured Lookup

```sh
curl -N -X POST "http://localhost:3000/api/v1/assistant/sessions/${SESSION_ID}/messages" \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-order-lookup' \
  "${ASSISTANT_HEADERS[@]}" \
  --data '{"message":"請查 SO-10001 訂單狀態"}'
```

The SSE sequence includes `tool_call_started`, `tool_call_completed`,
`evidence_attached`, `answer_delta`, and `final`. The final payload has
`answerDecision: answered` and non-empty structured-record `evidenceRefs`.

### Document Retrieval Smoke

Create a fresh session with the same identity headers, then ask a document
question after `npm run prisma:seed` has loaded the SOP fixtures. Copy the
returned `data.sessionId` into `DOCUMENT_SESSION_ID`:

```sh
curl -sS -X POST http://localhost:3000/api/v1/assistant/sessions \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-session-documents' \
  "${ASSISTANT_HEADERS[@]}" \
  --data '{}'

export DOCUMENT_SESSION_ID='<data.sessionId>'
```

Then send the SOP question:

```sh
curl -N -X POST "http://localhost:3000/api/v1/assistant/sessions/${DOCUMENT_SESSION_ID}/messages" \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-return-sop' \
  "${ASSISTANT_HEADERS[@]}" \
  --data '{"message":"退貨流程 SOP 怎麼說？"}'
```

This path creates a `RetrievalRun` and `RetrievalCandidate` records. It does
not emit `tool_call_started`; its final payload is `answered` only when it
contains `document_chunk` evidence.

### Safe No-Answer Smoke

```sh
curl -N -X POST "http://localhost:3000/api/v1/assistant/sessions/${SESSION_ID}/messages" \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-order-missing' \
  "${ASSISTANT_HEADERS[@]}" \
  --data '{"message":"請查 SO-99999 訂單狀態"}'
```

The final payload must be `no_answer`, with `noAnswerReason` such as
`tool_failure` or `no_evidence`, and `evidenceRefs: []`. The outcome is
traceable through a ReviewItem or audit event; it must not fabricate an order
status.

## Docker Local Smoke Checklist

Use this checklist for T126 when Docker is available locally:

- [ ] `docker compose up --build -d` starts `app` and healthy `postgres`.
- [ ] `docker compose ps` shows the local services running; Redis remains off
  unless the optional `redis` profile was requested.
- [ ] Host Prisma commands use `localhost:5435`; the container app uses
  `postgres:5432`.
- [ ] `npm run prisma:migrate`, `npm run prisma:seed`, and `npm run test:db:init`
  complete against their intended local databases.
- [ ] `/api/v1/health` returns `healthy` and `/api/v1/readiness` reports a
  database dependency status.
- [ ] The structured lookup smoke returns evidence-grounded SSE output.
- [ ] The SOP smoke uses document retrieval rather than a structured tool.
- [ ] The missing-order smoke returns a safe no-answer response.

## Tests

```sh
npm run test
npm run test:integration
npm run test:contract
npm run test:e2e
npm run test:eval
```

## v1 Scope Exclusions

The detailed delivery boundary and non-negotiable safety checks live in
[docs/regression-scope-checklist.md](docs/regression-scope-checklist.md).
