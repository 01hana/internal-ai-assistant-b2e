import type { SigningKeyConfig } from '../../src/config/bridge-config.service';
import { menu, permission, response, token } from './idx-semantic.vectors';
import { rsaSigningFixture, type RsaSigningFixture } from '../signing/signing-fixtures';

export type DeploymentFixture = Readonly<{
  name: 'A' | 'B';
  endpoint: string;
  entry: string;
  allowedEntries: readonly [string, string];
  integrationId: string;
  hostApp: string;
  issuer: string;
  audience: string;
  jwksUri: string;
  kid: string;
  subject: string;
  organization: string;
  nativeToken: string;
  nativeTokens: readonly [string, string];
  menuDetail: Readonly<Record<string, unknown>>;
  permissionScopes: readonly string[];
  signing: RsaSigningFixture;
  environment: Readonly<Record<string, unknown>>;
}>;

export function createTwoDeploymentFixtures(): readonly [DeploymentFixture, DeploymentFixture] {
  return Object.freeze([
    deployment({ name: 'A', action: 'Insert', actionName: 'insert' }),
    deployment({ name: 'B', action: 'Update', actionName: 'update' })
  ]);
}

function deployment(input: Readonly<{ name: 'A' | 'B'; action: 'Insert' | 'Update'; actionName: 'insert' | 'update' }>): DeploymentFixture {
  const suffix = input.name.toLowerCase();
  const kid = `kid-${suffix}`;
  const signing = rsaSigningFixture(kid);
  const endpoint = `https://idx-${suffix}.example.test/menu-detail`;
  const allowedEntries = deepFreeze([`entry-${suffix}-1`, `entry-${suffix}-2`] as const);
  const entry = allowedEntries[0];
  const integrationId = `integration-${suffix}`;
  const hostApp = `host-${suffix}`;
  const issuer = `https://issuer-${suffix}.example.test`;
  const audience = `audience-${suffix}`;
  const jwksUri = `https://bridge-${suffix}.example.test/.well-known/jwks.json`;
  const subject = `user-${suffix}`;
  const organization = `company-${suffix}`;
  const identityClaims = (selectedEntry: string) => deepFreeze({
    sub: subject,
    UUID_User: subject,
    UUID_Company: organization,
    UUID_Entry: selectedEntry,
    UserType: 'forged-admin',
    IsAdmin: true,
    Permissions: [`forged-${suffix}`],
    Permission_Hash: `forged-hash-${suffix}`
  });
  const nativeTokens = deepFreeze(allowedEntries.map((selectedEntry) => token(identityClaims(selectedEntry))) as [string, string]);
  const menuDetail = deepFreeze(response([
    menu({ MenuID: input.name, MenuPermission: permission({ [input.action]: 'Y' }) })
  ]));
  const environment = deepFreeze({
    BRIDGE_IDX_MENUDETAIL_URI: endpoint,
    BRIDGE_IDX_ALLOWED_ENTRIES: JSON.stringify(allowedEntries),
    BRIDGE_INTEGRATION_ID: integrationId,
    BRIDGE_HOST_APP: hostApp,
    BRIDGE_ISSUER: issuer,
    BRIDGE_AUDIENCE: audience,
    BRIDGE_JWKS_PUBLIC_URI: jwksUri,
    BRIDGE_SIGNING_KEYS: JSON.stringify([signing.record satisfies SigningKeyConfig]),
    IDX_DESTINATION_MODE: 'public_only',
    BRIDGE_TIMEOUT_MS: '5000',
    BRIDGE_MAX_RESPONSE_BYTES: '262144'
  });

  return deepFreeze({
    name: input.name, endpoint, entry, allowedEntries, integrationId, hostApp, issuer, audience, jwksUri, kid,
    subject, organization, nativeToken: nativeTokens[0], nativeTokens, menuDetail,
    permissionScopes: [`menu:${input.name}:read`, `menu:${input.name}:${input.actionName}`],
    signing, environment
  }) as DeploymentFixture;
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze((value as Record<PropertyKey, unknown>)[key]);
  return Object.freeze(value);
}
