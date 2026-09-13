import type {
  BindingMintInput,
  BindingResolutionExpectation,
  InvocationBindingExpectation,
  BindingResult,
  BindingRevocationReason,
  MintedConnectorBinding,
  ProtectedBindingView,
  StoredConnectorBindingRecord
} from './binding.types';
import { InMemoryConnectorBindingStore } from './in-memory-connector-binding.store';

export interface BindingHandleLifecycle {
  revoke(record: Readonly<StoredConnectorBindingRecord>, reason: BindingRevocationReason): Promise<void>;
}

const NOOP_HANDLE_LIFECYCLE: BindingHandleLifecycle = Object.freeze({
  async revoke(): Promise<void> {}
});

export class ConnectorBindingService {
  constructor(
    private readonly store: InMemoryConnectorBindingStore,
    private readonly handles: BindingHandleLifecycle = NOOP_HANDLE_LIFECYCLE
  ) {}

  async mint(input: BindingMintInput): Promise<BindingResult<MintedConnectorBinding>> {
    try {
      await this.sweepExpired();
    } catch {
      return Object.freeze({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
    }
    const minted = this.store.mint(input);
    if (!minted.ok) return minted;
    if (minted.value.replaced) {
      try {
        await this.handles.revoke(minted.value.replaced, 'generation_replaced');
      } catch {
        const undisclosed = this.store.revoke(minted.value.connectorContextRef);
        if (undisclosed) {
          try { await this.handles.revoke(undisclosed, 'mint_failed'); } catch { /* inaccessible and fail closed */ }
        }
        return Object.freeze({ ok: false, code: 'CONNECTOR_UNAVAILABLE' });
      }
    }
    const { connectorContextRef, expiresAt, expiresIn, bindingGeneration } = minted.value;
    return Object.freeze({ ok: true, value: Object.freeze({ connectorContextRef, expiresAt, expiresIn, bindingGeneration }) });
  }

  async resolve(reference: string, expectation: BindingResolutionExpectation): Promise<BindingResult<ProtectedBindingView>> {
    const expired = this.store.removeIfExpired(reference);
    if (expired) await this.handles.revoke(expired, 'expired');
    return this.store.resolve(reference, expectation);
  }

  async withLease<T>(
    reference: string,
    expectation: BindingResolutionExpectation,
    work: (binding: ProtectedBindingView, signal: AbortSignal) => Promise<T>
  ): Promise<BindingResult<T>> {
    const expired = this.store.removeIfExpired(reference);
    if (expired) await this.handles.revoke(expired, 'expired');
    const acquired = this.store.acquire(reference, expectation);
    if (!acquired.ok) return acquired;
    try {
      return Object.freeze({ ok: true, value: await work(acquired.value.value, acquired.value.signal) });
    } finally {
      acquired.value.release();
    }
  }

  async withInvocationLease<T>(reference: string, expectation: InvocationBindingExpectation,
    work: (binding: ProtectedBindingView, signal: AbortSignal) => Promise<T>): Promise<BindingResult<T>> {
    const expired = this.store.removeIfExpired(reference);
    if (expired) await this.handles.revoke(expired, 'expired');
    const acquired = this.store.acquireForInvocation(reference, expectation);
    if (!acquired.ok) return acquired;
    try { return Object.freeze({ ok: true, value: await work(acquired.value.value, acquired.value.signal) }); }
    finally { acquired.value.release(); }
  }

  async revoke(
    reference: string,
    reason: BindingRevocationReason = 'administrative'
  ): Promise<BindingResult<undefined>> {
    const record = this.store.revoke(reference);
    if (!record) return Object.freeze({ ok: false, code: 'CONNECTOR_BINDING_INVALID' });
    await this.handles.revoke(record, reason);
    return Object.freeze({ ok: true, value: undefined });
  }

  async sweepExpired(): Promise<number> {
    const records = this.store.sweepExpired();
    for (const record of records) await this.handles.revoke(record, 'expired');
    return records.length;
  }

  async shutdown(): Promise<void> {
    const records = this.store.clear();
    for (const record of records) await this.handles.revoke(record, 'shutdown');
  }
}
