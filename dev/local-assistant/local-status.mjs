#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { PORTS, ROOT, STATE_DIR, connectorBridgePrivateTarget, httpHealthy, isManagedProcessAlive, loadState } from './local-lib.mjs';

const state = loadState();
const processes = [
  ['Assistant Backend', 'backend', PORTS.backend, `http://127.0.0.1:${PORTS.backend}/api/v1/health`],
  ['Customer Connector Runtime', 'connectorRuntime', PORTS.connectorRuntime, `http://127.0.0.1:${PORTS.connectorRuntime}/health`],
  ['JWKS local proxy', 'jwksProxy', PORTS.jwksProxy, `http://127.0.0.1:${PORTS.jwksProxy}/.well-known/jwks.json`],
  ['cloudflared', 'cloudflared', null, state.cloudflaredHostname ? `${state.cloudflaredHostname}/.well-known/jwks.json` : null],
  ['Gateway', 'gateway', PORTS.gateway, `http://127.0.0.1:${PORTS.gateway}/health`]
];
for (const [label, key, port, url] of processes) {
  const metadata = state.services[key];
  const running = isManagedProcessAlive(metadata);
  const healthy = running && url ? await httpHealthy(url, { timeoutMs: 1500 }) : running;
  process.stdout.write(`${label}\t${running ? 'running' : 'stopped'}\t${healthy ? 'healthy' : 'unhealthy'}\tPID=${metadata?.pid ?? '-'}\tPORT=${port ?? '-'}\n`);
}
containerStatus('PostgreSQL', ['-f', 'docker-compose.yml'], 'postgres', PORTS.postgres);
containerStatus('Connector HTTPS overlay', ['--env-file', 'dev/connector-local/.env', '-f', 'dev/connector-local/docker-compose.yml'], 'connector-local-tls', `${PORTS.connectorTls},${PORTS.shinmoneTls}`);
if (existsSync(join(STATE_DIR, 'identity-network.override.yml'))) {
  const files = ['-f', 'apps/identity-bridge/compose.yaml', '-f', join(STATE_DIR, 'identity-network.override.yml'), '-f', 'dev/connector-local/identity-bridge.compose.override.yml'];
  let environment = process.env;
  try { environment = { ...process.env, CONNECTOR_LOCAL_BRIDGE_PRIVATE_TARGET: connectorBridgePrivateTarget() }; } catch { /* status remains unavailable */ }
  containerStatus('Identity Bridge', files, 'identity-bridge', PORTS.identityBridge, environment);
  containerStatus('IDX HTTPS proxy', files, 'idx-https-proxy', '-', environment);
} else {
  process.stdout.write('Identity Bridge\tstopped\tunhealthy\tCONTAINER=-\tPORT=3107\nIDX HTTPS proxy\tstopped\tunhealthy\tCONTAINER=-\tPORT=-\n');
}

function containerStatus(label, files, service, port, environment = process.env) {
  const result = spawnSync('docker', ['compose', ...files, 'ps', '--format', 'json', service], { cwd: ROOT, encoding: 'utf8', env: environment });
  let row;
  try { row = result.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))[0]; } catch { row = undefined; }
  const running = row?.State === 'running';
  const healthy = running && (!row.Health || row.Health === 'healthy');
  process.stdout.write(`${label}\t${running ? 'running' : 'stopped'}\t${healthy ? 'healthy' : 'unhealthy'}\tCONTAINER=${row?.Name ?? '-'}\tPORT=${port}\n`);
}
