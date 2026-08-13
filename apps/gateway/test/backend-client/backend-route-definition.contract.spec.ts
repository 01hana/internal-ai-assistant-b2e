import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repositoryRoot = resolve(__dirname, '../../../..');
const mainPath = join(repositoryRoot, 'src/main.ts');
const assistantControllerPath = join(repositoryRoot, 'src/assistant/assistant.controller.ts');
const gatewayBackendClientRoot = join(repositoryRoot, 'apps/gateway/src/backend-client');
const definitionPath = join(gatewayBackendClientRoot, 'backend-route-definition.ts');

type BackendRouteDefinitions = Readonly<Record<'create-session' | 'get-session' | 'get-session-messages' | 'send-stream-message', Readonly<{ method: string; path: string }>>>;

const expectedMappings: BackendRouteDefinitions = Object.freeze({
  'create-session': Object.freeze({ method: 'POST', path: '/api/v1/assistant/sessions' }),
  'get-session': Object.freeze({ method: 'GET', path: '/api/v1/assistant/sessions/:id' }),
  'get-session-messages': Object.freeze({ method: 'GET', path: '/api/v1/assistant/sessions/:id/messages' }),
  'send-stream-message': Object.freeze({ method: 'POST', path: '/api/v1/assistant/sessions/:id/messages' })
});

