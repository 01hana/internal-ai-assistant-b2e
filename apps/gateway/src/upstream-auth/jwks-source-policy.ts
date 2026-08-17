import { BlockList, isIP } from 'node:net';

export interface JwksSourceRegistrationPolicy { validate(value: string): void; }

export class ProductionJwksSourceRegistrationPolicy implements JwksSourceRegistrationPolicy {
  validate(value: string): void {
    let url: URL;
    try { url = new URL(value); } catch { throw new JwksSourcePolicyError(); }
    const host = normalizeHost(url.hostname);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || !host || host === 'localhost' || host.endsWith('.localhost') || isIP(host)) throw new JwksSourcePolicyError();
  }
}

const blocked = new BlockList();
for (const [address, prefix, family] of [
  ['0.0.0.0', 8, 'ipv4'], ['10.0.0.0', 8, 'ipv4'], ['100.64.0.0', 10, 'ipv4'], ['127.0.0.0', 8, 'ipv4'], ['169.254.0.0', 16, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'], ['224.0.0.0', 4, 'ipv4'],
  ['::', 128, 'ipv6'], ['::1', 128, 'ipv6'], ['fc00::', 7, 'ipv6'], ['fe80::', 10, 'ipv6'], ['ff00::', 8, 'ipv6']
] as const) blocked.addSubnet(address, prefix, family);

export function assertPublicDestination(addresses: readonly string[]): void {
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new JwksSourcePolicyError();
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

function normalizeHost(host: string): string { return host.toLowerCase().replace(/\.+$/, '').replace(/^\[|\]$/g, ''); }
export class JwksSourcePolicyError extends Error { constructor() { super('JWKS source policy cannot be satisfied.'); this.name = 'JwksSourcePolicyError'; } }
