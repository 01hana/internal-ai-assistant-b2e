import type { UpstreamAddressMode } from './connector-destination-policy';
import { cidrContains, parseCidr, parseIpAddress } from './ip-address';

export type AddressValidationResult = Readonly<{ ok: true; value: readonly string[] }> | Readonly<{ ok: false; code: 'CONNECTOR_DESTINATION_REJECTED' }>;

const ALWAYS_DENIED = Object.freeze([
  '0.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '192.0.0.0/24', '192.0.2.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/128', 'fe80::/10', 'ff00::/8', '2001:db8::/32',
  // Non-overridable metadata/special-service endpoints. Keep the IPv4 entry explicit even though link-local is denied above.
  '169.254.169.254/32', 'fd00:ec2::254/128'
]);
const LOOPBACK = Object.freeze(['127.0.0.0/8', '::1/128']);
const PRIVATE = Object.freeze(['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7']);

export class AddressValidator {
  validate(addresses: readonly string[], mode: UpstreamAddressMode, allowedCidrs: readonly string[]): AddressValidationResult {
    if (addresses.length === 0 || addresses.length > 64) return failure();
    const parsed = addresses.map(parseIpAddress);
    if (parsed.some((address) => address === undefined)) return failure();
    const normalized = parsed.map((address) => address!.canonical);
    const denied = mode === 'public_only' ? [...ALWAYS_DENIED, ...LOOPBACK, ...PRIVATE] : mode === 'test_loopback_tls' ? ALWAYS_DENIED : [...ALWAYS_DENIED, ...LOOPBACK];
    for (const address of parsed) {
      if (!address || denied.some((cidr) => contains(cidr, address))) return failure();
      if (mode !== 'public_only' && !allowedCidrs.some((cidr) => contains(cidr, address))) return failure();
    }
    return Object.freeze({ ok: true, value: Object.freeze([...normalized]) });
  }
}

export function normalizeMapped(address: string): string {
  return parseIpAddress(address)?.canonical ?? address.toLowerCase();
}

function contains(cidrText: string, address: NonNullable<ReturnType<typeof parseIpAddress>>): boolean {
  const cidr = parseCidr(cidrText);
  return cidr !== undefined && cidrContains(cidr, address);
}
function failure(): AddressValidationResult { return Object.freeze({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' }); }
