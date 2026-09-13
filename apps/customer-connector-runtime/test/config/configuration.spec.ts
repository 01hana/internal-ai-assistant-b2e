import { parseConnectorRuntimeConfiguration } from '../../src/config/runtime-configuration';
import { validRuntimeEnvironment } from '../fixtures/runtime-environment';

describe('Customer Connector Runtime immutable configuration', () => {
  it('parses exact multi-profile public trust configuration once and deeply freezes it', () => {
    const result = parseConnectorRuntimeConfiguration(validRuntimeEnvironment());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.processRole).toBe('single-replica');
    expect(result.config.replayCacheMaxEntries).toBe(64);
    expect(result.config.bindingStoreMaxEntries).toBe(4_096);
    expect(result.config.bindingScopeMaxEntries).toBe(64);
    expect(result.config.bindingSweepBatchSize).toBe(128);
    expect(result.config.contexts).toHaveLength(2);
    expect(result.config.centralProfiles).toHaveLength(1);
    expect(result.config.bootstrapProfiles).toHaveLength(2);
    expect(Object.isFrozen(result.config)).toBe(true);
    expect(Object.isFrozen(result.config.bootstrapProfiles[0]?.keys[0]?.publicJwk)).toBe(true);
  });

  it.each([
    'CONNECTOR_RUNTIME_CONTEXT_JSON',
    'CONNECTOR_CENTRAL_TRUST_KEYS_JSON',
    'CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON',
    'CONNECTOR_REPLAY_CACHE_MAX_ENTRIES',
    'CONNECTOR_BINDING_STORE_MAX_ENTRIES',
    'CONNECTOR_BINDING_SCOPE_MAX_ENTRIES',
    'CONNECTOR_BINDING_SWEEP_BATCH_SIZE',
    'CONNECTOR_RUNTIME_PROCESS_ROLE'
  ])('fails closed without required %s', (name) => {
    const environment = validRuntimeEnvironment();
    delete environment[name];
    expect(parseConnectorRuntimeConfiguration(environment)).toEqual({ ok: false, category: 'invalid_configuration' });
  });

  it('rejects a key domain shared by central invocation and Bridge bootstrap profiles', () => {
    const environment = validRuntimeEnvironment();
    const central = JSON.parse(String(environment.CONNECTOR_CENTRAL_TRUST_KEYS_JSON)) as Array<Record<string, unknown>>;
    const bootstrap = JSON.parse(String(environment.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON)) as Array<Record<string, unknown>>;
    bootstrap[0] = { ...bootstrap[0], keyDomain: central[0]?.keyDomain };

    expect(parseConnectorRuntimeConfiguration({
      ...environment,
      CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify(bootstrap)
    })).toEqual({ ok: false, category: 'invalid_configuration' });
  });

  it('rejects RSA public verification-key material reused across central and bootstrap profiles', () => {
    const environment = validRuntimeEnvironment();
    const central = JSON.parse(String(environment.CONNECTOR_CENTRAL_TRUST_KEYS_JSON)) as Array<Record<string, unknown>>;
    const bootstrap = JSON.parse(String(environment.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON)) as Array<Record<string, unknown>>;
    const centralKeys = central[0]?.keys as Array<Record<string, unknown>>;
    const bootstrapKeys = bootstrap[0]?.keys as Array<Record<string, unknown>>;
    const centralJwk = centralKeys[0]?.publicJwk as Record<string, unknown>;
    const bootstrapJwk = bootstrapKeys[0]?.publicJwk as Record<string, unknown>;
    bootstrapKeys[0] = {
      ...bootstrapKeys[0],
      publicJwk: { ...bootstrapJwk, n: centralJwk.n, e: centralJwk.e }
    };

    expect(parseConnectorRuntimeConfiguration({
      ...environment,
      CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify(bootstrap)
    })).toEqual({ ok: false, category: 'invalid_configuration' });
  });

  it('rejects private key material, wildcard context, duplicate key domains, and out-of-range replay capacity', () => {
    const base = validRuntimeEnvironment();
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_PRIVATE_KEY: 'secret' }).ok).toBe(false);
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_RUNTIME_CONTEXT_JSON: '[{"customerId":"*"}]' }).ok).toBe(false);
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_REPLAY_CACHE_MAX_ENTRIES: '100001' }).ok).toBe(false);
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_BINDING_STORE_MAX_ENTRIES: '0' }).ok).toBe(false);
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_BINDING_STORE_MAX_ENTRIES: '32', CONNECTOR_BINDING_SCOPE_MAX_ENTRIES: '33' }).ok).toBe(false);
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_BINDING_STORE_MAX_ENTRIES: '32', CONNECTOR_BINDING_SWEEP_BATCH_SIZE: '33' }).ok).toBe(false);

    const bootstrap = JSON.parse(String(base.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON)) as Array<Record<string, unknown>>;
    bootstrap[1] = { ...bootstrap[1], keyDomain: bootstrap[0]?.keyDomain };
    expect(parseConnectorRuntimeConfiguration({
      ...base,
      CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify(bootstrap)
    }).ok).toBe(false);

    const central = JSON.parse(String(base.CONNECTOR_CENTRAL_TRUST_KEYS_JSON)) as Array<Record<string, unknown>>;
    const keys = central[0]?.keys as Array<Record<string, unknown>>;
    keys[0] = { ...keys[0], publicJwk: { ...(keys[0]?.publicJwk as object), endpoint: 'forbidden' } };
    expect(parseConnectorRuntimeConfiguration({ ...base, CONNECTOR_CENTRAL_TRUST_KEYS_JSON: JSON.stringify(central) }).ok).toBe(false);
  });

  it('accepts an exact immutable Phase 5 manifest/profile configuration while keeping it optional for dark runtime', () => {
    const dark = parseConnectorRuntimeConfiguration(validRuntimeEnvironment());
    expect(dark.ok && dark.config.manifestFiles).toEqual([]);
    const result = parseConnectorRuntimeConfiguration({
      ...validRuntimeEnvironment(),
      CONNECTOR_MANIFEST_FILES: JSON.stringify(['/runtime/config/inventory/connector-manifest.v1.json']),
      CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([{
        credentialProfileRef: 'inventory-key-v1', credentialProviderKey: 'inventory-provider-v1',
        applicationStrategyKey: 'inventory-strategy-v1', credentialKind: 'fixed-key-v1'
      }])
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.manifestFiles).toEqual(['/runtime/config/inventory/connector-manifest.v1.json']);
    expect(Object.isFrozen(result.config.credentialProfiles[0])).toBe(true);
  });

  it('rejects partial, relative, duplicate, wildcard, unknown-field, and duplicate-profile Phase 5 configuration', () => {
    const base = validRuntimeEnvironment();
    const profile = {
      credentialProfileRef: 'inventory-key-v1', credentialProviderKey: 'inventory-provider-v1',
      applicationStrategyKey: 'inventory-strategy-v1', credentialKind: 'fixed-key-v1'
    };
    for (const environment of [
      { ...base, CONNECTOR_MANIFEST_FILES: '["/one.json"]' },
      { ...base, CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([profile]) },
      { ...base, CONNECTOR_MANIFEST_FILES: '["relative.json"]', CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([profile]) },
      { ...base, CONNECTOR_MANIFEST_FILES: '["/one.json","/one.json"]', CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([profile]) },
      { ...base, CONNECTOR_MANIFEST_FILES: '["/one.json"]', CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([{ ...profile, credentialKind: '*' }]) },
      { ...base, CONNECTOR_MANIFEST_FILES: '["/one.json"]', CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([{ ...profile, header: 'X-Unsafe' }]) },
      { ...base, CONNECTOR_MANIFEST_FILES: '["/one.json"]', CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify([profile, profile]) }
    ]) expect(parseConnectorRuntimeConfiguration(environment).ok).toBe(false);
  });

  it.each([
    '10.0.0.0/64',
    '300.300.300.300/24',
    '2001:db8::/129',
    '::ffff:10.0.0.0/95'
  ])('fails startup configuration for semantically invalid upstream CIDR %s', (cidr) => {
    expect(parseConnectorRuntimeConfiguration({
      ...validRuntimeEnvironment(),
      CONNECTOR_UPSTREAMS_JSON: JSON.stringify([{
        upstreamServiceRef: 'private-api', origin: 'https://private.test', basePath: '/',
        addressMode: 'allowlisted_networks', allowedCidrs: [cidr]
      }])
    })).toEqual({ ok: false, category: 'invalid_configuration' });
  });
});
