import type { RequestWithRequestId } from '../../common/request-id/request-id.middleware';
import { getRequestId } from '../../common/request-id/request-id.util';
import type { UserSession } from '../../generated/prisma/client';
import type { SessionUser } from '../auth/user-session.service';
import { type RequestMeta, summarizeIp, summarizeUserAgent } from './request-meta';

/** The signed-in back-office user, attached to the request by AdminSessionGuard. */
export type AdminPrincipal = { user: SessionUser; session: UserSession; isDeveloper: boolean };

export type AdminRequest = RequestWithRequestId & {
  cookies?: Record<string, string | undefined>;
  adminPrincipal?: AdminPrincipal;
};

export function requestMeta(request: AdminRequest): RequestMeta {
  return { requestId: getRequestId(request), ipSummary: summarizeIp(request), userAgentSummary: summarizeUserAgent(request.header('user-agent')) };
}
