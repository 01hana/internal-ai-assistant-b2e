#!/usr/bin/env node
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  BACKEND_COMPILED_ENTRYPOINT, LocalAssistantError, PORTS, ROOT, STATE_DIR, beginAppliedConfigReconciliation, beginNetworkReconciliation, bridgeBindingDeploymentMatches,
  bridgeBindingRouteMatches, collectDockerCidrs, collectRouteCidrs,
  commandExists, connectorBridgePrivateTarget, connectorTlsAction, connectorTlsBindingsMatch, detectLanAddress, doctorFailureRootCause,
  ensureGatewayKey, generatedIdentityOverride, hostDatabaseUrl, hostsBlockMatches, identityBridgeAction, inspectDockerContainerDns,
  inspectDockerContainerEnvironment, inspectDockerPublishedBindings,
  hashFilesAndValues, httpHealthy, loadState, parseCloudflaredHostname, prerequisiteHint, prerequisiteReport, readEnvFile,
  run, saveState, selectDockerSubnet, startManagedProcess, stopPid, validateRootEnvironment,
  verifyHostMappings, waitFor, writeEnvFile
} from './local-lib.mjs';

const startedThisRun = [];
let state;
try {
  state = loadState();
  const missing = prerequisiteReport({ needsMkcert: true });
  if (!commandExists('cloudflared')) missing.push('cloudflared');
  if (!commandExists('openssl')) missing.push('openssl');
  if (missing.length) throw new LocalAssistantError('PREREQUISITE_MISSING', prerequisiteHint(missing[0]), { prerequisite: missing[0] });

  const rootEnv = readEnvFile(join(ROOT, '.env'));
  const envValidation = validateRootEnvironment(rootEnv);
  if (!envValidation.valid) {
    const keys = [...envValidation.missing, ...envValidation.placeholders, ...envValidation.invalid].join(', ');
    throw new LocalAssistantError('LOCAL_ENV_INVALID', `Set non-placeholder local values in .env for: ${keys}.`);
  }
  const databaseUrl = hostDatabaseUrl(rootEnv.DATABASE_URL);
  const lan = detectLanAddress();
  const network = selectDockerSubnet(collectRouteCidrs(), collectDockerCidrs(), state.network?.subnet);
  const desiredNetwork = { ...network, lanIp: lan.address, interfaceName: lan.interfaceName };
  const networkReconciliation = beginNetworkReconciliation(state.network, desiredNetwork);
  process.stdout.write(`[PASS] Active network ${lan.interfaceName} (${lan.address}); Docker subnet ${network.subnet}\n`);

  await reconcileHosts(lan.address);
  await reconcileIdentityMaterial(network);
  await reconcileConnectorMaterial(lan.address);

  const postgresFiles = ['-f', 'docker-compose.yml'];
  const postgresHash = hashFilesAndValues([join(ROOT, 'docker-compose.yml')], { service: 'postgres' });
  const postgresWasHealthy = dockerServiceHealthy(postgresFiles, 'postgres');
  const postgresChanged = state.containers.postgres?.configHash && state.containers.postgres.configHash !== postgresHash;
  if (!postgresWasHealthy || postgresChanged) {
    const exists = dockerServiceExists(postgresFiles, 'postgres');
    if (!exists) assertUnmanagedPortFree('PostgreSQL', PORTS.postgres);
    compose(postgresFiles, ['up', '-d', ...(exists ? ['--force-recreate'] : []), 'postgres'], 'POSTGRES_UNAVAILABLE');
    state.containers.postgres = { managed: true, configHash: postgresHash };
    startedThisRun.push({ kind: 'container', name: 'postgres' });
  } else state.containers.postgres = { managed: state.containers.postgres?.managed === true, configHash: postgresHash };
  if (!(await waitFor(() => dockerServiceHealthy(['-f', 'docker-compose.yml'], 'postgres'), { timeoutMs: 60_000 }))) {
    throw new LocalAssistantError('POSTGRES_UNAVAILABLE', 'PostgreSQL did not become healthy.');
  }
  process.stdout.write(`[${postgresWasHealthy && !postgresChanged ? 'REUSE' : postgresWasHealthy ? 'RECREATE' : 'START'}] PostgreSQL\n`);
  saveState(state);

  run('npm', ['run', 'prisma:generate'], { label: 'Prisma client generation', rootCause: 'LOCAL_ENV_INVALID', stdio: 'inherit' });
  run('npm', ['run', 'prisma:deploy'], { label: 'Checked-in migration deployment', rootCause: 'LOCAL_ENV_INVALID', env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: 'inherit' });
  run('npm', ['run', 'build'], { label: 'Backend build', rootCause: 'BACKEND_UNAVAILABLE', stdio: 'inherit' });
  run('npm', ['run', 'build:gateway'], { label: 'Gateway build', rootCause: 'GATEWAY_UNAVAILABLE', stdio: 'inherit' });
  run('npm', ['--prefix', 'apps/customer-connector-runtime', 'run', 'build'], { label: 'Connector Runtime build', rootCause: 'CONNECTOR_RUNTIME_UNAVAILABLE', stdio: 'inherit' });
  run('npm', ['--prefix', 'apps/identity-bridge', 'run', 'build'], { label: 'Identity Bridge build', rootCause: 'IDENTITY_BRIDGE_UNAVAILABLE', stdio: 'inherit' });

  const connectorEnv = readEnvFile(join(ROOT, '.local-secrets/connector-local/runtime.env'));
  const connectorCa = join(ROOT, '.local-secrets/connector-local/bridge/combined-local-ca.pem');
  const connectorAction = await startManagedProcess({
    state, name: 'connectorRuntime', command: 'node', args: ['dev/connector-local/start-runtime.mjs'],
    environment: { ...connectorEnv, PORT: String(PORTS.connectorRuntime), NODE_EXTRA_CA_CERTS: connectorCa }, port: PORTS.connectorRuntime,
    health: () => httpHealthy(`http://127.0.0.1:${PORTS.connectorRuntime}/health`, { expect: (body) => body?.status === 'healthy' }),
    configInputs: [join(ROOT, '.local-secrets/connector-local/runtime.env'), connectorCa, join(ROOT, 'apps/customer-connector-runtime/dist/src/main.js')]
  });
  if (connectorAction !== 'REUSE') startedThisRun.push({ kind: 'process', name: 'connectorRuntime' });
  process.stdout.write(`[${connectorAction}] Customer Connector Runtime\n`);

  const connectorCompose = ['--env-file', 'dev/connector-local/.env', '-f', 'dev/connector-local/docker-compose.yml'];
  const connectorOverlayEnv = readEnvFile(join(ROOT, 'dev/connector-local/.env'));
  const connectorHttpsPort = Number(connectorOverlayEnv.LOCAL_CONNECTOR_RUNTIME_HTTPS_PORT ?? PORTS.connectorTls);
  const shinmoneHttpsPort = Number(connectorOverlayEnv.LOCAL_SHINMONE_HTTPS_PORT ?? PORTS.shinmoneTls);
  const connectorTlsHash = hashFilesAndValues([join(ROOT, 'dev/connector-local/.env'), join(ROOT, 'dev/connector-local/docker-compose.yml'), join(ROOT, 'dev/connector-local/Caddyfile'), join(ROOT, '.local-secrets/connector-local/tls/local-facades.crt')]);
  const connectorTlsWasHealthy = dockerServiceHealthy(connectorCompose, 'connector-local-tls');
  const connectorTlsChanged = state.containers.connectorTls?.configHash && state.containers.connectorTls.configHash !== connectorTlsHash;
  const connectorTlsExists = dockerServiceExists(connectorCompose, 'connector-local-tls');
  const connectorBindingsMatch = connectorTlsBindingsMatch(
    inspectDockerPublishedBindings({ composeArgs: connectorCompose, service: 'connector-local-tls' }),
    lan.address, connectorHttpsPort, shinmoneHttpsPort
  );
  const connectorTlsDecision = connectorTlsAction({
    exists: connectorTlsExists, healthy: connectorTlsWasHealthy,
    configChanged: Boolean(connectorTlsChanged), networkChanged: networkReconciliation.changed, bindingsMatch: connectorBindingsMatch
  });
  if (connectorTlsDecision !== 'REUSE') {
    if (connectorTlsDecision === 'START') {
      assertUnmanagedPortFree('Connector HTTPS overlay', connectorHttpsPort);
      assertUnmanagedPortFree('Shinmone HTTPS overlay', shinmoneHttpsPort);
    }
    compose(connectorCompose, ['up', '-d', '--force-recreate', 'connector-local-tls'], 'CONNECTOR_TLS_OVERLAY_UNAVAILABLE');
    state.containers.connectorTls = { managed: true, configHash: connectorTlsHash };
    startedThisRun.push({ kind: 'container', name: 'connectorTls' });
  } else state.containers.connectorTls = { managed: state.containers.connectorTls?.managed === true, configHash: connectorTlsHash };
  if (!(await waitFor(() => dockerServiceHealthy(connectorCompose, 'connector-local-tls') && connectorTlsBindingsMatch(
    inspectDockerPublishedBindings({ composeArgs: connectorCompose, service: 'connector-local-tls' }),
    lan.address, connectorHttpsPort, shinmoneHttpsPort
  ), { timeoutMs: 60_000 }))) {
    throw new LocalAssistantError('CONNECTOR_TLS_OVERLAY_UNAVAILABLE', 'Connector HTTPS overlay did not become healthy with the expected published bindings.');
  }
  process.stdout.write(`[${connectorTlsDecision}] Connector HTTPS overlay\n`);
  saveState(state);

  const identityCompose = ['-f', 'apps/identity-bridge/compose.yaml', '-f', join(STATE_DIR, 'identity-network.override.yml'), '-f', 'dev/connector-local/identity-bridge.compose.override.yml'];
  const identityComposeEnvironment = { ...process.env, CONNECTOR_LOCAL_BRIDGE_PRIVATE_TARGET: connectorBridgePrivateTarget() };
  const identityHealthy = dockerServiceHealthy(identityCompose, 'identity-bridge', identityComposeEnvironment) && dockerServiceHealthy(identityCompose, 'idx-https-proxy', identityComposeEnvironment);
  const identityHash = hashFilesAndValues([join(ROOT, 'apps/identity-bridge/compose.yaml'), join(STATE_DIR, 'identity-network.override.yml'), join(ROOT, 'dev/connector-local/identity-bridge.compose.override.yml'), join(ROOT, '.local-secrets/identity-bridge/bridge-signing.env'), join(ROOT, '.local-secrets/connector-local/bridge.env')]);
  const identityConfig = beginAppliedConfigReconciliation(state.containers.identity?.configHash, identityHash);
  const desiredBridgeEnvironment = readEnvFile(join(ROOT, '.local-secrets/connector-local/bridge.env'));
  const identityExists = dockerServiceExists(identityCompose, 'identity-bridge', identityComposeEnvironment);
  const actualBridgeEnvironment = inspectDockerContainerEnvironment({ composeArgs: identityCompose, service: 'identity-bridge', environment: identityComposeEnvironment });
  const identityDeploymentMatches = bridgeBindingDeploymentMatches(actualBridgeEnvironment, desiredBridgeEnvironment);
  if (identityExists && !identityDeploymentMatches) process.stdout.write('IDENTITY_BRIDGE_CONFIG_DRIFT=YES\n');
  const identityDecision = identityBridgeAction({
    exists: identityExists, healthy: identityHealthy, configChanged: identityConfig.changed,
    networkChanged: networkReconciliation.changed,
    deploymentMatches: identityDeploymentMatches
  });
  if (identityDecision !== 'REUSE') {
    if (identityDecision === 'START') assertUnmanagedPortFree('Identity Bridge', PORTS.identityBridge);
    compose(identityCompose, ['up', '--build', '-d', '--force-recreate'], 'IDENTITY_BRIDGE_UNAVAILABLE', identityComposeEnvironment);
    startedThisRun.push({ kind: 'container', name: 'identity' });
  }
  const bridgeReady = await waitFor(() => httpHealthy(`http://127.0.0.1:${PORTS.identityBridge}/ready`), { timeoutMs: 120_000 });
  if (!bridgeReady) throw new LocalAssistantError('IDENTITY_BRIDGE_UNAVAILABLE', 'Identity Bridge or IDX HTTPS proxy did not become ready.');
  const bridgeRouteApplied = await waitFor(() => bridgeBindingRouteMatches({
    actualInspection: inspectDockerContainerEnvironment({ composeArgs: identityCompose, service: 'identity-bridge', environment: identityComposeEnvironment }),
    desiredEnvironment: desiredBridgeEnvironment,
    dnsInspection: inspectDockerContainerDns({ composeArgs: identityCompose, service: 'identity-bridge', hostname: 'connector-runtime.local.test', environment: identityComposeEnvironment }),
    currentLanIp: lan.address
  }), { timeoutMs: 30_000 });
  if (!bridgeRouteApplied) throw new LocalAssistantError('BRIDGE_CONNECTOR_BINDING_ROUTE_STALE', 'Identity Bridge Connector binding route did not apply the desired local deployment configuration.');
  identityConfig.commit(state, 'identity', identityDecision !== 'REUSE' || state.containers.identity?.managed === true);
  process.stdout.write(`[${identityDecision}] Identity Bridge / IDX HTTPS proxy\n`);
  saveState(state);

  const jwksAction = await startManagedProcess({
    state, name: 'jwksProxy', command: 'node', args: ['apps/identity-bridge/scripts/local-jwks-proxy.cjs'], environment: {}, port: PORTS.jwksProxy,
    health: () => httpHealthy(`http://127.0.0.1:${PORTS.jwksProxy}/.well-known/jwks.json`),
    configInputs: [join(ROOT, 'apps/identity-bridge/scripts/local-jwks-proxy.cjs')]
  });
  if (jwksAction !== 'REUSE') startedThisRun.push({ kind: 'process', name: 'jwksProxy' });
  process.stdout.write(`[${jwksAction}] Local JWKS proxy\n`);

  const tunnelAction = await startManagedProcess({
    state, name: 'cloudflared', command: 'cloudflared', args: ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PORTS.jwksProxy}`],
    environment: {}, port: 0, health: async () => {
      const hostname = cloudflaredHostname();
      if (!hostname) return false;
      state.cloudflaredHostname = hostname;
      saveState(state);
      return httpHealthy(`${hostname}/.well-known/jwks.json`, { timeoutMs: 5000 });
    }, configInputs: [join(ROOT, 'apps/identity-bridge/scripts/local-jwks-proxy.cjs')], startupTimeoutMs: 90_000
  });
  if (tunnelAction !== 'REUSE') startedThisRun.push({ kind: 'process', name: 'cloudflared' });
  const tunnelOrigin = cloudflaredHostname();
  if (!tunnelOrigin) throw new LocalAssistantError('JWKS_TUNNEL_UNAVAILABLE', 'cloudflared did not report a public HTTPS hostname.');
  state.cloudflaredHostname = tunnelOrigin;
  saveState(state);
  process.stdout.write(`[${tunnelAction}] cloudflared JWKS tunnel\n`);

  const commonGatewayEnv = gatewayEnvironment(rootEnv, databaseUrl);
  await reconcileFeature007(`${tunnelOrigin}/.well-known/jwks.json`, commonGatewayEnv);
  process.stdout.write('[PASS] Gateway Feature007 local trust provisioning\n');

  const backendEnv = { ...rootEnv, ...readEnvFile(join(ROOT, '.local-secrets/connector-local/backend.env')), ...backendIdentityEnvironment(rootEnv), DATABASE_URL: databaseUrl, PORT: String(PORTS.backend), NODE_EXTRA_CA_CERTS: connectorCa };
  const backendAction = await startManagedProcess({
    state, name: 'backend', command: 'node', args: [BACKEND_COMPILED_ENTRYPOINT], environment: backendEnv, port: PORTS.backend,
    health: () => httpHealthy(`http://127.0.0.1:${PORTS.backend}/api/v1/health`, { expect: (body) => body?.data?.status === 'healthy' || body?.status === 'healthy' }),
    configInputs: [join(ROOT, '.env'), join(ROOT, '.local-secrets/connector-local/backend.env'), join(ROOT, BACKEND_COMPILED_ENTRYPOINT)]
  });
  if (backendAction !== 'REUSE') startedThisRun.push({ kind: 'process', name: 'backend' });
  process.stdout.write(`[${backendAction}] Assistant Backend\n`);

  const gatewayAction = await startManagedProcess({
    state, name: 'gateway', command: 'node', args: ['apps/gateway/dist/main.js'], environment: commonGatewayEnv, port: PORTS.gateway,
    health: () => httpHealthy(`http://127.0.0.1:${PORTS.gateway}/health`, { expect: (body) => body?.status === 'healthy' }),
    configInputs: [join(ROOT, '.env'), join(ROOT, 'apps/gateway/dist/main.js'), join(ROOT, '.gateway-local-keys/gateway-signing-key.pem')]
  });
  if (gatewayAction !== 'REUSE') startedThisRun.push({ kind: 'process', name: 'gateway' });
  process.stdout.write(`[${gatewayAction}] Gateway\n`);

  const signingStatus = spawnSync('node', ['dev/local-assistant/gateway-signing-status.mjs'], { cwd: ROOT, env: { ...process.env, ...commonGatewayEnv }, encoding: 'utf8' });
  if (signingStatus.status === 0) process.stdout.write('[REUSE] Gateway signing authority\n');
  else if (signingStatus.status === 2) {
    run('npm', ['--prefix', 'apps/gateway', 'run', 'signing:bootstrap:local'], { env: { ...process.env, ...commonGatewayEnv }, label: 'Gateway signing bootstrap', rootCause: 'GATEWAY_UNAVAILABLE' });
    process.stdout.write('[START] Gateway signing authority\n');
  } else throw new LocalAssistantError('GATEWAY_UNAVAILABLE', 'Gateway signing authority state could not be inspected safely.');

  runDoctor(desiredNetwork);
  networkReconciliation.commit(state);
  saveState(state);
  process.stdout.write('\nLOCAL_ASSISTANT_READY=YES\nROOT_CAUSE=NONE\n');
} catch (error) {
  await rollback();
  const safe = error instanceof LocalAssistantError ? error : new LocalAssistantError('LOCAL_ENV_INVALID', 'Unexpected local orchestration failure.');
  process.stderr.write(`${safe.message}\nLOCAL_ASSISTANT_READY=NO\nROOT_CAUSE=${safe.rootCause}\n`);
  if (safe.details?.prerequisite) process.stderr.write(`MISSING_PREREQUISITE=${safe.details.prerequisite}\n`);
  if (safe.details?.port) process.stderr.write(`CONFLICT_PORT=${safe.details.port}\nCONFLICT_SERVICE=${safe.details.service}\n`);
  process.exitCode = 1;
}

