import { prisma } from './prisma.js';
import { env } from '../../config/env.js';
import { createDatabaseProbe } from './database-probe.js';

export const checkDatabaseHealth = createDatabaseProbe(async () => {
  await prisma.$queryRaw`SELECT 1`;
}, env.HEALTH_PROBE_TIMEOUT_MS);
