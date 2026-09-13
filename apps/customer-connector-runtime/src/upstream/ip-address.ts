import { isIP } from 'node:net';

export type ParsedIpAddress = Readonly<{
  family: 4 | 6;
  sourceFamily: 4 | 6;
  value: bigint;
  canonical: string;
}>;

export type ParsedCidr = Readonly<{
  family: 4 | 6;
  network: bigint;
  prefix: number;
  canonical: string;
}>;

export function parseIpAddress(input: string): ParsedIpAddress | undefined {
  const sourceFamily = isIP(input);
  if (sourceFamily === 4) {
    const value = ipv4Value(input);
    return value === undefined ? undefined : Object.freeze({ family: 4, sourceFamily: 4, value, canonical: ipv4Text(value) });
  }
  if (sourceFamily !== 6) return undefined;
  const value = ipv6Value(input);
  if (value === undefined) return undefined;
  if ((value >> 32n) === 0xffffn) {
    const ipv4 = value & 0xffff_ffffn;
    return Object.freeze({ family: 4, sourceFamily: 6, value: ipv4, canonical: ipv4Text(ipv4) });
  }
  return Object.freeze({ family: 6, sourceFamily: 6, value, canonical: input.toLowerCase() });
}

export function parseCidr(input: string): ParsedCidr | undefined {
  if (typeof input !== 'string') return undefined;
  const separator = input.indexOf('/');
  if (separator <= 0 || separator !== input.lastIndexOf('/')) return undefined;
  const addressText = input.slice(0, separator);
  const prefixText = input.slice(separator + 1);
  if (!/^(?:0|[1-9][0-9]{0,2})$/.test(prefixText)) return undefined;
  const address = parseIpAddress(addressText);
  if (!address) return undefined;
  let prefix = Number(prefixText);
  if (address.sourceFamily === 6 && address.family === 4) {
    if (prefix < 96 || prefix > 128) return undefined;
    prefix -= 96;
  }
  const bits = address.family === 4 ? 32 : 128;
  if (prefix < 0 || prefix > bits) return undefined;
  const shift = BigInt(bits - prefix);
  const network = shift === 0n ? address.value : (address.value >> shift) << shift;
  return Object.freeze({
    family: address.family,
    network,
    prefix,
    canonical: `${address.family === 4 ? ipv4Text(network) : address.canonical}/${prefix}`
  });
}

export function cidrContains(cidr: ParsedCidr, address: ParsedIpAddress): boolean {
  if (cidr.family !== address.family) return false;
  const bits = address.family === 4 ? 32 : 128;
  const shift = BigInt(bits - cidr.prefix);
  return (address.value >> shift) === (cidr.network >> shift);
}

function ipv4Value(input: string): bigint | undefined {
  const parts = input.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
    const number = Number(part);
    if (number < 0 || number > 255) return undefined;
    value = (value << 8n) | BigInt(number);
  }
  return value;
}

function ipv6Value(input: string): bigint | undefined {
  let normalized = input.toLowerCase();
  if (normalized.includes('.')) {
    const finalColon = normalized.lastIndexOf(':');
    if (finalColon < 0) return undefined;
    const dotted = ipv4Value(normalized.slice(finalColon + 1));
    if (dotted === undefined) return undefined;
    normalized = `${normalized.slice(0, finalColon + 1)}${Number((dotted >> 16n) & 0xffffn).toString(16)}:${Number(dotted & 0xffffn).toString(16)}`;
  }
  const halves = normalized.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const zeroCount = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (halves.length === 1 ? left.length !== 8 : zeroCount < 1) return undefined;
  const groups = halves.length === 2 ? [...left, ...Array(zeroCount).fill('0'), ...right] : left;
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  return groups.reduce<bigint>((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function ipv4Text(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 0xffn)).join('.');
}
