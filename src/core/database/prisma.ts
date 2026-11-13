import { PrismaClient } from '@prisma/client';

import { env } from '../../config/env.js';
import { logOperationalEvent } from '../observability/logger.js';

const prismaClientSingleton = () => {
  const client = new PrismaClient({
    log: [{ emit: 'event', level: 'error' }, { emit: 'event', level: 'warn' }],
  });
  // Prisma messages can contain queries and field values. Do not forward the
  // provider event payload to the operational log stream.
  client.$on('error', () => { logOperationalEvent('error', { event: 'database.client.failed' }); });
  client.$on('warn', () => { logOperationalEvent('warn', { event: 'database.client.warning' }); });
  return client;
};

type PrismaClientSingleton = ReturnType<typeof prismaClientSingleton>;

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClientSingleton;
};

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
