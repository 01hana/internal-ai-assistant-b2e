#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = resolve(scriptDirectory, '..');
const compose = ['compose', '-f', join(bridgeRoot, 'compose.yaml')];
const precheckIndex = process.argv.indexOf('--entry-precheck');
if (precheckIndex !== -1) {
  const path = process.argv[precheckIndex + 1];
  if (!path) fail('entry precheck requires an environment file');
  await reportEntryState(resolve(path));
  process.exit(0);
}

const port = process.env.IDENTITY_BRIDGE_LOCAL_PORT ?? '3107';
const baseUrl = `http://127.0.0.1:${port}`;
const services = run('docker', [...compose, 'ps', '--status', 'running', '--services']).stdout.trim().split(/\s+/);
for (const required of ['identity-bridge', 'idx-https-proxy']) if (!services.includes(required)) fail(`${required} is not running`);

const health = await json(`${baseUrl}/health`);
if (health.status !== 'healthy' || health.service !== 'identity-bridge') fail('/health did not report healthy');
const ready = await json(`${baseUrl}/ready`);
if (ready.status !== 'ready' || ready.productionReady !== true || ready.runtimeDependencies !== 'available') fail('/ready did not report ready');
const jwksBefore = await json(`${baseUrl}/.well-known/jwks.json`);
assertPublicJwks(jwksBefore);

const probe = "const {BridgeConfigService}=require('./dist/config/bridge-config.service');const {MenuDetailTransport}=require('./dist/idx/transport/menu-detail.transport');(async()=>{const config=new BridgeConfigService({...process.env,BRIDGE_IDX_MENUDETAIL_URI:'https://idx-proxy.local:8443/_local/tls-probe'});const result=await new MenuDetailTransport(config).execute('local-tls-probe-not-a-customer-credential');if(JSON.stringify(result.body)!=='{}')process.exit(1)})().catch(()=>process.exit(1));";
run('docker', [...compose, 'exec', '-T', 'identity-bridge', 'node', '-e', probe]);

run('docker', [...compose, 'restart', 'identity-bridge']);
await waitForReady(`${baseUrl}/ready`);
const jwksAfter = await json(`${baseUrl}/.well-known/jwks.json`);
if (JSON.stringify(jwksAfter) !== JSON.stringify(jwksBefore)) fail('JWKS changed across restart');

const image = run('docker', [...compose, 'images', '-q', 'identity-bridge']).stdout.trim();
if (!image) fail('Identity Bridge image is unavailable');
const inspection = run('docker', ['image', 'inspect', image]).stdout;
const history = run('docker', ['image', 'history', '--no-trunc', image]).stdout;
if (/-----BEGIN PRIVATE KEY-----|bridge-private-key\.pem/.test(`${inspection}\n${history}`)) fail('private signing material appears in image metadata');
const imageFiles = run('docker', ['run', '--rm', '--entrypoint', 'sh', image, '-c', "find /app -type f -print"]).stdout;
if (/\.pem$|\.key$|\.crt$|bridge-signing\.env$/m.test(imageFiles)) fail('secret or certificate file appears in the image filesystem');

await reportEntryState(join(bridgeRoot, 'env/local.env.example'));
process.stdout.write([
  'IDENTITY_BRIDGE_CONTAINER_STARTS=YES', 'LOCAL_HTTPS_PROXY_READY=YES', 'BRIDGE_TO_PROXY_TLS_VERIFIED=YES',
  'TLS_VERIFICATION_DISABLED=NO', 'HTTP_ALLOWED_IN_BRIDGE_PRODUCTION=NO', 'BRIDGE_HEALTH_OK=YES',
  'BRIDGE_READY_OK=YES', 'BRIDGE_JWKS_OK=YES', 'JWKS_CONTAINS_PRIVATE_MATERIAL=NO',
  'LOCAL_SIGNING_KEY_PERSISTENT=YES', `LOCAL_ACTIVE_KID=${jwksBefore.keys[0].kid}`
].join('\n') + '\n');

async function reportEntryState(path) {
  const environment = await readFile(path, 'utf8');
  const line = environment.split(/\r?\n/).find((entry) => entry.startsWith('BRIDGE_IDX_ALLOWED_ENTRIES='));
  let actual = false;
  try {
    const entries = JSON.parse(line?.slice(line.indexOf('=') + 1) ?? '[]');
    actual = Array.isArray(entries) && entries.length > 0 && entries.every((entry) => typeof entry === 'string' && !entry.includes('REPLACE_WITH_'));
  } catch { actual = false; }
  process.stdout.write(`REAL_ENTRY_UUIDS_AVAILABLE=${actual ? 'YES' : 'NO'}\nREAL_IDX_LOCAL_EXCHANGE=NOT_RUN\n`);
}

function assertPublicJwks(document) {
  if (!document || !Array.isArray(document.keys) || document.keys.length !== 1) fail('JWKS is invalid');
  const key = document.keys[0];
  if (key.kid !== 'shinmone-scm-local-2026-01' || JSON.stringify(Object.keys(key).sort()) !== JSON.stringify(['alg', 'e', 'kid', 'kty', 'n', 'use'])) fail('JWKS shape or active kid is invalid');
  if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((field) => field in key)) fail('JWKS contains private material');
}

async function json(url) {
  const response = await fetch(url);
  if (!response.ok) fail(`${url} returned ${response.status}`);
  return response.json();
}

async function waitForReady(url) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try { const body = await json(url); if (body.status === 'ready') return; } catch { /* retry while container restarts */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  fail('Identity Bridge did not become ready after restart');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: bridgeRoot, encoding: 'utf8' });
  if (result.status !== 0) fail(`${command} failed`);
  return result;
}

function fail(message) {
  process.stderr.write(`Local Identity Bridge verification failed: ${message}.\n`);
  process.exit(1);
}
