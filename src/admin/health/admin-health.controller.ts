import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PublicRoute } from '../authorization/route-access.decorator';

/** Feature 014: liveness and database check for `local:start`, `local:status` and the container healthcheck. */
@Controller('health')
export class AdminHealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @PublicRoute()
  async check(): Promise<{ status: 'healthy' }> {
    try {
      await this.prisma.db.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ error: 'database_unavailable', message: 'Database is not reachable.' });
    }
    return { status: 'healthy' };
  }
}
