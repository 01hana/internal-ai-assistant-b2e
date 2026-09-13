import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AddressValidator } from './address-validator';
import type { UpstreamAddressMode } from './connector-destination-policy';

export type DnsResolver = (hostname: string, signal: AbortSignal) => Promise<readonly Readonly<{ address: string; family: number }>[] >;
export type PinnedLookup = (hostname: string, options: Readonly<{ all?: boolean }>, callback: (error: Error | null, address?: string | readonly Readonly<{ address: string; family: number }>[], family?: number) => void) => void;
export type PinResult = Readonly<{ ok: true; value: Readonly<{ addresses: readonly string[]; lookup: PinnedLookup }> }> |
  Readonly<{ ok: false; code: 'CONNECTOR_DESTINATION_REJECTED' | 'CONNECTOR_TIMEOUT' }>;

export async function resolveAndPin(hostname: string, mode: UpstreamAddressMode, allowedCidrs: readonly string[], signal: AbortSignal, resolver: DnsResolver = defaultResolver): Promise<PinResult> {
  if (signal.aborted) return timeout();
  try {
    const answers = await raceWithAbort(resolver(hostname, signal), signal);
    if (signal.aborted) return timeout();
    const validated = new AddressValidator().validate(answers.map((answer) => answer.address), mode, allowedCidrs);
    if (!validated.ok) return validated;
    const address = validated.value[0]!;
    const family = isIP(address);
    const lookup: PinnedLookup = (requested, options, callback) => {
      if (requested !== hostname) { callback(new Error('Pinned hostname mismatch.')); return; }
      if (options.all) callback(null, Object.freeze([Object.freeze({ address, family })]));
      else callback(null, address, family);
    };
    return Object.freeze({ ok: true, value: Object.freeze({ addresses: validated.value, lookup }) });
  } catch (error) {
    return error instanceof DnsResolutionCancelled || signal.aborted
      ? timeout()
      : Object.freeze({ ok: false, code: 'CONNECTOR_DESTINATION_REJECTED' });
  }
}

async function defaultResolver(hostname: string, _signal: AbortSignal): Promise<readonly Readonly<{ address: string; family: number }>[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

class DnsResolutionCancelled extends Error {}

function raceWithAbort<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DnsResolutionCancelled());
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      action();
    };
    const abort = () => finish(() => reject(new DnsResolutionCancelled()));
    signal.addEventListener('abort', abort, { once: true });
    pending.then((value) => finish(() => resolve(value)), (error) => finish(() => reject(error)));
  });
}

function timeout(): PinResult { return Object.freeze({ ok: false, code: 'CONNECTOR_TIMEOUT' }); }
