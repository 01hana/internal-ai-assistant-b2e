import { Injectable } from '@nestjs/common';
import { ToolRegistryService } from '../tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../tools/tool-registry.types';
import { validateCapabilityCanonicalValue } from './capability-parameter-resolver.service';
import type {
  CanonicalParameterValueV1,
  CapabilityBindingV1,
  CapabilityDefinitionV1,
  CapabilityParameterDefinitionV1,
  CapabilityResolutionResultV1,
  ScopedCapabilityCatalogV1
} from './capability-pack.types';

const TOP_LEVEL_FIELD = /^[A-Za-z][A-Za-z0-9_]*$/;
const SAFE_CONSTANT = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

@Injectable()
export class CapabilityBindingResolverService {
  constructor(private readonly tools: ToolRegistryService) {}

  async validateCatalog(catalog: ScopedCapabilityCatalogV1): Promise<void> {
    const capabilities = new Map(catalog.capabilities.filter((item) => item.active).map((item) => [item.capabilityKey, item]));
    const activeBindings = catalog.bindings.filter((item) => item.active);
    for (const binding of activeBindings) {
      const capability = capabilities.get(binding.capabilityKey);
      if (!capability) invalid();
      validateDeclaration(capability, binding);
      const resolved = await this.resolveExactTool(binding);
      if (!resolved.tool) invalid();
      validateToolContract(capability, binding, resolved.tool);
    }
    for (let left = 0; left < activeBindings.length; left++) {
      for (let right = left + 1; right < activeBindings.length; right++) {
        if (activeBindings[left].capabilityKey === activeBindings[right].capabilityKey && constraintsOverlap(activeBindings[left], activeBindings[right])) invalid();
      }
    }
  }

  async resolve(
    catalog: ScopedCapabilityCatalogV1,
    capabilityKey: string,
    parameters: Readonly<Record<string, CanonicalParameterValueV1>>
  ): Promise<CapabilityResolutionResultV1> {
    const capability = catalog.capabilities.find((item) => item.active && item.capabilityKey === capabilityKey);
    if (!capability) invalid();
    const declared = new Map(capability.parameters.map((item) => [item.parameterName, item]));
    for (const [name, value] of Object.entries(parameters)) {
      const definition = declared.get(name);
      if (!definition || validateCapabilityCanonicalValue(definition, value) !== value) invalid();
    }
    for (const definition of capability.parameters) {
      if (definition.required && !Object.prototype.hasOwnProperty.call(parameters, definition.parameterName)) invalid();
    }
    const reference = Object.freeze({ packId: catalog.packId, packVersion: catalog.packVersion, capabilityKey, safeLabel: capability.safeLabel });
    const compatible: CapabilityBindingV1[] = [];
    for (const binding of catalog.bindings) {
      if (!binding.active || binding.capabilityKey !== capabilityKey) continue;
      validateDeclaration(capability, binding);
      if (isCompatible(binding, parameters)) compatible.push(binding);
    }
    if (compatible.length === 0) {
      return Object.freeze({ version: '1', outcome: 'CAPABILITY_UNAVAILABLE', capability: reference, parameters: Object.freeze({ ...parameters }), reasonCode: 'NO_COMPATIBLE_ACTIVE_BINDING' });
    }
    if (compatible.length !== 1) invalid();
    const binding = compatible[0];
    const resolved = await this.resolveExactTool(binding);
    if (!resolved.tool) invalid();
    validateToolContract(capability, binding, resolved.tool);
    const args: Record<string, CanonicalParameterValueV1> = {};
    for (const mapping of binding.mappings) {
      if (mapping.source === 'BOUND_CONSTANT') args[mapping.targetArgument] = mapping.value;
      else if (Object.prototype.hasOwnProperty.call(parameters, mapping.parameterName)) args[mapping.targetArgument] = parameters[mapping.parameterName];
    }
    let validation: ReturnType<ToolRegistryService['validateNamedOperation']>;
    try {
      validation = this.tools.validateNamedOperation(resolved.tool, { arguments: args });
    } catch {
      invalid();
    }
    if (!validation.valid) invalid();
    return Object.freeze({
      version: '1', outcome: 'RESOLVED', capability: reference, parameters: Object.freeze({ ...parameters }),
      bindingRef: Object.freeze({ bindingId: binding.bindingId, bindingVersion: binding.bindingVersion }),
      toolCandidate: Object.freeze({ key: resolved.tool.key, version: resolved.tool.version, arguments: validation.operation.arguments, reason: 'customer_capability_binding' })
    });
  }

  private async resolveExactTool(binding: CapabilityBindingV1) {
    try {
      return await this.tools.resolveExactExecutableTool(binding.target.toolKey, binding.target.toolVersion);
    } catch {
      invalid();
    }
  }
}

