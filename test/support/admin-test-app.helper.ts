import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');
import { configureAdminApp } from '../../src/admin/admin-app.setup';
import { AdminModule } from '../../src/admin/admin.module';
import { hashPassword } from '../../src/admin/auth/password-hasher';
import { ADMIN_CLOCK } from '../../src/admin/common/clock';
import { ADMIN_MAIL_TRANSPORT, type AdminMailMessage, type AdminMailTransport } from '../../src/admin/mail/admin-mail.transport';
import { SYSTEM_GROUP_CODES, SYSTEM_GROUPS } from '../../src/admin/permissions';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createUs1DbClient } from './us1-db-test.helper';

/**
 * Feature 014: the admin API against the test database (`assistant_test`). Enabled with
 * RUN_DB_BACKED_ADMIN_TESTS=true. Each test gets a fresh app (fresh rate limiter), a controllable
 * clock and a recording mail transport.
 */
export const describeDbBackedAdmin = process.env.RUN_DB_BACKED_ADMIN_TESTS === 'true' ? describe : describe.skip;

export const ADMIN_TEST_ORIGIN = 'https://admin.example.test';
export const ADMIN_TEST_CUSTOMER = 'customer-admin-f014-test';

export class TestClock {
  private current = new Date('2026-11-18T02:00:00.000Z');
  readonly now = () => new Date(this.current.getTime());
  advance(ms: number) { this.current = new Date(this.current.getTime() + ms); }
}

export class RecordingMail implements AdminMailTransport {
  readonly sent: AdminMailMessage[] = [];
  async send(message: AdminMailMessage) { this.sent.push(message); }
  /** The token in the most recent link sent to `email`. */
  lastToken(email: string): string | undefined {
    const message = [...this.sent].reverse().find((entry) => entry.to === email);
    return message?.text.match(/[?&]token=([A-Za-z0-9_-]{43})/)?.[1];
  }
}

export type AdminTestContext = { app: INestApplication; db: PrismaClient; clock: TestClock; mail: RecordingMail; releaseLock: () => Promise<void> };

/** Any constant; identifies the lock shared by all admin DB tests. */
const ADMIN_DB_TEST_LOCK = 14_014;

/**
 * Admin DB tests all reset the same tables, so test files must not run them at the same time (Jest runs
 * files in parallel). A PostgreSQL advisory lock serialises them across workers: it is held by an
 * interactive transaction on its own connection and released when the transaction ends — also when
 * a test crashes.
 */
async function acquireAdminDbLock(): Promise<() => Promise<void>> {
  const lockClient = createUs1DbClient();
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let acquired!: () => void;
  const locked = new Promise<void>((resolve) => { acquired = resolve; });
  const holder = lockClient.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_DB_TEST_LOCK})`;
    acquired();
    await released;
  }, { maxWait: 10 * 60_000, timeout: 10 * 60_000 });
  await Promise.race([locked, holder]);
  return async () => {
    release();
    await holder.finally(() => lockClient.$disconnect());
  };
}

/**
 * Points the admin API at the test database and makes sure the configured customer exists — the
 * admin API refuses to start without it (AdminCustomerCheck), so this must run before the app starts.
 */
export async function configureAdminTestEnvironment(): Promise<void> {
  const db = createUs1DbClient(); // loads .env.test and checks it is a test database
  try {
    await db.customer.upsert({ where: { id: ADMIN_TEST_CUSTOMER }, create: { id: ADMIN_TEST_CUSTOMER }, update: {} });
  } finally {
    await db.$disconnect();
  }
  Object.assign(process.env, {
    ADMIN_WEB_ORIGIN: ADMIN_TEST_ORIGIN,
    ADMIN_CUSTOMER_ID: ADMIN_TEST_CUSTOMER,
    ADMIN_COOKIE_SECURE: 'false',
    ADMIN_MAIL_TRANSPORT: 'log'
  });
}

export async function createAdminTestApp(): Promise<AdminTestContext> {
  const releaseLock = await acquireAdminDbLock();
  try {
    await configureAdminTestEnvironment();
    const clock = new TestClock();
    const mail = new RecordingMail();
    const moduleRef = await Test.createTestingModule({ imports: [AdminModule] })
      .overrideProvider(ADMIN_CLOCK).useValue(clock.now)
      .overrideProvider(ADMIN_MAIL_TRANSPORT).useValue(mail)
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    configureAdminApp(app);
    await app.init();
    return { app, db: app.get(PrismaService).db, clock, mail, releaseLock };
  } catch (error) {
    await releaseLock();
    throw error;
  }
}

export async function closeAdminTestApp(ctx: AdminTestContext | undefined): Promise<void> {
  if (!ctx) return;
  try {
    await ctx.app.close();
  } finally {
    await ctx.releaseLock();
  }
}

/** Removes every back-office row and recreates the two built-in groups. */
export async function resetAdminTables(db: PrismaClient): Promise<void> {
  await db.userAuditEvent.deleteMany({});
  await db.userSession.deleteMany({});
  await db.userToken.deleteMany({});
  await db.user.deleteMany({});
  await db.userGroup.deleteMany({});
  for (const code of SYSTEM_GROUP_CODES) {
    await db.userGroup.create({ data: { code, name: SYSTEM_GROUPS[code].name, isSystem: true } });
  }
}

export async function seedUser(db: PrismaClient, input: {
  account: string; password?: string | null; groups?: string[]; status?: boolean; email?: string; name?: string;
}) {
  const groups = await db.userGroup.findMany({ where: { OR: [{ code: { in: input.groups ?? [] } }, { name: { in: input.groups ?? [] } }] } });
  return db.user.create({
    data: {
      account: input.account,
      name: input.name ?? input.account,
      email: input.email ?? `${input.account}@example.test`,
      status: input.status ?? true,
      passwordHash: input.password === null ? null : await hashPassword(input.password ?? 'correct horse battery'),
      groups: { connect: groups.map((group) => ({ id: group.id })) }
    },
    include: { groups: true }
  });
}

export type Signed = { cookie: string; csrf: string };

export const api = (app: INestApplication) => request(app.getHttpServer());

/** POST/PUT/PATCH/DELETE from the admin website. */
export function fromSite<T extends request.Test>(test: T, signed?: Signed): T {
  test.set('Origin', ADMIN_TEST_ORIGIN);
  if (signed) test.set('Cookie', signed.cookie).set('X-CSRF-Token', signed.csrf);
  return test;
}

export function cookiesOf(response: request.Response): Record<string, { value: string; raw: string }> {
  const header = response.headers['set-cookie'] as unknown as string[] | undefined;
  return Object.fromEntries((header ?? []).map((raw) => {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    return [pair.slice(0, index), { value: decodeURIComponent(pair.slice(index + 1)), raw }];
  }));
}

export async function signIn(app: INestApplication, account: string, password = 'correct horse battery'): Promise<Signed & { response: request.Response }> {
  const response = await fromSite(api(app).post('/api/v1/admin/auth/login')).send({ account, password });
  if (response.status !== 200) throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`);
  const cookies = cookiesOf(response);
  return {
    response,
    cookie: `admin_session=${cookies.admin_session.value}; admin_csrf=${cookies.admin_csrf.value}`,
    csrf: cookies.admin_csrf.value
  };
}

/** Lets fire-and-forget work (e.g. the reset mail) finish. */
export const flush = () => new Promise((resolve) => setImmediate(resolve));

export const INTERNAL_USER_FIELDS = ['passwordHash', 'failedLoginCount', 'lockedUntil', 'passwordChangedAt', 'tokenHash'];
