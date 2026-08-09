import { createGatewayRegistryDatabase } from '../support/gateway-registry-db.helper';

const describeGatewayRegistry = process.env.RUN_GATEWAY_REGISTRY_DB_TESTS === 'true' ? describe : describe.skip;

describeGatewayRegistry('Gateway IntegrationBinding persistence contract (T017)', () => {
  it('requires the explicit binding table, fields, Customer Restrict FK, and indexes in PostgreSQL', async () => {
    const database = await createGatewayRegistryDatabase('binding-schema');
    try {
      expect(await database.scalar(`SELECT to_regclass('"IntegrationBinding"') IS NOT NULL;`)).toBe('t');
      const columns = await database.scalar(`SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'IntegrationBinding';`);
      const fieldNames = columns.split(',');
      expect(fieldNames).toEqual(expect.arrayContaining(['integrationId', 'customerId', 'allowedHostApp', 'enabled', 'createdAt', 'updatedAt']));
      expect(fieldNames).not.toEqual(expect.arrayContaining(['organizationId', 'actorId', 'roles', 'permissionScopes', 'pageContext', 'credential', 'secret']));
      const indexes = await database.scalar(`SELECT string_agg(indexname, ',' ORDER BY indexname) FROM pg_indexes WHERE tablename = 'IntegrationBinding';`);
      expect(indexes.split(',')).toEqual(expect.arrayContaining(['IntegrationBinding_customerId_idx', 'IntegrationBinding_customerId_allowedHostApp_idx']));
    } finally {
      await database.dispose();
    }
  });

  it('rejects duplicate integration IDs and restrictive Customer deletion', async () => {
    const database = await createGatewayRegistryDatabase('binding-constraints');
    try {
      await database.execute(`INSERT INTO "Customer" ("id") VALUES ('binding-customer-a'), ('binding-customer-b');`);
      await database.execute(`INSERT INTO "IntegrationBinding" ("integrationId", "customerId", "allowedHostApp", "enabled", "createdAt", "updatedAt") VALUES ('integration-a', 'binding-customer-a', 'admin', true, NOW(), NOW());`);
      await expect(database.execute(`INSERT INTO "IntegrationBinding" ("integrationId", "customerId", "allowedHostApp", "enabled", "createdAt", "updatedAt") VALUES ('integration-a', 'binding-customer-b', 'admin', true, NOW(), NOW());`)).rejects.toThrow();
      await expect(database.execute(`DELETE FROM "Customer" WHERE "id" = 'binding-customer-a';`)).rejects.toThrow();
    } finally {
      await database.dispose();
    }
  });
});
