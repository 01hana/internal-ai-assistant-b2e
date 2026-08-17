import { request as httpsRequest } from 'node:https';
import { lookup } from 'node:dns/promises';
import { ProductionJwksSourceRegistrationPolicy, assertPublicDestination } from './jwks-source-policy';
import type { JSONWebKeySet } from 'jose';

export const JWKS_TIMEOUT_MS = 5000;
export const JWKS_MAX_RESPONSE_BYTES = 256 * 1024;
export type JwksDocument = JSONWebKeySet;
type Response = Readonly<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array> }>;
export interface JwksTransport { fetch(value: string): Promise<JwksDocument>; }
type LookupFn = (hostname: string) => Promise<string[]>;
type RequestFn = (url: URL, lookupFn: LookupFn, signal: AbortSignal) => Promise<Response>;
type Dependencies = Readonly<{ timeoutMs?: number; resolve?: (hostname: string) => Promise<string[]>; request?: RequestFn }>;

export class HardenedJwksTransport implements JwksTransport {
  private readonly resolve: (hostname: string) => Promise<string[]>;
  private readonly request: RequestFn;
  constructor(private readonly dependencies: Dependencies = {}) {
    this.resolve = dependencies.resolve ?? (async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
    this.request = dependencies.request ?? ((url, lookupFn, signal) => nodeRequest(url, lookupFn, signal));
  }
  async fetch(value: string): Promise<JwksDocument> {
    const abort = new AbortController();
    return deadline(this.fetchBounded(value, abort.signal), this.dependencies.timeoutMs ?? JWKS_TIMEOUT_MS, () => abort.abort());
  }
  private async fetchBounded(value: string, signal: AbortSignal): Promise<JwksDocument> {
    let url: URL;
    try { url = new URL(value); } catch { throw new JwksTransportError(); }
    new ProductionJwksSourceRegistrationPolicy().validate(value);
    assertPublicDestination(await abortable(this.resolve(url.hostname), signal));
    const response = await this.request(url, async (hostname) => {
      const addresses = await abortable(this.resolve(hostname), signal);
      assertPublicDestination(addresses);
      return addresses;
    }, signal);
    if (response.statusCode !== 200 || !jsonContentType(response.headers['content-type'])) throw new JwksTransportError();
    const body = await boundedBody(response.body, signal);
    let parsed: unknown;
    try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { throw new JwksTransportError(); }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { keys?: unknown }).keys) || !(parsed as { keys: unknown[] }).keys.length || !(parsed as { keys: unknown[] }).keys.every((key) => key && typeof key === 'object' && !Array.isArray(key))) throw new JwksTransportError();
    return parsed as JwksDocument;
  }
}

async function nodeRequest(url: URL, lookupFn: LookupFn, signal: AbortSignal): Promise<Response> {
  if (url.protocol !== 'https:') throw new JwksTransportError();
  const request = httpsRequest;
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new JwksTransportError());
    const req = request(url, { timeout: JWKS_TIMEOUT_MS, headers: { accept: 'application/json, application/jwk-set+json' }, lookup: (hostname, _options, callback) => lookupFn(hostname).then((addresses) => callback(null, addresses[0], addresses[0].includes(':') ? 6 : 4)).catch((error) => callback(error, '')) }, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response }));
    signal.addEventListener('abort', () => req.destroy(new JwksTransportError()), { once: true });
    req.once('timeout', () => req.destroy(new JwksTransportError()));
    req.once('error', () => reject(new JwksTransportError()));
    req.end();
  });
}
async function boundedBody(body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> { const parts: Uint8Array[] = []; let length = 0; try { for await (const part of body) { if (signal.aborted) throw new JwksTransportError(); length += part.length; if (length > JWKS_MAX_RESPONSE_BYTES) throw new JwksTransportError(); parts.push(part); } } catch { throw new JwksTransportError(); } const result = Buffer.concat(parts); return result; }
function jsonContentType(value: string | string[] | undefined): boolean { const type = Array.isArray(value) ? value[0] : value; return typeof type === 'string' && /^(application\/json|application\/jwk-set\+json)(?:\s*;|$)/i.test(type); }
export class JwksTransportError extends Error { constructor() { super('JWKS retrieval cannot be completed.'); this.name = 'JwksTransportError'; } }
function deadline<T>(promise: Promise<T>, milliseconds: number, onTimeout: () => void): Promise<T> { return new Promise((resolve, reject) => { const timer = setTimeout(() => { onTimeout(); reject(new JwksTransportError()); }, milliseconds); promise.then((value) => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); reject(new JwksTransportError()); }); }); }
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> { if (signal.aborted) return Promise.reject(new JwksTransportError()); return new Promise((resolve, reject) => { const abort = () => reject(new JwksTransportError()); signal.addEventListener('abort', abort, { once: true }); promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, () => { signal.removeEventListener('abort', abort); reject(new JwksTransportError()); }); }); }
