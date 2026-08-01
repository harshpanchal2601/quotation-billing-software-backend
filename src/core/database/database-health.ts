import { prisma } from './prisma.js';

export async function checkDatabaseHealth() {
  await prisma.$queryRaw`SELECT 1`;
}
