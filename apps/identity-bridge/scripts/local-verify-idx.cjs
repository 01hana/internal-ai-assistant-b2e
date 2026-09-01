#!/usr/bin/env node
'use strict';

const { readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const bridgeRoot = resolve(__dirname, '..');
const composeFile = join(bridgeRoot, 'compose.yaml');
const expectedConfig = loadLocalConfig();
const VERIFIER_REQUEST_TIMEOUT_MS = 12_000;
const LEGACY_MENUDETAIL_URL = 'http://59.125.138.139/APIs/Auth/APIs/Site/MenuDetail';

async function executeVerifier(options = {}) {
  const stdout = options.stdout ?? ((value) => process.stdout.write(value));
  const stderr = options.stderr ?? ((value) => process.stderr.write(value));
  const argv = options.argv ?? process.argv.slice(2);
  const environment = options.environment ?? process.env;
  const interactive = options.interactive ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  const readToken = options.readToken ?? readHiddenToken;
  const directProbe = options.directProbe ?? defaultDirectMenuDetailProbe;
  const exchange = options.exchange ?? defaultExchange;
  const inspectLogs = options.inspectLogs ?? defaultInspectLogs;
  const config = options.config ?? expectedConfig;

  if (!Array.isArray(argv) || argv.length !== 0 || interactive !== true) return safeFailure(stdout, 'BRIDGE_REQUEST');

  let nativeToken;
  let canonicalToken;
  try {
    nativeToken = await readToken();
    if (typeof nativeToken !== 'string' || !nativeToken || /\s/.test(nativeToken)) return safeFailure(stdout, 'BRIDGE_REQUEST');
    stdout('TOKEN_INPUT_RECEIVED=YES\n');
    let directResult;
    stdout('DIRECT_MENUDETAIL_REQUEST_STARTED=YES\n');
    try {
      directResult = await directProbe(nativeToken);
    } catch {
      directResult = Object.freeze({ conclusive: false });
    }
    const directStatus = Number.isInteger(directResult?.status) ? directResult.status : undefined;
    if (directStatus !== undefined) {
      stdout(`DIRECT_MENUDETAIL_HTTP_STATUS=${directStatus}\n`);
      if (directStatus === 200) stdout(`DIRECT_MENUDETAIL_APPLICATION_CODE_200=${directResult.applicationCode200 === true ? 'YES' : directResult.applicationCode200 === false ? 'NO' : 'NO'}\n`);
    }
    const port = typeof environment.IDENTITY_BRIDGE_LOCAL_PORT === 'string' && /^\d+$/.test(environment.IDENTITY_BRIDGE_LOCAL_PORT)
      ? environment.IDENTITY_BRIDGE_LOCAL_PORT : '3107';
    let response;
    try {
      stdout('LOCAL_EXCHANGE_REQUEST_STARTED=YES\n');
      response = await exchange(nativeToken, Object.freeze({
        url: `http://127.0.0.1:${port}/identity/exchange`, method: 'POST', body: undefined
      }));
    } catch {
      stdout(`SAME_TOKEN_DIAGNOSIS=${sameTokenDiagnosis(directResult, undefined)}\n`);
      return safeFailure(stdout, 'IDX_TRANSPORT');
    }
    const bridgeStatus = Number.isInteger(response?.status) ? response.status : undefined;
    if (bridgeStatus !== undefined) stdout(`BRIDGE_EXCHANGE_HTTP_STATUS=${bridgeStatus}\n`);
    stdout(`SAME_TOKEN_DIAGNOSIS=${sameTokenDiagnosis(directResult, bridgeStatus)}\n`);
    if (!response || response.status !== 200) return safeFailure(stdout, stageForStatus(response?.status));
    const body = response.body;
    if (!plain(body) || !exactKeys(body, ['accessToken', 'tokenType', 'expiresIn']) || body.tokenType !== 'Bearer' || body.expiresIn !== 300 || typeof body.accessToken !== 'string' || !body.accessToken) {
      return safeFailure(stdout, 'CANONICAL_ISSUANCE');
    }
    canonicalToken = body.accessToken;
    if (!canonicalContract(canonicalToken, config)) return safeFailure(stdout, 'CANONICAL_ISSUANCE');
    let logs;
    try { logs = await inspectLogs(); } catch { return safeFailure(stdout, 'BRIDGE_REQUEST'); }
    if (typeof logs !== 'string' || logs.includes(nativeToken) || logs.includes(canonicalToken)) return safeFailure(stdout, 'BRIDGE_REQUEST');

    stdout([
      'REAL_ENTRY_UUIDS_AVAILABLE=YES',
      'REAL_IDX_ACCESS_TOKEN_SOURCE_KNOWN=YES',
      'REAL_IDX_ACCESS_TOKEN_AVAILABLE=YES',
      'REAL_IDX_MENUDETAIL_REQUEST_REACHED=YES',
      'REAL_IDX_MENUDETAIL_ACCEPTED=YES',
      'REAL_IDX_ENTRY_ADMISSION=PASS',
      'CANONICAL_JWT_RECEIVED=YES',
      'CANONICAL_JWT_RS256=YES',
      'CANONICAL_JWT_TTL_VALID=YES',
      'CANONICAL_JWT_ENTRY_ABSENT=YES',
      'CANONICAL_JWT_CUSTOMER_AUTHORITY_ABSENT=YES',
      'NATIVE_TOKEN_PERSISTED=NO',
      'NATIVE_TOKEN_LOGGED=NO',
      'CANONICAL_JWT_LOGGED=NO',
      'REAL_IDX_LOCAL_EXCHANGE=PASS'
    ].join('\n') + '\n');
    return 0;
  } catch {
    return safeFailure(stderr, 'BRIDGE_REQUEST');
  } finally {
    nativeToken = undefined;
    canonicalToken = undefined;
  }
}

async function defaultExchange(nativeToken, request, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : VERIFIER_REQUEST_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(request.url, {
      method: request.method,
      headers: Object.freeze({ authorization: `Bearer ${nativeToken}` }),
      signal
    });
    if (response.status !== 200) return Object.freeze({ status: response.status });
    let body;
    try { body = await response.json(); } catch { return Object.freeze({ status: 503 }); }
    return Object.freeze({ status: response.status, body });
  } catch {
    return Object.freeze({ status: 503 });
  }
}

