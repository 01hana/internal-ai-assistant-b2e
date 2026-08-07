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
    const discriminatorTerms = tokenizeRequiredTerms(input.query).filter((term) => term.includes('_') || term.includes('-'));
    const chunks = await this.prisma.db.$queryRaw<AuthorizedKnowledgeChunkRow[]>`
      SELECT
        chunk."id" AS "id",
        chunk."customerId" AS "customerId",
        chunk."documentId" AS "documentId",
        chunk."chunkIndex" AS "chunkIndex",
        chunk."heading" AS "heading",
        chunk."content" AS "content",
        document."title" AS "title",
        document."sourceKey" AS "sourceKey"
      FROM "KnowledgeChunk" AS chunk
      INNER JOIN "KnowledgeDocument" AS document
        ON document."customerId" = chunk."customerId"
        AND document."id" = chunk."documentId"
      WHERE chunk."customerId" = ${input.customerScope.customerId}
        AND chunk."enabled" = true
        AND document."customerId" = ${input.customerScope.customerId}
        AND document."status" = ${KnowledgeDocumentStatus.active}
        AND document."organizationIds" IS NOT NULL
        AND document."requiredPermissionScopes" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(document."organizationIds") AS organization_id(value)
          WHERE btrim(organization_id.value) = ''
            OR organization_id.value <> btrim(organization_id.value)
        )
        AND cardinality(document."organizationIds") = (
          SELECT count(DISTINCT organization_id.value)
          FROM unnest(document."organizationIds") AS organization_id(value)
        )
        AND NOT EXISTS (
          SELECT 1
          FROM unnest(document."requiredPermissionScopes") AS permission_scope(value)
          WHERE btrim(permission_scope.value) = ''
            OR permission_scope.value <> btrim(permission_scope.value)
        )
        AND cardinality(document."requiredPermissionScopes") = (
          SELECT count(DISTINCT permission_scope.value)
          FROM unnest(document."requiredPermissionScopes") AS permission_scope(value)
        )
        AND (
          (
            document."visibility" = 'CUSTOMER'::"KnowledgeVisibility"
            AND cardinality(document."organizationIds") = 0
          )
          OR (
            document."visibility" = 'ORGANIZATION'::"KnowledgeVisibility"
            AND cardinality(document."organizationIds") > 0
            AND document."organizationIds" @> ARRAY[${input.customerScope.organizationId}]::text[]
          )
        )
        AND document."requiredPermissionScopes" <@ ${input.customerScope.permissionScopes}::text[]
      ORDER BY chunk."documentId" ASC, chunk."chunkIndex" ASC
    `;

    const candidates = chunks
      .map((chunk) => {
        const title = chunk.title;
        const sourceKey = chunk.sourceKey;
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
          },
          matchesDiscriminator: discriminatorTerms.length === 0 || discriminatorTerms.some((term) => haystack.includes(term))
        } satisfies ScoredRetrievalCandidate;
      })
      // Fixture/discriminator terms must match an already-authorized row. This
      // prevents generic shared terms from turning inaccessible, marker-specific
      // queries into grounded answers without making natural-language question
      // words mandatory retrieval terms.
      .filter((candidate) => candidate.score > 0 && candidate.matchesDiscriminator)
      .map(({ matchesDiscriminator: _matchesDiscriminator, ...candidate }) => candidate)
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

interface AuthorizedKnowledgeChunkRow {
  id: string;
  customerId: string;
  documentId: string;
  chunkIndex: number;
  heading: string | null;
  content: string;
  title: string;
  sourceKey: string;
}

type ScoredRetrievalCandidate = RetrievalCandidate & {
  matchesDiscriminator: boolean;
};

function tokenize(value: string): string[] {
  const tokens = tokenizeRequiredTerms(value);
  const expanded = tokens.flatMap((token) => expandTerm(token));
  return [...new Set(expanded.filter((token) => token.length > 0))];
}

function tokenizeRequiredTerms(value: string): string[] {
  const normalized = value
    .replace(/[，。！？!?；;：:、]/g, ' ')
    .toLowerCase();
  return [...new Set(normalized.match(/[a-z0-9_-]+|[\u4e00-\u9fff]{2,}/g) ?? [])];
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
