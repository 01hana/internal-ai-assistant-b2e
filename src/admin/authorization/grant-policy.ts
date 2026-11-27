import { coversPermissions, effectivePermissions, type GroupPermissionSource } from '../permissions';

type Holder = { groups: readonly (GroupPermissionSource & { id: string })[] };
type Group = GroupPermissionSource & { id: string };

/**
 * Who may hand out which groups and permissions (2026-11-27, closes a privilege escalation): a user grants only
 * what they hold themselves, never changes their own groups, and never edits a group they belong to. Built-in
 * groups hold `all:manage`, so only developers and 最高管理者 may assign 最高管理者.
 */
export const canGrantPermissions = (holder: Holder, permissions: readonly GroupPermissionSource[]) =>
  coversPermissions(effectivePermissions(holder.groups), effectivePermissions(permissions));

/** Assigning a user to `group`, or taking them out of it. */
export const canGrantGroup = (holder: Holder, group: GroupPermissionSource) => canGrantPermissions(holder, [group]);

/** Editing or deleting a custom group: not one of the holder's own, and no more powerful than the holder. */
export const canManageGroup = (holder: Holder, group: Group) =>
  !holder.groups.some((own) => own.id === group.id) && canGrantGroup(holder, group);
