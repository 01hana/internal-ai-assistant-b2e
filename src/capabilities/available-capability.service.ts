import { Injectable } from '@nestjs/common';
import type { HostIntegrationContext } from '../host-integration/host-integration.types';
import { approvedOutputSummary } from '../query-understanding/tool-capability-summary';
import { ToolRegistryService } from '../tools/tool-registry.service';
import type { RegisteredToolDefinition } from '../tools/tool-registry.types';
import { CapabilityCatalogRegistry } from './capability-catalog.registry';
import type {
  CanonicalParameterValueV1,
  CapabilityBindingV1,
  CapabilityDefinitionV1,
  ScopedCapabilityCatalogV1
} from './capability-pack.types';

/** One active binding the verified actor may execute, with the exact tool authority that permits it. */
export interface AvailableBindingV1 {
  readonly capability: CapabilityDefinitionV1;
  readonly binding: CapabilityBindingV1;
  readonly tool: RegisteredToolDefinition;
  /** Present only when the tool has an allowed result policy. */
  readonly outputSummary?: ReturnType<typeof approvedOutputSummary>;
}

export interface AvailableCapabilityV1 {
  readonly capabilityKey: string;
  readonly safeLabel: string;
  readonly bindingIds: readonly string[];
  /** Enum parameter values reachable through at least one available binding. */
  readonly allowedParameterValues: Readonly<Record<string, readonly string[]>>;
}

export interface AvailableBindingsResult {
  readonly catalog?: ScopedCapabilityCatalogV1;
  readonly bindings: readonly AvailableBindingV1[];
}

/**
 * Single source of "what this actor can run" (Feature 013 FR-001). Used by LLM tool selection,
 * Quick Replies, capability overview and follow-up suggestions. Visibility never replaces the
 * execution-time permission checks, which remain in the tool execution path.
 */
@Injectable()
export class AvailableCapabilityService {
  constructor(
    private readonly catalogs: CapabilityCatalogRegistry,
    private readonly tools: ToolRegistryService
  ) {}

  async resolveAvailableBindings(host: HostIntegrationContext): Promise<AvailableBindingsResult> {
    const selected = this.catalogs.resolveCatalog({ customerId: host.customerId,
      integrationId: host.integrationId, hostApp: host.hostApp });
    if (!selected.available) return { bindings: [] };
    const catalog = selected.catalog;
    const bindings: AvailableBindingV1[] = [];
    for (const binding of catalog.bindings) {
      if (!binding.active) continue;
      const capability = catalog.capabilities.find((item) => item.active && item.capabilityKey === binding.capabilityKey);
      if (!capability) continue;
      const resolved = await this.tools.resolveExactToolForCustomer(binding.target.toolKey,
        binding.target.toolVersion, host.customerId);
      if (!resolved.resolved || !this.tools.isExecutableReadOnly(resolved.resolved.tool)) continue;
      const authority = resolved.resolved;
      if (authority.requiredRoles.length > 0 && !authority.requiredRoles.some((role) => host.roles.includes(role))) continue;
      const scopes = [...authority.tool.requiredPermissionScopes, ...authority.requiredPermissionScopes];
      if (scopes.some((scope) => !host.permissionScopes.includes(scope))) continue;
      const resultPolicy = this.tools.resolveResultPolicy(authority.tool);
      if (!resultPolicy.allowed && resultPolicy.reason !== 'missing_result_policy') continue;
      if (resultPolicy.allowed && resultPolicy.policy.permissionMasks.some((mask) =>
        mask.requiredPermissionScopes.some((scope) => !host.permissionScopes.includes(scope)))) continue;
      const outputSummary = resultPolicy.allowed
        ? approvedOutputSummary(authority.tool, resultPolicy.policy, host.permissionScopes) : undefined;
      if (outputSummary && outputSummary.length === 0) continue;
      bindings.push({ capability, binding, tool: authority.tool, ...(outputSummary ? { outputSummary } : {}) });
    }
    return { catalog, bindings };
  }

  async listAvailable(host: HostIntegrationContext): Promise<readonly AvailableCapabilityV1[]> {
    const { bindings } = await this.resolveAvailableBindings(host);
    const byKey = new Map<string, { capability: CapabilityDefinitionV1; bindingIds: string[]; values: Map<string, Set<string>> }>();
    for (const item of bindings) {
      const entry = byKey.get(item.capability.capabilityKey) ??
        { capability: item.capability, bindingIds: [], values: new Map<string, Set<string>>() };
      entry.bindingIds.push(item.binding.bindingId);
      for (const parameter of item.capability.parameters) {
        if (parameter.type !== 'enum') continue;
        const set = entry.values.get(parameter.parameterName) ?? new Set<string>();
        for (const value of allowedEnumValues(item.capability, item.binding, parameter.parameterName)) set.add(value);
        entry.values.set(parameter.parameterName, set);
      }
      byKey.set(item.capability.capabilityKey, entry);
    }
    return Object.freeze([...byKey.values()].map(({ capability, bindingIds, values }) => Object.freeze({
      capabilityKey: capability.capabilityKey,
      safeLabel: capability.safeLabel,
      bindingIds: Object.freeze([...bindingIds]),
      allowedParameterValues: Object.freeze(Object.fromEntries([...values].map(([name, set]) => [name, Object.freeze([...set])])))
    })));
  }

  /** True when at least one available binding accepts every supplied enum parameter value. */
  async isAvailable(host: HostIntegrationContext, capabilityKey: string,
    parameters: Readonly<Record<string, CanonicalParameterValueV1>> = {}): Promise<boolean> {
    return acceptsDeclared((await this.resolveAvailableBindings(host)).bindings, capabilityKey, parameters);
  }
}

/** Pure check over an already-resolved binding set, so callers can test many choices with one lookup. */
export function acceptsDeclared(bindings: readonly AvailableBindingV1[], capabilityKey: string,
  parameters: Readonly<Record<string, CanonicalParameterValueV1>> = {}): boolean {
  return bindings.some((item) => item.capability.capabilityKey === capabilityKey &&
    Object.entries(parameters).every(([name, value]) => {
      const parameter = item.capability.parameters.find((entry) => entry.parameterName === name);
      if (!parameter) return false;
      if (parameter.type !== 'enum') return true;
      return typeof value === 'string' && allowedEnumValues(item.capability, item.binding, name).includes(value);
    }));
}

function allowedEnumValues(capability: CapabilityDefinitionV1, binding: CapabilityBindingV1, parameterName: string): string[] {
  const parameter = capability.parameters.find((entry) => entry.parameterName === parameterName);
  if (!parameter || parameter.type !== 'enum') return [];
  const constraint = binding.semanticConstraints.find((rule) => rule.parameterName === parameterName);
  return parameter.values.map((value) => value.value)
    .filter((value) => !constraint || constraint.allowedValues.includes(value));
}
