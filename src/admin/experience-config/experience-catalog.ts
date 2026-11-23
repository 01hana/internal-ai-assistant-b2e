import type { CapabilityDefinitionV1, CapabilityParameterDefinitionV1, ScopedCapabilityCatalogV1 } from '../../capabilities/capability-pack.types';

export type CatalogParameter =
  | Readonly<{ name: string; type: 'enum'; required: boolean; values: readonly Readonly<{ value: string; aliases: readonly string[] }>[] }>
  | Readonly<{ name: string; type: 'bounded_string'; required: boolean; maxLength: number }>;

export type CatalogCapability = Readonly<{ capabilityKey: string; label: string; parameters: readonly CatalogParameter[] }>;

/**
 * Feature 016 US1-3: what Quick Replies and follow-ups may reference. The validator requires a capability (and each
 * parameter value) to be declared and active in every HostApp's pack, so the catalogue is their intersection,
 * described by the first pack.
 */
export function experienceCatalog(catalogs: readonly ScopedCapabilityCatalogV1[]): CatalogCapability[] {
  const [first, ...others] = catalogs;
  if (!first) return [];
  const activeIn = (catalog: ScopedCapabilityCatalogV1, key: string) =>
    catalog.capabilities.find((item) => item.active && item.capabilityKey === key);
  return first.capabilities
    .filter((capability) => capability.active && others.every((catalog) => activeIn(catalog, capability.capabilityKey)))
    .map((capability) => describe(capability, others.map((catalog) => activeIn(catalog, capability.capabilityKey)!)));
}

function describe(capability: CapabilityDefinitionV1, sameInOthers: readonly CapabilityDefinitionV1[]): CatalogCapability {
  const parameters = capability.parameters.flatMap((parameter): CatalogParameter[] => {
    const elsewhere = sameInOthers.map((other) => other.parameters.find((item) => item.parameterName === parameter.parameterName));
    if (elsewhere.some((item) => item?.type !== parameter.type)) return [];
    return [describeParameter(parameter, elsewhere as CapabilityParameterDefinitionV1[])];
  });
  return Object.freeze({ capabilityKey: capability.capabilityKey, label: capability.safeLabel, parameters: Object.freeze(parameters) });
}

function describeParameter(parameter: CapabilityParameterDefinitionV1, elsewhere: readonly CapabilityParameterDefinitionV1[]): CatalogParameter {
  const required = parameter.required || elsewhere.some((item) => item.required);
  if (parameter.type === 'bounded_string') {
    const maxLength = Math.min(parameter.maxLength, ...elsewhere.map((item) => (item.type === 'bounded_string' ? item.maxLength : Infinity)));
    return Object.freeze({ name: parameter.parameterName, type: parameter.type, required, maxLength });
  }
  const values = parameter.values
    .filter((value) => elsewhere.every((item) => item.type === 'enum' && item.values.some((other) => other.value === value.value)))
    .map((value) => Object.freeze({ value: value.value, aliases: Object.freeze([...value.aliases]) }));
  return Object.freeze({ name: parameter.parameterName, type: parameter.type, required, values: Object.freeze(values) });
}
