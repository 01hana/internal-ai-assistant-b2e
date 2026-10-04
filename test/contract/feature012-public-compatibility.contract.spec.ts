import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { AssistantController } from '../../src/assistant/assistant.controller';
import { AssistantSseEventBuilder } from '../../src/assistant/sse/assistant-sse-event.builder';
import type { GroundedContextBundleV1 } from '../../src/assistant/grounding/grounded-context-bundle.types';
import type { SseEventType } from '../../src/common/sse/sse-event.types';
import { AnswerDecisionStatus } from '../../src/generated/prisma/enums';

type AssertNever<T extends never> = T;
type _NoGenerationPayload = AssertNever<Extract<keyof GroundedContextBundleV1, 'generationContext' | 'prompt' | 'modelOutput'>>;

describe('Feature 012 Phase A public compatibility (T006)', () => {
  it('keeps the existing Assistant message endpoint and history path', () => {
    expect(Reflect.getMetadata(PATH_METADATA, AssistantController)).toBe('assistant');
    expect(Reflect.getMetadata(PATH_METADATA, AssistantController.prototype.postMessage)).toBe('sessions/:id/messages');
    expect(Reflect.getMetadata(METHOD_METADATA, AssistantController.prototype.postMessage)).toBe(RequestMethod.POST);
    expect(Reflect.getMetadata(PATH_METADATA, AssistantController.prototype.listMessages)).toBe('sessions/:id/messages');
    expect(Reflect.getMetadata(METHOD_METADATA, AssistantController.prototype.listMessages)).toBe(RequestMethod.GET);
  });

  it('keeps answer_delta and final in the existing SSE envelope and final data shape', () => {
    const events = new AssistantSseEventBuilder().buildAnswerOnlyEvents({
      requestId: 'request-1', sessionId: 'session-1', messageId: 'message-1', answerDelta: 'safe answer',
      finalData: { answerDecision: AnswerDecisionStatus.answered, answer: 'safe answer', evidenceRefs: ['evidence-1'] }
    });
    expect(events.map((event) => event.event)).toEqual(['answer_delta', 'final'] satisfies SseEventType[]);
    for (const event of events) {
      expect(Object.keys(event.payload).sort()).toEqual(['data', 'eventType', 'messageId', 'requestId', 'sequence', 'sessionId']);
      expect(event.payload.eventType).toBe(event.event);
    }
    expect(Object.keys(events[0].payload.data as object)).toEqual(['delta']);
    expect(Object.keys(events[1].payload.data as object).sort()).toEqual(['answer', 'answerDecision', 'evidenceRefs']);
    expect(events.map((event) => event.payload.sequence)).toEqual([1, 2]);
  });
});
