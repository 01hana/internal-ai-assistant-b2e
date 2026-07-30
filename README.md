# Internal Backend AI Assistant Core

NestJS + TypeScript backend service for the v1 internal assistant core.

## Gateway Integration Boundary

`apps/gateway` is a separately deployable NestJS service in this monorepo. It
validates the customer-system JWT, derives `hostApp` only from its configured
`azp`/`client_id` registry, signs a five-minute internal identity JWT, and
proxies the unchanged `/api/v1/*` request to Backend 001. It never returns the
internal JWT to the browser.

The customer system should expose a same-origin reverse-proxy route such as
`/api/internal-assistant/*` to Gateway's `/api/v1/*`. The SDK should call the
customer-relative route, not Backend 001 or Gateway's public hostname.

Gateway requires the customer token claims `sub`, `org_id`, `role`, a non-empty
`scope` string (or `permission_scopes` string array), and `azp` or `client_id`.
`GATEWAY_CLIENT_REGISTRY_JSON` maps that verified client identifier to the only
permitted `hostApp` value.

Generate a development-only Gateway signing key, then store its base64 PKCS#8
value in your untracked `.env`:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out gateway-private.pem
base64 < gateway-private.pem | tr -d '\n'
```

For Compose, start the Gateway profile after configuring the `GATEWAY_*` values.
Backend 001 must use the matching values below:

```env
INTERNAL_IDENTITY_JWT_ISSUER=http://gateway:4000
INTERNAL_IDENTITY_JWT_AUDIENCE=internal-ai-assistant
INTERNAL_IDENTITY_JWKS_URI=http://gateway:4000/.well-known/jwks.json
```

```sh
docker compose --profile gateway up --build -d
```

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

All assistant routes require a Gateway-signed internal identity JWT. The
browser/frontend sends the customer-system access token only to Gateway;
Gateway validates it, removes any client-provided identity headers, maps its
trusted claims to the contract below, and forwards a short-lived RS256 token
as `Authorization`. Do not send the customer-system JWT directly to Backend.

The internal JWT must have the configured `iss` and `aud`, be signed with a
key published by `INTERNAL_IDENTITY_JWKS_URI`, and include `sub`, `org_id`,
`role`, `permission_scopes` (non-empty string array), `host_app`, `jti`,
`iat`, and `exp`. Gateway derives `host_app` from its verified
`azp`/`client_id` allowlist; the frontend never supplies it.

```sh
export INTERNAL_IDENTITY_JWT='<Gateway-signed internal JWT>'
ASSISTANT_AUTH=(-H "Authorization: Bearer ${INTERNAL_IDENTITY_JWT}")
```

Create a session with the page context required for a structured order lookup.
Copy the returned `data.sessionId` into `SESSION_ID`.

```sh
curl -sS -X POST http://localhost:3000/api/v1/assistant/sessions \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-session-orders' \
  "${ASSISTANT_AUTH[@]}" \
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
  "${ASSISTANT_AUTH[@]}" \
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
  "${ASSISTANT_AUTH[@]}" \
  --data '{}'

export DOCUMENT_SESSION_ID='<data.sessionId>'
```

Then send the SOP question:

```sh
curl -N -X POST "http://localhost:3000/api/v1/assistant/sessions/${DOCUMENT_SESSION_ID}/messages" \
  -H 'content-type: application/json' \
  -H 'x-request-id: req-smoke-return-sop' \
  "${ASSISTANT_AUTH[@]}" \
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
  "${ASSISTANT_AUTH[@]}" \
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
