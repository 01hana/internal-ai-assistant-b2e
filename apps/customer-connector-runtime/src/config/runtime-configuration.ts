import { Inject, Injectable, Optional } from '@nestjs/common';
import { isAbsolute } from 'node:path';
import type { CredentialProfileConfiguration } from '../credentials/credential.types';
import type { UpstreamServiceConfiguration } from '../upstream/connector-destination-policy';
import { parseCidr } from '../upstream/ip-address';

export const CONNECTOR_RUNTIME_ENVIRONMENT = Symbol('CONNECTOR_RUNTIME_ENVIRONMENT');

export type RuntimeProfileKind = 'central-invocation' | 'binding-bootstrap';
export type VerificationKeyStatus = 'published' | 'active' | 'retiring' | 'retired';

export interface RuntimeTrustedContextConfiguration {
  readonly customerId: string;
  readonly integrationId: string;
  readonly hostApp: string;
  readonly connectorInstanceId: string;
  readonly organizationId?: string;
  readonly actorId?: string;
}

export interface RuntimeVerificationKeyConfiguration {
  readonly kid: string;
  readonly status: VerificationKeyStatus;
  readonly publicJwk?: Readonly<Record<string, unknown>>;
}

export interface RuntimeServiceProfileConfiguration {
  readonly kind: RuntimeProfileKind;
  readonly profileKey: string;
  readonly typ: string;
  readonly issuer: string;
  readonly subject: string;
  readonly audience: string;
  readonly keyDomain: string;
  readonly trustedContext: RuntimeTrustedContextConfiguration;
  readonly keys: readonly RuntimeVerificationKeyConfiguration[];
  readonly providerKey?: string;
}

export interface ConnectorRuntimeConfiguration {
  readonly processRole: 'single-replica';
  readonly replayCacheMaxEntries: number;
  readonly bindingStoreMaxEntries: number;
  readonly bindingScopeMaxEntries: number;
  readonly bindingSweepBatchSize: number;
  readonly contexts: readonly RuntimeTrustedContextConfiguration[];
  readonly centralProfiles: readonly RuntimeServiceProfileConfiguration[];
  readonly bootstrapProfiles: readonly RuntimeServiceProfileConfiguration[];
  readonly manifestFiles: readonly string[];
  readonly credentialProfiles: readonly CredentialProfileConfiguration[];
  readonly upstreams: readonly UpstreamServiceConfiguration[];
}

export type ConnectorRuntimeConfigurationResult =
  | Readonly<{ ok: true; config: ConnectorRuntimeConfiguration }>
  | Readonly<{ ok: false; category: 'invalid_configuration' }>;

@Injectable()
export class ConnectorRuntimeConfigService {
  private readonly result: ConnectorRuntimeConfigurationResult;

  constructor(@Optional() @Inject(CONNECTOR_RUNTIME_ENVIRONMENT) environment: Record<string, unknown> = process.env) {
    this.result = parseConnectorRuntimeConfiguration(environment);
  }

  get isValid(): boolean { return this.result.ok; }
  get validation(): ConnectorRuntimeConfigurationResult { return this.result; }
  get configuration(): ConnectorRuntimeConfiguration {
    if (!this.result.ok) throw new ConnectorRuntimeConfigurationError();
    return this.result.config;
  }
}

export class ConnectorRuntimeConfigurationError extends Error {
  constructor() { super('Invalid Connector Runtime configuration.'); }
}

export function parseConnectorRuntimeConfiguration(environment: Record<string, unknown>): ConnectorRuntimeConfigurationResult {
  try {
    rejectSecretEnvironment(environment);
    if (environment.CONNECTOR_RUNTIME_PROCESS_ROLE !== 'single-replica') fail();
    const contexts = parseContexts(environment.CONNECTOR_RUNTIME_CONTEXT_JSON);
    const centralProfiles = parseProfiles(environment.CONNECTOR_CENTRAL_TRUST_KEYS_JSON, 'central-invocation');
    const bootstrapProfiles = parseProfiles(environment.CONNECTOR_BINDING_BOOTSTRAP_PROFILES_JSON, 'binding-bootstrap');
    const phase5 = parsePhase5Configuration(environment);
    const upstreams = parseUpstreams(environment.CONNECTOR_UPSTREAMS_JSON);
    validateProfileRegistry(contexts, [...centralProfiles, ...bootstrapProfiles]);
    const config: ConnectorRuntimeConfiguration = {
      processRole: 'single-replica',
      replayCacheMaxEntries: integer(environment.CONNECTOR_REPLAY_CACHE_MAX_ENTRIES, 1, 100_000),
      bindingStoreMaxEntries: integer(environment.CONNECTOR_BINDING_STORE_MAX_ENTRIES, 1, 100_000),
      bindingScopeMaxEntries: integer(environment.CONNECTOR_BINDING_SCOPE_MAX_ENTRIES, 1, 100_000),
      bindingSweepBatchSize: integer(environment.CONNECTOR_BINDING_SWEEP_BATCH_SIZE, 1, 100_000),
      contexts,
      centralProfiles,
      bootstrapProfiles,
      manifestFiles: phase5.manifestFiles,
      credentialProfiles: phase5.credentialProfiles,
      upstreams
    };
    if (config.bindingScopeMaxEntries > config.bindingStoreMaxEntries || config.bindingSweepBatchSize > config.bindingStoreMaxEntries) fail();
    return Object.freeze({ ok: true, config: deepFreeze(config) });
  } catch {
    return Object.freeze({ ok: false, category: 'invalid_configuration' });
  }
}

