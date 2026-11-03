import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActionDraftService } from '../approvals/action-draft.service';
import { ApprovalRequestService } from '../approvals/approval-request.service';
import { EscalationRequestService } from '../approvals/escalation-request.service';
import { EnvironmentVariables } from '../common/config/env.validation';
import { DATA_ADAPTER_REGISTRATIONS, DataAdapterRegistrations } from '../connectors/data-adapter-registration';
import { LlmExecutionService } from '../llm/llm-execution.service';
import { PrismaService } from '../prisma/prisma.service';
import { RetrievalService } from '../retrieval/retrieval.service';
import { DependencyHealthSnapshot, DependencyHealthStatus } from './dependency-health.types';

@Injectable()
export class DependencyHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
    private readonly llmExecutionService: LlmExecutionService,
    private readonly retrievalService: RetrievalService,
    @Inject(DATA_ADAPTER_REGISTRATIONS) private readonly registrations: DataAdapterRegistrations,
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
      if (this.registrations.some((registration) => typeof registration.active !== 'boolean')) {
        return this.unavailable('connector_unavailable', startedAt);
      }
      const active = this.registrations.filter((registration) => registration.active);
      if (active.length === 0) {
        return { status: 'degraded', reason: 'connector_registry_empty', checkedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - startedAt) };
      }
      const bindings = new Set<string>();
      for (const registration of active) {
        const binding = [registration.customerId, registration.integrationId, registration.hostApp, registration.connectorKey];
        if (binding.some((value) => typeof value !== 'string' || !value.trim() || value === '*') || !registration.adapter || typeof registration.adapter.healthCheck !== 'function') {
          return this.unavailable('connector_unavailable', startedAt);
        }
        const key = JSON.stringify(binding);
        if (bindings.has(key)) {
          return this.unavailable('connector_unavailable', startedAt);
        }
        bindings.add(key);
      }
      const statuses = await Promise.all(active.map(async (registration) => {
        try {
          const probe = await boundedConnectorProbe(registration.adapter.healthCheck());
          return probe.status === 'healthy' || probe.status === 'degraded' || probe.status === 'unavailable'
            ? probe.status : 'unavailable';
        } catch {
          return 'unavailable';
        }
      }));
      const resultAt = new Date().toISOString();
      const elapsed = Math.max(0, Date.now() - startedAt);
      if (statuses.every((status) => status === 'healthy')) {
        return { status: 'healthy', checkedAt: resultAt, durationMs: elapsed };
      }
      if (statuses.every((status) => status === 'unavailable')) {
        return { status: 'unavailable', reason: 'connector_unavailable', checkedAt: resultAt, durationMs: elapsed };
      }
      return { status: 'degraded', reason: 'connector_degraded', checkedAt: resultAt, durationMs: elapsed };
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

async function boundedConnectorProbe<T>(probe: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('probe timeout')), 3000); })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
