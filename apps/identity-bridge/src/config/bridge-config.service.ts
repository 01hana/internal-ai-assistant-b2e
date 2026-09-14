import { Inject, Injectable, Optional } from '@nestjs/common';
import { isIP } from 'node:net';
import { BridgeConfigurationError, type DestinationPolicy, httpsUri, parseDestinationPolicy, required } from './destination-policy.config';
import {
  ConnectorBindingDestinationPolicy,
  parseConnectorBindingDestinationPolicyConfig,
  type ConnectorBindingAddressPolicy
} from '../connector-binding/connector-binding-destination.policy';

export type SigningKeyConfig = Readonly<{ kid: string; status: 'published' | 'active' | 'retiring'; publicJwk: Readonly<Record<string, unknown>>; keyReference?: string }>;
export type ConnectorBindingContextConfiguration = Readonly<{
  customerId: string; integrationId: string; hostApp: string; connectorInstanceId: string;
  organizationId?: string; actorId?: string; bootstrapProfileKey: 'BRIDGE_BINDING_TRANSPORT_V1'; providerKey: string;
}>;
export type ConnectorBindingServiceAuthConfiguration = Readonly<{
  profileKey: 'BRIDGE_BINDING_TRANSPORT_V1'; typ: 'assistant-connector-binding+jwt'; issuer: string;
  subject: string; audience: string; keyDomain: string; keys: readonly ConnectorBindingSigningKeyConfig[];
}>;
export type ConnectorBindingSigningKeyConfig = Readonly<{
  kid: string; status: 'published' | 'active' | 'retiring'; publicJwk: Readonly<Record<string, unknown>>; privateKeyReference?: string;
}>;
export type ConnectorBindingConfiguration = Readonly<{
  uri: string; destination: ConnectorBindingAddressPolicy; context: ConnectorBindingContextConfiguration;
  serviceAuth: ConnectorBindingServiceAuthConfiguration; timeoutMilliseconds: 2000;
}>;
export type BridgeConfiguration = Readonly<{ idxMenuDetailUri: string; allowedEntries: readonly string[]; integrationId: string; hostApp: string; issuer: string; audience: string; signingKeys: readonly SigningKeyConfig[]; destination: DestinationPolicy; timeoutMilliseconds: number; maxResponseBytes: number; allowedOrigins: readonly string[]; connectorBinding?: ConnectorBindingConfiguration }>;
export type ConfigurationResult = Readonly<{ ok: true; config: BridgeConfiguration } | { ok: false; category: string }>;
export const BRIDGE_ENVIRONMENT = Symbol('BRIDGE_ENVIRONMENT');

@Injectable()
export class BridgeConfigService {
  private readonly result: ConfigurationResult;
  constructor(@Optional() @Inject(BRIDGE_ENVIRONMENT) input: Record<string, unknown> = process.env) { this.result = parseBridgeConfiguration(input); }
  get isValid(): boolean { return this.result.ok; }
  get configuration(): BridgeConfiguration { if (!this.result.ok) throw new BridgeConfigurationError(this.result.category); return this.result.config; }
  get validation(): ConfigurationResult { return this.result; }
}

