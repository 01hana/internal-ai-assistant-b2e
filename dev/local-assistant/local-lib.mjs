import { createHash, generateKeyPairSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

export const ROOT = resolve(import.meta.dirname, '../..');
export const STATE_DIR = join(ROOT, '.local-state/assistant');
export const STATE_FILE = join(STATE_DIR, 'state.json');
export const BACKEND_COMPILED_ENTRYPOINT = 'dist/src/main.js';
export const HOSTS_BEGIN = '# BEGIN internal-ai-assistant-local';
export const HOSTS_END = '# END internal-ai-assistant-local';
export const HOSTNAMES = Object.freeze(['connector-runtime.local.test', 'shinmone-upstream.local.test']);
export const PORTS = Object.freeze({ postgres: 5435, backend: 3000, connectorRuntime: 3100, connectorTls: 3443, shinmoneTls: 3444, identityBridge: 3107, jwksProxy: 3110, gateway: 4000 });
export const SECRET_KEY_PATTERN = /(?:access|refresh)[_-]?token|authorization|bearer|private[_-]?key|openai[_-]?api[_-]?key|canonical[_-]?jwt/i;

export class LocalAssistantError extends Error {
  constructor(rootCause, message, details = {}) {
    super(message);
    this.name = 'LocalAssistantError';
    this.rootCause = rootCause;
    this.details = details;
  }
}

export function ensureStateDir() {
  mkdirSync(join(STATE_DIR, 'logs'), { recursive: true, mode: 0o700 });
  chmodSync(STATE_DIR, 0o700);
}

export function readEnvFile(path, { optional = false } = {}) {
  if (!existsSync(path)) {
    if (optional) return {};
    throw new LocalAssistantError('LOCAL_ENV_INVALID', `Missing local environment file: ${path}`);
  }
  const result = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new LocalAssistantError('LOCAL_ENV_INVALID', `Invalid environment entry in ${path}`);
    result[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return result;
}

export function writeEnvFile(path, values) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const body = `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join('\n')}\n`;
  atomicWrite(path, body, 0o600);
}

export function loadState() {
  ensureStateDir();
  if (!existsSync(STATE_FILE)) return { version: 1, services: {}, containers: {} };
  try {
    const value = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!value || value.version !== 1 || typeof value.services !== 'object' || typeof value.containers !== 'object') throw new Error();
    assertSafeState(value);
    return value;
  } catch {
    throw new LocalAssistantError('LOCAL_ENV_INVALID', 'Local Assistant state is invalid; inspect .local-state/assistant/state.json.');
  }
}

export function saveState(state) {
  assertSafeState(state);
  state.updatedAt = new Date().toISOString();
  atomicWrite(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 0o600);
}

export function assertSafeState(value, keyPath = '') {
  if (Array.isArray(value)) return value.forEach((entry, index) => assertSafeState(entry, `${keyPath}.${index}`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const path = keyPath ? `${keyPath}.${key}` : key;
    if (SECRET_KEY_PATTERN.test(key)) throw new LocalAssistantError('LOCAL_ENV_INVALID', `Secret-like state field is prohibited: ${path}`);
    assertSafeState(child, path);
  }
}

export function commandExists(command) {
  return spawnSync('sh', ['-c', `command -v ${shellWord(command)} >/dev/null 2>&1`]).status === 0;
}

export function prerequisiteReport({ needsMkcert = false } = {}) {
  const commands = ['node', 'npm', 'docker'];
  if (needsMkcert) commands.push('mkcert');
  const missing = commands.filter((command) => !commandExists(command));
  if (!missing.includes('node')) {
    const major = Number((spawnSync('node', ['--version'], { encoding: 'utf8' }).stdout ?? '').match(/^v(\d+)/)?.[1]);
    if (!Number.isInteger(major) || major < 22) missing.push('node-version');
  }
  if (!missing.includes('docker')) {
    if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) missing.push('docker-daemon');
    if (spawnSync('docker', ['compose', 'version'], { stdio: 'ignore' }).status !== 0) missing.push('docker-compose');
  }
  return [...new Set(missing)];
}

