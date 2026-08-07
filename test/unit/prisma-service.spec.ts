import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../src/common/config/env.validation';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('PrismaService', () => {
  it('requires DATABASE_URL through ConfigService', () => {
    const config = {
      getOrThrow: jest.fn(() => 'postgresql://assistant:secret@localhost:5432/assistant_dev')
    } as unknown as ConfigService<EnvironmentVariables>;

    const service = new PrismaService(config);

    expect(service.db).toBeDefined();
    expect(config.getOrThrow).toHaveBeenCalledWith('DATABASE_URL');
  });
});
