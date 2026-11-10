import { randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { prisma } from '../core/database/prisma.js';
import { OutboxRepository, startOutboxWorker } from '../core/outbox/index.js';
import { inAppNotificationHandler } from '../modules/notifications/index.js';
import { billingSchedulesRepository, recurringDraftHandler } from '../modules/billing-schedules/index.js';
import { workflowHandler, workflowNotificationHandler } from '../modules/automation/index.js';
import { purgeExpiredAssistantContent } from '../modules/assistant/index.js';
import { webhookHandler } from '../modules/connections/index.js';
import { reportExportHandler } from '../modules/reports/index.js';
import { runtimeState } from '../core/observability/runtime.js';
import { logOperationalEvent } from '../core/observability/logger.js';

export function startConfiguredOutboxWorker() {
  runtimeState.configureWorker(env.OUTBOX_WORKER_ENABLED);
  if (!env.OUTBOX_WORKER_ENABLED) return { stop: async () => undefined };
  const repository = new OutboxRepository(prisma, { 'notifications.in-app.v1': inAppNotificationHandler, 'billing.recurring-draft.v1': recurringDraftHandler, 'automation.workflow.v1': workflowHandler, 'automation.notification.v1': workflowNotificationHandler, 'integrations.webhook.v1': webhookHandler, 'reports.export.v1': reportExportHandler });
  return startOutboxWorker({ async runOne(workerId) {
    // Discovery is independent of delivery: a discovery failure must not stop
    // the existing notification queue from making progress.
    try { await billingSchedulesRepository.dispatchDue(); }
    catch { logOperationalEvent('error', { event: 'outbox.discovery.failed' }); }
    try { await purgeExpiredAssistantContent(); }
    catch { logOperationalEvent('error', { event: 'assistant.retention.failed' }); }
    return repository.runOne(workerId);
  } }, `local:${randomUUID()}`, env.OUTBOX_POLL_INTERVAL_MS, { started: runtimeState.workerStarted, finished: runtimeState.workerFinished });
}