export function parseBridgeConfiguration(input: Record<string, unknown>): ConfigurationResult {
  try {
    for (const name of ['BRIDGE_PRIVATE_KEY', 'BRIDGE_PRIVATE_KEY_PEM', 'JWT_SIGNING_SECRET']) if (input[name] !== undefined) throw new BridgeConfigurationError('private_key_material');
    if (input.BRIDGE_IDX_ALLOWED_ENTRY !== undefined) throw new BridgeConfigurationError('allowed_entries');
    const integrationId = required(input.BRIDGE_INTEGRATION_ID);
    const hostApp = required(input.BRIDGE_HOST_APP);
    const signingKeyValues = signingKeys(input.BRIDGE_SIGNING_KEYS);
    const connectorBinding = parseConnectorBindingConfiguration(input, integrationId, hostApp, signingKeyValues);
    const config: BridgeConfiguration = deepFreeze({
      idxMenuDetailUri: httpsUri(input.BRIDGE_IDX_MENUDETAIL_URI, 'idx_endpoint'), allowedEntries: allowedEntries(input.BRIDGE_IDX_ALLOWED_ENTRIES),
      integrationId, hostApp, issuer: required(input.BRIDGE_ISSUER), audience: required(input.BRIDGE_AUDIENCE),
      signingKeys: signingKeyValues, destination: parseDestinationPolicy(input), timeoutMilliseconds: integer(input.BRIDGE_TIMEOUT_MS, 1, 5000, 'timeout'), maxResponseBytes: integer(input.BRIDGE_MAX_RESPONSE_BYTES, 1, 262144, 'response_size'), allowedOrigins: origins(input.BRIDGE_ALLOWED_ORIGINS),
      ...(connectorBinding === undefined ? {} : { connectorBinding })
    });
    return { ok: true, config };
  } catch (error) { return { ok: false, category: error instanceof BridgeConfigurationError ? error.category : 'invalid' }; }
}

const CONNECTOR_ENVIRONMENT_KEYS = [
  'BRIDGE_CONNECTOR_BINDING_URI', 'BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY',
  'BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON', 'BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON',
  'BRIDGE_BINDING_REQUEST_TIMEOUT_MS'
] as const;

function parseConnectorBindingConfiguration(input: Record<string, unknown>, integrationId: string, hostApp: string,
  identityKeys: readonly SigningKeyConfig[]): ConnectorBindingConfiguration | undefined {
  const present = CONNECTOR_ENVIRONMENT_KEYS.filter((key) => input[key] !== undefined);
  if (present.length === 0) return undefined;
  if (present.length !== CONNECTOR_ENVIRONMENT_KEYS.length) throw new BridgeConfigurationError('connector_binding');
  const uri = bindingUri(input.BRIDGE_CONNECTOR_BINDING_URI);
  const destination = parseConnectorBindingDestinationPolicyConfig(parseJson(input.BRIDGE_CONNECTOR_BINDING_DESTINATION_POLICY));
  if (!destination) throw new BridgeConfigurationError('connector_binding_destination');
  const uriHost = new URL(uri).hostname.replace(/^\[|\]$/g, '');
  if (isIP(uriHost) && !new ConnectorBindingDestinationPolicy(destination).validate([uriHost]).ok) {
    throw new BridgeConfigurationError('connector_binding_destination');
  }
  const context = bindingContext(parseJson(input.BRIDGE_CONNECTOR_BINDING_CONTEXT_JSON), integrationId, hostApp);
  const serviceAuth = bindingServiceAuth(parseJson(input.BRIDGE_CONNECTOR_BINDING_SERVICE_AUTH_JSON), identityKeys);
  if (serviceAuth.profileKey !== context.bootstrapProfileKey || integer(input.BRIDGE_BINDING_REQUEST_TIMEOUT_MS, 2000, 2000, 'connector_binding_timeout') !== 2000) {
    throw new BridgeConfigurationError('connector_binding');
  }
  return deepFreeze({ uri, destination, context, serviceAuth, timeoutMilliseconds: 2000 as const });
}

function bindingUri(value: unknown): string {
  const uri = httpsUri(value, 'connector_binding_uri');
  const parsed = new URL(uri);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.+$/, '');
  if (!hostname || hostname.includes('*') || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      parsed.search || parsed.pathname !== '/v1/internal/connector-bindings') throw new BridgeConfigurationError('connector_binding_uri');
  return parsed.toString();
}

