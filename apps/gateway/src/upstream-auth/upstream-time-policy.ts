export type UpstreamTimeFailure = 'invalid_iat' | 'token_expired' | 'token_not_yet_valid';
export function registeredTimeFailure(claims: { iat?: unknown; exp?: unknown; nbf?: unknown }, clockToleranceSeconds: number): UpstreamTimeFailure | undefined {
  const now = Math.floor(Date.now() / 1000);
  if (!numericDate(claims.iat) || claims.iat > now + clockToleranceSeconds) return 'invalid_iat';
  if (!numericDate(claims.exp) || claims.exp <= now - clockToleranceSeconds) return 'token_expired';
  if (claims.nbf !== undefined && (!numericDate(claims.nbf) || claims.nbf > now + clockToleranceSeconds)) return 'token_not_yet_valid';
}
function numericDate(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
