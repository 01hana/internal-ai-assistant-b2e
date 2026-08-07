import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { getIdentityContext, IdentityRequest } from '../identity/identity-context.extractor';
import { IdentityGuard } from '../identity/identity.guard';
import { createCustomerScopeFromIdentityContext } from '../identity/customer-scope.factory';
import { FeedbackRating } from '../generated/prisma/enums';
import { FeedbackEventService } from './feedback-event.service';
import { SubmitFeedbackDto } from './feedback.dto';

@Controller('assistant/messages')
@UseGuards(IdentityGuard)
export class FeedbackController {
  constructor(private readonly feedbackEventService: FeedbackEventService) {}

  @Post(':messageId/feedback')
  async submitFeedback(
    @Req() request: IdentityRequest,
    @Param('messageId') messageId: string,
    @Body() body: SubmitFeedbackDto
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.feedbackEventService.submitFeedback({
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      requestId: getRequestId(request),
      messageId,
      identityContext,
      rating: body.rating as FeedbackRating,
      intent: body.intent,
      reason: body.reason,
      comment: body.comment
    });
  }
}

function getRequiredIdentityContext(request: IdentityRequest) {
  const identityContext = getIdentityContext(request);
  if (!identityContext) {
    throw new Error('Missing identity context.');
  }

  return identityContext;
}
