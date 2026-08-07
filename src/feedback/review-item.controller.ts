import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { ReviewItemStatus, ReviewPriority, ReviewSourceType } from '../generated/prisma/enums';
import { getIdentityContext, IdentityRequest } from '../identity/identity-context.extractor';
import { IdentityGuard } from '../identity/identity.guard';
import { createCustomerScopeFromIdentityContext } from '../identity/customer-scope.factory';
import { ReviewItemDecisionDto, ReviewItemsQueryDto } from './feedback.dto';
import { ReviewItemService } from './review-item.service';

@Controller('admin/assistant/review-items')
@UseGuards(IdentityGuard)
export class ReviewItemController {
  constructor(private readonly reviewItemService: ReviewItemService) {}

  @Get()
  async listReviewItems(@Req() request: IdentityRequest, @Query() query: ReviewItemsQueryDto) {
    const identityContext = getRequiredReviewerIdentity(request);
    const customerScope = createCustomerScopeFromIdentityContext(identityContext);
    return {
      items: await this.reviewItemService.listForReview({
        customerScope,
        identityContext,
        status: query.status as ReviewItemStatus | undefined,
        sourceType: query.sourceType as ReviewSourceType | undefined,
        priority: query.priority as ReviewPriority | undefined
      })
    };
  }

  @Get(':id')
  async getReviewItem(@Req() request: IdentityRequest, @Param('id') reviewItemId: string) {
    const identityContext = getRequiredReviewerIdentity(request);
    const item = await this.reviewItemService.getForReview({ customerScope: createCustomerScopeFromIdentityContext(identityContext), identityContext, reviewItemId });
    if (!item) {
      throw new NotFoundException('Review item not found');
    }
    return item;
  }

  @Post(':id/resolve')
  async resolveReviewItem(
    @Req() request: IdentityRequest,
    @Param('id') reviewItemId: string,
    @Body() body: ReviewItemDecisionDto
  ) {
    const identityContext = getRequiredReviewerIdentity(request);
    const item = await this.reviewItemService.markResolved({
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      requestId: getRequestId(request),
      identityContext,
      reviewItemId,
      reason: body.reason
    });
    if (!item) {
      throw new NotFoundException('Review item not found');
    }
    return item;
  }

  @Post(':id/dismiss')
  async dismissReviewItem(
    @Req() request: IdentityRequest,
    @Param('id') reviewItemId: string,
    @Body() body: ReviewItemDecisionDto
  ) {
    const identityContext = getRequiredReviewerIdentity(request);
    const item = await this.reviewItemService.markDismissed({
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      requestId: getRequestId(request),
      identityContext,
      reviewItemId,
      reason: body.reason
    });
    if (!item) {
      throw new NotFoundException('Review item not found');
    }
    return item;
  }
}

function getRequiredReviewerIdentity(request: IdentityRequest) {
  const identityContext = getIdentityContext(request);
  if (!identityContext) {
    throw new Error('Missing identity context.');
  }

  if (
    !identityContext.actor.roles.includes('admin') &&
    !identityContext.actor.permissionScopes.includes('assistant:review')
  ) {
    throw new ForbiddenException('Review item access denied');
  }

  return identityContext;
}
