import { join } from 'node:path';

const healthTarget = join(process.cwd(), 'src', 'health', 'gateway-health.service');

describe('Gateway health and readiness contract', () => {
  it('reports only process health without identity material', () => {
    const target = require(healthTarget) as { GatewayHealthService?: new () => { getHealth(): Record<string, unknown> } };
    const result = new (target.GatewayHealthService as new () => { getHealth(): Record<string, unknown> })().getHealth();

    expect(result).toMatchObject({ status: 'healthy', service: 'identity-gateway' });
    expect(JSON.stringify(result)).not.toMatch(/authorization|bearer|jwt|private|secret|key-reference/i);
  });

  it('states that Phase 1 readiness is not Feature 003 production readiness', () => {
    const target = require(healthTarget) as {
      GatewayHealthService?: new () => { getReadiness(): Record<string, unknown> };
    };
    const result = new (target.GatewayHealthService as new () => { getReadiness(): Record<string, unknown> })().getReadiness();

    expect(result).toMatchObject({
      status: 'not_ready',
      service: 'identity-gateway',
      productionReady: false,
      runtimeDependencies: 'not_evaluated'
    });
    expect(JSON.stringify(result)).not.toMatch(/authorization|bearer|jwt|private|secret|key-reference/i);
  });
});
