import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCompanyScopePolicy } from '../../src/query-scope/company-scope.policy';
import {
  createQueryScopeRegistrations,
  loadQueryScopeRegistrationsFromEnv,
  parseQueryScopePolicyConfigJsonV1,
  parseQueryScopePolicyConfigV1,
  QUERY_SCOPE_POLICY_PATHS_ENV
} from '../../src/query-scope/query-scope-config';
import { SYNTHETIC_QUERY_SCOPE_POLICY_PATH } from '../support/query-scope.fixture';

// CORE_CONTRACT: Customer-neutral Query Scope configuration; synthetic vocabulary only.
const fixture = (): Record<string, any> => JSON.parse(readFileSync(SYNTHETIC_QUERY_SCOPE_POLICY_PATH, 'utf8'));

describe('[CORE_CONTRACT] company scope policy engine', () => {
  const policy = createCompanyScopePolicy(parseQueryScopePolicyConfigV1(fixture()).vocabulary);
  it.each([
    ['本月新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['本公司本月新增工單數', 'ALLOW', 'QUERY_SCOPE_VALIDATED'],
    ['查另一家公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE'],
    ['查乙公司的本月新增工單數', 'DENY', 'QUERY_SCOPE_TARGET_UNVERIFIED'],
    ['查某家公司的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查甲部門的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS'],
    ['查VENDOR的本月新增工單數', 'CLARIFY', 'QUERY_SCOPE_AMBIGUOUS']
  ])('classifies %s', (query, outcome, reason) => {
    expect(policy.evaluate({ query })).toEqual({ outcome, reason });
  });

  it('keeps a follow-up that names no target in the current company scope', () => {
    expect(policy.evaluate({ query: '那這個月呢？' })).toEqual({ outcome: 'ALLOW', reason: 'QUERY_SCOPE_VALIDATED' });
    expect(policy.evaluate({ query: '那另一家公司呢？' })).toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
  });

  it('asks to confirm a target-less follow-up only after a denied or ambiguous turn', () => {
    for (const previousTurnScopeOutcome of ['DENY', 'CLARIFY'] as const) {
      expect(policy.evaluate({ query: '那這個月呢？', previousTurnScopeOutcome }))
        .toEqual({ outcome: 'CLARIFY', reason: 'QUERY_SCOPE_AMBIGUOUS' });
      expect(policy.evaluate({ query: '本月新增工單數', previousTurnScopeOutcome }))
        .toEqual({ outcome: 'CLARIFY', reason: 'QUERY_SCOPE_AMBIGUOUS' });
      expect(policy.evaluate({ query: '那本公司這個月呢？', previousTurnScopeOutcome }))
        .toEqual({ outcome: 'ALLOW', reason: 'QUERY_SCOPE_VALIDATED' });
      expect(policy.evaluate({ query: '那另一家公司這個月呢？', previousTurnScopeOutcome }))
        .toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
    }
  });

  it('reads a listed longer verb as one verb instead of its shorter prefix', () => {
    expect(policy.evaluate({ query: '請查詢本月的新增工單數' })).toEqual({ outcome: 'ALLOW', reason: 'QUERY_SCOPE_VALIDATED' });
    expect(policy.evaluate({ query: '查詢今日新增工單數' })).toEqual({ outcome: 'ALLOW', reason: 'QUERY_SCOPE_VALIDATED' });
    const withoutLongVerb = createCompanyScopePolicy({ ...parseQueryScopePolicyConfigV1(fixture()).vocabulary,
      queryVerbs: ['查', '看', '詢'] });
    expect(withoutLongVerb.evaluate({ query: '查詢今日新增工單數' })).toEqual({ outcome: 'CLARIFY', reason: 'QUERY_SCOPE_AMBIGUOUS' });
  });

  it.each([[''], ['x'.repeat(4_001)], [undefined]])('fails closed for unusable query %#', (query) => {
    expect(policy.evaluate({ query } as never)).toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_POLICY_UNAVAILABLE' });
  });

  it('treats configured terms literally, not as regular expressions', () => {
    const literal = createCompanyScopePolicy({ ...parseQueryScopePolicyConfigV1(fixture()).vocabulary,
      otherCompanyQualifiers: ['a.b'], companyNouns: ['(x)'], companySignals: ['(x)'] });
    expect(literal.evaluate({ query: '查a.b(x)的本月新增工單數' }))
      .toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_OUTSIDE_AUTHORIZED_SCOPE' });
    // "." must not act as a wildcard: azb is not the configured other-company qualifier.
    expect(literal.evaluate({ query: '查azb(x)的本月新增工單數' }))
      .toEqual({ outcome: 'DENY', reason: 'QUERY_SCOPE_TARGET_UNVERIFIED' });
  });
});

describe('[CORE_CONTRACT] Query Scope policy configuration V1', () => {
  it('parses the closed schema and builds exact registrations sharing one compiled policy', () => {
    const registrations = createQueryScopeRegistrations(parseQueryScopePolicyConfigJsonV1(readFileSync(SYNTHETIC_QUERY_SCOPE_POLICY_PATH)));
    expect(registrations.map((entry) => entry.toolKey)).toEqual([
      'work-orders.today-new-count', 'work-orders.weekly-new-count', 'work-orders.monthly-new-count']);
    expect(new Set(registrations.map((entry) => entry.policy)).size).toBe(1);
    expect(Object.isFrozen(registrations[0])).toBe(true);
  });

  it.each<[string, (config: Record<string, any>) => void]>([
    ['unknown root key', (c) => { c.extra = true; }],
    ['wrong version', (c) => { c.version = '2'; }],
    ['wrong kind', (c) => { c.kind = 'ANY_COMPANY'; }],
    ['wrong locale', (c) => { c.locale = 'en-US'; }],
    ['invalid policyId', (c) => { c.policyId = 'Bad Id'; }],
    ['missing vocabulary list', (c) => { delete c.vocabulary.companyNouns; }],
    ['unknown vocabulary list', (c) => { c.vocabulary.extra = ['x']; }],
    ['removed contextDependentPrefixes list', (c) => { c.vocabulary.contextDependentPrefixes = ['那']; }],
    ['empty vocabulary list', (c) => { c.vocabulary.queryVerbs = []; }],
    ['duplicate term', (c) => { c.vocabulary.queryVerbs = ['查', '查']; }],
    ['uppercase term', (c) => { c.vocabulary.companySignals = ['Vendor']; }],
    ['whitespace term', (c) => { c.vocabulary.companySignals = ['a b']; }],
    ['non-string term', (c) => { c.vocabulary.companySignals = [1]; }],
    ['empty applyTo', (c) => { c.applyTo = []; }],
    ['activation missing a key', (c) => { delete c.applyTo[0].toolVersion; }],
    ['activation extra key', (c) => { c.applyTo[0].policy = 'x'; }],
    ['activation invalid identifier', (c) => { c.applyTo[0].toolKey = '../tool'; }],
    ['duplicate activation', (c) => { c.applyTo.push({ ...c.applyTo[0] }); }]
  ])('rejects %s', (_label, mutate) => {
    const config = fixture();
    mutate(config);
    expect(() => parseQueryScopePolicyConfigV1(config)).toThrow('QUERY_SCOPE_POLICY_CONFIG_INVALID');
  });

  it('rejects malformed and oversized JSON', () => {
    expect(() => parseQueryScopePolicyConfigJsonV1('{')).toThrow('QUERY_SCOPE_POLICY_CONFIG_INVALID');
    expect(() => parseQueryScopePolicyConfigJsonV1(' '.repeat(64 * 1024 + 1))).toThrow('QUERY_SCOPE_POLICY_CONFIG_INVALID');
  });
});

describe('[CORE_CONTRACT] Query Scope policy loading from environment', () => {
  let directory: string;
  beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'query-scope-')); });
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('installs no Customer policy when nothing is configured', () => {
    expect(loadQueryScopeRegistrationsFromEnv({})).toEqual([]);
    expect(loadQueryScopeRegistrationsFromEnv({ [QUERY_SCOPE_POLICY_PATHS_ENV]: '[]' })).toEqual([]);
  });

  it('loads configured absolute files', () => {
    const registrations = loadQueryScopeRegistrationsFromEnv({ [QUERY_SCOPE_POLICY_PATHS_ENV]: JSON.stringify([SYNTHETIC_QUERY_SCOPE_POLICY_PATH]) });
    expect(registrations).toHaveLength(3);
    expect(registrations.every((entry) => typeof entry.policy?.evaluate === 'function')).toBe(true);
  });

  it.each<[string, () => string]>([
    ['invalid JSON', () => '['],
    ['non-array', () => JSON.stringify({ path: SYNTHETIC_QUERY_SCOPE_POLICY_PATH })],
    ['relative path', () => JSON.stringify(['test/fixtures/query-scope/synthetic-company-scope.v1.json'])],
    ['duplicate path', () => JSON.stringify([SYNTHETIC_QUERY_SCOPE_POLICY_PATH, SYNTHETIC_QUERY_SCOPE_POLICY_PATH])],
    ['missing file', () => JSON.stringify([join(directory, 'missing.json')])],
    ['symbolic link', () => { const link = join(directory, 'link.json'); symlinkSync(SYNTHETIC_QUERY_SCOPE_POLICY_PATH, link); return JSON.stringify([link]); }],
    ['empty file', () => { const file = join(directory, 'empty.json'); writeFileSync(file, ''); return JSON.stringify([file]); }],
    ['same activation in two files', () => {
      const copy = join(directory, 'copy.json');
      writeFileSync(copy, JSON.stringify({ ...fixture(), policyId: 'synthetic-copy' }));
      return JSON.stringify([SYNTHETIC_QUERY_SCOPE_POLICY_PATH, copy]);
    }]
  ])('stops startup for %s', (_label, value) => {
    expect(() => loadQueryScopeRegistrationsFromEnv({ [QUERY_SCOPE_POLICY_PATHS_ENV]: value() }))
      .toThrow('QUERY_SCOPE_POLICY_CONFIG_INVALID');
  });
});
