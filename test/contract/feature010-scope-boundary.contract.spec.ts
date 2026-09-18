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
  feature009Manifest: '1d1747eb11b82ae2179cb78eca7d5707fd2dcb6a4a604dbb37f373dd05825352',
  prismaSchema: 'e14673993010d994259e6a1d611c02f22b217752890abfc8b63cc812ea38d733',
  prismaMigrations: '8a93d1082c2696f8b50af5adbe4e0128a8f984894d94f6d30e02f66d6b2c58ba',
  gatewayTree: '0354af851312a8fb65bfd4c0ffe3b81e199267f3086fb06bb57f84871387dde3',
  identityBridgeTree: 'd3cc54a76d8b52e225529e8dbdd82c33601b608de91b2230790218a1a89013f3',
  feature010Spec: '3c33d6737768d59d6b62f907d77be06fea2b8b6c145392527d473019436c9346',
  feature010Design: 'c060bcf6a9e305fbecc75697410642f261ded88eb9230ad9d36e5b9b5c02500f',
  feature010Plan: 'c6d151ca35e53655fefb2cfde53879208cfb3e3642d0b94df68b9b74d49835e5',
  assistantController: '0ad4fadadc2916d5252fe4b0e369cfb3dad9a16bdb9054d1d67ce5a127ec33b5',
  assistantDto: '3c2f59a25f480a0d42c188d1bbd18304020eeffcf284d77fe9bb07585f0b9216',
  sseEventTypes: '9a58004960347cf40a55fbd443da356377fa0c61c87329c0a531ffca78c5fb06',
  assistantSseTypes: 'e3020a6884e6381a766ff61fa094dd05f135c65020e3b7a0a6a89c69f62d2f9c',
  historyTypes: '06acd4f1706779e861e0b916022abf45c1732c7ee1a189731db45a991f1f5e44',
  packageJson: '970e99f6780a56eeb6e37931d94c3eeb3084bd8cbe5f9decf49d4ca6e710bf9f',
  activeFeature: '718abaacae7e402d4d44998e680abde71aaa88fa21f72c481f4078fee4249bfd',
  agentInstructions: 'e2989d23443431394adaa0008e235af2a57133961300eaf630b387ec91f556dd',
  unrelatedKeyFixture: '6ab251163e505b122d4be86b124efc9bb180a1af99fd9fd5b358832a7eef61fd'
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

  it('preserves schema, migrations, Gateway, Identity Bridge, and frozen Feature 010 planning', () => {
    expect(hash('prisma/schema.prisma')).toBe(HASHES.prismaSchema);
    expect(treeHash(['prisma/migrations'])).toBe(HASHES.prismaMigrations);
    expect(treeHash(['apps/gateway/src', 'apps/gateway/test'])).toBe(HASHES.gatewayTree);
    expect(treeHash(['apps/identity-bridge/src', 'apps/identity-bridge/test'])).toBe(HASHES.identityBridgeTree);
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

  it('preserves active-feature, agent, external, staging, package, and unrelated-fixture boundaries', () => {
    expect(hash('.specify/feature.json')).toBe(HASHES.activeFeature);
    expect(hash('AGENTS.md')).toBe(HASHES.agentInstructions);
    expect(hash('apps/customer-connector-runtime/test/fixtures/phase6-upstream.key')).toBe(HASHES.unrelatedKeyFixture);
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
    ? readdirSync(path).flatMap((entry) => listFiles(join(path, entry)))
    : [path];
}

function text(path: string): string { return readFileSync(join(ROOT, path), 'utf8'); }
function git(args: readonly string[]): string { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
