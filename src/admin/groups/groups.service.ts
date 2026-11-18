import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { accessibleBy } from '@casl/prisma/runtime';
import type { Prisma, UserGroup } from '../../generated/prisma/client';
import type { AdminAbilityAction } from '../permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { UserAuditService } from '../audit/user-audit.service';
import { actorOf } from '../auth/admin-auth.service';
import { selectableGroupsWhere } from '../authorization/admin-ability.factory';
import type { AdminPrincipal } from '../common/admin-request';
import { type IdsDto, uniqueIds } from '../common/ids.dto';
import { isUniqueViolation } from '../common/prisma-errors';
import type { RequestMeta } from '../common/request-meta';
import { keywordWhere, orderByOf, pageArgs, type TablePage } from '../common/table-query.dto';
import { isSystemGroupCode, normalizeCustomGroupPermissions, permissionCatalog, SYSTEM_GROUPS } from '../permissions';
import type { CreateGroupDto, GroupTableQueryDto, UpdateGroupDto } from './groups.dto';

export type GroupView = {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  /** Custom groups: their own permissions. Built-in groups: from src/admin/permissions (`all:manage`). */
  permissions: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type GroupWithCount = UserGroup & { _count: { users: number } };

const SORTABLE = ['name', 'createdAt', 'updatedAt'] as const;
/** Built-in groups first, in a fixed order by code (admin, developer), independent of collation. */
const SYSTEM_FIRST: Prisma.UserGroupOrderByWithRelationInput[] = [{ isSystem: 'desc' }, { code: { sort: 'asc', nulls: 'last' } }];
const DUPLICATE_NAME = { error: 'group_name_taken', message: '已有相同名稱的群組。' };
const SYSTEM_GROUP_LOCKED = { error: 'system_group_locked', message: '內建群組不可修改或刪除。' };

/**
 * Feature 014 US3: user groups. Visibility comes from the caller's CASL ability (non-developers never
 * see the developer group), so a hidden group behaves exactly like a missing one (404).
 */
@Injectable()
export class GroupsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: UserAuditService) {}

  async table(principal: AdminPrincipal, query: GroupTableQueryDto): Promise<TablePage<GroupView>> {
    const where: Prisma.UserGroupWhereInput = { AND: [this.visible(principal), keywordWhere(query.keyword, ['name', 'description'])] };
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.userGroup.findMany({
        where,
        include: { _count: { select: { users: true } } },
        orderBy: [...SYSTEM_FIRST, orderByOf(query.sort, SORTABLE, { name: 'asc' })],
        ...pageArgs(query)
      }),
      this.prisma.db.userGroup.count({ where })
    ]);
    return { items: rows.map(toGroupView), total };
  }

  async options(principal: AdminPrincipal): Promise<Array<{ id: string; label: string; isSystem: boolean }>> {
    const groups = await this.prisma.db.userGroup.findMany({
      where: selectableGroupsWhere(principal.isDeveloper),
      orderBy: [...SYSTEM_FIRST, { name: 'asc' }]
    });
    return groups.map((group) => ({ id: group.id, label: group.name, isSystem: group.isSystem }));
  }

  permissions() {
    return permissionCatalog();
  }

  async get(principal: AdminPrincipal, id: string): Promise<GroupView> {
    return toGroupView(await this.findVisible(principal, id));
  }

  async create(principal: AdminPrincipal, input: CreateGroupDto, meta: RequestMeta): Promise<GroupView> {
    const permissions = validPermissions(input.permissions);
    try {
      const group = await this.prisma.db.$transaction(async (tx) => {
        const created = await tx.userGroup.create({
          data: { name: input.name, description: input.description || null, permissions },
          include: { _count: { select: { users: true } } }
        });
        await this.audit.record({
          eventType: 'admin_user_group_created', meta, actor: actorOf(principal.user),
          target: { type: 'UserGroup', id: created.id }, metadata: { name: created.name, permissions }
        }, tx);
        return created;
      });
      return toGroupView(group);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_NAME);
      throw error;
    }
  }

  async update(principal: AdminPrincipal, id: string, input: UpdateGroupDto, meta: RequestMeta): Promise<GroupView> {
    const current = await this.findVisible(principal, id, 'update');
    if (current.isSystem) throw new BadRequestException(SYSTEM_GROUP_LOCKED);
    const permissions = input.permissions === undefined ? undefined : validPermissions(input.permissions);
    try {
      const updated = await this.prisma.db.$transaction(async (tx) => {
        const group = await tx.userGroup.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description || null } : {}),
            ...(permissions !== undefined ? { permissions } : {})
          },
          include: { _count: { select: { users: true } } }
        });
        await this.audit.record({
          eventType: 'admin_user_group_updated', meta, actor: actorOf(principal.user), target: { type: 'UserGroup', id },
          metadata: { before: snapshot(current), after: snapshot(group) }
        }, tx);
        return group;
      });
      return toGroupView(updated);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException(DUPLICATE_NAME);
      throw error;
    }
  }

  /** All or nothing: every group must be visible, custom and without members. */
  async remove(principal: AdminPrincipal, input: IdsDto, meta: RequestMeta): Promise<{ deleted: number }> {
    const ids = uniqueIds(input.ids);
    const groups = await this.prisma.db.userGroup.findMany({
      where: { AND: [this.visible(principal, 'delete'), { id: { in: ids } }] },
      include: { _count: { select: { users: true } } }
    });
    const missing = ids.filter((id) => !groups.some((group) => group.id === id));
    if (missing.length > 0) throw new NotFoundException({ error: 'group_not_found', message: '找不到群組。', details: { ids: missing } });
    const locked = groups.filter((group) => group.isSystem);
    if (locked.length > 0) throw new BadRequestException({ ...SYSTEM_GROUP_LOCKED, details: { ids: locked.map((group) => group.id) } });
    const inUse = groups.filter((group) => group._count.users > 0);
    if (inUse.length > 0) {
      throw new BadRequestException({ error: 'group_has_members', message: '群組仍有成員，請先移除成員。', details: { ids: inUse.map((group) => group.id) } });
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.userGroup.deleteMany({ where: { id: { in: ids } } });
      for (const group of groups) {
        await this.audit.record({
          eventType: 'admin_user_group_deleted', meta, actor: actorOf(principal.user),
          target: { type: 'UserGroup', id: group.id }, metadata: snapshot(group)
        }, tx);
      }
    });
    return { deleted: ids.length };
  }

  /** Groups the caller may act on; anything else is treated as not found. */
  private visible(principal: AdminPrincipal, action: AdminAbilityAction = 'read'): Prisma.UserGroupWhereInput {
    return accessibleBy(principal.ability, action).ofType('UserGroup');
  }

  private async findVisible(principal: AdminPrincipal, id: string, action: AdminAbilityAction = 'read'): Promise<GroupWithCount> {
    const group = await this.prisma.db.userGroup.findFirst({
      where: { AND: [this.visible(principal, action), { id }] },
      include: { _count: { select: { users: true } } }
    });
    if (!group) throw new NotFoundException({ error: 'group_not_found', message: '找不到群組。' });
    return group;
  }
}

function validPermissions(values: readonly string[]): string[] {
  const result = normalizeCustomGroupPermissions(values);
  if (!result.ok) throw new BadRequestException({ error: 'invalid_permissions', message: '包含不允許的權限。', details: { invalid: result.invalid } });
  return result.permissions;
}

function toGroupView(group: GroupWithCount): GroupView {
  return {
    id: group.id,
    code: group.code,
    name: group.name,
    description: group.description,
    isSystem: group.isSystem,
    permissions: isSystemGroupCode(group.code) ? [...SYSTEM_GROUPS[group.code].permissions] : group.permissions,
    memberCount: group._count.users,
    createdAt: group.createdAt.toISOString(),
    updatedAt: group.updatedAt.toISOString()
  };
}

function snapshot(group: UserGroup) {
  return { name: group.name, description: group.description, permissions: group.permissions };
}
