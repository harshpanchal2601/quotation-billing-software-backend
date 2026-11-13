import { listOrderBy, type ListSort } from '../../core/validation/list-sort.js';
import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { withFirmEntitlementTransaction } from '../entitlements/index.js';
import { applyInvoiceFieldDefinitions } from '../invoices/index.js';
import { evaluateWorkflow } from './workflow-evaluator.js';
import { renderTextTemplate } from '../../core/templates/placeholders.js';
import { mapInvoiceFieldConfiguration } from './invoice-field-mapping.js';
import { approvalPolicySchema, automationEventSchema, customFieldsSchema, documentTemplateSchema, parseDefinition, preferenceSchema, workflowSchema } from './automation.schema.js';
import { actionAccess, auditAutomation, automationAccess, entityAccess, eventAccess, latestDefinition, publishedHeads, type AutomationTx, type DefinitionKind } from './automation.persistence.js';
export type { DefinitionKind } from './automation.persistence.js';

export class AutomationRepository {
  constructor(readonly db: PrismaClient) {}
  async list(firmId: number, actorId: number, kind: DefinitionKind, key?: string, page = 1, sorting: ListSort = {}) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      return key === undefined ? publishedHeads(tx, firmId, kind) : tx.automationDefinitionVersion.findMany({ where: { firmId, kind, key }, orderBy: listOrderBy(sorting, ['id', 'version', 'publishedAt', 'publishedById'], 'version'), take: 50, skip: (page - 1) * 50 });
    });
  }
  async validate(tx: AutomationTx, firmId: number, actorId: number, kind: DefinitionKind, key: string, input: unknown) {
    let definition: ReturnType<typeof parseDefinition>;
    try { definition = parseDefinition(kind, key, input); } catch { throw new AppError('Invalid configuration; check its fields, transitions and placeholders', 400); }
    if (kind === 'WORKFLOW' || kind === 'NOTIFICATION') {
      const workflow = workflowSchema.parse(definition);
      await eventAccess(tx, firmId, actorId, workflow.trigger);
      for (const recipientId of new Set(workflow.steps.flatMap((step) => step.type === 'NOTIFY' ? step.recipientIds : []))) await eventAccess(tx, firmId, recipientId, workflow.trigger);
    }
    if (kind === 'APPROVAL') await actionAccess(tx, firmId, actorId, approvalPolicySchema.parse(definition).action);
    if (kind === 'CUSTOM_FIELDS') {
      const fields = customFieldsSchema.parse(definition);
      await entityAccess(tx, firmId, actorId, fields.entity, true);
      if (fields.entity === 'INVOICE' && fields.fields.some((field) => field.searchable)) throw new AppError('Invoice snapshot fields do not support search', 400);
    }
    if (kind === 'TEMPLATE') {
      const value = documentTemplateSchema.parse(definition);
      if (value.entity !== 'NOTICE') await entityAccess(tx, firmId, actorId, value.entity);
    }
    return definition;
  }
  async publish(firmId: number, actorId: number, kind: DefinitionKind, key: string, expectedVersion: number, input: unknown) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      const definition = await this.validate(tx, firmId, actorId, kind, key, input);
      const previous = await latestDefinition(tx, firmId, kind, key);
      if ((previous?.version ?? 0) !== expectedVersion) throw new AppError('Configuration changed; reload before publishing', 409);
      if (!previous && await tx.automationDefinitionVersion.count({ where: { firmId, kind, version: 1 } }) >= 100) throw new AppError('At most 100 definitions per category are supported', 409);
      const row = await tx.automationDefinitionVersion.create({ data: { firmId, kind, key, version: expectedVersion + 1, definition, publishedById: actorId } });
      if (kind === 'CUSTOM_FIELDS' && key === 'INVOICE') {
        await applyInvoiceFieldDefinitions(tx, firmId, mapInvoiceFieldConfiguration(definition));
      }
      await auditAutomation(tx, firmId, actorId, 'AutomationDefinitionVersion', row.id, { kind, key, version: row.version });
      return row;
    });
  }
  async rollback(firmId: number, actorId: number, kind: DefinitionKind, key: string, expectedVersion: number, version: number) {
    // The checked publication below serializes on the firm and detects intervening changes.
    const historical = await this.db.automationDefinitionVersion.findFirst({ where: { firmId, kind, key, version } });
    if (!historical) throw new AppError('Configuration version not found', 404);
    return this.publish(firmId, actorId, kind, key, expectedVersion, historical.definition);
  }
  async preview(firmId: number, actorId: number, kind: DefinitionKind, key: string, definition: unknown, event?: unknown) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      const value = await this.validate(tx, firmId, actorId, kind, key, definition);
      if (kind === 'WORKFLOW' || kind === 'NOTIFICATION') return { steps: evaluateWorkflow(workflowSchema.parse(value), automationEventSchema.parse(event)).map((step) => ({ id: step.id, type: step.type })), effects: 'NONE' };
      if (kind === 'TEMPLATE') {
        const template = documentTemplateSchema.parse(value);
        const variables = { businessName: 'Example business', documentNumber: 'PREVIEW-001', entityType: template.entity, status: 'PREVIEW', currency: 'INR', total: '100.00' };
        return { heading: renderTextTemplate(template.heading, variables), footer: renderTextTemplate(template.footer, variables), effects: 'NONE' };
      }
      return { valid: true, effects: 'NONE' };
    });
  }
  async preferences(firmId: number, actorId: number, input?: z.infer<typeof preferenceSchema>) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId);
      if (input === undefined) return tx.automationRecipientPreference.findUnique({ where: { firmId_userId: { firmId, userId: actorId } } });
      const preference = preferenceSchema.parse(input);
      const saved = await tx.automationRecipientPreference.upsert({ where: { firmId_userId: { firmId, userId: actorId } }, create: { firmId, userId: actorId, ...preference }, update: preference });
      await auditAutomation(tx, firmId, actorId, 'AutomationRecipientPreference', saved.id, preference);
      return saved;
    });
  }
  async recipients(firmId: number, actorId: number) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await automationAccess(tx, firmId, actorId, true);
      return tx.user.findMany({ where: { firmId, status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 100 });
    });
  }
}
export const automationRepository = new AutomationRepository(prisma);
