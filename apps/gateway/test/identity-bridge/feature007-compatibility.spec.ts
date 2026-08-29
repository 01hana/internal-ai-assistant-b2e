import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import {
  ProvisionIntegrationBindingCommand,
  ProvisionIntegrationBindingService
} from '../../src/commands/provision-integration-binding';
import { ProvisionTrustProfileCommand } from '../../src/commands/provision-trust-profile';
import {
  CanonicalIdentityResolver,
  IdentityResolutionError
} from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileActivationValidator } from '../../src/integration-registry/trust-profile-activation.validator';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { TrustProfileRuntimeReadiness } from '../../src/integration-registry/trust-profile-runtime-readiness.service';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProductionJwksSourceRegistrationPolicy } from '../../src/upstream-auth/jwks-source-policy';
import { HardenedJwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { UpstreamAuthenticationError } from '../../src/upstream-auth/upstream-auth.error';
import { UpstreamAuthTelemetry } from '../../src/upstream-auth/upstream-auth-telemetry';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';
import {
  BRIDGE_PHASE9,
  corruptProtectedAlgorithm,
  createBridgePhase9Fixture,
  type BridgePhase9Fixture
} from './bridge-jwks.fixture';

const describeRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
const CUSTOMER_ID = 'phase9-customer';
const PROFILE_ID = 'phase9-profile';
const BACKUP_JWKS_URI = 'https://bridge-phase9-backup.example.test/.well-known/jwks.json';

describeRegistry('Feature 007 Bridge JWT compatibility with unchanged Feature 004', () => {
  let database: Awaited<ReturnType<typeof createGatewayRegistryDatabase>>;
  let prisma: ReturnType<typeof createGatewayPrismaClient>;
  let fixture: BridgePhase9Fixture;
  let profiles: TrustProfileRepository;
  let bindings: IntegrationBindingRepository;
  let policy: ProductionJwksSourceRegistrationPolicy;
  let activation: TrustProfileActivationValidator;
  let profileCommand: ProvisionTrustProfileCommand;
  let bindingCommand: ProvisionIntegrationBindingCommand;

  beforeEach(async () => {
    database = await createGatewayRegistryDatabase('feature007-phase9');
    prisma = createGatewayPrismaClient(database.databaseUrl);
    fixture = await createBridgePhase9Fixture();
    profiles = new TrustProfileRepository(prisma);
    bindings = new IntegrationBindingRepository(prisma);
    policy = new ProductionJwksSourceRegistrationPolicy();
    activation = new TrustProfileActivationValidator({ repository: profiles, jwksSourcePolicy: policy });
    const provisioningCache = new TrustProfileCache({ repository: profiles, ttlMilliseconds: 0 });
    profileCommand = new ProvisionTrustProfileCommand({
      repository: profiles,
      validator: activation,
      auditWriter: new GatewayIdentityAuditWriter(prisma),
      invalidation: provisioningCache
    });
    bindingCommand = new ProvisionIntegrationBindingCommand(new ProvisionIntegrationBindingService(bindings));

    await prisma.customer.create({ data: { id: CUSTOMER_ID } });
    await bindingCommand.execute(bindingInput(true));
    await profileCommand.execute(profileInput('create'));
  });

  afterEach(async () => {
    await prisma?.$disconnect();
    await database?.dispose();
  });

  it('provisions the existing binding/profile contracts and verifies a real Bridge token through one profile', async () => {
    const policyValidate = jest.spyOn(policy, 'validate');
    const activationValidate = jest.spyOn(activation, 'validate');
    await profileCommand.execute(profileInput('create'));
    await new TrustProfileRuntimeReadiness(profiles).assertReady();

    const runtime = createRuntime();
    const token = await fixture.issue();
    const candidates = await runtime.candidates.resolve({ issuerHint: BRIDGE_PHASE9.issuer });
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${token}`, requestId: 'phase9-positive' });
    const canonical = await runtime.resolver.resolve({ identity: verified, requestId: 'phase9-positive' });
    const payload = decodeJwt(token);

    expect(policyValidate).toHaveBeenCalledWith(BRIDGE_PHASE9.jwksUri);
    expect(activationValidate).toHaveBeenCalled();
    await expect(bindings.findByIntegrationId(BRIDGE_PHASE9.integrationId)).resolves.toMatchObject({
      customerId: CUSTOMER_ID,
      allowedHostApp: BRIDGE_PHASE9.hostApp,
      enabled: true
    });
    await expect(profiles.findById(PROFILE_ID)).resolves.toMatchObject({
      enabled: true,
      lifecycle: 'active',
      algorithm: 'RS256',
      expectedIssuer: BRIDGE_PHASE9.issuer,
      expectedAudience: BRIDGE_PHASE9.audience,
      jwksUri: BRIDGE_PHASE9.jwksUri
    });
    expect(candidates).toHaveLength(1);
    expect(runtime.profileVerify).toHaveBeenCalledTimes(1);
    expect(verified).toEqual(expect.objectContaining({
      integrationId: BRIDGE_PHASE9.integrationId,
      subject: BRIDGE_PHASE9.subject,
      organizationId: BRIDGE_PHASE9.organization,
      hostApp: BRIDGE_PHASE9.hostApp,
      roles: [],
      permissionScopes: BRIDGE_PHASE9.permissionScopes
    }));
    expect(canonical).toEqual(expect.objectContaining({ customerId: CUSTOMER_ID, hostApp: BRIDGE_PHASE9.hostApp }));
    expect(payload.exp).toBe(payload.iat! + 300);
    expect(payload).not.toHaveProperty('customerId');
    expect(payload).not.toHaveProperty('customer_id');
    expect(payload).not.toHaveProperty('UUID_Entry');
    expect(Object.keys(payload).sort()).toEqual([
      'aud', 'exp', 'host_app', 'iat', 'integration_id', 'iss', 'jti', 'org_id',
      'permission_scopes', 'roles', 'sub'
    ].sort());
    expect(runtime.resolveCalls).toEqual([
      'bridge-phase9.example.test',
      'bridge-phase9.example.test'
    ]);
    expect(runtime.requestUris).toEqual([BRIDGE_PHASE9.jwksUri]);
  });

  it('rejects with zero candidates after the existing provisioning command disables the profile', async () => {
    await profileCommand.execute(profileInput('disable'));
    const runtime = createRuntime();
    await expect(runtime.verifier.verify({ authorization: `Bearer ${await fixture.issue()}` }))
      .rejects.toBeInstanceOf(UpstreamAuthenticationError);
    await expect(runtime.candidates.resolve({ issuerHint: BRIDGE_PHASE9.issuer })).resolves.toHaveLength(0);
  });

  it('rejects an ambiguous verification decision created through a second policy-approved profile', async () => {
    await profileCommand.execute(profileInput('create', PROFILE_ID + '-backup', BACKUP_JWKS_URI, 2));
    const runtime = createRuntime();
    await expect(runtime.candidates.resolve({ issuerHint: BRIDGE_PHASE9.issuer })).resolves.toHaveLength(2);
    await expect(runtime.verifier.verify({ authorization: `Bearer ${await fixture.issue()}`, requestId: 'phase9-ambiguous' }))
      .rejects.toBeInstanceOf(UpstreamAuthenticationError);
    expect(runtime.profileVerify).toHaveBeenCalledTimes(2);
  });

  it('allows cryptographic verification but denies Customer resolution after the binding is disabled', async () => {
    const runtime = createRuntime();
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${await fixture.issue()}` });
    await bindingCommand.execute(bindingInput(false));
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'phase9-disabled-binding' }))
      .rejects.toBeInstanceOf(IdentityResolutionError);
  });

  it('keeps HostApp authority at IntegrationBinding after a real Bridge variant verifies', async () => {
    const runtime = createRuntime();
    const token = await fixture.issueVariant({ hostApp: 'phase9-wrong-host' });
    const verified = await runtime.verifier.verify({ authorization: `Bearer ${token}` });
    await expect(runtime.resolver.resolve({ identity: verified, requestId: 'phase9-host-denied' }))
      .rejects.toMatchObject({ diagnosticReason: 'host_app_mismatch' });
  });

  it.each([
    ['issuer', async () => fixture.issueVariant({ issuer: 'https://wrong-issuer.example.test' })],
    ['audience', async () => fixture.issueVariant({ audience: 'wrong-audience' })],
    ['unknown kid', async () => fixture.issueUnknownKid()],
    ['unsupported algorithm', async () => corruptProtectedAlgorithm(await fixture.issue())]
  ])('rejects a real Bridge-derived token with invalid %s', async (_case, issue) => {
    const runtime = createRuntime();
    await expect(runtime.verifier.verify({ authorization: `Bearer ${await issue()}`, requestId: 'phase9-token-denied' }))
      .rejects.toBeInstanceOf(UpstreamAuthenticationError);
  });

  it('keeps the fixture and compatibility harness outside native identity, session, and central production responsibilities', async () => {
    const token = await fixture.issue();
    const fixtureSource = readFileSync(resolve(__dirname, 'bridge-jwks.fixture.ts'), 'utf8');
    const header = decodeProtectedHeader(token);
    expect(header).toEqual({ alg: 'RS256', kid: 'bridge-phase9-kid' });
    expect(fixture.jwksDocument.keys.map((key) => key.kid)).toEqual(['bridge-phase9-kid']);
    expect(fixtureSource).not.toMatch(/AccessToken|RefreshToken|MenuDetail|UUID_Entry|customerId|customer_id|GatewayTrustChainHandler|createSession|Backend|fetch\s*\(/);
    expect(fixtureSource).not.toContain(fixture.alternateKid + ' private');
  });

  function createRuntime() {
    const cache = new TrustProfileCache({ repository: profiles, ttlMilliseconds: 0 });
    const candidates = new CandidateTrustProfileResolver(cache);
    const resolveCalls: string[] = [];
    const requestUris: string[] = [];
    const transport = new HardenedJwksTransport({
      resolve: async (hostname) => {
        resolveCalls.push(hostname);
        return ['93.184.216.34'];
      },
      request: async (url, lookup, _signal) => {
        requestUris.push(url.toString());
        await lookup(url.hostname);
        return {
          statusCode: 200,
          headers: { 'content-type': 'application/jwk-set+json' },
          body: jsonBody(fixture.jwksDocument)
        };
      }
    });
    const scoped = new ProfileScopedVerifier({ transport });
    const profileVerify = jest.spyOn(scoped, 'verify');
    const audit = new GatewayIdentityAuditWriter(prisma);
    const verifier = new MultiProfileUpstreamTokenVerifier({
      parser: new RoutingMetadataParser(),
      candidateResolver: candidates,
      profileVerifier: scoped,
      telemetry: new UpstreamAuthTelemetry(audit),
      clockToleranceSeconds: 0
    });
    const resolver = new CanonicalIdentityResolver(bindings, audit);
    return Object.freeze({ candidates, verifier, resolver, profileVerify, resolveCalls, requestUris });
  }
});

function bindingInput(enabled: boolean) {
  return {
    customerId: CUSTOMER_ID,
    integrationId: BRIDGE_PHASE9.integrationId,
    allowedHostApp: BRIDGE_PHASE9.hostApp,
    enabled,
    requestId: `phase9-binding-${enabled ? 'enabled' : 'disabled'}`
  };
}

function profileInput(action: 'create' | 'disable', id: string = PROFILE_ID, jwksUri: string = BRIDGE_PHASE9.jwksUri, version = 1) {
  return {
    action,
    requestId: `phase9-profile-${action}-${id}`,
    id,
    integrationId: BRIDGE_PHASE9.integrationId,
    expectedIssuer: BRIDGE_PHASE9.issuer,
    expectedAudience: BRIDGE_PHASE9.audience,
    jwksUri,
    algorithm: 'RS256',
    enabled: action !== 'disable',
    lifecycle: action === 'disable' ? 'disabled' : 'active',
    version,
    replacesProfileId: null
  } as const;
}

async function* jsonBody(document: Readonly<{ keys: readonly object[] }>): AsyncIterable<Uint8Array> {
  yield Buffer.from(JSON.stringify(document));
}
