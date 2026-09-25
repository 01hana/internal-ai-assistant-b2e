import { Inject, Injectable } from '@nestjs/common';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { CapabilityCatalogRegistry } from './capability-catalog.registry';
import { MAX_PACK_BYTES, parseCustomerCapabilityPackJsonV1 } from './capability-pack.parser';
import type { CustomerCapabilityPackV1, ScopedCapabilityCatalogV1 } from './capability-pack.types';

export interface CapabilityPackFileAccess {
  inspect(path: string): Promise<Readonly<{
    regular: boolean;
    symbolicLink: boolean;
    size: number;
  }>>;
  read(path: string): Promise<Uint8Array>;
}

export const CAPABILITY_PACK_FILE_ACCESS = Symbol('CAPABILITY_PACK_FILE_ACCESS');

export const NODE_CAPABILITY_PACK_FILE_ACCESS: CapabilityPackFileAccess = Object.freeze({
  async inspect(path: string) {
    const stat = await lstat(path);
    return Object.freeze({
      regular: stat.isFile(),
      symbolicLink: stat.isSymbolicLink(),
      size: stat.size
    });
  },
  async read(path: string) {
    return new Uint8Array(await readFile(path));
  }
});

@Injectable()
export class CapabilityPackLoader {
  constructor(
    private readonly registry: CapabilityCatalogRegistry,
    private readonly tools: ToolRegistryService,
    @Inject(CAPABILITY_PACK_FILE_ACCESS) private readonly files: CapabilityPackFileAccess
  ) {}

  async loadAndInstall(pathsJson: string): Promise<void> {
    try {
      const paths = parseConfiguredPaths(pathsJson);
      const packs = await this.loadPacks(paths);
      await this.validateActiveToolTargets(packs);
      const catalogs = buildScopedCatalogs(packs);
      this.registry.installRelease(catalogs);
    } catch {
      invalid();
    }
  }

  private async loadPacks(paths: readonly string[]): Promise<CustomerCapabilityPackV1[]> {
    const packs: CustomerCapabilityPackV1[] = [];
    for (const path of paths) {
      const stat = await this.files.inspect(path);
      if (!stat.regular || stat.symbolicLink || stat.size < 1 || stat.size > MAX_PACK_BYTES) {
        invalid();
      }
      const bytes = await this.files.read(path);
      packs.push(parseCustomerCapabilityPackJsonV1(bytes));
    }
    return packs;
  }

  private async validateActiveToolTargets(packs: readonly CustomerCapabilityPackV1[]): Promise<void> {
    const validatedTargets = new Set<string>();
    for (const pack of packs) {
      if (!pack.active) continue;
      for (const binding of pack.bindings) {
        if (!binding.active) continue;
        const identity = `${binding.target.toolKey}\0${binding.target.toolVersion}`;
        if (validatedTargets.has(identity)) continue;
        const result = await this.tools.resolveExactExecutableTool(binding.target.toolKey, binding.target.toolVersion);
        if (!result.tool) invalid();
        validatedTargets.add(identity);
      }
    }
  }

}

function parseConfiguredPaths(input: string): readonly string[] {
  if (typeof input !== 'string') invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    invalid();
  }
  if (!Array.isArray(parsed) || parsed.some((path) => typeof path !== 'string' || !isAbsolute(path))) invalid();
  const uniquePaths = new Set(parsed);
  if (uniquePaths.size !== parsed.length) invalid();
  return parsed;
}

function buildScopedCatalogs(packs: readonly CustomerCapabilityPackV1[]): ScopedCapabilityCatalogV1[] {
  const catalogs: ScopedCapabilityCatalogV1[] = [];
  const scopeKeys = new Set<string>();
  const capabilityIdentities = new Set<string>();
  const bindingIdentities = new Set<string>();

  for (const pack of packs) {
    if (!pack.active) continue;
    const capabilities = pack.capabilities.filter((capability) => capability.active);
    const bindings = pack.bindings.filter((binding) => binding.active);
    for (const hostApp of pack.hostApps) {
      const scopeKey = `${pack.customerId}\0${pack.integrationId}\0${hostApp}`;
      for (const capability of capabilities) {
        const identity = `${scopeKey}\0${capability.capabilityKey}`;
        if (capabilityIdentities.has(identity)) invalid();
        capabilityIdentities.add(identity);
      }
      for (const binding of bindings) {
        const identity = `${scopeKey}\0${binding.bindingId}\0${binding.bindingVersion}`;
        if (bindingIdentities.has(identity)) invalid();
        bindingIdentities.add(identity);
      }
      if (scopeKeys.has(scopeKey)) invalid();
      scopeKeys.add(scopeKey);
      catalogs.push({
        version: '1',
        packId: pack.packId,
        packVersion: pack.packVersion,
        customerId: pack.customerId,
        integrationId: pack.integrationId,
        hostApp,
        capabilities,
        bindings
      });
    }
  }
  return catalogs;
}

function invalid(): never {
  throw new Error('CAPABILITY_PACK_INVALID');
}
