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
      { provider: 'SMTP', capability: 'Quotation email', state: mailConfigured ? mailAllowed ? 'CONFIGURED_NOT_VERIFIED' : 'ACCESS_DENIED' : 'NOT_CONFIGURED', enabled: mailConfigured && mailAllowed, reason: !mailConfigured ? 'Email delivery is not set up on this server. Ask your administrator to configure and verify it before sending quotations.' : mailAllowed ? 'Email setup has not been verified. Confirm delivery and recipient consent before sending quotations.' : 'Email delivery is turned off for your account or plan. Your administrator can review it after delivery setup is verified.' },
      { provider: 'RAZORPAY', capability: 'Customer payment gateway', state: 'NOT_IMPLEMENTED', enabled: false, reason: 'Online payment collection is not available. Continue recording confirmed receipts manually until an approved payment connection is ready.' },
      { provider: 'INDIA_IRP', capability: 'E-invoices and e-way bills', state: 'NOT_IMPLEMENTED', enabled: false, reason: 'Automatic e-invoice and e-way bill submission is not available. Arrange a verified tax service for documents that require these services.' },
    ] };
  });
}
