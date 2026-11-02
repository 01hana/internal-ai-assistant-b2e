import type { ToolResultPolicyV1 } from './tool-registry.types';

/** A granted subtree cannot be projected safely with a denied or masked descendant. */
export function isResultPolicyProjectableForActor(
  policy: ToolResultPolicyV1,
  permissionScopes: readonly string[]
): boolean {
  return !policy.allowedFieldPaths.some((allowed) =>
    policy.deniedFieldPaths.some((denied) => denied.startsWith(`${allowed}.`)) ||
    policy.permissionMasks.some((mask) => mask.fieldPath.startsWith(`${allowed}.`) &&
      !mask.requiredPermissionScopes.every((scope) => permissionScopes.includes(scope))));
}
