import { Test } from '@nestjs/testing';
import { AppConfigModule } from '../../src/common/config/app-config.module';
import { AuditWriterService } from '../../src/audit/audit-writer.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { QueryUnderstandingModule } from '../../src/query-understanding/query-understanding.module';
import { QueryUnderstandingPipeline } from '../../src/query-understanding/query-understanding-pipeline.interface';
import { RuleBasedQueryUnderstandingPipeline } from '../../src/query-understanding/rule-based-query-understanding.pipeline';
import { ToolDiscoveryService } from '../../src/tools/tool-discovery.service';
import { ConversationSemanticReconstructorService } from '../../src/assistant/conversation/conversation-semantic-reconstructor.service';
import { CapabilitySemanticResolverService } from '../../src/capabilities/capability-semantic-resolver.service';
import { CapabilityResolutionService } from '../../src/capabilities/capability-resolution.service';
import { LlmToolSelectionService } from '../../src/query-understanding/llm-tool-selection.service';

describe('QueryUnderstandingModule wiring', () => {
  it('binds QueryUnderstandingPipeline token to the rule-based default pipeline', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, QueryUnderstandingModule]
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
    expect(moduleRef.get(ToolDiscoveryService)).toBeInstanceOf(ToolDiscoveryService);
    expect(moduleRef.get(ConversationSemanticReconstructorService)).toBeInstanceOf(ConversationSemanticReconstructorService);
    expect(moduleRef.get(CapabilitySemanticResolverService)).toBeInstanceOf(CapabilitySemanticResolverService);
    expect(moduleRef.get(CapabilityResolutionService)).toBeInstanceOf(CapabilityResolutionService);
    expect(moduleRef.get(LlmToolSelectionService)).toBeInstanceOf(LlmToolSelectionService);
    expect(pipeline).toHaveProperty('llmToolSelection', moduleRef.get(LlmToolSelectionService));
    expect(pipeline).toHaveProperty('capabilityResolution', moduleRef.get(CapabilityResolutionService));
    expect(pipeline).not.toHaveProperty('toolDiscovery');
  });
});