export function missingPrerequisites({ available, dockerDaemon = true, dockerCompose = true, needsMkcert = false, needsCloudflared = true }) {
  const required = ['node', 'npm', 'docker', ...(needsMkcert ? ['mkcert'] : []), ...(needsCloudflared ? ['cloudflared'] : [])];
  const missing = required.filter((name) => !available.includes(name));
  if (available.includes('docker') && !dockerDaemon) missing.push('docker-daemon');
  if (available.includes('docker') && !dockerCompose) missing.push('docker-compose');
  return [...new Set(missing)];
}

export function prerequisiteHint(name) {
  const hints = {
    node: 'Install Node.js 22 or newer, then rerun npm run local:start.',
    'node-version': 'Upgrade to Node.js 22 or newer, then rerun npm run local:start.',
    npm: 'Install npm with Node.js 22 or newer, then rerun npm run local:start.',
    docker: 'Install Docker Desktop and enable Docker Compose, then rerun npm run local:start.',
    'docker-daemon': 'Start Docker Desktop and wait for the Docker daemon, then rerun npm run local:start.',
    'docker-compose': 'Install the Docker Compose v2 plugin, then rerun npm run local:start.',
    cloudflared: 'Install cloudflared (for example: brew install cloudflared), then rerun npm run local:start.',
    mkcert: 'Install mkcert (for example: brew install mkcert); do not install its CA into a system trust store.'
  };
  return hints[name] ?? `Install ${name}, then rerun npm run local:start.`;
}

export function validateRootEnvironment(environment) {
  const required = [
    'DATABASE_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB', 'LLM_MODEL', 'OPENAI_API_KEY',
    'GATEWAY_INTERNAL_JWT_ISSUER', 'GATEWAY_INTERNAL_JWT_AUDIENCE', 'GATEWAY_ALLOWED_ORIGINS'
  ];
  const missing = required.filter((key) => !environment[key]?.trim());
  const placeholders = ['LLM_MODEL', 'OPENAI_API_KEY'].filter((key) => /placeholder|change[-_ ]?me|your[-_ ]/i.test(environment[key] ?? ''));
  const invalid = [];
  if (environment.GATEWAY_INTERNAL_JWT_TTL_SECONDS !== undefined && environment.GATEWAY_INTERNAL_JWT_TTL_SECONDS !== '300') invalid.push('GATEWAY_INTERNAL_JWT_TTL_SECONDS');
  const tolerance = Number(environment.GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS ?? '0');
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 300) invalid.push('GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS');
  try {
    const issuer = new URL(environment.GATEWAY_INTERNAL_JWT_ISSUER);
    if (!['http:', 'https:'].includes(issuer.protocol)) invalid.push('GATEWAY_INTERNAL_JWT_ISSUER');
  } catch { if (!missing.includes('GATEWAY_INTERNAL_JWT_ISSUER')) invalid.push('GATEWAY_INTERNAL_JWT_ISSUER'); }
  const origins = (environment.GATEWAY_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (!missing.includes('GATEWAY_ALLOWED_ORIGINS') && (origins.length === 0 || origins.includes('*') || origins.some((value) => { try { return !['http:', 'https:'].includes(new URL(value).protocol); } catch { return true; } }))) invalid.push('GATEWAY_ALLOWED_ORIGINS');
  return { valid: missing.length === 0 && placeholders.length === 0 && invalid.length === 0, missing, placeholders, invalid: [...new Set(invalid)] };
}

export function hostDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    if (url.hostname === 'postgres') {
      url.hostname = '127.0.0.1';
      url.port = String(PORTS.postgres);
    }
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) throw new Error();
    return url.toString();
  } catch {
    throw new LocalAssistantError('LOCAL_ENV_INVALID', 'DATABASE_URL must target the local Compose postgres service or loopback.');
  }
}

