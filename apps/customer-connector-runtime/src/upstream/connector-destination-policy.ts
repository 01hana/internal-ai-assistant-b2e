import type { ConnectorErrorCode } from '@internal-ai-assistant/connector-runtime-contract';
import type { MappedReadRequest } from '../manifest/request-profile.registry';
import { parseCidr } from './ip-address';

export type UpstreamAddressMode = 'public_only' | 'allowlisted_networks' | 'test_loopback_tls';
export interface UpstreamServiceConfiguration {
  readonly upstreamServiceRef: string;
  readonly origin: string;
  readonly basePath: string;
  readonly addressMode: UpstreamAddressMode;
  readonly allowedCidrs: readonly string[];
}
export interface ResolvedUpstreamService extends UpstreamServiceConfiguration {
  readonly hostname: string;
  readonly port: number;
}
export type FixedUpstreamRequest = Readonly<{
  service: ResolvedUpstreamService;
  method: 'GET' | 'POST';
  path: string;
  body?: string;
}>;
export type UpstreamPolicyResult<T> = Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; code: Extract<ConnectorErrorCode, 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_REQUEST_INVALID'> }>;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PATH = /^\/(?!.*(?:\/\/|\\|\.\.?\/))[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/;

export class ConnectorDestinationPolicy {
  private readonly services = new Map<string, ResolvedUpstreamService>();
  readonly isValid: boolean;
  readonly productionEligible: boolean;

  constructor(entries: readonly UpstreamServiceConfiguration[], environment: string) {
    if (entries.length > 100) invalid();
    this.isValid = entries.length > 0;
    let productionEligible = true;
    for (const entry of entries) {
      if (!exactKeys(entry, ['upstreamServiceRef', 'origin', 'basePath', 'addressMode', 'allowedCidrs']) ||
          !ID.test(entry.upstreamServiceRef) || this.services.has(entry.upstreamServiceRef) || !PATH.test(entry.basePath) ||
          !['public_only', 'allowlisted_networks', 'test_loopback_tls'].includes(entry.addressMode) ||
          !Array.isArray(entry.allowedCidrs) || new Set(entry.allowedCidrs).size !== entry.allowedCidrs.length) invalid();
      let url: URL;
      try { url = new URL(entry.origin); } catch { invalid(); }
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || !url.hostname || url.hostname.includes('*')) invalid();
      const port = url.port ? Number(url.port) : 443;
      if (!Number.isInteger(port) || port < 1 || port > 65535) invalid();
      if (entry.addressMode === 'public_only' && entry.allowedCidrs.length !== 0) invalid();
      if (entry.addressMode === 'allowlisted_networks' && entry.allowedCidrs.length === 0) invalid();
      if (entry.addressMode === 'test_loopback_tls') {
        if (environment !== 'test' || entry.allowedCidrs.length === 0) invalid();
        if (!entry.allowedCidrs.every((cidr) => cidr === '127.0.0.0/8' || cidr === '::1/128')) invalid();
        productionEligible = false;
      }
      if (!entry.allowedCidrs.every((cidr) => parseCidr(cidr) !== undefined) ||
          (entry.addressMode === 'allowlisted_networks' && entry.allowedCidrs.some(overlyBroadCidr))) invalid();
      this.services.set(entry.upstreamServiceRef, deepFreeze({ ...entry, basePath: normalizeBasePath(entry.basePath), hostname: url.hostname, port }));
    }
    this.productionEligible = productionEligible;
  }

  resolve(serviceRef: string): ResolvedUpstreamService | undefined { return this.services.get(serviceRef); }
  serviceRefs(): readonly string[] { return Object.freeze([...this.services.keys()]); }
}

export class ClosedUpstreamRequestBuilder {
  constructor(private readonly policy: ConnectorDestinationPolicy) {}
  build(serviceRef: string, request: MappedReadRequest, maxRequestBytes: number): UpstreamPolicyResult<FixedUpstreamRequest> {
    const service = this.policy.resolve(serviceRef);
    if (!service) return failure('CONNECTOR_DESTINATION_REJECTED');
    if (!Number.isInteger(maxRequestBytes) || maxRequestBytes < 1) return failure('CONNECTOR_REQUEST_INVALID');
    const joined = joinPath(service.basePath, request.path);
    if (!PATH.test(joined)) return failure('CONNECTOR_DESTINATION_REJECTED');
    if (request.profile === 'GET_QUERY_V1') {
      const params = [...request.query].sort((a, b) => a.name.localeCompare(b.name)).map(({ name, value }) => `${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`).join('&');
      const path = params ? `${joined}?${params}` : joined;
      if (Buffer.byteLength(path, 'utf8') > maxRequestBytes) return failure('CONNECTOR_REQUEST_INVALID');
      return success(deepFreeze({ service, method: 'GET' as const, path }));
    }
    const bodyObject = Object.fromEntries(request.body.map(({ name, value }) => [name, value]));
    const body = JSON.stringify(bodyObject);
    if (Buffer.byteLength(body, 'utf8') > maxRequestBytes) return failure('CONNECTOR_REQUEST_INVALID');
    return success(deepFreeze({ service, method: 'POST' as const, path: joined, body }));
  }
}

function normalizeBasePath(path: string): string { return path === '/' ? '' : path.replace(/\/$/, ''); }
function joinPath(base: string, path: string): string { return `${base}${path}` || '/'; }
function overlyBroadCidr(value: string): boolean {
  const parsed = parseCidr(value);
  return parsed === undefined || (parsed.family === 6 ? parsed.prefix < 32 : parsed.prefix < 8);
}
function exactKeys(value: object, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); return actual.length === keys.length && actual.every((key, i) => key === [...keys].sort()[i]); }
function invalid(): never { throw new Error('Invalid upstream configuration.'); }
function success<T>(value: T): Readonly<{ ok: true; value: T }> { return Object.freeze({ ok: true, value }); }
function failure(code: 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_REQUEST_INVALID'): Readonly<{ ok: false; code: typeof code }> { return Object.freeze({ ok: false, code }); }
function deepFreeze<T>(value: T): T { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value as object)) deepFreeze(child); } return value; }
