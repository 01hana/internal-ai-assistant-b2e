import { IsISO8601, IsOptional } from 'class-validator';

/** List filter on a timestamp column: `from` inclusive, `to` exclusive, both ISO 8601 instants. */
export class PeriodFilterDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export function periodWhere(period: PeriodFilterDto | undefined): { gte?: Date; lt?: Date } | undefined {
  if (!period?.from && !period?.to) return undefined;
  return { ...(period.from ? { gte: new Date(period.from) } : {}), ...(period.to ? { lt: new Date(period.to) } : {}) };
}
