import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
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
    await expect(transport.execute(nativeToken)).rejects.toThrow('timeout');
  });

  it('returns opaque parsed JSON without MenuDetail interpretation', async () => {
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['8.8.8.8'], request: async () => response('{"Code":999,"MenuDetail":{"arbitrary":true}}') });
    await expect(transport.execute(nativeToken)).resolves.toEqual({ body: { Code: 999, MenuDetail: { arbitrary: true } } });
  });
});
