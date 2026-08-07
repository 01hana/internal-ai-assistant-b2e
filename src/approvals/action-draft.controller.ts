import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { getIdentityContext, IdentityRequest } from '../identity/identity-context.extractor';
import { IdentityGuard } from '../identity/identity.guard';
import { ActionDraftService } from './action-draft.service';

@Controller('assistant/action-drafts')
@UseGuards(IdentityGuard)
export class ActionDraftController {
  constructor(private readonly actionDraftService: ActionDraftService) {}

  @Get(':id')
  getDraft(@Req() request: IdentityRequest, @Param('id') actionDraftId: string) {
    return this.actionDraftService.getVisibleDraft({
      requestId: getRequestId(request),
      actionDraftId,
      identityContext: getRequiredIdentityContext(request)
    });
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirmDraft(
    @Req() request: IdentityRequest,
    @Param('id') actionDraftId: string,
    @Body() body: { idempotencyKey?: string }
  ) {
    return this.actionDraftService.confirm({
      requestId: getRequestId(request),
      actionDraftId,
      identityContext: getRequiredIdentityContext(request),
      idempotencyKey: body.idempotencyKey
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelDraft(@Req() request: IdentityRequest, @Param('id') actionDraftId: string) {
    return this.actionDraftService.cancel({
      requestId: getRequestId(request),
      actionDraftId,
      identityContext: getRequiredIdentityContext(request)
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
