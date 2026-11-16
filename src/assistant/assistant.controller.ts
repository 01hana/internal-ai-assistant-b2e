import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import {
  getIdentityContext,
  IdentityRequest,
} from "../identity/identity-context.extractor";
import { IdentityGuard } from "../identity/identity.guard";
import { HostIntegrationRequestFactory, createCustomerScopeFromHostIntegrationContext } from "../host-integration/host-integration-request.factory";
import {
  CreateAssistantSessionDto,
  SendAssistantMessageDto,
  AssistantMessageHistoryQueryDto,
} from "./dto/assistant.dto";
import { AssistantHistoryService } from "./history/assistant-history.service";
import { AssistantMessageService } from "./message/assistant-message.service";
import { AssistantSessionService } from "./session/assistant-session.service";
import { AssistantExperienceService } from "../assistant-experience/assistant-experience.service";

@Controller("assistant")
@UseGuards(IdentityGuard)
export class AssistantController {
  constructor(
    private readonly assistantSessionService: AssistantSessionService,
    private readonly assistantMessageService: AssistantMessageService,
    private readonly assistantHistoryService: AssistantHistoryService,
    private readonly hostIntegrationRequestFactory: HostIntegrationRequestFactory,
    /** Always injected by Nest; optional only so hand-built unit-test controllers stay valid. */
    @Optional() private readonly experience?: AssistantExperienceService,
  ) {}

  @Post("sessions")
  async createSession(
    @Req() request: IdentityRequest,
    @Body() body: CreateAssistantSessionDto,
  ) {
    const identityContext = getRequiredIdentityContext(request);
    const { host, pageContext } = this.hostIntegrationRequestFactory.create(identityContext, body.pageContext);
    const opening = this.experience ? await this.experience.buildOpening(host, pageContext) : undefined;
    return this.assistantSessionService.createSession({
      requestId: identityContext.requestId,
      hostIntegrationContext: host,
      pageContext,
      ...(opening ? { opening } : {}),
    });
  }

  @Get("sessions/:id")
  async getSession(
    @Req() request: IdentityRequest,
    @Param("id") sessionId: string,
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.assistantSessionService.getVisibleSessionSummary({
      requestId: identityContext.requestId,
      sessionId,
      identityContext,
    });
  }

  @Post("sessions/:id/messages")
  @HttpCode(HttpStatus.OK)
  async postMessage(
    @Req() request: IdentityRequest,
    @Param("id") sessionId: string,
    @Body() body: SendAssistantMessageDto,
    @Res() response: Response,
  ) {
    const identityContext = getRequiredIdentityContext(request);
    const requestId = identityContext.requestId;
    const { host, pageContext, transient } = this.hostIntegrationRequestFactory.create(identityContext, body.pageContext);

    const customerScope = createCustomerScopeFromHostIntegrationContext(host);
    await this.assistantSessionService.getVisibleSession(sessionId, customerScope);
    // Feature 013: a choice is resolved and permission-checked before any SSE output; unknown or no
    // longer permitted choices are indistinguishable from a missing session.
    const experienceChoice = body.choiceId === undefined || !this.experience ? undefined
      : await this.experience.resolveChoice(host, body.choiceId);
    if (body.choiceId !== undefined && !experienceChoice) throw this.assistantSessionService.createSessionNotFoundError();
    const message = experienceChoice ? experienceChoice.message : body.message!;

    response.status(HttpStatus.OK);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    const abortController = new AbortController();
    const onClose = () => { if (!response.writableEnded) abortController.abort(); };
    response.once('close', onClose);

    const writeEvent = (event: { event: string; payload: unknown }) => {
      if (abortController.signal.aborted || response.writableEnded) throw new Error('ASSISTANT_STREAM_ABORTED');
      response.write(`event: ${event.event}\ndata: ${JSON.stringify(event.payload)}\n\n`);
    };

    try {
      const events = await this.assistantMessageService.sendMessage({
        requestId,
        sessionId,
        message,
        ...(experienceChoice ? { experienceChoice } : {}),
        identityContext,
        hostIntegrationContext: host,
        pageContext,
        transientConnectorContext: transient,
        abortSignal: abortController.signal,
        eventSink: writeEvent,
      });
      for (const event of events) writeEvent(event);
    } catch (error) {
      if (!abortController.signal.aborted && !response.writableEnded) {
        const fallback = this.assistantMessageService.createErrorEvent({
          requestId,
          sessionId,
          code: extractErrorCode(error),
          message: extractErrorMessage(error),
        });
        writeEvent(fallback);
      }
    } finally {
      response.off('close', onClose);
      if (!response.writableEnded) response.end();
    }
  }

  @Get("sessions/:id/messages")
  async listMessages(
    @Req() request: IdentityRequest,
    @Param("id") sessionId: string,
    @Query() query: AssistantMessageHistoryQueryDto,
  ) {
    const identityContext = getRequiredIdentityContext(request);
    return this.assistantHistoryService.listMessages({
      requestId: identityContext.requestId,
      sessionId,
      identityContext,
      limit: query.limit ? Number(query.limit) : undefined,
      cursor: query.cursor,
      order: query.order,
    });
  }
}

function getRequiredIdentityContext(request: IdentityRequest) {
  const identityContext = getIdentityContext(request);
  if (!identityContext) {
    throw new Error("Missing identity context.");
  }

  return identityContext;
}

function extractErrorCode(error: unknown): string {
  if (typeof error === "object" && error && "response" in error) {
    const response = (error as { response?: { error?: string } }).response;
    if (response?.error) {
      return response.error.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    }
  }

  return "ERROR";
}

function extractErrorMessage(_error: unknown): string {
  return "Assistant message processing failed.";
}
