import { redactSecrets } from '../../src/common/logger/redaction.util';
import { StructuredLogEntry, StructuredLoggerService } from '../../src/common/logger/structured-logger.service';
import { createInternalIdentityJwtFixture } from '../support/internal-identity-jwt.helper';

describe('redactSecrets', () => {
  it('redacts known secret keys and secret-looking values', () => {
    const redacted = redactSecrets({
      openaiApiKey: 'sk-proj-secret-value-1234567890',
      databaseUrl: 'postgresql://assistant:super-secret@localhost:5432/db',
      nested: {
        connectorSecret: 'connector-secret-value'
      },
      message: 'Authorization Bearer very-secret-token-value'
    });

    expect(JSON.stringify(redacted)).not.toContain('sk-proj-secret-value');
    expect(JSON.stringify(redacted)).not.toContain('super-secret');
    expect(JSON.stringify(redacted)).not.toContain('connector-secret-value');
    expect(JSON.stringify(redacted)).not.toContain('very-secret-token-value');
  });

  it('does not retain raw internal JWT or JWKS private material in authorization metadata', () => {
    const token = createInternalIdentityJwtFixture().sign();
    const privateMaterial = 'test-private-jwks-material';
    const redacted = redactSecrets({
      authorization: `Bearer ${token}`,
      authMetadata: { authorization: { token, privateMaterial } }
    });

    expect(JSON.stringify(redacted)).not.toContain(token);
    expect(JSON.stringify(redacted)).not.toContain(privateMaterial);
  });
});

describe('StructuredLoggerService', () => {
  it('writes structured redacted log entries', () => {
    const entries: StructuredLogEntry[] = [];
    const logger = new StructuredLoggerService((entry) => entries.push(entry));

    logger.write('info', 'using sk-proj-secret-value-1234567890', 'TestContext', {
      requestId: 'req-001',
      password: 'plain-password'
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      level: 'info',
      context: 'TestContext'
    });
    expect(JSON.stringify(entries[0])).not.toContain('sk-proj-secret-value');
    expect(JSON.stringify(entries[0])).not.toContain('plain-password');
  });

  it('does not write Authorization or JWT signature values to structured entries', () => {
    const entries: StructuredLogEntry[] = [];
    const logger = new StructuredLoggerService((entry) => entries.push(entry));
    const token = createInternalIdentityJwtFixture().sign();

    logger.write('info', `Bearer ${token}`, 'Identity', { authorization: `Bearer ${token}` });

    expect(JSON.stringify(entries)).not.toContain(token);
  });
});