describe('Backend route definition compatibility contract (T063)', () => {
  const mainSource = readFileSync(mainPath, 'utf8');
  const controllerSource = readFileSync(assistantControllerPath, 'utf8');

  it('derives the locked Gateway operations from the existing Backend bootstrap and controller', () => {
    expect(extractBackendSurface(mainSource, controllerSource)).toEqual(expectedMappings);
  });

  it.each([
    ['HTTP method', mainSource, controllerSource.replace('@Post("sessions")', '@Get("sessions")')],
    ['global prefix', mainSource.replace('app.setGlobalPrefix("api/v1")', 'app.setGlobalPrefix("api/v2")'), controllerSource],
    ['controller prefix', mainSource, controllerSource.replace('@Controller("assistant")', '@Controller("assistants")')],
    ['path', mainSource, controllerSource.replace('@Post("sessions")', '@Post("session")')],
    [':id parameter name', mainSource, controllerSource.replace('sessions/:id/messages', 'sessions/:sessionId/messages')],
    ['history query DTO', mainSource, controllerSource.replace('@Query() query: AssistantMessageHistoryQueryDto', '@Query() query: Record<string, string>')]
  ])('rejects Backend %s drift', (_kind, mutatedMain, mutatedController) => {
    expect(() => assertMatchesLockedRoutes(mutatedMain, mutatedController)).toThrow('Backend route surface no longer matches the locked Gateway contract.');
  });

  it('rejects generic caller-selected routing and proxy patterns if a Gateway backend-client source tree is introduced', () => {
    const forbidden = /@All\s*\(|@Controller\s*\(\s*['"`]\*|\b(?:transparent\s+)?proxy\b|\b(?:caller|request|input|params)\s*\.\s*(?:destination|url|path|method)\b|\b(?:destination|url|path|method)\s*:\s*(?:caller|request|input|params)\b/i;
    expect(readSourceFiles(gatewayBackendClientRoot).filter((source) => forbidden.test(source.content))).toEqual([]);
  });

  it('requires the future server-owned BackendRouteDefinition catalogue', () => {
    const definitions = loadBackendRouteDefinitions();
    expect(definitions).toEqual(expectedMappings);
  });
});

function assertMatchesLockedRoutes(mainSource: string, controllerSource: string): void {
  if (JSON.stringify(extractBackendSurface(mainSource, controllerSource)) !== JSON.stringify(expectedMappings)) {
    throw new Error('Backend route surface no longer matches the locked Gateway contract.');
  }
}

function extractBackendSurface(mainSource: string, controllerSource: string): BackendRouteDefinitions {
  const globalPrefix = requiredMatch(mainSource, /app\.setGlobalPrefix\(\s*["']([^"']+)["']\s*\)/, 'global prefix');
  const controllerPrefix = requiredMatch(controllerSource, /@Controller\(\s*["']([^"']+)["']\s*\)/, 'controller prefix');
  const createSession = extractPostRoute(controllerSource, 'createSession');
  const getSession = extractPostRoute(controllerSource, 'getSession');
  const getMessages = extractPostRoute(controllerSource, 'listMessages');
  const sendMessage = extractPostRoute(controllerSource, 'postMessage');
  const parameter = requiredMatch(sendMessage.parameters, /@Param\(\s*["']([^"']+)["']\s*\)/, 'message parameter');
  const getSessionParameter = requiredMatch(getSession.parameters, /@Param\(\s*["']([^"']+)["']\s*\)/, 'session parameter');
  const getMessagesParameter = requiredMatch(getMessages.parameters, /@Param\(\s*["']([^"']+)["']\s*\)/, 'history parameter');

  if (parameter !== 'id' || getSessionParameter !== 'id' || getMessagesParameter !== 'id' || !/@Query\(\)\s+query:\s+AssistantMessageHistoryQueryDto/.test(getMessages.parameters)) throw new Error('Backend route surface no longer matches the locked Gateway contract.');
  return Object.freeze({
    'create-session': Object.freeze({ method: createSession.method, path: route(globalPrefix, controllerPrefix, createSession.path) }),
    'get-session': Object.freeze({ method: getSession.method, path: route(globalPrefix, controllerPrefix, getSession.path) }),
    'get-session-messages': Object.freeze({ method: getMessages.method, path: route(globalPrefix, controllerPrefix, getMessages.path) }),
    'send-stream-message': Object.freeze({ method: sendMessage.method, path: route(globalPrefix, controllerPrefix, sendMessage.path) })
  });
}

function extractPostRoute(source: string, methodName: string): Readonly<{ method: string; path: string; parameters: string }> {
  const methodIndex = source.indexOf(`async ${methodName}`);
  if (methodIndex < 0) throw new Error(`Backend ${methodName} route is missing.`);
  const leadingSource = source.slice(Math.max(0, methodIndex - 600), methodIndex);
  const decorators = [...leadingSource.matchAll(/@(Post|Get|Put|Patch|Delete)\(\s*["']([^"']+)["']\s*\)/g)];
  const decorator = decorators.at(-1);
  if (!decorator) throw new Error(`Backend ${methodName} HTTP decorator is missing.`);
  const parameterSource = source.slice(methodIndex, methodIndex + 800);
  return Object.freeze({ method: decorator[1].toUpperCase(), path: decorator[2], parameters: parameterSource });
}

function route(...segments: string[]): string {
  return `/${segments.map((segment) => segment.replace(/^\/+|\/+$/g, '')).join('/')}`;
}

function requiredMatch(source: string, expression: RegExp, label: string): string {
  const value = expression.exec(source)?.[1];
  if (!value) throw new Error(`Backend ${label} is missing.`);
  return value;
}

function loadBackendRouteDefinitions(): unknown {
  if (!existsSync(definitionPath)) {
    throw new Error('required Phase 7 production surface missing: BackendRouteDefinition catalogue.');
  }
  const target = require(definitionPath) as { BACKEND_ROUTE_DEFINITIONS?: unknown };
  if (!target.BACKEND_ROUTE_DEFINITIONS) {
    throw new Error('required Phase 7 production surface missing: BackendRouteDefinition catalogue.');
  }
  return target.BACKEND_ROUTE_DEFINITIONS;
}

function readSourceFiles(root: string): Array<Readonly<{ path: string; content: string }>> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  collectSourceFiles(root, files);
  return files.map((path) => Object.freeze({ path, content: readFileSync(path, 'utf8') }));
}

function collectSourceFiles(directory: string, files: string[]): void {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) collectSourceFiles(path, files);
    else if (/\.(?:ts|tsx|js|cjs|mjs)$/.test(path)) files.push(path);
  }
}
