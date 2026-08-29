import { Injectable } from '@nestjs/common';
import { BridgeConfigService } from '../config/bridge-config.service';

export type RuntimeDependency = 'idxTransport' | 'idxSemantics' | 'signing' | 'jwks' | 'exchange';
const RUNTIME_DEPENDENCIES: readonly RuntimeDependency[] = Object.freeze(['idxTransport', 'idxSemantics', 'signing', 'jwks', 'exchange']);

@Injectable()
export class BridgeReadinessRegistry {
  private readonly states = new Map<RuntimeDependency, boolean>(RUNTIME_DEPENDENCIES.map((dependency) => [dependency, false]));

  setReady(dependency: RuntimeDependency, ready: boolean): void {
    if (!RUNTIME_DEPENDENCIES.includes(dependency)) throw new Error('Unknown Bridge readiness dependency.');
    this.states.set(dependency, ready);
  }

  snapshot(): Readonly<Record<RuntimeDependency, boolean>> {
    return Object.freeze(Object.fromEntries(RUNTIME_DEPENDENCIES.map((dependency) => [dependency, this.states.get(dependency) === true])) as Record<RuntimeDependency, boolean>);
  }
}

@Injectable()
export class BridgeReadinessService {
  constructor(private readonly config: BridgeConfigService, private readonly registry: BridgeReadinessRegistry) {}
  snapshot(): Readonly<{ configurationValid: boolean; ready: boolean; missing: readonly RuntimeDependency[] }> {
    const states = this.registry.snapshot();
    const missing = Object.freeze(RUNTIME_DEPENDENCIES.filter((dependency) => !states[dependency]));
    const configurationValid = this.config.isValid;
    return Object.freeze({ configurationValid, ready: configurationValid && missing.length === 0, missing });
  }
  getPublicReadiness() {
    const ready = this.snapshot().ready;
    return Object.freeze({
      status: ready ? 'ready' as const : 'not_ready' as const,
      service: 'identity-bridge' as const,
      timestamp: new Date().toISOString(),
      runtimeDependencies: ready ? 'available' as const : 'not_evaluated' as const,
      productionReady: ready
    });
  }
}
