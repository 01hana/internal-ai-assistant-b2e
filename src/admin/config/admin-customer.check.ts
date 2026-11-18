import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminSettings } from './admin-settings';

/**
 * Feature 014: one deployment serves one customer. The admin API refuses to start unless
 * ADMIN_CUSTOMER_ID names an existing customer, so every Assistant query (Feature 015) has a valid scope.
 */
@Injectable()
export class AdminCustomerCheck implements OnModuleInit {
  constructor(private readonly prisma: PrismaService, private readonly settings: AdminSettings) {}

  async onModuleInit(): Promise<void> {
    const customer = await this.prisma.db.customer.findUnique({ where: { id: this.settings.customerId }, select: { id: true } });
    if (!customer) {
      throw new Error('ADMIN_CUSTOMER_ID does not match any customer in the database.');
    }
  }
}
