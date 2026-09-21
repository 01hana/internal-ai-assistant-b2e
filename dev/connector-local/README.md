# Local connector HTTPS overlay

This development-only overlay keeps both product hops HTTPS while adapting to local HTTP endpoints outside the product runtime:

```text
Assistant Backend
  -> https://connector-runtime.local.test:3443
  -> Caddy
  -> http://host-local:3100

customer-connector-runtime
  -> https://shinmone-upstream.local.test:3444
  -> Caddy
  -> http://59.125.138.139
```

The runtime facade only admits `/health`, `/ready`, `/v1/connector/invocations`, and `/v1/internal/connector-bindings`. The Shinmone facade only admits `/APIs/SCM` and descendants and has a fixed upstream host. Callers cannot select another destination.

## 1. Choose the LAN address and hostnames

Find the active macOS LAN address (often `en0`, but verify it):

```sh
ipconfig getifaddr en0
```

Copy the local environment file and replace `192.168.x.x` with that address:

```sh
cp dev/connector-local/.env.example dev/connector-local/.env
```

Add matching `/etc/hosts` entries, using the same address:

```text
<LOCAL_LAN_IP> connector-runtime.local.test
<LOCAL_LAN_IP> shinmone-upstream.local.test
```

Do not use `127.0.0.1`; normal Connector destination readiness intentionally does not allow loopback.

## 2. Create project-scoped certificates

Install `mkcert` on macOS, but keep its CA out of the macOS trust stores:

```sh
brew install mkcert
mkdir -p .local-secrets/connector-local/tls
mkcert \
  -cert-file .local-secrets/connector-local/tls/local-facades.crt \
  -key-file .local-secrets/connector-local/tls/local-facades.key \
  connector-runtime.local.test shinmone-upstream.local.test
chmod 600 .local-secrets/connector-local/tls/local-facades.key
```

The `.local-secrets` directory and certificate/key extensions are ignored. Never commit the generated files.

Do not add the mkcert CA to the macOS System or login keychains. Trust it only for the process making the request. Launch Node processes with the CA explicitly, without weakening verification:

```sh
NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" npm run start:dev
```

Use the same `NODE_EXTRA_CA_CERTS` prefix when starting the Connector Runtime and Identity Bridge. For curl, pass `--cacert "$(mkcert -CAROOT)/rootCA.pem"` on every overlay request. Do not disable Node or application TLS certificate verification.

## 3. Generate local-only connector authority

Generate separate Central and Bridge binding keypairs, exact-schema local environment files, and a read-only copy of the checked-in manifest:

```sh
node dev/connector-local/generate-local-authority.mjs
```

Generated material is stored under ignored `.local-secrets/connector-local`. The local connector instance is `shinmone-scm-connector-local-1`; it is a development deployment identity, not the reference/test value or a production authority. The generated Central and Bridge keys are distinct and are not reused from fixtures.

The generated `backend.env` and `bridge.env` are configuration inputs for later local service restarts. Generating them does not activate a Tool or mint a Shinmone credential. A real executable binding must still come from the logged-in Bridge/IDX flow.

## 4. Start and verify the overlay

Build the existing Connector Runtime, start it with the production Shinmone registration and project-scoped CA, then start the overlay:

```sh
npm --prefix apps/customer-connector-runtime run build
PORT=3100 NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem" \
  node --env-file=.local-secrets/connector-local/runtime.env \
  dev/connector-local/start-runtime.mjs
docker compose --env-file dev/connector-local/.env -f dev/connector-local/docker-compose.yml up -d
```

Validate both certificate hostnames. `curl` performs normal CA and hostname verification using the project-scoped CA:

```sh
curl --head --cacert "$(mkcert -CAROOT)/rootCA.pem" \
  https://connector-runtime.local.test:3443/health
curl --head --cacert "$(mkcert -CAROOT)/rootCA.pem" \
  https://shinmone-upstream.local.test:3444/__overlay-check
```

Verify the harmless Connector Runtime health route through TLS:

```sh
curl --fail --cacert "$(mkcert -CAROOT)/rootCA.pem" \
  https://connector-runtime.local.test:3443/health
```

Verify that the Shinmone facade rejects paths outside its fixed hierarchy without contacting the legacy upstream:

```sh
curl --cacert "$(mkcert -CAROOT)/rootCA.pem" \
  --write-out '%{http_code}\n' --output /dev/null \
  https://shinmone-upstream.local.test:3444/__overlay-check
# expected: 404
```

Do not probe `/APIs/SCM/Dashboard/KPIStats` during this scaffold phase.

## Pre-generation schema examples

The snippets below are pre-generation schema examples, not the active local configuration or runnable credentials. Their `<UNRESOLVED_...>` placeholders illustrate the configuration shape before local authority generation; do not copy them into running services, copy test keys, or invent replacement values.

Generate the local authority with:

```sh
node dev/connector-local/generate-local-authority.mjs
```

After generation, these generated, ignored files are the actual local configuration authority:

- `.local-secrets/connector-local/runtime.env`
- `.local-secrets/connector-local/backend.env`
- `.local-secrets/connector-local/bridge.env`

The generator sets `connectorInstanceId` to `shinmone-scm-connector-local-1` and creates separate local Central service and Bridge binding authorities. Connector instance and local service-auth values are therefore resolved after generation. Do not print, expose, or commit the generated keys or secret values. A real Shinmone credential remains external and must be supplied through the logged-in Bridge/IDX flow.

### Central Backend

