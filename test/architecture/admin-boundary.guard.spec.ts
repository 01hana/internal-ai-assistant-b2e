import 'reflect-metadata';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { AdminModule } from '../../src/admin/admin.module';
import { ROUTE_ACCESS } from '../../src/admin/authorization/route-access.decorator';

/**
 * Feature 014 T016: the admin API is a separate process. Core never loads it, it never loads the
 * Assistant runtime (Feature 016: apart from the listed experience-config files), and every admin route declares its access.
 */
const root = process.cwd();
const src = join(root, 'src');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : sourceFiles(path);
    return path.endsWith('.ts') && !path.endsWith('.spec.ts') ? [path] : [];
  });
}

const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g)].map((match) => match[1] ?? match[2]);
/** Core modules the admin API must not load (Feature 014): Assistant runtime, LLM, retrieval, connectors… */
const ADMIN_FORBIDDEN_MODULES = new Set(['assistant', 'assistant-experience', 'llm', 'query-understanding', 'query-scope', 'retrieval', 'tools',
  'connectors', 'capabilities', 'host-integration', 'identity', 'approvals', 'evidence', 'feedback']);

/** Feature 016 FR-008: the only files of those modules the admin API may load, to validate experience configurations. */
const ADMIN_ALLOWED_CORE_FILES = new Set([
  'assistant-experience/assistant-experience.types.ts',
  'assistant-experience/assistant-experience.parser.ts',
  'assistant-experience/assistant-experience.validator.ts',
  'assistant-experience/assistant-experience.repository.ts',
  'capabilities/capability-catalog.registry.ts',
  'capabilities/capability-pack.loader.ts',
  'capabilities/capability-pack.parser.ts',
  'capabilities/capability-binding-resolver.service.ts',
  'capabilities/capability-parameter-resolver.service.ts',
  'tools/tool-registry.service.ts',
  'tools/tool-registry.types.ts',
  'tools/customer-tool-policy.service.ts',
  'identity/customer-scope.types.ts'
]);

const runtimeImportsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+['"](\.[^'"]+)['"]/gms)].map((match) => match[1]);

function resolveSource(file: string, specifier: string): string[] {
  const base = join(dirname(file), specifier);
  return [`${base}.ts`, join(base, 'index.ts')].filter((candidate) => candidate.startsWith(src + sep) && !candidate.includes(`${sep}generated${sep}`) && existsSync(candidate));
}

const isAdminFile = (file: string) => file.startsWith(join(src, 'admin') + '/') || file === join(src, 'admin-main.ts');

describe('admin API boundary (Feature 014)', () => {
  it('is not imported by Core: only src/admin-main.ts starts it', () => {
    const offenders = sourceFiles(src)
      .filter((file) => !isAdminFile(file))
      .filter((file) => importsOf(file).some((specifier) => /(^|\/)admin(\/|$)/.test(specifier) || /admin-main/.test(specifier)))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  it('does not load the Assistant runtime, LLM, retrieval or connectors (Feature 016: only the listed experience-config files)', () => {
    // Every file the admin API loads at runtime, followed through relative imports; `import type` is erased by TypeScript.
    const seen = new Set<string>();
    const pending = sourceFiles(join(src, 'admin')).concat(join(src, 'admin-main.ts'));
    while (pending.length > 0) {
      const file = pending.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      pending.push(...runtimeImportsOf(file).flatMap((specifier) => resolveSource(file, specifier)));
    }
    const offenders = [...seen]
      .map((file) => relative(src, file).split(sep).join('/'))
      .filter((path) => ADMIN_FORBIDDEN_MODULES.has(path.split('/')[0]) && !ADMIN_ALLOWED_CORE_FILES.has(path));
    expect(offenders).toEqual([]);
    // The list stays exact: an entry the admin API no longer loads is removed.
    const loaded = new Set([...seen].map((file) => relative(src, file).split(sep).join('/')));
    expect([...ADMIN_ALLOWED_CORE_FILES].filter((path) => !loaded.has(path))).toEqual([]);
  });

  it('declares route access on every admin controller method', () => {
    const controllers = (Reflect.getMetadata('controllers', AdminModule) ?? []) as Array<new (...args: never[]) => object>;
    expect(controllers.length).toBeGreaterThan(0);
    const undeclared = controllers.flatMap((controller) =>
      Object.getOwnPropertyNames(controller.prototype)
        .filter((name) => name !== 'constructor' && Reflect.getMetadata('path', (controller.prototype as Record<string, unknown>)[name] as object) !== undefined)
        .filter((name) => !Reflect.getMetadata(ROUTE_ACCESS, (controller.prototype as Record<string, unknown>)[name] as object) && !Reflect.getMetadata(ROUTE_ACCESS, controller))
        .map((name) => `${controller.name}.${name}`));
    expect(undeclared).toEqual([]);
  });

  it('leaves every /admin route to the admin API: Core has no admin controllers (Feature 015 removed review-items)', () => {
    const offenders = sourceFiles(src)
      .filter((file) => !isAdminFile(file))
      .filter((file) => /@Controller\(\s*['"`]\/?admin\b/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  it('keeps the admin API on its own prefix, set up in one place shared by the entry point and the tests', () => {
    expect(readFileSync(join(src, 'admin', 'admin-app.setup.ts'), 'utf8')).toContain("setGlobalPrefix('api/v1/admin')");
    expect(readFileSync(join(src, 'admin-main.ts'), 'utf8')).toContain('configureAdminApp(app)');
    expect(readFileSync(join(root, 'test', 'support', 'admin-test-app.helper.ts'), 'utf8')).toContain('configureAdminApp(app)');
    expect(readFileSync(join(src, 'main.ts'), 'utf8')).not.toMatch(/admin-main|AdminModule|configureAdminApp/);
  });
});
