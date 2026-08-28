import { isIP } from 'node:net';
import { IdxTransportError } from './transport.error';

export type PinnedLookupAddress = { address: string; family: 4 | 6 };
export type PinnedLookupOptions = Readonly<{ all?: boolean; family?: number | 'IPv4' | 'IPv6' }>;
export type PinnedLookupCallback = (error: Error | null, address: string | PinnedLookupAddress[], family?: 4 | 6) => void;

/** Adapts already-validated connection addresses to Node's custom lookup callback contract. */
export function createPinnedLookupAdapter(addresses: readonly string[]) {
  const pinned = Object.freeze(addresses.map((address) => {
    const family = isIP(address);
    if (family !== 4 && family !== 6) throw new IdxTransportError('unsafe_destination');
    return Object.freeze({ address, family });
  }));
  return (_hostname: string, options: PinnedLookupOptions, callback: PinnedLookupCallback): void => {
    const requestedFamily = family(options.family);
    const matching = requestedFamily === undefined ? pinned : requestedFamily === 'unsupported' ? [] : pinned.filter((entry) => entry.family === requestedFamily);
    if (!matching.length) return callback(new IdxTransportError('unsafe_destination'), '');
    if (options.all === true) return callback(null, matching.map(({ address, family }) => ({ address, family })));
    callback(null, matching[0].address, matching[0].family);
  };
}

function family(value: PinnedLookupOptions['family']): 4 | 6 | 'unsupported' | undefined {
  if (value === undefined || value === 0) return undefined;
  if (value === 4 || value === 'IPv4') return 4;
  if (value === 6 || value === 'IPv6') return 6;
  return 'unsupported';
}
