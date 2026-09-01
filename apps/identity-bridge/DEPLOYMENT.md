# Identity Bridge deployment

The Identity Bridge image is independent from Gateway and has no database. Customer and environment authority comes only from deployment configuration and read-only secret mounts; changing those values never requires a Customer-specific source branch.

## Local pre-Phase-10 rehearsal

From the repository root:

```sh
npm --prefix apps/identity-bridge run local:bootstrap
cd apps/identity-bridge
docker compose config
docker compose up --build -d
npm run local:verify
```

The bootstrap creates persistent local-only material under `.local-secrets/identity-bridge/`. It never runs during `docker compose up`, so an ordinary restart cannot replace the signing key. The Bridge private key, local CA, and proxy certificate/key are mounted read-only and are not part of either image.

The local template intentionally contains `BRIDGE_IDX_ALLOWED_ENTRIES=["<REPLACE_WITH_ACTUAL_ENTRY_UUID>"]`. This is sufficient only for configuration/runtime readiness. The verification command detects it and reports `REAL_IDX_LOCAL_EXCHANGE=NOT_RUN`; it is never real Customer admission evidence. To test real IDX, an authorized operator must place actual allowed Entries in an ignored local environment file and supply the current native AccessToken interactively to separately reviewed tooling. Tokens must never be placed in commands, files, logs, fixtures, or documentation.

For the first-Customer local evidence run, `compose.yaml` layers the ignored optional `env/local.env` after `env/local.env.example` and before the generated signing environment. The local override contains only deployment configuration such as the exact allowed-entry JSON array; it must not contain tokens or private keys. Recreate the Bridge container after changing it, then run from the repository root:

```sh
npm --prefix apps/identity-bridge run local:verify:idx
```

The verifier accepts no command-line token, token environment variable, file input, query parameter, or browser storage access. It prompts on an interactive terminal with echo disabled and submits the entered bearer once to the local Bridge with an empty request body. It prints only normalized boolean/stage markers, validates the returned canonical JWT in memory, and checks Compose logs without displaying either credential. A successful local run proves only the selected SCM Entry token's path through real MenuDetail and local issuance; it does not settle the broader Entry authority model or begin Phase 10.

For a local-only same-token diagnostic, that same command first sends the one interactively supplied bearer to the Customer's existing legacy HTTP MenuDetail route, then sends the exact in-memory string to the local Bridge exchange. The direct request is tooling-only, is bounded to 12 seconds, and reports only the HTTP status plus whether a `200` JSON response has application `Code: 200`; it does not add HTTP support or a diagnostic branch to Bridge runtime. The final `SAME_TOKEN_DIAGNOSIS` marker compares the two outcomes without printing a token, claims, response body, or canonical JWT.

The local IDX upstream is HTTP, but Bridge production transport remains HTTPS-only. `idx-proxy.local` terminates locally trusted TLS and forwards only the fixed MenuDetail GET to the configured HTTP upstream. The Bridge validates the proxy's deterministic Docker address through its existing `allowlisted_networks` policy and trusts only the explicitly mounted development CA through `NODE_EXTRA_CA_CERTS`; TLS verification is never disabled.

The configured local `BRIDGE_JWKS_PUBLIC_URI` is syntax-only metadata. The host smoke endpoint does not prove central Feature 004 reachability or trust.

Stop the rehearsal with `docker compose down`. The persistent local key and certificates remain outside containers for the next start.

## Same-image promotion

| Environment | Image | Deployment inputs |
| --- | --- | --- |
| Local | Built Identity Bridge image | `env/local.env.example`, local signing secret, local CA, deterministic network, and local HTTPS IDX proxy |
| Staging | Same image | Operator-approved staging template values, staging signing secret, Customer ingress/public JWKS route, and actual HTTPS IDX endpoint or approved Customer-local proxy |
| Production | Same image | Approved production values, production signing secret, production networking/ingress, and production HTTPS IDX route |

Staging and production must replace every marker in their templates. Local keys, local CA material, local issuer/audience/integration values, synthetic JWKS URI, Docker CIDR, and proxy assumptions must never be promoted. Feature 004 provisioning and real central JWKS retrieval remain Phase 10 human-controlled work.

## Container contract

- Runtime routes remain `GET /health`, `GET /ready`, `GET /.well-known/jwks.json`, and `POST /identity/exchange`.
- The image runs only `node dist/main.js` as the non-root `node` user and exposes port 3000.
- `/ready` validates local composition and key/JWKS consistency without calling IDX, Customer Authentication, Gateway, or Backend.
- The local proxy disables access logs, body persistence/buffering, redirects, and retries for the sensitive route.
- No native token, private key, Customer authority, Entry discovery, or Customer-specific branch is added by this deployment tooling.
