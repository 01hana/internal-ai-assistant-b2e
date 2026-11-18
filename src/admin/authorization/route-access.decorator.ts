import { SetMetadata } from '@nestjs/common';
import type { AdminAction, AdminSubject } from '../permissions';

/**
 * Feature 014: every admin route declares how it may be reached. A route without a declaration is
 * rejected by AdminPermissionGuard, so a forgotten decorator fails closed.
 */
export const ROUTE_ACCESS = 'admin:route-access';

export type RouteAccess =
  | { kind: 'public' }
  | { kind: 'signedIn' }
  | { kind: 'permission'; action: AdminAction; subject: AdminSubject };

/** No session needed (login, mail links, forgot password). Still subject to the Origin check. */
export const PublicRoute = () => SetMetadata(ROUTE_ACCESS, { kind: 'public' } satisfies RouteAccess);

/** Any signed-in user (logout, profile). */
export const SignedInRoute = () => SetMetadata(ROUTE_ACCESS, { kind: 'signedIn' } satisfies RouteAccess);

/** A signed-in user whose groups grant `subject:action`. */
export const RequirePermission = (action: AdminAction, subject: AdminSubject) =>
  SetMetadata(ROUTE_ACCESS, { kind: 'permission', action, subject } satisfies RouteAccess);
