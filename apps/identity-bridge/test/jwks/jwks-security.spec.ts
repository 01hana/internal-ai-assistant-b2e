import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BRIDGE_ENVIRONMENT } from '../../src/config/bridge-config.service';
import { JwksController } from '../../src/jwks/jwks.controller';
import { BridgeJwksError, KeyLifecycleService } from '../../src/jwks/key-lifecycle.service';
import { JwksModule } from '../../src/jwks/jwks.module';
import { bridgeEnvironment, rsaSigningFixture } from '../signing/signing-fixtures';

describe('Bridge JWKS security boundary', () => {
  it('exposes only the fixed unauthenticated GET route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, JwksController)).toBe('.well-known/jwks.json');
    expect(Reflect.getMetadata(PATH_METADATA, JwksController.prototype.getDocument)).toBe('/');
    expect(Reflect.getMetadata(METHOD_METADATA, JwksController.prototype.getDocument)).toBe(RequestMethod.GET);
    expect(Object.getOwnPropertyNames(JwksController.prototype)).toEqual(['constructor', 'getDocument']);
  });

  it('projects malformed lifecycle failures to a generic classification', () => {
    const fixture = rsaSigningFixture('sensitive-kid');
    let error: unknown;
    try {
      new KeyLifecycleService().validateCurrent([{ ...fixture.record, publicJwk: { ...fixture.record.publicJwk, sensitiveMetadata: 'sensitive-modulus' } }]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(BridgeJwksError);
    expect(error).toHaveProperty('message', 'Bridge JWKS failed: bridge_jwks_invalid.');
    expect(`${String(error)}${JSON.stringify(error)}`).not.toMatch(/sensitive|modulus|kid|file:|RSA|RS256/);
  });

  it('contains no central, persistence, exchange, admin, or network responsibility', () => {
    const source = ['key-lifecycle.service.ts', 'jwks.service.ts', 'jwks.controller.ts', 'jwks.module.ts']
      .map((file) => readFileSync(join(__dirname, '../../src/jwks', file), 'utf8')).join('\n');
    expect(source).not.toMatch(/GatewaySigning|InternalIdentityTokenIssuer|ManagedUpstreamTokenIssuer|ManagedIdentityExchangeModule|Prisma|IntegrationBinding|CustomerScope|fetch\(|https?\.|identity\/exchange|@Post|@Put|@Patch|@Delete|rotate|admin\/keys/i);
  });

  it('serves the public document through the fixed GET-only controller', async () => {
    const fixture = rsaSigningFixture();
    const module = await Test.createTestingModule({ imports: [JwksModule] })
      .overrideProvider(BRIDGE_ENVIRONMENT).useValue(bridgeEnvironment([fixture.record]))
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const controller = app.get(JwksController);
      await expect(controller.getDocument()).resolves.toEqual({ keys: [expect.objectContaining({ kid: 'bridge-kid', kty: 'RSA', alg: 'RS256', use: 'sig' })] });
      expect(Object.getOwnPropertyNames(JwksController.prototype)).toEqual(['constructor', 'getDocument']);
    } finally {
      await app.close();
    }
  });

  it('returns a generic 503 for invalid runtime configuration', async () => {
    const module = await Test.createTestingModule({ imports: [JwksModule] })
      .overrideProvider(BRIDGE_ENVIRONMENT).useValue({})
      .compile();
    const app = module.createNestApplication();
    await app.init();
    try {
      const error = await captureError(() => app.get(JwksController).getDocument());
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({ statusCode: 503, message: 'JWKS unavailable.' });
      expect(JSON.stringify((error as ServiceUnavailableException).getResponse())).not.toMatch(/configuration|key|reference|private|jose|crypto/i);
    } finally {
      await app.close();
    }
  });
});

async function captureError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
    throw new Error('Expected JWKS operation to reject.');
  } catch (error) {
    return error;
  }
}
