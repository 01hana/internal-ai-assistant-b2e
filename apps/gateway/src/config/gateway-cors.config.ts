import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/** Browser transport policy only; this does not establish identity authority. */
export function gatewayCorsOptions(origins: readonly string[]): CorsOptions {
  return {
    origin: [...origins],
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'x-request-id', 'traceparent']
  };
}