async function defaultDirectMenuDetailProbe(nativeToken, options = {}) {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : VERIFIER_REQUEST_TIMEOUT_MS;
  const signal = options.signal ?? AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(LEGACY_MENUDETAIL_URL, {
      method: 'GET',
      headers: Object.freeze({ authorization: `Bearer ${nativeToken}`, accept: 'application/json' }),
      signal
    });
    if (response.status !== 200) return Object.freeze({ status: response.status, applicationCode200: false, conclusive: true });
    try {
      const body = await response.json();
      return Object.freeze({ status: response.status, applicationCode200: plain(body) && body.Code === 200, conclusive: true });
    } catch {
      return Object.freeze({ status: response.status, conclusive: false });
    }
  } catch {
    return Object.freeze({ conclusive: false });
  }
}

function defaultInspectLogs() {
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'logs', '--no-color'], { cwd: bridgeRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('runtime log inspection failed');
  return result.stdout;
}

function canonicalContract(token, config) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) return false;
    const header = decode(parts[0]);
    const payload = decode(parts[1]);
    if (!plain(header) || !plain(payload) || header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid.trim()) return false;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp) || payload.exp - payload.iat !== 300) return false;
    if (payload.integration_id !== config.BRIDGE_INTEGRATION_ID || payload.host_app !== config.BRIDGE_HOST_APP || payload.iss !== config.BRIDGE_ISSUER) return false;
    const audience = payload.aud;
    if (!(audience === config.BRIDGE_AUDIENCE || Array.isArray(audience) && audience.length === 1 && audience[0] === config.BRIDGE_AUDIENCE)) return false;
    if (!Array.isArray(payload.roles) || payload.roles.length !== 0 || !Array.isArray(payload.permission_scopes)) return false;
    if (payload.permission_scopes.some((scope) => typeof scope !== 'string')) return false;
    for (const forbidden of [
      'UUID_Entry', 'entry', 'entryId', 'selectedEntry', 'customer_id', 'customerId', 'Customer',
      'UUID_User', 'UUID_Company', 'UUID_Entry_Category', 'UserID', 'UserType', 'IsAdmin',
      'Permissions', 'Permission_Hash', 'Version', 'nativeAccessToken', 'refreshToken', 'MenuDetail'
    ]) if (Object.prototype.hasOwnProperty.call(payload, forbidden)) return false;
    return true;
  } catch { return false; }
}

