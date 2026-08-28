import { Injectable } from '@nestjs/common';
import { request as httpsRequest } from 'node:https';
import { BridgeConfigService } from '../../config/bridge-config.service';
import { AddressValidator, type AddressResolver } from './address-validator';
import { BridgeDestinationPolicy } from './destination-policy';
import { createPinnedLookupAdapter } from './pinned-lookup.adapter';
import { IdxTransportError } from './transport.error';

export type RawMenuDetailResponse = Readonly<{ statusCode: number; headers: Readonly<Record<string, string | string[] | undefined>>; body: AsyncIterable<Uint8Array>; dispose?: () => void }>;
export type MenuDetailTransportResult = Readonly<{ body: unknown }>;
export type MenuDetailRequestOptions = Readonly<{ method: 'GET'; headers: Readonly<{ accept: 'application/json'; authorization: string }>; lookup(hostname: string): Promise<readonly string[]>; signal: AbortSignal }>;
export type MenuDetailRequest = (url: URL, options: MenuDetailRequestOptions) => Promise<RawMenuDetailResponse>;
export type MenuDetailTransportDependencies = Readonly<{ resolve?: AddressResolver; request?: MenuDetailRequest; setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>; clearTimer?: (timer: ReturnType<typeof setTimeout>) => void }>;

@Injectable()
export class MenuDetailTransport {
  private readonly request: MenuDetailRequest;
  private readonly setTimer: NonNullable<MenuDetailTransportDependencies['setTimer']>;
  private readonly clearTimer: NonNullable<MenuDetailTransportDependencies['clearTimer']>;
  constructor(private readonly bridgeConfig: BridgeConfigService, dependencies: MenuDetailTransportDependencies = {}) {
    this.request = dependencies.request ?? nodeRequest;
    this.setTimer = dependencies.setTimer ?? setTimeout;
    this.clearTimer = dependencies.clearTimer ?? clearTimeout;
    this.resolve = dependencies.resolve;
  }

  private readonly resolve?: AddressResolver;

  async execute(nativeAccessToken: string): Promise<MenuDetailTransportResult> {
    const controller = new AbortController();
    const config = this.bridgeConfig.configuration;
    const validator = new AddressValidator(new BridgeDestinationPolicy(config.destination), this.resolve);
    try {
      return await deadline(this.executeBounded(new URL(config.idxMenuDetailUri), nativeAccessToken, config.maxResponseBytes, validator, controller.signal), config.timeoutMilliseconds, controller, this.setTimer, this.clearTimer);
    } catch (error) {
      controller.abort();
      throw error instanceof IdxTransportError ? error : new IdxTransportError('network_failure');
    }
  }

  private async executeBounded(url: URL, nativeAccessToken: string, maxResponseBytes: number, validator: AddressValidator, signal: AbortSignal): Promise<MenuDetailTransportResult> {
    let response: RawMenuDetailResponse | undefined;
    try {
      await validator.preflight(url.hostname, signal);
      const connectionAddresses = await validator.connectionLookup(url.hostname, signal);
      response = await this.request(url, Object.freeze({
        method: 'GET' as const,
        headers: Object.freeze({ accept: 'application/json' as const, authorization: `Bearer ${nativeAccessToken}` }),
        lookup: async (hostname) => {
          if (hostname !== url.hostname) throw new IdxTransportError('unsafe_destination');
          return connectionAddresses;
        }, signal
      }));
      if (response.statusCode !== 200) throw new IdxTransportError('redirect_or_status');
      if (!jsonContentType(response.headers['content-type'])) throw new IdxTransportError('content_type');
      const bytes = await boundedBody(response.body, maxResponseBytes, signal);
      try { return Object.freeze({ body: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }); }
      catch { throw new IdxTransportError('malformed_json'); }
    } catch (error) {
      try { response?.dispose?.(); } catch { /* preserve safe failure */ }
      throw error instanceof IdxTransportError ? error : new IdxTransportError(signal.aborted ? 'timeout' : 'network_failure');
    }
  }
}

async function nodeRequest(url: URL, options: MenuDetailRequestOptions): Promise<RawMenuDetailResponse> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(new IdxTransportError('timeout'));
    const request = httpsRequest(url, {
      method: options.method, headers: options.headers,
      lookup: (hostname, settings, callback) => options.lookup(hostname).then((addresses) => {
        createPinnedLookupAdapter(addresses)(hostname, settings, callback);
      }).catch(() => callback(new IdxTransportError('unsafe_destination'), ''))
    }, (response) => resolve({ statusCode: response.statusCode ?? 0, headers: response.headers, body: response, dispose: () => response.destroy() }));
    const abort = () => request.destroy(new IdxTransportError('timeout'));
    options.signal.addEventListener('abort', abort, { once: true });
    request.once('error', () => reject(new IdxTransportError(options.signal.aborted ? 'timeout' : 'network_failure')));
    request.end();
  });
}

async function boundedBody(body: AsyncIterable<Uint8Array>, maximum: number, signal: AbortSignal): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for await (const chunk of body) {
      if (signal.aborted) throw new IdxTransportError('timeout');
      size += chunk.byteLength;
      if (size > maximum) throw new IdxTransportError('response_too_large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (error) { throw error instanceof IdxTransportError ? error : new IdxTransportError(signal.aborted ? 'timeout' : 'network_failure'); }
}

function jsonContentType(value: string | string[] | undefined): boolean {
  return typeof value === 'string' && /^application\/json(?:\s*;\s*charset=utf-?8)?\s*$/i.test(value);
}

function deadline<T>(promise: Promise<T>, milliseconds: number, controller: AbortController, setTimer: NonNullable<MenuDetailTransportDependencies['setTimer']>, clearTimer: NonNullable<MenuDetailTransportDependencies['clearTimer']>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimer(() => { controller.abort(); reject(new IdxTransportError('timeout')); }, milliseconds);
    promise.then((result) => { clearTimer(timer); resolve(result); }, (error) => { clearTimer(timer); reject(error); });
  });
}
