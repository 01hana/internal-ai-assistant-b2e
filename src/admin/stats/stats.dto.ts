import { IsIn, IsOptional, Matches } from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const GRANULARITIES = ['day', 'week'] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** Dates in the deployment's time zone (ADMIN_TIME_ZONE), both inclusive. */
export class StatsQueryDto {
  @Matches(DATE, { message: 'from 必須是 YYYY-MM-DD。' })
  from!: string;

  @Matches(DATE, { message: 'to 必須是 YYYY-MM-DD。' })
  to!: string;

  /** Weeks start on Monday. */
  @IsOptional()
  @IsIn(GRANULARITIES)
  granularity: Granularity = 'day';
}
