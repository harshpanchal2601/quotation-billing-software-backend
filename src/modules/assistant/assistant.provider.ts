import { toolPlanSchema, type ToolPlan } from './assistant.schema.js';

const resources = { customer: 'CUSTOMERS', customers: 'CUSTOMERS', company: 'CUSTOMERS', companies: 'CUSTOMERS', item: 'ITEMS', items: 'ITEMS', quotation: 'QUOTATIONS', quotations: 'QUOTATIONS', quote: 'QUOTATIONS', quotes: 'QUOTATIONS', invoice: 'INVOICES', invoices: 'INVOICES', order: 'ORDERS', orders: 'ORDERS', payment: 'PAYMENTS', payments: 'PAYMENTS', audit: 'AUDIT' } as const;
export function redactAssistantText(text: string) {
  return text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email redacted]')
    .replace(/\b\d(?:[ -]?\d){9,15}\b/g, '[number redacted]')
    .replace(/\b(?:sk-|Bearer\s+)[A-Za-z0-9_\-.]{12,}/gi, '[credential redacted]');
}
export function localAssistantPlan(message: string): ToolPlan {
  const text = message.trim();
  if (/^(?:show |calculate |what (?:is|are) (?:the )?)?(?:outstanding|unpaid)(?: invoices?| receivables?)?\??$/i.test(text)) return toolPlanSchema.parse({ tool: 'OUTSTANDING' });
  if (/^(?:show |calculate )?(?:sales|sales metrics|sales report)\??$/i.test(text)) return { tool: 'SALES' };
  const match = /^(?:(?:find|search|show|list)\s+)?(customers?|compan(?:y|ies)|items?|quotations?|quotes?|invoices?|orders?|payments?|audit)(?:\s+(?:for|named|matching))?(?:\s+(.+))?$/i.exec(text);
  if (match) {
    const resource = resources[match[1]!.toLowerCase() as keyof typeof resources];
    const query = (match[2] ?? '').replace(/^"(.*)"$/, '$1');
    if (query.length <= 191 && (resource !== 'AUDIT' || query === '')) return toolPlanSchema.parse({ tool: 'SEARCH', resource, query });
  }
  return { tool: 'CLARIFY', message: 'Try “find quotations for ABC”, “outstanding invoices”, or “sales report”. Use the draft and proposal controls to select exact records. Changes require a separate review and confirmation.' };
}

export type LlmConnection = { status: 'CONNECTED'; model: string } | { status: 'NOT_CONNECTED' | 'COMMERCIAL_INTEGRATION_REQUIRED' | 'USAGE_LIMIT_REACHED' | 'RECONNECT_REQUIRED' };
export class AssistantProviderError extends Error {
  constructor(readonly code: 'USAGE_LIMIT_REACHED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'RECONNECT_REQUIRED' | 'INVALID_OUTPUT') { super(code); }
}
export interface AssistantLlmProvider {
  // Read only this firm/user's validated local connection state. A future
  // partner adapter must not perform OAuth or network refresh while holding
  // the firm's entitlement transaction, or share credentials between users.
  connection(firmId: number, actorId: number): Promise<LlmConnection>;
  plan(input: { firmId: number; actorId: number; message: string; signal: AbortSignal }): Promise<unknown>;
}
// Public SIWC documentation does not authorize hosted commercial plan usage.
// This explicit unavailable adapter cannot consume CLI tokens, shared accounts,
// API keys or another firm's credentials. A registered partner adapter must
// supply a validated per-user connection before requests can enter LLM mode.
export const hostedChatGptProvider: AssistantLlmProvider = {
  async connection() { return { status: 'COMMERCIAL_INTEGRATION_REQUIRED' }; },
  async plan() { throw new AssistantProviderError('UNAVAILABLE'); },
};
