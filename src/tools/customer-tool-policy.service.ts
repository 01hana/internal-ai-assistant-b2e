import { Injectable } from '@nestjs/common';
import { CustomerToolPolicy } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ResolveCustomerToolPolicyInput {
  customerId: string;
  toolDefinitionId: string;
}

export type CustomerToolPolicyResolution =
  | { allowed: true; policy: CustomerToolPolicy }
  | { allowed: false };

@Injectable()
export class CustomerToolPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: ResolveCustomerToolPolicyInput): Promise<CustomerToolPolicyResolution> {
    const policy = await this.prisma.db.customerToolPolicy.findUnique({
      where: {
        customerId_toolDefinitionId: {
          customerId: input.customerId,
          toolDefinitionId: input.toolDefinitionId
        }
      }
    });

    if (!policy || !policy.enabled) {
      return { allowed: false };
    }

    return { allowed: true, policy };
  }
}
