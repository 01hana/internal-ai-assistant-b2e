import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { ProvisionIntegrationBindingCommand, ProvisionIntegrationBindingService } from '../../src/commands/provision-integration-binding';
import { ProvisionTrustProfileCommand } from '../../src/commands/provision-trust-profile';
import { createGatewayPrismaClient } from '../../src/integration-registry/gateway-prisma-client.factory';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileActivationValidator } from '../../src/integration-registry/trust-profile-activation.validator';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { TrustProfileRuntimeReadiness } from '../../src/integration-registry/trust-profile-runtime-readiness.service';
import { ProductionJwksSourceRegistrationPolicy } from '../../src/upstream-auth/jwks-source-policy';
import { createGatewayRegistryDatabase } from '../../../../test/support/gateway-registry-db.helper';

const targetPath = resolve(__dirname, '../../scripts/local-feature007-provision.cjs');
const validJwksUri = 'https://runtime-subdomain.trycloudflare.com/.well-known/jwks.json';
const document = { keys: [{ kty: 'RSA', kid: 'bridge-local', alg: 'RS256', use: 'sig', n: 'abc', e: 'AQAB' }] };

type Tool = Readonly<{
  AUTHORITY: Readonly<Record<string, unknown>>;
  parseArguments: (args: readonly string[]) => Readonly<{ jwksUri: string; verifyOnly: boolean }>;
  executeLocalFeature007Provisioning: (input: Readonly<Record<string, unknown>>) => Promise<Readonly<Record<string, unknown>>>;
}>;

