import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  MAX_COMPLETED_EXCHANGES,
  MAX_CONTEXT_ARRAY_ITEMS,
  MAX_CONTEXT_METADATA_BYTES,
  MAX_CONTEXT_OBJECT_KEYS,
  MAX_CONTEXT_SOURCE_DEPTH,
  MAX_PRIOR_EVIDENCE_REFS
} from '../../src/assistant/conversation/conversation-limits';
import { ConversationSourceGuard } from '../../src/assistant/conversation/conversation-source-guard';
import { ConversationContextLoaderService } from '../../src/assistant/conversation/conversation-context-loader.service';

const ROOT = resolve(__dirname, '../..');

describe('Feature 010 Phase 2 bounded conversation-context contract (T022)', () => {
  it('pins the four-exchange/four-reference and recursive source bounds', () => {
    expect(MAX_COMPLETED_EXCHANGES).toBe(4);
    expect(MAX_PRIOR_EVIDENCE_REFS).toBe(4);
    expect(MAX_CONTEXT_SOURCE_DEPTH).toBe(4);
    expect(MAX_CONTEXT_ARRAY_ITEMS).toBe(100);
    expect(MAX_CONTEXT_OBJECT_KEYS).toBe(32);
    expect(MAX_CONTEXT_METADATA_BYTES).toBe(16 * 1024);
  });

  it.each([
    'accessToken', 'authorization', 'jwt', 'proof', 'credentials', 'connectorContextRef',
    'opaqueHandle', 'rawConnectorResponse', 'preProjectionData', 'adapterKey', 'connectorKey',
    'deploymentKey', 'operationKey', 'toolDefinitionId', 'permissionSnapshot'
  ])('rejects prohibited source category %s', (key) => {
    const result = new ConversationSourceGuard().guard({ safe: { [key]: 'sensitive' } });
    expect(result).toEqual({ accepted: false, reasonCode: 'PROHIBITED_CONTEXT_SOURCE' });
  });

  it('keeps semantic frames descriptive and non-authoritative', () => {
    const source = text('src/assistant/conversation/conversation.types.ts');
    const frame = source.match(/export interface ConversationSemanticFrame \{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(frame).toMatch(/resource.*intent.*metricOrAspect.*timeRange.*entity.*topicKey/s);
    expect(frame).not.toMatch(/tool|operation|permission|connector|adapter|deployment|credential|raw/i);
  });

  it('requires all active scope dimensions at the repository query boundary', () => {
    const source = text('src/assistant/conversation/conversation-context.repository.ts');
    expect(source).toMatch(/customerId:[\s\S]*id:[\s\S]*organizationId:[\s\S]*hostApp:[\s\S]*actorId:[\s\S]*status: AssistantSessionStatus\.active/);
  });

  it('adds no controller, cross-session memory store, or public Assistant contract field', () => {
    const conversationFiles = listFiles(join(ROOT, 'src/assistant/conversation'));
    expect(conversationFiles.some((path) => /controller|memory/i.test(path))).toBe(false);
    expect(conversationFiles.map((path) => readFileSync(path, 'utf8')).join('\n')).not.toMatch(/@(Controller|Get|Post|Patch|Delete)\b/);

    for (const path of [
      'src/assistant/assistant.controller.ts',
      'src/assistant/dto/assistant.dto.ts',
      'src/common/sse/sse-event.types.ts',
      'src/assistant/sse/assistant-sse.types.ts',
      'src/assistant/history/assistant-history.types.ts'
    ]) {
      expect(text(path)).not.toMatch(/priorConversationContext|ConversationSemanticFrame|conversation_context_(?:loaded|rejected)/);
    }
  });

  it.each([MAX_PRIOR_EVIDENCE_REFS, 2])(
    'keeps nested EvidenceRef identity surfaces within the global bound of %s',
    async (maxEvidenceRefs) => {
      const scope = Object.freeze({
        customerId: 'customer-a', sessionId: 'session-1', organizationId: 'org-1', hostApp: 'erp', actorId: 'actor-1'
      });
      const evidence = Array.from({ length: 6 }, (_, index) => ({
        id: `evidence-${index + 1}`, sourceType: 'document_chunk', sourceId: `chunk-${index + 1}`
      }));
      const loader = new ConversationContextLoaderService({
        loadScopedContext: async () => [{
          exchangeId: 'exchange-1', requestId: 'request-1', scope, sessionStatus: 'active', completed: true,
          userMessage: { id: 'user-1', content: 'safe question' },
          assistantMessage: { id: 'assistant-1' }, answerDecision: { status: 'answered' }, evidence,
          createdAt: '2026-09-17T00:00:00.000Z'
        }]
      });

      const context = await loader.load({ scope, maxEvidenceRefs });
      const nestedIds = new Set(context.exchanges.flatMap((exchange) => exchange.evidenceRefIds));
      expect(context.evidenceRefs).toHaveLength(maxEvidenceRefs);
      expect(context.evidenceRefIds).toHaveLength(maxEvidenceRefs);
      expect(nestedIds.size).toBeLessThanOrEqual(maxEvidenceRefs);
      expect([...nestedIds].every((id) => context.evidenceRefIds.includes(id))).toBe(true);
    }
  );
});

function text(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function listFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return statSync(path).isDirectory()
    ? readdirSync(path).flatMap((entry) => listFiles(join(path, entry)))
    : [path];
}
