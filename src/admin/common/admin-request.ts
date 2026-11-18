import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { RequestWithRequestId } from '../../common/request-id/request-id.middleware';
import { getRequestId } from '../../common/request-id/request-id.util';
import type { UserSession } from '../../generated/prisma/client';
import type { SessionUser } from '../auth/user-session.service';
import type { AdminAbility } from '../authorization/admin-ability.factory';
import { type RequestMeta, summarizeIp, summarizeUserAgent } from './request-meta';

/** The signed-in back-office user, attached to the request by AdminSessionGuard. */
export type AdminPrincipal = { user: SessionUser; session: UserSession; isDeveloper: boolean; ability: AdminAbility };

export type AdminRequest = RequestWithRequestId & {
  cookies?: Record<string, string | undefined>;
  adminPrincipal?: AdminPrincipal;
};

export function requestMeta(request: AdminRequest): RequestMeta {
  return { requestId: getRequestId(request), ipSummary: summarizeIp(request), userAgentSummary: summarizeUserAgent(request.header('user-agent')) };
}

/** The signed-in user of a route guarded by @SignedInRoute or @RequirePermission. */
export const CurrentAdmin = createParamDecorator((_data: unknown, context: ExecutionContext): AdminPrincipal => {
  const principal = context.switchToHttp().getRequest<AdminRequest>().adminPrincipal;
  if (!principal) throw new Error('CurrentAdmin used on a route without a signed-in user.');
  return principal;
});
