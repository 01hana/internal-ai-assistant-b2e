import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERIC_QUERY_SOURCES = [
  'src/query-understanding/domain-lexicon.ts',
  'src/query-understanding/query-confidence.scorer.ts',
  'src/query-understanding/query-task-decomposer.ts',
  'src/query-understanding/query-understanding.module.ts',
  'src/query-understanding/query-understanding.types.ts',
  'src/query-understanding/rule-based-query-understanding.pipeline.ts',
  'src/query-understanding/time-range.parser.ts',
  'src/tools/tool-discovery.service.ts',
  'src/tools/tool-registry.service.ts',
  'src/tools/tool-registry.types.ts',
  'src/tools/tools.module.ts'
];

const GENERIC_CREDENTIAL_ASSUMPTIONS = [
  {
    rule: 'bearer_specific_branch',
    pattern: /(?:===|!==|==|!=)\s*['"`]bearer['"`]|['"`]bearer['"`]\s*(?:===|!==|==|!=)|\b(?:application|strategy|scheme|credentialKind|credentialType)\s*:\s*['"`]bearer['"`]/i
  },
  {
    rule: 'bearer_credential_application',
    pattern: /['"`]Bearer(?:\s|\$\{|['"`])|\b(?:authorization|credential(?:Application|Strategy|Scheme)|auth(?:entication)?Scheme|header)\b[^\n;]{0,120}\bbearer\b/i
  },
  {
    rule: 'jwt_parsing_or_claims_authority',
    pattern: /\b(?:decodeJwt|jwtDecode|jwtVerify|verifyJwt|parseJwt|jsonwebtoken|JwtPayload|JWTClaims?|JsonWebToken)\b|(?:from\s+|require\s*\(\s*)['"`](?:jose|jsonwebtoken|jwt-decode)['"`]/i
  },
  {
    rule: 'jwt_exp_claim_authority',
    pattern: /\b(?:token|claims|payload)\s*(?:\?\.|\.)\s*exp\b|\{\s*exp\s*(?:[,}:]|\bas\b)[^=\n]{0,80}\}\s*=\s*(?:token|claims|payload)\b/i
  },
  {
    rule: 'jwt_expiry_or_remint_semantics',
    pattern: /\b(?:jwt|json\s*web\s*token)\b[^\n;]{0,120}\b(?:exp|expiry|expiration|remint)\b|\b(?:exp|expiry|expiration|remint)\b[^\n;]{0,120}\b(?:jwt|json\s*web\s*token)\b|\bjwt(?:Exp|Expiry|Expiration|Remint)[A-Za-z0-9_]*\b/i
  }
] as const;

describe('T096 generic query/tool routing source guard', () => {
  const sources = GENERIC_QUERY_SOURCES.map((path) => ({ path, text: readFileSync(join(process.cwd(), path), 'utf8') }));

  it('contains no exact mock or reference-integration routing literals', () => {
    for (const source of sources) {
      expect({ path: source.path, match: forbiddenLiteral(source.text) }).toEqual({ path: source.path, match: undefined });
    }
  });

  it('contains no candidate-tool-key task or subtask inference', () => {
    const decomposer = sources.find(({ path }) => path.endsWith('query-task-decomposer.ts'))!.text;
    expect(decomposer).not.toContain('inferCandidateTools');
    expect(decomposer).not.toMatch(/candidateTools\s*\[\s*0\s*\]\?\.key|tool\.key\.(?:includes|startsWith|endsWith)|inferTaskType\([^)]*candidateTools/);
  });

  it('contains no Customer, HostApp, or complete-question branch', () => {
    for (const source of sources) {
      expect(source.text).not.toMatch(/(?:if|switch)\s*\([^)]*(?:customerId|hostApp)\s*(?:===|!==|==|!=)[^)]*\)/i);
      expect(source.text).not.toContain('這個月新增幾張工單？');
    }
  });

  it('contains no bearer application, JWT parsing, or JWT-exp/remint ownership', () => {
    for (const source of sources) {
      expect({ path: source.path, violation: findGenericCredentialAssumption(source.text) }).toEqual({
        path: source.path,
        violation: undefined
      });
    }
  });

  it.each([
    ['bearer header application', 'headers.Authorization = `Bearer ${credential}`;', 'bearer_credential_application'],
    ['bearer profile branch', "if (profile.application === 'bearer') applyCredential();", 'bearer_specific_branch'],
    ['decodeJwt call', 'const claims = decodeJwt(token);', 'jwt_parsing_or_claims_authority'],
    ['jsonwebtoken import', "import jwt from 'jsonwebtoken';", 'jwt_parsing_or_claims_authority'],
    ['token exp authority', 'const expiresAt = token.exp - 15;', 'jwt_exp_claim_authority'],
    ['claims exp authority', 'const expiresAt = claims?.exp;', 'jwt_exp_claim_authority'],
    ['payload exp authority', 'const expiresAt = payload.exp;', 'jwt_exp_claim_authority'],
    ['JWT remint semantics', 'const jwtRemintAt = expiry - 15;', 'jwt_expiry_or_remint_semantics']
  ])('detects prohibited generic credential assumption: %s', (_name, source, expectedRule) => {
    expect(findGenericCredentialAssumption(source)?.rule).toBe(expectedRule);
  });

  it.each([
    ['generic expiry', 'const expiresAt = now + ttlSeconds;'],
    ['generic timeout budget', 'const timeoutMs = budgetMs - elapsedMs;'],
    ['abstract authentication', 'const authentication = profile.authentication;'],
    ['bearer input rejection', 'const PROHIBITED_ARGUMENT_VALUE = /\\b(?:bearer|basic)\\s+/i;']
  ])('allows Customer-neutral security semantics: %s', (_name, source) => {
    expect(findGenericCredentialAssumption(source)).toBeUndefined();
  });
});

function forbiddenLiteral(source: string): string | undefined {
  return [
    'mock.orders.status.lookup', 'mock.work-orders.progress.lookup',
    'mock.inventory.availability.lookup', 'mock.business-partner.history.lookup',
    'mock.general.lookup', 'shinmone', '/Dashboard/KPIStats', 'newOrders',
    'acceptedEntry', 'nativeAccessToken', 'MenuDetail'
  ].find((value) => source.toLowerCase().includes(value.toLowerCase()));
}

interface GenericCredentialAssumption {
  readonly rule: string;
  readonly match: string;
  readonly line: number;
}

function findGenericCredentialAssumption(source: string): GenericCredentialAssumption | undefined {
  for (const { rule, pattern } of GENERIC_CREDENTIAL_ASSUMPTIONS) {
    const match = pattern.exec(source);
    if (!match || match.index === undefined) continue;
    return {
      rule,
      match: match[0],
      line: source.slice(0, match.index).split('\n').length
    };
  }
  return undefined;
}
