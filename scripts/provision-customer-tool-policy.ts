import 'dotenv/config';
import { createPrismaClient } from '../src/prisma/prisma-client.factory';
import {
  ProvisionCustomerToolPolicyCommand,
  type ProvisionCustomerToolPolicyInput
} from '../src/tools/provision-customer-tool-policy.command';

const SCALAR_FLAGS = new Map([
  ['--customer', 'customerId'],
  ['--tool', 'toolKey'],
  ['--version', 'version'],
  ['--enabled', 'enabled']
] as const);
const ARRAY_FLAGS = new Map([
  ['--required-role', 'requiredRoles'],
  ['--required-permission-scope', 'requiredPermissionScopes']
] as const);

export function parseProvisionCustomerToolPolicyArguments(argv: readonly string[]): ProvisionCustomerToolPolicyInput {
  const scalars = new Map<string, string>();
  const arrays = new Map<string, string[]>([
    ['requiredRoles', []],
    ['requiredPermissionScopes', []]
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag || value === undefined || value.startsWith('--')) invalid();
    const scalarKey = SCALAR_FLAGS.get(flag as never);
    if (scalarKey) {
      if (scalars.has(scalarKey)) invalid();
      scalars.set(scalarKey, value);
      continue;
    }
    const arrayKey = ARRAY_FLAGS.get(flag as never);
    if (!arrayKey) invalid();
    arrays.get(arrayKey)!.push(value);
  }
  const enabled = scalars.get('enabled');
  if (enabled !== 'true' && enabled !== 'false') invalid();
  return {
    customerId: required(scalars, 'customerId'),
    toolKey: required(scalars, 'toolKey'),
    version: required(scalars, 'version'),
    enabled: enabled === 'true',
    requiredRoles: arrays.get('requiredRoles')!,
    requiredPermissionScopes: arrays.get('requiredPermissionScopes')!
  };
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) invalid();
  const prisma = createPrismaClient(databaseUrl);
  try {
    const command = new ProvisionCustomerToolPolicyCommand(prisma);
    const provisioned = await command.execute(parseProvisionCustomerToolPolicyArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(provisioned)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

function required(values: Map<string, string>, key: string): string {
  return values.get(key) ?? invalid();
}

function invalid(): never {
  throw new Error('Usage: provision-customer-tool-policy --customer <id> --tool <key> --version <semver> --enabled <true|false> [--required-role <role>] [--required-permission-scope <scope>]');
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Customer tool policy provisioning failed.'}\n`);
    process.exitCode = 1;
  });
}
