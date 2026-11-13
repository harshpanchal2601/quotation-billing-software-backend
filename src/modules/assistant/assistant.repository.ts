import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { env } from '../../config/env.js';
import { createAuditLog } from '../../core/audit/audit-log.service.js';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import { jsonObject } from '../../core/serialization/json.js';
import { authorizeFirmJobActor, resolveUserPermissions } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, loadEntitlements, recordUsage, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { evaluateFeature } from '../entitlements/entitlement-evaluator.js';
import { approvalCommandSchema } from '../automation/contract.js';
import { chooseAssistantMode, type AssistantMode } from './assistant-mode.js';
import { AssistantProviderError, hostedChatGptProvider, localAssistantPlan, redactAssistantText, type AssistantLlmProvider } from './assistant.provider.js';
import { authorizeAssistantCommand, executeAssistantCommand, prepareAssistantCommand } from './assistant.commands.js';
import { authorizeAssistantTool, executeAssistantRead, extractUntrustedLines, prepareAssistantDraft } from './assistant.tools.js';
import { toolPlanSchema, type ChatInput, type ToolPlan, type proposalSchema, type settingsSchema } from './assistant.schema.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const utcDay = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
function notice(reason: string | null) {
  if (!reason) return null;
  if (['FIRM_AI_QUOTA_REACHED', 'FIRM_DAILY_LIMIT_REACHED', 'USAGE_LIMIT_REACHED'].includes(reason)) return 'Your LLM usage limit has been reached. The local assistant is active.';
  if (reason === 'COMMERCIAL_INTEGRATION_REQUIRED') return 'ChatGPT connection requires approved OpenAI commercial integration. The local assistant is active.';
  if (reason === 'RATE_LIMITED') return 'ChatGPT is temporarily rate limited. The local assistant is active.';
  return 'LLM mode is unavailable. The local assistant is active.';
}
async function audit(tx: Prisma.TransactionClient, firmId: number, actorId: number, entityId: string, values: Prisma.InputJsonObject) {
  await createAuditLog(tx, { metadata: { firmId, userId: actorId }, entityType: 'Assistant', entityId, action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: values });
}

export class AssistantRepository {
  constructor(private readonly db: PrismaClient, private readonly provider: AssistantLlmProvider = hostedChatGptProvider) {}

