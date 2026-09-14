import { isIP } from 'node:net';

export const CENTRAL_INVOCATION_PATH = '/v1/connector/invocations';
export const CENTRAL_MAX_WIRE_BYTES = 16_384;

export type ConnectorAddressPolicy = Readonly<{
  mode: 'public_only' | 'allowlisted_networks';
  allowedCidrs: readonly string[];
}>;

export type ConnectorDeployment = Readonly<{
  version: '1'; customerId: string; integrationId: string; hostApp: string;
  connectorKey: string; connectorInstanceId: string; active: boolean;
  invocationUri: string; serviceAuthProfileKey: string;
  destinationPolicy: ConnectorAddressPolicy;
  maxRequestBytes: number; maxResponseBytes: number; maxTransportMs: number;
}>;

export type ConnectorDeploymentSelector = Pick<ConnectorDeployment,
  'customerId' | 'integrationId' | 'hostApp' | 'connectorKey' | 'connectorInstanceId'>;

const DEPLOYMENT_KEYS = new Set([
  'version', 'customerId', 'integrationId', 'hostApp', 'connectorKey',
  'connectorInstanceId', 'active', 'invocationUri', 'serviceAuthProfileKey',
  'destinationPolicy', 'maxRequestBytes', 'maxResponseBytes', 'maxTransportMs',
]);
const POLICY_KEYS = new Set(['mode', 'allowedCidrs']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function invalid(): never { throw new Error('CONNECTOR_CONFIGURATION_INVALID'); }
function exactKeys(value: Record<string, unknown>, allowed: Set<string>): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) invalid();
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.includes('*')) invalid();
  return value;
}
function bound(value: unknown, max: number): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > max) invalid();
  return value as number;
}
function tuple(value: ConnectorDeploymentSelector): string {
  return [value.customerId, value.integrationId, value.hostApp, value.connectorKey, value.connectorInstanceId].join('\0');
}
function parseOne(input: unknown): ConnectorDeployment {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid();
  const value = input as Record<string, unknown>;
  exactKeys(value, DEPLOYMENT_KEYS);
  if (value.version !== '1' || typeof value.active !== 'boolean') invalid();
  if (!value.destinationPolicy || typeof value.destinationPolicy !== 'object' || Array.isArray(value.destinationPolicy)) invalid();
  const rawPolicy = value.destinationPolicy as Record<string, unknown>;
  exactKeys(rawPolicy, POLICY_KEYS);
  if (rawPolicy.mode !== 'public_only' && rawPolicy.mode !== 'allowlisted_networks') invalid();
  if (!Array.isArray(rawPolicy.allowedCidrs) || rawPolicy.allowedCidrs.some((entry) => typeof entry !== 'string' || entry.length > 64 || !validCidr(entry))) invalid();
  if (rawPolicy.mode === 'public_only' && rawPolicy.allowedCidrs.length !== 0) invalid();
  if (rawPolicy.mode === 'allowlisted_networks' && rawPolicy.allowedCidrs.length === 0) invalid();
  let uri: URL;
  try { uri = new URL(String(value.invocationUri)); } catch { invalid(); }
  if (uri.protocol !== 'https:' || uri.username || uri.password || uri.hash || uri.search || uri.pathname !== CENTRAL_INVOCATION_PATH || !uri.hostname || uri.hostname.includes('*')) invalid();
  const hostname = uri.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || ['127.0.0.1','0.0.0.0','::1','169.254.169.254','fd00:ec2::254'].includes(hostname)) invalid();
  const destinationPolicy = Object.freeze({ mode: rawPolicy.mode, allowedCidrs: Object.freeze([...rawPolicy.allowedCidrs] as string[]) });
  return Object.freeze({
    version: '1', customerId: id(value.customerId), integrationId: id(value.integrationId),
    hostApp: id(value.hostApp), connectorKey: id(value.connectorKey), connectorInstanceId: id(value.connectorInstanceId),
    active: value.active, invocationUri: uri.toString(), serviceAuthProfileKey: id(value.serviceAuthProfileKey),
    destinationPolicy, maxRequestBytes: bound(value.maxRequestBytes, CENTRAL_MAX_WIRE_BYTES),
    maxResponseBytes: bound(value.maxResponseBytes, CENTRAL_MAX_WIRE_BYTES), maxTransportMs: bound(value.maxTransportMs, 4_500),
  });
}

function validCidr(text: string): boolean {
  const parts = text.split('/'); if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1]!)) return false;
  const family = isIP(parts[0]!); const prefix = Number(parts[1]);
  if (family === 4) return prefix >= 0 && prefix <= 32;
  if (family !== 6 || prefix < 0 || prefix > 128) return false;
  return !parts[0]!.toLowerCase().includes('ffff:') || prefix >= 96;
}

export class ConnectorDeploymentRegistry {
  private readonly byTuple = new Map<string, ConnectorDeployment>();
  private constructor(deployments: readonly ConnectorDeployment[]) {
    const seen = new Set<string>();
    for (const deployment of deployments) {
      const key = tuple(deployment);
      if (seen.has(key)) invalid();
      seen.add(key);
      if (deployment.active) {
        this.byTuple.set(key, deployment);
      }
    }
  }
  static fromJson(json: string): ConnectorDeploymentRegistry {
    let parsed: unknown;
    try { parsed = JSON.parse(json); } catch { invalid(); }
    if (!Array.isArray(parsed) || parsed.length > 1_000) invalid();
    return new ConnectorDeploymentRegistry(Object.freeze(parsed.map(parseOne)));
  }
  resolve(selector: ConnectorDeploymentSelector): { ok: true; value: ConnectorDeployment } | { ok: false; code: 'CONNECTOR_UNAVAILABLE' } {
    const value = this.byTuple.get(tuple(selector));
    return value ? { ok: true, value } : { ok: false, code: 'CONNECTOR_UNAVAILABLE' };
  }
  get activeCount(): number { return this.byTuple.size; }
  serviceAuthProfileRefs(): readonly string[] {
    return Object.freeze([...new Set([...this.byTuple.values()].map((deployment) => deployment.serviceAuthProfileKey))].sort());
  }
}
