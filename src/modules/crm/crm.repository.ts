import { AuditAction, Prisma, type PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject as json } from '../../core/serialization/json.js';
import { currencyCode, decimal, money } from '../../core/money/index.js';
import type { DateWindow } from '../../core/validation/date-window.js';
import { listOrderBy } from '../../core/validation/list-sort.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction } from '../entitlements/index.js';
import { createCompanyForSales } from '../companies/index.js';
import { OPPORTUNITY_STAGES, type CrmList, type CustomerTimelineList, type leadCreateSchema, type leadUpdateSchema, type leadConversionSchema, type opportunityCreateSchema, type opportunityUpdateSchema, type taskCreateSchema, type taskUpdateSchema, type activityCreateSchema } from './crm.schema.js';

function pagination(query: Pick<CrmList, 'page' | 'limit'>, total: number) { return { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) }; }
export class CrmRepository {
  constructor(private readonly db: PrismaClient) {}
  private async access(tx: Prisma.TransactionClient, firmId: number, actorId: number, write = false) {
    const user = await authorizeFirmJobActor(tx, firmId, actorId, write ? PERMISSIONS.CRM_MANAGE : PERMISSIONS.CRM_VIEW);
    await assertTransactionFeature(tx, firmId, 'crm');
    return user.accountType !== 'FIRM_USER' || (Array.isArray(user.firmRole?.permissions) && user.firmRole.permissions.includes(PERMISSIONS.CRM_VIEW_ALL));
  }
  private scope(all: boolean, actorId: number, assignment = 'ownerId') { return all ? {} : assignment === 'assignedToId' ? { OR: [{ assignedToId: actorId }, { createdById: actorId }] } : { OR: [{ ownerId: actorId }, { createdById: actorId }] }; }
  async pipelineReport(tx: Prisma.TransactionClient, firmId: number, actorId: number, window: DateWindow, currency?: string) {
    const all = await this.access(tx, firmId, actorId);
    const rows = await tx.opportunity.groupBy({
      by: ['currency', 'stage'],
      where: { firmId, currency, ...this.scope(all, actorId), createdAt: { gte: window.from, lt: window.until } },
      _sum: { value: true }, _count: { _all: true }, orderBy: [{ currency: 'asc' }, { stage: 'asc' }],
    });
    return { scope: all ? 'FIRM' as const : 'OWNED_OR_CREATED' as const, currencies: rows.map((row) => ({ currency: row.currency, stage: row.stage, count: row._count._all, value: money(row._sum.value ?? '0', currencyCode(row.currency)).amount })) };
  }
  private async owner(tx: Prisma.TransactionClient, firmId: number, ownerId: number) {
    if (!await tx.user.findFirst({ where: { id: ownerId, firmId, status: 'ACTIVE', deletedAt: null }, select: { id: true } })) throw new AppError('Assigned owner unavailable', 404);
  }
  private async company(tx: Prisma.TransactionClient, firmId: number, id: number) {
    if (!await tx.company.findFirst({ where: { id, firmId, isActive: true, deletedAt: null }, select: { id: true } })) throw new AppError('Company unavailable', 404);
  }
  private async links(tx: Prisma.TransactionClient, firmId: number, actorId: number, all: boolean, input: { companyId?: number | null; leadId?: number | null; opportunityId?: number | null; quotationId?: number | null }) {
    let companyId = input.companyId ?? null;
    let leadId = input.leadId ?? null;
    if (input.opportunityId) {
      const opportunity = await tx.opportunity.findFirst({ where: { id: input.opportunityId, firmId, ...this.scope(all, actorId) } });
      if (!opportunity) throw new AppError('Opportunity unavailable', 404);
      if (companyId && opportunity.companyId && companyId !== opportunity.companyId) throw new AppError('Customer links must agree', 409);
      if (leadId && opportunity.leadId && leadId !== opportunity.leadId) throw new AppError('Lead links must agree', 409);
      companyId ??= opportunity.companyId; leadId ??= opportunity.leadId;
    }
    if (leadId) {
      const lead = await tx.lead.findFirst({ where: { id: leadId, firmId, ...this.scope(all, actorId) } });
      if (!lead) throw new AppError('Lead unavailable', 404);
      if (companyId && lead.companyId && companyId !== lead.companyId) throw new AppError('Customer links must agree', 409);
      companyId ??= lead.companyId;
    }
    if (input.quotationId) {
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.QUOTATIONS_VIEW);
      await assertTransactionFeature(tx, firmId, 'quotations');
      const quote = await tx.quotation.findFirst({ where: { id: input.quotationId, firmId, deletedAt: null } });
      if (!quote) throw new AppError('Quotation unavailable', 404);
      if (companyId && companyId !== quote.companyId) throw new AppError('Quotation customer must match', 409);
      companyId = quote.companyId;
    }
    if (companyId) await this.company(tx, firmId, companyId);
    return { companyId, leadId };
  }
  private async event(tx: Prisma.TransactionClient, firmId: number, actorId: number, entity: 'Lead' | 'Opportunity' | 'SalesTask' | 'SalesActivity', row: { id: number; companyId?: number | null; leadId?: number | null; opportunityId?: number | null }, subject: string, before: unknown, after: unknown, metadata: RequestMetadata) {
    await tx.salesActivity.create({ data: { firmId, createdById: actorId, companyId: row.companyId, leadId: entity === 'Lead' ? row.id : row.leadId, opportunityId: entity === 'Opportunity' ? row.id : row.opportunityId, taskId: entity === 'SalesTask' ? row.id : undefined, kind: 'HISTORY', subject, details: json({ before, after }) } });
    await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: entity, entityId: String(row.id), action: before === null ? AuditAction.CREATE : AuditAction.UPDATE, policy: 'REQUIRED', newValues: json(after), ...(before ? { oldValues: json(before) } : {}) });
  }
  async options(firmId: number, actorId: number, search: string) {
    return this.db.$transaction(async (tx) => {
      await this.access(tx, firmId, actorId, true);
      let canViewCompanies = true;
      try { await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.COMPANIES_VIEW); await assertTransactionFeature(tx, firmId, 'companies'); }
      catch (error) { if (!(error instanceof AppError) || error.statusCode !== 403) throw error; canViewCompanies = false; }
      return { owners: await tx.user.findMany({ where: { firmId, status: 'ACTIVE', deletedAt: null }, select: { id: true, name: true }, take: 100, orderBy: { name: 'asc' } }), companies: canViewCompanies ? await tx.company.findMany({ where: { firmId, deletedAt: null, isActive: true, name: { contains: search } }, select: { id: true, name: true }, take: 50, orderBy: { name: 'asc' } }) : [], stages: OPPORTUNITY_STAGES };
    });
  }
  async list(firmId: number, actorId: number, kind: 'leads' | 'opportunities' | 'tasks', query: CrmList) {
    return this.db.$transaction(async (tx) => {
      const all = await this.access(tx, firmId, actorId);
      if (query.companyId) await this.company(tx, firmId, query.companyId);
      const common = { firmId, companyId: query.companyId, ...this.scope(all, actorId, kind === 'tasks' ? 'assignedToId' : 'ownerId') };
      const fields = kind === 'leads' ? ['id', 'name', 'status', 'email', 'phone', 'source', 'createdAt'] : kind === 'opportunities' ? ['id', 'title', 'stage', 'value', 'currency', 'probability', 'expectedClose', 'source', 'createdAt'] : ['id', 'title', 'status', 'dueAt', 'reminderAt', 'createdAt'];
      const paging = { skip: (query.page - 1) * query.limit, take: query.limit, orderBy: listOrderBy(query, fields) };
      if (kind === 'leads') {
        const where: Prisma.LeadWhereInput = { ...common, ownerId: query.ownerId, name: { contains: query.search }, status: query.status };
        return { records: await tx.lead.findMany({ where, ...paging, include: { owner: { select: { id: true, name: true } }, company: { select: { id: true, name: true } } } }), pagination: pagination(query, await tx.lead.count({ where })) };
      }
      if (kind === 'opportunities') {
        const where: Prisma.OpportunityWhereInput = { ...common, ownerId: query.ownerId, leadId: query.leadId, title: { contains: query.search }, stage: query.status };
        return { records: (await tx.opportunity.findMany({ where, ...paging, include: { owner: { select: { id: true, name: true } }, company: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } } } })).map((row) => ({ ...row, value: money(row.value, currencyCode(row.currency)).amount })), pagination: pagination(query, await tx.opportunity.count({ where })) };
      }
      const where: Prisma.SalesTaskWhereInput = { ...common, assignedToId: query.ownerId, leadId: query.leadId, title: { contains: query.search }, status: query.reminders === 'true' ? 'OPEN' : query.status, ...(query.reminders === 'true' ? { reminderAt: { lte: new Date() } } : {}) };
      return { records: await tx.salesTask.findMany({ where, ...paging, include: { assignee: { select: { id: true, name: true } }, company: { select: { id: true, name: true } }, lead: { select: { id: true, name: true } } } }), pagination: pagination(query, await tx.salesTask.count({ where })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async createLead(firmId: number, actorId: number, input: z.infer<typeof leadCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.access(tx, firmId, actorId, true); await this.owner(tx, firmId, input.ownerId);
      const row = await tx.lead.create({ data: { ...input, firmId, createdById: actorId } });
      await this.event(tx, firmId, actorId, 'Lead', row, 'Lead captured', null, row, metadata); return row;
    });
  }
  async updateLead(firmId: number, actorId: number, id: number, input: z.infer<typeof leadUpdateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      const old = await tx.lead.findFirst({ where: { id, firmId, ...this.scope(all, actorId) } });
      if (!old) throw new AppError('Lead not found', 404);
      const { expectedVersion, ...data } = input;
      if (old.version !== expectedVersion || old.status === 'CONVERTED') throw new AppError('Lead changed or is already converted', 409);
      if (input.ownerId) await this.owner(tx, firmId, input.ownerId);
      const row = await tx.lead.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
      await this.event(tx, firmId, actorId, 'Lead', row, 'Lead updated', old, row, metadata); return row;
    });
  }
  async suggestions(firmId: number, actorId: number, id: number) {
    return this.db.$transaction(async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.COMPANIES_VIEW);
      await assertTransactionFeature(tx, firmId, 'companies');
      const lead = await tx.lead.findFirst({ where: { id, firmId, ...this.scope(all, actorId) } });
      if (!lead) throw new AppError('Lead not found', 404);
      return tx.company.findMany({ where: { firmId, deletedAt: null, isActive: true, OR: [{ name: { contains: lead.name } }, ...(lead.email ? [{ contacts: { some: { deletedAt: null, email: lead.email } } }] : []), ...(lead.phone ? [{ contacts: { some: { deletedAt: null, phone: lead.phone } } }] : [])] }, select: { id: true, name: true, companyCode: true }, take: 20 });
    });
  }
  async convertLead(firmId: number, actorId: number, id: number, input: z.infer<typeof leadConversionSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      const old = await tx.lead.findFirst({ where: { id, firmId, ...this.scope(all, actorId) } });
      if (!old) throw new AppError('Lead not found', 404);
      const hash = requestHash({ id, input });
      if (old.conversionKey === input.idempotencyKey && old.conversionHash === hash) return old;
      if (old.status === 'CONVERTED' || old.status === 'CLOSED' || old.version !== input.expectedVersion) throw new AppError('Lead is no longer eligible for conversion', 409);
      await authorizeFirmJobActor(tx, firmId, actorId, input.newCompany ? PERMISSIONS.COMPANIES_MANAGE : PERMISSIONS.COMPANIES_VIEW);
      await assertTransactionFeature(tx, firmId, 'companies');
      let companyId = input.companyId;
      if (input.newCompany) {
        const company = await createCompanyForSales(tx, firmId, input.newCompany, { ...metadata, firmId, userId: actorId }); companyId = company.id;
        await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'Company', entityId: String(company.id), action: AuditAction.CREATE, policy: 'REQUIRED', newValues: json(company) });
      }
      if (!companyId) throw new AppError('Choose a company', 400);
      await this.company(tx, firmId, companyId);
      const row = await tx.lead.update({ where: { id }, data: { companyId, status: 'CONVERTED', conversionKey: input.idempotencyKey, conversionHash: hash, version: { increment: 1 } } });
      // Existing source links remain coherent when a prospect becomes a customer.
      const conflicts = await tx.opportunity.count({ where: { firmId, leadId: id, companyId: { not: companyId } } });
      const taskConflicts = await tx.salesTask.count({ where: { firmId, leadId: id, companyId: { not: companyId } } });
      const activityConflicts = await tx.salesActivity.count({ where: { firmId, leadId: id, companyId: { not: companyId } } });
      if (conflicts || taskConflicts || activityConflicts) throw new AppError('Linked sales records use a different company', 409);
      await tx.opportunity.updateMany({ where: { firmId, leadId: id, companyId: null }, data: { companyId, version: { increment: 1 } } });
      await tx.salesTask.updateMany({ where: { firmId, leadId: id, companyId: null }, data: { companyId, version: { increment: 1 } } });
      await tx.salesActivity.updateMany({ where: { firmId, leadId: id, companyId: null }, data: { companyId } });
      await this.event(tx, firmId, actorId, 'Lead', row, 'Lead linked to company', old, row, metadata); return row;
    });
  }
  private opportunityValue(value: string, currency: string) {
    const result = money(value, currencyCode(currency)).amount;
    if (!decimal(result).eq(value)) throw new AppError('Opportunity value exceeds currency precision', 400);
    return decimal(result);
  }
  async createOpportunity(firmId: number, actorId: number, input: z.infer<typeof opportunityCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true); await this.owner(tx, firmId, input.ownerId);
      const links = await this.links(tx, firmId, actorId, all, input);
      const row = await tx.opportunity.create({ data: { ...input, ...links, firmId, createdById: actorId, probability: input.stage === 'WON' || input.stage === 'LOST' ? OPPORTUNITY_STAGES[input.stage] : input.probability ?? OPPORTUNITY_STAGES[input.stage], value: this.opportunityValue(input.value, input.currency), expectedClose: input.expectedClose ? new Date(input.expectedClose) : null } });
      await this.event(tx, firmId, actorId, 'Opportunity', row, 'Opportunity created', null, row, metadata); return row;
    });
  }
  async updateOpportunity(firmId: number, actorId: number, id: number, input: z.infer<typeof opportunityUpdateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      const old = await tx.opportunity.findFirst({ where: { id, firmId, ...this.scope(all, actorId) } });
      if (!old) throw new AppError('Opportunity not found', 404);
      const { expectedVersion, expectedClose, ...data } = input;
      if (old.version !== expectedVersion) throw new AppError('Opportunity changed; reload', 409);
      if (input.ownerId) await this.owner(tx, firmId, input.ownerId);
      const stage = input.stage ?? old.stage as keyof typeof OPPORTUNITY_STAGES;
      const row = await tx.opportunity.update({ where: { id }, data: { ...data, value: this.opportunityValue(input.value ?? old.value.toString(), input.currency ?? old.currency), probability: stage === 'WON' || stage === 'LOST' ? OPPORTUNITY_STAGES[stage] : input.probability ?? (input.stage && input.stage !== old.stage ? OPPORTUNITY_STAGES[input.stage] : old.probability), ...(expectedClose === undefined ? {} : { expectedClose: expectedClose ? new Date(expectedClose) : null }), version: { increment: 1 } } });
      await this.event(tx, firmId, actorId, 'Opportunity', row, 'Opportunity updated', old, row, metadata); return row;
    });
  }
  async createTask(firmId: number, actorId: number, input: z.infer<typeof taskCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true); await this.owner(tx, firmId, input.assignedToId);
      const links = await this.links(tx, firmId, actorId, all, input);
      const row = await tx.salesTask.create({ data: { ...input, ...links, firmId, createdById: actorId, dueAt: new Date(input.dueAt), reminderAt: input.reminderAt ? new Date(input.reminderAt) : null } });
      await this.event(tx, firmId, actorId, 'SalesTask', row, 'Follow-up assigned', null, row, metadata); return row;
    });
  }
  async updateTask(firmId: number, actorId: number, id: number, input: z.infer<typeof taskUpdateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      const old = await tx.salesTask.findFirst({ where: { id, firmId, ...this.scope(all, actorId, 'assignedToId') } });
      if (!old) throw new AppError('Task not found', 404);
      const { expectedVersion, dueAt, reminderAt, ...data } = input;
      if (old.version !== expectedVersion) throw new AppError('Task changed; reload', 409);
      if (input.assignedToId) await this.owner(tx, firmId, input.assignedToId);
      const due = dueAt ? new Date(dueAt) : old.dueAt;
      const reminder = reminderAt === undefined ? old.reminderAt : reminderAt ? new Date(reminderAt) : null;
      if (reminder && reminder > due) throw new AppError('Reminder cannot follow the due date', 400);
      const row = await tx.salesTask.update({ where: { id }, data: { ...data, dueAt: due, reminderAt: reminder, version: { increment: 1 } } });
      await this.event(tx, firmId, actorId, 'SalesTask', row, 'Follow-up updated', old, row, metadata); return row;
    });
  }
  async activity(firmId: number, actorId: number, input: z.infer<typeof activityCreateSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      const all = await this.access(tx, firmId, actorId, true);
      const links = await this.links(tx, firmId, actorId, all, input);
      const row = await tx.salesActivity.create({ data: { ...input, ...links, firmId, createdById: actorId } });
      await createAuditLog(tx, { metadata: { ...metadata, firmId, userId: actorId }, entityType: 'SalesActivity', entityId: String(row.id), action: AuditAction.CREATE, policy: 'REQUIRED', newValues: json(row) }); return row;
    });
  }
  async timeline(firmId: number, actorId: number, query: CustomerTimelineList) {
    return this.db.$transaction(async (tx) => {
      const all = await this.access(tx, firmId, actorId);
      if (query.companyId) await this.company(tx, firmId, query.companyId);
      const where: Prisma.SalesActivityWhereInput = { firmId, companyId: query.companyId, leadId: query.leadId, ...(all ? {} : { OR: [{ createdById: actorId }, { lead: { ownerId: actorId } }, { opportunity: { ownerId: actorId } }, { task: { assignedToId: actorId } }] }) };
      return { records: await tx.salesActivity.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: listOrderBy(query, ['id', 'createdAt', 'subject', 'kind']), include: { createdBy: { select: { id: true, name: true } } } }), pagination: pagination(query, await tx.salesActivity.count({ where })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
}
export const crmRepository = new CrmRepository(prisma);
export const readPipelineReport = crmRepository.pipelineReport.bind(crmRepository);
