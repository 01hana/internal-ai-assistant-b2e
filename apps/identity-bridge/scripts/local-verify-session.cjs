#!/usr/bin/env node
'use strict';

const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { readHiddenToken } = require('./local-verify-idx.cjs');

const BRIDGE_EXCHANGE_URL = 'http://127.0.0.1:3107/identity/exchange';
const GATEWAY_SESSION_URL = 'http://127.0.0.1:4000/api/v1/assistant/sessions';
const REQUEST_TIMEOUT_MS = 12_000;
const EXPECTED_CUSTOMER = 'customer-shinmone-scm-local';
const EXPECTED_HOST_APP = 'shinmone-scm';
const repositoryRoot = resolve(__dirname, '../../..');

class LocalSessionTimeoutError extends Error {
  constructor() { super('local_session_timeout'); this.name = 'LocalSessionTimeoutError'; }
}

async function executeSessionVerifier(options = {}) {
  const stdout = options.stdout ?? ((value) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value) => process.stderr.write(value));
  const argv = options.argv ?? process.argv.slice(2);
  const interactive = options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const readToken = options.readToken ?? readHiddenToken;
  const bridge = options.bridge ?? defaultBridgeExchange;
  const gateway = options.gateway ?? defaultGatewaySession;
  const inspectSession = options.inspectSession ?? defaultInspectSession;
  const uuid = options.randomUUID ?? randomUUID;
  const evidence = initialEvidence();

  if (!Array.isArray(argv) || argv.length !== 0 || interactive !== true) return finish(stdout, evidence, 'INCONCLUSIVE');

  let nativeToken;
  let canonicalToken;
  try {
    nativeToken = await readToken();
    if (!nonBlank(nativeToken) || /\s/.test(nativeToken)) return finish(stdout, evidence, 'INCONCLUSIVE');
    evidence.NATIVE_TOKEN_INPUT_RECEIVED = 'YES';

    evidence.BRIDGE_EXCHANGE_REQUEST_STARTED = 'YES';
    let bridgeResponse;
    try {
      bridgeResponse = await bridge(nativeToken, Object.freeze({ url: BRIDGE_EXCHANGE_URL, method: 'POST', body: undefined }));
    } catch (error) {
      return finish(stdout, evidence, error instanceof LocalSessionTimeoutError ? 'TIMEOUT' : 'BRIDGE');
    }
    evidence.BRIDGE_EXCHANGE_HTTP_STATUS = integerStatus(bridgeResponse?.status);
    if (!validBridgeResponse(bridgeResponse)) return finish(stdout, evidence, 'BRIDGE');
    canonicalToken = bridgeResponse.body.accessToken;
    evidence.BRIDGE_CANONICAL_JWT_RECEIVED = 'YES';

    const requestId = uuid();
    if (!nonBlank(requestId)) return finish(stdout, evidence, 'INCONCLUSIVE');
    evidence.GATEWAY_SESSION_REQUEST_STARTED = 'YES';
    let gatewayResponse;
    try {
      gatewayResponse = await gateway(canonicalToken, Object.freeze({
        url: GATEWAY_SESSION_URL,
        method: 'POST',
        headers: Object.freeze({ 'content-type': 'application/json', 'x-request-id': requestId }),
        body: Object.freeze({ pageContext: Object.freeze({}) })
      }));
    } catch (error) {
      return finish(stdout, evidence, error instanceof LocalSessionTimeoutError ? 'TIMEOUT' : 'GATEWAY_INFRASTRUCTURE');
    }
    evidence.GATEWAY_SESSION_HTTP_STATUS = integerStatus(gatewayResponse?.status);
    if (gatewayResponse?.status !== 201) return finish(stdout, evidence, gatewayFailureStage(gatewayResponse));
    const session = gatewaySuccess(gatewayResponse.body);
    if (!session) return finish(stdout, evidence, 'BACKEND_SESSION');
    evidence.GATEWAY_SESSION_ID_RECEIVED = 'YES';
    evidence.GATEWAY_SESSION_STATUS_ACTIVE = 'YES';

    let persisted;
    try { persisted = await inspectSession(session.sessionId); } catch { return finish(stdout, evidence, 'INCONCLUSIVE'); }
    if (!plain(persisted)) return finish(stdout, evidence, 'INCONCLUSIVE');
    evidence.SESSION_CUSTOMER_MATCH = persisted.customerId === EXPECTED_CUSTOMER ? 'YES' : 'NO';
    evidence.SESSION_HOST_APP_MATCH = persisted.hostApp === EXPECTED_HOST_APP ? 'YES' : 'NO';
    if (evidence.SESSION_CUSTOMER_MATCH !== 'YES' || evidence.SESSION_HOST_APP_MATCH !== 'YES') {
      return finish(stdout, evidence, 'GATEWAY_IDENTITY');
    }

    evidence.REAL_LOCAL_SESSION_BOOTSTRAP = 'PASS';
    return finish(stdout, evidence);
  } catch {
    return finish(stderr, evidence, 'INCONCLUSIVE');
  } finally {
    nativeToken = undefined;
    canonicalToken = undefined;
  }
}

async function defaultBridgeExchange(nativeToken, request, options = {}) {
  return fetchJson(request, { authorization: `Bearer ${nativeToken}` }, options);
}

async function defaultGatewaySession(canonicalToken, request, options = {}) {
  return fetchJson(request, { ...request.headers, authorization: `Bearer ${canonicalToken}` }, options);
}

