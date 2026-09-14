import { ConnectorBindingDestinationPolicy } from '../../src/connector-binding/connector-binding-destination.policy';

describe('Bridge binding exact destination policy', () => {
  it('validates every answer and canonicalizes IPv4-mapped IPv6', () => {
    const policy = new ConnectorBindingDestinationPolicy({ mode: 'public_only', allowedCidrs: [] });
    expect(policy.validate(['8.8.8.8', '::ffff:8.8.4.4'])).toEqual({ ok: true, value: ['8.8.4.4', '8.8.8.8'] });
    expect(policy.validate(['8.8.8.8', '127.0.0.1'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });

  it('admits private addresses only through an exact allowlist', () => {
    const policy = new ConnectorBindingDestinationPolicy({ mode: 'allowlisted_networks', allowedCidrs: ['10.20.0.0/16'] });
    expect(policy.validate(['10.20.2.3'])).toEqual({ ok: true, value: ['10.20.2.3'] });
    expect(policy.validate(['10.21.2.3'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });

  it.each(['0.0.0.0', '169.254.169.254', '224.0.0.1', '::', 'fe80::1', 'fd00:ec2::254', 'ff00::1'])
    ('denies unconditional unsafe destination %s even under a matching allowlist', (address) => {
      const cidr = address.includes(':') ? `${address}/128` : `${address}/32`;
      const policy = new ConnectorBindingDestinationPolicy({ mode: 'allowlisted_networks', allowedCidrs: [cidr] });
      expect(policy.validate([address])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    });

  it('allows loopback only through the explicit test seam without admitting arbitrary private networks', () => {
    const testPolicy = new ConnectorBindingDestinationPolicy({ mode: 'public_only', allowedCidrs: [] }, true);
    expect(testPolicy.validate(['127.0.0.1'])).toEqual({ ok: true, value: ['127.0.0.1'] });
    expect(testPolicy.validate(['::1'])).toEqual({ ok: true, value: ['::1'] });
    expect(testPolicy.validate(['10.0.0.1'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    expect(testPolicy.productionReady).toBe(false);
  });
});
