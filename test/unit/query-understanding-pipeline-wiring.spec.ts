import { Test } from '@nestjs/testing';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryUnderstandingModule } from '../../src/query-understanding/query-understanding.module';
import { QueryUnderstandingPipeline } from '../../src/query-understanding/query-understanding-pipeline.interface';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';

describe('QueryUnderstandingModule wiring', () => {
  it('binds QueryUnderstandingPipeline token to the rule-based default pipeline', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [QueryUnderstandingModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        db: {
          queryUnderstandingResult: {
            upsert: jest.fn()
          },
          auditEvent: {
            create: jest.fn()
          }
        }
      })
      .overrideProvider(AuditWriterService)
      .useValue({ append: jest.fn() })
      .compile();

    const pipeline = moduleRef.get<QueryUnderstandingPipeline>('QueryUnderstandingPipeline');

    expect(pipeline).toBeInstanceOf(RuleBasedQueryUnderstandingPipeline);
    expect(moduleRef.get(RuleBasedQueryUnderstandingPipeline)).toBe(pipeline);
  });
});