async function reconcileHosts(ip) {
  const content = readFileSync('/etc/hosts', 'utf8');
  if (!hostsBlockMatches(content, ip)) {
    const helper = join(ROOT, 'dev/local-assistant/hosts-helper.mjs');
    const result = spawnSync('sudo', ['node', helper, '--ip', ip], { stdio: 'inherit' });
    if (result.status !== 0) throw new LocalAssistantError('LOCAL_HOST_MAPPING_STALE', 'Could not update the managed /etc/hosts block.');
    process.stdout.write('[RECREATE] Managed local host mappings\n');
  } else process.stdout.write('[REUSE] Managed local host mappings\n');
  await verifyHostMappings(ip);
}

async function reconcileConnectorMaterial(ip) {
  const envPath = join(ROOT, 'dev/connector-local/.env');
  const current = readEnvFile(envPath, { optional: true });
  writeEnvFile(envPath, { LOCAL_LAN_IP: ip, LOCAL_CONNECTOR_RUNTIME_HTTPS_PORT: current.LOCAL_CONNECTOR_RUNTIME_HTTPS_PORT ?? '3443', LOCAL_SHINMONE_HTTPS_PORT: current.LOCAL_SHINMONE_HTTPS_PORT ?? '3444', CONNECTOR_RUNTIME_HTTP_PORT: current.CONNECTOR_RUNTIME_HTTP_PORT ?? '3100' });
  const tlsDir = join(ROOT, '.local-secrets/connector-local/tls');
  const certificate = join(tlsDir, 'local-facades.crt');
  const key = join(tlsDir, 'local-facades.key');
  if (!connectorTlsValid(certificate, key)) {
    run('mkcert', ['-cert-file', certificate, '-key-file', key, ...['connector-runtime.local.test', 'shinmone-upstream.local.test']], { label: 'Connector local TLS generation' });
  }
  run('openssl', ['x509', '-in', certificate, '-noout', '-checkend', '86400'], { label: 'Connector certificate validation' });
  const caroot = run('mkcert', ['-CAROOT'], { label: 'mkcert CA lookup' }).stdout.trim();
  const connectorCa = join(ROOT, '.local-secrets/connector-local/bridge/combined-local-ca.pem');
  const identityCa = join(ROOT, '.local-secrets/identity-bridge/tls/local-ca.crt');
  const caBody = [readFileSync(join(caroot, 'rootCA.pem'), 'utf8').trim(), existsSync(identityCa) ? readFileSync(identityCa, 'utf8').trim() : ''].filter(Boolean).join('\n') + '\n';
  writeFileSync(connectorCa, caBody, { mode: 0o600 });
  chmodSync(key, 0o600);
  run('node', ['dev/connector-local/generate-local-authority.mjs'], { label: 'Connector local authority generation' });
  process.stdout.write('[PASS] Connector local TLS and authority material\n');
}
function connectorTlsValid(certificatePath, keyPath) {
  if (!existsSync(certificatePath) || !existsSync(keyPath)) return false;
  try {
    const certificate = new X509Certificate(readFileSync(certificatePath));
    if (!certificate.checkHost('connector-runtime.local.test') || !certificate.checkHost('shinmone-upstream.local.test')) return false;
    if (Date.parse(certificate.validTo) <= Date.now() + 86_400_000) return false;
    const certificateKey = certificate.publicKey.export({ format: 'der', type: 'spki' });
    const privateKey = createPublicKey(createPrivateKey(readFileSync(keyPath))).export({ format: 'der', type: 'spki' });
    return certificateKey.equals(privateKey);
  } catch { return false; }
}

