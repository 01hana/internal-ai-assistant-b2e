import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { GatewayBackendClient } from '../../src/backend-client/gateway-backend-client.service';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { GatewayModule } from '../../src/gateway.module';
import { GATEWAY_PRISMA_CLIENT } from '../../src/signing/gateway-signing-key-persistence.module';
import { CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { CandidateTrustProfileResolver } from '../../src/integration-registry/candidate-trust-profile.resolver';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { TrustProfileCache } from '../../src/integration-registry/trust-profile-cache';
import { TrustProfileRepository } from '../../src/integration-registry/trust-profile.repository';
import { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { RemoteJwksUpstreamTokenVerifier } from '../../src/upstream-auth/upstream-token-verifier.service';
import { HardenedJwksTransport } from '../../src/upstream-auth/jwks-transport.adapter';
import { MultiProfileUpstreamTokenVerifier } from '../../src/upstream-auth/multi-profile-upstream-token-verifier';
import { ProfileScopedVerifier } from '../../src/upstream-auth/profile-scoped-verifier';
import { RoutingMetadataParser } from '../../src/upstream-auth/routing-metadata.parser';
import { TrustProfileRuntimeReadiness } from '../../src/integration-registry/trust-profile-runtime-readiness.service';

const gatewayModulePath = resolve(__dirname, '../../src/gateway.module.ts');

describe('Gateway trust-chain production wiring contract (T068)', () => {
  it('keeps GatewayModule as DI composition rather than an identity, signing, routing, or HTTP authority', () => {
    expect(existsSync(gatewayModulePath)).toBe(true);
    const source = readFileSync(gatewayModulePath, 'utf8');
    const forbidden = /parseBearerToken|createVerifiedUpstreamIdentity|composeCanonicalGatewayIdentity|findByIntegrationId|findCustomer|customerId\s*:|SignJWT|\.issue\s*\(|BACKEND_ROUTE_DEFINITIONS|@Controller\s*\(|@All\s*\(|\b(?:execute|request|proxy|forward|dispatch)\s*\(/;

    expect(source).not.toMatch(forbidden);
  });

  it('resolves the existing production trust-chain providers from GatewayModule without external operations', async () => {
    await withGatewayEnvironment(async () => {
      const app = await Test.createTestingModule({ imports: [GatewayModule] })
        .overrideProvider(GATEWAY_PRISMA_CLIENT)
        .useValue(createRegistryClient([activeProfile()]))
        .compile();
      try {
        expect(app.get(GatewayTrustChainHandler)).toBeInstanceOf(GatewayTrustChainHandler);
        expect(app.get(MultiProfileUpstreamTokenVerifier)).toBeInstanceOf(MultiProfileUpstreamTokenVerifier);
        expect(app.get(RoutingMetadataParser)).toBeInstanceOf(RoutingMetadataParser);
        expect(app.get(TrustProfileRepository)).toBeInstanceOf(TrustProfileRepository);
        expect(app.get(TrustProfileCache)).toBeInstanceOf(TrustProfileCache);
        expect(app.get(CandidateTrustProfileResolver)).toBeInstanceOf(CandidateTrustProfileResolver);
        expect(app.get(HardenedJwksTransport)).toBeInstanceOf(HardenedJwksTransport);
        expect(app.get(ProfileScopedVerifier)).toBeInstanceOf(ProfileScopedVerifier);
        expect(app.get(TrustProfileRuntimeReadiness)).toBeInstanceOf(TrustProfileRuntimeReadiness);
        expect(() => app.get(RemoteJwksUpstreamTokenVerifier)).toThrow();
        expect(app.get(CanonicalIdentityResolver)).toBeInstanceOf(CanonicalIdentityResolver);
        expect(app.get(GatewayBackendClient)).toBeInstanceOf(GatewayBackendClient);
        expect(app.get(IntegrationBindingRepository)).toBeInstanceOf(IntegrationBindingRepository);
        expect(app.get(GatewayIdentityAuditWriter)).toBeInstanceOf(GatewayIdentityAuditWriter);
        expect(app.get(GatewaySigningKeyRepository)).toBeInstanceOf(GatewaySigningKeyRepository);
      } finally {
        await app.close();
      }
    }, 'none');
  });

  it('fails startup without an accepted profile even when legacy bootstrap settings are present', async () => {
    await withGatewayEnvironment(async () => {
      await expect(Test.createTestingModule({ imports: [GatewayModule] })
        .overrideProvider(GATEWAY_PRISMA_CLIENT)
        .useValue(createRegistryClient([]))
        .compile()).rejects.toThrow('Profile runtime readiness cannot be completed.');
    });
  });

  it('uses registered profiles for an unknown issuer without a remote-verifier fallback', async () => {
    await withGatewayEnvironment(async () => {
      const registryClient = createRegistryClient([activeProfile()]);
      const module = await Test.createTestingModule({ imports: [GatewayModule] })
        .overrideProvider(GATEWAY_PRISMA_CLIENT)
        .useValue(registryClient)
        .compile();
      try {
        const verifier = module.get(MultiProfileUpstreamTokenVerifier);
        const token = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImtpZCJ9.eyJpc3MiOiJodHRwczovL3Vua25vd24udGVzdCJ9.signature';
        await expect(verifier.verify({ authorization: `Bearer ${token}` })).rejects.toMatchObject({ reasonCode: 'invalid_signature' });
        expect(registryClient.registeredUpstreamTrustProfile.findMany).toHaveBeenCalledTimes(2);
        expect(() => module.get(RemoteJwksUpstreamTokenVerifier)).toThrow();
      } finally {
        await module.close();
      }
    });
  });
});

function createRegistryClient(activeProfiles: readonly ReturnType<typeof activeProfile>[]) {
  return { registeredUpstreamTrustProfile: { findMany: jest.fn(async (input: { where?: { expectedIssuer?: string } }) => input.where?.expectedIssuer ? [] : activeProfiles) } };
}

function activeProfile() {
  return { id: 'profile-a', integrationId: 'integration-a', expectedIssuer: 'https://issuer.example.test', expectedAudience: 'gateway-audience', jwksUri: 'https://issuer.example.test/jwks', algorithm: 'RS256', enabled: true, lifecycle: 'active', version: 1, replacesProfileId: null };
}

async function withGatewayEnvironment<T>(callback: () => Promise<T>, legacy: 'complete' | 'none' = 'complete'): Promise<T> {
  const environment: Record<string, string> = {
    DATABASE_URL: 'postgresql://gateway:gateway@127.0.0.1:5435/gateway_trust_chain_wiring_test',
    GATEWAY_INTERNAL_JWT_ISSUER: 'http://gateway.test',
    GATEWAY_INTERNAL_JWT_AUDIENCE: 'internal-ai-assistant',
    GATEWAY_PUBLIC_JWKS_URL: 'http://gateway.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_ISSUER: 'http://upstream.test',
    GATEWAY_UPSTREAM_JWT_AUDIENCE: 'upstream-audience',
    GATEWAY_UPSTREAM_JWKS_URI: 'http://upstream.test/.well-known/jwks.json',
    GATEWAY_UPSTREAM_JWT_CLOCK_TOLERANCE_SECONDS: '0',
    GATEWAY_INTERNAL_JWT_TTL_SECONDS: '300',
    GATEWAY_BACKEND_BASE_URL: 'http://backend.test',
    GATEWAY_SIGNING_KEY_REFERENCE: 'file:/tmp/gateway-signing-key.pem',
    GATEWAY_ALLOWED_ORIGINS: 'http://localhost:3001',
    GATEWAY_PORT: '4000'
  };
  const legacyKeys = ['GATEWAY_UPSTREAM_JWT_ISSUER', 'GATEWAY_UPSTREAM_JWT_AUDIENCE', 'GATEWAY_UPSTREAM_JWKS_URI'];
  if (legacy === 'none') for (const key of legacyKeys) delete environment[key];
  const trackedKeys = [...new Set([...Object.keys(environment), ...legacyKeys])];
  const previous = Object.fromEntries(trackedKeys.map((key) => [key, process.env[key]]));
  if (legacy === 'none') for (const key of legacyKeys) delete process.env[key];
  Object.assign(process.env, environment);

  try {
    return await callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
