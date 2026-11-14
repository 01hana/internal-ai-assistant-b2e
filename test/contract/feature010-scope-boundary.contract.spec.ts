import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const HASHES = Object.freeze({
  feature009Spec: 'd73dfe52922e71f2d1481b8638fcd9cd3dadf83f5ecc1a399586cebc02a41b73',
  feature009Design: 'bbec3cd75fa7fa00cb298d1fa4c7ddd713d3dea870924b4c0a1a625986ada6fb',
  feature009Plan: '00fc5b55351f980deb063d07de555dc88213b5acf71b7e30855cade067f875c1',
  feature009Tasks: 'ebb7089a7d2af47cdcb7e7926d3f8b0376de906a6d0c7d43c7520710d804087a',
  // c676875: the Shinmone wire response is PascalCase; shinmone-manifest.spec.ts
  // checks exact extraction, bounded output, and rejection of malformed responses.
  feature009Manifest: '44ee5c55951221a206587d12bd15c92b3d5a4ae346eafc9c442de85bb2e01542',
  // 91f07b1: sessions gained integration ownership and an exact-scope index.
  prismaSchema: 'f28b405d52d3e8c8733e29e61dc266b688b548c11558835826a753ba975ce1f1',
  // 91f07b1: two additive migrations keep legacy NULL ownership and reject blank IDs.
  prismaMigrations: '20758d12be2f087b6e97f63bdf393aebcd207cfe8e11db012e5a802400848489',
  feature010Spec: '3c33d6737768d59d6b62f907d77be06fea2b8b6c145392527d473019436c9346',
  feature010Design: 'c060bcf6a9e305fbecc75697410642f261ded88eb9230ad9d36e5b9b5c02500f',
  feature010Plan: 'c6d151ca35e53655fefb2cfde53879208cfb3e3642d0b94df68b9b74d49835e5',
  assistantController: '44dd7a188c399c1530cb895b0301ff514bdd1e906529e5b0736bab5f47cc3ae0',
  assistantDto: '3c2f59a25f480a0d42c188d1bbd18304020eeffcf284d77fe9bb07585f0b9216',
  sseEventTypes: '9a58004960347cf40a55fbd443da356377fa0c61c87329c0a531ffca78c5fb06',
  assistantSseTypes: 'e3020a6884e6381a766ff61fa094dd05f135c65020e3b7a0a6a89c69f62d2f9c',
  historyTypes: '06acd4f1706779e861e0b916022abf45c1732c7ee1a189731db45a991f1f5e44',
  // B4 dependency security remediation: Prisma 7.10.1 and audited transitive
  // overrides; Prisma CLI stays available for production migrations.
  // Scripts, compiled entrypoint, and public boundaries are unchanged.
  packageJson: '077923c924a1b6b87df82defaf775bcae8fdca2390c54a4722390c341f304c6f',
  activeFeature: '718abaacae7e402d4d44998e680abde71aaa88fa21f72c481f4078fee4249bfd',
  // af98077 / 965a23f: AGENTS.md gained the customers/<customer>/ placement rules.
  agentInstructions: 'f80f2b3a929ea52efbc27eaaf3dd7031c443eb7f616ae3b5bc2ed411690e96da'
});