export function connectorBridgePrivateTarget() {
  const environment = readEnvFile(join(ROOT, '.local-secrets/connector-local/bridge.env'));
  try {
    const profile = JSON.parse(environment.BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON);
    const reference = profile?.keys?.find((key) => key.status === 'active')?.privateKeyReference;
    const url = new URL(reference);
    if (url.protocol !== 'file:' || !url.pathname.startsWith('/')) throw new Error();
    return fileURLToPath(url);
  } catch {
    throw new LocalAssistantError('LOCAL_ENV_INVALID', 'Generated Bridge binding key reference is invalid.');
  }
}

export function detectLanAddress(dependencies = {}) {
  const run = dependencies.run ?? spawnSync;
  if (process.platform === 'darwin') {
    const route = run('route', ['-n', 'get', 'default'], { encoding: 'utf8' });
    const interfaceName = /interface:\s*(\S+)/.exec(route.stdout ?? '')?.[1];
    if (interfaceName) {
      const address = run('ipconfig', ['getifaddr', interfaceName], { encoding: 'utf8' }).stdout?.trim();
      if (isUsableIpv4(address)) return { interfaceName, address };
    }
  }
  for (const [interfaceName, addresses] of Object.entries(networkInterfaces())) {
    for (const item of addresses ?? []) if (item.family === 'IPv4' && !item.internal && isUsableIpv4(item.address)) return { interfaceName, address: item.address };
  }
  throw new LocalAssistantError('LOCAL_ENV_INVALID', 'No active non-loopback IPv4 interface was detected.');
}

export function parseIpv4Routes(text) {
  const routes = [];
  for (const line of String(text).split(/\r?\n/)) {
    for (const match of line.matchAll(/(?:^|\s)((?:\d{1,3}\.){3}\d{1,3})(?:\/(\d{1,2}))?(?=\s|$)/g)) {
      const prefix = match[2] === undefined ? (match[1].endsWith('.0') ? 24 : 32) : Number(match[2]);
      if (validIpv4(match[1]) && prefix >= 0 && prefix <= 32) routes.push(`${match[1]}/${prefix}`);
    }
  }
  return [...new Set(routes)];
}

export function selectDockerSubnet(routeCidrs, dockerCidrs = [], previous) {
  const candidates = ['172.30.70.0/24', '172.31.70.0/24', '172.29.70.0/24', '10.250.70.0/24', '10.251.70.0/24'];
  const occupied = [...routeCidrs, ...dockerCidrs];
  const ordered = previous && candidates.includes(previous) ? [previous, ...candidates.filter((item) => item !== previous)] : candidates;
  const subnet = ordered.find((candidate) => occupied.every((item) => !cidrOverlaps(candidate, item)));
  if (!subnet) throw new LocalAssistantError('DOCKER_ROUTE_COLLISION', 'No collision-free local Docker subnet is available.');
  const prefix = subnet.slice(0, subnet.lastIndexOf('.') + 1);
  return { subnet, idxAddress: `${prefix}10`, bridgeAddress: `${prefix}20` };
}

export function collectRouteCidrs() {
  const commands = process.platform === 'darwin' ? [['netstat', ['-rn', '-f', 'inet']]] : [['ip', ['-4', 'route', 'show']]];
  return parseIpv4Routes(commands.map(([command, args]) => spawnSync(command, args, { encoding: 'utf8' }).stdout ?? '').join('\n'));
}

