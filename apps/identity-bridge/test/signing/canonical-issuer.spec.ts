import { randomUUID } from 'node:crypto';
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose';
import type { CanonicalIssueInput } from '../../src/signing/canonical-token.issuer';
import { ActiveKeyResolver } from '../../src/signing/active-key.resolver';
import { CanonicalTokenIssuer } from '../../src/signing/canonical-token.issuer';
import { rsaSigningFixture, signingConfig } from './signing-fixtures';

const identity = Object.freeze({ subject: 'accepted-user', organization: 'accepted-organization', entry: 'admission-only-entry' });
const permissionScopes = Object.freeze(['menu:ORDERS:read', 'menu:ORDERS:update']);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('Bridge canonical RS256 issuer', () => {
  it('issues and publicly verifies the exact Feature 004 upstream contract', async () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record]);
    const resolver = new ActiveKeyResolver(config);
    const issuer = new CanonicalTokenIssuer(config, resolver, () => 1000, () => '123e4567-e89b-42d3-a456-426614174000');
    const attemptedOverride = {
      identity,
      permissionScopes,
      integration_id: 'caller-integration',
      host_app: 'caller-host',
      issuer: 'https://caller.invalid',
      audience: 'caller-audience',
      roles: ['caller-admin'],
      customerId: 'caller-customer'
    } as unknown as CanonicalIssueInput;

    const result = await issuer.issue(attemptedOverride);
    expect(decodeProtectedHeader(result.accessToken)).toEqual({ alg: 'RS256', kid: 'bridge-kid' });
    const publicKey = await importJWK((await resolver.resolve()).publicJwk, 'RS256');
    const verified = await jwtVerify(result.accessToken, publicKey, {
      algorithms: ['RS256'],
      issuer: 'https://bridge.test',
      audience: 'configured-audience',
      currentDate: new Date(1100 * 1000)
    });

    expect(verified.payload).toMatchObject({
      iss: 'https://bridge.test',
      aud: 'configured-audience',
      iat: 1000,
      exp: 1300,
      jti: result.jti,
      integration_id: 'configured-integration',
      sub: 'accepted-user',
      org_id: 'accepted-organization',
      host_app: 'configured-host-app',
      roles: [],
      permission_scopes: permissionScopes
    });
    expect(Object.keys(verified.payload).sort()).toEqual([
      'aud', 'exp', 'host_app', 'iat', 'integration_id', 'iss', 'jti', 'org_id', 'permission_scopes', 'roles', 'sub'
    ]);
    expect(result).toMatchObject({ tokenType: 'Bearer', expiresIn: 300, kid: 'bridge-kid' });
    expect(result.jti).toMatch(uuidPattern);
    expect(verified.payload.exp).toBe((verified.payload.iat as number) + 300);

    for (const forbidden of [
      'customer_id', 'customerId', 'Customer', 'UUID_User', 'UUID_Company', 'UUID_Entry', 'entry',
      'UserType', 'IsAdmin', 'Permissions', 'Permission_Hash', 'nativeCredential', 'accessToken', 'refreshToken',
      'MenuDetail', 'MenuNode', 'MenuPermission', 'keyReference', 'customer_scope', 'internal_identity', 'session_id'
    ]) expect(verified.payload).not.toHaveProperty(forbidden);

    const wrongFixture = rsaSigningFixture('wrong-kid');
    const wrongKey = await importJWK(wrongFixture.record.publicJwk as unknown as JWK, 'RS256');
    await expect(jwtVerify(result.accessToken, wrongKey, { algorithms: ['RS256'] })).rejects.toThrow();
  });

  it('uses a distinct valid UUID JTI for every successful issuance', async () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record]);
    const values = ['123e4567-e89b-42d3-a456-426614174001', '123e4567-e89b-42d3-a456-426614174002'];
    let index = 0;
    const sequentialUuid = (() => values[index++]) as unknown as typeof randomUUID;
    const issuer = new CanonicalTokenIssuer(config, new ActiveKeyResolver(config), () => 1000, sequentialUuid);
    const first = await issuer.issue({ identity, permissionScopes });
    const second = await issuer.issue({ identity, permissionScopes });
    expect(first.jti).toMatch(uuidPattern);
    expect(second.jti).toMatch(uuidPattern);
    expect(first.jti).not.toBe(second.jti);
  });

  it.each([1000.5, NaN, Infinity])('fails closed for invalid clock value %s', async (clock) => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record]);
    const issuer = new CanonicalTokenIssuer(config, new ActiveKeyResolver(config), () => clock, () => '123e4567-e89b-42d3-a456-426614174000');
    await expect(issuer.issue({ identity, permissionScopes: [] })).rejects.toThrow('bridge_signing_invalid');
  });

  it('fails closed when the injected UUID generator returns an invalid value', async () => {
    const fixture = rsaSigningFixture();
    const config = signingConfig([fixture.record]);
    const invalidUuid = (() => 'not-a-uuid') as unknown as typeof randomUUID;
    const issuer = new CanonicalTokenIssuer(config, new ActiveKeyResolver(config), () => 1000, invalidUuid);
    await expect(issuer.issue({ identity, permissionScopes: [] })).rejects.toThrow('bridge_signing_invalid');
  });
});