  private async actor(tx: Prisma.TransactionClient, firmId: number, actorId: number, manage = false) {
    let actor: Awaited<ReturnType<typeof authorizeFirmJobActor>>;
    if (manage) actor = await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ASSISTANT_SETTINGS_MANAGE);
    else {
      try { actor = await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ASSISTANT_LOCAL); }
      catch (error) {
        if (!(error instanceof AppError) || error.statusCode !== 403) throw error;
        actor = await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ASSISTANT_LLM);
      }
    }
    if (actor.firmId !== firmId || manage && actor.accountType !== 'FIRM_ADMIN') throw new AppError('Active firm membership is required', 403);
    return actor;
  }
  private async modeAccess(tx: Prisma.TransactionClient, firmId: number, actorId: number, mode: AssistantMode) {
    await this.actor(tx, firmId, actorId);
    await authorizeFirmJobActor(tx, firmId, actorId, mode === 'LOCAL' ? PERMISSIONS.ASSISTANT_LOCAL : PERMISSIONS.ASSISTANT_LLM);
    await assertTransactionFeature(tx, firmId, mode === 'LOCAL' ? 'assistant.local' : 'ai.credits');
    if (mode === 'LLM') {
      const setting = await tx.assistantSetting.findUnique({ where: { firmId } });
      if (!setting?.llmEnabled) throw new AppError('LLM mode is disabled by the firm administrator', 403);
      const connection = await this.provider.connection(firmId, actorId);
      if (connection.status !== 'CONNECTED') throw new AppError('Reconnect an authorized ChatGPT account', 409);
    }
  }
  private async conversation(tx: Prisma.TransactionClient, firmId: number, actorId: number, id: string) {
    const row = await tx.assistantConversation.findFirst({ where: { id, firmId, actorId, deletedAt: null } });
    if (!row) throw new AppError('Conversation not found', 404);
    return row;
  }
  private async snapshot(tx: Prisma.TransactionClient, firmId: number, actorId: number, requested: 'AUTO' | AssistantMode) {
    const actor = await this.actor(tx, firmId, actorId);
    const [setting, entitlement, counter, todayRequests, connection] = await Promise.all([
      tx.assistantSetting.findUnique({ where: { firmId } }), loadEntitlements(tx, firmId),
      tx.usageCounter.findUnique({ where: { firmId_resource: { firmId, resource: 'aiCredits' } } }),
      tx.assistantMessage.count({ where: { firmId, provider: 'OPENAI_CHATGPT', createdAt: { gte: utcDay() } } }),
      this.provider.connection(firmId, actorId),
    ]);
    const permissions = resolveUserPermissions(actor);
    const used = counter?.used ?? 0n;
    const limit = entitlement.limits.aiCredits;
    const decision = chooseAssistantMode({ context: entitlement.context, permissions, requested, connection,
      llmEnabled: setting?.llmEnabled ?? false, creditsRemaining: limit === null || used < limit,
      dailyLimitRemaining: setting?.dailyLlmRequests !== null && setting?.dailyLlmRequests !== undefined && todayRequests < setting.dailyLlmRequests });
    return { setting, connection, decision, used, limit, todayRequests, localAllowed: evaluateFeature(entitlement.context, 'assistant.local', permissions.includes(PERMISSIONS.ASSISTANT_LOCAL)).allowed,
      llmAllowed: evaluateFeature(entitlement.context, 'ai.credits', permissions.includes(PERMISSIONS.ASSISTANT_LLM)).allowed };
  }
  async status(firmId: number, actorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const snapshot = await this.snapshot(tx, firmId, actorId, 'AUTO');
      return { localAllowed: snapshot.localAllowed, llmAllowed: snapshot.llmAllowed, mode: snapshot.decision.mode, fallback: snapshot.decision.fallback,
        connection: snapshot.connection.status, notice: snapshot.decision.mode === 'LOCAL' ? notice(snapshot.decision.fallback) : null,
        credits: { used: snapshot.used.toString(), limit: snapshot.limit?.toString() ?? null, unit: 'LLM_REQUEST_ATTEMPTS' },
        todayRequests: snapshot.todayRequests, dailyResetTimezone: 'UTC', settings: snapshot.setting ? { version: snapshot.setting.version, llmEnabled: snapshot.setting.llmEnabled, dailyLlmRequests: snapshot.setting.dailyLlmRequests, retainContentDays: snapshot.setting.retainContentDays } : { version: 0, llmEnabled: false, dailyLlmRequests: null, retainContentDays: null } };
    });
  }
  async saveSettings(firmId: number, actorId: number, input: z.infer<typeof settingsSchema>) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.actor(tx, firmId, actorId, true);
      await assertTransactionFeature(tx, firmId, 'firm.core');
      if (input.retainContentDays !== null && !env.OUTBOX_WORKER_ENABLED) throw new AppError('Enable the retention worker before opting into content storage', 409);
      const old = await tx.assistantSetting.findUnique({ where: { firmId } });
      if ((old?.version ?? 0) !== input.expectedVersion) throw new AppError('Assistant settings changed; reload', 409);
      if (input.llmEnabled) await assertTransactionFeature(tx, firmId, 'ai.credits');
      const data = { llmEnabled: input.llmEnabled, dailyLlmRequests: input.dailyLlmRequests, retainContentDays: input.retainContentDays, updatedById: actorId, version: input.expectedVersion + 1 };
      const row = await tx.assistantSetting.upsert({ where: { firmId }, create: { firmId, ...data }, update: data });
      if (input.retainContentDays === null) await tx.assistantMessage.updateMany({ where: { firmId }, data: { inputText: null, response: Prisma.DbNull, contentExpiresAt: null } });
      else if (old?.retainContentDays !== undefined && old.retainContentDays !== null && input.retainContentDays < old.retainContentDays) {
        const cutoff = new Date(Date.now() - input.retainContentDays * 86400000);
        await tx.assistantMessage.updateMany({ where: { firmId, createdAt: { lte: cutoff } }, data: { inputText: null, response: Prisma.DbNull, contentExpiresAt: null } });
        // Shortening retention never extends an existing content expiry.
        const messages = await tx.assistantMessage.findMany({ where: { firmId, contentExpiresAt: { not: null }, createdAt: { gt: cutoff } }, select: { id: true, createdAt: true, contentExpiresAt: true }, take: 1001 });
        if (messages.length > 1000) throw new AppError('Purge retained content before shortening this large history', 409);
        for (const message of messages) {
          const expiresAt = new Date(message.createdAt.getTime() + input.retainContentDays * 86400000);
          if (message.contentExpiresAt! > expiresAt) await tx.assistantMessage.update({ where: { id: message.id }, data: { contentExpiresAt: expiresAt } });
        }
      }
      await audit(tx, firmId, actorId, `settings:${firmId}`, { ...data, consent: true });
      return { version: row.version, llmEnabled: row.llmEnabled, dailyLlmRequests: row.dailyLlmRequests, retainContentDays: row.retainContentDays };
    });
  }
  async chat(firmId: number, actorId: number, input: ChatInput) {
    const hash = requestHash(input);
    const reserved = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const snapshot = await this.snapshot(tx, firmId, actorId, input.mode);
      const { decision } = snapshot;
      const existing = await tx.assistantMessage.findUnique({ where: { firmId_actorId_requestId: { firmId, actorId, requestId: input.requestId } } });
      if (existing) {
        await this.conversation(tx, firmId, actorId, existing.conversationId);
        if (existing.requestHash !== hash) throw new AppError('Request ID was reused with different input', 409);
        if (existing.status === 'PENDING') throw new AppError('This request is already in progress; it will not be executed twice', 409, { code: 'REQUEST_IN_PROGRESS' });
        if (existing.response && existing.contentExpiresAt && existing.contentExpiresAt > new Date()) {
          const reply = existing.response as Prisma.JsonObject;
          await this.modeAccess(tx, firmId, actorId, reply.mode === 'LLM' ? 'LLM' : 'LOCAL');
          await authorizeAssistantTool(tx, firmId, actorId, toolPlanSchema.parse(reply.plan));
          return { replay: reply, message: null, fallback: null };
        }
        throw new AppError('This request was already handled. Its reply was not retained; submit a new request to refresh the data', 409, { code: 'REPLY_NOT_RETAINED' });
      }
      if (!decision.mode) throw new AppError('Assistant access is unavailable', 403, { code: decision.fallback });
      // A firm-wide database limit complements the HTTP limiter across replicas.
      const recent = await tx.assistantMessage.count({ where: { firmId, createdAt: { gte: new Date(Date.now() - 60000) } } });
      if (recent >= 60) throw new AppError('Assistant request rate limit reached', 429);
      const conversationId = input.conversationId ?? randomUUID();
      if (input.conversationId) await this.conversation(tx, firmId, actorId, conversationId);
      else await tx.assistantConversation.create({ data: { id: conversationId, firmId, actorId } });
      if (input.plan) await authorizeAssistantTool(tx, firmId, actorId, input.plan);
      const retainDays = snapshot.setting?.retainContentDays;
      const message = await tx.assistantMessage.create({ data: { id: randomUUID(), firmId, actorId, conversationId, requestId: input.requestId, requestHash: hash,
        mode: decision.mode, provider: input.plan ? 'DOMAIN_TOOLS' : decision.mode === 'LOCAL' ? 'LOCAL_RULES' : 'OPENAI_CHATGPT', model: !input.plan && snapshot.connection.status === 'CONNECTED' && decision.mode === 'LLM' ? snapshot.connection.model : null,
        inputText: retainDays ? redactAssistantText(input.message) : null, contentExpiresAt: retainDays ? new Date(Date.now() + retainDays * 86400000) : null } });
      if (decision.mode === 'LLM' && !input.plan) await recordUsage(tx, firmId, 'aiCredits', 1n, `assistant:${message.id}`);
      await audit(tx, firmId, actorId, message.id, { event: 'REQUEST_ACCEPTED', conversationId, mode: decision.mode });
      return { replay: null, message, fallback: decision.fallback };
    });
    if (reserved.replay) return reserved.replay;
    const message = reserved.message!;
    let mode: AssistantMode = message.mode === 'LLM' ? 'LLM' : 'LOCAL';
    let fallback = reserved.fallback;
    try {
      let plan: ToolPlan;
      if (input.plan) plan = input.plan;
      else if (mode === 'LOCAL') plan = localAssistantPlan(input.message);
      else {
        try {
          const controller = new AbortController();
          let timeout: ReturnType<typeof setTimeout> | undefined;
          try {
            const output = await Promise.race([
              this.provider.plan({ firmId, actorId, message: redactAssistantText(input.message), signal: controller.signal }),
              new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { controller.abort(); reject(new AssistantProviderError('UNAVAILABLE')); }, 15000); }),
            ]);
            const parsed = toolPlanSchema.safeParse(output);
            if (!parsed.success) throw new AssistantProviderError('INVALID_OUTPUT');
            plan = parsed.data;
          } finally { if (timeout) clearTimeout(timeout); }
        } catch (error) {
          if (!(error instanceof AssistantProviderError)) throw error;
          await withFirmEntitlementTransaction(this.db, firmId, (tx) => this.modeAccess(tx, firmId, actorId, 'LOCAL'));
          mode = 'LOCAL'; fallback = error.code; plan = localAssistantPlan(input.message);
        }
      }
      const prepared = await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
        await this.modeAccess(tx, firmId, actorId, mode);
        await this.conversation(tx, firmId, actorId, message.conversationId);
        await authorizeAssistantTool(tx, firmId, actorId, plan);
        return plan.tool === 'DRAFT' ? prepareAssistantDraft(tx, firmId, plan) : null;
      });
      const result = plan.tool === 'DRAFT' ? prepared : await executeAssistantRead(firmId, actorId, plan);
      const reply = jsonObject({ requestId: input.requestId, conversationId: message.conversationId, mode, fallback, notice: notice(fallback), plan, toolStatus: 'COMPLETED', result });
      await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
        await this.modeAccess(tx, firmId, actorId, mode);
        await this.conversation(tx, firmId, actorId, message.conversationId);
        await authorizeAssistantTool(tx, firmId, actorId, plan);
        const setting = await tx.assistantSetting.findUnique({ where: { firmId } });
        const currentMessage = await tx.assistantMessage.findFirst({ where: { id: message.id, firmId, actorId }, select: { contentExpiresAt: true } });
        // A concurrent opt-out or content expiry must not be undone by a reply.
        const retain = setting?.retainContentDays && currentMessage?.contentExpiresAt && currentMessage.contentExpiresAt > new Date();
        await tx.assistantMessage.update({ where: { id: message.id }, data: { status: 'COMPLETED', tool: plan.tool, errorCode: fallback, response: retain ? reply : Prisma.DbNull } });
        await audit(tx, firmId, actorId, message.id, { event: 'REQUEST_COMPLETED', tool: plan.tool, mode, fallback });
      });
      return reply;
    } catch (error) {
      await withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
        await tx.assistantMessage.update({ where: { id: message.id }, data: { status: 'FAILED', errorCode: 'REQUEST_FAILED', response: Prisma.DbNull } });
        await audit(tx, firmId, actorId, message.id, { event: 'REQUEST_FAILED' });
      });
      throw error;
    }
  }
  async propose(firmId: number, actorId: number, input: z.infer<typeof proposalSchema>) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.modeAccess(tx, firmId, actorId, input.mode);
      await this.conversation(tx, firmId, actorId, input.conversationId);
      const id = randomUUID();
      const command = input.command.action === 'ORDER_CONFIRM' || input.command.action === 'STOCK_ADJUST' ? { ...input.command, idempotencyKey: `assistant_${id}` } : input.command;
      const prepared = await prepareAssistantCommand(tx, firmId, actorId, command);
      const nonce = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60000);
      await tx.assistantActionProposal.create({ data: { id, firmId, actorId, conversationId: input.conversationId, mode: input.mode, command: jsonObject(prepared.command), evidence: prepared.before, fingerprint: prepared.fingerprint, nonceHash: digest(nonce), expiresAt } });
      await audit(tx, firmId, actorId, id, { event: 'ACTION_PROPOSED', conversationId: input.conversationId, command: jsonObject(command), before: prepared.before, after: prepared.after });
      const effect = command.action === 'INVOICE_ISSUE' ? `Issue an invoice for ${String(prepared.before.currency)} ${String(prepared.before.total)} and record the amount due.`
        : command.action === 'CREDIT_NOTE_ISSUE' ? `Issue a credit note for ${String(prepared.before.currency)} ${String(prepared.before.total)} against its original invoice.`
          : command.action === 'INVOICE_VOID' ? 'Cancel this issued invoice under the existing same-day cancellation rules.'
            : command.action === 'ORDER_CONFIRM' ? 'Create one sales order from the displayed accepted quotation revision.'
              : command.action === 'STOCK_ADJUST' ? 'Record one stock movement with the displayed quantity and value.'
                : 'Change only the quotation status shown below; this does not send an email.';
      return { id, nonce, expiresAt, command, before: prepared.before, after: prepared.after, permissionChecked: true, entitlementChecked: true,
        effects: `${effect} Business validation and any required approval still apply.` };
    });
  }
  async confirm(firmId: number, actorId: number, id: string, nonce: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const row = await tx.assistantActionProposal.findFirst({ where: { id, firmId, actorId }, include: { execution: true } });
      if (!row) throw new AppError('Proposal not found', 404);
      await this.modeAccess(tx, firmId, actorId, row.mode === 'LLM' ? 'LLM' : 'LOCAL');
      const command = approvalCommandSchema.parse(row.command);
      await authorizeAssistantCommand(tx, firmId, actorId, command);
      if (!timingSafeEqual(Buffer.from(row.nonceHash, 'hex'), Buffer.from(digest(nonce), 'hex'))) throw new AppError('Confirmation does not match this proposal', 403);
      if (row.execution && row.status === 'EXECUTED') return { ...jsonObject(row.execution.result), executionId: row.execution.id, replayed: true };
      await this.conversation(tx, firmId, actorId, row.conversationId);
      if (row.status !== 'PENDING' || row.expiresAt <= new Date()) throw new AppError('Proposal is cancelled, expired or already executed', 409);
      const prepared = await prepareAssistantCommand(tx, firmId, actorId, command);
      if (prepared.fingerprint !== row.fingerprint) throw new AppError('The target changed; review a new proposal', 409);
      const result = await executeAssistantCommand(tx, firmId, actorId, command);
      const executionId = randomUUID();
      await tx.assistantExecution.create({ data: { id: executionId, firmId, actorId, proposalId: id, result } });
      await tx.assistantActionProposal.update({ where: { id }, data: { status: 'EXECUTED' } });
      await audit(tx, firmId, actorId, id, { event: 'ACTION_EXECUTED', executionId, conversationId: row.conversationId, command: jsonObject(command), sourceFingerprint: row.fingerprint, result });
      return { ...result, executionId, replayed: false };
    });
  }
  async cancel(firmId: number, actorId: number, id: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.actor(tx, firmId, actorId);
      const row = await tx.assistantActionProposal.findFirst({ where: { id, firmId, actorId, status: 'PENDING' } });
      if (!row) throw new AppError('Pending proposal not found', 404);
      await tx.assistantActionProposal.update({ where: { id }, data: { status: 'CANCELLED' } });
      await audit(tx, firmId, actorId, id, { event: 'ACTION_CANCELLED' });
    });
  }
  async history(firmId: number, actorId: number, page: number, sorting: ListSort<'createdAt' | 'id'> = {}) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const snapshot = await this.snapshot(tx, firmId, actorId, 'AUTO');
      if (!snapshot.localAllowed && !snapshot.llmAllowed) throw new AppError('Assistant access is unavailable', 403);
      const conversations = await tx.assistantConversation.findMany({ where: { firmId, actorId, deletedAt: null }, orderBy: listOrderBy(sorting, ['createdAt', 'id'], 'createdAt'), take: 20, skip: (page - 1) * 20,
        select: { id: true, createdAt: true, messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, mode: true, tool: true, status: true, errorCode: true, createdAt: true } }, proposals: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, status: true, expiresAt: true, createdAt: true, command: true, execution: { select: { id: true, result: true } } } } } });
      // Domain evidence and transcript contents are not history summaries.
      // Recheck action access before exposing links to an executed result.
      for (const conversation of conversations) {
        const visible = [];
        for (const proposal of conversation.proposals) {
          try { await authorizeAssistantCommand(tx, firmId, actorId, approvalCommandSchema.parse(proposal.command)); visible.push(proposal); }
          catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; }
        }
        conversation.proposals = visible;
      }
      return { conversations, page, hasMore: conversations.length === 20 };
    });
  }
  async erase(firmId: number, actorId: number, id: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.actor(tx, firmId, actorId);
      await this.conversation(tx, firmId, actorId, id);
      await tx.assistantMessage.updateMany({ where: { conversationId: id, firmId, actorId }, data: { inputText: null, response: Prisma.DbNull, contentExpiresAt: null } });
      await tx.assistantActionProposal.updateMany({ where: { conversationId: id, firmId, actorId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await tx.assistantConversation.update({ where: { id }, data: { deletedAt: new Date() } });
      await audit(tx, firmId, actorId, id, { event: 'CONTENT_ERASED', operationalAuditRetained: true });
    });
  }
  async extraction(firmId: number, actorId: number, text: string) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.modeAccess(tx, firmId, actorId, 'LOCAL');
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.ITEMS_VIEW);
      await assertTransactionFeature(tx, firmId, 'items');
      const result = extractUntrustedLines(text);
      await audit(tx, firmId, actorId, randomUUID(), { event: 'DOCUMENT_REVIEW_PREPARED', candidateCount: result.candidates.length, imported: false });
      return result;
    });
  }
  async purgeExpiredContent() {
    const now = new Date();
    const messages = await this.db.assistantMessage.findMany({ where: { contentExpiresAt: { lte: now } }, select: { id: true, firmId: true }, take: 500 });
    for (const firmId of new Set(messages.map((row) => row.firmId))) await withFirmEntitlementTransaction(this.db, firmId, (tx) => tx.assistantMessage.updateMany({ where: { firmId, id: { in: messages.filter((row) => row.firmId === firmId).map((row) => row.id) }, contentExpiresAt: { lte: now } }, data: { inputText: null, response: Prisma.DbNull, contentExpiresAt: null } }));
  }
}
export const assistantRepository = new AssistantRepository(prisma);
export const purgeExpiredAssistantContent = () => assistantRepository.purgeExpiredContent();
