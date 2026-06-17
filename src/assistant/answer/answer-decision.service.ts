import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { AnswerDecisionStatus, ExecutionDecision, NoAnswerReason } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import { AnswerPlan, BuildAnswerDecisionInput, PersistedAnswerDecisionResult } from './answer-decision.types';

@Injectable()
export class AnswerDecisionService {
  constructor(private readonly prisma: PrismaService) {}

  async decide(input: BuildAnswerDecisionInput): Promise<PersistedAnswerDecisionResult> {
    const answerPlan = this.buildAnswerPlan(input);
    const covered = answerPlan.selectedEvidenceRefs.length > 0 && answerPlan.disallowedClaims.length === 0;
    const status = this.toDecisionStatus(input.executionPlan.decision, covered, answerPlan);
    const answer = this.buildAnswerText(status, answerPlan);

    const groundingCheck = await this.prisma.db.groundingCheck.create({
      data: {
        requestId: input.requestId,
        messageId: input.messageId,
        covered,
        checkedClaimCount: answerPlan.allowedClaims.length + answerPlan.disallowedClaims.length,
        unsupportedClaimCount: answerPlan.disallowedClaims.length,
        evidenceRefIds: answerPlan.selectedEvidenceRefs,
        metadata: toJsonInput({
          answerType: answerPlan.answerType,
          missingInformationCount: answerPlan.missingInformation.length
        })
      }
    });

    const answerDecision = await this.prisma.db.answerDecision.create({
      data: {
        requestId: input.requestId,
        messageId: input.messageId,
        status,
        noAnswerReason: status === AnswerDecisionStatus.no_answer ? NoAnswerReason.no_evidence : undefined,
        groundingCheckId: groundingCheck.id,
        metadata: toJsonInput({
          answerType: answerPlan.answerType,
          selectedEvidenceCount: answerPlan.selectedEvidenceRefs.length
        })
      }
    });

    return {
      status,
      answerPlan,
      answer,
      groundingCheckId: groundingCheck.id,
      answerDecisionId: answerDecision.id
    };
  }

  private buildAnswerPlan(input: BuildAnswerDecisionInput): AnswerPlan {
    if (input.executionPlan.decision === ExecutionDecision.clarify) {
      return {
        answerType: 'clarification',
        expectedAnswerShape: input.executionPlan.expectedAnswerShape,
        selectedEvidenceRefs: [],
        allowedClaims: [],
        disallowedClaims: [],
        missingInformation: ['clarification_needed']
      };
    }

    const selectedEvidenceRefs = input.evidenceRefs.map((evidence) => evidence.id);
    if (selectedEvidenceRefs.length === 0) {
      return {
        answerType: 'no_answer',
        expectedAnswerShape: input.executionPlan.expectedAnswerShape,
        selectedEvidenceRefs: [],
        allowedClaims: [],
        disallowedClaims: [],
        missingInformation: ['evidence']
      };
    }

    const allowedClaims = input.evidenceRefs.flatMap((evidence) =>
      Object.entries(evidence.summary).map(([field, value]) => `${field}:${String(value)}`)
    );

    return {
      answerType: 'grounded_text',
      expectedAnswerShape: input.executionPlan.expectedAnswerShape,
      selectedEvidenceRefs,
      allowedClaims,
      disallowedClaims: [],
      missingInformation: []
    };
  }

  private toDecisionStatus(
    executionDecision: ExecutionDecision,
    covered: boolean,
    answerPlan: AnswerPlan
  ): AnswerDecisionStatus {
    if (executionDecision === ExecutionDecision.clarify || answerPlan.answerType === 'clarification') {
      return AnswerDecisionStatus.clarification_required;
    }

    if (!covered || answerPlan.answerType === 'no_answer') {
      return AnswerDecisionStatus.no_answer;
    }

    return AnswerDecisionStatus.answered;
  }

  private buildAnswerText(status: AnswerDecisionStatus, answerPlan: AnswerPlan) {
    if (status === AnswerDecisionStatus.clarification_required) {
      return {
        delta: '請補充更明確的查詢目標',
        text: '請補充更明確的查詢目標，例如訂單號或頁面上的對象。'
      };
    }

    if (status === AnswerDecisionStatus.no_answer) {
      return {
        delta: '目前沒有足夠 evidence 可以回答',
        text: '目前沒有足夠 evidence 可以回答這個問題。'
      };
    }

    const claimText = answerPlan.allowedClaims
      .map((claim) => {
        const [field, value] = claim.split(':');
        if (field === 'status') {
          return `這張訂單目前狀態為${value}`;
        }
        if (field === 'customerName') {
          return `客戶名稱是${value}`;
        }
        if (field === 'availableQuantity') {
          return `目前可用庫存為${value}`;
        }
        if (field === 'incomingQuantity') {
          return `預計入庫數量為${value}`;
        }
        if (field === 'allocatedQuantity') {
          return `已配置數量為${value}`;
        }
        return undefined;
      })
      .filter((value): value is string => Boolean(value));

    const text = `${claimText.join('，')}。`;
    return {
      delta: text.replace(/。$/, ''),
      text
    };
  }
}

function toJsonInput<T>(value: T): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}
