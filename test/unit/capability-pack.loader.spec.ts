import { chmod, lstat, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { CapabilityCatalogRegistry } from '../../src/capabilities/capability-catalog.registry';
import {
  CapabilityPackFileAccess,
  CapabilityPackLoader
} from '../../src/capabilities/capability-pack.loader';
import { MAX_PACK_BYTES } from '../../src/capabilities/capability-pack.parser';
import type { ToolRegistryService } from '../../src/tools/tool-registry.service';

describe('CapabilityPackLoader filesystem and complete-release boundary', () => {
  it('rejects relative and repeated configured paths before installation', async () => {
    const harness = await createHarness();
    await expect(harness.loader.loadAndInstall(JSON.stringify(['relative.json']))).rejects.toThrow('CAPABILITY_PACK_INVALID');
    await expect(harness.loader.loadAndInstall(JSON.stringify([harness.validPath, harness.validPath]))).rejects.toThrow(
      'CAPABILITY_PACK_INVALID'
    );
    expect(harness.registry.resolveCatalog(scope('customer-a'))).toEqual(unavailable());
  });

  it('accepts a conventional 0644 regular file when all pack requirements are valid', async () => {
    const harness = await createHarness();
    const conventionalPath = await writePack(
      harness.directory,
      'conventional-mode.json',
      validPack({ customerId: 'conventional-mode' }),
      0o644
    );

    await harness.loader.loadAndInstall(JSON.stringify([conventionalPath]));
    expect(harness.registry.resolveCatalog(scope('conventional-mode'))).toEqual({
      available: true,
      catalog: expect.objectContaining({ customerId: 'conventional-mode' })
    });
  });

  it('rejects symlinks, non-regular files, oversized files, and malformed packs', async () => {
    const harness = await createHarness();
    const linkPath = join(harness.directory, 'pack-link.json');
    await symlink(harness.validPath, linkPath);
    const oversizedPath = join(harness.directory, 'oversized.json');
    await writeFile(oversizedPath, Buffer.alloc(MAX_PACK_BYTES + 1, 0x20), { mode: 0o444 });
    const malformedPath = join(harness.directory, 'malformed.json');
    await writeFile(malformedPath, '{', { mode: 0o444 });

    for (const path of [linkPath, harness.directory, oversizedPath, malformedPath]) {
      await expect(harness.loader.loadAndInstall(JSON.stringify([path]))).rejects.toThrow('CAPABILITY_PACK_INVALID');
    }
  });

  it('rejects unreadable files through the filesystem boundary', async () => {
    const registry = new CapabilityCatalogRegistry();
    const files: CapabilityPackFileAccess = {
      inspect: jest.fn(async () => ({ regular: true, symbolicLink: false, size: 100 })),
      read: jest.fn(async () => { throw new Error('machine-local-path'); })
    };
    const loader = new CapabilityPackLoader(registry, executableTools(), files);

    await expect(loader.loadAndInstall('["/packs/unreadable.json"]')).rejects.toThrow('CAPABILITY_PACK_INVALID');
    expect(registry.resolveCatalog(scope('customer-a'))).toEqual(unavailable());
  });

  it('reads each accepted file exactly once', async () => {
    const harness = await createHarness();
    const reads = new Map<string, number>();
    const files = nodeFiles((path) => reads.set(path, (reads.get(path) ?? 0) + 1));
    const loader = new CapabilityPackLoader(harness.registry, executableTools(), files);

    await loader.loadAndInstall(JSON.stringify([harness.validPath]));
    expect(reads.get(harness.validPath)).toBe(1);
  });

  it('expands HostApps, filters inactive definitions, and skips inactive packs', async () => {
    const harness = await createHarness();
    const activePath = await writePack(harness.directory, 'active.json', validPack({
      customerId: 'customer-active', hostApps: ['host-a', 'host-b'], includeInactiveDefinitions: true
    }));
    const inactivePath = await writePack(harness.directory, 'inactive.json', validPack({
      customerId: 'customer-inactive', active: false
    }));

    await harness.loader.loadAndInstall(JSON.stringify([activePath, inactivePath]));
    for (const hostApp of ['host-a', 'host-b']) {
      const result = harness.registry.resolveCatalog({ customerId: 'customer-active', integrationId: 'integration-a', hostApp });
      expect(result.available).toBe(true);
      if (!result.available) continue;
      expect(result.catalog.capabilities.map((entry) => entry.capabilityKey)).toEqual(['orders.count']);
      expect(result.catalog.bindings.map((entry) => entry.bindingId)).toEqual(['orders.monthly']);
    }
    expect(harness.registry.resolveCatalog(scope('customer-inactive'))).toEqual(unavailable());
  });

  it.each([
    ['active scope', (pack: Record<string, any>) => {
      pack.capabilities[0].capabilityKey = 'orders.other';
      pack.bindings[0].bindingId = 'orders.other';
      pack.bindings[0].capabilityKey = 'orders.other';
      return pack;
    }],
    ['scoped capability identity', (pack: Record<string, any>) => {
      pack.bindings[0].bindingId = 'orders.other';
      return pack;
    }],
    ['scoped binding identity', (pack: Record<string, any>) => {
      pack.capabilities[0].capabilityKey = 'orders.other';
      pack.bindings[0].capabilityKey = 'orders.other';
      return pack;
    }]
  ])('rejects duplicate %s across the candidate release', async (_case, secondPack) => {
    const harness = await createHarness();
    const duplicate = await writePack(harness.directory, `duplicate-${_case.replaceAll(' ', '-')}.json`, secondPack(validPack()));

    await expect(harness.loader.loadAndInstall(JSON.stringify([harness.validPath, duplicate]))).rejects.toThrow(
      'CAPABILITY_PACK_INVALID'
    );
    expect(harness.registry.resolveCatalog(scope('customer-a'))).toEqual(unavailable());
  });

  it('builds and validates the complete candidate before one atomic install', async () => {
    const harness = await createHarness();
    await harness.loader.loadAndInstall(JSON.stringify([harness.validPath]));
    const replacement = await writePack(harness.directory, 'replacement.json', validPack({ customerId: 'customer-b' }));
    const malformed = join(harness.directory, 'bad-replacement.json');
    await writeFile(malformed, '{', { mode: 0o444 });

    await expect(harness.loader.loadAndInstall(JSON.stringify([replacement, malformed]))).rejects.toThrow(
      'CAPABILITY_PACK_INVALID'
    );
    expect(harness.registry.resolveCatalog(scope('customer-a'))).toEqual({
      available: true,
      catalog: expect.objectContaining({ customerId: 'customer-a' })
    });
    expect(harness.registry.resolveCatalog(scope('customer-b'))).toEqual(unavailable());
  });

  it('accepts an empty configured path list as an empty ready registry', async () => {
    const harness = await createHarness();
    await harness.loader.loadAndInstall('[]');
    expect(harness.registry.resolveCatalog(scope('customer-a'))).toEqual(unavailable());
  });

  it('validates the exact active read-only Tool key and version without semantic inference', async () => {
    const harness = await createHarness();
    const resolveExactExecutableTool = jest.fn(async () => ({
      tool: { key: 'orders.monthly', version: '1.0.0' }
    }));
    const loader = new CapabilityPackLoader(
      harness.registry,
      { resolveExactExecutableTool } as unknown as ToolRegistryService,
      nodeFiles()
    );

    await loader.loadAndInstall(JSON.stringify([harness.validPath]));
    expect(resolveExactExecutableTool).toHaveBeenCalledTimes(1);
    expect(resolveExactExecutableTool).toHaveBeenCalledWith('orders.monthly', '1.0.0');
  });

  it.each([
    ['missing target', 'tool_not_registered'],
    ['stale version', 'tool_not_registered'],
    ['inactive target', 'tool_inactive'],
    ['write target', 'operation_denied'],
    ['side-effecting target', 'operation_denied']
  ])('rejects an exact Tool provisioning failure: %s', async (_case, deniedReason) => {
    const harness = await createHarness();
    const tools = {
      resolveExactExecutableTool: jest.fn(async () => ({ deniedReason }))
    } as unknown as ToolRegistryService;
    const loader = new CapabilityPackLoader(harness.registry, tools, nodeFiles());

    await expect(loader.loadAndInstall(JSON.stringify([harness.validPath]))).rejects.toThrow('CAPABILITY_PACK_INVALID');
    expect(harness.registry.resolveCatalog(scope('customer-a'))).toEqual(unavailable());
  });

  it('does not resolve Tool targets owned only by inactive bindings or inactive packs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'capability-pack-inactive-target-'));
    const inactiveBindingPack = validPack({ includeInactiveDefinitions: true });
    inactiveBindingPack.bindings = inactiveBindingPack.bindings.filter((entry: Record<string, unknown>) => entry.active === false);
    const inactivePack = validPack({ customerId: 'inactive-pack', active: false });
    const paths = [
      await writePack(directory, 'inactive-binding.json', inactiveBindingPack),
      await writePack(directory, 'inactive-pack.json', inactivePack)
    ];
    const resolveExactExecutableTool = jest.fn();
    const loader = new CapabilityPackLoader(
      new CapabilityCatalogRegistry(),
      { resolveExactExecutableTool } as unknown as ToolRegistryService,
      nodeFiles()
    );

    await loader.loadAndInstall(JSON.stringify(paths));
    expect(resolveExactExecutableTool).not.toHaveBeenCalled();
  });
});

