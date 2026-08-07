import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { getRequestId } from '../common/request-id/request-id.util';
import { ApprovalRequestStatus, RiskLevel } from '../generated/prisma/enums';
import { getIdentityContext, IdentityRequest } from '../identity/identity-context.extractor';
import { IdentityGuard } from '../identity/identity.guard';
import { createCustomerScopeFromIdentityContext } from '../identity/customer-scope.factory';
import { ApprovalRequestService } from './approval-request.service';
import { ApprovalRequestListFilters } from './approval-request.types';

@Controller('assistant/approval-requests')
@UseGuards(IdentityGuard)
export class ApprovalRequestController {
  constructor(private readonly approvalRequestService: ApprovalRequestService) {}

  @Get()
  listRequests(@Req() request: IdentityRequest, @Query() query: ApprovalRequestListFiltersQuery) {
    const identityContext = getRequiredIdentityContext(request);
    return this.approvalRequestService.listVisibleRequests({
      requestId: getRequestId(request),
      identityContext,
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      filters: toListFilters(query)
    });
  }

  @Get(':id')
  getRequest(@Req() request: IdentityRequest, @Param('id') approvalRequestId: string) {
    const identityContext = getRequiredIdentityContext(request);
    return this.approvalRequestService.getVisibleRequest({
      requestId: getRequestId(request),
      approvalRequestId,
      identityContext,
      customerScope: createCustomerScopeFromIdentityContext(identityContext)
    });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  approveRequest(
    @Req() request: IdentityRequest,
    @Param('id') approvalRequestId: string,
    @Body() body: { idempotencyKey?: string }
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.approvalRequestService.approve({
      requestId: getRequestId(request),
      approvalRequestId,
      identityContext,
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      idempotencyKey: body.idempotencyKey
    });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  rejectRequest(
    @Req() request: IdentityRequest,
    @Param('id') approvalRequestId: string,
    @Body() body: { reason?: string }
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.approvalRequestService.reject({
      requestId: getRequestId(request),
      approvalRequestId,
      identityContext,
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      reason: body.reason
    });
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRequest(
    @Req() request: IdentityRequest,
    @Param('id') approvalRequestId: string,
    @Body() body?: { reason?: string }
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.approvalRequestService.cancel({
      requestId: getRequestId(request),
      approvalRequestId,
      identityContext,
      customerScope: createCustomerScopeFromIdentityContext(identityContext),
      reason: body?.reason
    });
  }
}

interface ApprovalRequestListFiltersQuery {
  status?: ApprovalRequestStatus;
  riskLevel?: RiskLevel;
  requesterActorId?: string;
  approverActorId?: string;
  createdAtFrom?: string;
  createdAtTo?: string;
}

function toListFilters(query: ApprovalRequestListFiltersQuery): ApprovalRequestListFilters {
  return {
    status: query.status,
    riskLevel: query.riskLevel,
    requesterActorId: query.requesterActorId,
    approverActorId: query.approverActorId,
    createdAtFrom: query.createdAtFrom,
    createdAtTo: query.createdAtTo
  };
}

function getRequiredIdentityContext(request: IdentityRequest) {
  const identityContext = getIdentityContext(request);
  if (!identityContext) {
    throw new Error('Missing identity context.');
  }

  return identityContext;
}
