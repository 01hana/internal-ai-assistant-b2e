import { request as httpsRequest, type RequestOptions } from 'node:https';
import type { AppliedCredentialRequest } from '../credentials/credential.types';
import type { FixedUpstreamRequest } from './connector-destination-policy';
import type { PinnedLookup } from './pinned-lookup.adapter';

export interface UpstreamWireResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: AsyncIterable<Uint8Array>;
  readonly destroy?: () => void;
}
export type UpstreamTransportResult = Readonly<{ ok: true; value: UpstreamWireResponse }> | Readonly<{ ok: false; code: 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_TIMEOUT' }>;
type RequestFactory = (options: RequestOptions, callback: (response: any) => void) => any;

export class UpstreamResponseCancelledError extends Error {
  constructor() { super('Upstream response cancelled.'); }
}

export class SafeUpstreamHttpClient {
  constructor(private readonly requestFactory: RequestFactory = httpsRequest as RequestFactory) {}

  execute(fixed: FixedUpstreamRequest, applied: AppliedCredentialRequest, lookup: PinnedLookup, signal: AbortSignal): Promise<UpstreamTransportResult> {
    if (signal.aborted) return Promise.resolve(failure('CONNECTOR_TIMEOUT'));
    const credentialHeaders = extractCredentialHeaders(applied);
    if (!credentialHeaders) return Promise.resolve(failure('CONNECTOR_UPSTREAM_AUTH_FAILED'));
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: UpstreamTransportResult) => { if (!settled) { settled = true; signal.removeEventListener('abort', abort); resolve(result); } };
      let outgoing: any;
      const abort = () => { outgoing?.destroy?.(); finish(failure('CONNECTOR_TIMEOUT')); };
      try {
        const headers: Record<string, string | number> = { Accept: 'application/json', 'Accept-Encoding': 'identity', ...credentialHeaders };
        if (fixed.method === 'POST') { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(fixed.body ?? '', 'utf8'); }
        const options: RequestOptions = {
          protocol: 'https:', hostname: fixed.service.hostname, port: fixed.service.port, servername: fixed.service.hostname,
          method: fixed.method, path: fixed.path, headers, lookup: lookup as never,
          rejectUnauthorized: true, agent: false
        };
        outgoing = this.requestFactory(options, (response) => {
          const status = Number(response.statusCode ?? 0);
          const encoding = singleHeader(response.headers?.['content-encoding']);
          if ((status >= 300 && status < 400) || (encoding !== undefined && encoding.toLowerCase() !== 'identity')) {
            response.destroy?.(); finish(failure('CONNECTOR_DESTINATION_REJECTED')); return;
          }
          if (status === 401 || status === 403) { response.destroy?.(); finish(failure('CONNECTOR_UPSTREAM_AUTH_FAILED')); return; }
          finish(Object.freeze({ ok: true, value: Object.freeze({ statusCode: status, headers: Object.freeze({ ...(response.headers ?? {}) }), body: abortableBody(response, signal), destroy: () => response.destroy?.() }) }));
        });
        outgoing.once?.('error', (error: unknown) => finish(signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure(isTlsError(error) ? 'CONNECTOR_DESTINATION_REJECTED' : 'CONNECTOR_UPSTREAM_FAILED')));
        signal.addEventListener('abort', abort, { once: true });
        if (fixed.method === 'POST' && fixed.body) outgoing.write(fixed.body);
        outgoing.end();
      } catch { finish(signal.aborted ? failure('CONNECTOR_TIMEOUT') : failure('CONNECTOR_UPSTREAM_FAILED')); }
    });
  }
}

async function* abortableBody(response: any, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const abort = () => response.destroy?.();
  signal.addEventListener('abort', abort, { once: true });
  try {
    for await (const chunk of response as AsyncIterable<Uint8Array>) {
      if (signal.aborted) throw new UpstreamResponseCancelledError();
      yield chunk;
    }
    if (signal.aborted) throw new UpstreamResponseCancelledError();
  } finally { signal.removeEventListener('abort', abort); }
}

function extractCredentialHeaders(value: AppliedCredentialRequest): Record<string, string> | undefined {
  const record = value as unknown as Record<string, unknown>;
  const headers: Record<string, string> = {};
  for (const [name, item] of Object.entries(record)) {
    if (name === 'request') continue;
    if (typeof item !== 'string' || !/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name) || ['host', 'content-length', 'content-type', 'accept', 'accept-encoding', 'connection', 'transfer-encoding'].includes(name.toLowerCase())) return undefined;
    headers[name] = item;
  }
  return headers;
}
function singleHeader(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function isTlsError(value: unknown): boolean { const code = value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined; return typeof code === 'string' && (code.includes('CERT') || code.startsWith('ERR_TLS') || code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'); }
function failure(code: UpstreamTransportResult extends infer _ ? 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_UPSTREAM_AUTH_FAILED' | 'CONNECTOR_UPSTREAM_FAILED' | 'CONNECTOR_TIMEOUT' : never): UpstreamTransportResult { return Object.freeze({ ok: false, code }); }
