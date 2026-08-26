import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { assertPublicDestination } from '../../upstream-auth/jwks-source-policy';
import { type VerifyNativeCredentialInput, ManagedExchangeCredentialError, ManagedExchangeIdentityDeniedError, ManagedExchangeInfrastructureError } from '../domain/managed-exchange.domain';
import { DelegatedEndpointPolicy } from './delegated-endpoint.policy';

export const DELEGATED_HTTP_MAX_RESPONSE_BYTES = 256 * 1024;
export const DELEGATED_HTTP_MAX_DEADLINE_MS = 5_000;
export type DelegatedHttpResponse = Readonly<{ status: 200; contentType: 'application/json'; body: unknown }>;
export type DelegatedHttpRequestOptions = Readonly<{
  method: 'POST' | 'GET';
  headers: Readonly<{ accept: 'application/json'; authorization: string }>;
  lookup(hostname: string): Promise<readonly string[]>;
  signal: AbortSignal;
}>;
type RawResponse = Readonly<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array>; dispose?: () => void }>;
type RequestExecutor = (url: URL, options: DelegatedHttpRequestOptions) => Promise<RawResponse>;
type Resolve = (hostname: string) => Promise<readonly string[]>;
type Timer = (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
type Dependencies = Readonly<{
  resolve?: Resolve;
  request?: RequestExecutor;
  timeoutMs?: number;
  setTimer?: Timer;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  endpoints?: DelegatedEndpointPolicy;
}>;

/** Sends an opaque credential once to a fixed, validated registered destination. */
export class DelegatedHttpTransport {
  private readonly resolve: Resolve;
  private readonly request: RequestExecutor;
  private readonly endpoints: DelegatedEndpointPolicy;
  private readonly setTimer: Timer;
  private readonly clearTimer: (timer: ReturnType<typeof setTimeout>) => void;

  constructor(private readonly dependencies: Dependencies = {}) {
    this.resolve = dependencies.resolve ?? (async (hostname) => (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address));
    this.request = dependencies.request ?? nodeRequest;
    this.endpoints = dependencies.endpoints ?? new DelegatedEndpointPolicy();
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
  }

  async execute(input: VerifyNativeCredentialInput): Promise<DelegatedHttpResponse> {
    const controller = new AbortController();
    try {
      const url = this.endpoints.validate(input.providerInstancePolicy);
      const method = storedMethod(input.providerInstancePolicy.httpMethod);
      const configuredDeadline = input.providerInstancePolicy.timeoutMilliseconds;
      const timeoutMs = Math.min(configuredDeadline, this.dependencies.timeoutMs ?? configuredDeadline);
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DELEGATED_HTTP_MAX_DEADLINE_MS) throw new ManagedExchangeInfrastructureError();
      return await deadline(this.executeBounded(url, input.nativeCredential, method, controller.signal), timeoutMs, controller, this.setTimer, this.clearTimer);
    } catch (error) {
      controller.abort();
      if (managedFailure(error)) throw error;
      throw new ManagedExchangeInfrastructureError();
    }
  }

  private async executeBounded(url: URL, credential: string, method: DelegatedHttpRequestOptions['method'], signal: AbortSignal): Promise<DelegatedHttpResponse> {
    let response: RawResponse | undefined;
    try {
      assertPublicDestination(await abortable(this.resolve(url.hostname), signal));
      response = await this.request(url, {
        method,
        headers: Object.freeze({ accept: 'application/json', authorization: `Bearer ${credential}` }),
        lookup: async (hostname) => {
          const addresses = await abortable(this.resolve(hostname), signal);
          assertPublicDestination(addresses);
          return addresses;
        },
        signal
      });
      if (response.statusCode === 401) throw new ManagedExchangeCredentialError();
      if (response.statusCode === 403) throw new ManagedExchangeIdentityDeniedError();
      if (response.statusCode !== 200 || !jsonContentType(response.headers['content-type'])) throw new ManagedExchangeInfrastructureError();
      const bytes = await boundedBody(response.body, signal);
      return Object.freeze({ status: 200 as const, contentType: 'application/json' as const, body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) });
    } catch (error) {
      try { response?.dispose?.(); } catch { /* preserve the generic transport failure */ }
      throw managedFailure(error) ? error : new ManagedExchangeInfrastructureError();
    }
  }
}

function storedMethod(value: unknown): DelegatedHttpRequestOptions['method'] {
  if (value === 'POST' || value === 'GET') return value;
  throw new ManagedExchangeInfrastructureError();
}

function managedFailure(error: unknown): error is ManagedExchangeCredentialError | ManagedExchangeIdentityDeniedError | ManagedExchangeInfrastructureError {
  return error instanceof ManagedExchangeCredentialError || error instanceof ManagedExchangeIdentityDeniedError || error instanceof ManagedExchangeInfrastructureError;
}

async function nodeRequest(url: URL, options: DelegatedHttpRequestOptions): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new ManagedExchangeInfrastructureError());
    const request = httpsRequest(url, {
      method: options.method,
      headers: options.headers,
      lookup: (hostname, _settings, callback) => options.lookup(hostname).then((addresses) => {
        const address = addresses[0];
        callback(null, address, address.includes(':') ? 6 : 4);
      }).catch(() => callback(new ManagedExchangeInfrastructureError(), ''))
    }, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response, dispose: () => response.destroy(new ManagedExchangeInfrastructureError()) }));
    const abort = () => request.destroy(new ManagedExchangeInfrastructureError());
    options.signal.addEventListener('abort', abort, { once: true });
    request.once('error', () => reject(new ManagedExchangeInfrastructureError()));
    request.end();
  });
}

async function boundedBody(body: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for await (const part of body) {
      if (signal.aborted) throw new ManagedExchangeInfrastructureError();
      size += part.length;
      if (size > DELEGATED_HTTP_MAX_RESPONSE_BYTES) throw new ManagedExchangeInfrastructureError();
      parts.push(part);
    }
    return Buffer.concat(parts);
  } catch {
    throw new ManagedExchangeInfrastructureError();
  }
}

function jsonContentType(value: string | string[] | undefined): boolean {
  if (Array.isArray(value)) return false;
  const contentType = value;
  return typeof contentType === 'string' && /^application\/json(?:\s*;\s*charset=utf-?8)?\s*$/i.test(contentType);
}

function deadline<T>(promise: Promise<T>, milliseconds: number, controller: AbortController, setTimer: Timer, clearTimer: (timer: ReturnType<typeof setTimeout>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimer(() => { controller.abort(); reject(new ManagedExchangeInfrastructureError()); }, milliseconds);
    promise.then((value) => { clearTimer(timer); resolve(value); }, (error) => {
      clearTimer(timer);
      reject(managedFailure(error) ? error : new ManagedExchangeInfrastructureError());
    });
  });
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ManagedExchangeInfrastructureError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(new ManagedExchangeInfrastructureError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, () => { signal.removeEventListener('abort', abort); reject(new ManagedExchangeInfrastructureError()); });
  });
}
