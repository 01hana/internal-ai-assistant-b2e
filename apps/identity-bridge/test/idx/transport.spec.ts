import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
import { IdxTransportError } from '../../src/idx/transport/transport.error';
import { bytes, config, nativeToken, response } from './fixtures';

describe('MenuDetail bounded transport', () => {
  it.each([
    ['redirect', response('', { statusCode: 302 })],
    ['non-json', response('', { headers: { 'content-type': 'text/plain' } })],
    ['oversized', response(`{"s":"${'response-body-sentinel-'.repeat(8)}"}`)],
    ['malformed', response('{not-json}')]
  ])('rejects %s responses without retrying', async (_name, raw) => {
    const request = jest.fn().mockResolvedValue(raw);
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['8.8.8.8'], request });
    await expect(transport.execute(nativeToken)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds the whole operation with the configured deadline', async () => {
    const transport = new MenuDetailTransport(config({ BRIDGE_TIMEOUT_MS: '1' }), { resolve: () => new Promise(() => {}), request: jest.fn() });
    await expect(transport.execute(nativeToken)).rejects.toMatchObject({ category: 'provider_unavailable' });
  });

  it.each([
    [401, 'server unavailable response-body-sentinel', 'credential_rejected'],
    [403, 'invalid token response-body-sentinel', 'identity_denied'],
    [302, 'unauthorized response-body-sentinel', 'provider_unavailable'],
    [400, 'unauthorized response-body-sentinel', 'provider_unavailable'],
    [404, 'unauthorized response-body-sentinel', 'provider_unavailable'],
    [429, 'unauthorized response-body-sentinel', 'provider_unavailable'],
    [500, 'unauthorized response-body-sentinel', 'provider_unavailable'],
    [503, 'invalid token response-body-sentinel', 'provider_unavailable']
  ])('classifies HTTP %s only from the trusted status boundary', async (statusCode, body, category) => {
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['8.8.8.8'], request: async () => response(body, { statusCode }) });
    const error = await transport.execute(nativeToken).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(IdxTransportError);
    expect(error).toMatchObject({ category });
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(body);
    expect(`${String(error)}${JSON.stringify(error)}`).not.toContain(String(statusCode));
  });

  it.each([
    ['network failure', { resolve: async () => ['8.8.8.8'], request: async () => { throw new Error('provider-network-sentinel'); } }],
    ['malformed JSON', { resolve: async () => ['8.8.8.8'], request: async () => response('invalid-json-sentinel') }]
  ])('classifies %s as provider unavailable', async (_name, dependencies) => {
    const transport = new MenuDetailTransport(config(), dependencies);
    await expect(transport.execute(nativeToken)).rejects.toMatchObject({ category: 'provider_unavailable' });
  });

  it('returns opaque parsed JSON without MenuDetail interpretation', async () => {
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['8.8.8.8'], request: async () => response('{"Code":999,"MenuDetail":{"arbitrary":true}}') });
    await expect(transport.execute(nativeToken)).resolves.toEqual({ body: { Code: 999, MenuDetail: { arbitrary: true } } });
  });
});
