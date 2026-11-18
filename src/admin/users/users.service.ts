import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { accessibleBy } from '@casl/prisma/runtime';
import { type Prisma, type UserGroup, UserTokenPurpose } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UserAuditService } from '../audit/user-audit.service';
import { actorOf, targetOf } from '../auth/admin-auth.service';
import { type SessionUser, UserSessionService } from '../auth/user-session.service';
import { UserTokenService } from '../auth/user-token.service';
import type { AdminPrincipal } from '../common/admin-request';
import { type IdsDto, uniqueIds } from '../common/ids.dto';
import { isUniqueViolation } from '../common/prisma-errors';
import type { RequestMeta } from '../common/request-meta';
import { keywordWhere, orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { GroupsService } from '../groups/groups.service';
import { AdminMailService } from '../mail/admin-mail.service';
import { ADMIN_GROUP_CODE, type AdminAbilityAction, DEVELOPER_GROUP_CODE } from '../permissions';
import { assertAdminRemains, assertKeepsOwnSystemGroups, assertNotSelf, isActiveAdmin } from './user-policy';
import { toUserView, type UserView } from './user-view';
import type { BatchStatusDto, CreateUserDto, UpdateUserDto, UserTableFiltersDto, UserTableQueryDto } from './users.dto';

type Db = Prisma.TransactionClient | PrismaService['db'];

const WITH_GROUPS = { groups: true } as const;
const SORTABLE = ['account', 'name', 'lastLoginAt', 'createdAt'] as const;
const STATUS_OPTIONS = [{ value: true, label: '啟用' }, { value: false, label: '停用' }];
const USER_NOT_FOUND = { error: 'user_not_found', message: '找不到使用者。' };
const ACTIVE_ADMIN: Prisma.UserWhereInput = { status: true, groups: { some: { code: ADMIN_GROUP_CODE }, none: { code: DEVELOPER_GROUP_CODE } } };

/**
 * Feature 014 US4: back-office users. Visibility comes from the caller's CASL ability (non-developers
 * never see developer accounts, which then behave as missing: 404). Protection rules live in
 * user-policy.ts; every change is audited; users leave only through toUserView (FR-011).
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: UserTokenService,
    private readonly sessions: UserSessionService,
    private readonly mail: AdminMailService,
    private readonly audit: UserAuditService,
    private readonly groups: GroupsService
  ) {}

  async table(principal: AdminPrincipal, query: UserTableQueryDto): Promise<TablePage<UserView>> {
    const where: Prisma.UserWhereInput = {
      AND: [this.visible(principal), keywordWhere(query.keyword, ['account', 'name', 'email']), filtersWhere(query.filters)]
    };
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.user.findMany({ where, include: WITH_GROUPS, orderBy: orderByOf(query.sort, SORTABLE, { createdAt: 'desc' }), ...pageArgs(query) }),
      this.prisma.db.user.count({ where })
    ]);
    return { items: rows.map(toUserView), total };
  }

  async filters(principal: AdminPrincipal) {
    const groups = await this.groups.options(principal);
    return { groups: groups.map((group) => ({ value: group.id, label: group.label })), status: STATUS_OPTIONS };
  }

  async get(principal: AdminPrincipal, id: string): Promise<UserView> {
    return toUserView(await this.findVisible(principal, id));
  }

  /** Creates the user without a password and mails the first-login link (US4-1). */
  async create(principal: AdminPrincipal, input: CreateUserDto, meta: RequestMeta): Promise<{ user: UserView; inviteSent: boolean }> {
    const groups = await this.assignableGroups(principal, input.groupIds);
    const { user, link } = await uniqueOrConflict(() => this.prisma.db.$transaction(async (tx) => {
      await assertAvailable(tx, { account: input.account, email: input.email });
      const created = await tx.user.create({
        data: { account: input.account, name: input.name, email: input.email, groups: { connect: groups.map(({ id }) => ({ id })) } },
        include: WITH_GROUPS
      });
      return { user: created, link: await this.tokens.issue(created.id, UserTokenPurpose.first_login, tx) };
    }));
    // Mail after the commit: a failed delivery keeps the user (inviteSent: false), the admin can resend.
    const inviteSent = await this.mail.sendInvitation(user, link.token, link.expiresAt);
    await this.audit.record({
      eventType: 'admin_user_created', meta, actor: actorOf(principal.user), target: targetOf(user),
      metadata: { account: user.account, name: user.name, email: user.email, groups: groupsOf(user.groups), inviteSent }
    });
    return { user: toUserView(user), inviteSent };
  }

  /** Name and groups; the email only while the invitation is pending, unless the caller is a developer (US4-2, US4-3). */
  async update(principal: AdminPrincipal, id: string, input: UpdateUserDto, meta: RequestMeta): Promise<UserView> {
    const current = await this.findVisible(principal, id, 'update');
    const groups = input.groupIds === undefined ? undefined : await this.assignableGroups(principal, input.groupIds);
    const activated = current.passwordHash !== null;
    const emailChanged = input.email !== undefined && input.email !== current.email;
    if (emailChanged && activated && !principal.isDeveloper) {
      throw new BadRequestException({ error: 'email_locked', message: '使用者啟用後 email 不可修改，請聯絡開發工程師處理。' });
    }
    if (groups && current.id === principal.user.id) assertKeepsOwnSystemGroups(current.groups, groups);

    const updated = await uniqueOrConflict(() => this.prisma.db.$transaction(async (tx) => {
      if (emailChanged) await assertAvailable(tx, { email: input.email }, id);
      if (groups && isActiveAdmin(current) && !isActiveAdmin({ ...current, groups })) {
        assertAdminRemains([current], await countActiveAdmins(tx, [id]));
      }
      const user = await tx.user.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(emailChanged ? { email: input.email } : {}),
          ...(groups ? { groups: { set: groups.map((group) => ({ id: group.id })) } } : {})
        },
        include: WITH_GROUPS
      });
      if (emailChanged) await this.retireLinks(tx, id, activated);
      await this.recordUpdate(tx, principal, meta, current, user, { emailChanged, activated, groupsChanged: groups !== undefined });
      return user;
    }));
    return toUserView(updated);
  }

  /** All or nothing; disabling revokes the users' sessions at once (US4-8). */
  async setStatus(principal: AdminPrincipal, input: BatchStatusDto, meta: RequestMeta): Promise<{ updated: number }> {
    const ids = uniqueIds(input.ids);
    const users = await this.findAllVisible(principal, ids, 'update');
    if (!input.status) assertNotSelf(principal.user.id, ids, 'disable');
    const changing = users.filter((user) => user.status !== input.status);
    const changingIds = changing.map((user) => user.id);

    await this.prisma.db.$transaction(async (tx) => {
      if (!input.status) assertAdminRemains(changing.filter(isActiveAdmin), await countActiveAdmins(tx, changingIds));
      await tx.user.updateMany({ where: { id: { in: changingIds } }, data: { status: input.status } });
      for (const user of changing) {
        if (!input.status) await this.sessions.revokeAllForUser(user.id, tx);
        await this.audit.record({
          eventType: input.status ? 'admin_user_enabled' : 'admin_user_disabled', meta, actor: actorOf(principal.user),
          target: targetOf(user), metadata: { account: user.account }
        }, tx);
      }
    });
    return { updated: changing.length };
  }

  /** Only before the password is set: the old link stops working and a new one is mailed (US4-9). */
  async resendInvite(principal: AdminPrincipal, id: string, meta: RequestMeta): Promise<{ inviteSent: boolean }> {
    const user = await this.findVisible(principal, id, 'update');
    if (user.passwordHash !== null) {
      throw new BadRequestException({ error: 'already_activated', message: '使用者已設定密碼，請使用者自行使用「忘記密碼」。' });
    }
    if (!user.status) throw new BadRequestException({ error: 'user_disabled', message: '使用者已停用，請先啟用再重寄邀請信。' });
    const link = await this.tokens.issue(user.id, UserTokenPurpose.first_login);
    const inviteSent = await this.mail.sendInvitation(user, link.token, link.expiresAt);
    await this.audit.record({
      eventType: 'admin_user_invite_resent', meta, actor: actorOf(principal.user), target: targetOf(user), metadata: { account: user.account, inviteSent }
    });
    return { inviteSent };
  }

  /** All or nothing. Sessions, links and group memberships go with the user; audit events keep a snapshot (US4-10). */
  async remove(principal: AdminPrincipal, input: IdsDto, meta: RequestMeta): Promise<{ deleted: number }> {
    const ids = uniqueIds(input.ids);
    const users = await this.findAllVisible(principal, ids, 'delete');
    assertNotSelf(principal.user.id, ids, 'delete');

    await this.prisma.db.$transaction(async (tx) => {
      assertAdminRemains(users.filter(isActiveAdmin), await countActiveAdmins(tx, ids));
      await tx.user.deleteMany({ where: { id: { in: ids } } });
      for (const user of users) {
        await this.audit.record({
          eventType: 'admin_user_deleted', meta, actor: actorOf(principal.user), target: targetOf(user),
          metadata: { account: user.account, name: user.name, email: user.email, groups: groupsOf(user.groups) }
        }, tx);
      }
    });
    return { deleted: ids.length };
  }

  /**
   * A changed email invalidates the links sent to the old address. For an activated user (developers
   * only) it also signs them out, since the address is what password resets are sent to.
   */
  private async retireLinks(tx: Prisma.TransactionClient, userId: string, activated: boolean): Promise<void> {
    await this.tokens.invalidate(userId, UserTokenPurpose.first_login, tx);
    if (!activated) return;
    await this.tokens.invalidate(userId, UserTokenPurpose.reset_password, tx);
    await this.sessions.revokeAllForUser(userId, tx);
  }

  private async recordUpdate(
    tx: Prisma.TransactionClient, principal: AdminPrincipal, meta: RequestMeta, before: SessionUser, after: SessionUser,
    change: { emailChanged: boolean; activated: boolean; groupsChanged: boolean }
  ): Promise<void> {
    const base = { meta, actor: actorOf(principal.user), target: targetOf(after) };
    const pendingEmailChanged = change.emailChanged && !change.activated;
    if (before.name !== after.name || pendingEmailChanged) {
      await this.audit.record({
        ...base, eventType: 'admin_user_updated',
        metadata: { account: after.account, before: { name: before.name, email: before.email }, after: { name: after.name, email: after.email } }
      }, tx);
    }
    if (change.emailChanged && change.activated) {
      await this.audit.record({ ...base, eventType: 'admin_user_email_changed', metadata: { account: after.account, before: before.email, after: after.email } }, tx);
    }
    if (change.groupsChanged && !sameGroups(before.groups, after.groups)) {
      await this.audit.record({
        ...base, eventType: 'admin_user_groups_changed', metadata: { account: after.account, before: groupsOf(before.groups), after: groupsOf(after.groups) }
      }, tx);
    }
  }

  /** Groups to assign must exist; only developers may assign the developer group (US4-5). */
  private async assignableGroups(principal: AdminPrincipal, ids: readonly string[]): Promise<UserGroup[]> {
    const unique = uniqueIds(ids);
    const groups = await this.prisma.db.userGroup.findMany({ where: { id: { in: unique } } });
    const missing = unique.filter((id) => !groups.some((group) => group.id === id));
    if (missing.length > 0) throw new BadRequestException({ error: 'group_not_found', message: '找不到群組。', details: { ids: missing } });
    if (!principal.isDeveloper && groups.some((group) => group.code === DEVELOPER_GROUP_CODE)) {
      throw new ForbiddenException({ error: 'developer_group_forbidden', message: '只有開發工程師可以指派「開發工程師」群組。' });
    }
    return groups;
  }

  private visible(principal: AdminPrincipal, action: AdminAbilityAction = 'read'): Prisma.UserWhereInput {
    return accessibleBy(principal.ability, action).ofType('User');
  }

  private async findVisible(principal: AdminPrincipal, id: string, action: AdminAbilityAction = 'read'): Promise<SessionUser> {
    const user = await this.prisma.db.user.findFirst({ where: { AND: [this.visible(principal, action), { id }] }, include: WITH_GROUPS });
    if (!user) throw new NotFoundException(USER_NOT_FOUND);
    return user;
  }

  private async findAllVisible(principal: AdminPrincipal, ids: string[], action: AdminAbilityAction): Promise<SessionUser[]> {
    const users = await this.prisma.db.user.findMany({ where: { AND: [this.visible(principal, action), { id: { in: ids } }] }, include: WITH_GROUPS });
    const missing = ids.filter((id) => !users.some((user) => user.id === id));
    if (missing.length > 0) throw new NotFoundException({ ...USER_NOT_FOUND, details: { ids: missing } });
    return users;
  }
}

