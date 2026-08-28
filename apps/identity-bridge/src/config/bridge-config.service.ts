import { Inject, Injectable, Optional } from '@nestjs/common';
import { BridgeConfigurationError, type DestinationPolicy, httpsUri, parseDestinationPolicy, required } from './destination-policy.config';

export type SigningKeyConfig = Readonly<{ kid: string; status: 'published' | 'active' | 'retiring'; publicJwk: Readonly<Record<string, unknown>>; keyReference?: string }>;
export type BridgeConfiguration = Readonly<{ idxMenuDetailUri: string; allowedEntry: string; integrationId: string; hostApp: string; issuer: string; audience: string; signingKeys: readonly SigningKeyConfig[]; destination: DestinationPolicy; timeoutMilliseconds: number; maxResponseBytes: number; allowedOrigins: readonly string[] }>;
export type ConfigurationResult = Readonly<{ ok: true; config: BridgeConfiguration } | { ok: false; category: string }>;
export const BRIDGE_ENVIRONMENT = Symbol('BRIDGE_ENVIRONMENT');

@Injectable()
export class BridgeConfigService {
  private readonly result: ConfigurationResult;
  constructor(@Optional() @Inject(BRIDGE_ENVIRONMENT) input: Record<string, unknown> = process.env) { this.result = parseBridgeConfiguration(input); }
  get isValid(): boolean { return this.result.ok; }
  get configuration(): BridgeConfiguration { if (!this.result.ok) throw new BridgeConfigurationError(this.result.category); return this.result.config; }
  get validation(): ConfigurationResult { return this.result; }
}

export function parseBridgeConfiguration(input: Record<string, unknown>): ConfigurationResult {
  try {
    for (const name of ['BRIDGE_PRIVATE_KEY', 'BRIDGE_PRIVATE_KEY_PEM', 'JWT_SIGNING_SECRET']) if (input[name] !== undefined) throw new BridgeConfigurationError('private_key_material');
    const config: BridgeConfiguration = Object.freeze({
      idxMenuDetailUri: httpsUri(input.BRIDGE_IDX_MENUDETAIL_URI, 'idx_endpoint'), allowedEntry: required(input.BRIDGE_IDX_ALLOWED_ENTRY),
      integrationId: required(input.BRIDGE_INTEGRATION_ID), hostApp: required(input.BRIDGE_HOST_APP), issuer: required(input.BRIDGE_ISSUER), audience: required(input.BRIDGE_AUDIENCE),
      signingKeys: signingKeys(input.BRIDGE_SIGNING_KEYS), destination: parseDestinationPolicy(input), timeoutMilliseconds: integer(input.BRIDGE_TIMEOUT_MS, 1, 5000, 'timeout'), maxResponseBytes: integer(input.BRIDGE_MAX_RESPONSE_BYTES, 1, 262144, 'response_size'), allowedOrigins: origins(input.BRIDGE_ALLOWED_ORIGINS)
    });
    return { ok: true, config };
  } catch (error) { return { ok: false, category: error instanceof BridgeConfigurationError ? error.category : 'invalid' }; }
}
function integer(value: unknown, min: number, max: number, category: string): number { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BridgeConfigurationError(category); return parsed; }
function signingKeys(value: unknown): readonly SigningKeyConfig[] {
  if (typeof value !== 'string') throw new BridgeConfigurationError('signing_keys'); let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new BridgeConfigurationError('signing_keys'); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new BridgeConfigurationError('signing_keys'); const seen = new Set<string>();
  return Object.freeze(parsed.map((item) => { if (!record(item) || !record(item.publicJwk)) throw new BridgeConfigurationError('signing_keys'); const kid = required(item.kid); const status = item.status; if (!['published', 'active', 'retiring'].includes(status as string) || seen.has(kid) || privateJwk(item.publicJwk)) throw new BridgeConfigurationError('signing_keys'); seen.add(kid); const reference = item.keyReference === undefined ? undefined : safeReference(item.keyReference); return Object.freeze(reference === undefined ? { kid, status: status as SigningKeyConfig['status'], publicJwk: Object.freeze({ ...item.publicJwk }) } : { kid, status: status as SigningKeyConfig['status'], publicJwk: Object.freeze({ ...item.publicJwk }), keyReference: reference }); }));
}
function origins(value: unknown): readonly string[] { if (value === undefined || value === '') return Object.freeze([]); if (typeof value !== 'string') throw new BridgeConfigurationError('origins'); const entries = value.split(',').map((entry) => entry.trim()); if (!entries.every((entry) => entry && entry !== '*')) throw new BridgeConfigurationError('origins'); const normalized = entries.map((entry) => { const uri = httpsUri(entry, 'origins'); const url = new URL(uri); if (url.pathname !== '/' || url.search || url.hash) throw new BridgeConfigurationError('origins'); return url.origin; }); return Object.freeze([...new Set(normalized)]); }
function safeReference(value: unknown): string {
  const reference = required(value);
  if (/-----BEGIN|^Bearer\s|^[\w-]+\.[\w-]+\.[\w-]+$/i.test(reference)) throw new BridgeConfigurationError('signing_keys');
  try {
    const uri = new URL(reference);
    if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash) throw new Error();
  } catch { throw new BridgeConfigurationError('signing_keys'); }
  return reference;
}
function privateJwk(value: Record<string, unknown>): boolean { return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((key) => key in value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