function parseUpstreams(value: unknown): readonly UpstreamServiceConfiguration[] {
  if (value === undefined) return Object.freeze([]);
  const parsed = json(value);
  if (!Array.isArray(parsed) || parsed.length > 100) fail();
  return deepFreeze(parsed.map((entry) => {
    if (!objectWithKeys(entry, ['upstreamServiceRef', 'origin', 'basePath', 'addressMode', 'allowedCidrs'], []) ||
        !identifier(entry.upstreamServiceRef) || typeof entry.origin !== 'string' || typeof entry.basePath !== 'string' ||
        !['public_only', 'allowlisted_networks', 'test_loopback_tls'].includes(entry.addressMode as string) ||
        !Array.isArray(entry.allowedCidrs) || !entry.allowedCidrs.every((cidr) => typeof cidr === 'string' && parseCidr(cidr) !== undefined)) fail();
    return { upstreamServiceRef: entry.upstreamServiceRef as string, origin: entry.origin, basePath: entry.basePath,
      addressMode: entry.addressMode, allowedCidrs: entry.allowedCidrs } as UpstreamServiceConfiguration;
  }));
}

function parsePhase5Configuration(environment: Record<string, unknown>): Readonly<{
  manifestFiles: readonly string[];
  credentialProfiles: readonly CredentialProfileConfiguration[];
}> {
  const rawFiles = environment.CONNECTOR_MANIFEST_FILES;
  const rawProfiles = environment.CONNECTOR_CREDENTIAL_PROFILES_JSON;
  if (rawFiles === undefined && rawProfiles === undefined) return Object.freeze({ manifestFiles: Object.freeze([]), credentialProfiles: Object.freeze([]) });
  if (rawFiles === undefined || rawProfiles === undefined) fail();
  const files = json(rawFiles);
  const profiles = json(rawProfiles);
  if (!Array.isArray(files) || files.length < 1 || files.length > 100 ||
      !files.every((path) => typeof path === 'string' && isAbsolute(path)) || new Set(files).size !== files.length ||
      !Array.isArray(profiles) || profiles.length < 1 || profiles.length > 100) fail();
  const parsedProfiles = profiles.map((profile) => {
    if (!objectWithKeys(profile, ['credentialProfileRef', 'credentialProviderKey', 'applicationStrategyKey', 'credentialKind'], [])) fail();
    for (const name of ['credentialProfileRef', 'credentialProviderKey', 'applicationStrategyKey', 'credentialKind']) {
      if (!identifier(profile[name])) fail();
    }
    return Object.freeze({
      credentialProfileRef: profile.credentialProfileRef as string,
      credentialProviderKey: profile.credentialProviderKey as string,
      applicationStrategyKey: profile.applicationStrategyKey as string,
      credentialKind: profile.credentialKind as string
    });
  });
  if (new Set(parsedProfiles.map((profile) => profile.credentialProfileRef)).size !== parsedProfiles.length) fail();
  return deepFreeze({ manifestFiles: files as string[], credentialProfiles: parsedProfiles });
}

function parseContexts(value: unknown): readonly RuntimeTrustedContextConfiguration[] {
  const parsed = json(value);
  if (!Array.isArray(parsed) || parsed.length === 0) fail();
  const contexts = parsed.map(parseContext);
  if (new Set(contexts.map(contextKey)).size !== contexts.length) fail();
  return deepFreeze(contexts);
}

function parseContext(value: unknown): RuntimeTrustedContextConfiguration {
  const required = ['customerId', 'integrationId', 'hostApp', 'connectorInstanceId'];
  const optional = ['organizationId', 'actorId'];
  if (!objectWithKeys(value, required, optional)) fail();
  for (const name of required) if (!identifier(value[name])) fail();
  for (const name of optional) if (value[name] !== undefined && !identifier(value[name])) fail();
  return deepFreeze({
    customerId: value.customerId as string,
    integrationId: value.integrationId as string,
    hostApp: value.hostApp as string,
    connectorInstanceId: value.connectorInstanceId as string,
    ...(value.organizationId === undefined ? {} : { organizationId: value.organizationId as string }),
    ...(value.actorId === undefined ? {} : { actorId: value.actorId as string })
  });
}

function parseProfiles(value: unknown, expectedKind: RuntimeProfileKind): readonly RuntimeServiceProfileConfiguration[] {
  const parsed = json(value);
  if (!Array.isArray(parsed) || parsed.length === 0) fail();
  return deepFreeze(parsed.map((entry) => parseProfile(entry, expectedKind)));
}

