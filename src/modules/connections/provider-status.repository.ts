import { env } from '../../config/env.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature } from '../entitlements/index.js';

// Configuration diagnostics, never provider validation or an activation API.
export async function readProviderStatus(firmId: number, actorId: number) {
  return prisma.$transaction(async (tx) => {
    await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.FIRM_PROFILE_MANAGE);
    await assertTransactionFeature(tx, firmId, 'firm.core');
    const mailConfigured = Boolean(env.SMTP_HOST && env.SMTP_FROM_EMAIL);
    let mailAllowed = false;
    try {
      await assertTransactionFeature(tx, firmId, 'quotations.email');
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_EMAIL);
      mailAllowed = true;
    } catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
    return { firmId, providers: [
      { provider: 'SMTP', capability: 'Quotation email', state: mailConfigured ? mailAllowed ? 'CONFIGURED_NOT_VERIFIED' : 'ACCESS_DENIED' : 'NOT_CONFIGURED', enabled: mailConfigured && mailAllowed, reason: 'Existing quotation email permissions and plan gates apply. Configuration does not prove delivery or consent.' },
      { provider: 'RAZORPAY', capability: 'Customer payment gateway', state: 'NOT_IMPLEMENTED', enabled: false, reason: 'No gateway adapter or durable callback ingestion is registered. A mapped merchant account, agreement, credentials and sandbox evidence are required.' },
      { provider: 'INDIA_IRP', capability: 'IRN and e-way integration', state: 'NOT_IMPLEMENTED', enabled: false, reason: 'No tax-submission adapter is registered. Jurisdiction applicability and official/provider contracts must be verified before implementation and activation.' },
    ] };
  });
}
