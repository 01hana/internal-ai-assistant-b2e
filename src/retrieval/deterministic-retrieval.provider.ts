import { Injectable } from '@nestjs/common';
import { EvidenceSourceType, KnowledgeDocumentStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import {
  RetrievalCandidate,
  RetrievalInput,
  RetrievalProvider,
  RetrievalResult,
  RerankInput,
  RerankResult
} from './retrieval-provider.interface';

const DEFAULT_LIMIT = 6;

@Injectable()
export class DeterministicRetrievalProvider implements RetrievalProvider {
  readonly key = 'deterministic-keyword';

  constructor(private readonly prisma: PrismaService) {}

  async retrieve(input: RetrievalInput): Promise<RetrievalResult> {
    const queryTerms = tokenize(input.query);
    const chunks = await this.prisma.db.knowledgeChunk.findMany({
      where: {
        enabled: true,
        document: {
          status: KnowledgeDocumentStatus.active
        }
      },
      include: {
        document: true
      },
      orderBy: [{ documentId: 'asc' }, { chunkIndex: 'asc' }]
    });

    const candidates = chunks
      .map((chunk: any) => {
        const title = chunk.document?.title ?? '';
        const sourceKey = chunk.document?.sourceKey ?? chunk.documentId;
        const haystack = `${title} ${chunk.heading ?? ''} ${chunk.content}`.toLowerCase();
        const matchedTerms = queryTerms.filter((term) => haystack.includes(term.toLowerCase()));
        const score = queryTerms.length === 0 ? 0 : matchedTerms.length / queryTerms.length;

        return {
          id: `candidate-${chunk.id}`,
          sourceType: EvidenceSourceType.document_chunk,
          sourceId: chunk.id,
          title,
          content: chunk.content,
          score: Number(score.toFixed(4)),
          metadata: {
            chunkId: chunk.id,
            documentId: chunk.documentId,
            sourceKey,
            heading: chunk.heading ?? null,
            matchedTermCount: matchedTerms.length
          }
        } satisfies RetrievalCandidate;
      })
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
      .slice(0, input.limit ?? DEFAULT_LIMIT);

    return {
      provider: this.key,
      candidates,
      metadata: {
        strategy: 'keyword',
        queryTermCount: queryTerms.length
      }
    };
  }

  async rerank(input: RerankInput): Promise<RerankResult> {
    return {
      provider: this.key,
      candidates: [...input.candidates]
        .sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId))
        .slice(0, input.limit ?? input.candidates.length),
      metadata: {
        strategy: 'deterministic_score'
      }
    };
  }
}

function tokenize(value: string): string[] {
  const normalized = value
    .replace(/[，。！？!?；;：:、]/g, ' ')
    .toLowerCase();
  const tokens = normalized.match(/[a-z0-9_-]+|[\u4e00-\u9fff]{2,}/g) ?? [];
  const expanded = tokens.flatMap((token) => expandTerm(token));
  return [...new Set(expanded.filter((token) => token.length > 0))];
}

function expandTerm(term: string): string[] {
  const terms = [term];
  if (term.includes('sop') || term.includes('作業規範')) terms.push('sop', '作業規範');
  if (term.includes('流程')) terms.push('流程');
  if (term.includes('欄位')) terms.push('欄位', '說明');
  if (term.includes('政策')) terms.push('政策');
  if (term.includes('錯誤代碼')) terms.push('錯誤代碼');
  if (term.includes('退貨')) terms.push('退貨');
  return terms;
}
