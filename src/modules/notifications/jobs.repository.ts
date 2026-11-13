import { AuditAction, type PrismaClient } from '@prisma/client';
import { prisma } from '../../core/database/prisma.js';
import { createAuditLog } from '../../core/audit/audit-log.service.js';
import { AppError } from '../../core/errors/AppError.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { inAppNotificationHandler } from './notifications.repository.js';

export class NotificationJobsRepository {
  constructor(private readonly db: PrismaClient) {}
  async list(firmId: number) {
    await assertTransactionFeature(this.db, firmId, 'firm.core');
    return this.db.outboxEvent.findMany({ where: { firmId, kind: 'notifications.in-app.v1' }, orderBy: { createdAt: 'desc' }, take: 100,
      select: { id: true, kind: true, status: true, sourceEventId: true, attempts: true, maxAttempts: true, availableAt: true, completedAt: true, createdAt: true,
        jobAttempts: { orderBy: { attempt: 'desc' }, take: 5, select: { attempt: true, outcome: true, errorCode: true, startedAt: true, finishedAt: true } } } });
  }
  async retry(firmId: number, actorId: number, id: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.FIRM_PROFILE_MANAGE);
      await assertTransactionFeature(tx, firmId, 'firm.core');
      const event = await tx.outboxEvent.findFirst({ where: { id, firmId, kind: 'notifications.in-app.v1' } });
      if (event === null) throw new AppError('Notification job not found', 404);
      if (event.status !== 'DEAD') throw new AppError('Only dead notification jobs can be retried', 409);
      await inAppNotificationHandler.authorize(tx, event);
      const updated = await tx.outboxEvent.updateMany({ where: { id, firmId, status: 'DEAD', attempts: event.attempts },
        data: { status: 'PENDING', maxAttempts: event.attempts + 5, availableAt: new Date(), lockedUntil: null, lockToken: null } });
      if (updated.count !== 1) throw new AppError('Job changed; reload before retrying', 409);
      await createAuditLog(tx, { metadata: { firmId, userId: actorId }, entityType: 'OutboxEvent', entityId: id, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: { decision: 'MANUAL_RETRY', attempt: event.attempts } });
      return { id, status: 'PENDING' as const };
    });
  }
}
export const notificationJobsRepository = new NotificationJobsRepository(prisma);
