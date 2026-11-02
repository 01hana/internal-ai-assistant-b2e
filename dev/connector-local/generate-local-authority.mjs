import { createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { assertDedicatedShinmoneRuntime, mergeLocalCapabilityPaths, mergeLocalServiceKeys,
  mergeScopedLocalEntries } from './local-config-merge.mjs';

const root = resolve(import.meta.dirname, '../..');
const localRoot = join(root, '.local-secrets/connector-local');
const centralKeyPath = join(localRoot, 'central/central-service-private.pem');
const bridgeKeyPath = join(localRoot, 'bridge/bridge-binding-private.pem');
const c01ManifestNames = [
  'work-orders.monthly-new-count.manifest.json',
  'work-orders.today-new-count.manifest.json',
  'work-orders.weekly-new-count.manifest.json'
];
const toolMode = process.argv.length === 3 && process.argv[2] === '--kpistats-demo'
  ? 'kpistats-demo' : process.argv.length === 2 ? 'c01' : undefined;
if (!toolMode) throw new Error('Unsupported Shinmone local tool mode.');
const demoManifestName = 'kpistats-six-metric.demo.manifest.json';
const manifestNames = toolMode === 'c01' ? c01ManifestNames : [demoManifestName];
const manifestPaths = manifestNames.map((name) => join(localRoot, 'runtime', name));
const capabilityPackPath = toolMode === 'c01'
  ? join(root, 'customer-capability-packs/shinmone-scm-local/1.0.0.json')
  : join(localRoot, 'runtime', 'shinmone-kpistats-demo-active.pack.json');
const operationKeys = toolMode === 'c01'
  ? ['work-orders.monthly-new-count', 'work-orders.today-new-count', 'work-orders.weekly-new-count']
  : ['shinmone.kpistats.snapshot.today', 'shinmone.kpistats.snapshot.weekly', 'shinmone.kpistats.snapshot.monthly'];
const overlayEnvironment = readEnvironment(join(root, 'dev/connector-local/.env'));
const localLanIp = overlayEnvironment.LOCAL_LAN_IP;
const runtimeFacadePort = overlayEnvironment.LOCAL_CONNECTOR_RUNTIME_HTTPS_PORT;
const shinmoneFacadePort = overlayEnvironment.LOCAL_SHINMONE_HTTPS_PORT;
if (isIP(localLanIp) !== 4 || localLanIp.startsWith('127.') || !port(runtimeFacadePort) || !port(shinmoneFacadePort)) {
  throw new Error('The ignored connector-local .env must contain a non-loopback IPv4 address and valid facade ports.');
}

const context = Object.freeze({
  customerId: 'customer-shinmone-scm-local',
  integrationId: 'shinmone-scm-assistant-local',
  hostApp: 'shinmone-scm',
  connectorInstanceId: 'shinmone-scm-connector-local-1'
});
const existingRuntime = readEnvironment(join(localRoot, 'runtime.env'), true);
const existingBackend = readEnvironment(join(localRoot, 'backend.env'), true);
assertDedicatedShinmoneRuntime(existingRuntime.CONNECTOR_RUNTIME_CONTEXT_JSON, context);
if (existingRuntime.CONNECTOR_MANIFEST_FILES) {
  const existingManifests = JSON.parse(existingRuntime.CONNECTOR_MANIFEST_FILES);
  if (!Array.isArray(existingManifests) || existingManifests.some((path) =>
    typeof path !== 'string' || ![...c01ManifestNames, demoManifestName].includes(basename(path)))) {
    throw new Error('The local Connector Runtime has non-Shinmone manifests; mode switch is blocked.');
  }
}
const connectorKey = 'business';
const localLanCidr = `${localLanIp}/32`;
const central = Object.freeze({
  profileKey: 'central-shinmone-local-v1',
  typ: 'assistant-connector-service+jwt',
  issuer: 'urn:local-dev:assistant:connector',
  subject: 'local-central-adapter',
  audience: `urn:assistant:connector:${context.customerId}:${context.integrationId}:${context.hostApp}:${connectorKey}:${context.connectorInstanceId}`,
  keyDomain: 'local-connector-central-signing',
  kid: 'local-central-connector-20260919'
});
const bridge = Object.freeze({
  profileKey: 'BRIDGE_BINDING_TRANSPORT_V1',
  typ: 'assistant-connector-binding+jwt',
  issuer: 'urn:local-dev:shinmone-binding',
  subject: 'local-shinmone-binding-client',
  audience: 'urn:local-dev:connector-binding:shinmone',
  keyDomain: 'local-shinmone-binding-signing',
  kid: 'local-shinmone-binding-20260919',
  providerKey: 'shinmone-idx-bootstrap-v1'
});
if (existingBackend.ASSISTANT_CONNECTOR_SERVICE_ISSUER &&
    existingBackend.ASSISTANT_CONNECTOR_SERVICE_ISSUER !== central.issuer) {
  throw new Error('The shared Backend uses another Connector issuer; Shinmone mode switch is blocked.');
}

const centralJwk = ensureKey(centralKeyPath, central.kid);
const bridgeJwk = ensureKey(bridgeKeyPath, bridge.kid);
if (centralJwk.n === bridgeJwk.n) throw new Error('Local Central and Bridge keys must be distinct.');

for (const [index, manifestPath] of manifestPaths.entries()) {
  const manifestSource = join(root, 'apps/customer-connector-runtime/integrations/shinmone', manifestNames[index]);
  mkdirSync(dirname(manifestPath), { recursive: true });
  if (existsSync(manifestPath)) {
    if (!readFileSync(manifestPath).equals(readFileSync(manifestSource))) throw new Error('Local manifest copy differs from the checked-in manifest.');
  } else {
    copyFileSync(manifestSource, manifestPath);
  }
  chmodSync(manifestPath, 0o444);
}
if (toolMode === 'kpistats-demo') {
  const staged = JSON.parse(readFileSync(join(root,
    'customer-capability-packs/shinmone-scm-kpistats-demo/1.0.0.json'), 'utf8'));
  if (staged.active !== false || staged.customerId !== context.customerId ||
      staged.integrationId !== context.integrationId ||
      JSON.stringify(staged.bindings.map((binding) => binding.target.toolKey)) !== JSON.stringify(operationKeys)) {
    throw new Error('Staged KPIStats Demo pack does not match the local integration.');
  }
  writeFileSync(capabilityPackPath, `${JSON.stringify({ ...staged, active: true })}\n`, { mode: 0o600 });
  chmodSync(capabilityPackPath, 0o600);
}

const runtimeEnvironment = {
  LOCAL_DEVELOPMENT: '1',
  SHINMONE_LOCAL_TOOL_MODE: toolMode,
  LOCAL_CONNECTOR_DIAGNOSTICS: '1',
  CONNECTOR_RUNTIME_PROCESS_ROLE: 'single-replica',
  CONNECTOR_REPLAY_CACHE_MAX_ENTRIES: '64',
  CONNECTOR_BINDING_STORE_MAX_ENTRIES: '4096',
  CONNECTOR_BINDING_SCOPE_MAX_ENTRIES: '64',
  CONNECTOR_BINDING_SWEEP_BATCH_SIZE: '128',
  CONNECTOR_RUNTIME_CONTEXT_JSON: json([context]),
  CONNECTOR_CENTRAL_TRUST_KEYS_JSON: json([{
    kind: 'central-invocation',
    profileKey: central.profileKey,
    typ: central.typ,
    issuer: central.issuer,
    subject: central.subject,
    audience: central.audience,
    keyDomain: central.keyDomain,
    trustedContext: context,
    keys: [{ kid: central.kid, status: 'active', publicJwk: centralJwk }]
  }]),
  CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: json([{
    kind: 'binding-bootstrap',
    profileKey: bridge.profileKey,
    typ: bridge.typ,
    issuer: bridge.issuer,
    subject: bridge.subject,
    audience: bridge.audience,
    keyDomain: bridge.keyDomain,
    trustedContext: context,
    keys: [{ kid: bridge.kid, status: 'active', publicJwk: bridgeJwk }],
    providerKey: bridge.providerKey
  }]),
  CONNECTOR_CREDENTIAL_PROFILES_JSON: json([{
    credentialProfileRef: 'shinmone-idx-bearer-v1',
    credentialProviderKey: bridge.providerKey,
    applicationStrategyKey: 'shinmone-fixed-bearer-v1',
    credentialKind: 'bearer-v1'
  }]),
  CONNECTOR_UPSTREAMS_JSON: json([{
    upstreamServiceRef: 'shinmone-scm-api',
    origin: `https://shinmone-upstream.local.test:${shinmoneFacadePort}`,
    basePath: '/APIs/SCM',
    addressMode: 'allowlisted_networks',
    allowedCidrs: [localLanCidr]
  }]),
  CONNECTOR_MANIFEST_FILES: json(manifestPaths)
};

const backendEnvironment = {
  ASSISTANT_CAPABILITY_PACK_PATHS_JSON: mergeLocalCapabilityPaths(
    existingBackend.ASSISTANT_CAPABILITY_PACK_PATHS_JSON, capabilityPackPath, context, root),
  ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON: mergeScopedLocalEntries(
    existingBackend.ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON, {
    version: '1', active: true, ...context, connectorKey,
    operations: operationKeys.map((key) => ({ key, version: '1.0.0' }))
  }, context, 'Adapter bindings'),
  ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON: mergeScopedLocalEntries(
    existingBackend.ASSISTANT_CONNECTOR_DEPLOYMENTS_JSON, {
    version: '1', ...context, connectorKey, active: true,
    invocationUri: `https://connector-runtime.local.test:${runtimeFacadePort}/v1/connector/invocations`,
    serviceAuthProfileKey: central.profileKey,
    destinationPolicy: { mode: 'allowlisted_networks', allowedCidrs: [localLanCidr] },
    maxRequestBytes: 16384,
    maxResponseBytes: 16384,
    maxTransportMs: 4500
  }, context, 'Connector deployments'),
  ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON: mergeLocalServiceKeys(
    existingBackend.ASSISTANT_CONNECTOR_SERVICE_KEYS_JSON, {
    profileKey: central.profileKey,
    typ: central.typ,
    subject: central.subject,
    keyDomain: central.keyDomain,
    keys: [{
      kid: central.kid,
      status: 'active',
      publicJwk: centralJwk,
      privateKeyReference: pathToFileURL(centralKeyPath).toString()
    }]
  }),
  ASSISTANT_CONNECTOR_SERVICE_ISSUER: central.issuer
};

const bridgeEnvironment = {
  LOCAL_DEVELOPMENT: '1',
  LOCAL_CONNECTOR_DIAGNOSTICS: '1',
  BRIDGE_CONNECTOR_BINDING_URI: `https://connector-runtime.local.test:${runtimeFacadePort}/v1/internal/connector-bindings`,
  BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY: json({ mode: 'allowlisted_networks', allowedCidrs: [localLanCidr] }),
  BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON: json({
    ...context,
    bootstrapProfileKey: bridge.profileKey,
    providerKey: bridge.providerKey
  }),
  BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON: json({
    profileKey: bridge.profileKey,
    typ: bridge.typ,
    issuer: bridge.issuer,
    subject: bridge.subject,
    audience: bridge.audience,
    keyDomain: bridge.keyDomain,
    keys: [{
      kid: bridge.kid,
      status: 'active',
      publicJwk: bridgeJwk,
      privateKeyReference: pathToFileURL(bridgeKeyPath).toString()
    }]
  }),
  BRIDGE_BINDING_REQUEST_TIMEOUT_MS: '2000'
};

writeEnvironment(join(localRoot, 'runtime.env'), runtimeEnvironment);
writeEnvironment(join(localRoot, 'backend.env'), backendEnvironment);
writeEnvironment(join(localRoot, 'bridge.env'), bridgeEnvironment);

process.stdout.write('Local connector authority files generated without exposing key material.\n');

function ensureKey(path, kid) {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
    writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  }
  chmodSync(path, 0o600);
  const privateKey = createPrivateKey(readFileSync(path));
  const jwk = createPublicKey(privateKey).export({ format: 'jwk' });
  if (jwk.kty !== 'RSA' || typeof jwk.n !== 'string' || jwk.e !== 'AQAB') throw new Error('Local RSA key is invalid.');
  return Object.freeze({ kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e });
}

function writeEnvironment(path, values) {
  const content = `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  writeFileSync(path, content, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function readEnvironment(path, optional = false) {
  if (optional && !existsSync(path)) return {};
  const entries = readFileSync(path, 'utf8').split(/\r?\n/).filter((line) => !/^\s*(?:#|$)/.test(line)).map((line) => {
    const separator = line.indexOf('=');
    if (separator < 1) throw new Error('Invalid connector-local .env entry.');
    return [line.slice(0, separator), line.slice(separator + 1)];
  });
  return Object.freeze(Object.fromEntries(entries));
}

function port(value) {
  return typeof value === 'string' && /^\d{1,5}$/.test(value) && Number(value) >= 1 && Number(value) <= 65535;
}

function json(value) { return JSON.stringify(value); }
