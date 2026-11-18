import { Prisma } from '../../generated/prisma/client';

/** A unique constraint violation (P2002). Callers use it where only one unique column can clash. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