export function collectDockerCidrs(excludedNames = ['feature007-local-rehearsal_rehearsal']) {
  const ids = spawnSync('docker', ['network', 'ls', '-q'], { encoding: 'utf8' }).stdout?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (ids.length === 0) return [];
  const result = spawnSync('docker', ['network', 'inspect', ...ids], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  try {
    return JSON.parse(result.stdout)
      .filter((network) => !excludedNames.includes(network.Name))
      .flatMap((network) => network.IPAM?.Config?.map((entry) => entry.Subnet).filter(Boolean) ?? []);
  } catch { return []; }
}

export function renderHostsBlock(ip) {
  if (!isUsableIpv4(ip)) throw new LocalAssistantError('LOCAL_HOST_MAPPING_STALE', 'Host mapping requires a non-loopback IPv4 address.');
  return `${HOSTS_BEGIN}\n${ip} ${HOSTNAMES.join(' ')}\n${HOSTS_END}`;
}

export function updateHostsContent(content, ip) {
  const block = renderHostsBlock(ip);
  const pattern = new RegExp(`${escapeRegex(HOSTS_BEGIN)}[\\s\\S]*?${escapeRegex(HOSTS_END)}\\n?`, 'g');
  const matches = String(content).match(pattern) ?? [];
  if (matches.length > 1) throw new LocalAssistantError('LOCAL_HOST_MAPPING_STALE', 'Multiple managed /etc/hosts blocks were found.');
  const without = String(content).replace(pattern, '').replace(/\s+$/, '');
  return `${without}\n\n${block}\n`;
}

export function hostsBlockMatches(content, ip) {
  try { return String(content).includes(renderHostsBlock(ip)); } catch { return false; }
}

export async function verifyHostMappings(ip, resolver = lookup) {
  for (const hostname of HOSTNAMES) {
    const result = await resolver(hostname, { family: 4 });
    if (result.address !== ip) throw new LocalAssistantError('LOCAL_HOST_MAPPING_STALE', `${hostname} does not resolve to the active LAN address.`);
  }
}

export function parseCloudflaredHostname(text) {
  const matches = String(text).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi) ?? [];
  return matches.at(-1)?.toLowerCase();
}

export function processAction({ metadata, alive, healthy, configHash }) {
  if (!metadata || !alive) return 'START';
  if (metadata.configHash !== configHash) return 'RESTART';
  return healthy ? 'REUSE' : 'RESTART';
}

export function portDisposition({ ownerPid, managedPid }) {
  if (!ownerPid) return 'FREE';
  return ownerPid === managedPid ? 'MANAGED' : 'CONFLICT';
}

export function networkChanged(previous, current) {
  return !previous || previous.lanIp !== current.lanIp || previous.subnet !== current.subnet;
}

export function beginNetworkReconciliation(applied, desired) {
  const snapshot = applied ? Object.freeze({ ...applied }) : undefined;
  const target = Object.freeze({ ...desired });
  return Object.freeze({
    applied: snapshot,
    desired: target,
    changed: networkChanged(snapshot, target),
    commit(state) { state.network = { ...target }; }
  });
}

