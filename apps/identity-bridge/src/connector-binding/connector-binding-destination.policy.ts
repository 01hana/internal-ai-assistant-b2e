import { isIP } from 'node:net';

export type ConnectorBindingAddressPolicy = Readonly<{
  mode: 'public_only' | 'allowlisted_networks';
  allowedCidrs: readonly string[];
}>;

export type ConnectorBindingAddressResult =
  | Readonly<{ ok: true; value: readonly string[] }>
  | Readonly<{ ok: false; code: 'CONNECTOR_DESTINATION_REJECTED' }>;

type Ip = Readonly<{ family: 4 | 6; value: bigint; canonical: string }>;
type Cidr = Readonly<{ family: 4 | 6; network: bigint; prefix: number }>;

const ALWAYS_DENIED = [
  '0.0.0.0/8', '100.64.0.0/10', '169.254.0.0/16', '192.0.0.0/24', '192.0.2.0/24',
  '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4',
  '::/128', 'fe80::/10', 'ff00::/8', '2001:db8::/32', 'fd00:ec2::254/128'
] as const;
const LOOPBACK = ['127.0.0.0/8', '::1/128'] as const;
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'] as const;

export class ConnectorBindingDestinationPolicy {
  readonly productionReady: boolean;
  private readonly allow: readonly Cidr[];

  constructor(private readonly config: ConnectorBindingAddressPolicy, private readonly allowTestLoopbackTls = false) {
    this.allow = Object.freeze(config.allowedCidrs.map((value) => parseCidr(value)).filter((value): value is Cidr => value !== undefined));
    this.productionReady = !allowTestLoopbackTls;
  }

  validate(addresses: readonly string[]): ConnectorBindingAddressResult {
    if (!Array.isArray(addresses) || addresses.length < 1 || addresses.length > 64) return rejected();
    const parsed = addresses.map(parseIp);
    if (parsed.some((value) => value === undefined)) return rejected();
    const loopback = this.allowTestLoopbackTls ? [] : LOOPBACK;
    const denied = this.config.mode === 'public_only'
      ? [...ALWAYS_DENIED, ...loopback, ...PRIVATE]
      : [...ALWAYS_DENIED, ...loopback];
    for (const address of parsed as Ip[]) {
      if (denied.some((cidr) => contains(cidr, address))) return rejected();
      if (this.config.mode === 'allowlisted_networks' && !this.allow.some((cidr) => containsParsed(cidr, address))) return rejected();
    }
    return Object.freeze({ ok: true, value: Object.freeze((parsed as Ip[]).map((value) => value.canonical).sort()) });
  }
}

export function parseConnectorBindingDestinationPolicyConfig(value: unknown): ConnectorBindingAddressPolicy | undefined {
  if (!plain(value) || !exactKeys(value, ['mode', 'allowedCidrs']) ||
      (value.mode !== 'public_only' && value.mode !== 'allowlisted_networks') ||
      !Array.isArray(value.allowedCidrs) || value.allowedCidrs.length > 64 ||
      value.allowedCidrs.some((cidr) => typeof cidr !== 'string' || parseCidr(cidr) === undefined) ||
      (value.mode === 'public_only' && value.allowedCidrs.length !== 0) ||
      (value.mode === 'allowlisted_networks' && value.allowedCidrs.length === 0)) return undefined;
  return Object.freeze({ mode: value.mode, allowedCidrs: Object.freeze([...new Set(value.allowedCidrs as string[])]) });
}

function rejected(): ConnectorBindingAddressResult {
  return Object.freeze({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
}

function parseIp(text: string): Ip | undefined {
  const family = isIP(text);
  if (family === 4) {
    const value = parseV4(text);
    return value === undefined ? undefined : Object.freeze({ family: 4, value, canonical: v4Text(value) });
  }
  if (family !== 6) return undefined;
  let normalized = text.toLowerCase();
  if (normalized.includes('.')) {
    const index = normalized.lastIndexOf(':');
    const mapped = parseV4(normalized.slice(index + 1));
    if (mapped === undefined) return undefined;
    normalized = `${normalized.slice(0, index + 1)}${Number(mapped >> 16n).toString(16)}:${Number(mapped & 65535n).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 1 ? left.length !== 8 : zeroCount < 1) return undefined;
  const groups = halves.length === 2 ? [...left, ...Array(zeroCount).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const value = groups.reduce((total, group) => (total << 16n) | BigInt(Number.parseInt(group, 16)), 0n);
  if (value >> 32n === 0xffffn) {
    const mapped = value & 0xffffffffn;
    return Object.freeze({ family: 4, value: mapped, canonical: v4Text(mapped) });
  }
  return Object.freeze({ family: 6, value, canonical: normalized });
}

function parseV4(text: string): bigint | undefined {
  const parts = text.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part) || Number(part) > 255) return undefined;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

function v4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n)).join('.');
}

function parseCidr(text: string): Cidr | undefined {
  const [address, prefixText, ...extra] = text.split('/');
  if (extra.length || !address || !/^\d{1,3}$/.test(prefixText ?? '')) return undefined;
  const ip = parseIp(address);
  if (!ip) return undefined;
  let prefix = Number(prefixText);
  if (isIP(address) === 6 && ip.family === 4) {
    if (prefix < 96 || prefix > 128) return undefined;
    prefix -= 96;
  }
  const bits = ip.family === 4 ? 32 : 128;
  if (prefix < 0 || prefix > bits) return undefined;
  const shift = BigInt(bits - prefix);
  return Object.freeze({ family: ip.family, network: shift ? (ip.value >> shift) << shift : ip.value, prefix });
}

function contains(text: string, ip: Ip): boolean {
  const cidr = parseCidr(text);
  return cidr !== undefined && containsParsed(cidr, ip);
}

function containsParsed(cidr: Cidr, ip: Ip): boolean {
  if (cidr.family !== ip.family) return false;
  const shift = BigInt((ip.family === 4 ? 32 : 128) - cidr.prefix);
  return ip.value >> shift === cidr.network >> shift;
}

function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}
