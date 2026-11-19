import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'node:crypto';
import { ROUTE_ACCESS, type RouteAccess } from '../authorization/route-access.decorator';
import type { AdminRequest } from '../common/admin-request';
import { ADMIN_CSRF_COOKIE, ADMIN_CSRF_HEADER, AdminSettings } from '../config/admin-settings';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * State-changing requests must come from the admin website (Origin check). Signed-in ones must also
 * echo the CSRF cookie in the X-CSRF-Token header (double submit).
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly settings: AdminSettings) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!STATE_CHANGING.has(request.method)) return true;

    if (!this.settings.webOrigins.includes(request.header('origin') ?? '')) {
      throw new ForbiddenException({ error: 'origin_not_allowed', message: '請求來源不被允許。' });
    }
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [context.getHandler(), context.getClass()]);
    if (access?.kind === 'public') return true;

    const cookie = request.cookies?.[ADMIN_CSRF_COOKIE];
    const header = request.header(ADMIN_CSRF_HEADER);
    if (!cookie || !header || !sameValue(cookie, header)) {
      throw new ForbiddenException({ error: 'csrf_token_invalid', message: '請重新整理頁面後再試一次。' });
    }
    return true;
  }
}

function sameValue(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
