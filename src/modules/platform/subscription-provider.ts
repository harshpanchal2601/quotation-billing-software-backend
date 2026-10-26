// A gateway implementation must normalize verified, idempotent provider events
// into the platform ledger. Tenant sales documents are outside this contract.
export interface SubscriptionPaymentProvider {
  readonly name: string;
  createCheckout(input: { chargeId: number; amount: string; currency: string; idempotencyKey: string }): Promise<{ url: string; reference: string }>;
  verifyWebhook(input: { rawBody: Buffer; signature: string }): Promise<{
    eventId: string; chargeId: number; kind: 'PAYMENT' | 'REFUND'; amount: string; currency: string; reference: string;
  }>;
}

export const subscriptionPaymentMode = 'MANUAL' as const;