async function reconcileIdentityMaterial(network) {
  run('npm', ['--prefix', 'apps/identity-bridge', 'run', 'local:bootstrap'], { label: 'Identity Bridge local bootstrap', rootCause: 'IDENTITY_BRIDGE_UNAVAILABLE' });
  writeFileSync(join(STATE_DIR, 'identity-network.override.yml'), generatedIdentityOverride(network), { mode: 0o600 });
  process.stdout.write('[PASS] Identity Bridge persistent local material\n');
}

function compose(files, args, rootCause, environment = process.env) { return run('docker', ['compose', ...files, ...args], { rootCause, label: 'Docker Compose', env: environment }); }
function dockerServiceHealthy(files, service, environment = process.env) {
  const result = spawnSync('docker', ['compose', ...files, 'ps', '--format', 'json', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  if (result.status !== 0 || !result.stdout.trim()) return false;
  try {
    return result.stdout.trim().split(/\r?\n/).some((line) => {
      const row = JSON.parse(line); return row.State === 'running' && (!row.Health || row.Health === 'healthy');
    });
  } catch { return false; }
}
function dockerServiceExists(files, service, environment = process.env) {
  const result = spawnSync('docker', ['compose', ...files, 'ps', '-a', '--format', 'json', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  return result.status === 0 && Boolean(result.stdout.trim());
}
function assertUnmanagedPortFree(service, port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status === 0 && result.stdout.trim()) throw new LocalAssistantError('PORT_CONFLICT', `${service} port ${port} is already occupied.`, { service, port });
}
function cloudflaredHostname() {
  const path = state.services.cloudflared?.logPath;
  return path && existsSync(path) ? parseCloudflaredHostname(readFileSync(path, 'utf8')) : undefined;
}
function backendIdentityEnvironment(rootEnv) {
  return {
    INTERNAL_IDENTITY_JWT_ISSUER: rootEnv.GATEWAY_INTERNAL_JWT_ISSUER,
    INTERNAL_IDENTITY_JWT_AUDIENCE: rootEnv.GATEWAY_INTERNAL_JWT_AUDIENCE,
    INTERNAL_IDENTITY_JWKS_URI: `http://127.0.0.1:${PORTS.gateway}/.well-known/jwks.json`
  };
}
function gatewayEnvironment(rootEnv, databaseUrl) {
  const defaultPath = join(ROOT, '.gateway-local-keys/gateway-signing-key.pem');
  const reference = rootEnv.GATEWAY_SIGNING_KEY_REFERENCE?.trim() || `file:${defaultPath}`;
  let keyPath;
  try { keyPath = reference.startsWith('file:') ? fileURLToPath(reference) : resolveLocalKey(reference); } catch { throw new LocalAssistantError('LOCAL_ENV_INVALID', 'GATEWAY_SIGNING_KEY_REFERENCE must be a local file reference.'); }
  const keyRoot = join(ROOT, '.gateway-local-keys/');
  if (!keyPath.startsWith(keyRoot)) throw new LocalAssistantError('LOCAL_ENV_INVALID', 'Gateway local signing key must be under .gateway-local-keys/.');
  ensureGatewayKey(keyPath);
  return {
    ...rootEnv, NODE_ENV: 'development', DATABASE_URL: databaseUrl, GATEWAY_PORT: String(PORTS.gateway),
    GATEWAY_BACKEND_BASE_URL: `http://127.0.0.1:${PORTS.backend}`,
    GATEWAY_PUBLIC_JWKS_URL: `http://127.0.0.1:${PORTS.gateway}/.well-known/jwks.json`,
    GATEWAY_SIGNING_KEY_REFERENCE: reference, GATEWAY_LOCAL_SIGNING_BOOTSTRAP_ENABLED: 'true'
  };
}
function resolveLocalKey(reference) { return reference.startsWith('/') ? reference : join(ROOT, reference); }
function runDoctor(desiredNetwork) {
  const result = spawnSync('node', ['dev/local-assistant/local-doctor.mjs', '--from-start'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOCAL_ASSISTANT_EXPECTED_NETWORK: JSON.stringify(desiredNetwork) }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new LocalAssistantError(doctorFailureRootCause(result), 'Local readiness verification failed.');
}
async function reconcileFeature007(jwksUri, environment) {
  const args = ['--prefix', 'apps/gateway', 'run', 'local:feature007:provision', '--', '--jwks-uri', jwksUri];
  let result = spawnSync('npm', args, { cwd: ROOT, env: { ...process.env, ...environment }, encoding: 'utf8' });
  if (result.status === 0) return;
  run('node', ['dev/local-assistant/reconcile-feature007.mjs', '--jwks-uri', jwksUri], { env: { ...process.env, ...environment }, label: 'Feature007 local tunnel reconciliation', rootCause: 'JWKS_TUNNEL_UNAVAILABLE' });
  result = spawnSync('npm', args, { cwd: ROOT, env: { ...process.env, ...environment }, encoding: 'utf8' });
  if (result.status !== 0) throw new LocalAssistantError('JWKS_TUNNEL_UNAVAILABLE', 'Gateway local trust provisioning failed.');
}
async function rollback() {
  if (!state) return;
  for (const item of startedThisRun.reverse()) {
    try {
      if (item.kind === 'process') {
        await stopPid(state.services[item.name]?.pid);
        delete state.services[item.name];
      } else if (item.name === 'identity') compose(['-f', 'apps/identity-bridge/compose.yaml', '-f', join(STATE_DIR, 'identity-network.override.yml'), '-f', 'dev/connector-local/identity-bridge.compose.override.yml'], ['stop'], 'LOCAL_ENV_INVALID', { ...process.env, CONNECTOR_LOCAL_BRIDGE_PRIVATE_TARGET: connectorBridgePrivateTarget() });
      else if (item.name === 'connectorTls') compose(['--env-file', 'dev/connector-local/.env', '-f', 'dev/connector-local/docker-compose.yml'], ['stop', 'connector-local-tls'], 'LOCAL_ENV_INVALID');
      else if (item.name === 'postgres') compose(['-f', 'docker-compose.yml'], ['stop', 'postgres'], 'LOCAL_ENV_INVALID');
    } catch { /* retain the primary failure */ }
  }
  saveState(state);
}
