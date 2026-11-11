// A future adapter must provide verified, durable provider event ingestion before
// it can create confirmed ledger receipts. No live provider is registered here.
export interface PaymentLinkProvider {
  readonly provider: string;
  createLink(input: Readonly<{ firmId: number; companyId: number; invoiceId: number; currency: string; amount: string; idempotencyKey: string }>): Promise<Readonly<{ externalId: string; url: string; expiresAt: string }>>;
  verifyWebhook(input: Readonly<{ rawBody: Uint8Array; signature: string }>): Promise<Readonly<{ externalEventId: string; externalPaymentId: string; firmId: number; companyId: number; currency: string; amount: string; receivedAt: string }>>;
}

export const paymentCapabilities = Object.freeze({ paymentLinks: { enabled: false, reason: 'Online payment collection is not available yet. Record payments received outside this app using Record receipt' }, reminders: { enabled: false, reason: 'Automatic payment reminders are not available yet. You can review outstanding invoices in Receivables & Ageing' } });
