import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { UserTokenPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminModule } from '../admin.module';
import { UserAuditService } from '../audit/user-audit.service';
import { UserTokenService } from '../auth/user-token.service';
import { AdminSettings } from '../config/admin-settings';
import { AdminMailService } from '../mail/admin-mail.service';
import { DEVELOPER_GROUP_CODE, SYSTEM_GROUP_CODES, SYSTEM_GROUPS } from '../permissions';

/**
 * Feature 014 US1: creates the first developer account of a deployment. Runs only while there are no
 * back-office users. Usage (compiled into the Core image):
 *   node dist/src/admin/bootstrap/admin-bootstrap.cli.js --account <account> --name <name> --email <email>
 * The first-login link is mailed and also printed once to stdout (the operator is that developer).
 */
export type AdminBootstrapArguments = { account: string; name: string; email: string };

const USAGE = 'Usage: --account <account> --name <name> --email <email>';
const ACCOUNT_PATTERN = /^[a-z0-9._-]{3,64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseAdminBootstrapArguments(argv: readonly string[]): AdminBootstrapArguments {
  let values: { account?: string; name?: string; email?: string };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { account: { type: 'string' }, name: { type: 'string' }, email: { type: 'string' } },
      strict: true,
      allowPositionals: false
    }));
  } catch {
    throw new Error(USAGE);
  }
  const account = values.account?.trim().toLowerCase();
  const name = values.name?.trim();
  const email = values.email?.trim().toLowerCase();
  if (!account || !name || !email) throw new Error(USAGE);
  if (!ACCOUNT_PATTERN.test(account)) throw new Error('Account must be 3–64 characters: letters, digits, ".", "_" or "-".');
  if (!EMAIL_PATTERN.test(email) || email.length > 254) throw new Error('Email is not valid.');
  if (name.length > 100) throw new Error('Name must be at most 100 characters.');
  return { account, name, email };
}

export class AdminBootstrapRefused extends Error {}

export async function runAdminBootstrap(argv: readonly string[], output: (line: string) => void = (line) => process.stdout.write(`${line}\n`)): Promise<number> {
  const args = parseAdminBootstrapArguments(argv);
  const app = await NestFactory.createApplicationContext(AdminModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const tokens = app.get(UserTokenService);
    const audit = app.get(UserAuditService);
    const meta = { requestId: `admin-bootstrap-${randomUUID()}`, ipSummary: null, userAgentSummary: 'admin:bootstrap' };

    const created = await prisma.db.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) throw new AdminBootstrapRefused('Back-office users already exist; add further developers from the admin website.');
      for (const code of SYSTEM_GROUP_CODES) {
        await tx.userGroup.upsert({
          where: { code },
          create: { code, name: SYSTEM_GROUPS[code].name, isSystem: true },
          update: {}
        });
      }
      const user = await tx.user.create({
        data: { account: args.account, name: args.name, email: args.email, groups: { connect: { code: DEVELOPER_GROUP_CODE } } }
      });
      const link = await tokens.issue(user.id, UserTokenPurpose.first_login, tx);
      return { user, link };
    });

    const delivered = await app.get(AdminMailService).sendInvitation(created.user, created.link.token, created.link.expiresAt);
    await audit.record({
      eventType: 'admin_bootstrap',
      meta,
      actor: null,
      target: { type: 'User', id: created.user.id, isDeveloper: true },
      metadata: { account: created.user.account, inviteSent: delivered }
    });
    output(`Created developer account "${created.user.account}". Invitation mail ${delivered ? 'sent' : 'NOT sent'} to ${created.user.email}.`);
    output(`First-login link (valid until ${created.link.expiresAt.toISOString()}, single use):`);
    output(app.get(AdminSettings).linkUrl('/auth/firstLogin', created.link.token));
    return 0;
  } catch (error) {
    if (!(error instanceof AdminBootstrapRefused)) throw error;
    process.stderr.write(`${error.message}\n`);
    return 1;
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runAdminBootstrap(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : 'ADMIN_BOOTSTRAP_FAILED'}\n`);
      process.exitCode = 1;
    });
}
