import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../common/config/env.validation';
import { PrismaClient } from '../generated/prisma/client';
import { createPrismaClient } from './prisma-client.factory';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly client: PrismaClient;

  constructor(configService: ConfigService<EnvironmentVariables>) {
    const databaseUrl = configService.getOrThrow<string>('DATABASE_URL');
    this.client = createPrismaClient(databaseUrl);
  }

  async onModuleInit() {
    try {
      await this.client.$connect();
    } catch {
      throw new ServiceUnavailableException('Database connection failed.');
    }
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }

  get db(): PrismaClient {
    return this.client;
  }
}