async function createHarness() {
  const directory = await mkdtemp(join(tmpdir(), 'capability-pack-loader-'));
  const validPath = await writePack(directory, 'valid.json', validPack());
  const registry = new CapabilityCatalogRegistry();
  return {
    directory,
    validPath,
    registry,
    loader: new CapabilityPackLoader(registry, executableTools(), nodeFiles())
  };
}

function nodeFiles(onRead: (path: string) => void = () => undefined): CapabilityPackFileAccess {
  return {
    async inspect(path) {
      const stat = await lstat(path);
      return { regular: stat.isFile(), symbolicLink: stat.isSymbolicLink(), size: stat.size };
    },
    async read(path) {
      onRead(path);
      return new Uint8Array(await readFile(path));
    }
  };
}

async function writePack(directory: string, name: string, pack: unknown, mode = 0o444): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, JSON.stringify(pack), { mode: 0o600 });
  await chmod(path, mode);
  expect(isAbsolute(path)).toBe(true);
  return path;
}

function executableTools(): ToolRegistryService {
  return {
    resolveExactExecutableTool: jest.fn(async () => ({ tool: { key: 'orders.monthly', version: '1.0.0' } }))
  } as unknown as ToolRegistryService;
}

function scope(customerId: string) {
  return { customerId, integrationId: 'integration-a', hostApp: 'host-a' };
}

