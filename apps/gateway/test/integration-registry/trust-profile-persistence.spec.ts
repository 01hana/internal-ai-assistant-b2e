import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const schemaPath = resolve(__dirname, '../../../../prisma/schema.prisma');
const modulePath = resolve(__dirname, '../../src/gateway.module.ts');

describe('Registered upstream trust-profile persistence authority contract (T001)', () => {
  it('stores upstream verification policy without Customer or HostApp authority', () => {
    const schema = readFileSync(schemaPath, 'utf8');
    const profile = model(schema, 'RegisteredUpstreamTrustProfile');

    expect(profile).toMatch(/id\s+String\s+@id/);
    expect(profile).toMatch(/integrationId\s+String/);
    expect(profile).toMatch(/expectedIssuer\s+String/);
    expect(profile).toMatch(/expectedAudience\s+String/);
    expect(profile).toMatch(/jwksUri\s+String/);
    expect(profile).toMatch(/algorithm\s+RegisteredUpstreamTrustProfileAlgorithm/);
    expect(profile).toMatch(/enabled\s+Boolean/);
    expect(profile).toMatch(/lifecycle\s+RegisteredUpstreamTrustProfileLifecycle/);
    expect(profile).toMatch(/version\s+Int/);
    expect(profile).toMatch(/createdAt\s+DateTime/);
    expect(profile).toMatch(/updatedAt\s+DateTime/);
    expect(profile).toMatch(/integrationBinding\s+IntegrationBinding/);
    expect(profile).not.toMatch(/customerId/);
    expect(profile).not.toMatch(/\bcustomer\s+Customer/);
    expect(profile).not.toMatch(/allowedHostApp/);
  });

  it('preserves IntegrationBinding as the only persisted Customer and HostApp authority', () => {
    const binding = model(readFileSync(schemaPath, 'utf8'), 'IntegrationBinding');
    expect(binding).toMatch(/customerId\s+String/);
    expect(binding).toMatch(/allowedHostApp\s+String/);
    expect(binding).toMatch(/enabled\s+Boolean/);
  });

  it('keeps trust-profile verification separate from persisted Customer and HostApp authority', () => {
    const gatewayModule = readFileSync(modulePath, 'utf8');
    expect(gatewayModule).toMatch(/MultiProfileUpstreamTokenVerifier/);
    expect(gatewayModule).toMatch(/TrustProfileRepository/);
    expect(gatewayModule).not.toMatch(/ProvisionTrustProfile/);
  });
});

function model(schema: string, name: string): string {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  if (!match) throw new Error(`Missing Prisma model ${name}.`);
  return match[1];
}