export function inspectDockerPublishedBindings({ composeArgs, service, environment = process.env, execute = spawnSync }) {
  const ps = execute('docker', ['compose', ...composeArgs, 'ps', '-q', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  const containerIds = ps.status === 0 ? String(ps.stdout ?? '').trim().split(/\s+/).filter(Boolean) : [];
  if (containerIds.length !== 1) return Object.freeze({ confirmed: false, bindings: {} });
  const inspect = execute('docker', ['inspect', '--format', '{{json .NetworkSettings.Ports}}', containerIds[0]], { cwd: ROOT, encoding: 'utf8', env: environment });
  if (inspect.status !== 0) return Object.freeze({ confirmed: false, bindings: {} });
  try {
    return Object.freeze({ confirmed: true, bindings: parseDockerPublishedBindings(inspect.stdout) });
  } catch { return Object.freeze({ confirmed: false, bindings: {} }); }
}

export function parseDockerPublishedBindings(value) {
  const document = typeof value === 'string' ? JSON.parse(value) : value;
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('invalid Docker port bindings');
  const bindings = {};
  for (const [containerPort, entries] of Object.entries(document)) {
    if (!Array.isArray(entries)) continue;
    bindings[containerPort] = entries.flatMap((entry) => {
      if (!entry || typeof entry.HostIp !== 'string' || typeof entry.HostPort !== 'string') return [];
      return [{ hostIp: entry.HostIp, hostPort: entry.HostPort }];
    });
  }
  return Object.freeze(bindings);
}

export function connectorTlsBindingsMatch(inspection, lanIp, runtimePort = PORTS.connectorTls, upstreamPort = PORTS.shinmoneTls) {
  if (!inspection?.confirmed) return false;
  const expected = [
    ['3443/tcp', String(runtimePort)],
    ['3444/tcp', String(upstreamPort)]
  ];
  return expected.every(([containerPort, hostPort]) => {
    const entries = inspection.bindings?.[containerPort];
    return Array.isArray(entries) && entries.length === 1 && entries[0].hostIp === lanIp && entries[0].hostPort === hostPort;
  });
}

export function connectorTlsAction({ exists, healthy, configChanged, networkChanged: changed, bindingsMatch }) {
  if (!exists) return 'START';
  if (healthy && !configChanged && !changed && bindingsMatch) return 'REUSE';
  return 'RECREATE';
}

const BRIDGE_BINDING_ENV_KEYS = Object.freeze([
  'BRIDGE_CONNECTOR_BINDING_URI',
  'BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY'
]);

export function inspectDockerContainerEnvironment({ composeArgs, service, environment = process.env, execute = spawnSync }) {
  const containerId = dockerComposeContainerId(composeArgs, service, environment, execute);
  if (!containerId) return Object.freeze({ confirmed: false, environment: {} });
  const inspect = execute('docker', ['inspect', '--format', '{{json .Config.Env}}', containerId], { cwd: ROOT, encoding: 'utf8', env: environment });
  if (inspect.status !== 0) return Object.freeze({ confirmed: false, environment: {} });
  try {
    const entries = JSON.parse(String(inspect.stdout ?? ''));
    if (!Array.isArray(entries)) throw new Error('invalid Docker environment');
    const selected = {};
    for (const entry of entries) {
      const separator = typeof entry === 'string' ? entry.indexOf('=') : -1;
      if (separator < 1) continue;
      const key = entry.slice(0, separator);
      if (BRIDGE_BINDING_ENV_KEYS.includes(key)) selected[key] = entry.slice(separator + 1);
    }
    return Object.freeze({ confirmed: true, environment: Object.freeze(selected) });
  } catch { return Object.freeze({ confirmed: false, environment: {} }); }
}

export function inspectDockerContainerDns({ composeArgs, service, hostname, environment = process.env, execute = spawnSync }) {
  const containerId = dockerComposeContainerId(composeArgs, service, environment, execute);
  if (!containerId || typeof hostname !== 'string' || !hostname) return Object.freeze({ confirmed: false, addresses: [] });
  const script = "require('node:dns').promises.lookup(process.argv[1],{all:true}).then(v=>process.stdout.write(JSON.stringify(v.map(x=>x.address)))).catch(()=>process.exitCode=1)";
  const result = execute('docker', ['exec', containerId, 'node', '-e', script, hostname], { cwd: ROOT, encoding: 'utf8', env: environment });
  if (result.status !== 0) return Object.freeze({ confirmed: false, addresses: [] });
  try {
    const addresses = JSON.parse(String(result.stdout ?? ''));
    if (!Array.isArray(addresses) || !addresses.length || addresses.some((value) => typeof value !== 'string')) throw new Error('invalid DNS result');
    return Object.freeze({ confirmed: true, addresses: Object.freeze([...new Set(addresses)].sort()) });
  } catch { return Object.freeze({ confirmed: false, addresses: [] }); }
}

export function bridgeBindingDeploymentMatches(inspection, desiredEnvironment) {
  if (!inspection?.confirmed) return false;
  const actual = inspection.environment ?? {};
  if (actual.BRIDGE_CONNECTOR_BINDING_URI !== desiredEnvironment?.BRIDGE_CONNECTOR_BINDING_URI) return false;
  return semanticJsonEqual(
    actual.BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY,
    desiredEnvironment?.BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY
  );
}

export function bridgeBindingRouteMatches({ actualInspection, desiredEnvironment, dnsInspection, currentLanIp }) {
  if (!bridgeBindingDeploymentMatches(actualInspection, desiredEnvironment) || !dnsInspection?.confirmed) return false;
  let uri;
  let policy;
  try {
    uri = new URL(desiredEnvironment.BRIDGE_CONNECTOR_BINDING_URI);
    policy = JSON.parse(desiredEnvironment.BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY);
  } catch { return false; }
  if (uri.protocol !== 'https:' || uri.hostname !== 'connector-runtime.local.test') return false;
  if (!policy || policy.mode !== 'allowlisted_networks' || !Array.isArray(policy.allowedCidrs) || !policy.allowedCidrs.length) return false;
  return dnsInspection.addresses.length > 0 && dnsInspection.addresses.every((address) =>
    address === currentLanIp && policy.allowedCidrs.some((cidr) => {
      const range = cidrRange(cidr);
      return range && validIpv4(address) && ipv4Number(address) >= range[0] && ipv4Number(address) <= range[1];
    })
  );
}

export function identityBridgeAction({ exists, healthy, configChanged, networkChanged: changed, deploymentMatches }) {
  if (!exists) return 'START';
  if (healthy && !configChanged && !changed && deploymentMatches) return 'REUSE';
  return 'RECREATE';
}

export function beginAppliedConfigReconciliation(appliedHash, desiredHash) {
  return Object.freeze({
    changed: Boolean(appliedHash && appliedHash !== desiredHash),
    commit(state, name, managed) { state.containers[name] = { managed, configHash: desiredHash }; }
  });
}

export function idxVerifierRootCause(status) {
  if (status === 20) return 'IDX_TRANSPORT_UNAVAILABLE';
  if (status === 21) return 'CONNECTOR_BINDING_UNAVAILABLE';
  return 'IDENTITY_BRIDGE_UNAVAILABLE';
}

export function doctorRootCauseFor(checks, missing = []) {
  if (missing.length) return 'PREREQUISITE_MISSING';
  const causes = Object.freeze({
    OPENAI_CONFIG: 'LOCAL_ENV_INVALID', POSTGRES: 'POSTGRES_UNAVAILABLE', BACKEND: 'BACKEND_UNAVAILABLE',
    CONNECTOR_RUNTIME: 'CONNECTOR_RUNTIME_UNAVAILABLE', CONNECTOR_TLS_OVERLAY: 'CONNECTOR_TLS_OVERLAY_UNAVAILABLE',
    IDENTITY_BRIDGE: 'IDENTITY_BRIDGE_UNAVAILABLE', IDX_PROXY: 'IDX_PROXY_UNAVAILABLE',
    BRIDGE_CONNECTOR_BINDING_ROUTE: 'BRIDGE_CONNECTOR_BINDING_ROUTE_STALE', GATEWAY: 'GATEWAY_UNAVAILABLE',
    JWKS_TRUST: 'JWKS_TUNNEL_UNAVAILABLE', LOCAL_HOST_MAPPING: 'LOCAL_HOST_MAPPING_STALE', LOCAL_DOCKER_NETWORK: 'DOCKER_ROUTE_COLLISION'
  });
  for (const name of ['OPENAI_CONFIG', 'POSTGRES', 'BACKEND', 'CONNECTOR_RUNTIME', 'CONNECTOR_TLS_OVERLAY', 'IDENTITY_BRIDGE', 'IDX_PROXY', 'BRIDGE_CONNECTOR_BINDING_ROUTE', 'GATEWAY', 'JWKS_TRUST', 'LOCAL_HOST_MAPPING', 'LOCAL_DOCKER_NETWORK']) {
    if (checks[name] !== 'PASS') return causes[name];
  }
  return 'NONE';
}

export function doctorFailureRootCause(result) {
  const output = `${result?.stdout ?? ''}\n${result?.stderr ?? ''}`;
  const cause = /^ROOT_CAUSE=([A-Z0-9_]+)$/m.exec(output)?.[1];
  return cause && cause !== 'NONE' ? cause : 'LOCAL_ENV_INVALID';
}

export function rollbackTargets(started) {
  return [...started].reverse().filter((entry) => entry?.kind === 'process' || entry?.kind === 'container');
}

export function managedStopTargets(state) {
  const processes = Object.keys(state.services ?? {});
  const containers = Object.entries(state.containers ?? {}).filter(([, value]) => value?.managed === true).map(([name]) => name);
  return { processes, containers };
}

export function statusRecord({ running, healthy, id = '-', port = '-' }) {
  return Object.freeze({ running: running ? 'running' : 'stopped', health: healthy ? 'healthy' : 'unhealthy', id, port });
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function isManagedProcessAlive(metadata) {
  if (!metadata || !isPidAlive(metadata.pid) || !metadata.command || !Array.isArray(metadata.args)) return false;
  const result = spawnSync('ps', ['-p', String(metadata.pid), '-o', 'command='], { encoding: 'utf8' });
  if (result.status !== 0) return false;
  const commandLine = result.stdout.trim();
  const executable = metadata.command.split('/').at(-1);
  return commandLine.includes(executable) && metadata.args.every((argument) => commandLine.includes(String(argument)));
}

export function portOwner(port) {
  const result = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status !== 0) return undefined;
  const pid = Number(result.stdout.trim().split(/\s+/)[0]);
  return Number.isInteger(pid) ? pid : undefined;
}

export async function httpHealthy(url, options = {}) {
  try {
    const response = await globalThis.fetch(url, { signal: globalThis.AbortSignal.timeout(options.timeoutMs ?? 1500) });
    if (!response.ok) return false;
    if (!options.expect) return true;
    const body = await response.json();
    return options.expect(body);
  } catch { return false; }
}

export async function waitFor(check, { timeoutMs = 60_000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    if (await check()) return true;
    await new Promise((resolvePromise) => globalThis.setTimeout(resolvePromise, intervalMs));
  } while (Date.now() < deadline);
  return false;
}

export async function startManagedProcess({ state, name, command, args, environment, port, health, configInputs = [], startupTimeoutMs = 60_000 }) {
  ensureStateDir();
  const configHash = hashFilesAndValues(configInputs, { command, args, port });
  const existing = state.services[name];
  const alive = isManagedProcessAlive(existing);
  const healthy = alive ? await health() : false;
  const action = processAction({ metadata: existing, alive, healthy, configHash });
  if (action === 'REUSE') return action;
  if (alive) await stopPid(existing.pid);
  const owner = port > 0 ? portOwner(port) : undefined;
  if (owner) throw new LocalAssistantError('PORT_CONFLICT', `${name} cannot use port ${port}; it is owned by unmanaged PID ${owner}.`, { service: name, port });
  const logPath = join(STATE_DIR, 'logs', `${name}.log`);
  writeFileSync(logPath, `[${new Date().toISOString()}] starting ${name}\n`, { mode: 0o600 });
  const descriptor = openSync(logPath, 'a', 0o600);
  const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...environment }, detached: true, stdio: ['ignore', descriptor, descriptor] });
  if (!child.pid) throw new LocalAssistantError(rootCauseFor(name), `${name} could not be started.`);
  child.unref();
  state.services[name] = { pid: child.pid, port, command, args, configHash, logPath, startedAt: new Date().toISOString() };
  saveState(state);
  const ready = await waitFor(async () => !isPidAlive(child.pid) ? false : health(), { timeoutMs: startupTimeoutMs });
  if (!ready) {
    await stopPid(child.pid);
    delete state.services[name];
    saveState(state);
    throw new LocalAssistantError(rootCauseFor(name), `${name} did not become healthy; inspect ${logPath}.`);
  }
  return action;
}

