import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionDraftService } from '../approvals/action-draft.service';
import { ApprovalRequestService } from '../approvals/approval-request.service';
import { EscalationRequestService } from '../approvals/escalation-request.service';
import { EnvironmentVariables } from '../common/config/env.validation';
import { MockConnectorAdapter } from '../connectors/mock/mock-connector.adapter';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { PrismaService } from '../prisma/prisma.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { DependencyHealthSnapshot, DependencyHealthStatus } from './dependency-health.types';

@Injectable()
export class DependencyHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly llmExecutionService: LlmExecutionService,
    private readonly retrievalService: RetrievalService,
    private readonly mockConnector: MockConnectorAdapter,
    private readonly toolRegistry: ToolRegistryService,
    private readonly actionDraftService: ActionDraftService,
    private readonly approvalRequestService: ApprovalRequestService,
    private readonly escalationRequestService: EscalationRequestService
  ) {}

  async checkDependencies(): Promise<DependencyHealthSnapshot> {
    const [database, llm, retrieval, connector, approvalWorkflow] = await Promise.all([
      this.checkDatabase(),
      this.checkLlm(),
      this.checkRetrieval(),
      this.checkConnector(),
      this.checkApprovalWorkflow()
    ]);

    return {
      database,
      llm,
      retrieval,
      connector,
      approval_workflow: approvalWorkflow
    };
  }

  private async checkDatabase(): Promise<DependencyHealthStatus> {
    return this.probe(async () => {
      await this.prisma.db.$queryRaw`SELECT 1`;
    }, 'database_unreachable');
  }

  private async checkLlm(): Promise<DependencyHealthStatus> {
    return this.probe(async () => {
      const provider = this.configService.get('LLM_PROVIDER', { infer: true });
      const model = this.configService.get('LLM_MODEL', { infer: true });
      if (!provider || !model || !this.llmExecutionService) {
        throw new Error('LLM provider is not configured.');
      }
    }, 'llm_provider_not_configured');
  }

  private async checkRetrieval(): Promise<DependencyHealthStatus> {
    return this.probe(async () => {
      if (!this.retrievalService) {
        throw new Error('Retrieval service is unavailable.');
      }
    }, 'retrieval_unavailable');
  }

  private async checkConnector(): Promise<DependencyHealthStatus> {
    const startedAt = Date.now();
    try {
      const [connectorStatus, tools] = await Promise.all([this.mockConnector.healthCheck(), this.toolRegistry.listTools()]);
      const activeMockTools = tools.filter((tool) => tool.active && tool.connectorKey === this.mockConnector.key);
      const checkedAt = new Date().toISOString();
      const durationMs = Math.max(0, Date.now() - startedAt);

      if (connectorStatus.status === 'unavailable') {
        return { status: 'unavailable', reason: 'connector_unavailable', checkedAt, durationMs };
      }
      if (activeMockTools.length === 0) {
        return { status: 'degraded', reason: 'connector_registry_empty', checkedAt, durationMs };
      }
      if (connectorStatus.status === 'degraded') {
        return { status: 'degraded', reason: 'connector_degraded', checkedAt, durationMs };
      }

      return { status: 'healthy', checkedAt, durationMs };
    } catch {
      return this.unavailable('dependency_probe_failed', startedAt);
    }
  }

  private async checkApprovalWorkflow(): Promise<DependencyHealthStatus> {
    return this.probe(async () => {
      if (!this.actionDraftService || !this.approvalRequestService || !this.escalationRequestService) {
        throw new Error('Approval workflow is unavailable.');
      }
    }, 'approval_workflow_unavailable');
  }

  private async probe(operation: () => Promise<void>, unavailableReason: string): Promise<DependencyHealthStatus> {
    const startedAt = Date.now();
    try {
      await operation();
      return {
        status: 'healthy',
        checkedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - startedAt)
      };
    } catch {
      return this.unavailable(unavailableReason, startedAt);
    }
  }

  private unavailable(reason: string, startedAt: number): DependencyHealthStatus {
    return {
      status: 'unavailable',
      reason,
      checkedAt: new Date().toISOString(),
      durationMs: Math.max(0, Date.now() - startedAt)
    };
  }
}
