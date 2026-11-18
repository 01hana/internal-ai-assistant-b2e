import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { buildAdminAbility, isDeveloper } from '../authorization/admin-ability.factory';
import { ROUTE_ACCESS, type RouteAccess } from '../authorization/route-access.decorator';
import type { AdminRequest } from '../common/admin-request';
import { ADMIN_SESSION_COOKIE } from '../config/admin-settings';
import { UserSessionService } from './user-session.service';

/** Resolves the session cookie for every non-public route; 401 when missing, expired or revoked. */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly sessions: UserSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [context.getHandler(), context.getClass()]);
    if (access?.kind === 'public') return true;

    const request = context.switchToHttp().getRequest<AdminRequest>();
    const found = await this.sessions.validate(request.cookies?.[ADMIN_SESSION_COOKIE]);
    if (!found) throw new UnauthorizedException({ error: 'session_required', message: '請重新登入。' });
    request.adminPrincipal = {
      user: found.user,
      session: found.session,
      isDeveloper: isDeveloper(found.user.groups),
      ability: buildAdminAbility(found.user.groups)
    };
    return true;
  }
}