export async function stopPid(pid) {
  if (!isPidAlive(pid)) return;
  try { process.kill(-pid, 'SIGTERM'); } catch { try { process.kill(pid, 'SIGTERM'); } catch { return; } }
  const stopped = await waitFor(() => !isPidAlive(pid), { timeoutMs: 5000, intervalMs: 100 });
  if (!stopped) try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ }
}

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const safe = redact(`${result.stderr ?? ''}\n${result.stdout ?? ''}`).trim();
    throw new LocalAssistantError(options.rootCause ?? 'LOCAL_ENV_INVALID', `${options.label ?? command} failed${safe ? `: ${safe.slice(0, 500)}` : '.'}`);
  }
  return result;
}

export function redact(text) {
  return String(text)
    .replace(/(OPENAI_API_KEY|ACCESS_TOKEN|REFRESH_TOKEN|AUTHORIZATION|PRIVATE_KEY)\s*[=:]\s*[^\s]+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [REDACTED]')
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED JWT]');
}

export function ensureGatewayKey(path) {
  if (existsSync(path)) return false;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
  writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
  return true;
}

export function hashFilesAndValues(paths, values = {}) {
  const hash = createHash('sha256').update(JSON.stringify(values));
  for (const path of paths) hash.update(path).update(existsSync(path) ? readFileSync(path) : 'MISSING');
  return hash.digest('hex');
}

