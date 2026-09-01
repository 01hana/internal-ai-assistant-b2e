import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const bridgeRoot = join(__dirname, '../..');
const targetPath = join(bridgeRoot, 'scripts/local-verify-session.cjs');
const nativeToken = 'native-session-sentinel-never-print';
const canonicalToken = 'canonical-session-sentinel-never-print';

type Verifier = Readonly<{
  executeSessionVerifier(options: Record<string, unknown>): Promise<number>;
  readHiddenToken(options: Record<string, unknown>): Promise<string>;
  defaultBridgeExchange(token: string, request: Record<string, unknown>, options: Record<string, unknown>): Promise<Record<string, unknown>>;
  defaultGatewaySession(token: string, request: Record<string, unknown>, options: Record<string, unknown>): Promise<Record<string, unknown>>;
  defaultInspectSession(sessionId: string, options: Record<string, unknown>): Record<string, unknown> | null;
  LocalSessionTimeoutError: new () => Error;
}>;

describe('Feature 007 L004 local session verifier', () => {
  const load = (): Verifier => require(targetPath) as Verifier;

  it('sends the native token only to Bridge and the canonical token only to the exact Gateway session route', async () => {
    const harness = createHarness(load());

    await expect(load().executeSessionVerifier(harness.options)).resolves.toBe(0);

    expect(harness.bridge).toHaveBeenCalledWith(nativeToken, {
      url: 'http://127.0.0.1:3107/identity/exchange', method: 'POST', body: undefined
    });
    expect(harness.gateway).toHaveBeenCalledWith(canonicalToken, {
      url: 'http://127.0.0.1:4000/api/v1/assistant/sessions', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': '00000000-0000-4000-8000-000000000004' },
      body: { pageContext: {} }
    });
    expect(JSON.stringify(harness.gateway.mock.calls)).not.toContain(nativeToken);
    expect(JSON.stringify(harness.bridge.mock.calls)).not.toContain(canonicalToken);
    expect(harness.inspectSession).toHaveBeenCalledWith('local-session-001');
    expect(harness.output()).toContain('REAL_LOCAL_SESSION_BOOTSTRAP=PASS');
    expect(harness.output()).toContain('SESSION_CUSTOMER_MATCH=YES');
    expect(harness.output()).toContain('SESSION_HOST_APP_MATCH=YES');
    assertNoSecrets(harness.output());
  });

  it.each([
    ['CLI arguments', { argv: ['token-argument-sentinel'] }],
    ['non-interactive execution', { interactive: false }]
  ])('rejects %s before token collection', async (_case, override) => {
    const harness = createHarness(load());
    await expect(load().executeSessionVerifier({ ...harness.options, ...override })).resolves.toBe(1);
    expect(harness.readToken).not.toHaveBeenCalled();
    expect(harness.bridge).not.toHaveBeenCalled();
    expect(harness.output()).toContain('REAL_LOCAL_SESSION_BOOTSTRAP=FAIL');
    assertNoSecrets(harness.output());
  });

  it('ignores token-like environment and config values and uses only the interactive reader', async () => {
    const harness = createHarness(load());
    await expect(load().executeSessionVerifier({
      ...harness.options,
      environment: { ACCESS_TOKEN: 'environment-token-sentinel', IDX_ACCESS_TOKEN: 'environment-token-sentinel' },
      config: { nativeAccessToken: 'config-token-sentinel' }
    })).resolves.toBe(0);
    expect(harness.readToken).toHaveBeenCalledTimes(1);
    expect(harness.output()).not.toMatch(/environment-token-sentinel|config-token-sentinel/);
  });

  it.each([
    ['Bridge non-200', { status: 401 }],
    ['Bridge malformed success', { status: 200, body: { accessToken: canonicalToken, tokenType: 'Bearer', expiresIn: 299 } }]
  ])('fails closed for %s before Gateway', async (_case, bridgeResponse) => {
    const harness = createHarness(load(), { bridgeResponse });
    await expect(load().executeSessionVerifier(harness.options)).resolves.toBe(1);
    expect(harness.gateway).not.toHaveBeenCalled();
    expect(harness.inspectSession).not.toHaveBeenCalled();
    expect(harness.output()).toContain('FAILURE_STAGE=BRIDGE');
    expect(harness.output()).toContain('GATEWAY_SESSION_REQUEST_STARTED=NO');
    assertNoSecrets(harness.output());
  });

  it.each([
    [401, { statusCode: 401, code: 'UPSTREAM_IDENTITY_INVALID' }, 'GATEWAY_AUTH'],
    [403, { statusCode: 403, code: 'IDENTITY_ISSUANCE_DENIED' }, 'GATEWAY_IDENTITY'],
    [503, { statusCode: 503, code: 'IDENTITY_SERVICE_UNAVAILABLE' }, 'GATEWAY_INFRASTRUCTURE'],
    [503, { statusCode: 503, code: 'BACKEND_UNAVAILABLE' }, 'BACKEND_SESSION'],
    [500, { raw: 'response-body-sentinel' }, 'INCONCLUSIVE']
  ])('maps Gateway HTTP %s safely to %s', async (status, body, stage) => {
    const harness = createHarness(load(), { gatewayResponse: { status, body } });
    await expect(load().executeSessionVerifier(harness.options)).resolves.toBe(1);
    expect(harness.inspectSession).not.toHaveBeenCalled();
    expect(harness.output()).toContain(`FAILURE_STAGE=${stage}`);
    expect(harness.output()).not.toContain('response-body-sentinel');
    assertNoSecrets(harness.output());
  });

  it.each([
    { status: 201, body: { requestId: '', data: { sessionId: 'local-session-001', status: 'active' } } },
    { status: 201, body: { requestId: 'request', data: { sessionId: '', status: 'active' } } },
    { status: 201, body: { requestId: 'request', data: { sessionId: 'local-session-001', status: 'closed' } } }
  ])('rejects malformed Gateway success envelopes', async (gatewayResponse) => {
    const harness = createHarness(load(), { gatewayResponse });
    await expect(load().executeSessionVerifier(harness.options)).resolves.toBe(1);
    expect(harness.inspectSession).not.toHaveBeenCalled();
    expect(harness.output()).toContain('FAILURE_STAGE=BACKEND_SESSION');
  });

  it.each(['bridge', 'gateway'])('maps a %s timeout to TIMEOUT and prevents later work', async (boundary) => {
    const verifier = load();
    const timeout = new verifier.LocalSessionTimeoutError();
    const harness = createHarness(verifier, boundary === 'bridge' ? { bridgeError: timeout } : { gatewayError: timeout });
    await expect(verifier.executeSessionVerifier(harness.options)).resolves.toBe(1);
    if (boundary === 'bridge') expect(harness.gateway).not.toHaveBeenCalled();
    expect(harness.inspectSession).not.toHaveBeenCalled();
    expect(harness.output()).toContain('FAILURE_STAGE=TIMEOUT');
    assertNoSecrets(harness.output());
  });

  it.each([
    ['missing row', null, 'INCONCLUSIVE'],
    ['Customer mismatch', { customerId: 'wrong', hostApp: 'shinmone-scm' }, 'GATEWAY_IDENTITY'],
    ['HostApp mismatch', { customerId: 'customer-shinmone-scm-local', hostApp: 'wrong' }, 'GATEWAY_IDENTITY']
  ])('fails closed for persisted %s', async (_case, session, stage) => {
    const harness = createHarness(load(), { session });
    await expect(load().executeSessionVerifier(harness.options)).resolves.toBe(1);
    expect(harness.output()).toContain(`FAILURE_STAGE=${stage}`);
    expect(harness.output()).toContain('REAL_LOCAL_SESSION_BOOTSTRAP=FAIL');
    assertNoSecrets(harness.output());
  });

  it('reuses hidden TTY input and restores terminal state on success, rejection, Ctrl+C, and input error', async () => {
    const verifier = load();
    const success = createTerminal();
    const pending = verifier.readHiddenToken({ input: success.input, output: success.output });
    success.input.emit('data', Buffer.from(`${nativeToken}\n`));
    await expect(pending).resolves.toBe(nativeToken);
    expect(success.input.rawModes).toEqual([true, false]);
    expect(success.input.paused).toBe(true);
    expect(success.text()).not.toContain(nativeToken);

    const cancelled = createTerminal();
    const cancelledPending = verifier.readHiddenToken({ input: cancelled.input, output: cancelled.output });
    cancelled.input.emit('data', Buffer.from([0x03]));
    await expect(cancelledPending).rejects.toThrow('cancelled');
    expect(cancelled.input.rawModes).toEqual([true, false]);
    expect(cancelled.input.paused).toBe(true);

    const rejected = createTerminal();
    const rejectedPending = verifier.readHiddenToken({ input: rejected.input, output: rejected.output });
    rejected.input.emit('data', Buffer.from('\n'));
    await expect(rejectedPending).rejects.toThrow('invalid token input');
    expect(rejected.input.rawModes).toEqual([true, false]);
    expect(rejected.input.paused).toBe(true);

    const failed = createTerminal();
    const failedPending = verifier.readHiddenToken({ input: failed.input, output: failed.output });
    failed.input.emit('error', new Error('terminal failure sentinel'));
    await expect(failedPending).rejects.toThrow('input failed');
    expect(failed.input.rawModes).toEqual([true, false]);
    expect(failed.input.paused).toBe(true);
  });

  it('builds the real fetch requests without crossing credential boundaries', async () => {
    const verifier = load();
    const fetchImpl = jest.fn(async (_url: string, _init: Record<string, unknown>) => ({ status: 200, json: async () => ({ safe: true }) }));
    await verifier.defaultBridgeExchange(nativeToken, {
      url: 'http://127.0.0.1:3107/identity/exchange', method: 'POST', body: undefined
    }, { fetch: fetchImpl, timeoutMs: 100 });
    expect(fetchImpl).toHaveBeenLastCalledWith('http://127.0.0.1:3107/identity/exchange', expect.objectContaining({
      method: 'POST', headers: { authorization: `Bearer ${nativeToken}` }, signal: expect.any(AbortSignal)
    }));
    expect(fetchImpl.mock.calls[0][1]).not.toHaveProperty('body');

    await verifier.defaultGatewaySession(canonicalToken, {
      url: 'http://127.0.0.1:4000/api/v1/assistant/sessions', method: 'POST',
      headers: { 'content-type': 'application/json', 'x-request-id': 'request-id' }, body: { pageContext: {} }
    }, { fetch: fetchImpl, timeoutMs: 100 });
    expect(fetchImpl).toHaveBeenLastCalledWith('http://127.0.0.1:4000/api/v1/assistant/sessions', expect.objectContaining({
      method: 'POST',
      headers: { authorization: `Bearer ${canonicalToken}`, 'content-type': 'application/json', 'x-request-id': 'request-id' },
      body: JSON.stringify({ pageContext: {} }), signal: expect.any(AbortSignal)
    }));
    expect(JSON.stringify(fetchImpl.mock.calls[1])).not.toContain(nativeToken);
  });

  it('uses a read-only parameterized local assistant_dev persistence query and returns only safe authority fields', () => {
    const verifier = load();
    const spawn = jest.fn((_command: string, _args: string[], _options: Record<string, any>) => ({ status: 0, stdout: 'customer-shinmone-scm-local\tshinmone-scm\n' }));
    expect(verifier.defaultInspectSession('local-session-001', {
      databaseUrl: 'postgresql://local-user:local-password@127.0.0.1:5435/assistant_dev?schema=public',
      spawnSync: spawn
    })).toEqual({ customerId: 'customer-shinmone-scm-local', hostApp: 'shinmone-scm' });
    const [command, args, options] = spawn.mock.calls[0];
    expect(command).toBe('psql');
    expect(args).toEqual(expect.arrayContaining(['--no-psqlrc', '--no-password', '--dbname', 'assistant_dev']));
    expect(options.input).toMatch(/^SELECT /);
    expect(options.input).not.toMatch(/INSERT|UPDATE|DELETE|UPSERT/i);
    expect(options.env.PGPASSWORD).toBe('local-password');
    expect(options.env).not.toHaveProperty('ACCESS_TOKEN');
    expect(options.env).not.toHaveProperty('IDX_ACCESS_TOKEN');
    expect(JSON.stringify(args)).not.toContain('local-password');
  });

  it('contains no direct Backend, token decoding/signing, fixture-token, file-write, or authority override path', () => {
    const source = readFileSync(targetPath, 'utf8');
    expect(source).not.toMatch(/localhost:3000|127\.0\.0\.1:3000|internal.*jwt|fixture.*jwt|decodeJWT|jwtDecode|base64url|jose|signJWT|writeFile|appendFile/i);
    expect(source).not.toMatch(/x-customer|x-host-app|x-org|x-actor|permission-scopes|entry-id/i);
    expect(source).not.toMatch(/process\.env\.(?:ACCESS_TOKEN|IDX_ACCESS_TOKEN)|--token|authorization.*nativeToken.*gateway/i);
    expect(source).toContain("require('./local-verify-idx.cjs')");
  });
});

