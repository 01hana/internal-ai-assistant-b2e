import { Injectable } from '@nestjs/common';
import type { ScopedCapabilityCatalogV1 } from './capability-pack.types';

export type CapabilityCatalogScope = Readonly<{
  customerId: string;
  integrationId: string;
  hostApp: string;
}>;

export type CapabilityCatalogResolution =
  | Readonly<{ available: true; catalog: ScopedCapabilityCatalogV1 }>
  | Readonly<{ available: false; reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' }>;

@Injectable()
export class CapabilityCatalogRegistry {
  private release: ReadonlyMap<string, ScopedCapabilityCatalogV1> = new Map();

  installRelease(catalogs: readonly ScopedCapabilityCatalogV1[]): void {
    const candidate = new Map<string, ScopedCapabilityCatalogV1>();
    for (const catalog of catalogs) {
      const key = scopeKey(catalog);
      if (candidate.has(key)) invalid();
      candidate.set(key, deepFreezeCopy(catalog));
    }
    this.release = candidate;
  }

  resolveCatalog(scope: CapabilityCatalogScope): CapabilityCatalogResolution {
    const catalog = this.release.get(scopeKey(scope));
    return catalog
      ? Object.freeze({ available: true as const, catalog })
      : Object.freeze({ available: false as const, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' as const });
  }
}

function scopeKey(scope: CapabilityCatalogScope): string {
  return `${scope.customerId}\0${scope.integrationId}\0${scope.hostApp}`;
}

function deepFreezeCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => deepFreezeCopy(entry))) as T;
  }
  if (value && typeof value === 'object') {
    const copy = Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, deepFreezeCopy(entry)])
    );
    return Object.freeze(copy) as T;
  }
  return value;
}

function invalid(): never {
  throw new Error('CAPABILITY_PACK_INVALID');
}
