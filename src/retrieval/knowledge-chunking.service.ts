import { Injectable } from '@nestjs/common';

export interface ChunkKnowledgeDocumentInput {
  documentId: string;
  content: string;
  maxChars?: number;
}

export interface KnowledgeChunkDraft {
  documentId: string;
  chunkIndex: number;
  heading?: string;
  content: string;
  tokenCount: number;
  enabled: boolean;
}

@Injectable()
export class KnowledgeChunkingService {
  chunkDocument(input: ChunkKnowledgeDocumentInput): KnowledgeChunkDraft[] {
    const maxChars = input.maxChars ?? 700;
    const paragraphs = input.content
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    const chunks: KnowledgeChunkDraft[] = [];
    let heading: string | undefined;

    for (const paragraph of paragraphs) {
      if (isHeading(paragraph)) {
        heading = normalizeHeading(paragraph);
        continue;
      }

      for (const content of splitBySize(paragraph, maxChars)) {
        chunks.push({
          documentId: input.documentId,
          chunkIndex: chunks.length,
          heading,
          content,
          tokenCount: estimateTokenCount(content),
          enabled: content.length > 0
        });
      }
    }

    return chunks;
  }
}

function isHeading(value: string): boolean {
  return /^#{1,3}\s+/.test(value) || /^第.+[章節]\s*/.test(value);
}

function normalizeHeading(value: string): string {
  return value.replace(/^#{1,3}\s+/, '').trim();
}

function splitBySize(value: string, maxChars: number): string[] {
  if (value.length <= maxChars) {
    return [value];
  }

  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += maxChars) {
    chunks.push(value.slice(offset, offset + maxChars).trim());
  }
  return chunks.filter(Boolean);
}

function estimateTokenCount(value: string): number {
  const asciiWords = value.match(/[A-Za-z0-9_-]+/g)?.length ?? 0;
  const cjkChars = value.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  return asciiWords + cjkChars;
}
