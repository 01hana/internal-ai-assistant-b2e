import { isIP } from 'node:net';

export type DestinationMode = 'public_only' | 'allowlisted_networks';
export type DestinationPolicy = Readonly<{ mode: DestinationMode; allowedCidrs: readonly string[]; publicJwksUri: string }>;

export function parseDestinationPolicy(input: Record<string, unknown>): DestinationPolicy {
  const mode = required(input.IDX_DESTINATION_MODE) as DestinationMode;
  if (mode !== 'public_only' && mode !== 'allowlisted_networks') throw new BridgeConfigurationError('destination_mode');
  const cidrs = csv(input.IDX_ALLOWED_CIDRS);
  if ((mode === 'allowlisted_networks' && cidrs.length === 0) || (mode === 'public_only' && cidrs.length > 0) || cidrs.some((value) => !cidr(value))) throw new BridgeConfigurationError('cidrs');
  return Object.freeze({ mode, allowedCidrs: Object.freeze([...new Set(cidrs)]), publicJwksUri: publicHttps(input.BRIDGE_JWKS_PUBLIC_URI, 'jwks_uri') });
}

export function httpsUri(value: unknown, category: string): string {
  const raw = required(value);
  try { const url = new URL(raw); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(); return url.toString(); } catch { throw new BridgeConfigurationError(category); }
}
function publicHttps(value: unknown, category: string): string {
  const uri = httpsUri(value, category); const host = new URL(uri).hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || isIP(host)) throw new BridgeConfigurationError(category);
  return uri;
}
export function required(value: unknown): string { if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) throw new BridgeConfigurationError('required'); return value.trim(); }
function csv(value: unknown): string[] { if (value === undefined || value === '') return []; if (typeof value !== 'string') throw new BridgeConfigurationError('list'); const values = value.split(',').map((v) => v.trim()); if (values.some((v) => !v)) throw new BridgeConfigurationError('list'); return values; }
function cidr(value: string): boolean { const [address, prefix, ...rest] = value.split('/'); if (rest.length || !address || !/^\d+$/.test(prefix ?? '')) return false; const family = isIP(address); return (family === 4 && Number(prefix) <= 32) || (family === 6 && Number(prefix) <= 128); }
export class BridgeConfigurationError extends Error { constructor(readonly category: string) { super(`Invalid Bridge configuration: ${category}.`); } }
