import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';

const bridgeRoot = join(__dirname, '..');

describe('Identity Bridge Phase 1 health contract', () => {
  it('serves process liveness and an intentionally not-ready local shell without identity material', async () => {
    expect(existsSync(join(bridgeRoot, 'src/bridge.module.ts'))).toBe(true);
    const target = require(join(bridgeRoot, 'src/bridge.module')) as { BridgeModule?: unknown };
    const controllerTarget = require(join(bridgeRoot, 'src/health/bridge-health.controller')) as {
      BridgeHealthController?: new () => { getHealth(): Record<string, unknown>; getReadiness(): Record<string, unknown> };
    };
    expect(target.BridgeModule).toBeDefined();
    expect(controllerTarget.BridgeHealthController).toBeDefined();

    const module = await Test.createTestingModule({ imports: [target.BridgeModule as never] }).compile();
    const controller = module.get(controllerTarget.BridgeHealthController as never) as { getHealth(): Record<string, unknown>; getReadiness(): Record<string, unknown> };
    expect(Reflect.getMetadata(PATH_METADATA, controllerTarget.BridgeHealthController!.prototype.getHealth)).toBe('health');
    expect(Reflect.getMetadata(METHOD_METADATA, controllerTarget.BridgeHealthController!.prototype.getHealth)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PATH_METADATA, controllerTarget.BridgeHealthController!.prototype.getReadiness)).toBe('ready');
    expect(Reflect.getMetadata(METHOD_METADATA, controllerTarget.BridgeHealthController!.prototype.getReadiness)).toBe(RequestMethod.GET);

    const health = controller.getHealth();
    expect(health).toMatchObject({ status: 'healthy', service: 'identity-bridge' });
    const readiness = controller.getReadiness();
    expect(readiness).toMatchObject({ status: 'not_ready', service: 'identity-bridge', runtimeDependencies: 'not_evaluated', productionReady: false });
    expect(`${JSON.stringify(health)}${JSON.stringify(readiness)}`).not.toMatch(/authorization|bearer|jwt|private|secret|key-reference|idx|customer/i);
  });
});
