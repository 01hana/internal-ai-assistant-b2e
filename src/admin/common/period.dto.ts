import { IsISO8601, IsOptional } from 'class-validator';

/** List filter on a timestamp column: `from` inclusive, `to` exclusive, both ISO 8601 instants. */
export class PeriodFilterDto {
  /**
   * Inclusive start.
   * @example 2026-11-01T00:00:00+08:00
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  /**
   * Exclusive end.
   * @example 2026-12-01T00:00:00+08:00
   */
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export function periodWhere(period: PeriodFilterDto | undefined): { gte?: Date; lt?: Date } | undefined {
  if (!period?.from && !period?.to) return undefined;
  return { ...(period.from ? { gte: new Date(period.from) } : {}), ...(period.to ? { lt: new Date(period.to) } : {}) };
}
