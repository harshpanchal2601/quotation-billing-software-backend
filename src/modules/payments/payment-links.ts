// A future adapter must provide verified, durable provider event ingestion before
// it can create confirmed ledger receipts. No live provider is registered here.
export interface PaymentLinkProvider {
  readonly provider: string;
  createLink(input: Readonly<{ firmId: number; companyId: number; invoiceId: number; currency: string; amount: string; idempotencyKey: string }>): Promise<Readonly<{ externalId: string; url: string; expiresAt: string }>>;
  verifyWebhook(input: Readonly<{ rawBody: Uint8Array; signature: string }>): Promise<Readonly<{ externalEventId: string; externalPaymentId: string; firmId: number; companyId: number; currency: string; amount: string; receivedAt: string }>>;
}

export const paymentCapabilities = Object.freeze({ paymentLinks: { enabled: false, reason: 'A gateway and verified webhook contract require approval' }, reminders: { enabled: false, reason: 'Customer reminder consent, grace, quiet-hours and suppression policy require approval' } });
