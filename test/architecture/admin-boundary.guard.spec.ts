import 'reflect-metadata';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { AdminModule } from '../../src/admin/admin.module';
import { ROUTE_ACCESS } from '../../src/admin/authorization/route-access.decorator';

/**
 * Feature 014 T016: the admin API is a separate process. Core never loads it, it never loads the
 * Assistant runtime, and every admin route declares its access.
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
const isAdminFile = (file: string) => file.startsWith(join(src, 'admin') + '/') || file === join(src, 'admin-main.ts');

describe('admin API boundary (Feature 014)', () => {
  it('is not imported by Core: only src/admin-main.ts starts it', () => {
    const offenders = sourceFiles(src)
      .filter((file) => !isAdminFile(file))
      .filter((file) => importsOf(file).some((specifier) => /(^|\/)admin(\/|$)/.test(specifier) || /admin-main/.test(specifier)))
      .map((file) => relative(root, file));
    expect(offenders).toEqual([]);
  });

  it('does not load the Assistant runtime, LLM, retrieval or connectors', () => {
    // Resolved against src/, so the admin API's own folders (e.g. src/admin/feedback) are not mistaken for Core modules.
    const forbidden = new Set(['assistant', 'assistant-experience', 'llm', 'query-understanding', 'query-scope', 'retrieval', 'tools', 'connectors',
      'capabilities', 'host-integration', 'identity', 'approvals', 'evidence', 'feedback']);
    const coreModuleOf = (file: string, specifier: string) => relative(src, join(dirname(file), specifier)).split(sep)[0];
    const offenders = sourceFiles(join(src, 'admin'))
      .concat(join(src, 'admin-main.ts'))
      .flatMap((file) => importsOf(file)
        .filter((specifier) => specifier.startsWith('.') && forbidden.has(coreModuleOf(file, specifier)))
        .map((specifier) => `${relative(root, file)} -> ${specifier}`));
    expect(offenders).toEqual([]);
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