async function fetchJson(request, headers, options) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : REQUEST_TIMEOUT_MS;
  const controller = options.controller ?? new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: Object.freeze(headers),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
      signal: controller.signal
    });
    let body;
    try { body = await response.json(); } catch { body = undefined; }
    return Object.freeze({ status: response.status, body });
  } catch {
    if (controller.signal.aborted) throw new LocalSessionTimeoutError();
    throw new Error('local_session_request_failed');
  } finally {
    clearTimeout(timer);
  }
}

function defaultInspectSession(sessionId, options = {}) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(sessionId)) throw new Error('local_session_inspection_invalid');
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? readDatabaseUrl();
  const database = localDatabase(databaseUrl);
  const run = options.spawnSync ?? spawnSync;
  const childEnvironment = Object.fromEntries(Object.entries({
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    PGPASSWORD: database.password,
    PGCONNECT_TIMEOUT: '5'
  }).filter(([, value]) => typeof value === 'string'));
  const result = run('psql', [
    '--no-psqlrc', '--no-password', '--tuples-only', '--no-align', '--field-separator=\t',
    '--set=ON_ERROR_STOP=1', `--set=session_id=${sessionId}`,
    '--host', database.hostname, '--port', database.port, '--username', database.username, '--dbname', database.database
  ], {
    encoding: 'utf8',
    input: 'SELECT "customerId", "hostApp" FROM "AssistantSession" WHERE "id" = :\'session_id\';\n',
    env: childEnvironment,
    timeout: REQUEST_TIMEOUT_MS,
    maxBuffer: 16 * 1024
  });
  if (result.status !== 0 || result.error || typeof result.stdout !== 'string') throw new Error('local_session_inspection_failed');
  const rows = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  if (rows.length !== 1) return null;
  const fields = rows[0].split('\t');
  if (fields.length !== 2) throw new Error('local_session_inspection_failed');
  return Object.freeze({ customerId: fields[0], hostApp: fields[1] });
}

function readDatabaseUrl() {
  const content = readFileSync(join(repositoryRoot, '.env'), 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator > 0 && line.slice(0, separator) === 'DATABASE_URL') return line.slice(separator + 1);
  }
  throw new Error('local_session_database_unavailable');
}

function localDatabase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('local_session_database_invalid'); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['postgresql:', 'postgres:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(hostname)
    || url.pathname !== '/assistant_dev'
    || !url.username || !url.password) throw new Error('local_session_database_invalid');
  return Object.freeze({ hostname, port: url.port || '5432', username: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: 'assistant_dev' });
}

function validBridgeResponse(response) {
  if (response?.status !== 200 || !plain(response.body) || !exactKeys(response.body, ['accessToken', 'tokenType', 'expiresIn'])) return false;
  return nonBlank(response.body.accessToken) && !/\s/.test(response.body.accessToken)
    && response.body.tokenType === 'Bearer' && response.body.expiresIn === 300;
}

function gatewaySuccess(body) {
  if (!plain(body) || !exactKeys(body, ['requestId', 'data']) || !nonBlank(body.requestId) || !plain(body.data)
    || !exactKeys(body.data, ['sessionId', 'status']) || !nonBlank(body.data.sessionId) || body.data.status !== 'active') return undefined;
  return Object.freeze({ sessionId: body.data.sessionId });
}

function gatewayFailureStage(response) {
  if (response?.status === 401) return 'GATEWAY_AUTH';
  if (response?.status === 403) return 'GATEWAY_IDENTITY';
  if (response?.status === 503 && plain(response.body) && response.body.code === 'BACKEND_UNAVAILABLE') return 'BACKEND_SESSION';
  if (response?.status === 503) return 'GATEWAY_INFRASTRUCTURE';
  return 'INCONCLUSIVE';
}

function initialEvidence() {
  return {
    NATIVE_TOKEN_INPUT_RECEIVED: 'NO',
    BRIDGE_EXCHANGE_REQUEST_STARTED: 'NO',
    BRIDGE_EXCHANGE_HTTP_STATUS: 'NOT_REACHED',
    BRIDGE_CANONICAL_JWT_RECEIVED: 'NO',
    GATEWAY_SESSION_REQUEST_STARTED: 'NO',
    GATEWAY_SESSION_HTTP_STATUS: 'NOT_REACHED',
    GATEWAY_SESSION_ID_RECEIVED: 'NO',
    GATEWAY_SESSION_STATUS_ACTIVE: 'NO',
    SESSION_CUSTOMER_MATCH: 'NOT_CHECKED',
    SESSION_HOST_APP_MATCH: 'NOT_CHECKED',
    NATIVE_TOKEN_PERSISTED: 'NO',
    NATIVE_TOKEN_LOGGED: 'NO',
    CANONICAL_JWT_PERSISTED: 'NO',
    CANONICAL_JWT_LOGGED: 'NO',
    REAL_LOCAL_SESSION_BOOTSTRAP: 'FAIL'
  };
}

function finish(output, evidence, stage) {
  const lines = Object.entries(evidence).map(([key, value]) => `${key}=${value}`);
  if (stage) lines.push(`FAILURE_STAGE=${stage}`);
  output(lines.join('\n') + '\n');
  return evidence.REAL_LOCAL_SESSION_BOOTSTRAP === 'PASS' ? 0 : 1;
}

function integerStatus(value) { return Number.isInteger(value) ? String(value) : 'NOT_REACHED'; }
function nonBlank(value) { return typeof value === 'string' && value.trim().length > 0; }
function plain(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, expected) { const keys = Object.keys(value); return keys.length === expected.length && keys.every((key) => expected.includes(key)); }

module.exports = Object.freeze({ executeSessionVerifier, readHiddenToken, defaultBridgeExchange, defaultGatewaySession, defaultInspectSession, LocalSessionTimeoutError });

if (require.main === module) {
  executeSessionVerifier().then((status) => { process.exitCode = status; });
}
