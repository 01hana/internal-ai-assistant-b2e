import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

const bridgeRoot = join(__dirname, '../..');
const verifier = require('../../scripts/local-verify-idx.cjs') as {
  executeVerifier(options: Record<string, unknown>): Promise<number>;
  mergeEnvironmentFiles(contents: readonly string[]): Record<string, string>;
  readHiddenToken(options: Record<string, unknown>): Promise<string>;
  defaultExchange(nativeToken: string, request: Record<string, unknown>, options: Record<string, unknown>): Promise<{ status: number }>;
  defaultDirectMenuDetailProbe(nativeToken: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
};

const nativeToken = 'synthetic-native-token-never-print';
const canonicalToken = compact(
  { alg: 'RS256', kid: 'synthetic-kid' },
  {
    iss: 'https://bridge-local.example.test', aud: 'internal-ai-assistant-local', iat: 1_000, exp: 1_300,
    jti: '00000000-0000-4000-8000-000000000001', integration_id: 'shinmone-scm-assistant-local',
    sub: 'synthetic-subject', org_id: 'synthetic-organization', host_app: 'shinmone-scm', roles: [],
    permission_scopes: ['menu:synthetic:read']
  }
);
const localConfig = Object.freeze({
  BRIDGE_INTEGRATION_ID: 'shinmone-scm-assistant-local', BRIDGE_HOST_APP: 'shinmone-scm',
  BRIDGE_ISSUER: 'https://bridge-local.example.test', BRIDGE_AUDIENCE: 'internal-ai-assistant-local'
});

describe('pre-Phase-10 real IDX local verifier tooling', () => {
  it('layers the ignored Customer override after the template and preserves its exact UUID', () => {
    expect(verifier.mergeEnvironmentFiles([
      'BRIDGE_IDX_ALLOWED_ENTRIES=["<REPLACE_WITH_ACTUAL_ENTRY_UUID>"]\nBRIDGE_HOST_APP=shinmone-scm\n',
      'BRIDGE_IDX_ALLOWED_ENTRIES=["60290329-0000-a001-0001-000000000001"]\n'
    ])).toMatchObject({
      BRIDGE_IDX_ALLOWED_ENTRIES: '["60290329-0000-a001-0001-000000000001"]', BRIDGE_HOST_APP: 'shinmone-scm'
    });
    const compose = readFileSync(join(bridgeRoot, 'compose.yaml'), 'utf8');
    expect(compose.indexOf('path: env/local.env.example')).toBeLessThan(compose.indexOf('path: env/local.env\n'));
    expect(compose.indexOf('path: env/local.env\n')).toBeLessThan(compose.indexOf('bridge-signing.env'));
    expect(compose).toMatch(/path:\s*env\/local\.env[\s\S]*required:\s*false/);
  });

  it('rejects every CLI argument before requesting a token', async () => {
    const harness = createHarness();
    expect(await verifier.executeVerifier({ ...harness.options, argv: ['token-argument-sentinel'] })).toBe(1);
    expect(harness.readToken).not.toHaveBeenCalled();
    assertSafeFailure(harness.output(), 'BRIDGE_REQUEST');
  });

  it('ignores token-like environment values and requires the interactive reader', async () => {
    const harness = createHarness();
    expect(await verifier.executeVerifier({
      ...harness.options,
      environment: { ACCESS_TOKEN: 'environment-token-sentinel', IDX_ACCESS_TOKEN: 'environment-token-sentinel' }
    })).toBe(0);
    expect(harness.readToken).toHaveBeenCalledTimes(1);
    expect(harness.exchange).toHaveBeenCalledWith(nativeToken, expect.objectContaining({ body: undefined }));
    expect(harness.output()).not.toMatch(/environment-token-sentinel|synthetic-native-token-never-print/);
  });

  it('fails safely when no interactive terminal is available', async () => {
    const harness = createHarness();
    expect(await verifier.executeVerifier({ ...harness.options, interactive: false })).toBe(1);
    expect(harness.readToken).not.toHaveBeenCalled();
    assertSafeFailure(harness.output(), 'BRIDGE_REQUEST');
  });

  it.each([
    ['one chunk with CR', `${nativeToken}\r`],
    ['one chunk with LF', `${nativeToken}\n`]
  ])('accepts a pasted token in %s without echoing it', async (_name, chunk) => {
    const terminal = createTerminal();
    const pending = verifier.readHiddenToken({ input: terminal.input, output: terminal.output });
    terminal.input.emit('data', Buffer.from(chunk));
    await expect(pending).resolves.toBe(nativeToken);
    expect(terminal.text()).not.toContain(nativeToken);
    expect(terminal.input.rawModes).toEqual([true, false]);
    expect(terminal.input.paused).toBe(true);
    expect(terminal.input.resumed).toBe(true);
  });

  it.each(['\r', '\n'])('accepts a token and terminator delivered in separate chunks (%j)', async (terminator) => {
    const terminal = createTerminal();
    const pending = verifier.readHiddenToken({ input: terminal.input, output: terminal.output });
    terminal.input.emit('data', Buffer.from(nativeToken));
    terminal.input.emit('data', Buffer.from(terminator));
    await expect(pending).resolves.toBe(nativeToken);
    expect(terminal.input.rawModes).toEqual([true, false]);
    expect(terminal.input.paused).toBe(true);
  });

  it('restores raw mode and pauses safely when Ctrl+C cancels input', async () => {
    const terminal = createTerminal();
    const pending = verifier.readHiddenToken({ input: terminal.input, output: terminal.output });
    terminal.input.emit('data', Buffer.from([0x03]));
    await expect(pending).rejects.toThrow('cancelled');
    expect(terminal.input.rawModes).toEqual([true, false]);
    expect(terminal.input.paused).toBe(true);
    expect(terminal.text()).not.toContain(nativeToken);
  });

  it('restores raw mode and pauses safely when terminal input errors', async () => {
    const terminal = createTerminal();
    const pending = verifier.readHiddenToken({ input: terminal.input, output: terminal.output });
    terminal.input.emit('error', new Error('synthetic input failure'));
    await expect(pending).rejects.toThrow('input failed');
    expect(terminal.input.rawModes).toEqual([true, false]);
    expect(terminal.input.paused).toBe(true);
    expect(terminal.text()).not.toContain(nativeToken);
  });

  it.each(['\r', `bad token\n`, `${nativeToken}\nsecond-line`])('rejects empty, whitespace, or multiple logical lines safely (%j)', async (chunk) => {
    const terminal = createTerminal();
    const pending = verifier.readHiddenToken({ input: terminal.input, output: terminal.output });
    terminal.input.emit('data', Buffer.from(chunk));
    await expect(pending).rejects.toThrow();
    expect(terminal.input.rawModes).toEqual([true, false]);
    expect(terminal.input.paused).toBe(true);
    expect(terminal.text()).not.toContain(nativeToken);
  });

  it('maps the verifier request timeout to IDX_TRANSPORT without token disclosure', async () => {
    const harness = createHarness();
    const exchange = jest.fn((token: string, request: Record<string, unknown>) => verifier.defaultExchange(token, request, {
      timeoutMs: 1,
      fetch: (_url: string, options: { signal: AbortSignal }) => new Promise((_, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true });
      })
    }));
    expect(await verifier.executeVerifier({ ...harness.options, exchange })).toBe(1);
    assertSafeFailure(harness.output(), 'IDX_TRANSPORT');
  });

  it('emits only boolean success evidence and never raw native/canonical material', async () => {
    const harness = createHarness();
    expect(await verifier.executeVerifier(harness.options)).toBe(0);
    const output = harness.output();
    expect(output).toContain('REAL_IDX_MENUDETAIL_ACCEPTED=YES');
    expect(output).toContain('TOKEN_INPUT_RECEIVED=YES');
    expect(output).toContain('LOCAL_EXCHANGE_REQUEST_STARTED=YES');
    expect(output).toContain('REAL_IDX_ENTRY_ADMISSION=PASS');
    expect(output).toContain('CANONICAL_JWT_RS256=YES');
    expect(output).toContain('CANONICAL_JWT_TTL_VALID=YES');
    expect(output).toContain('CANONICAL_JWT_ENTRY_ABSENT=YES');
    expect(output).toContain('CANONICAL_JWT_CUSTOMER_AUTHORITY_ABSENT=YES');
    expect(output).toContain('REAL_IDX_LOCAL_EXCHANGE=PASS');
    expect(output).not.toContain(nativeToken);
    expect(output).not.toContain(canonicalToken);
    expect(harness.exchange).toHaveBeenCalledWith(nativeToken, expect.objectContaining({ body: undefined }));
  });

  it.each([
    [{ status: 200, applicationCode200: true }, { status: 200 }, 'DIRECT_AND_BRIDGE_ACCEPT'],
    [{ status: 200, applicationCode200: true }, { status: 401 }, 'DIRECT_ACCEPT_BRIDGE_REJECT'],
    [{ status: 401, applicationCode200: false }, { status: 401 }, 'DIRECT_REJECT_BRIDGE_REJECT'],
    [{ status: 401, applicationCode200: false }, { status: 200 }, 'DIRECT_REJECT_BRIDGE_ACCEPT'],
    [{ status: 200, applicationCode200: undefined }, { status: 200 }, 'INCONCLUSIVE']
  ])('classifies same-token direct and Bridge outcomes safely', async (directResult, bridgeResult, diagnosis) => {
    const harness = createHarness(bridgeResult.status === 200
      ? { ...bridgeResult, body: { accessToken: canonicalToken, tokenType: 'Bearer', expiresIn: 300 } }
      : bridgeResult);
    const directProbe = jest.fn(async () => directResult);
    expect(await verifier.executeVerifier({ ...harness.options, directProbe })).toBe(bridgeResult.status === 200 ? 0 : 1);
    expect(directProbe).toHaveBeenCalledWith(nativeToken);
    expect(harness.exchange).toHaveBeenCalledWith(nativeToken, expect.objectContaining({ body: undefined }));
    const output = harness.output();
    expect(output).toContain(`DIRECT_MENUDETAIL_HTTP_STATUS=${directResult.status}`);
    expect(output).toContain(`BRIDGE_EXCHANGE_HTTP_STATUS=${bridgeResult.status}`);
    expect(output).toContain(`SAME_TOKEN_DIAGNOSIS=${diagnosis}`);
    expect(output).not.toContain(nativeToken);
  });

  it('maps a direct timeout or malformed response to INCONCLUSIVE without response disclosure', async () => {
    const harness = createHarness();
    const timeoutProbe = jest.fn(async () => { throw new Error('synthetic direct timeout with raw-response-sentinel'); });
    expect(await verifier.executeVerifier({ ...harness.options, directProbe: timeoutProbe })).toBe(0);
    expect(harness.output()).toContain('SAME_TOKEN_DIAGNOSIS=INCONCLUSIVE');
    expect(harness.output()).not.toContain('raw-response-sentinel');
  });

  it.each([
    [400, 'BRIDGE_REQUEST'], [401, 'MENUDETAIL_REJECTED'], [403, 'ENTRY_ADMISSION'], [503, 'IDX_TRANSPORT']
  ])('maps HTTP %s to safe failure category %s', async (status, stage) => {
    const harness = createHarness({ status });
    expect(await verifier.executeVerifier(harness.options)).toBe(1);
    assertSafeFailure(harness.output(), stage);
  });

  it('contains no Authentication call, localStorage scraping, token persistence, or Entry request body', () => {
    const source = readFileSync(join(bridgeRoot, 'scripts/local-verify-idx.cjs'), 'utf8');
    expect(source).not.toMatch(/stty|readline/);
    expect(source).not.toMatch(/\/APIs\/Auth\/APIs\/Auth\/Authentication|localStorage|shinmone-SCM-AccessToken/);
    expect(source).not.toMatch(/writeFile|appendFile|createWriteStream/);
    expect(source).not.toMatch(/body\s*:\s*(?:JSON\.stringify|\{|['"])/);
    expect(source).not.toMatch(/process\.env\.(?:ACCESS_TOKEN|IDX_ACCESS_TOKEN|TOKEN)/);
  });
});

function createHarness(response: { status: number; body?: unknown } = { status: 200, body: { accessToken: canonicalToken, tokenType: 'Bearer', expiresIn: 300 } }) {
  const stdout: string[] = []; const stderr: string[] = [];
  const readToken = jest.fn(async () => nativeToken);
  const exchange = jest.fn(async () => response);
  const inspectLogs = jest.fn(async () => 'safe runtime log');
  const directProbe = jest.fn(async () => ({ status: 200, applicationCode200: true }));
  return {
    readToken, exchange, directProbe,
    options: { argv: [], environment: {}, interactive: true, readToken, directProbe, exchange, inspectLogs, config: localConfig, stdout: (value: string) => stdout.push(value), stderr: (value: string) => stderr.push(value) },
    output: () => `${stdout.join('')}\n${stderr.join('')}`
  };
}

function assertSafeFailure(output: string, stage: string) {
  expect(output).toContain('REAL_IDX_LOCAL_EXCHANGE=FAIL');
  expect(output).toContain(`FAILURE_STAGE=${stage}`);
  expect(output).not.toMatch(/synthetic-native-token|environment-token|eyJ/);
}

function compact(header: Record<string, unknown>, payload: Record<string, unknown>): string {
  return `${Buffer.from(JSON.stringify(header)).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.synthetic-signature`;
}

function createTerminal() {
  const input = new FakeTerminalInput();
  const values: string[] = [];
  return { input, output: { isTTY: true, write: (value: string) => values.push(value) }, text: () => values.join('') };
}

class FakeTerminalInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  paused = false;
  resumed = false;
  rawModes: boolean[] = [];

  setRawMode(value: boolean) { this.isRaw = value; this.rawModes.push(value); return this; }
  pause() { this.paused = true; return this; }
  resume() { this.resumed = true; return this; }
}
