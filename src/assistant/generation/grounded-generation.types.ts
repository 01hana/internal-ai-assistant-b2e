import type { ExecutionDecision, RiskLevel } from '../../generated/prisma/enums';
import type { AssistantSafeGateDecision } from '../answer/no-answer-gate.service';
import type { GroundedContextBundleV1 } from '../grounding/grounded-context-bundle.types';
import type { RetrievalCoverage } from '../../retrieval/grounded-retrieval.types';

export type GenerationEligibilityBlockReason =
  | 'INVALID_GROUNDING'
  | 'SAFE_GATE_BLOCKED'
  | 'RISK_BLOCKED'
  | 'CONFIRMATION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'ESCALATION_REQUIRED'
  | 'CLARIFY'
  | 'INSUFFICIENT'
  | 'NO_COVERED_EVIDENCE'
  | 'CONTEXT_NOT_REVALIDATED';

export interface GenerationEligibilityInput {
  readonly bundle: GroundedContextBundleV1;
  readonly executionDecision: ExecutionDecision;
  readonly riskLevel: RiskLevel;
  readonly safeGate?: AssistantSafeGateDecision;
  readonly groundingValid: boolean;
  readonly priorEvidenceRevalidated: boolean;
}

export type GenerationEligibilityDecision =
  | Readonly<{
      kind: 'ELIGIBLE';
      coverage: Extract<RetrievalCoverage, 'COMPLETE' | 'PARTIAL'>;
      evidenceRefIds: readonly string[];
      citationIds: readonly string[];
    }>
  | Readonly<{ kind: 'BLOCKED'; reasonCode: GenerationEligibilityBlockReason }>;

export interface GroundedGenerationContextV1 {
  readonly version: '1';
  readonly coverage: Extract<RetrievalCoverage, 'COMPLETE' | 'PARTIAL'>;
  readonly currentQuestion: Readonly<{ trustClass: 'UNTRUSTED_USER_TEXT'; text: string }>;
  readonly priorExchanges: readonly Readonly<{
    userText: string;
    assistantText: string;
    trustClass: 'COMPLETED_ASSISTANT_TEXT';
  }>[];
  readonly documentEvidence: readonly Readonly<{
    evidenceRefId: string;
    citationId: string;
    trustClass: 'UNTRUSTED_DOCUMENT_EVIDENCE';
    text: string;
  }>[];
  readonly toolEvidence: readonly Readonly<{
    evidenceRefId: string;
    citationId: string;
    trustClass: 'SERVER_PROJECTED_TOOL_EVIDENCE';
    facts: Readonly<Record<string, string | number | boolean | null>>;
  }>[];
  readonly unsupportedNeeds: readonly Readonly<{ needId: string; reasonCode: string }>[];
  readonly allowedCitationIds: readonly string[];
  readonly allowedEvidenceRefIds: readonly string[];
}

export type GenerationFailureReason =
  | 'PROVIDER_ERROR'
  | 'PROVIDER_TIMEOUT'
  | 'CANCELLED'
  | 'INVALID_OUTPUT'
  | 'OUTPUT_LIMIT_EXCEEDED'
  | 'CORE_PERSISTENCE_FAILED';

export interface GenerationAttemptV1 {
  readonly requestId: string;
  readonly status: 'STARTED';
}

export interface GenerationTerminalMetadataV1 {
  readonly finishReason: 'STOP' | 'LENGTH' | 'ERROR' | 'CANCELLED';
  readonly outputBytes: number;
}

export type GenerationStreamChunkV1 =
  | Readonly<{ kind: 'TEXT_DELTA'; text: string }>
  | Readonly<{ kind: 'TERMINAL'; metadata: GenerationTerminalMetadataV1 }>;

export type GenerationResultV1 =
  | Readonly<{ kind: 'COMPLETED'; text: string; terminal: GenerationTerminalMetadataV1 }>
  | Readonly<{ kind: 'FAILED'; reasonCode: GenerationFailureReason }>;
