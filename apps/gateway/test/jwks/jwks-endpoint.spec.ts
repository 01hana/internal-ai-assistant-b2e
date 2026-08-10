import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GatewaySigningKeyRepository } from '../../src/signing/gateway-signing-key.repository';
import { GATEWAY_SIGNING_KEY_READ_CLIENT } from '../../src/signing/gateway-signing-key-persistence.module';

const servicePath = resolve(__dirname, '../../src/jwks/jwks.service.ts');
const modulePath = resolve(__dirname, '../../src/jwks/jwks.module.ts');
const controllerPath = resolve(__dirname, '../../src/jwks/jwks.controller.ts');

describe('JWKS visibility and HTTP contract (T044)', () => {
  it('requires the Phase 5 JWKS service, module, and controller production surfaces', () => {
    expect(existsSync(servicePath)).toBe(true);
    expect(existsSync(modulePath)).toBe(true);
    expect(existsSync(controllerPath)).toBe(true);
  });

  it('publishes only published, active, and retiring public JWKs', async () => {
    const { JwksService } = loadJwksSurfaces();
    const service = new JwksService();
    const document = await service.createDocument(keyRows());

    expect(document).toEqual({
      keys: [
        publicJwk('published-key'),
        publicJwk('active-key'),
        publicJwk('retiring-key')
      ]
    });
  });

  it.each([
    ['non-object JWK', { publicJwk: 'not-an-object' }],
    ['non-RSA JWK', { publicJwk: { ...publicJwk('published-key'), kty: 'EC' } }],
    ['blank JWK kid', { publicJwk: { ...publicJwk('published-key'), kid: ' ' } }],
    ['wrong algorithm', { publicJwk: { ...publicJwk('published-key'), alg: 'RS512' } }],
    ['wrong use', { publicJwk: { ...publicJwk('published-key'), use: 'enc' } }],
    ['blank modulus', { publicJwk: { ...publicJwk('published-key'), n: '' } }],
    ['blank exponent', { publicJwk: { ...publicJwk('published-key'), e: '' } }],
    ['row/JWK kid mismatch', { kid: 'row-kid', publicJwk: publicJwk('jwk-kid') }]
  ])('fails closed for %s', async (_label, override) => {
    const { JwksService } = loadJwksSurfaces();
    const service = new JwksService();
    await expect(service.createDocument([{ ...keyRow('published-key', 'published'), ...override }])).rejects.toThrow();
  });

  it('uses the generic identity-service failure contract for a row/JWK kid mismatch', async () => {
    const { JwksService } = loadJwksSurfaces();
    const service = new JwksService();
    const row = { ...keyRow('published-key', 'published'), kid: 'row-kid', publicJwk: publicJwk('jwk-kid') };
    let failure: unknown;
    try {
      await service.createDocument([row]);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      status: 503,
      code: 'IDENTITY_SERVICE_UNAVAILABLE',
      message: 'Identity service is unavailable.',
      auditReasonCode: 'signing_or_jwks_unavailable'
    });
    const serialized = JSON.stringify(failure);
    for (const hiddenValue of [row.keyReference, 'private-d', 'private-p', 'private-q', 'row-kid', 'jwk-kid']) {
      expect(serialized).not.toContain(hiddenValue);
    }
  });

  it('serves an unauthenticated JSON JWKS document with the fixed cache policy', async () => {
    const { JwksModule } = loadJwksSurfaces();
    const testingModule = await Test.createTestingModule({ imports: [JwksModule] })
      .overrideProvider(GATEWAY_SIGNING_KEY_READ_CLIENT)
      .useValue({})
      .overrideProvider(GatewaySigningKeyRepository)
      .useValue({ findJwksVisible: async () => [] })
      .compile();
    const app = testingModule.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/^application\/json/);
      expect(response.headers['cache-control']).toBe('public, max-age=60, must-revalidate');
      expect(response.body).toEqual({ keys: expect.any(Array) });
      expect(JSON.stringify(response.body)).not.toMatch(/issuer|audience|activekid|keyreference|status|environment|database|"(?:d|p|q|dp|dq|qi)"/i);
    } finally {
      await app.close();
    }
  });

  it('returns a generic 503 instead of an empty JWKS document when the persisted key source fails', async () => {
    const sensitiveDiagnostic = 'provider://gateway/signing-key private-d database-row';
    const { JwksModule } = loadJwksSurfaces();
    const testingModule = await Test.createTestingModule({ imports: [JwksModule] })
      .overrideProvider(GATEWAY_SIGNING_KEY_READ_CLIENT)
      .useValue({})
      .overrideProvider(GatewaySigningKeyRepository)
      .useValue({ findJwksVisible: async () => { throw new Error(sensitiveDiagnostic); } })
      .compile();
    const app = testingModule.createNestApplication();
    await app.init();

    try {
      const response = await request(app.getHttpServer()).get('/.well-known/jwks.json');
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        statusCode: 503,
        code: 'IDENTITY_SERVICE_UNAVAILABLE',
        message: 'Identity service is unavailable.'
      });
      expect(JSON.stringify(response.body)).not.toContain(sensitiveDiagnostic);
    } finally {
      await app.close();
    }
  });
});

function loadJwksSurfaces(): {
  JwksService: new () => { createDocument(rows: unknown): Promise<unknown> };
  JwksModule: new (...args: never[]) => unknown;
} {
  if (!existsSync(servicePath) || !existsSync(modulePath) || !existsSync(controllerPath)) {
    throw new Error('Expected Phase 5 JWKS production surface.');
  }
  const service = require(servicePath) as { JwksService?: new () => { createDocument(rows: unknown): Promise<unknown> } };
  const module = require(modulePath) as { JwksModule?: new (...args: never[]) => unknown };
  if (!service.JwksService || !module.JwksModule) throw new Error('Expected Phase 5 JWKS production surface.');
  return { JwksService: service.JwksService, JwksModule: module.JwksModule };
}

function keyRows() {
  return [
    keyRow('new-key', 'new'),
    keyRow('published-key', 'published'),
    keyRow('active-key', 'active'),
    keyRow('retiring-key', 'retiring'),
    keyRow('retired-key', 'retired')
  ];
}

function keyRow(kid: string, status: string) {
  return {
    kid,
    status,
    publicJwk: { ...publicJwk(kid), d: 'private-d', p: 'private-p', q: 'private-q', dp: 'private-dp', dq: 'private-dq', qi: 'private-qi' },
    keyReference: 'provider://gateway/signing-key', notBefore: new Date(), activatedAt: new Date(), retireAfter: new Date(), retiredAt: new Date(), createdAt: new Date(), updatedAt: new Date()
  };
}

function publicJwk(kid: string) {
  return { kty: 'RSA', kid, alg: 'RS256', use: 'sig', n: 'modulus', e: 'AQAB' };
}
