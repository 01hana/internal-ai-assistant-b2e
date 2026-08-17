import { UpstreamAuthenticationError } from './upstream-auth.error';

const COMPACT_JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function parseBearerToken(authorization: string | undefined): string {
  if (typeof authorization !== 'string') throw new UpstreamAuthenticationError('missing_or_malformed_token');
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match || !COMPACT_JWT_PATTERN.test(match[1])) throw new UpstreamAuthenticationError('missing_or_malformed_token');
  return match[1];
}