function createHarness(verifier: Verifier, overrides: Record<string, unknown> = {}) {
  const bridge = jest.fn(async () => overrides.bridgeError ? Promise.reject(overrides.bridgeError) : (overrides.bridgeResponse ?? {
    status: 200, body: { accessToken: canonicalToken, tokenType: 'Bearer', expiresIn: 300 }
  }));
  const gateway = jest.fn(async () => overrides.gatewayError ? Promise.reject(overrides.gatewayError) : (overrides.gatewayResponse ?? {
    status: 201, body: { requestId: 'gateway-request-001', data: { sessionId: 'local-session-001', status: 'active' } }
  }));
  const inspectSession = jest.fn(async () => Object.prototype.hasOwnProperty.call(overrides, 'session') ? overrides.session : {
    customerId: 'customer-shinmone-scm-local', hostApp: 'shinmone-scm'
  });
  const readToken = jest.fn(async () => nativeToken);
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    bridge, gateway, inspectSession, readToken,
    options: {
      argv: [], interactive: true, readToken, bridge, gateway, inspectSession,
      randomUUID: () => '00000000-0000-4000-8000-000000000004',
      stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value)
    },
    output: () => stdout.join('') + stderr.join('')
  };
}

function assertNoSecrets(output: string) {
  expect(output).not.toContain(nativeToken);
  expect(output).not.toContain(canonicalToken);
  expect(output).not.toContain('local-session-001');
  expect(output).not.toMatch(/Authorization|Bearer|synthetic-subject|synthetic-organization/i);
}

function createTerminal() {
  class Input extends EventEmitter {
    isTTY = true;
    isRaw = false;
    rawModes: boolean[] = [];
    paused = false;
    resumed = false;
    setRawMode(value: boolean) { this.rawModes.push(value); this.isRaw = value; }
    pause() { this.paused = true; }
    resume() { this.resumed = true; }
  }
  const input = new Input();
  const outputChunks: string[] = [];
  return {
    input,
    output: { isTTY: true, write: (value: string) => { outputChunks.push(value); } },
    text: () => outputChunks.join('')
  };
}
