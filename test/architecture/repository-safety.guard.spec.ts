import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Permanent repository safety boundaries (Feature 013 T001–T002).
 * Replaces the Feature 010 whole-file hash freeze: these checks protect security and
 * migration integrity without blocking normal changes to controllers, DTOs or schema.
 */
const ROOT = resolve(__dirname, '../..');
const LEDGER_PATH = 'test/fixtures/migration-ledger.json';

type MigrationLedger = Readonly<{ migrationLock: string; migrations: Readonly<Record<string, string>> }>;

export function findPrivateKeyMaterial(trackedPaths: readonly string[]): string[] {
  return trackedPaths.filter((path) => /\.(?:key|pem)$/i.test(path));
}

export function findExternalFrontendSurface(trackedPaths: readonly string[]): string[] {
  return trackedPaths.filter((path) => /(^|\/)(?:frontend|f2e|widget|assistant-sdk)(\/|$)/i.test(path));
}

/** Returns violations; an empty array means the migrations directory honours the append-only ledger. */
export function checkMigrationLedger(migrationsDir: string, ledger: MigrationLedger): string[] {
  const violations: string[] = [];
  const lockPath = join(migrationsDir, 'migration_lock.toml');
  if (!existsSync(lockPath) || sha256(lockPath) !== ledger.migrationLock) violations.push('migration_lock.toml changed or missing');
  for (const [name, expected] of Object.entries(ledger.migrations)) {
    const file = join(migrationsDir, name, 'migration.sql');
    if (!existsSync(file)) violations.push(`${name}: removed`);
    else if (sha256(file) !== expected) violations.push(`${name}: modified`);
  }
  const known = Object.keys(ledger.migrations).sort();
  const latestKnown = known[known.length - 1] ?? '';
  for (const name of migrationDirectories(migrationsDir)) {
    if (name in ledger.migrations) continue;
    if (name <= latestKnown) violations.push(`${name}: inserted before ${latestKnown}`);
    else violations.push(`${name}: not recorded in ${LEDGER_PATH}`);
  }
  return violations;
}

describe('repository safety boundaries', () => {
  const tracked = git(['ls-files']).split('\n').filter(Boolean);

  it('tracks no private key material', () => {
    expect(findPrivateKeyMaterial(['src/a.ts', 'secrets/core.pem', 'x/signing.KEY'])).toEqual(['secrets/core.pem', 'x/signing.KEY']);
    expect(findPrivateKeyMaterial(tracked)).toEqual([]);
  });

  it('has no submodules and exactly one worktree', () => {
    expect(existsSync(join(ROOT, '.gitmodules'))).toBe(false);
    expect(git(['submodule', 'status']).trim()).toBe('');
    expect(git(['worktree', 'list', '--porcelain']).match(/^worktree /gm)).toHaveLength(1);
  });

  it('keeps the embeddable frontend out of this repository', () => {
    expect(findExternalFrontendSurface(['src/a.ts', 'apps/widget/index.ts', 'assistant-sdk/x.ts'])).toEqual(['apps/widget/index.ts', 'assistant-sdk/x.ts']);
    expect(findExternalFrontendSurface(tracked)).toEqual([]);
  });

  describe('Prisma migrations are append-only', () => {
    const ledger = JSON.parse(readFileSync(join(ROOT, LEDGER_PATH), 'utf8')) as MigrationLedger;
    let scratch: string;

    beforeEach(() => {
      scratch = mkdtempSync(join(tmpdir(), 'migration-ledger-'));
      cpSync(join(ROOT, 'prisma/migrations'), scratch, { recursive: true });
    });
    afterEach(() => rmSync(scratch, { recursive: true, force: true }));

    it('matches the ledger', () => {
      expect(checkMigrationLedger(join(ROOT, 'prisma/migrations'), ledger)).toEqual([]);
    });

    it('rejects a modified, removed or back-dated migration and an unrecorded new one', () => {
      const [first, second] = Object.keys(ledger.migrations).sort();
      writeFileSync(join(scratch, first, 'migration.sql'), '-- tampered\n', { flag: 'a' });
      rmSync(join(scratch, second), { recursive: true });
      cpSync(join(scratch, first), join(scratch, '20000101000000_backdated'), { recursive: true });
      cpSync(join(scratch, first), join(scratch, '29991231000000_unrecorded'), { recursive: true });
      expect(checkMigrationLedger(scratch, ledger)).toEqual([
        `${first}: modified`,
        `${second}: removed`,
        '20000101000000_backdated: inserted before ' + Object.keys(ledger.migrations).sort().at(-1),
        `29991231000000_unrecorded: not recorded in ${LEDGER_PATH}`
      ]);
    });
  });
});

function migrationDirectories(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory()).sort();
}
function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function git(args: readonly string[]): string { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }); }
