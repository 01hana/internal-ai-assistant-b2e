import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { FeedbackTableQueryDto } from './feedback.dto';
import { FeedbackService } from './feedback.service';

/** Feature 015 US3. */
@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'Feedback')
  table(@Body() query: FeedbackTableQueryDto) {
    return this.feedback.table(query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'Feedback')
  filters() {
    return this.feedback.filters();
  }

  /** `conversation` is the rated exchange for callers with `Conversation:read` (audited), otherwise null. */
  @Get(':id')
  @RequirePermission('read', 'Feedback')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Req() request: AdminRequest) {
    return this.feedback.get(admin, id, requestMeta(request));
  }
}