export function generatedIdentityOverride(network) {
  return `services:\n  identity-bridge:\n    environment:\n      IDX_ALLOWED_CIDRS: ${network.idxAddress}/32\n    networks:\n      rehearsal:\n        ipv4_address: ${network.bridgeAddress}\n  idx-https-proxy:\n    networks:\n      rehearsal:\n        aliases: [idx-proxy.local]\n        ipv4_address: ${network.idxAddress}\nnetworks:\n  rehearsal:\n    ipam:\n      config:\n        - subnet: ${network.subnet}\n`;
}

export function rootCauseFor(name) {
  return ({ backend: 'BACKEND_UNAVAILABLE', connectorRuntime: 'CONNECTOR_RUNTIME_UNAVAILABLE', jwksProxy: 'JWKS_TUNNEL_UNAVAILABLE', cloudflared: 'JWKS_TUNNEL_UNAVAILABLE', gateway: 'GATEWAY_UNAVAILABLE' })[name] ?? 'LOCAL_ENV_INVALID';
}

function validIpv4(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
function isUsableIpv4(value) { return validIpv4(value) && !String(value).startsWith('127.') && value !== '0.0.0.0'; }
function ipv4Number(value) { return String(value).split('.').reduce((total, part) => ((total << 8) | Number(part)) >>> 0, 0); }
function cidrRange(cidr) {
  const [address, prefixText] = String(cidr).split('/');
  if (!validIpv4(address)) return undefined;
  const prefix = Number(prefixText ?? 32);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return undefined;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = ipv4Number(address) & mask;
  return [start >>> 0, (start | (~mask >>> 0)) >>> 0];
}
function cidrOverlaps(left, right) {
  const a = cidrRange(left); const b = cidrRange(right);
  return a && b ? a[0] <= b[1] && b[0] <= a[1] : false;
}
function dockerComposeContainerId(composeArgs, service, environment, execute) {
  const ps = execute('docker', ['compose', ...composeArgs, 'ps', '-q', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  const containerIds = ps.status === 0 ? String(ps.stdout ?? '').trim().split(/\s+/).filter(Boolean) : [];
  return containerIds.length === 1 ? containerIds[0] : undefined;
}
function semanticJsonEqual(left, right) {
  try { return canonicalJson(JSON.parse(left)) === canonicalJson(JSON.parse(right)); } catch { return false; }
}
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).sort().join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function atomicWrite(path, content, mode) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, content, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, path);
}
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function shellWord(value) { if (!/^[A-Za-z0-9_.-]+$/.test(value)) throw new Error('unsafe command'); return value; }