describe('Feature 007 local provisioning tool', () => {
  const load = (): Tool => require(targetPath) as Tool;

  it('fixes local authority and accepts only an explicit exact public JWKS path', () => {
    expect(load().AUTHORITY).toMatchObject({
      customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local',
      hostApp: 'shinmone-scm', profileId: 'trust-shinmone-scm-assistant-local-v1',
      issuer: 'https://bridge-local.example.test', audience: 'internal-ai-assistant-local', algorithm: 'RS256'
    });
    expect(load().parseArguments(['--jwks-uri', validJwksUri])).toEqual({ jwksUri: validJwksUri, verifyOnly: false });
    expect(load().parseArguments(['--jwks-uri', validJwksUri, '--verify-only'])).toEqual({ jwksUri: validJwksUri, verifyOnly: true });
    for (const uri of ['http://runtime.trycloudflare.com/.well-known/jwks.json', 'https://localhost/.well-known/jwks.json', 'https://runtime.trycloudflare.com/health', `${validJwksUri}?target=x`, `${validJwksUri}#x`]) {
      expect(() => load().parseArguments(['--jwks-uri', uri])).toThrow('local_feature007_provision_invalid');
    }
  });

  it('uses policy plus hardened retrieval before a verify-only success and performs no persistence', async () => {
    const dependencies = fixtureDependencies();
    const report = jest.fn();
    await expect(load().executeLocalFeature007Provisioning({ ...input(dependencies, true), report })).resolves.toMatchObject({ verified: true, mutated: false });
    expect(dependencies.policy.validate).toHaveBeenCalledWith(validJwksUri);
    expect(dependencies.transport.fetch).toHaveBeenCalledWith(validJwksUri);
    expect(report.mock.calls).toEqual([
      ['LOCAL_FEATURE004_JWKS_POLICY', 'PASS'],
      ['LOCAL_FEATURE004_JWKS_RETRIEVAL', 'PASS']
    ]);
    expect(dependencies.client.customer.create).not.toHaveBeenCalled();
    expect(dependencies.bindingCommand.execute).not.toHaveBeenCalled();
    expect(dependencies.profileCommand.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['policy', [['LOCAL_FEATURE004_JWKS_POLICY', 'FAIL']]],
    ['retrieval', [
      ['LOCAL_FEATURE004_JWKS_POLICY', 'PASS'],
      ['LOCAL_FEATURE004_JWKS_RETRIEVAL', 'FAIL']
    ]]
  ] as const)('reports only safe %s-stage diagnostics before mutation', async (stage, expected) => {
    const dependencies = fixtureDependencies();
    if (stage === 'policy') dependencies.policy.validate.mockImplementationOnce(() => { throw new Error('sentinel'); });
    else dependencies.transport.fetch.mockRejectedValueOnce(new Error('sentinel'));
    const report = jest.fn();

    await expect(load().executeLocalFeature007Provisioning({ ...input(dependencies, true), report })).rejects.toThrow('local_feature007_provision_invalid');

    expect(report.mock.calls).toEqual(expected);
    expect(dependencies.client.customer.create).not.toHaveBeenCalled();
  });

  it('creates missing local authority through commands with fresh UUID request IDs and then replays exactly', async () => {
    const dependencies = fixtureDependencies();
    const first = await load().executeLocalFeature007Provisioning(input(dependencies));
    expect(first).toMatchObject({ verified: true, mutated: true, customerState: 'READY', bindingState: 'READY', profileState: 'READY' });
    expect(dependencies.client.customer.create).toHaveBeenCalledWith({ data: { id: 'customer-shinmone-scm-local' } });
    const bindingInput = dependencies.bindingCommand.execute.mock.calls[0][0];
    const profileInput = dependencies.profileCommand.execute.mock.calls[0][0];
    expect(bindingInput).toMatchObject({ customerId: 'customer-shinmone-scm-local', integrationId: 'shinmone-scm-assistant-local', allowedHostApp: 'shinmone-scm', enabled: true });
    expect(profileInput).toMatchObject({ action: 'create', id: 'trust-shinmone-scm-assistant-local-v1', integrationId: 'shinmone-scm-assistant-local', expectedIssuer: 'https://bridge-local.example.test', expectedAudience: 'internal-ai-assistant-local', jwksUri: validJwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null });
    expect(() => randomUUID({ disableEntropyCache: true })).not.toThrow();
    expect(bindingInput.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(profileInput.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(bindingInput.requestId).not.toBe(profileInput.requestId);
  });

  it.each([
    ['binding', { binding: { integrationId: 'shinmone-scm-assistant-local', customerId: 'other', allowedHostApp: 'shinmone-scm', enabled: true } }],
    ['profile', { profiles: [{ id: 'other-profile', integrationId: 'shinmone-scm-assistant-local' }] }],
    ['profile policy', { profiles: [{ id: 'trust-shinmone-scm-assistant-local-v1', integrationId: 'shinmone-scm-assistant-local', expectedIssuer: 'https://wrong.example.test', expectedAudience: 'internal-ai-assistant-local', jwksUri: validJwksUri, algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null }] }],
    ['profile URI', { profiles: [{ id: 'trust-shinmone-scm-assistant-local-v1', integrationId: 'shinmone-scm-assistant-local', expectedIssuer: 'https://bridge-local.example.test', expectedAudience: 'internal-ai-assistant-local', jwksUri: 'https://other.trycloudflare.com/.well-known/jwks.json', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null }] }]
  ])('fails closed on %s conflicts before mutation', async (_case, overrides) => {
    const dependencies = fixtureDependencies(overrides);
    await expect(load().executeLocalFeature007Provisioning(input(dependencies))).rejects.toThrow('local_feature007_provision_conflict');
    expect(dependencies.client.customer.create).not.toHaveBeenCalled();
    expect(dependencies.bindingCommand.execute).not.toHaveBeenCalled();
    expect(dependencies.profileCommand.execute).not.toHaveBeenCalled();
  });

  it('rejects non-local runtime/database boundaries and private or malformed JWK documents', async () => {
    const dependencies = fixtureDependencies();
    await expect(load().executeLocalFeature007Provisioning(input(dependencies, false, { NODE_ENV: 'production' }))).rejects.toThrow('local_feature007_provision_invalid');
    await expect(load().executeLocalFeature007Provisioning(input(dependencies, false, { DATABASE_URL: 'postgresql://user:pass@db.example.com/assistant_dev' }))).rejects.toThrow('local_feature007_provision_invalid');
    dependencies.transport.fetch.mockResolvedValueOnce({ keys: [{ ...document.keys[0], d: 'private' }] } as unknown as typeof document);
    await expect(load().executeLocalFeature007Provisioning(input(dependencies))).rejects.toThrow('local_feature007_provision_invalid');
  });
});

const describeDb = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;
describeDb('Feature 007 local provisioning real command composition', () => {
  it('creates and exactly replays the dedicated local Customer, binding, and profile in an isolated database', async () => {
    const database = await createGatewayRegistryDatabase('feature007-local-provision');
    const prisma = createGatewayPrismaClient(database.databaseUrl);
    try {
      const bindings = new IntegrationBindingRepository(prisma);
      const profiles = new TrustProfileRepository(prisma);
      const policy = new ProductionJwksSourceRegistrationPolicy();
      const dependencies = {
        client: prisma,
        bindingRepository: bindings,
        profileRepository: profiles,
        bindingCommand: new ProvisionIntegrationBindingCommand(new ProvisionIntegrationBindingService(bindings)),
        profileCommand: new ProvisionTrustProfileCommand({
          repository: profiles,
          validator: new TrustProfileActivationValidator({ repository: profiles, jwksSourcePolicy: policy }),
          auditWriter: new GatewayIdentityAuditWriter(prisma),
          invalidation: { invalidate: async () => undefined }
        }),
        readiness: new TrustProfileRuntimeReadiness(profiles),
        policy,
        transport: { fetch: async () => document }
      };
      const isolatedInput = { ...input(dependencies, false, { DATABASE_URL: database.databaseUrl }), environmentValidator: () => undefined };
      await expect(loadTool().executeLocalFeature007Provisioning(isolatedInput)).resolves.toMatchObject({ mutated: true });
      await expect(loadTool().executeLocalFeature007Provisioning(isolatedInput)).resolves.toMatchObject({ customerState: 'READY', bindingState: 'READY', profileState: 'READY' });
      await expect(prisma.integrationBinding.findUnique({ where: { integrationId: 'shinmone-scm-assistant-local' } })).resolves.toMatchObject({ customerId: 'customer-shinmone-scm-local', allowedHostApp: 'shinmone-scm', enabled: true });
      await expect(prisma.registeredUpstreamTrustProfile.findUnique({ where: { id: 'trust-shinmone-scm-assistant-local-v1' } })).resolves.toMatchObject({ expectedIssuer: 'https://bridge-local.example.test', expectedAudience: 'internal-ai-assistant-local', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1 });
    } finally {
      await prisma.$disconnect();
      await database.dispose();
    }
  });
});

function loadTool(): Tool { return require(targetPath) as Tool; }

function input(dependencies: ReturnType<typeof fixtureDependencies> | Record<string, unknown>, verifyOnly = false, environment: Record<string, string> = {}) {
  return { jwksUri: validJwksUri, verifyOnly, dependencies, environment: { NODE_ENV: 'development', DATABASE_URL: 'postgresql://local:local@127.0.0.1:5435/assistant_dev', ...environment }, randomUUID };
}

function fixtureDependencies(overrides: Record<string, unknown> = {}) {
  const customer = 'customer' in overrides ? overrides.customer : null;
  const binding = 'binding' in overrides ? overrides.binding : null;
  const profiles = 'profiles' in overrides ? overrides.profiles : [];
  return {
    client: { customer: { findUnique: jest.fn(async () => customer), create: jest.fn(async ({ data }) => data) } },
    bindingRepository: { findByIntegrationId: jest.fn(async () => binding) },
    profileRepository: { findByIntegrationId: jest.fn(async () => profiles) },
    bindingCommand: { execute: jest.fn(async (value) => ({ ...value, changed: true })) },
    profileCommand: { execute: jest.fn(async (value) => ({ ...value, changed: true })) },
    readiness: { assertReady: jest.fn(async () => undefined) },
    policy: { validate: jest.fn() },
    transport: { fetch: jest.fn(async () => document) }
  };
}
