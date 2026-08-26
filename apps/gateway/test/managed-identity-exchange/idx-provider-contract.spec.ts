import { ManagedExchangeActivationValidator } from '../../src/managed-identity-exchange/persistence/managed-exchange-activation.validator';
import { ProviderContractValidatorRegistry } from '../../src/managed-identity-exchange/persistence/managed-contract-registries';
import { DelegatedEndpointPolicy } from '../../src/managed-identity-exchange/providers/delegated-endpoint.policy';

const idx = (overrides: Record<string, unknown> = {}) => ({
  id: 'idx-provider', providerType: 'idx_delegated', endpointUri: 'https://idx.example.test/menu-detail', httpMethod: 'GET',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'idx-menu-detail/v1',
  declaredAnchorKinds: ['idx_entry'], contractConfig: { responseSchema: 'idx-menu-detail/v1', contentType: 'application/json' }, ...overrides
});
const delegated = () => ({
  id: 'generic-provider', providerType: 'delegated_http', endpointUri: 'https://provider.example.test/verify', httpMethod: 'POST',
  credentialPlacement: 'authorization_bearer', timeoutMilliseconds: 1_000, responseContractVersion: 'delegated-http/v1',
  declaredAnchorKinds: ['organization'], contractConfig: { anchorSchema: 'managed-verified-anchors/v1', responseSchema: 'managed-verified-identity/v1' }
});

describe('Feature 006 IDX provider contract (T008/T009/T010)', () => {
  it('T008: accepts the exact registered IDX GET/MenuDetail tuple for any server-provisioned safe HTTPS endpoint', () => {
    const contracts = new ProviderContractValidatorRegistry();
    const provider = idx({ endpointUri: 'https://browser.example.test/menu-detail' });
    expect(() => contracts.validate('idx_delegated', 'idx-menu-detail/v1', provider.contractConfig)).not.toThrow();
    expect(contracts.isActiveEligible('idx_delegated', 'idx-menu-detail/v1')).toBe(true);
    expect(() => new ManagedExchangeActivationValidator(contracts).validateProvider(provider)).not.toThrow();
    expect(() => new DelegatedEndpointPolicy().validate(provider as never)).not.toThrow();
  });

  it.each([
    { httpMethod: 'POST' }, { responseContractVersion: 'wrong/v1' }, { credentialPlacement: 'query' },
    { declaredAnchorKinds: [] }, { declaredAnchorKinds: ['idx_entry', 'organization'] }, { httpMethod: 'PATCH' },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', expression: '$.Data' } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', headers: { authorization: 'browser' } } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', endpointOverride: 'https://browser-controlled.example.test/menu-detail' } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', endpointFromRequest: true } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', dynamicEndpoint: true } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', customerId: 'customer-a' } },
    { contractConfig: { responseSchema: 'idx-menu-detail/v1', unexpected: true } },
    { contractConfig: null }, { contractConfig: [] }, { contractConfig: 'idx-menu-detail/v1' }
  ])('T008: rejects IDX near-miss configuration: %o', (overrides) => {
    expect(() => new ManagedExchangeActivationValidator().validateProvider(idx(overrides))).toThrow();
  });

  it('retains the generic delegated POST contract and rejects GET for it', () => {
    expect(() => new ManagedExchangeActivationValidator().validateProvider(delegated())).not.toThrow();
    expect(() => new DelegatedEndpointPolicy().validate({ ...delegated(), httpMethod: 'GET' } as never)).toThrow();
  });
});
