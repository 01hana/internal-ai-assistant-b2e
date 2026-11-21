import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { UserTokenPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserAuditService } from '../audit/user-audit.service';
import { adminRules, type AdminRule, isDeveloper } from '../authorization/admin-ability.factory';
import { ADMIN_CLOCK, type AdminClock } from '../common/clock';
import type { AdminPrincipal } from '../common/admin-request';
import type { RequestMeta } from '../common/request-meta';
import { LOGIN_LOCK_MS, LOGIN_LOCK_THRESHOLD, RESET_PASSWORD_THROTTLE_MS } from '../config/admin-settings';
import { AdminMailService } from '../mail/admin-mail.service';
import { toUserView, type UserView } from '../users/user-view';
import { checkPasswordRules, hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyAgainstDummy, verifyPassword } from './password-hasher';
import { generateSecretToken } from './secret-token';
import { type SessionUser, UserSessionService } from './user-session.service';
import { UserTokenService } from './user-token.service';

/** `permissions` are CASL rules (`[{ action, subject }]`) for the website's ability. */
export type ProfileView = { user: UserView; permissions: AdminRule[] };
export type LoginResult = ProfileView & { sessionToken: string; csrfToken: string };

const INVALID_CREDENTIALS = { error: 'invalid_credentials', message: '帳號或密碼錯誤。' };
const INVALID_LINK = { error: 'invalid_or_expired_link', message: '連結無效或已過期。' };

