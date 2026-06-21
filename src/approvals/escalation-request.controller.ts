import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { EscalationStatus, RiskLevel } from '../generated/prisma/enums';
import { getIdentityContext, IdentityRequest } from '../identity/identity-context.extractor';
import { IdentityGuard } from '../identity/identity.guard';
import { EscalationRequestService } from './escalation-request.service';
import { EscalationRequestListFilters } from './escalation-request.types';

@Controller('assistant/escalation-requests')
@UseGuards(IdentityGuard)
export class EscalationRequestController {
  constructor(private readonly escalationRequestService: EscalationRequestService) {}

  @Get()
  listRequests(@Req() request: IdentityRequest, @Query() query: EscalationRequestListFiltersQuery) {
    return this.escalationRequestService.listVisibleRequests({
      requestId: getRequestId(request),
      identityContext: getRequiredIdentityContext(request),
      filters: toListFilters(query)
    });
  }

  @Get(':id')
  getRequest(@Req() request: IdentityRequest, @Param('id') escalationRequestId: string) {
    return this.escalationRequestService.getVisibleRequest({
      requestId: getRequestId(request),
      escalationRequestId,
      identityContext: getRequiredIdentityContext(request)
    });
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveRequest(
    @Req() request: IdentityRequest,
    @Param('id') escalationRequestId: string,
    @Body() body?: { reason?: string }
  ) {
    return this.escalationRequestService.resolve({
      requestId: getRequestId(request),
      escalationRequestId,
      identityContext: getRequiredIdentityContext(request),
      reason: body?.reason
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRequest(
    @Req() request: IdentityRequest,
    @Param('id') escalationRequestId: string,
    @Body() body?: { reason?: string }
  ) {
    return this.escalationRequestService.cancel({
      requestId: getRequestId(request),
      escalationRequestId,
      identityContext: getRequiredIdentityContext(request),
      reason: body?.reason
    });
  }
}

interface EscalationRequestListFiltersQuery {
  status?: EscalationStatus;
  riskLevel?: RiskLevel;
  requesterActorId?: string;
}

function toListFilters(query: EscalationRequestListFiltersQuery): EscalationRequestListFilters {
  return {
    status: query.status,
    riskLevel: query.riskLevel,
    requesterActorId: query.requesterActorId
  };
}

function getRequiredIdentityContext(request: IdentityRequest) {
  const identityContext = getIdentityContext(request);
  if (!identityContext) {
    throw new Error('Missing identity context.');
  }

  return identityContext;
}
