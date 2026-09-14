import type { DataAdapterRegistrations } from '../data-adapter-registration';
import type { ToolRegistryService } from '../../tools/tool-registry.service';
import {
  ProductizedBusinessConnectorAdapter,
  type ProductizedAdapterBinding,
  type ProductizedAdapterOperationBinding
} from './productized-business-connector.adapter';
import type { ProductizedBusinessConnectorTransportService } from './productized-business-connector.module';

export const PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS = Symbol('PRODUCTIZED_DATA_ADAPTER_REGISTRATIONS');
export const PRODUCTIZED_ADAPTER_BINDINGS_ENV = 'ASSISTANT_PRODUCTIZED_ADAPTER_BINDINGS_JSON';

const BINDING_KEYS = new Set([
  'version', 'active', 'customerId', 'integrationId', 'hostApp', 'connectorKey',
  'connectorInstanceId', 'operations'
]);
const OPERATION_KEYS = new Set(['key', 'version']);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTRACT_VERSION = /^[0-9]+\.[0-9]+\.[0-9]+$/;

export function createProductizedAdapterRegistrations(
  environment: Record<string, unknown>,
  toolRegistry: ToolRegistryService,
  transport: ProductizedBusinessConnectorTransportService
): DataAdapterRegistrations {
  const bindings = parseProductizedAdapterBindings(environment[PRODUCTIZED_ADAPTER_BINDINGS_ENV]);
  return Object.freeze(bindings.map((binding) => Object.freeze({
    adapter: new ProductizedBusinessConnectorAdapter(binding, toolRegistry, transport),
    connectorKey: binding.connectorKey,
    customerId: binding.customerId,
    integrationId: binding.integrationId,
    hostApp: binding.hostApp,
    active: binding.active
  })));
}

export function parseProductizedAdapterBindings(value: unknown): readonly ProductizedAdapterBinding[] {
  if (value === undefined) return Object.freeze([]);
  if (typeof value !== 'string') invalid();
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { invalid(); }
  if (!Array.isArray(parsed) || parsed.length > 1_000) invalid();

  const activeRegistrations = new Set<string>();
  const bindings = parsed.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, BINDING_KEYS) || entry.version !== '1' || typeof entry.active !== 'boolean') invalid();
    if (!Array.isArray(entry.operations) || entry.operations.length < 1 || entry.operations.length > 256) invalid();
    const operations = entry.operations.map(parseOperation);
    const operationKeys = new Set(operations.map(({ key, version }) => `${key}\0${version}`));
    if (operationKeys.size !== operations.length) invalid();
    const binding = Object.freeze({
      version: '1' as const,
      active: entry.active,
      customerId: identifier(entry.customerId),
      integrationId: identifier(entry.integrationId),
      hostApp: identifier(entry.hostApp),
      connectorKey: identifier(entry.connectorKey),
      connectorInstanceId: identifier(entry.connectorInstanceId),
      operations: Object.freeze(operations)
    });
    if (binding.active) {
      const registrationKey = [binding.customerId, binding.integrationId, binding.hostApp, binding.connectorKey].join('\0');
      if (activeRegistrations.has(registrationKey)) invalid();
      activeRegistrations.add(registrationKey);
    }
    return binding;
  });
  return Object.freeze(bindings);
}

function parseOperation(value: unknown): ProductizedAdapterOperationBinding {
  if (!isRecord(value) || !hasExactKeys(value, OPERATION_KEYS)) invalid();
  if (typeof value.version !== 'string' || !CONTRACT_VERSION.test(value.version)) invalid();
  return Object.freeze({ key: identifier(value.key), version: value.version });
}

function identifier(value: unknown): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value) || value.includes('*')) invalid();
  return value;
}

function hasExactKeys(value: Record<string, unknown>, keys: Set<string>): boolean {
  return Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalid(): never {
  throw new Error('CONNECTOR_CONFIGURATION_INVALID');
}
