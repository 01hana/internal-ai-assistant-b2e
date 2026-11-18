import type { User, UserGroup } from '../../generated/prisma/client';

/**
 * The only shape in which a back-office user leaves the API (spec FR-011): password hash, lockout
 * counters and password timestamps are never included.
 */
export type UserView = {
  id: string;
  account: string;
  name: string;
  email: string;
  status: boolean;
  invitationPending: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  groups: Array<{ id: string; name: string; code: string | null }>;
};

export function toUserView(user: User & { groups: UserGroup[] }): UserView {
  return {
    id: user.id,
    account: user.account,
    name: user.name,
    email: user.email,
    status: user.status,
    invitationPending: user.passwordHash === null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
    groups: user.groups.map((group) => ({ id: group.id, name: group.name, code: group.code }))
  };
}
