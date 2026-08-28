import { lookup } from 'node:dns/promises';
import { BridgeDestinationPolicy } from './destination-policy';
import { IdxTransportError } from './transport.error';

export type AddressResolver = (hostname: string) => Promise<readonly string[]>;

export class AddressValidator {
  constructor(private readonly policy: BridgeDestinationPolicy, private readonly resolve: AddressResolver = productionResolve) {}

  async preflight(hostname: string, signal: AbortSignal): Promise<readonly string[]> {
    return this.resolveAndValidate(hostname, signal);
  }

  async connectionLookup(hostname: string, signal: AbortSignal): Promise<readonly string[]> {
    return this.resolveAndValidate(hostname, signal);
  }

  private async resolveAndValidate(hostname: string, signal: AbortSignal): Promise<readonly string[]> {
    try { return this.policy.assertAddresses(await abortable(this.resolve(hostname), signal)); }
    catch (error) {
      if (error instanceof IdxTransportError) throw error;
      throw new IdxTransportError(signal.aborted ? 'timeout' : 'dns_failure');
    }
  }
}

async function productionResolve(hostname: string): Promise<readonly string[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new IdxTransportError('timeout'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new IdxTransportError('timeout'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => { signal.removeEventListener('abort', abort); resolve(value); }, (error) => { signal.removeEventListener('abort', abort); reject(error); });
  });
}