function validateDeclaration(capability: CapabilityDefinitionV1, binding: CapabilityBindingV1): void {
  if (binding.capabilityKey !== capability.capabilityKey || binding.target.kind !== 'TOOL') invalid();
  const definitions = new Map(capability.parameters.map((item) => [item.parameterName, item]));
  if (definitions.size !== capability.parameters.length) invalid();
  const consumption = new Map<string, number>();
  const targets = new Set<string>();
  for (const constraint of binding.semanticConstraints) {
    const definition = definitions.get(constraint.parameterName);
    if (!definition || definition.type !== 'enum' || constraint.operator !== 'ENUM_VALUE_IN' || constraint.allowedValues.length === 0) invalid();
    const allowed = new Set(definition.values.map((item) => item.value));
    if (new Set(constraint.allowedValues).size !== constraint.allowedValues.length || constraint.allowedValues.some((value) => !allowed.has(value))) invalid();
    consumption.set(constraint.parameterName, (consumption.get(constraint.parameterName) ?? 0) + 1);
  }
  for (const mapping of binding.mappings) {
    if (!TOP_LEVEL_FIELD.test(mapping.targetArgument) || targets.has(mapping.targetArgument)) invalid();
    targets.add(mapping.targetArgument);
    if (mapping.source === 'CANONICAL_PARAMETER') {
      if (!definitions.has(mapping.parameterName)) invalid();
      consumption.set(mapping.parameterName, (consumption.get(mapping.parameterName) ?? 0) + 1);
    } else if (mapping.source === 'BOUND_CONSTANT') {
      if (!isSafeScalar(mapping.value)) invalid();
    } else invalid();
  }
  for (const definition of capability.parameters) {
    const count = consumption.get(definition.parameterName) ?? 0;
    if (count > 1 || (definition.required && count !== 1)) invalid();
  }
}

function validateToolContract(capability: CapabilityDefinitionV1, binding: CapabilityBindingV1, tool: RegisteredToolDefinition): void {
  if (tool.key !== binding.target.toolKey || tool.version !== binding.target.toolVersion || !tool.active || tool.operation !== 'read' || tool.hasSideEffect) invalid();
  const schema = tool.inputSchema;
  if (schema.type !== 'object' || !isObject(schema.properties)) invalid();
  const properties = schema.properties as Record<string, unknown>;
  const assignments = new Set<string>();
  const definitions = new Map(capability.parameters.map((item) => [item.parameterName, item]));
  for (const mapping of binding.mappings) {
    const field = properties[mapping.targetArgument];
    if (!TOP_LEVEL_FIELD.test(mapping.targetArgument) || !Object.prototype.hasOwnProperty.call(properties, mapping.targetArgument) || !isObject(field)) invalid();
    assignments.add(mapping.targetArgument);
    if (mapping.source === 'BOUND_CONSTANT') {
      if (!matchesField(field, mapping.value)) invalid();
    } else {
      const definition = definitions.get(mapping.parameterName);
      if (!definition || !mappedTypeCompatible(definition, field)) invalid();
    }
  }
  if (schema.required.some((name) => !assignments.has(name))) invalid();
}

function mappedTypeCompatible(definition: CapabilityParameterDefinitionV1, field: Record<string, unknown>): boolean {
  if (field.type !== 'string') return false;
  if (definition.type === 'bounded_string') {
    return !Array.isArray(field.enum) &&
      (typeof field.maxLength !== 'number' || field.maxLength >= definition.maxLength) &&
      (typeof field.minLength !== 'number' || field.minLength <= 1);
  }
  return definition.values.every((item) => matchesField(field, item.value));
}

function matchesField(field: Record<string, unknown>, value: CanonicalParameterValueV1): boolean {
  if (typeof value !== field.type && !(field.type === 'integer' && typeof value === 'number' && Number.isInteger(value))) return false;
  if (Array.isArray(field.enum) && !field.enum.includes(value)) return false;
  if (typeof value === 'string') {
    if (typeof field.maxLength === 'number' && value.length > field.maxLength) return false;
    if (typeof field.minLength === 'number' && value.length < field.minLength) return false;
  }
  return true;
}

function isCompatible(binding: CapabilityBindingV1, parameters: Readonly<Record<string, CanonicalParameterValueV1>>): boolean {
  const consumed = new Map<string, number>();
  for (const constraint of binding.semanticConstraints) {
    const value = parameters[constraint.parameterName];
    if (value === undefined || !constraint.allowedValues.includes(String(value))) return false;
    consumed.set(constraint.parameterName, (consumed.get(constraint.parameterName) ?? 0) + 1);
  }
  for (const mapping of binding.mappings) {
    if (mapping.source !== 'CANONICAL_PARAMETER') continue;
    if (Object.prototype.hasOwnProperty.call(parameters, mapping.parameterName)) {
      consumed.set(mapping.parameterName, (consumed.get(mapping.parameterName) ?? 0) + 1);
    }
  }
  return Object.keys(parameters).every((name) => consumed.get(name) === 1);
}

function constraintsOverlap(a: CapabilityBindingV1, b: CapabilityBindingV1): boolean {
  const left = new Map(a.semanticConstraints.map((item) => [item.parameterName, item]));
  const right = new Map(b.semanticConstraints.map((item) => [item.parameterName, item]));
  for (const [name, first] of left) {
    const second = right.get(name);
    if (second && !first.allowedValues.some((value) => second.allowedValues.includes(value))) return false;
  }
  return true;
}

function isSafeScalar(value: unknown): value is CanonicalParameterValueV1 {
  if (typeof value === 'string') return value.length <= 256 && SAFE_CONSTANT.test(value);
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalid(): never {
  throw new Error('CAPABILITY_BINDING_INVALID');
}
