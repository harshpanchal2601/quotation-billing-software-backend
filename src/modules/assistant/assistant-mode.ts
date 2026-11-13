import { evaluateFeature, type EntitlementContext } from '../entitlements/entitlement-evaluator.js';
import { PERMISSIONS } from '../auth/permissions.js';
import type { LlmConnection } from './assistant.provider.js';

export type AssistantMode = 'LOCAL' | 'LLM';
export type ModeDecision = { mode: AssistantMode; fallback: string | null } | { mode: null; fallback: string };
export function chooseAssistantMode(input: {
  context: EntitlementContext; permissions: readonly string[]; requested: 'AUTO' | AssistantMode;
  llmEnabled: boolean; connection: LlmConnection; creditsRemaining: boolean; dailyLimitRemaining: boolean;
}): ModeDecision {
  const local = evaluateFeature(input.context, 'assistant.local', input.permissions.includes(PERMISSIONS.ASSISTANT_LOCAL)).allowed;
  const llm = evaluateFeature(input.context, 'ai.credits', input.permissions.includes(PERMISSIONS.ASSISTANT_LLM)).allowed;
  if (input.requested === 'LOCAL') return local ? { mode: 'LOCAL', fallback: null } : { mode: null, fallback: 'LOCAL_ACCESS_DENIED' };
  const reason = !llm ? 'LLM_ACCESS_DENIED' : !input.llmEnabled ? 'LLM_DISABLED_BY_FIRM_ADMIN'
    : !input.creditsRemaining ? 'FIRM_AI_QUOTA_REACHED' : !input.dailyLimitRemaining ? 'FIRM_DAILY_LIMIT_REACHED'
      : input.connection.status !== 'CONNECTED' ? input.connection.status : null;
  if (reason === null) return { mode: 'LLM', fallback: null };
  return { mode: local ? 'LOCAL' : null, fallback: reason };
}