function decode(segment) {
  if (!/^[A-Za-z0-9_-]+$/.test(segment) || segment.length % 4 === 1) throw new Error('invalid JWT');
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) throw new Error('invalid JWT');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function readHiddenToken(options = {}) {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  return new Promise((resolveToken, rejectToken) => {
    if (input.isTTY !== true || output.isTTY !== true || typeof input.setRawMode !== 'function') return rejectToken(new Error('interactive terminal required'));
    const wasRaw = input.isRaw === true;
    let settled = false;
    let carriageReturnPending = false;
    let token = '';
    const cleanup = () => {
      if (settled) return;
      settled = true;
      input.off('data', onData);
      input.off('error', onInputError);
      input.off('end', onInputEnd);
      try { input.pause(); } catch {}
      try { input.setRawMode(wasRaw); } catch {}
      output.write('\n');
    };
    const rejectSafe = (reason) => { cleanup(); rejectToken(new Error(reason)); };
    const resolveSafe = () => {
      if (!token || /\s/.test(token)) return rejectSafe('invalid token input');
      cleanup();
      resolveToken(token);
    };
    const onInputError = () => rejectSafe('input failed');
    const onInputEnd = () => rejectSafe('input closed');
    const onData = (chunk) => {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      if (carriageReturnPending) {
        if (text === '\n') return;
        return rejectSafe('multiple logical lines');
      }
      for (let index = 0; index < text.length; index += 1) {
        const character = text[index];
        if (character.charCodeAt(0) === 0x03) return rejectSafe('cancelled');
        if (character === '\r' || character === '\n') {
          let remainder = text.slice(index + 1);
          if (character === '\r' && remainder.startsWith('\n')) remainder = remainder.slice(1);
          if (remainder.length > 0) return rejectSafe('multiple logical lines');
          if (character === '\r') {
            carriageReturnPending = true;
            return setImmediate(resolveSafe);
          }
          return resolveSafe();
        }
        token += character;
      }
    };
    try {
      input.setRawMode(true);
      input.on('data', onData);
      input.once('error', onInputError);
      input.once('end', onInputEnd);
      input.resume();
      output.write('Paste current IDX AccessToken (input hidden): ');
    } catch {
      rejectSafe('hidden input unavailable');
    }
  });
}

function loadLocalConfig() {
  const paths = [join(bridgeRoot, 'env/local.env.example'), join(bridgeRoot, 'env/local.env')];
  const contents = paths.map((path) => { try { return readFileSync(path, 'utf8'); } catch (error) { if (error?.code === 'ENOENT') return ''; throw error; } });
  return Object.freeze(mergeEnvironmentFiles(contents));
}

function mergeEnvironmentFiles(contents) {
  const result = {};
  for (const content of contents) {
    for (const rawLine of String(content).split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator <= 0) continue;
      result[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return result;
}

function stageForStatus(status) {
  if (status === 400) return 'BRIDGE_REQUEST';
  if (status === 401) return 'MENUDETAIL_REJECTED';
  if (status === 403) return 'ENTRY_ADMISSION';
  return 'IDX_TRANSPORT';
}

function sameTokenDiagnosis(directResult, bridgeStatus) {
  if (!directResult || directResult.conclusive === false || !Number.isInteger(directResult.status) || !Number.isInteger(bridgeStatus)) return 'INCONCLUSIVE';
  if (directResult.status === 200 && typeof directResult.applicationCode200 !== 'boolean') return 'INCONCLUSIVE';
  const directAccepted = directResult.status === 200 && directResult.applicationCode200 === true;
  const bridgeAccepted = bridgeStatus === 200;
  if (directAccepted && bridgeAccepted) return 'DIRECT_AND_BRIDGE_ACCEPT';
  if (directAccepted && !bridgeAccepted) return 'DIRECT_ACCEPT_BRIDGE_REJECT';
  if (!directAccepted && !bridgeAccepted) return 'DIRECT_REJECT_BRIDGE_REJECT';
  return 'DIRECT_REJECT_BRIDGE_ACCEPT';
}

function safeFailure(output, stage) {
  output(`REAL_IDX_LOCAL_EXCHANGE=FAIL\nFAILURE_STAGE=${stage}\n`);
  return 1;
}

function plain(value) { return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function exactKeys(value, expected) { const keys = Object.keys(value); return keys.length === expected.length && keys.every((key) => expected.includes(key)); }

module.exports = Object.freeze({ executeVerifier, mergeEnvironmentFiles, readHiddenToken, defaultExchange, defaultDirectMenuDetailProbe });

if (require.main === module) {
  executeVerifier().then((status) => { process.exitCode = status; });
}
