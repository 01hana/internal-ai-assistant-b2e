#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { ROOT, STATE_DIR, connectorBridgePrivateTarget, isManagedProcessAlive, loadState, saveState, stopPid } from './local-lib.mjs';

const state = loadState();
for (const name of ['gateway', 'backend', 'cloudflared', 'jwksProxy', 'connectorRuntime']) {
  const metadata = state.services[name];
  if (!metadata) continue;
  if (isManagedProcessAlive(metadata)) await stopPid(metadata.pid);
  delete state.services[name];
  process.stdout.write(`[STOP] ${name}\n`);
}
if (state.containers.identity?.managed && existsSync(join(STATE_DIR, 'identity-network.override.yml'))) {
  compose(['-f', 'apps/identity-bridge/compose.yaml', '-f', join(STATE_DIR, 'identity-network.override.yml'), '-f', 'dev/connector-local/identity-bridge.compose.override.yml'], ['stop'], { ...process.env, CONNECTOR_LOCAL_BRIDGE_PRIVATE_TARGET: connectorBridgePrivateTarget() });
  delete state.containers.identity;
  process.stdout.write('[STOP] Identity Bridge / IDX HTTPS proxy\n');
}
if (state.containers.connectorTls?.managed) {
  compose(['--env-file', 'dev/connector-local/.env', '-f', 'dev/connector-local/docker-compose.yml'], ['stop', 'connector-local-tls']);
  delete state.containers.connectorTls;
  process.stdout.write('[STOP] Connector HTTPS overlay\n');
}
if (state.containers.postgres?.managed) {
  compose(['-f', 'docker-compose.yml'], ['stop', 'postgres']);
  delete state.containers.postgres;
  process.stdout.write('[STOP] PostgreSQL\n');
}
delete state.cloudflaredHostname;
saveState(state);
process.stdout.write('LOCAL_ASSISTANT_STOPPED=YES\n');

function compose(files, args, environment = process.env) {
  const result = spawnSync('docker', ['compose', ...files, ...args], { cwd: ROOT, stdio: 'inherit', env: environment });
  if (result.status !== 0) process.exitCode = 1;
}
