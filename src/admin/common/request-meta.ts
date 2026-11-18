import type { Request } from 'express';

/** Who made a request, reduced to what audit and session records keep. */
export type RequestMeta = { requestId: string; ipSummary: string | null; userAgentSummary: string | null };

export function summarizeIp(request: Pick<Request, 'ip'>): string | null {
  const ip = request.ip?.trim();
  return ip ? ip.slice(0, 64) : null;
}

export function summarizeUserAgent(value: string | undefined): string | null {
  const agent = value?.replace(/\s+/g, ' ').trim();
  return agent ? agent.slice(0, 200) : null;
}