function bindingContext(value: unknown, integrationId: string, hostApp: string): ConnectorBindingContextConfiguration {
  const requiredKeys = ['customerId', 'integrationId', 'hostApp', 'connectorInstanceId', 'bootstrapProfileKey', 'providerKey'];
  const allowedKeys = [...requiredKeys, 'organizationId', 'actorId'];
  if (!record(value) || !requiredKeys.every((key) => identifier(value[key])) ||
      Object.keys(value).some((key) => !allowedKeys.includes(key)) ||
      (value.organizationId !== undefined && !identifier(value.organizationId)) ||
      (value.actorId !== undefined && !identifier(value.actorId)) ||
      value.integrationId !== integrationId || value.hostApp !== hostApp || value.bootstrapProfileKey !== 'BRIDGE_BINDING_TRANSPORT_V1') {
    throw new BridgeConfigurationError('connector_binding_context');
  }
  return deepFreeze({
    customerId: value.customerId as string, integrationId, hostApp,
    connectorInstanceId: value.connectorInstanceId as string,
    ...(value.organizationId === undefined ? {} : { organizationId: value.organizationId }),
    ...(value.actorId === undefined ? {} : { actorId: value.actorId }),
    bootstrapProfileKey: 'BRIDGE_BINDING_TRANSPORT_V1' as const,
    providerKey: value.providerKey as string
  });
}

function bindingServiceAuth(value: unknown, identityKeys: readonly SigningKeyConfig[]): ConnectorBindingServiceAuthConfiguration {
  const keys = ['profileKey', 'typ', 'issuer', 'subject', 'audience', 'keyDomain', 'keys'];
  if (!record(value) || !exactKeys(value, keys) || value.profileKey !== 'BRIDGE_BINDING_TRANSPORT_V1' ||
      value.typ !== 'assistant-connector-binding+jwt' ||
      ![value.issuer, value.subject, value.audience, value.keyDomain].every(profileValue) ||
      /identity|gateway|central|customer-b/i.test(value.keyDomain as string) || !Array.isArray(value.keys) || value.keys.length === 0) {
    throw new BridgeConfigurationError('connector_binding_service_auth');
  }
  const parsedKeys = Object.freeze(value.keys.map(bindingSigningKey));
  if (new Set(parsedKeys.map((key) => key.kid)).size !== parsedKeys.length || parsedKeys.filter((key) => key.status === 'active').length !== 1) {
    throw new BridgeConfigurationError('connector_binding_service_auth');
  }
  const identityMaterials = new Set(identityKeys.map((key) => publicMaterial(key.publicJwk)));
  const identityReferences = new Set(identityKeys.map((key) => key.keyReference).filter((entry): entry is string => entry !== undefined));
  if (parsedKeys.some((key) => identityMaterials.has(publicMaterial(key.publicJwk)) ||
      (key.privateKeyReference !== undefined && identityReferences.has(key.privateKeyReference)))) {
    throw new BridgeConfigurationError('connector_binding_service_auth');
  }
  return deepFreeze({
    profileKey: 'BRIDGE_BINDING_TRANSPORT_V1' as const,
    typ: 'assistant-connector-binding+jwt' as const,
    issuer: value.issuer as string, subject: value.subject as string, audience: value.audience as string,
    keyDomain: value.keyDomain as string, keys: parsedKeys
  });
}

function bindingSigningKey(value: unknown): ConnectorBindingSigningKeyConfig {
  if (!record(value) || !exactKeys(value, ['kid', 'status', 'publicJwk', ...(value.privateKeyReference === undefined ? [] : ['privateKeyReference'])]) ||
      !identifier(value.kid) || !['published', 'active', 'retiring'].includes(value.status as string) || !validPublicJwk(value.publicJwk)) {
    throw new BridgeConfigurationError('connector_binding_service_auth');
  }
  const reference = value.privateKeyReference === undefined ? undefined : safeReference(value.privateKeyReference);
  if ((value.status === 'active') !== (reference !== undefined)) throw new BridgeConfigurationError('connector_binding_service_auth');
  return deepFreeze({
    kid: value.kid, status: value.status as ConnectorBindingSigningKeyConfig['status'],
    publicJwk: { ...(value.publicJwk as Record<string, unknown>) },
    ...(reference === undefined ? {} : { privateKeyReference: reference })
  });
}

