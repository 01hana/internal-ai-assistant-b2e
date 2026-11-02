import { AnswerDecisionStatus, AssistantMessageRole, ToolCallStatus } from '../../generated/prisma/enums';
import { AssistantHistorySanitizer } from './assistant-history.sanitizer';
import { AssistantHistoryMessage } from './assistant-history.types';
import { presentSimpleBold } from '../generation/answer-presentation';

/**
 * Evidence reaches this mapper only after the history service applies the
 * Customer-qualified message predicate. Mapping is intentionally not an
 * authorization layer and must not perform a second, application-side filter.
 */
export interface CustomerScopedHistoryEvidenceRef {
  id: string;
  customerId: string;
  messageId: string | null;
  sourceType?: string;
  fieldPaths?: string[];
  permissionSnapshot?: unknown;
  summary?: unknown;
}

export function mapAssistantHistoryMessage(
  message: {
    id: string;
    role: AssistantMessageRole;
    content: string;
    createdAt: Date;
    answerDecision: AnswerDecisionStatus | null;
  },
  toolCalls: Array<{
    id: string;
    status: ToolCallStatus;
  }>,
  evidenceRefs: CustomerScopedHistoryEvidenceRef[],
  permissionScopes: string[],
  answerMetadata?: unknown
): AssistantHistoryMessage {
  const response: AssistantHistoryMessage = {
    messageId: message.id,
    role: message.role,
    content: message.role === AssistantMessageRole.assistant
      ? presentSimpleBold(presentLegacyCitations(message.content, answerMetadata, evidenceRefs)) : message.content,
    createdAt: message.createdAt.toISOString()
  };

  if (message.role === AssistantMessageRole.assistant) {
    const artifacts = new AssistantHistorySanitizer().sanitizeAssistantArtifacts({
      toolCalls,
      evidenceRefs,
      permissionScopes
    });

    response.answerDecision = message.answerDecision ?? AnswerDecisionStatus.answered;
    response.evidenceRefs = artifacts.evidenceRefs;
    response.toolSummary = artifacts.toolSummary;
  }

  return response;
}

function presentLegacyCitations(content: string, metadata: unknown, evidenceRefs: CustomerScopedHistoryEvidenceRef[]): string {
  const needs = isObject(metadata) && Array.isArray(metadata.needResults) ? metadata.needResults : [];
  const evidenceById = new Map(evidenceRefs.map((evidence) => [evidence.id, evidence]));
  if (!content.includes('[citation-')) return presentOlderNumberedAnswer(content, needs, evidenceById);
  const rendered = new Map<string, { number: number; label: string }>();
  const sourceNumbers = new Map<string, number>();
  const matches = [...content.matchAll(/\[citation-([^\]\n]{1,120})\]/g)];
  for (const match of matches) {
    const source = resolveLegacySource(match[1], needs, evidenceById);
    if (source && !rendered.has(match[0])) {
      if (!sourceNumbers.has(source.id)) sourceNumbers.set(source.id, sourceNumbers.size + 1);
      rendered.set(match[0], { number: sourceNumbers.get(source.id)!, label: source.label });
    }
  }
  const single = sourceNumbers.size === 1;
  const answer = content.replace(/[ \t]*\[citation-([^\]\n]{1,120})\]/g, (_marker, suffix: string) => {
    const key = `[citation-${suffix}]`;
    const source = rendered.get(key);
    if (!source) return '〔來源待驗證〕';
    return single ? '' : `〔${source.number}〕`;
  }).trimEnd();
  if (rendered.size === 0 || answer.includes('資料來源：')) return answer;
  const distinctSources = [...new Map([...rendered.values()].map((source) => [source.number, source])).values()];
  return `${answer}\n\n資料來源：${distinctSources.map((source) => single ? source.label : `〔${source.number}〕${source.label}`).join('；')}`;
}

function resolveLegacySource(
  suffix: string, needs: unknown[], evidenceById: Map<string, CustomerScopedHistoryEvidenceRef>
): { id: string; label: string } | undefined {
  const match = /^(.*)-(\d+)$/.exec(suffix);
  const need = needs.find((item) => isObject(item) && item.needId === match?.[1]);
  const index = Number(match?.[2]);
  const id = isObject(need) && Array.isArray(need.evidenceRefIds) && index >= 1
    ? need.evidenceRefIds[index - 1] : undefined;
  const evidence = typeof id === 'string' ? evidenceById.get(id) : undefined;
  const label = evidence?.sourceType === 'structured_record' ? '內部資料查詢'
    : evidence?.sourceType === 'document_chunk' ? '文件' : undefined;
  return label && evidence ? { id: evidence.id, label } : undefined;
}

function presentOlderNumberedAnswer(
  content: string, needs: unknown[], evidenceById: Map<string, CustomerScopedHistoryEvidenceRef>
): string {
  const match = /\n\n?資料來源：〔1〕(內部資料查詢|文件)$/.exec(content);
  if (!match || !content.includes('〔1〕')) return content;
  const verified = needs.flatMap((need) => isObject(need) && Array.isArray(need.evidenceRefIds)
    ? need.evidenceRefIds.filter((id): id is string => typeof id === 'string') : []);
  const distinct = [...new Set(verified)];
  if (distinct.length !== 1) return content;
  const evidence = evidenceById.get(distinct[0]);
  const label = evidence?.sourceType === 'structured_record' ? '內部資料查詢'
    : evidence?.sourceType === 'document_chunk' ? '文件' : undefined;
  if (label !== match[1]) return content;
  return `${content.slice(0, match.index).replace(/[ \t]*〔1〕/g, '').trimEnd()}\n\n資料來源：${label}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
