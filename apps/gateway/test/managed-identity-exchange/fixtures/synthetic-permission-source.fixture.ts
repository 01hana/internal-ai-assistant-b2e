import {
  type PermissionSourceAdapter,
  type ResolvePermissionInput,
  type TrustedPermissionMaterial
} from '../../../src/managed-identity-exchange/domain/managed-exchange.domain';

export type SyntheticPermissionSourceScenario = 'trusted' | 'authoritative-empty' | 'semantic-denial' | 'outage' | 'malformed';

const diagnostic = 'DO_NOT_LEAK_SYNTHETIC_PERMISSION_SOURCE_DIAGNOSTIC';

/** Test-only server-trusted permission-source adapter. */
export class SyntheticPermissionSourceFixture implements PermissionSourceAdapter {
  readonly sourceType = 'synthetic';
  private captured: ResolvePermissionInput | undefined;

  constructor(private readonly scenario: SyntheticPermissionSourceScenario = 'trusted') {}

  get input(): ResolvePermissionInput | undefined { return this.captured; }

  async resolve(input: ResolvePermissionInput): Promise<TrustedPermissionMaterial> {
    this.captured = input;
    if (this.scenario === 'outage') throw new Error(diagnostic);
    if (this.scenario === 'authoritative-empty') return material([]);
    if (this.scenario === 'semantic-denial') return material(['orders:read:extra']);
    if (this.scenario === 'malformed') return Object.freeze({ kind: 'managed-permission-material/v1', values: 'orders:read' }) as unknown as TrustedPermissionMaterial;
    return material(['orders:read', 'orders:update', 'orders:read']);
  }
}

export function createSyntheticPermissionSourceFixture(scenario: SyntheticPermissionSourceScenario = 'trusted') {
  const adapter = new SyntheticPermissionSourceFixture(scenario);
  return Object.freeze({
    adapter,
    source: Object.freeze({
      id: 'synthetic-source', sourceType: 'synthetic',
      serviceCredentialReference: 'synthetic-service-reference', adapterContractReference: 'synthetic/v1'
    })
  });
}

function material(values: readonly string[]): TrustedPermissionMaterial {
  return Object.freeze({
    kind: 'managed-permission-material/v1', reference: 'synthetic-permission-reference', values: Object.freeze([...values])
  });
}
