import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Gateway signing-key PostgreSQL persistence contract (T018)', () => {
  it('persists only public key metadata and permits at most one active key', async () => {
    const database = await createGatewayRegistryDatabase('key-active');
    try {
      expect(await database.scalar(`SELECT to_regclass('"GatewaySigningKey"') IS NOT NULL;`)).toBe('t');
      expect(await database.scalar(`SELECT to_regclass('"GatewayIdentityAuditEvent"') IS NOT NULL;`)).toBe('t');
      const keyFields = (await database.scalar(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'GatewaySigningKey';`)).split(',');
      expect(keyFields).toEqual(expect.arrayContaining(['kid', 'publicJwk', 'keyReference', 'status', 'notBefore', 'activatedAt', 'retireAfter', 'retiredAt', 'createdAt', 'updatedAt']));
      expect(keyFields).not.toContain('publishedAt');
      expect(keyFields.filter((field) => /private|pem|secret|credential/i.test(field))).toEqual([]);
      const auditFields = (await database.scalar(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'GatewayIdentityAuditEvent';`)).split(',');
      expect(auditFields).toEqual(expect.arrayContaining(['timestamp', 'requestId', 'eventType', 'outcome', 'reasonCode', 'customerId', 'integrationId', 'actorId', 'hostApp', 'jti', 'kid']));
      expect(auditFields.filter((field) => /authorization|token|claim|signature|private|keyreference|password|secret|credential|payload/i.test(field))).toEqual([]);
      expect(await database.scalar(`SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = '"GatewaySigningKeyStatus"'::regtype;`)).toBe('new,published,active,retiring,retired');
      await database.execute(`INSERT INTO "GatewaySigningKey" ("kid", "publicJwk", "keyReference", "status", "createdAt", "updatedAt") VALUES ('key-active-a', '{"kty":"RSA","kid":"key-active-a","alg":"RS256","use":"sig","n":"n","e":"AQAB"}', 'provider://keys/a', 'active', NOW(), NOW());`);
      await expect(database.execute(`INSERT INTO "GatewaySigningKey" ("kid", "publicJwk", "keyReference", "status", "createdAt", "updatedAt") VALUES ('key-active-b', '{"kty":"RSA","kid":"key-active-b","alg":"RS256","use":"sig","n":"n","e":"AQAB"}', 'provider://keys/b', 'active', NOW(), NOW());`)).rejects.toThrow();
      await expect(database.execute(`INSERT INTO "GatewaySigningKey" ("kid", "publicJwk", "keyReference", "status", "createdAt", "updatedAt") VALUES ('key-published', '{"kty":"RSA","kid":"key-published","alg":"RS256","use":"sig","n":"n","e":"AQAB"}', 'provider://keys/published', 'published', NOW(), NOW()), ('key-retired', '{"kty":"RSA","kid":"key-retired","alg":"RS256","use":"sig","n":"n","e":"AQAB"}', 'provider://keys/retired', 'retired', NOW(), NOW());`)).resolves.toBeUndefined();
    } finally {
      await database.dispose();
    }
  });
});