function validPublicJwk(value: unknown): value is Record<string, unknown> {
  return record(value) && exactKeys(value, ['kty', 'kid', 'alg', 'use', 'n', 'e']) && value.kty === 'RSA' &&
    identifier(value.kid) && value.alg === 'RS256' && value.use === 'sig' && typeof value.n === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(value.n) && value.e === 'AQAB' && !privateJwk(value);
}

function publicMaterial(value: Readonly<Record<string, unknown>>): string {
  return `${String(value.kty)}\0${String(value.n)}\0${String(value.e)}`;
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') throw new BridgeConfigurationError('connector_binding');
  try { return JSON.parse(value); } catch { throw new BridgeConfigurationError('connector_binding'); }
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => key in value);
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) && !value.includes('*');
}

function profileValue(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\s\0*]/.test(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}
function allowedEntries(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new BridgeConfigurationError('allowed_entries');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new BridgeConfigurationError('allowed_entries'); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new BridgeConfigurationError('allowed_entries');
  const seen = new Set<string>();
  const entries = parsed.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || entry !== entry.trim() || containsControlCharacter(entry) || seen.has(entry)) throw new BridgeConfigurationError('allowed_entries');
    seen.add(entry);
    return entry;
  });
  return Object.freeze(entries);
}
function integer(value: unknown, min: number, max: number, category: string): number { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN; if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BridgeConfigurationError(category); return parsed; }
function signingKeys(value: unknown): readonly SigningKeyConfig[] {
  if (typeof value !== 'string') throw new BridgeConfigurationError('signing_keys'); let parsed: unknown; try { parsed = JSON.parse(value); } catch { throw new BridgeConfigurationError('signing_keys'); }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new BridgeConfigurationError('signing_keys'); const seen = new Set<string>();
  return Object.freeze(parsed.map((item) => { if (!record(item) || !record(item.publicJwk)) throw new BridgeConfigurationError('signing_keys'); const kid = required(item.kid); const status = item.status; if (!['published', 'active', 'retiring'].includes(status as string) || seen.has(kid) || privateJwk(item.publicJwk)) throw new BridgeConfigurationError('signing_keys'); seen.add(kid); const reference = item.keyReference === undefined ? undefined : safeReference(item.keyReference); return Object.freeze(reference === undefined ? { kid, status: status as SigningKeyConfig['status'], publicJwk: Object.freeze({ ...item.publicJwk }) } : { kid, status: status as SigningKeyConfig['status'], publicJwk: Object.freeze({ ...item.publicJwk }), keyReference: reference }); }));
}
function origins(value: unknown): readonly string[] { if (value === undefined || value === '') return Object.freeze([]); if (typeof value !== 'string') throw new BridgeConfigurationError('origins'); const entries = value.split(',').map((entry) => entry.trim()); if (!entries.every((entry) => entry && entry !== '*')) throw new BridgeConfigurationError('origins'); const normalized = entries.map((entry) => { const uri = httpsUri(entry, 'origins'); const url = new URL(uri); if (url.pathname !== '/' || url.search || url.hash) throw new BridgeConfigurationError('origins'); return url.origin; }); return Object.freeze([...new Set(normalized)]); }
function safeReference(value: unknown): string {
  const reference = required(value);
  if (/-----BEGIN|^Bearer\s|^[\w-]+\.[\w-]+\.[\w-]+$/i.test(reference)) throw new BridgeConfigurationError('signing_keys');
  try {
    const uri = new URL(reference);
    if (uri.protocol !== 'file:' || uri.host || uri.search || uri.hash) throw new Error();
  } catch { throw new BridgeConfigurationError('signing_keys'); }
  return reference;
}
function privateJwk(value: Record<string, unknown>): boolean { return ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'].some((key) => key in value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function containsControlCharacter(value: string): boolean { return [...value].some((character) => { const code = character.charCodeAt(0); return code <= 0x1f || code === 0x7f; }); }
