import { Injectable } from '@nestjs/common';
import type { GroundedCitation, GroundedDocumentEvidence, GroundedToolEvidence } from './grounded-context-bundle.types';
import type { GroundedRetrievalNeedResult, GroundedRetrievalPlan } from '../../retrieval/grounded-retrieval.types';
import { GroundedDocumentRetrievalService, GroundedDocumentRetrievalInput } from '../../retrieval/grounded-document-retrieval.service';
import { GroundedToolRetrievalService, GroundedToolRetrievalInput } from './grounded-tool-retrieval.service';
import type { ToolPermissionDeniedReason } from '../../tools/tool-registry.types';
import type { GroundedAnswerInput } from '../runtime/grounded-answer-input.types';

type SharedDocumentInput = Omit<GroundedDocumentRetrievalInput, 'need'>;
type SharedToolInput = Omit<GroundedToolRetrievalInput, 'need'>;

export interface HybridRetrievalCoordinatorInput {
  readonly plan: GroundedRetrievalPlan;
  readonly documentInput: SharedDocumentInput;
  readonly toolInput: SharedToolInput;
  readonly precovered?: {
    readonly needResults: readonly GroundedRetrievalNeedResult[];
    readonly evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
    readonly citations: readonly GroundedCitation[];
  };
}

export interface HybridRetrievalCoordinatorResult {
  readonly needResults: readonly GroundedRetrievalNeedResult[];
  readonly evidence: readonly (GroundedDocumentEvidence | GroundedToolEvidence)[];
  readonly citations: readonly GroundedCitation[];
  readonly toolExecution?: { readonly toolCallId?: string; readonly toolName?: string; readonly toolLifecycle?: 'completed'|'blocked'|'failed'; readonly deniedReason?: ToolPermissionDeniedReason; readonly errorCode?: string; readonly groundedAnswerInput?: GroundedAnswerInput };
}

@Injectable()
export class HybridRetrievalCoordinatorService {
  constructor(
    private readonly documents: GroundedDocumentRetrievalService,
    private readonly tools: GroundedToolRetrievalService
  ) {}

  async execute(input: HybridRetrievalCoordinatorInput): Promise<HybridRetrievalCoordinatorResult> {
    const toolNeedCount = input.plan.needs.filter((need) => need.kind === 'TOOL').length;
    if (toolNeedCount > 1) {
      const status = input.plan.mode === 'CLARIFY' ? 'CLARIFY' as const : 'UNSUPPORTED' as const;
      return deepFreeze({
        needResults: Object.freeze(input.plan.needs.map((need) => frozen({
          needId: need.id,
          status,
          evidenceRefIds: Object.freeze([] as string[]),
          reasonCode: 'MULTIPLE_TOOL_NEEDS_UNSUPPORTED'
        }))),
        evidence: Object.freeze([]),
        citations: Object.freeze([])
      });
    }
    const results = new Map((input.precovered?.needResults ?? []).map((result) => [result.needId, result]));
    const evidence = [...(input.precovered?.evidence ?? [])];
    const citations = [...(input.precovered?.citations ?? [])];
    let toolExecution: HybridRetrievalCoordinatorResult['toolExecution'];
    for (const need of input.plan.needs) {
      if (results.has(need.id)) continue;
      if (need.kind === 'UNSUPPORTED') {
        results.set(need.id, frozen({ needId: need.id, status: 'UNSUPPORTED', evidenceRefIds: Object.freeze([]), reasonCode: need.reasonCode }));
        continue;
      }
      if (need.kind === 'DOCUMENT') {
        const lane = await this.documents.execute({ ...input.documentInput, need });
        results.set(need.id, lane.needResult); evidence.push(...lane.evidence); citations.push(...lane.citations);
        continue;
      }
      const lane = await this.tools.execute({ ...input.toolInput, need });
      results.set(need.id, lane.needResult); evidence.push(...lane.evidence); citations.push(...lane.citations);
      toolExecution = {
        ...(lane.toolCallId ? { toolCallId: lane.toolCallId } : {}), ...(lane.toolName ? { toolName: lane.toolName } : {}),
        ...(lane.toolLifecycle ? { toolLifecycle: lane.toolLifecycle } : {}), ...(lane.deniedReason ? { deniedReason: lane.deniedReason } : {}),
        ...(lane.errorCode ? { errorCode: lane.errorCode } : {}), ...(lane.groundedAnswerInput ? { groundedAnswerInput: lane.groundedAnswerInput } : {})
      };
    }
    return deepFreeze({
      needResults: Object.freeze(input.plan.needs.map((need): GroundedRetrievalNeedResult => results.get(need.id) ?? frozen({ needId: need.id, status: 'FAILED', evidenceRefIds: Object.freeze([]), reasonCode: 'LANE_RESULT_MISSING' }))),
      evidence: Object.freeze(evidence), citations: Object.freeze(citations), ...(toolExecution ? { toolExecution } : {})
    });
  }
}

function frozen<T>(value: T): T { return Object.freeze(value); }
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    if (!Object.isFrozen(value)) Object.freeze(value);
  }
  return value;
}
