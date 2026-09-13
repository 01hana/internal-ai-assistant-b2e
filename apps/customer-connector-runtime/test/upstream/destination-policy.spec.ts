import { ConnectorDestinationPolicy, ClosedUpstreamRequestBuilder } from '../../src/upstream/connector-destination-policy';

describe('Phase 6 destination policy and closed request construction', () => {
  const policy = new ConnectorDestinationPolicy([
    { upstreamServiceRef: 'inventory-api', origin: 'https://inventory.test:8443', basePath: '/v1', addressMode: 'public_only', allowedCidrs: [] },
    { upstreamServiceRef: 'metrics-api', origin: 'https://metrics.test:9443', basePath: '/api', addressMode: 'public_only', allowedCidrs: [] }
  ], 'production');

  it('constructs deterministic GET and closed POST requests from prepared mappings', () => {
    const builder = new ClosedUpstreamRequestBuilder(policy);
    expect(builder.build('metrics-api', { profile: 'GET_QUERY_V1', path: '/metrics', query: [
      { name: 'z', value: '2/3' }, { name: 'a', value: 'one & two' }
    ] }, 4096)).toEqual(expect.objectContaining({
      ok: true,
      value: expect.objectContaining({
        method: 'GET', path: '/api/metrics?a=one%20%26%20two&z=2%2F3'
      })
    }));
    const get = builder.build('metrics-api', { profile: 'GET_QUERY_V1', path: '/metrics', query: [] }, 4096);
    expect(get.ok && get.value).not.toHaveProperty('body');
    expect(builder.build('inventory-api', { profile: 'POST_QUERY_JSON_V1', path: '/stock', body: [{ name: 'scope', value: 'available' }, { name: 'sku', value: 'SKU-1' }] }, 4096)).toEqual(expect.objectContaining({ ok: true, value: expect.objectContaining({ method: 'POST', path: '/v1/stock', body: '{"scope":"available","sku":"SKU-1"}' }) }));
  });

  it.each(['/safe/%2e%2e/admin', '/safe/%2Fadmin', '/safe/%5cadmin'])('rejects encoded traversal or separator path %s', (path) => {
    expect(new ClosedUpstreamRequestBuilder(policy).build('metrics-api', {
      profile: 'GET_QUERY_V1', path, query: []
    }, 4096)).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });

  it.each([
    ['http://inventory.test', '/v1', 'public_only', []],
    ['https://user@inventory.test', '/v1', 'public_only', []],
    ['https://inventory.test?q=1', '/v1', 'public_only', []],
    ['https://inventory.test/#frag', '/v1', 'public_only', []],
    ['https://*.inventory.test', '/v1', 'public_only', []],
    ['https://inventory.test', '/../admin', 'public_only', []],
    ['https://inventory.test', '/v1', 'allowlisted_networks', []],
    ['https://inventory.test', '/v1', 'test_loopback_tls', []]
  ])('rejects unsafe configuration %#', (origin, basePath, addressMode, allowedCidrs) => {
    expect(() => new ConnectorDestinationPolicy([{ upstreamServiceRef: 'inventory-api', origin, basePath, addressMode: addressMode as never, allowedCidrs }], 'production')).toThrow('Invalid upstream configuration.');
  });

  it('permits loopback only in explicit test mode and never marks it production eligible', () => {
    const testPolicy = new ConnectorDestinationPolicy([{ upstreamServiceRef: 'fixture-api', origin: 'https://fixture.test:9443', basePath: '/', addressMode: 'test_loopback_tls', allowedCidrs: ['127.0.0.0/8'] }], 'test');
    expect(testPolicy.isValid).toBe(true);
    expect(testPolicy.productionEligible).toBe(false);
  });

  it.each([
    '10.0.0.0/64',
    '300.300.300.300/24',
    '2001:db8::/129',
    '::ffff:10.0.0.0/95'
  ])('rejects semantically invalid CIDR %s', (cidr) => {
    expect(() => new ConnectorDestinationPolicy([{
      upstreamServiceRef: 'private-api', origin: 'https://private.test', basePath: '/',
      addressMode: 'allowlisted_networks', allowedCidrs: [cidr]
    }], 'production')).toThrow('Invalid upstream configuration.');
  });
});
