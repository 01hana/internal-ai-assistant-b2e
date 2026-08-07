import { KnowledgeChunkingService } from '../../src/retrieval/knowledge-chunking.service';

describe('knowledge chunking service', () => {
  const service = new KnowledgeChunkingService();

  it('chunks documents by heading and paragraph with stable indexes', () => {
    const chunks = service.chunkDocument({
      documentId: 'knowledge-document-001',
      content: [
        '# 退貨流程',
        '',
        '退貨流程須先確認訂單狀態與收貨紀錄。',
        '',
        '未完成收貨前不得直接退款。'
      ].join('\n')
    });

    expect(chunks).toEqual([
      expect.objectContaining({
        documentId: 'knowledge-document-001',
        chunkIndex: 0,
        heading: '退貨流程',
        content: '退貨流程須先確認訂單狀態與收貨紀錄。',
        enabled: true,
        tokenCount: expect.any(Number)
      }),
      expect.objectContaining({
        documentId: 'knowledge-document-001',
        chunkIndex: 1,
        heading: '退貨流程',
        content: '未完成收貨前不得直接退款。',
        enabled: true,
        tokenCount: expect.any(Number)
      })
    ]);
  });

  it('splits oversized paragraphs deterministically', () => {
    const chunks = service.chunkDocument({
      documentId: 'knowledge-document-001',
      content: 'A'.repeat(12),
      maxChars: 5
    });

    expect(chunks.map((chunk) => chunk.content)).toEqual(['AAAAA', 'AAAAA', 'AA']);
    expect(chunks.map((chunk) => chunk.chunkIndex)).toEqual([0, 1, 2]);
  });

  it('does not emit enabled chunks for empty content', () => {
    expect(
      service.chunkDocument({
        documentId: 'knowledge-document-001',
        content: '\n\n   \n'
      })
    ).toEqual([]);
  });
});
