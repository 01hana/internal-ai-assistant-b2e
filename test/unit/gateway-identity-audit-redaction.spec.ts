import { join } from 'node:path';
import { GatewayIdentityAuditWriter } from '../../apps/gateway/src/audit/gateway-identity-audit.writer';

const writerTarget = join(process.cwd(), 'apps', 'gateway', 'src', 'audit', 'gateway-identity-audit.writer');

describe('Gateway identity audit redaction contract (T018)', () => {
  it('exposes a narrow append-only writer whose input is whitelisted to safe identity-decision fields', () => {
    const target = require(writerTarget) as { GatewayIdentityAuditWriter?: unknown };
    expect(target.GatewayIdentityAuditWriter).toEqual(expect.any(Function));
  });

  it('does not expose generic CRUD or payload-bearing audit surfaces', () => {
    const target = require(writerTarget) as Record<string, unknown>;
    expect(Object.keys(target)).not.toEqual(expect.arrayContaining(['GatewayIdentityAuditController', 'GatewayIdentityAuditRepositoryController']));
  });

  it('maps only whitelisted safe fields to persistence data', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const writer = new GatewayIdentityAuditWriter({ gatewayIdentityAuditEvent: { create } } as never);
    await writer.append({
      requestId: 'request-1', eventType: 'integration_binding_provisioned', outcome: 'success', reasonCode: 'created',
      customerId: 'customer-a', integrationId: 'integration-a', hostApp: 'admin', jti: 'trace-jti', kid: 'key-1',
      ...({ authorization: 'Bearer sentinel', rawJwt: 'header.payload.signature', keyReference: 'provider://private' } as object)
    } as never);

    expect(create).toHaveBeenCalledWith({
      data: {
        requestId: 'request-1', eventType: 'integration_binding_provisioned', outcome: 'success', reasonCode: 'created',
        customerId: 'customer-a', integrationId: 'integration-a', actorId: undefined, hostApp: 'admin', jti: 'trace-jti', kid: 'key-1'
      }
    });
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/authorization|bearer|rawjwt|signature|keyreference|private/i);
  });

  it.each([
    ['eventType', 'Bearer credential-material'],
    ['reasonCode', 'header.payload.signature'],
    ['outcome', '-----BEGIN PRIVATE KEY-----']
  ])('rejects unsafe %s values before persistence without disclosing input', async (field, unsafeValue) => {
    const create = jest.fn();
    const writer = new GatewayIdentityAuditWriter({ gatewayIdentityAuditEvent: { create } } as never);
    const input = {
      requestId: 'request-1', eventType: 'integration_binding_provisioned', outcome: 'success', reasonCode: 'created',
      [field]: unsafeValue
    } as never;

    await expect(writer.append(input)).rejects.toThrow('Invalid Gateway identity audit input.');
    await writer.append(input).catch((error: Error) => expect(error.message).not.toContain(unsafeValue));
    expect(create).not.toHaveBeenCalled();
  });
});
