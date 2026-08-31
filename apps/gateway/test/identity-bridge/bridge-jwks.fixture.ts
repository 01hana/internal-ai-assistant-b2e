import { BridgeConfigService } from '../../../identity-bridge/src/config/bridge-config.service';
import { KeyLifecycleService } from '../../../identity-bridge/src/jwks/key-lifecycle.service';
import { JwksService, type BridgeJwksDocument } from '../../../identity-bridge/src/jwks/jwks.service';
import { ActiveKeyResolver } from '../../../identity-bridge/src/signing/active-key.resolver';
import { CanonicalTokenIssuer } from '../../../identity-bridge/src/signing/canonical-token.issuer';
import {
  rsaSigningFixture,
  type RsaSigningFixture
} from '../../../identity-bridge/test/signing/signing-fixtures';

export const BRIDGE_PHASE9 = Object.freeze({
  audience: 'assistant-phase9',
  entry: 'phase9-entry',
  hostApp: 'phase9-host',
  integrationId: 'phase9-integration',
  issuer: 'https://bridge-phase9.example.test',
  jwksUri: 'https://bridge-phase9.example.test/.well-known/jwks.json',
  organization: 'phase9-organization',
  permissionScopes: Object.freeze(['menu:PHASE9:read', 'menu:PHASE9:insert']),
  subject: 'phase9-user'
});

type Variant = Readonly<{
  audience?: string;
  hostApp?: string;
  issuer?: string;
  signing?: RsaSigningFixture;
}>;

export type BridgePhase9Fixture = Readonly<{
  issue(): Promise<string>;
  issueVariant(variant: Variant): Promise<string>;
  issueUnknownKid(): Promise<string>;
  jwksDocument: BridgeJwksDocument;
  alternateKid: string;
}>;

export async function createBridgePhase9Fixture(): Promise<BridgePhase9Fixture> {
  const signing = rsaSigningFixture('bridge-phase9-kid');
  const alternate = rsaSigningFixture('bridge-phase9-unknown-kid');
  const config = bridgeConfig(signing);
  const resolver = new ActiveKeyResolver(config);
  const issuer = new CanonicalTokenIssuer(config, resolver);
  const jwksDocument = await new JwksService(config, new KeyLifecycleService(), resolver).document();

  return Object.freeze({
    issue: async () => (await issuer.issue(issueInput())).accessToken,
    issueVariant: async (variant) => {
      const variantConfig = bridgeConfig(variant.signing ?? signing, variant);
      const variantIssuer = new CanonicalTokenIssuer(variantConfig, new ActiveKeyResolver(variantConfig));
      return (await variantIssuer.issue(issueInput())).accessToken;
    },
    issueUnknownKid: async () => {
      const variantConfig = bridgeConfig(alternate);
      return (await new CanonicalTokenIssuer(variantConfig, new ActiveKeyResolver(variantConfig)).issue(issueInput())).accessToken;
    },
    jwksDocument,
    alternateKid: alternate.record.kid
  });
}

export function corruptProtectedAlgorithm(token: string): string {
  const [protectedHeader, payload, signature] = token.split('.');
  const header = JSON.parse(Buffer.from(protectedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
  return [Buffer.from(JSON.stringify({ ...header, alg: 'ES256' })).toString('base64url'), payload, signature].join('.');
}

function bridgeConfig(signing: RsaSigningFixture, variant: Variant = {}): BridgeConfigService {
  return new BridgeConfigService({
    BRIDGE_IDX_MENUDETAIL_URI: 'https://idx-phase9.example.test/menu-detail',
    BRIDGE_IDX_ALLOWED_ENTRIES: JSON.stringify([BRIDGE_PHASE9.entry, `${BRIDGE_PHASE9.entry}-secondary`]),
    BRIDGE_INTEGRATION_ID: BRIDGE_PHASE9.integrationId,
    BRIDGE_HOST_APP: variant.hostApp ?? BRIDGE_PHASE9.hostApp,
    BRIDGE_ISSUER: variant.issuer ?? BRIDGE_PHASE9.issuer,
    BRIDGE_AUDIENCE: variant.audience ?? BRIDGE_PHASE9.audience,
    BRIDGE_JWKS_PUBLIC_URI: BRIDGE_PHASE9.jwksUri,
    BRIDGE_SIGNING_KEYS: JSON.stringify([signing.record]),
    IDX_DESTINATION_MODE: 'public_only',
    BRIDGE_TIMEOUT_MS: '5000',
    BRIDGE_MAX_RESPONSE_BYTES: '262144'
  });
}

function issueInput() {
  return Object.freeze({
    identity: Object.freeze({
      subject: BRIDGE_PHASE9.subject,
      organization: BRIDGE_PHASE9.organization,
      entry: BRIDGE_PHASE9.entry
    }),
    permissionScopes: BRIDGE_PHASE9.permissionScopes
  });
}
