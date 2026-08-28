import { BlockList, isIP } from 'node:net';
import type { DestinationPolicy } from '../../config/destination-policy.config';
import { IdxTransportError } from './transport.error';

const blockedPublic = new BlockList();
for (const [address, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'], ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'], ['224.0.0.0', 4, 'ipv4'], ['240.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'], ['2001:db8::', 32, 'ipv6'], ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6']
] as const) blockedPublic.addSubnet(address, prefix, family);

const customerLocal = new BlockList();
for (const [address, prefix, family] of [['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['fc00::', 7, 'ipv6']] as const) customerLocal.addSubnet(address, prefix, family);

/** Customer-local admission policy for resolved IDX destination addresses. */
export class BridgeDestinationPolicy {
  private readonly allowed = new BlockList();

  constructor(private readonly config: DestinationPolicy) {
    for (const cidr of config.allowedCidrs) {
      const [address, prefix] = cidr.split('/');
      this.allowed.addSubnet(address, Number(prefix), isIP(address) === 4 ? 'ipv4' : 'ipv6');
    }
  }

  assertAddresses(addresses: readonly string[]): readonly string[] {
    const normalized = addresses.map(normalizeAddress);
    if (!normalized.length || normalized.some((address) => !this.admits(address))) throw new IdxTransportError('unsafe_destination');
    return Object.freeze(normalized);
  }

  private admits(address: string): boolean {
    const family = isIP(address);
    if (!family) return false;
    if (this.config.mode === 'allowlisted_networks') return this.allowed.check(address, family === 4 ? 'ipv4' : 'ipv6') && customerLocal.check(address, family === 4 ? 'ipv4' : 'ipv6');
    return !blockedPublic.check(address, family === 4 ? 'ipv4' : 'ipv6');
  }
}

function normalizeAddress(value: string): string {
  const address = value.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(address) !== 6) return address;
  const mapped = mappedIpv4(address);
  return mapped ?? address;
}

function mappedIpv4(address: string): string | undefined {
  const halves = address.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const dotted = right[right.length - 1];
  if (dotted?.includes('.')) {
    if (isIP(dotted) !== 4) return undefined;
    const octets = dotted.split('.').map(Number);
    right.splice(-1, 1, ((octets[0] << 8) | octets[1]).toString(16), ((octets[2] << 8) | octets[3]).toString(16));
  }
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  if (groups.length !== 8 || !groups.slice(0, 5).every((group) => Number.parseInt(group || '0', 16) === 0) || Number.parseInt(groups[5] || '0', 16) !== 0xffff) return undefined;
  const high = Number.parseInt(groups[6] || '', 16); const low = Number.parseInt(groups[7] || '', 16);
  if (!Number.isInteger(high) || !Number.isInteger(low)) return undefined;
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}
