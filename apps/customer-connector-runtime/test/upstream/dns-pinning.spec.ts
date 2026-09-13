import { AddressValidator, normalizeMapped } from '../../src/upstream/address-validator';
import { resolveAndPin } from '../../src/upstream/pinned-lookup.adapter';

describe('Phase 6 all-address DNS policy and pinning', () => {
  const validator = new AddressValidator();
  it('accepts only when every public answer is safe and normalizes mapped IPv6', () => {
    expect(validator.validate(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'], 'public_only', [])).toEqual(expect.objectContaining({ ok: true }));
    expect(validator.validate(['::ffff:93.184.216.34'], 'public_only', [])).toEqual({ ok: true, value: ['93.184.216.34'] });
  });
  it.each([
    ['::ffff:7f00:1', '127.0.0.1'],
    ['::FFFF:7F00:1', '127.0.0.1'],
    ['::ffff:c0a8:101', '192.168.1.1'],
    ['::FFFF:C0A8:0101', '192.168.1.1'],
    ['::ffff:a14:109', '10.20.1.9']
  ])('semantically canonicalizes mapped address %s to %s', (input, expected) => {
    expect(normalizeMapped(input)).toBe(expected);
  });
  it.each(['::ffff:7f00:1', '::FFFF:7F00:1', '::ffff:c0a8:101'])('denies mapped loopback/private bypass %s in public mode', (address) => {
    expect(validator.validate([address], 'public_only', [])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('evaluates a mapped private address against the IPv4 allowlist and rejects unsafe mixed answers', () => {
    expect(validator.validate(['::ffff:a14:109'], 'allowlisted_networks', ['10.20.0.0/16'])).toEqual({ ok: true, value: ['10.20.1.9'] });
    expect(validator.validate(['::ffff:a14:109'], 'allowlisted_networks', ['::ffff:10.20.0.0/112'])).toEqual({ ok: true, value: ['10.20.1.9'] });
    expect(validator.validate(['93.184.216.34', '::ffff:7f00:1'], 'public_only', [])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it.each(['127.0.0.1', '0.0.0.0', '169.254.169.254', '224.0.0.1', '10.0.0.1', '192.0.2.1', '::1', 'fe80::1', 'ff02::1'])('rejects special address %s', (address) => {
    expect(validator.validate([address], 'public_only', [])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it.each(['169.254.169.254', 'fd00:ec2::254'])('unconditionally rejects metadata address %s in public mode', (address) => {
    expect(validator.validate([address], 'public_only', [])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('does not let broad or exact Customer allowlists override the IPv6 metadata deny', () => {
    expect(validator.validate(['fd00:ec2::254'], 'allowlisted_networks', ['fd00:ec2::/64']))
      .toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    expect(validator.validate(['fd00:ec2::254'], 'allowlisted_networks', ['fd00:ec2::254/128']))
      .toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('continues to allow a non-metadata Customer ULA only through its explicit CIDR', () => {
    expect(validator.validate(['fd12:3456::10'], 'allowlisted_networks', ['fd12:3456::/64']))
      .toEqual({ ok: true, value: ['fd12:3456::10'] });
    expect(validator.validate(['fd12:3456::10'], 'allowlisted_networks', ['fd12:9999::/64']))
      .toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('rejects an entire mixed set and enforces explicit allowlisted networks', () => {
    expect(validator.validate(['93.184.216.34', '127.0.0.1'], 'public_only', [])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
    expect(validator.validate(['10.20.1.9'], 'allowlisted_networks', ['10.20.0.0/16'])).toEqual({ ok: true, value: ['10.20.1.9'] });
    expect(validator.validate(['10.21.1.9'], 'allowlisted_networks', ['10.20.0.0/16'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('allows loopback only through the explicitly configured test TLS mode', () => {
    expect(validator.validate(['127.0.0.1'], 'test_loopback_tls', ['127.0.0.0/8'])).toEqual({ ok: true, value: ['127.0.0.1'] });
    expect(validator.validate(['127.0.0.1'], 'allowlisted_networks', ['127.0.0.0/8'])).toEqual({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  });
  it('resolves once and pins exactly one deterministic address without fallback', async () => {
    const resolver = jest.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '93.184.216.35', family: 4 }]);
    const pinned = await resolveAndPin('inventory.test', 'public_only', [], new AbortController().signal, resolver);
    expect(pinned.ok).toBe(true);
    if (!pinned.ok) return;
    const callback = jest.fn();
    pinned.value.lookup('inventory.test', {}, callback);
    expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
    pinned.value.lookup('other.test', {}, callback);
    expect(callback.mock.calls.at(-1)?.[0]).toBeInstanceOf(Error);
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it.each(['deadline', 'caller', 'lease'])('cancels a never-settling %s DNS stage before any connection can start', async () => {
    const abort = new AbortController();
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<never>(() => undefined));
    const pending = resolveAndPin('inventory.test', 'public_only', [], abort.signal, resolver);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    expect(resolver).toHaveBeenCalledTimes(1);
  });

  it('ignores a resolver completion that arrives after cancellation', async () => {
    const abort = new AbortController();
    let finish: ((value: readonly { address: string; family: number }[]) => void) | undefined;
    const resolver = jest.fn((_hostname: string, _signal: AbortSignal) => new Promise<readonly { address: string; family: number }[]>((resolve) => { finish = resolve; }));
    const pending = resolveAndPin('inventory.test', 'public_only', [], abort.signal, resolver);
    abort.abort();
    await expect(pending).resolves.toEqual({ ok: false, code: 'CONNECTOR_TIMEOUT' });
    finish?.([{ address: '93.184.216.34', family: 4 }]);
    await Promise.resolve();
    expect(resolver).toHaveBeenCalledTimes(1);
  });
});
