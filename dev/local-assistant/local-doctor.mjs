#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import {
  PORTS, ROOT, STATE_DIR, collectDockerCidrs, collectRouteCidrs, commandExists, connectorBridgePrivateTarget, detectLanAddress,
  bridgeBindingRouteMatches, connectorTlsBindingsMatch, doctorRootCauseFor, hostDatabaseUrl, hostsBlockMatches, httpHealthy,
  idxVerifierRootCause, inspectDockerContainerDns, inspectDockerContainerEnvironment, inspectDockerPublishedBindings,
  loadState, prerequisiteReport, readEnvFile, selectDockerSubnet,
  validateRootEnvironment, verifyHostMappings
} from './local-lib.mjs';

const state = loadState();
const checks = new Map();
const fail = (name) => checks.set(name, 'FAIL');
const pass = (name, value = true) => checks.set(name, value ? 'PASS' : 'FAIL');

const missing = prerequisiteReport({ needsMkcert: true });
if (!commandExists('cloudflared')) missing.push('cloudflared');
if (!commandExists('openssl')) missing.push('openssl');
const rootEnv = readEnvFile(join(ROOT, '.env'), { optional: true });
const environment = validateRootEnvironment(rootEnv);
if (environment.valid) pass('OPENAI_CONFIG'); else fail('OPENAI_CONFIG');

pass('POSTGRES', dockerHealthy(['-f', 'docker-compose.yml'], 'postgres'));

if (await httpHealthy(`http://127.0.0.1:${PORTS.backend}/api/v1/health`)) pass('BACKEND'); else fail('BACKEND');
if (await httpHealthy(`http://127.0.0.1:${PORTS.connectorRuntime}/health`)) pass('CONNECTOR_RUNTIME'); else fail('CONNECTOR_RUNTIME');

let observedLan;
try { observedLan = detectLanAddress(); } catch { /* reported by network and host checks */ }
const connectorCompose = ['--env-file', 'dev/connector-local/.env', '-f', 'dev/connector-local/docker-compose.yml'];
const connectorOverlayEnv = readEnvFile(join(ROOT, 'dev/connector-local/.env'), { optional: true });
const connectorHttpsPort = Number(connectorOverlayEnv.LOCAL_CONNECTOR_RUNTIME_HTTPS_PORT ?? PORTS.connectorTls);
const shinmoneHttpsPort = Number(connectorOverlayEnv.LOCAL_SHINMONE_HTTPS_PORT ?? PORTS.shinmoneTls);
const connectorTls = dockerHealthy(connectorCompose, 'connector-local-tls');
const connectorBindings = observedLan && connectorTlsBindingsMatch(
  inspectDockerPublishedBindings({ composeArgs: connectorCompose, service: 'connector-local-tls' }),
  observedLan.address, connectorHttpsPort, shinmoneHttpsPort
);
if (connectorTls && connectorBindings && tlsProbe('connector-runtime.local.test', connectorHttpsPort)) pass('CONNECTOR_TLS_OVERLAY'); else fail('CONNECTOR_TLS_OVERLAY');

if (await httpHealthy(`http://127.0.0.1:${PORTS.identityBridge}/health`)) pass('IDENTITY_BRIDGE'); else fail('IDENTITY_BRIDGE');
const identityFiles = identityComposeFiles();
let identityComposeEnvironment = process.env;
try { identityComposeEnvironment = { ...process.env, CONNECTOR_LOCAL_BRIDGE_PRIVATE_TARGET: connectorBridgePrivateTarget() }; } catch { /* reported as unavailable */ }
if (dockerHealthy(identityFiles, 'idx-https-proxy', identityComposeEnvironment)) pass('IDX_PROXY'); else fail('IDX_PROXY');
const desiredBridgeEnvironment = readEnvFile(join(ROOT, '.local-secrets/connector-local/bridge.env'), { optional: true });
const bridgeRouteMatches = observedLan && bridgeBindingRouteMatches({
  actualInspection: inspectDockerContainerEnvironment({ composeArgs: identityFiles, service: 'identity-bridge', environment: identityComposeEnvironment }),
  desiredEnvironment: desiredBridgeEnvironment,
  dnsInspection: inspectDockerContainerDns({ composeArgs: identityFiles, service: 'identity-bridge', hostname: 'connector-runtime.local.test', environment: identityComposeEnvironment }),
  currentLanIp: observedLan.address
});
if (bridgeRouteMatches) pass('BRIDGE_CONNECTOR_BINDING_ROUTE'); else fail('BRIDGE_CONNECTOR_BINDING_ROUTE');
if (await httpHealthy(`http://127.0.0.1:${PORTS.gateway}/health`)) pass('GATEWAY'); else fail('GATEWAY');

