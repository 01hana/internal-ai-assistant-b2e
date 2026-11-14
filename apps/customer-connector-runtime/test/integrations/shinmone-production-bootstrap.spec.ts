import { BindingBootstrapProviderRegistry } from '../../src/bindings/binding-bootstrap-provider.registry';
import { CredentialProfileRegistry } from '../../src/credentials/credential-profile.registry';
import { RuntimeReadinessService } from '../../src/health/readiness.service';
import { OperationManifestRegistry } from '../../src/manifest/operation-manifest.registry';
import { createShinmoneRuntimeApplication } from '../../integrations/shinmone/production.main';
import { createShinmoneRuntimeIntegration, SHINMONE_BOOTSTRAP_PROFILE_KEY,
  SHINMONE_BOOTSTRAP_PROVIDER_KEY, SHINMONE_CREDENTIAL_PROFILE_REF } from '../../integrations/shinmone';
import { validRuntimeEnvironment } from '../fixtures/runtime-environment';

function environment(): Record<string, unknown> {
  const base = validRuntimeEnvironment();
  const context = JSON.parse(base.CONNECTOR_RUNTIME_CONTEXT_JSON as string)[0];
  const central = JSON.parse(base.CONNECTOR_CENTRAL_TRUST_KEYS_JSON as string)[0];
  const bootstrap = JSON.parse(base.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON as string)[0];
  const integration = createShinmoneRuntimeIntegration({ toolMode: 'kpistats-demo' });
  return {
    ...base,
    SHINMONE_RUNTIME_TOOL_MODE: 'kpistats-demo',
    CONNECTOR_RUNTIME_CONTEXT_JSON: JSON.stringify([context]),
    CONNECTOR_CENTRAL_TRUST_KEYS_JSON: JSON.stringify([{ ...central, trustedContext: context }]),
    CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON: JSON.stringify([{
      ...bootstrap, profileKey: SHINMONE_BOOTSTRAP_PROFILE_KEY,
      providerKey: SHINMONE_BOOTSTRAP_PROVIDER_KEY, trustedContext: context
    }]),
    CONNECTOR_CREDENTIAL_PROFILES_JSON: JSON.stringify(integration.credentialProfiles),
    CONNECTOR_MANIFEST_FILES: JSON.stringify(integration.manifestFiles),
    CONNECTOR_UPSTREAMS_JSON: JSON.stringify([{
      upstreamServiceRef: 'shinmone-scm-api', origin: 'https://fixture.example',
      basePath: '/APIs/SCM', addressMode: 'public_only', allowedCidrs: []
    }])
  };
}

describe('Shinmone production Runtime composition', () => {
  it('registers the six-KPI Demo provider and strategy while rejecting writable source manifests', async () => {
    const app = await createShinmoneRuntimeApplication(environment());
    await app.init();
    try {
      expect(app.get(BindingBootstrapProviderRegistry).isValid).toBe(true);
      expect(app.get(BindingBootstrapProviderRegistry).resolve(SHINMONE_BOOTSTRAP_PROFILE_KEY,
        SHINMONE_BOOTSTRAP_PROVIDER_KEY)).toBeDefined();
      expect(app.get(CredentialProfileRegistry).has(SHINMONE_CREDENTIAL_PROFILE_REF)).toBe(true);
      const manifests = app.get(OperationManifestRegistry);
      expect(manifests.isValid).toBe(false);
      expect(app.get(RuntimeReadinessService).getPublicReadiness().productionReady).toBe(false);
    } finally { await app.close(); }
  });

  it('refuses absent mode, mismatched manifest and mismatched credential profile configuration', async () => {
    const valid = environment();
    for (const changed of [
      { SHINMONE_RUNTIME_TOOL_MODE: undefined },
      { CONNECTOR_MANIFEST_FILES: '[]' },
      { CONNECTOR_CREDENTIAL_PROFILES_JSON: '[]' }
    ]) {
      await expect(createShinmoneRuntimeApplication({ ...valid, ...changed })).rejects.toThrow();
    }
  });
});
