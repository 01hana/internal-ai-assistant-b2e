import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
import { IdxTransportError } from '../../src/idx/transport/transport.error';
import { config, nativeToken, response } from './fixtures';

describe('MenuDetail transport redaction', () => {
  it.each([
    ['unsafe', { resolve: async () => ['10.0.0.1'], request: jest.fn() }],
    ['dns', { resolve: async () => { throw new Error('dns failure'); }, request: jest.fn() }],
    ['status', { resolve: async () => ['8.8.8.8'], request: async () => response('response-body-sentinel', { statusCode: 500 }) }],
    ['json', { resolve: async () => ['8.8.8.8'], request: async () => response('response-body-sentinel') }]
  ])('does not disclose native credentials or response data for %s failures', async (_name, dependencies) => {
    const transport = new MenuDetailTransport(config(), dependencies);
    const error = await transport.execute(nativeToken).then(() => undefined, (caught: unknown) => caught);
    expect(JSON.stringify(error)).not.toContain(nativeToken);
    expect(`${error}`).not.toContain(nativeToken);
    expect(`${error}`).not.toContain('response-body-sentinel');
  });

  it.each([
    ['timeout', { BRIDGE_TIMEOUT_MS: '1' }, { resolve: () => new Promise<readonly string[]>(() => {}), request: jest.fn() }],
    ['oversized', {}, { resolve: async () => ['8.8.8.8'], request: async () => response(`{"body":"${'response-body-sentinel-'.repeat(8)}"}`) }],
    ['malformed', {}, { resolve: async () => ['8.8.8.8'], request: async () => response('response-body-sentinel') }]
  ])('redacts credentials and raw body for %s failures', async (_name, overrides, dependencies) => {
    const transport = new MenuDetailTransport(config(overrides), dependencies);
    const error = await transport.execute(nativeToken).then(() => undefined, (caught: unknown) => caught);
    expect(JSON.stringify(error)).not.toContain(nativeToken);
    expect(`${error}`).not.toContain(nativeToken);
    expect(`${error}`).not.toContain('response-body-sentinel');
  });

  it.each([
    [401, 'credential_rejected', 'server-unavailable-body-sentinel'],
    [403, 'identity_denied', 'invalid-token-body-sentinel'],
    [500, 'provider_unavailable', 'unauthorized-body-sentinel']
  ])('exposes only safe category %s for HTTP %s', async (statusCode, category, body) => {
    const endpoint = 'https://idx.customer.test/menu-detail';
    const resolvedAddress = '8.8.8.8';
    const transport = new MenuDetailTransport(config(), { resolve: async () => [resolvedAddress], request: async () => response(body, { statusCode }) });
    const error = await transport.execute(nativeToken).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IdxTransportError);
    expect(error).toMatchObject({ category });
    const serialized = `${String(error)}${JSON.stringify(error)}`;
    for (const forbidden of [nativeToken, `Bearer ${nativeToken}`, body, endpoint, resolvedAddress, String(statusCode)]) expect(serialized).not.toContain(forbidden);
  });
});
