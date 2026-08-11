import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { GatewayIdentityAuditWriter } from '../../src/audit/gateway-identity-audit.writer';
import { GatewayBackendClient } from '../../src/backend-client/gateway-backend-client.service';
import { GatewayTrustChainHandler } from '../../src/backend-client/gateway-trust-chain.handler';
import { GatewayModule } from '../../src/gateway.module';
import { CanonicalIdentityResolver } from '../../src/integration-registry/canonical-identity-resolver.service';
import { IntegrationBindingRepository } from '../../src/integration-registry/integration-binding.repository';
import { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { RemoteJwksUpstreamTokenVerifier } from '../../src/upstream-auth/upstream-token-verifier.service';

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
      const app = await NestFactory.createApplicationContext(GatewayModule, { logger: false });
      try {
        expect(app.get(GatewayTrustChainHandler)).toBeInstanceOf(GatewayTrustChainHandler);
        expect(app.get(RemoteJwksUpstreamTokenVerifier)).toBeInstanceOf(RemoteJwksUpstreamTokenVerifier);
        expect(app.get(CanonicalIdentityResolver)).toBeInstanceOf(CanonicalIdentityResolver);
        expect(app.get(GatewayBackendClient)).toBeInstanceOf(GatewayBackendClient);
        expect(app.get(IntegrationBindingRepository)).toBeInstanceOf(IntegrationBindingRepository);
        expect(app.get(GatewayIdentityAuditWriter)).toBeInstanceOf(GatewayIdentityAuditWriter);
        expect(app.get(GatewaySigningKeyRepository)).toBeInstanceOf(GatewaySigningKeyRepository);
      } finally {
        await app.close();
      }
    });
  });
});

async function withGatewayEnvironment<T>(callback: () => Promise<T>): Promise<T> {
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
    GATEWAY_PORT: '4000'
  };
  const previous = Object.fromEntries(Object.keys(environment).map((key) => [key, process.env[key]]));
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
