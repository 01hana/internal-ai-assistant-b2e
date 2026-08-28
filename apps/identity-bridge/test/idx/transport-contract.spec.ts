import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
import { config, nativeToken, response } from './fixtures';

describe('MenuDetail transport contract', () => {
  it('uses only the configured endpoint and makes one protected GET with the exact native token', async () => {
    const request = jest.fn().mockResolvedValue(response());
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['8.8.8.8'], request });

    await expect((transport.execute as (...args: unknown[]) => Promise<unknown>)(nativeToken, { endpoint: 'https://attacker.test', method: 'POST' })).resolves.toEqual({ body: { opaque: 'value' } });
    expect(request).toHaveBeenCalledTimes(1);
    const [url, options] = request.mock.calls[0] as [URL, { method: string; headers: Record<string, string> }];
    expect(url.toString()).toBe('https://idx.customer.test/menu-detail');
    expect(options).toMatchObject({ method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${nativeToken}` } });
  });
});