function parseProfile(value: unknown, expectedKind: RuntimeProfileKind): RuntimeServiceProfileConfiguration {
  const base = ['kind', 'profileKey', 'typ', 'issuer', 'subject', 'audience', 'keyDomain', 'trustedContext', 'keys'];
  const optional = expectedKind === 'binding-bootstrap' ? ['providerKey'] : [];
  if (!objectWithKeys(value, base, optional) || value.kind !== expectedKind) fail();
  for (const name of ['profileKey', 'typ', 'issuer', 'subject', 'audience', 'keyDomain']) if (!profileValue(value[name])) fail();
  if (expectedKind === 'binding-bootstrap' ? !identifier(value.providerKey) : value.providerKey !== undefined) fail();
  if (!Array.isArray(value.keys) || value.keys.length === 0) fail();
  const keys = value.keys.map(parseKey);
  if (new Set(keys.map((key) => key.kid)).size !== keys.length || keys.filter((key) => key.status === 'active').length !== 1) fail();
  return deepFreeze({
    kind: expectedKind,
    profileKey: value.profileKey as string,
    typ: value.typ as string,
    issuer: value.issuer as string,
    subject: value.subject as string,
    audience: value.audience as string,
    keyDomain: value.keyDomain as string,
    trustedContext: parseContext(value.trustedContext),
    keys,
    ...(expectedKind === 'binding-bootstrap' ? { providerKey: value.providerKey as string } : {})
  });
}

function parseKey(value: unknown): RuntimeVerificationKeyConfiguration {
  if (!objectWithKeys(value, ['kid', 'status'], ['publicJwk']) || !identifier(value.kid) ||
      !['published', 'active', 'retiring', 'retired'].includes(value.status as string)) fail();
  if (value.status === 'retired') {
    if (value.publicJwk !== undefined) fail();
    return deepFreeze({ kid: value.kid as string, status: 'retired' });
  }
  if (!objectWithKeys(value.publicJwk, ['kty', 'kid', 'alg', 'use', 'n', 'e'], []) || hasPrivateJwk(value.publicJwk) || value.publicJwk.kty !== 'RSA' ||
      value.publicJwk.kid !== value.kid || value.publicJwk.alg !== 'RS256' || value.publicJwk.use !== 'sig' ||
      !base64url(value.publicJwk.n) || value.publicJwk.e !== 'AQAB') fail();
  return deepFreeze({ kid: value.kid as string, status: value.status as VerificationKeyStatus, publicJwk: { ...value.publicJwk } });
}

function validateProfileRegistry(contexts: readonly RuntimeTrustedContextConfiguration[], profiles: readonly RuntimeServiceProfileConfiguration[]): void {
  const profileKeys = new Set<string>();
  const keyDomains = new Set<string>();
  const keyMaterials = new Set<string>();
  const selectors = new Set<string>();
  for (const profile of profiles) {
    if (profileKeys.has(profile.profileKey) || keyDomains.has(profile.keyDomain) ||
        !contexts.some((context) => contextKey(context) === contextKey(profile.trustedContext))) fail();
    profileKeys.add(profile.profileKey);
    keyDomains.add(profile.keyDomain);
    for (const key of profile.keys) {
      const selector = `${profile.kind}\0${profile.typ}\0${key.kid}`;
      if (selectors.has(selector)) fail();
      selectors.add(selector);
      if (key.publicJwk) {
        const material = `${key.publicJwk.n}\0${key.publicJwk.e}`;
        if (keyMaterials.has(material)) fail();
        keyMaterials.add(material);
      }
    }
  }
}

function rejectSecretEnvironment(environment: Record<string, unknown>): void {
  for (const name of ['CONNECTOR_PRIVATE_KEY', 'CONNECTOR_PRIVATE_KEY_PEM', 'CONNECTOR_SIGNING_SECRET', 'JWT_SIGNING_SECRET']) {
    if (environment[name] !== undefined) fail();
  }
}

function json(value: unknown): unknown {
  if (typeof value !== 'string') fail();
  try { return JSON.parse(value); } catch { fail(); }
}
function integer(value: unknown, min: number, max: number): number {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (!Number.isInteger(parsed) || (parsed as number) < min || (parsed as number) > max) fail();
  return parsed as number;
}
function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !value.includes('*');
}
function profileValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\0*]/.test(value);
}
function base64url(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value); }
function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function objectWithKeys(value: unknown, required: readonly string[], optional: readonly string[]): value is Record<string, unknown> {
  if (!plainObject(value) || !required.every((name) => name in value)) return false;
  const allowed = new Set([...required, ...optional]);
  return Object.keys(value).every((name) => allowed.has(name));
}
function hasPrivateJwk(value: Record<string, unknown>): boolean { return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((name) => name in value); }
function contextKey(context: RuntimeTrustedContextConfiguration): string {
  return [context.customerId, context.integrationId, context.hostApp, context.connectorInstanceId,
    context.organizationId ?? '', context.actorId ?? ''].join('\0');
}
function fail(): never { throw new ConnectorRuntimeConfigurationError(); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
