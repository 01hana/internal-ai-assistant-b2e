import { BadRequestException } from '@nestjs/common';
import { GlobalExceptionFilter } from '../../src/common/errors/global-exception.filter';
import { redactSecrets } from '../../src/common/logger/redaction.util';
import { StructuredLogEntry, StructuredLoggerService } from '../../src/common/logger/structured-logger.service';

describe('secret redaction foundation', () => {
  it('redacts OpenAI credentials, connector secrets, and database credentials from logs', () => {
    const entries: StructuredLogEntry[] = [];
    const logger = new StructuredLoggerService((entry) => entries.push(entry));

    logger.write('error', 'failed with sk-proj-secret-value-1234567890', 'SecretTest', {
      connectorSecret: 'connector-secret-value',
      databaseUrl: 'postgresql://assistant:db-password@localhost:5432/assistant_dev'
    });

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('sk-proj-secret-value');
    expect(serialized).not.toContain('connector-secret-value');
    expect(serialized).not.toContain('db-password');
  });

  it('redacts secret-looking values before they can enter error payloads', () => {
    const filter = new GlobalExceptionFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ requestId: 'req-secret-test' }),
        getResponse: () => response
      })
    };

    filter.catch(new BadRequestException('sk-proj-secret-value-1234567890'), host as never);

    expect(JSON.stringify(response.json.mock.calls[0][0])).not.toContain('sk-proj-secret-value');
  });

  it('redacts arbitrary audit-like metadata objects', () => {
    const metadata = redactSecrets({
      openaiApiKey: 'sk-proj-secret-value-1234567890',
      connectorSecret: 'connector-secret-value',
      databaseUrl: 'postgresql://assistant:db-password@localhost:5432/assistant_dev'
    });

    expect(JSON.stringify(metadata)).not.toContain('sk-proj-secret-value');
    expect(JSON.stringify(metadata)).not.toContain('connector-secret-value');
    expect(JSON.stringify(metadata)).not.toContain('db-password');
  });
});
