import { MenuDetailTransport } from '../../src/idx/transport/menu-detail.transport';
import { config, nativeToken, response } from './fixtures';

describe('MenuDetail resolution and rebinding policy', () => {
  it('does not forward a bearer before initial destination admission', async () => {
    const request = jest.fn().mockResolvedValue(response());
    const transport = new MenuDetailTransport(config(), { resolve: async () => ['10.0.0.1'], request });
    await expect(transport.execute(nativeToken)).rejects.toThrow('provider_unavailable');
    expect(request).not.toHaveBeenCalled();
  });

  it('fails closed when controlled connection-time resolution rebinds to an unapproved address', async () => {
    const resolve = jest.fn().mockResolvedValueOnce(['10.10.1.20']).mockResolvedValueOnce(['192.168.1.10']);
    const request = jest.fn(async () => response());
    const transport = new MenuDetailTransport(config({ IDX_DESTINATION_MODE: 'allowlisted_networks', IDX_ALLOWED_CIDRS: '10.10.0.0/16' }), { resolve, request });
    await expect(transport.execute(nativeToken)).rejects.toThrow('provider_unavailable');
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalled();
  });
});
