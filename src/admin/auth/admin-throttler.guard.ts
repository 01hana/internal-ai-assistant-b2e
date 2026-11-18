import { ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * Feature 014: request limits on the public auth endpoints (`@nestjs/throttler`, in-process storage —
 * enough for the single admin-api container; several replicas would need a shared storage).
 *   ip:      login 20/min per IP; mail-link and forgot-password endpoints lower it to 10/min.
 *   account: login 10/min per account; skipped on the other endpoints.
 * Applied with @UseGuards(AdminThrottlerGuard) only where needed, so signed-in pages are not throttled.
 */
export const ADMIN_THROTTLERS: ThrottlerModuleOptions = {
  throttlers: [
    { name: 'ip', ttl: 60_000, limit: 20 },
    {
      name: 'account',
      ttl: 60_000,
      limit: 10,
      getTracker: (request) => `account:${String((request.body as { account?: unknown } | undefined)?.account ?? '').trim().toLowerCase()}`
    }
  ]
};

/** Link and forgot-password endpoints: 10/min per IP, no account limit. */
export const LINK_ENDPOINT_LIMITS = { ip: { limit: 10, ttl: 60_000 } } as const;
export const SKIP_ACCOUNT_LIMIT = { account: true } as const;

@Injectable()
export class AdminThrottlerGuard extends ThrottlerGuard {
  /** Keep the admin API error format instead of the library's default message. */
  protected override async throwThrottlingException(_context: ExecutionContext): Promise<void> {
    throw new HttpException({ error: 'too_many_requests', message: '嘗試次數過多，請稍後再試。' }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
