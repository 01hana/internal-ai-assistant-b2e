import { BridgeDestinationPolicy } from '../../src/idx/transport/destination-policy';
import { config } from './fixtures';

describe('Bridge destination policy', () => {
  it('permits only public-routable addresses in public_only mode', () => {
    const policy = new BridgeDestinationPolicy(config().configuration.destination);
    expect(() => policy.assertAddresses(['8.8.8.8', '2606:4700:4700::1111'])).not.toThrow();
    for (const address of ['0.0.0.0', '127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.1.1', '224.0.0.1', '240.0.0.1', '::', '::1', '2001:db8::1', 'fc00::1', 'fe80::1', 'ff00::1', '::ffff:10.0.0.1']) expect(() => policy.assertAddresses([address])).toThrow('unsafe_destination');
  });

  it('admits only configured Customer CIDRs in allowlisted_networks mode and fails closed on mixed answers', () => {
    const policy = new BridgeDestinationPolicy(config({ IDX_DESTINATION_MODE: 'allowlisted_networks', IDX_ALLOWED_CIDRS: '10.10.0.0/16,fd00::/8' }).configuration.destination);
    expect(() => policy.assertAddresses(['10.10.1.20', 'fd00::20'])).not.toThrow();
    expect(() => policy.assertAddresses(['10.10.1.20', '192.168.1.10'])).toThrow('unsafe_destination');
    expect(() => policy.assertAddresses(['8.8.8.8'])).toThrow('unsafe_destination');
  });

  it('does not turn public, loopback, or special destinations into Customer-local targets through CIDR configuration', () => {
    expect(() => new BridgeDestinationPolicy(config({ IDX_DESTINATION_MODE: 'allowlisted_networks', IDX_ALLOWED_CIDRS: '8.8.8.0/24' }).configuration.destination).assertAddresses(['8.8.8.8'])).toThrow('unsafe_destination');
    const broad = new BridgeDestinationPolicy(config({ IDX_DESTINATION_MODE: 'allowlisted_networks', IDX_ALLOWED_CIDRS: '0.0.0.0/0,::/0' }).configuration.destination);
    expect(() => broad.assertAddresses(['10.10.1.20', '8.8.8.8'])).toThrow('unsafe_destination');
    expect(() => broad.assertAddresses(['127.0.0.1'])).toThrow('unsafe_destination');
    expect(() => broad.assertAddresses(['::1'])).toThrow('unsafe_destination');
  });
});
