# Internal Backend AI Assistant Core

NestJS + TypeScript backend service for the v1 internal assistant core.

## v1 Scope Exclusions

- No full admin UI or generic CRUD back office.
- No real ERP, MES, WMS, SCM, or CRM connector.
- No frontend SDK or embeddable widget.
- No production deployment, Kubernetes, Helm, or CI/CD baseline in this feature.

## Local Quickstart

1. Create local environment values:

   ```sh
   cp .env.example .env
   ```

   The v1 LLM provider defaults to `LLM_PROVIDER=openai`; `LLM_MODEL` selects the model for that provider, and OpenAI credentials stay provider-specific in `OPENAI_API_KEY`.

2. Install dependencies:

   ```sh
   npm install
   ```

3. Start local app and PostgreSQL:

   ```sh
   docker compose up
   ```

4. Run Prisma commands:

   ```sh
   npm run prisma:generate
   npm run prisma:migrate
   npm run prisma:seed
   npm run test:db:init
   ```

5. Run tests:

   ```sh
   npm run test
   npm run test:integration
   npm run test:contract
   npm run test:e2e
   npm run test:eval
   ```

6. SSE smoke testing baseline:

   Phase 1 only establishes the app skeleton. After the assistant message endpoint is implemented, use a command like:

   ```sh
   curl -N -H "x-request-id: req-smoke" http://localhost:3000/assistant/sessions/{sessionId}/messages
   ```

## Docker Compose

`docker compose up` starts:

- `app`: NestJS backend service
- `postgres`: PostgreSQL for local Prisma migration and tests
- `redis`: optional profile reserved for queue, backpressure, and rate limiting

Enable Redis only when needed:

```sh
docker compose --profile redis up
```

## Secrets

- Do not commit `.env`.
- `.env.example` is committed for placeholders only.
- Do not place real OpenAI API keys, database credentials, connector secrets, customer data, or internal transaction data in README, test fixtures, audit metadata, or error logs.
- Runtime secrets must come from local `.env`, CI/CD secrets, or a secret manager.
