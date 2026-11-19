import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { RequirePermission } from '../authorization/route-access.decorator';
import { type AdminPrincipal, type AdminRequest, CurrentAdmin, requestMeta } from '../common/admin-request';
import { ReviewItemBatchDto, ReviewItemTableQueryDto } from './review-items.dto';
import { ReviewItemsService } from './review-items.service';

/** Feature 015 US4. */
@Controller('reviewItems')
export class ReviewItemsController {
  constructor(private readonly reviewItems: ReviewItemsService) {}

  @Post('getTable')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('read', 'ReviewItem')
  table(@Body() query: ReviewItemTableQueryDto) {
    return this.reviewItems.table(query);
  }

  @Get('getFilters')
  @RequirePermission('read', 'ReviewItem')
  filters() {
    return this.reviewItems.filters();
  }

  /** Change the handling status (and note) of several items. */
  @Patch('batch')
  @RequirePermission('update', 'ReviewItem')
  updateStatus(@CurrentAdmin() admin: AdminPrincipal, @Body() body: ReviewItemBatchDto, @Req() request: AdminRequest) {
    return this.reviewItems.updateStatus(admin, body, requestMeta(request));
  }

  /** Includes the handling history; `conversation` only for `Conversation:read` (audited). */
  @Get(':id')
  @RequirePermission('read', 'ReviewItem')
  get(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string, @Req() request: AdminRequest) {
    return this.reviewItems.get(admin, id, requestMeta(request));
  }
}
