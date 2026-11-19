import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { StatsQueryDto } from './stats.dto';
import { StatsService } from './stats.service';

/** Feature 015 US2. */
@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  /** Usage and answer outcomes for `from`–`to` (dates in ADMIN_TIME_ZONE), by day or week. */
  @Get('getSummary')
  @RequirePermission('read', 'Stats')
  summary(@Query() query: StatsQueryDto) {
    return this.stats.summary(query);
  }
}