function filtersWhere(filters: UserTableFiltersDto | undefined): Prisma.UserWhereInput {
  const statuses = new Set(filters?.status);
  return {
    AND: [
      filters?.groups?.length ? { groups: { some: { id: { in: filters.groups } } } } : {},
      // Both values (or none) selected means no status filter.
      statuses.size === 1 ? { status: statuses.has(true) } : {}
    ]
  };
}

/** Active admins other than `excludedIds` (US4-7). */
function countActiveAdmins(db: Db, excludedIds: readonly string[]): Promise<number> {
  return db.user.count({ where: { AND: [ACTIVE_ADMIN, { id: { notIn: [...excludedIds] } }] } });
}

/** Accounts and emails are unique regardless of case (both are stored in lower case). */
async function assertAvailable(db: Db, values: { account?: string; email?: string }, exceptId?: string): Promise<void> {
  const candidates: Prisma.UserWhereInput[] = [];
  if (values.account) candidates.push({ account: values.account });
  if (values.email) candidates.push({ email: values.email });
  const clash = await db.user.findFirst({
    where: { OR: candidates, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { account: true }
  });
  if (!clash) return;
  throw new ConflictException(clash.account === values.account
    ? { error: 'account_taken', message: '帳號已被使用。' }
    : { error: 'email_taken', message: 'Email 已被使用。' });
}

/** A concurrent request may still win the race between assertAvailable and the write. */
async function uniqueOrConflict<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictException({ error: 'account_or_email_taken', message: '帳號或 email 已被使用。' });
    throw error;
  }
}

function groupsOf(groups: readonly UserGroup[]) {
  return groups.map((group) => ({ id: group.id, code: group.code, name: group.name }));
}

function sameGroups(left: readonly UserGroup[], right: readonly UserGroup[]): boolean {
  return left.length === right.length && left.every((group) => right.some((other) => other.id === group.id));
}
