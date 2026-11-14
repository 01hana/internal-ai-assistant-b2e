#!/usr/bin/env bash
# 在主機上產生 core / gateway / bridge / connector 四份 env，並讓跨服務的 issuer、audience、kid 一致。
# 需先執行過 host-init.sh。已存在的 env 不覆蓋（要重產請先手動改名舊檔）。
# 用法：PUBLIC_ORIGIN=https://<公開網域> ENTRY_UUID=<Shinmone token 的 UUID_Entry> LLM_MODEL=<模型名稱> bash host-config.sh
# OPENAI_API_KEY 不經過這支腳本，請產生後自行在主機上編輯 config/core.env 填入。
set -euo pipefail
umask 077
BASE="${AI_ASSISTANT_HOME:-$HOME/BackEndDockerData/ai-assistant-demo}"
: "${PUBLIC_ORIGIN:?請提供 PUBLIC_ORIGIN，例如 https://example.com}"; : "${ENTRY_UUID:?請提供 ENTRY_UUID}"; : "${LLM_MODEL:?請提供 LLM_MODEL}"
[ -s "$BASE/public/bridge-signing-key.jwk.json" ] || { echo "✗ 請先執行 host-init.sh" >&2; exit 1; }
BASE="$BASE" PUBLIC_ORIGIN="$PUBLIC_ORIGIN" ENTRY_UUID="$ENTRY_UUID" LLM_MODEL="$LLM_MODEL" python3 -I - <<'PY'
import json, os, re, sys
base = os.environ["BASE"]; cfg = f"{base}/config"; pub = f"{base}/public"
def jwk(name): return json.load(open(f"{pub}/{name}.jwk.json"))
def compose(key):
    for line in open(f"{cfg}/compose.env"):
        if line.startswith(key + "="): return line.strip().split("=", 1)[1]
    sys.exit(f"compose.env 缺少 {key}")
entry = os.environ["ENTRY_UUID"].strip()
if not re.fullmatch(r"[0-9A-Fa-f-]{36}", entry): sys.exit("ENTRY_UUID 格式不像 UUID")

PUBLIC = os.environ["PUBLIC_ORIGIN"].strip().rstrip("/")
if not re.fullmatch(r"https://[A-Za-z0-9.-]+(:[0-9]+)?", PUBLIC): sys.exit("PUBLIC_ORIGIN 必須是 https://<網域>，不含路徑")
SUBNET = compose("DEMO_BACKEND_SUBNET"); TLS_HOST = compose("DEMO_CONNECTOR_TLS_HOST")
PGUSER = compose("DEMO_POSTGRES_USER"); PGDB = compose("DEMO_POSTGRES_DB")
PGPW = open(f"{base}/secrets/postgres-password").read().strip()
DB_URL = f"postgresql://{PGUSER}:{PGPW}@postgres:5432/{PGDB}?schema=public"
ctx = {"customerId": "customer-shinmone", "integrationId": "shinmone-scm-assistant",
       "hostApp": "shinmone-scm", "connectorInstanceId": "shinmone-scm-connector-1"}
CONNECTOR_KEY = "business"
OPS = ["shinmone.kpistats.snapshot.today", "shinmone.kpistats.snapshot.weekly", "shinmone.kpistats.snapshot.monthly"]
CONNECTOR_URI = f"https://{TLS_HOST}:3443"
internal_policy = {"mode": "allowlisted_networks", "allowedCidrs": [SUBNET]}

bridge_id = {"issuer": f"{PUBLIC}/assistant-identity", "audience": "urn:ideaxpress:ai-assistant:gateway",
             "jwks": f"{PUBLIC}/assistant-identity/.well-known/jwks.json"}
gw = {"issuer": "https://ai-assistant-gateway.internal", "audience": "urn:ideaxpress:ai-assistant:core",
      "jwks": "http://gateway:4000/.well-known/jwks.json"}
central = {"profileKey": "central-shinmone-v1", "typ": "assistant-connector-service+jwt",
           "issuer": "urn:ideaxpress:ai-assistant:connector", "subject": "ai-assistant-core",
           "audience": "urn:assistant:connector:{customerId}:{integrationId}:{hostApp}:".format(**ctx) + f"{CONNECTOR_KEY}:{ctx['connectorInstanceId']}",
           "keyDomain": "ideaxpress-connector-central-signing"}
