import { generateKeyPairSync } from 'node:crypto';
import { SignJWT } from 'jose';
import { RuntimeServiceProfileRegistry } from '../../src/service-auth/service-profile.registry';
import { ConnectorServiceProofVerifier } from '../../src/service-auth/service-proof.verifier';
import { centralClaims, serviceProofFixtureSet, signServiceProof } from '../fixtures/service-proof-fixtures';

describe('profile-isolated RS256 service-proof verification', () => {
  const now = () => 1_800_000_010;

  it('accepts central, reference bootstrap, and Customer B only in their exact registered profile', async () => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
      profiles.central.config, profiles.bridge.config, profiles.customerB.config
    ]), now);

    await expect(verifier.verify('central-invocation', await signServiceProof(profiles.central))).resolves.toMatchObject({ ok: true, value: { profileKey: 'central-v1' } });
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(profiles.bridge), profiles.bridge.config.profileKey)).resolves.toMatchObject({ ok: true, value: { profileKey: profiles.bridge.config.profileKey } });
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(profiles.customerB), profiles.customerB.config.profileKey)).resolves.toMatchObject({ ok: true, value: { profileKey: profiles.customerB.config.profileKey } });
  });

  it('rejects the complete central/bootstrap/provider cross-acceptance matrix', async () => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
      profiles.central.config, profiles.bridge.config, profiles.customerB.config
    ]), now);
    const proofs = {
      central: await signServiceProof(profiles.central),
      bridge: await signServiceProof(profiles.bridge),
      customerB: await signServiceProof(profiles.customerB)
    } as const;
    const matrix = [
      { direction: 'central -> Bridge bootstrap', source: 'central', kind: 'binding-bootstrap', expectedProfile: 'bridge' },
      { direction: 'central -> Customer B bootstrap', source: 'central', kind: 'binding-bootstrap', expectedProfile: 'customerB' },
      { direction: 'Bridge bootstrap -> central', source: 'bridge', kind: 'central-invocation' },
      { direction: 'Bridge bootstrap -> Customer B bootstrap', source: 'bridge', kind: 'binding-bootstrap', expectedProfile: 'customerB' },
      { direction: 'Customer B bootstrap -> central', source: 'customerB', kind: 'central-invocation' },
      { direction: 'Customer B bootstrap -> Bridge bootstrap', source: 'customerB', kind: 'binding-bootstrap', expectedProfile: 'bridge' }
    ] as const;

    for (const testCase of matrix) {
      const expectedProfileKey = 'expectedProfile' in testCase
        ? profiles[testCase.expectedProfile].config.profileKey
        : undefined;
      await expect(verifier.verify(testCase.kind, proofs[testCase.source], expectedProfileKey))
        .resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    }
  });

  it.each([
    ['typ', {}, { typ: 'wrong+jwt' }],
    ['issuer', { iss: 'urn:wrong' }, {}],
    ['subject', { sub: 'wrong-subject' }, {}],
    ['audience', { aud: 'urn:wrong' }, {}],
    ['Customer', { customer_id: 'another-customer' }, {}],
    ['integration', { integration_id: 'another-integration' }, {}],
    ['HostApp', { host_app: 'another-host' }, {}],
    ['connector instance', { connector_instance_id: 'another-instance' }, {}]
  ])('rejects a correctly signed proof with wrong %s', async (_label, claims, header) => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([profiles.central.config]), now);
    await expect(verifier.verify('central-invocation', await signServiceProof(profiles.central, claims, header))).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
  });

  it('rejects wrong provider, wrong algorithm, unsigned tokens, unknown kid, and Feature 007-shaped user JWTs', async () => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([
      profiles.central.config, profiles.bridge.config
    ]), now);
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(profiles.bridge, { provider_key: 'other-provider' }), profiles.bridge.config.profileKey)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    const hs256 = await new SignJWT(centralClaims(profiles.central.config))
      .setProtectedHeader({ alg: 'HS256', kid: profiles.central.config.keys[0]?.kid, typ: profiles.central.config.typ })
      .sign(new TextEncoder().encode('test-only-hmac-secret-with-sufficient-length'));
    await expect(verifier.verify('central-invocation', hs256)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    await expect(verifier.verify('central-invocation', 'eyJhbGciOiJub25lIn0.e30.')).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    await expect(verifier.verify('central-invocation', await signServiceProof(profiles.central, {}, { kid: 'unknown-key' }))).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    const userJwt = await new SignJWT({ sub: 'actor', org_id: 'organization', permission_scopes: [] })
      .setProtectedHeader({ alg: 'RS256', kid: profiles.central.config.keys[0]?.kid, typ: 'JWT' })
      .sign(profiles.central.privateKey);
    await expect(verifier.verify('central-invocation', userJwt)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
  });

  it('rejects signatures from an unregistered key even when header and claims name the registered profile', async () => {
    const profiles = serviceProofFixtureSet();
    const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const legitimate = await signServiceProof(profiles.central);
    const [, payload] = legitimate.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8')) as Record<string, unknown>;
    const forged = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: profiles.central.config.keys[0]?.kid, typ: profiles.central.config.typ })
      .sign(attacker.privateKey);
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([profiles.central.config]), now);
    await expect(verifier.verify('central-invocation', forged)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
  });

  it.each([
    ['actor-a', 'organization-a'],
    ['actor-b', 'organization-b']
  ])('accepts signed bootstrap actor %s and organization %s when the registered profile is base-context-only', async (actorId, organizationId) => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([profiles.bridge.config]), now);
    const proof = await signServiceProof(profiles.bridge, { actor_id: actorId, organization_id: organizationId });
    await expect(verifier.verify('binding-bootstrap', proof, profiles.bridge.config.profileKey)).resolves.toMatchObject({
      ok: true,
      value: { trustedContext: { actorId, organizationId } }
    });
  });

  it('applies optional bootstrap actor and organization configuration only as exact narrowing constraints', async () => {
    const profiles = serviceProofFixtureSet();
    const constrained = {
      ...profiles.bridge.config,
      trustedContext: Object.freeze({
        ...profiles.bridge.config.trustedContext,
        actorId: 'actor-a',
        organizationId: 'organization-a'
      })
    };
    const constrainedProfile = { ...profiles.bridge, config: constrained };
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([constrained]), now);
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(constrainedProfile), constrained.profileKey))
      .resolves.toMatchObject({ ok: true });
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(constrainedProfile, {
      actor_id: 'actor-b'
    }), constrained.profileKey)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(constrainedProfile, {
      organization_id: 'organization-b'
    }), constrained.profileKey)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
  });

  it.each([
    ['Customer', { customer_id: 'other-customer' }],
    ['integration', { integration_id: 'other-integration' }],
    ['HostApp', { host_app: 'other-host' }],
    ['connector instance', { connector_instance_id: 'other-instance' }]
  ])('keeps bootstrap base-context %s exact', async (_label, override) => {
    const profiles = serviceProofFixtureSet();
    const verifier = new ConnectorServiceProofVerifier(new RuntimeServiceProfileRegistry([profiles.bridge.config]), now);
    await expect(verifier.verify('binding-bootstrap', await signServiceProof(profiles.bridge, {
      actor_id: 'actor-a', organization_id: 'organization-a', ...override
    }), profiles.bridge.config.profileKey)).resolves.toEqual({ ok: false, code: 'CONNECTOR_AUTH_FAILED' });
  });
});