describe('Feature 010 permanent scope boundary (T002)', () => {
  it('preserves Feature 009 planning, capability, and live-release state', () => {
    expect(hash('specs/009-productized-business-connector-runtime/spec.md')).toBe(HASHES.feature009Spec);
    expect(hash('specs/009-productized-business-connector-runtime/design.md')).toBe(HASHES.feature009Design);
    expect(hash('specs/009-productized-business-connector-runtime/plan.md')).toBe(HASHES.feature009Plan);
    expect(hash('specs/009-productized-business-connector-runtime/tasks.md')).toBe(HASHES.feature009Tasks);
    expect(hash('apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json')).toBe(HASHES.feature009Manifest);

    const tasks = text('specs/009-productized-business-connector-runtime/tasks.md');
    const protectedTasks = tasks.match(/^- \[[ xX]\] T(?:12[6-9]|13[0-9]|14[0-2])\b.*$/gm) ?? [];
    expect(protectedTasks).toHaveLength(17);
    expect(protectedTasks.every((line) => line.startsWith('- [ ]'))).toBe(true);
    expect(tasks).toContain('T126_EXECUTED=NO');
    expect(tasks).toContain('FIRST_UNEXECUTED_TASK=T126');
    expect(tasks).toContain('PHASE14_EXECUTED=NO');
    expect(tasks).toContain('NEXT_ACTION=HUMAN_REVIEW_REQUIRED');

    const manifest = text('apps/customer-connector-runtime/integrations/shinmone/work-orders.monthly-new-count.manifest.json');
    const seed = text('scripts/seed.ts');
    expect(`${manifest}\n${seed}`).not.toMatch(/lastMonth/i);
  });

  it('preserves schema, migrations, and frozen Feature 010 planning', () => {
    expect(hash('prisma/schema.prisma')).toBe(HASHES.prismaSchema);
    expect(treeHash(['prisma/migrations'])).toBe(HASHES.prismaMigrations);
    const schema = text('prisma/schema.prisma');
    const ownership = text('prisma/migrations/20261028000000_assistant_session_integration_ownership/migration.sql');
    const whitespace = text('prisma/migrations/20261029000000_assistant_session_integration_whitespace_check/migration.sql');
    expect(schema).toMatch(/model AssistantSession \{[\s\S]*?integrationId\s+String\?/);
    expect(schema).toContain('@@index([customerId, integrationId, organizationId, hostApp, actorId], map: "AssistantSession_scope_integration_idx")');
    expect(ownership).toContain('ADD COLUMN "integrationId" TEXT');
    expect(ownership.split('\n').filter((line) => !line.trimStart().startsWith('--')).join('\n'))
      .not.toMatch(/\b(?:UPDATE|DEFAULT)\b/i);
    expect(ownership).toContain('"customerId", "integrationId", "organizationId", "hostApp", "actorId"');
    expect(whitespace).toContain('"integrationId" IS NULL');
    expect(whitespace).toContain("~ '[^[:space:]]'");
    expect(hash('specs/010-conversational-context-grounded-retrieval/spec.md')).toBe(HASHES.feature010Spec);
    expect(hash('specs/010-conversational-context-grounded-retrieval/design.md')).toBe(HASHES.feature010Design);
    expect(hash('specs/010-conversational-context-grounded-retrieval/plan.md')).toBe(HASHES.feature010Plan);
  });

  it('preserves Assistant HTTP, SDK/package, SSE, and history public boundaries', () => {
    expect(hash('src/assistant/assistant.controller.ts')).toBe(HASHES.assistantController);
    expect(hash('src/assistant/dto/assistant.dto.ts')).toBe(HASHES.assistantDto);
    expect(hash('src/common/sse/sse-event.types.ts')).toBe(HASHES.sseEventTypes);
    expect(hash('src/assistant/sse/assistant-sse.types.ts')).toBe(HASHES.assistantSseTypes);
    expect(hash('src/assistant/history/assistant-history.types.ts')).toBe(HASHES.historyTypes);
    expect(hash('package.json')).toBe(HASHES.packageJson);

    const controller = text('src/assistant/assistant.controller.ts');
    expect(controller.match(/@(Post|Get)\(/g)).toHaveLength(4);
    expect(controller).not.toMatch(/grounded|retrieval|bundle/i);
    expect(text('src/common/sse/sse-event.types.ts')).not.toMatch(/grounded_context|retrieval_/i);
    expect(text('src/assistant/history/assistant-history.types.ts')).not.toMatch(/GroundedContextBundle|requestedNeeds|needResults/);
  });

  it('keeps one repository worktree with no submodule or repository-local external frontend surface', () => {
    const worktrees = git(['worktree', 'list', '--porcelain']).match(/^worktree /gm) ?? [];
    expect(worktrees).toHaveLength(1);
    expect(existsSync(join(ROOT, '.gitmodules'))).toBe(false);
    const tracked = git(['ls-files']).split('\n').filter(Boolean);
    expect(tracked.filter((path) => /(^|\/)(?:frontend|f2e|widget|assistant-sdk)(\/|$)/i.test(path))).toEqual([]);
    expect(tracked.filter((path) => /(^|\/)specs\/010-[^/]+\/(?:spec|design|plan|tasks)\.md$/.test(path))).toHaveLength(4);
  });

  it('preserves active-feature, agent, external, staging, package, and private-material boundaries', () => {
    expect(hash('.specify/feature.json')).toBe(HASHES.activeFeature);
    expect(hash('AGENTS.md')).toBe(HASHES.agentInstructions);
    expect(git(['ls-files']).split('\n').filter((path) => /\.(?:key|pem)$/i.test(path))).toEqual([]);
    expect(git(['submodule', 'status']).trim()).toBe('');
    expect(git(['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1);
    expect(text('.specify/feature.json')).toContain('specs/010-conversational-context-grounded-retrieval');
    expect(text('specs/009-productized-business-connector-runtime/tasks.md')).toContain('LIVE_STAGING_ACCESSED=NO');
    expect(hash('package.json')).toBe(HASHES.packageJson);
  });

  it('keeps the Feature 010 task contract sequential while allowing append-only execution evidence', () => {
    const tasks = text('specs/010-conversational-context-grounded-retrieval/tasks.md');
    const ids = [...tasks.matchAll(/^- \[[ xX]\] T(\d{3})\b/gm)].map((match) => Number(match[1]));
    expect(ids).toEqual(Array.from({ length: 83 }, (_, index) => index + 1));
  });
});

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(join(ROOT, path))).digest('hex');
}

function treeHash(roots: readonly string[]): string {
  const files = roots.flatMap((root) => listFiles(join(ROOT, root))).sort();
  const manifest = files.map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${relative(ROOT, file)}\n`).join('');
  return createHash('sha256').update(manifest).digest('hex');
}

function listFiles(path: string): string[] {
  return statSync(path).isDirectory()
    ? readdirSync(path).filter((entry) => entry !== '.DS_Store').flatMap((entry) => listFiles(join(path, entry)))
    : [path];
}

function text(path: string): string { return readFileSync(join(ROOT, path), 'utf8'); }
function git(args: readonly string[]): string { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