binding = {"profileKey": "BRIDGE_BINDING_TRANSPORT_V1", "typ": "assistant-connector-binding+jwt",
           "issuer": "urn:ideaxpress:ai-assistant:shinmone-binding", "subject": "ai-assistant-bridge",
           "audience": "urn:ideaxpress:connector-binding:shinmone", "keyDomain": "ideaxpress-shinmone-binding-signing",
           "providerKey": "shinmone-idx-bootstrap-v1"}
k_bridge, k_bind, k_core, k_gw = jwk("bridge-signing-key"), jwk("bridge-binding-key"), jwk("core-connector-key"), jwk("gateway-signing-key")
assert len({k["n"] for k in (k_bridge, k_bind, k_core, k_gw)}) == 4, "四把金鑰必須不同"
j = lambda v: json.dumps(v, separators=(",", ":"), ensure_ascii=False)

files = {
 "bridge.env": {
  "BRIDGE_IDX_MENUDETAIL_URI": f"{PUBLIC}/shinmone-api/Auth/APIs/Site/MenuDetail",
  "BRIDGE_IDX_ALLOWED_ENTRIES": j([entry]),
  "BRIDGE_INTEGRATION_ID": ctx["integrationId"], "BRIDGE_HOST_APP": ctx["hostApp"],
  "BRIDGE_ISSUER": bridge_id["issuer"], "BRIDGE_AUDIENCE": bridge_id["audience"], "BRIDGE_JWKS_PUBLIC_URI": bridge_id["jwks"],
  "BRIDGE_SIGNING_KEYS": j([{"kid": k_bridge["kid"], "status": "active", "publicJwk": k_bridge,
                             "keyReference": "file:///run/secrets/bridge_signing_key"}]),
  "IDX_DESTINATION_MODE": "public_only", "IDX_ALLOWED_CIDRS": "",
  "BRIDGE_TIMEOUT_MS": "5000", "BRIDGE_MAX_RESPONSE_BYTES": "262144", "BRIDGE_ALLOWED_ORIGINS": "",
  "BRIDGE_CONNECTOR_BINDING_URI": f"{CONNECTOR_URI}/v1/internal/connector-bindings",
  "BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY": j(internal_policy),
  "BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON": j({**ctx, "bootstrapProfileKey": binding["profileKey"], "providerKey": binding["providerKey"]}),
  "BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON": j({**{k: binding[k] for k in ("profileKey","typ","issuer","subject","audience","keyDomain")},
       "keys": [{"kid": k_bind["kid"], "status": "active", "publicJwk": k_bind, "privateKeyReference": "file:///run/secrets/bridge_binding_key"}]}),
  "BRIDGE_BINDING_REQUEST_TIMEOUT_MS": "2000"},
 "gateway.env": {
  "DATABASE_URL": DB_URL,
  "GATEWAY_INTERNAL_JWT_ISSUER": gw["issuer"], "GATEWAY_INTERNAL_JWT_AUDIENCE": gw["audience"],
  "GATEWAY_PUBLIC_JWKS_URL": gw["jwks"], "GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS": "0",
  "GATEWAY_INTERNAL_JWT_TTL_SECONDS": "300", "GATEWAY_BACKEND_BASE_URL": "http://core:3000/",
  "GATEWAY_SIGNING_KEY_REFERENCE": "file:///run/secrets/gateway_signing_key",
  "GATEWAY_ALLOWED_ORIGINS": PUBLIC},
 "core.env": {
  "DATABASE_URL": DB_URL, "POSTGRES_USER": PGUSER, "POSTGRES_PASSWORD": PGPW, "POSTGRES_DB": PGDB,
  "INTERNAL_IDENTITY_JWT_ISSUER": gw["issuer"], "INTERNAL_IDENTITY_JWT_AUDIENCE": gw["audience"], "INTERNAL_IDENTITY_JWKS_URI": gw["jwks"],
  "LLM_PROVIDER": "openai", "LLM_MODEL": os.environ["LLM_MODEL"], "OPENAI_API_KEY": "",
  "ASSISTANT_CAPABILITY_PACK_PATHS_JSON": j(["/app/customer-capability-packs/shinmone-scm-kpistats.json"]),
  "ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON": j([{"version": "1", "active": True, **ctx, "connectorKey": CONNECTOR_KEY,
       "operations": [{"key": k, "version": "1.0.0"} for k in OPS]}]),
  "ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON": j([{"version": "1", **ctx, "connectorKey": CONNECTOR_KEY, "active": True,
       "invocationUri": f"{CONNECTOR_URI}/v1/connector/invocations", "serviceAuthProfileKey": central["profileKey"],
       "destinationPolicy": internal_policy, "maxRequestBytes": 16384, "maxResponseBytes": 16384, "maxTransportMs": 4500}]),
  "ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON": j([{"profileKey": central["profileKey"], "typ": central["typ"], "subject": central["subject"],
       "keyDomain": central["keyDomain"], "keys": [{"kid": k_core["kid"], "status": "active", "publicJwk": k_core,
       "privateKeyReference": "file:///run/secrets/core_connector_key"}]}]),
  "ASSISTANT_CONNECTOR_SERVICE_ISSUER": central["issuer"]},
 "connector.env": {
  "CONNECTOR_RUNTIME_CONTEXT_JSON": j([ctx]),
  "CONNECTOR_CENTRAL_TRUST_KEYS_JSON": j([{"kind": "central-invocation", **{k: central[k] for k in ("profileKey","typ","issuer","subject","audience","keyDomain")},
       "trustedContext": ctx, "keys": [{"kid": k_core["kid"], "status": "active", "publicJwk": k_core}]}]),
  "CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON": j([{"kind": "binding-bootstrap", **{k: binding[k] for k in ("profileKey","typ","issuer","subject","audience","keyDomain")},
       "trustedContext": ctx, "keys": [{"kid": k_bind["kid"], "status": "active", "publicJwk": k_bind}], "providerKey": binding["providerKey"]}]),
  "CONNECTOR_REPLAY_CACHE_MAX_ENTRIES": "10000", "CONNECTOR_BINDING_STORE_MAX_ENTRIES": "4096",
  "CONNECTOR_BINDING_SCOPE_MAX_ENTRIES": "64", "CONNECTOR_BINDING_SWEEP_BATCH_SIZE": "128",
  "CONNECTOR_MANIFEST_FILES": j(["/repo/apps/customer-connector-runtime/dist/integrations/shinmone/kpistats-six-metric.demo.manifest.json"]),
  "CONNECTOR_CREDENTIAL_PROFILES_JSON": j([{"credentialProfileRef": "shinmone-idx-bearer-v1", "credentialProviderKey": "shinmone-idx-bootstrap-v1",
       "applicationStrategyKey": "shinmone-fixed-bearer-v1", "credentialKind": "bearer-v1"}]),
  "CONNECTOR_UPSTREAMS_JSON": j([{"upstreamServiceRef": "shinmone-scm-api", "origin": PUBLIC, "basePath": "/shinmone-api/SCM",
       "addressMode": "public_only", "allowedCidrs": []}])},
}
for name, values in files.items():
    path = f"{cfg}/{name}"
    if os.path.exists(path) and os.path.getsize(path) > 0:
        print(f"· {name}（已存在，略過）"); continue
    with open(path, "w") as f:
        f.write("# 由 host-config.sh 產生\n" + "".join(f"{k}={v}\n" for k, v in values.items()))
    os.chmod(path, 0o600); print(f"✓ {name}")
# 給資料初始化用的對照表（只含公開資訊）
json.dump({"context": ctx, "bridgeIdentity": {**bridge_id, "kid": k_bridge["kid"]},
           "gatewayInternal": {**gw, "kid": k_gw["kid"]}, "gatewaySigningPublicJwk": k_gw,
           "allowedEntry": entry}, open(f"{pub}/identity-plan.json", "w"), indent=2)
print("✓ public/identity-plan.json")
print("下一步：nano", f"{cfg}/core.env", "填入 OPENAI_API_KEY=")
PY
