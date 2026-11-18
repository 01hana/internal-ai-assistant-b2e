import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, User, UserGroup, UserSession } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ADMIN_CLOCK, type AdminClock } from '../common/clock';
import type { RequestMeta } from '../common/request-meta';
import { ADMIN_SESSION_ABSOLUTE_MS, ADMIN_SESSION_IDLE_MS, ADMIN_SESSION_TOUCH_INTERVAL_MS } from '../config/admin-settings';
import { generateSecretToken, hashSecretToken, isWellFormedSecretToken } from './secret-token';

type Db = Prisma.TransactionClient | PrismaService['db'];
export type SessionUser = User & { groups: UserGroup[] };
export type ValidSession = { session: UserSession; user: SessionUser };

/**
 * Feature 014: server-side login sessions. The cookie holds a random token; the database holds only
 * its hash, so logout, disabling a user and password resets take effect on the next request.
 */
@Injectable()
export class UserSessionService {
  constructor(private readonly prisma: PrismaService, @Inject(ADMIN_CLOCK) private readonly clock: AdminClock) {}

  async create(userId: string, meta: RequestMeta, db: Db = this.prisma.db): Promise<{ token: string; session: UserSession }> {
    const now = this.clock();
    const token = generateSecretToken();
    const session = await db.userSession.create({
      data: {
        userId,
        tokenHash: hashSecretToken(token),
        createdAt: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + ADMIN_SESSION_ABSOLUTE_MS),
        ipSummary: meta.ipSummary,
        userAgentSummary: meta.userAgentSummary
      }
    });
    return { token, session };
  }

  /** Valid = exists, not revoked, within both the idle and the absolute limit, user active. */
  async validate(rawToken: unknown): Promise<ValidSession | null> {
    if (!isWellFormedSecretToken(rawToken)) return null;
    const found = await this.prisma.db.userSession.findUnique({
      where: { tokenHash: hashSecretToken(rawToken) },
      include: { user: { include: { groups: true } } }
    });
    if (!found) return null;
    const now = this.clock();
    if (!isSessionAlive(found, now) || !found.user.status) return null;

    const { user, ...session } = found;
    if (now.getTime() - session.lastSeenAt.getTime() >= ADMIN_SESSION_TOUCH_INTERVAL_MS) {
      await this.prisma.db.userSession.update({ where: { id: session.id }, data: { lastSeenAt: now } });
      session.lastSeenAt = now;
    }
    return { session, user };
  }

  async revoke(sessionId: string, db: Db = this.prisma.db): Promise<void> {
    await db.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: this.clock() } });
  }

  async revokeAllForUser(userId: string, db: Db = this.prisma.db): Promise<void> {
    await db.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: this.clock() } });
  }
}

export function isSessionAlive(session: Pick<UserSession, 'revokedAt' | 'lastSeenAt' | 'expiresAt'>, now: Date): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= now.getTime()) return false;
  return now.getTime() - session.lastSeenAt.getTime() < ADMIN_SESSION_IDLE_MS;
}
