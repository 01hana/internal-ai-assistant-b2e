import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ManagedIdentityExchangeModule } from '../../src/managed-identity-exchange/managed-identity-exchange.module';
import { IdxMenuDetailPermissionNormalizer } from '../../src/managed-identity-exchange/permissions/idx-menu-detail.permission-normalizer';
import { PermissionNormalizerRegistry } from '../../src/managed-identity-exchange/permissions/permission-normalizer.registry';
import { SyntheticV1PermissionNormalizer } from '../../src/managed-identity-exchange/permissions/synthetic-v1-permission.normalizer';
import { DelegatedHttpV1Adapter } from '../../src/managed-identity-exchange/providers/delegated-http-v1.adapter';
import { DelegatedHttpTransport } from '../../src/managed-identity-exchange/providers/delegated-http.transport';
import { IdentityProviderAdapterRegistry } from '../../src/managed-identity-exchange/providers/identity-provider-adapter.registry';
import { IdxDelegatedVerificationAdapter } from '../../src/managed-identity-exchange/providers/idx-delegated-verification.adapter';
import { IdxMenuDetailValidator } from '../../src/managed-identity-exchange/providers/idx-menu-detail.validator';

type FactoryProvider = {
  provide: unknown;
  inject: readonly unknown[];
  useFactory: (...dependencies: never[]) => unknown;
};

const moduleProviders = (): readonly unknown[] => Reflect.getMetadata(MODULE_METADATA.PROVIDERS, ManagedIdentityExchangeModule) ?? [];

const factoryProvider = (token: unknown): FactoryProvider => {
  const provider = moduleProviders().find((candidate) => typeof candidate === 'object' && candidate !== null && 'provide' in candidate && candidate.provide === token);
  if (typeof provider !== 'object' || provider === null || !('inject' in provider) || !('useFactory' in provider) || !Array.isArray(provider.inject) || typeof provider.useFactory !== 'function') {
    throw new Error('Expected a factory provider.');
  }
  return provider as FactoryProvider;
};

describe('Phase 2A readiness production composition', () => {
  it('uses Feature 005 active-only repositories and the Feature 004 trust-profile read path', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/persistence/managed-exchange-readiness.composition.ts'), 'utf8');
    expect(source).toMatch(/findEnabledActiveByIntegrationId/);
    expect(source).toMatch(/findEnabledActiveById/);
    expect(source).toMatch(/findEnabledActiveByConfigId/);
    expect(source).toMatch(/findEnabledActive\(\)/);
    expect(source).toMatch(/findEnabledActiveSigningKeysByIssuerId/);
    expect(source).toMatch(/trustProfiles\.findEnabledActiveByIntegrationId/);
    expect(source).not.toMatch(/\.create\(|\.update\(|\.replace\(/);
  });
});

describe('Feature 006 Phase 11 production composition (T028)', () => {
  it('constructs the IDX adapter from only the hardened transport and strict validator without executing either', () => {
    expect(moduleProviders()).toContain(IdxMenuDetailValidator);
    const provider = factoryProvider(IdxDelegatedVerificationAdapter);
    expect(provider.inject).toEqual([DelegatedHttpTransport, IdxMenuDetailValidator]);

    const transport = { execute: jest.fn() };
    const validator = { validate: jest.fn() };
    const adapter = provider.useFactory(transport as never, validator as never) as IdxDelegatedVerificationAdapter;

    expect(adapter).toBeInstanceOf(IdxDelegatedVerificationAdapter);
    expect((adapter as unknown as { transport: unknown }).transport).toBe(transport);
    expect((adapter as unknown as { menuDetailValidator: unknown }).menuDetailValidator).toBe(validator);
    expect(transport.execute).not.toHaveBeenCalled();
    expect(validator.validate).not.toHaveBeenCalled();
  });

  it('registers exactly the synthetic and IDX normalizers without invoking them during construction or lookup', () => {
    expect(moduleProviders()).toEqual(expect.arrayContaining([SyntheticV1PermissionNormalizer, IdxMenuDetailPermissionNormalizer]));
    const provider = factoryProvider(PermissionNormalizerRegistry);
    expect(provider.inject).toEqual([SyntheticV1PermissionNormalizer, IdxMenuDetailPermissionNormalizer]);

    const synthetic = new SyntheticV1PermissionNormalizer();
    const idx = new IdxMenuDetailPermissionNormalizer();
    const syntheticNormalize = jest.spyOn(synthetic, 'normalize');
    const idxNormalize = jest.spyOn(idx, 'normalize');
    const registry = provider.useFactory(synthetic as never, idx as never) as PermissionNormalizerRegistry;

    expect(registry.resolve('synthetic-normalizer/v1')).toBe(synthetic);
    expect(registry.resolve('idx-menu-detail/v1')).toBe(idx);
    expect(registry.resolve('unknown')).toBeUndefined();
    expect(syntheticNormalize).not.toHaveBeenCalled();
    expect(idxNormalize).not.toHaveBeenCalled();
  });

  it('preserves exact identity-provider selection without invoking either adapter', () => {
    const provider = factoryProvider(IdentityProviderAdapterRegistry);
    expect(provider.inject).toEqual([DelegatedHttpV1Adapter, IdxDelegatedVerificationAdapter]);

    const delegated = { providerType: 'delegated_http', verify: jest.fn() };
    const idx = { providerType: 'idx_delegated', verify: jest.fn() };
    const registry = provider.useFactory(delegated as never, idx as never) as IdentityProviderAdapterRegistry;

    expect(registry.resolve('delegated_http')).toBe(delegated);
    expect(registry.resolve('idx_delegated')).toBe(idx);
    for (const unknownType of ['', 'unknown', 'idx', 'idx_delegated/v1', 'idx_delegated_extra', 'delegated']) {
      expect(registry.resolve(unknownType)).toBeUndefined();
    }
    expect(delegated.verify).not.toHaveBeenCalled();
    expect(idx.verify).not.toHaveBeenCalled();
  });

  it('contains no Customer-specific, endpoint, alternate-client, fixture, or dynamic-registration composition', () => {
    const source = readFileSync(resolve(__dirname, '../../src/managed-identity-exchange/managed-identity-exchange.module.ts'), 'utf8');
    expect(source).not.toMatch(/customerId|UUID_Entry|SCM_|MenuDetail\/?$|endpointUri|endpointOverride|integrationSelector/i);
    expect(source).not.toMatch(/fetch\(|axios|undici|httpsRequest|node:https|test\/managed-identity-exchange|fixtures\//i);
    expect(source).not.toMatch(/register\(|unregister\(|plugin|dynamic import|require\(/i);
  });
});
