import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRequest } from '../common/admin-request';
import { ROUTE_ACCESS, type RouteAccess } from './route-access.decorator';

/** Rejects routes without an access declaration and signed-in users lacking the declared permission. */
@Injectable()
export class AdminPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [context.getHandler(), context.getClass()]);
    if (!access) throw new ForbiddenException({ error: 'route_access_undeclared', message: '沒有權限。' });
    if (access.kind !== 'permission') return true;

    const principal = context.switchToHttp().getRequest<AdminRequest>().adminPrincipal;
    if (!principal || !access.anyOf.some(([action, subject]) => principal.ability.can(action, subject))) {
      throw new ForbiddenException({ error: 'permission_denied', message: '沒有權限。' });
    }
    return true;
  }
}