function unavailable() {
  return { available: false, reasonCode: 'NO_ACTIVE_CAPABILITY_PACK' };
}

function validPack(overrides: {
  customerId?: string;
  hostApps?: string[];
  active?: boolean;
  includeInactiveDefinitions?: boolean;
} = {}): Record<string, any> {
  const customerId = overrides.customerId ?? 'customer-a';
  const capabilities = [capability('orders.count', true)];
  const bindings = [binding('orders.monthly', true)];
  if (overrides.includeInactiveDefinitions) {
    capabilities.push(capability('orders.inactive', false));
    bindings.push(binding('orders.inactive', false));
  }
  return {
    version: '1', packId: `${customerId}.pack`, packVersion: '1.0.0', customerId,
    integrationId: 'integration-a', hostApps: overrides.hostApps ?? ['host-a'], active: overrides.active ?? true,
    capabilities, bindings
  };
}

function capability(capabilityKey: string, active: boolean) {
  return {
    version: '1', capabilityKey, active, kind: 'READ_ONLY_TOOL', safeLabel: capabilityKey,
    semanticProfiles: [{
      version: '1', locale: 'zh-TW', aliases: [`alias-${capabilityKey}`], examples: [`example-${capabilityKey}`],
      resourceTerms: [`resource-${capabilityKey}`], intentTerms: [`intent-${capabilityKey}`],
      metricTerms: [`metric-${capabilityKey}`], requiredSignalGroups: ['resource', 'metric']
    }],
    parameters: [{
      version: '1', parameterName: 'timeRange', type: 'enum', required: true, semanticTerms: ['期間'],
      values: [{ value: 'this_month', aliases: ['本月'] }]
    }]
  };
}

function binding(bindingId: string, active: boolean) {
  return {
    version: '1', bindingId, bindingVersion: '1.0.0', active, capabilityKey: 'orders.count',
    semanticConstraints: [], target: { kind: 'TOOL', toolKey: 'orders.monthly', toolVersion: '1.0.0' }, mappings: []
  };
}
