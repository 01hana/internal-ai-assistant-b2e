import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User, UserToken } from '../../generated/prisma/client';
import { UserTokenPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_CLOCK, type AdminClock } from '../common/clock';
import { FIRST_LOGIN_LINK_MS, RESET_PASSWORD_LINK_MS } from '../config/admin-settings';
import { generateSecretToken, hashSecretToken, isWellFormedSecretToken } from './secret-token';

type Db = Prisma.TransactionClient | PrismaService['db'];

const LIFETIME_MS: Record<UserTokenPurpose, number> = {
  [UserTokenPurpose.first_login]: FIRST_LOGIN_LINK_MS,
  [UserTokenPurpose.reset_password]: RESET_PASSWORD_LINK_MS
};

export type ResolvedUserToken = { token: UserToken; user: User };

/**
 * Feature 014: one-time links for setting a password (first login, 72 h) and resetting it (1 h).
 * Only the latest unused link of a purpose is valid: issuing a new one marks older ones as used.
 */
@Injectable()
export class UserTokenService {
  constructor(private readonly prisma: PrismaService, @Inject(ADMIN_CLOCK) private readonly clock: AdminClock) {}

  async issue(userId: string, purpose: UserTokenPurpose, db: Db = this.prisma.db): Promise<{ token: string; expiresAt: Date }> {
    const now = this.clock();
    await this.invalidate(userId, purpose, db);
    const token = generateSecretToken();
    const expiresAt = new Date(now.getTime() + LIFETIME_MS[purpose]);
    await db.userToken.create({ data: { userId, purpose, tokenHash: hashSecretToken(token), expiresAt, createdAt: now } });
    return { token, expiresAt };
  }

  async invalidate(userId: string, purpose: UserTokenPurpose, db: Db = this.prisma.db): Promise<void> {
    await db.userToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: this.clock() } });
  }

  /**
   * A link is usable when it exists, is unused and unexpired, matches the purpose, and its user is
   * active and in the right state: first-login links only before a password is set, reset links only after.
   */
  async resolve(rawToken: unknown, purpose?: UserTokenPurpose, db: Db = this.prisma.db): Promise<ResolvedUserToken | null> {
    if (!isWellFormedSecretToken(rawToken)) return null;
    const token = await db.userToken.findUnique({ where: { tokenHash: hashSecretToken(rawToken) }, include: { user: true } });
    if (!token || token.usedAt || token.expiresAt <= this.clock()) return null;
    if (purpose && token.purpose !== purpose) return null;
    const { user, ...record } = token;
    if (!user.status) return null;
    if (token.purpose === UserTokenPurpose.first_login && user.passwordHash !== null) return null;
    if (token.purpose === UserTokenPurpose.reset_password && user.passwordHash === null) return null;
    return { token: record, user };
  }

  /** Marks the link used; returns false if another request used it first. */
  async consume(tokenId: string, db: Db = this.prisma.db): Promise<boolean> {
    const { count } = await db.userToken.updateMany({ where: { id: tokenId, usedAt: null }, data: { usedAt: this.clock() } });
    return count === 1;
  }

  async latestIssuedAt(userId: string, purpose: UserTokenPurpose, db: Db = this.prisma.db): Promise<Date | null> {
    const latest = await db.userToken.findFirst({ where: { userId, purpose }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
    return latest?.createdAt ?? null;
  }
}