```dotenv
ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON=[{"version":"1","active":true,"customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorKey":"business","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>","operations":[{"key":"work-orders.monthly-new-count","version":"1.0.0"}]}]
ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON=[{"version":"1","customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorKey":"business","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>","active":true,"invocationUri":"https://connector-runtime.local.test:3443/v1/connector/invocations","serviceAuthProfileKey":"<UNRESOLVED_CENTRAL_SERVICE_AUTH_PROFILE_KEY>","destinationPolicy":{"mode":"allowlisted_networks","allowedCidrs":["<LOCAL_LAN_IP>/32"]},"maxRequestBytes":16384,"maxResponseBytes":16384,"maxTransportMs":4500}]
ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON=[{"profileKey":"<UNRESOLVED_CENTRAL_SERVICE_AUTH_PROFILE_KEY>","typ":"assistant-connector-service+jwt","subject":"<UNRESOLVED_CENTRAL_SERVICE_SUBJECT>","keyDomain":"<UNRESOLVED_CENTRAL_KEY_DOMAIN>","keys":[{"kid":"<UNRESOLVED_CENTRAL_KEY_ID>","status":"active","publicJwk":"<UNRESOLVED_PUBLIC_JWK>","privateKeyReference":"<UNRESOLVED_PRIVATE_KEY_REFERENCE>"}]}]
ASSISTANT_CONNECTOR_SERVICE_ISSUER=<UNRESOLVED_CENTRAL_SERVICE_ISSUER>
```

### Customer Connector Runtime

```dotenv
CONNECTOR_RUNTIME_CONTEXT_JSON=[{"customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>"}]
CONNECTOR_CENTRAL_TRUST_KEYS_JSON=[{"kind":"central-invocation","profileKey":"<UNRESOLVED_CENTRAL_SERVICE_AUTH_PROFILE_KEY>","typ":"assistant-connector-service+jwt","issuer":"<UNRESOLVED_CENTRAL_SERVICE_ISSUER>","subject":"<UNRESOLVED_CENTRAL_SERVICE_SUBJECT>","audience":"<UNRESOLVED_CENTRAL_AUDIENCE>","keyDomain":"<UNRESOLVED_CENTRAL_KEY_DOMAIN>","trustedContext":{"customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>"},"keys":[{"kid":"<UNRESOLVED_CENTRAL_KEY_ID>","status":"active","publicJwk":"<UNRESOLVED_PUBLIC_JWK>"}]}]
CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON=[{"kind":"binding-bootstrap","profileKey":"BRIDGE_BINDING_TRANSPORT_V1","typ":"assistant-connector-binding+jwt","issuer":"<UNRESOLVED_BRIDGE_BINDING_ISSUER>","subject":"<UNRESOLVED_BRIDGE_BINDING_SUBJECT>","audience":"<UNRESOLVED_BRIDGE_BINDING_AUDIENCE>","keyDomain":"<UNRESOLVED_BRIDGE_BINDING_KEY_DOMAIN>","trustedContext":{"customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>"},"keys":[{"kid":"<UNRESOLVED_BRIDGE_BINDING_KEY_ID>","status":"active","publicJwk":"<UNRESOLVED_PUBLIC_JWK>"}],"providerKey":"shinmone-idx-bootstrap-v1"}]
CONNECTOR_CREDENTIAL_PROFILES_JSON=[{"credentialProfileRef":"shinmone-idx-bearer-v1","credentialProviderKey":"shinmone-idx-bootstrap-v1","applicationStrategyKey":"shinmone-fixed-bearer-v1","credentialKind":"bearer-v1"}]
CONNECTOR_UPSTREAMS_JSON=[{"upstreamServiceRef":"shinmone-scm-api","origin":"https://shinmone-upstream.local.test:3444","basePath":"/APIs/SCM","addressMode":"allowlisted_networks","allowedCidrs":["<LOCAL_LAN_IP>/32"]}]
CONNECTOR_MANIFEST_FILES=["<ABSOLUTE_READ_ONLY_MOUNTED_MANIFEST_PATH>"]
```

The configured upstream origin is HTTPS. Only Caddy owns the final HTTP hop to `59.125.138.139`.

### Identity Bridge binding client

```dotenv
BRIDGE_CONNECTOR_BINDING_URI=https://connector-runtime.local.test:3443/v1/internal/connector-bindings
BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY={"mode":"allowlisted_networks","allowedCidrs":["<LOCAL_LAN_IP>/32"]}
BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON={"customerId":"customer-shinmone-scm-local","integrationId":"shinmone-scm-assistant-local","hostApp":"shinmone-scm","connectorInstanceId":"<UNRESOLVED_CONNECTOR_INSTANCE_ID>","bootstrapProfileKey":"BRIDGE_BINDING_TRANSPORT_V1","providerKey":"shinmone-idx-bootstrap-v1"}
BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON=<UNRESOLVED_BRIDGE_BINDING_SERVICE_AUTH_JSON>
BRIDGE_BINDING_REQUEST_TIMEOUT_MS=2000
```

## Production transition

Production requires configuration replacement only:

- replace `https://connector-runtime.local.test:3443` with the real customer Connector Runtime HTTPS origin;
- replace `https://shinmone-upstream.local.test:3444` with the real Shinmone HTTPS API origin;
- replace local CIDR policy values with the deployment-owned production policy;
- supply approved trust profiles, key references, connector instance, and credential bootstrap values.

No product HTTP mode or TLS-verification bypass is part of this overlay.