/** Feature 014 US2: login, logout, profile and the mail-link password flows. */
@Injectable()
export class AdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: UserSessionService,
    private readonly tokens: UserTokenService,
    private readonly mail: AdminMailService,
    private readonly audit: UserAuditService,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock
  ) {}

  async login(rawAccount: string, password: string, meta: RequestMeta): Promise<LoginResult> {
    const account = normalize(rawAccount);

    const user = await this.prisma.db.user.findUnique({ where: { account }, include: { groups: true } });
    const now = this.clock();
    const fail = async (reason: string): Promise<never> => {
      await this.audit.record({ eventType: 'admin_login_failed', meta, metadata: { accountHash: shortHash(account), reason } });
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    };

    if (!user || !user.status || user.passwordHash === null) {
      await verifyAgainstDummy(password);
      return fail(!user ? 'unknown_account' : !user.status ? 'disabled' : 'password_not_set');
    }
    if (user.lockedUntil && user.lockedUntil > now) {
      await verifyAgainstDummy(password);
      return fail('locked');
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      const failures = user.failedLoginCount + 1;
      const locks = failures >= LOGIN_LOCK_THRESHOLD;
      await this.prisma.db.user.update({
        where: { id: user.id },
        data: locks ? { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOGIN_LOCK_MS) } : { failedLoginCount: failures }
      });
      return fail(locks ? 'wrong_password_locked' : 'wrong_password');
    }

    const updated = await this.prisma.db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
      include: { groups: true }
    });
    const { token } = await this.sessions.create(user.id, meta);
    await this.audit.record({ eventType: 'admin_login_succeeded', meta, actor: actorOf(updated), target: targetOf(updated) });
    return { ...this.profile(updated), sessionToken: token, csrfToken: generateSecretToken() };
  }

  async logout(principal: AdminPrincipal, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(principal.session.id);
    await this.audit.record({ eventType: 'admin_logout', meta, actor: actorOf(principal.user), target: targetOf(principal.user) });
  }

  profile(user: SessionUser): ProfileView {
    return { user: toUserView(user), permissions: adminRules(user.groups) };
  }

  async verifyToken(token: string, meta: RequestMeta): Promise<{ account: string; purpose: UserTokenPurpose }> {
    const resolved = await this.tokens.resolve(token);
    if (!resolved) throw new BadRequestException(INVALID_LINK);
    return { account: resolved.user.account, purpose: resolved.token.purpose };
  }

  /** First login and reset share the flow; only the link purpose and the audit event differ. */
  async setPassword(purpose: UserTokenPurpose, token: string, password: string, meta: RequestMeta): Promise<void> {
    const resolved = await this.tokens.resolve(token, purpose);
    if (!resolved) throw new BadRequestException(INVALID_LINK);
    const violation = checkPasswordRules(password, resolved.user.account);
    if (violation) throw new BadRequestException({ error: violation, message: passwordRuleMessage(violation) });

    const passwordHash = await hashPassword(password);
    const now = this.clock();
    await this.prisma.db.$transaction(async (tx) => {
      if (!(await this.tokens.consume(resolved.token.id, tx))) throw new BadRequestException(INVALID_LINK);
      await tx.user.update({
        where: { id: resolved.user.id },
        data: { passwordHash, passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null }
      });
      await this.tokens.invalidate(resolved.user.id, purpose, tx);
      if (purpose === UserTokenPurpose.reset_password) await this.sessions.revokeAllForUser(resolved.user.id, tx);
      const user = await tx.user.findUniqueOrThrow({ where: { id: resolved.user.id }, include: { groups: true } });
      await this.audit.record({
        eventType: purpose === UserTokenPurpose.first_login ? 'admin_password_set' : 'admin_password_reset',
        meta, actor: actorOf(user), target: targetOf(user)
      }, tx);
    });
  }

  /**
   * A signed-in user changes their own password: the current one must match, the new one follows the
   * rules and differs from it. Other sessions are signed out and outstanding reset links stop working;
   * this session stays.
   */
  async changePassword(principal: AdminPrincipal, currentPassword: string, newPassword: string, meta: RequestMeta): Promise<void> {
    const { user, session } = principal;
    if (user.passwordHash === null || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new BadRequestException({ error: 'current_password_incorrect', message: '目前的密碼不正確。' });
    }
    if (newPassword === currentPassword) throw new BadRequestException({ error: 'password_unchanged', message: '新密碼不可與目前的密碼相同。' });
    const violation = checkPasswordRules(newPassword, user.account);
    if (violation) throw new BadRequestException({ error: violation, message: passwordRuleMessage(violation) });

    const passwordHash = await hashPassword(newPassword);
    await this.prisma.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, passwordChangedAt: this.clock(), failedLoginCount: 0, lockedUntil: null } });
      await this.tokens.invalidate(user.id, UserTokenPurpose.reset_password, tx);
      await this.sessions.revokeOthers(user.id, session.id, tx);
      await this.audit.record({ eventType: 'admin_password_changed', meta, actor: actorOf(user), target: targetOf(user) }, tx);
    });
  }

  /**
   * Always answers the same way, whether or not the email exists. Mail goes out only for active users
   * who have set a password, at most once per 15 minutes, and is sent without awaiting so the response
   * time does not reveal whether the email exists.
   */
  async forgotPassword(rawEmail: string, meta: RequestMeta): Promise<void> {
    const email = normalize(rawEmail);
    const user = await this.prisma.db.user.findUnique({ where: { email }, include: { groups: true } });
    const eligible = user && user.status && user.passwordHash !== null;
    if (!user || !eligible) {
      await this.audit.record({ eventType: 'admin_password_reset_requested', meta, metadata: { matched: false } });
      return;
    }
    const lastIssued = await this.tokens.latestIssuedAt(user.id, UserTokenPurpose.reset_password);
    if (lastIssued && this.clock().getTime() - lastIssued.getTime() < RESET_PASSWORD_THROTTLE_MS) {
      await this.audit.record({ eventType: 'admin_password_reset_requested', meta, target: targetOf(user), metadata: { matched: true, throttled: true } });
      return;
    }
    const { token, expiresAt } = await this.tokens.issue(user.id, UserTokenPurpose.reset_password);
    await this.audit.record({ eventType: 'admin_password_reset_requested', meta, target: targetOf(user), metadata: { matched: true, throttled: false } });
    void this.mail.sendPasswordReset(user, token, expiresAt);
  }
}

export function actorOf(user: SessionUser): { id: string; account: string; isDeveloper: boolean } {
  return { id: user.id, account: user.account, isDeveloper: isDeveloper(user.groups) };
}

export function targetOf(user: SessionUser): { type: 'User'; id: string; isDeveloper: boolean } {
  return { type: 'User', id: user.id, isDeveloper: isDeveloper(user.groups) };
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function shortHash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 12);
}

function passwordRuleMessage(violation: string): string {
  if (violation === 'password_too_short') return `密碼至少需要 ${PASSWORD_MIN_LENGTH} 個字元。`;
  if (violation === 'password_too_long') return `密碼最多 ${PASSWORD_MAX_LENGTH} 個字元。`;
  return '密碼不可與帳號相同。';
}
