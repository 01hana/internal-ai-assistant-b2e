import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const inventoryPath = 'specs/011-customer-capability-semantic-discovery/legacy-semantic-dependency-inventory.md';
const selfPath = 'test/architecture/feature011-legacy-semantic-inventory.guard.spec.ts';
const categories = {
  discovery: /\bToolDiscoveryService\b|\btoolDiscovery\.discover\b|\blistDiscoveryCatalogForCustomer\b/g,
  metadata: /x-assistant-discovery-v1|metadata_discovery(?:_policy_denied)?/g,
  vocabulary: /\bDOMAIN_LEXICON\b|\bBUSINESS_TERMS\b|\bgetNormalizedDomainTerm\b|\bgetPhraseCategoryForNormalizedTerm\b/g,
  identifiers: /\bORDER_PATTERN\b|\bWORK_ORDER_PATTERN\b|\bSKU_PATTERN\b|\bID_PATTERN\b/g,
  branches: /\benrichInventoryAvailability\b|\bhasStructuredResourceSignal\b|\bunsupportedLastMonth\b|\bmissing_order_identifier\b|\blast_month\b/g,
  bindings: /\bentity_value\b|\bnormalized_term\b|\btime_range_label\b/g
} as const;
type AnchorCounts = Partial<Record<keyof typeof categories, number>>;

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(relative);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) && relative !== selfPath ? [relative] : [];
  });
}

function discoveredAnchors(): Map<string, AnchorCounts> {
  const found = new Map<string, AnchorCounts>();
  for (const relative of ['src', 'test', 'scripts'].flatMap(sourceFiles)) {
    const source = readFileSync(join(root, relative), 'utf8');
    const counts: AnchorCounts = {};
    for (const [category, pattern] of Object.entries(categories) as [keyof typeof categories, RegExp][]) {
      const count = [...source.matchAll(pattern)].length;
      if (count) counts[category] = count;
    }
    if (Object.keys(counts).length) found.set(relative, counts);
  }
  return found;
}

function declaredAnchors(markdown: string): Map<string, AnchorCounts> {
  const section = markdown.split('## Dependency anchors\n')[1]?.split('\n## ')[0];
  if (!section) throw new Error('Missing dependency-anchor section');
  const declared = new Map<string, AnchorCounts>();
  for (const line of section.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const match = /^\| `([^`]+)` \| `([^`]+)` \|$/.exec(line);
    if (!match) throw new Error('Invalid inventory anchor row');
    const [, relative, spec] = match;
    if (!/^(src|test|scripts)\/[A-Za-z0-9._/-]+\.tsx?$/.test(relative) || relative.includes('..') || relative.includes('*')) {
      throw new Error('Wildcard or invalid inventory path');
    }
    if (declared.has(relative)) throw new Error('Duplicate inventory path');
    const counts: AnchorCounts = {};
    for (const piece of spec.split(',')) {
      const pair = /^([a-z]+)=([1-9][0-9]*)$/.exec(piece);
      if (!pair || !(pair[1] in categories)) throw new Error('Invalid inventory category/count');
      const category = pair[1] as keyof typeof categories;
      if (counts[category]) throw new Error('Duplicate inventory category');
      counts[category] = Number(pair[2]);
    }
    declared.set(relative, counts);
  }
  return declared;
}

function assertSameSurface(declared: Map<string, AnchorCounts>, actual: Map<string, AnchorCounts>): void {
  expect([...declared.keys()].sort()).toEqual([...actual.keys()].sort());
  for (const [relative, counts] of actual) {
    expect(declared.get(relative)).toEqual(counts);
  }
}

function assertClassifiedInventory(markdown: string): void {
  const section = markdown.split('## Supported-path classification\n')[1]?.split('\n## ')[0];
  expect(section).toBeTruthy();
  const rows = section!.split('\n').filter((line) => /^\| P\d+ \|/.test(line));
  const ids = rows.map((line) => line.split('|')[1].trim());
  expect(ids).toEqual(Array.from({ length: 12 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
  expect(new Set(ids).size).toBe(ids.length);
  for (const row of rows) {
    const cells = row.split('|').map((cell) => cell.trim());
    expect([
      'MIGRATED_TO_CUSTOMER_CAPABILITY_PACK',
      'EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH',
      'BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER'
    ]).toContain(cells[2]);
    expect(row).not.toMatch(/\*\*|`\*`|catch.all/i);
    const evidence = [...row.matchAll(/`((?:src|test|scripts|customer-capability-packs)\/[A-Za-z0-9._/-]+)`/g)].map((match) => match[1]);
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    for (const relative of evidence) expect(existsSync(join(root, relative))).toBe(true);
    const toolTarget = /`([A-Za-z0-9._-]+)@1\.0\.0`/.exec(row)?.[1];
    if (toolTarget) {
      expect(evidence.some((path) => readFileSync(join(root, path), 'utf8').includes(toolTarget))).toBe(true);
    }
    if (cells[2] === 'MIGRATED_TO_CUSTOMER_CAPABILITY_PACK') {
      expect(evidence.some((path) => path.includes('capability-packs/'))).toBe(true);
      expect(evidence.some((path) => path.includes('feature011-') && path.endsWith('.spec.ts'))).toBe(true);
    }
  }
}

describe('Feature 011 legacy semantic inventory guard', () => {
  const markdown = readFileSync(join(root, inventoryPath), 'utf8');

  it('accounts for every concrete legacy declaration/call site without a global hash', () => {
    assertSameSurface(declaredAnchors(markdown), discoveredAnchors());
  });

  it('rejects an unregistered dependency, duplicate anchor, and catch-all entry', () => {
    const declared = declaredAnchors(markdown);
    const injected = new Map(discoveredAnchors());
    injected.set('src/new-legacy-authority.ts', { discovery: 1 });
    expect(() => assertSameSurface(declared, injected)).toThrow();
    expect(() => declaredAnchors(markdown.replace('| `scripts/seed.ts` |', '| `scripts/seed.ts` | `metadata=3,bindings=1` |\n| `scripts/seed.ts` |'))).toThrow('Duplicate');
    expect(() => declaredAnchors(markdown.replace('| `scripts/seed.ts` |', '| `src/**/*.ts` |'))).toThrow('Wildcard');
  });

  it('requires unique evidence-backed classification for every named supported path', () => {
    assertClassifiedInventory(markdown);
  });

  it('accepts a complete synthetic-scope reclassification without a fixed blocker count', () => {
    const reclassified = markdown.split('\n').map((line) => {
      if (!/^\| P(?:0[2-9]|10) \|/.test(line)) return line;
      return line.replace(/MIGRATED_TO_CUSTOMER_CAPABILITY_PACK|BLOCKER_REQUIRES_PACK_BEFORE_CUTOVER/, 'EXPLICITLY_NOT_A_CURRENT_SUPPORTED_SEMANTIC_PATH');
    }).join('\n');
    expect(() => assertClassifiedInventory(reclassified)).not.toThrow();
  });
});