const tunnel = state.cloudflaredHostname;
if (tunnel && await httpHealthy(`${tunnel}/.well-known/jwks.json`, { timeoutMs: 5000 }) && verifyProvisioning(`${tunnel}/.well-known/jwks.json`, rootEnv)) pass('JWKS_TRUST');
else fail('JWKS_TRUST');

try {
  const lan = observedLan ?? detectLanAddress();
  const hosts = readFileSync('/etc/hosts', 'utf8');
  if (!hostsBlockMatches(hosts, lan.address)) throw new Error();
  await verifyHostMappings(lan.address);
  pass('LOCAL_HOST_MAPPING');
} catch { fail('LOCAL_HOST_MAPPING'); }

try {
  const expectedNetwork = expectedNetworkState() ?? state.network;
  const selected = selectDockerSubnet(collectRouteCidrs(), collectDockerCidrs(), expectedNetwork?.subnet);
  if (!expectedNetwork || !observedLan || selected.subnet !== expectedNetwork.subnet || observedLan.address !== expectedNetwork.lanIp) throw new Error();
  pass('LOCAL_DOCKER_NETWORK');
} catch { fail('LOCAL_DOCKER_NETWORK'); }

let rootCause = doctorRootCauseFor(Object.fromEntries(checks), missing);

for (const name of ['POSTGRES', 'BACKEND', 'OPENAI_CONFIG', 'CONNECTOR_RUNTIME', 'CONNECTOR_TLS_OVERLAY', 'IDENTITY_BRIDGE', 'IDX_PROXY', 'BRIDGE_CONNECTOR_BINDING_ROUTE', 'GATEWAY', 'JWKS_TRUST', 'LOCAL_HOST_MAPPING', 'LOCAL_DOCKER_NETWORK']) {
  process.stdout.write(`${name}=${checks.get(name) ?? 'FAIL'}\n`);
}

if (process.argv.includes('--idx')) {
  if (rootCause !== 'NONE') process.stderr.write('Interactive IDX diagnostic skipped until default doctor checks pass.\n');
  else {
    const result = spawnSync('npm', ['--prefix', 'apps/identity-bridge', 'run', 'local:verify:idx'], { cwd: ROOT, stdio: 'inherit' });
    if (result.status !== 0) rootCause = idxVerifierRootCause(result.status);
  }
}

process.stdout.write(`\nLOCAL_ASSISTANT_READY=${rootCause === 'NONE' ? 'YES' : 'NO'}\nROOT_CAUSE=${rootCause}\n`);
if (missing.length) process.stdout.write(`MISSING_PREREQUISITE=${missing[0]}\n`);
if (rootCause !== 'NONE') process.exitCode = 1;

function dockerHealthy(files, service, environment = process.env) {
  const result = spawnSync('docker', ['compose', ...files, 'ps', '--format', 'json', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  if (result.status !== 0 || !result.stdout.trim()) return false;
  try { return result.stdout.trim().split(/\r?\n/).some((line) => { const row = JSON.parse(line); return row.State === 'running' && (!row.Health || row.Health === 'healthy'); }); } catch { return false; }
}
function tlsProbe(hostname, port) {
  const ca = join(ROOT, '.local-secrets/connector-local/bridge/combined-local-ca.pem');
  if (!existsSync(ca)) return false;
  return spawnSync('curl', ['--fail', '--silent', '--show-error', '--cacert', ca, `https://${hostname}:${port}/health`], { stdio: 'ignore' }).status === 0;
}
function identityComposeFiles() {
  return ['-f', 'apps/identity-bridge/compose.yaml', '-f', join(STATE_DIR, 'identity-network.override.yml'), '-f', 'dev/connector-local/identity-bridge.compose.override.yml'];
}
function expectedNetworkState() {
  if (!process.argv.includes('--from-start') || !process.env.LOCAL_ASSISTANT_EXPECTED_NETWORK) return undefined;
  try {
    const value = JSON.parse(process.env.LOCAL_ASSISTANT_EXPECTED_NETWORK);
    return value && typeof value.subnet === 'string' && typeof value.lanIp === 'string' ? value : undefined;
  } catch { return undefined; }
}
function verifyProvisioning(jwksUri, env) {
  try {
    const databaseUrl = hostDatabaseUrl(env.DATABASE_URL);
    const result = spawnSync('npm', ['--prefix', 'apps/gateway', 'run', 'local:feature007:provision', '--', '--jwks-uri', jwksUri, '--verify-only'], {
      cwd: ROOT, stdio: 'ignore', env: { ...process.env, ...env, NODE_ENV: 'development', DATABASE_URL: databaseUrl }
    });
    return result.status === 0;
  } catch { return false; }
}
