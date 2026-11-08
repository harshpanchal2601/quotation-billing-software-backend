import { AuditAction, Prisma, type PrismaClient, type PortalGrant } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../../core/database/prisma.js';
import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { requestHash } from '../../core/idempotency/request-hash.js';
import { jsonObject as json } from '../../core/serialization/json.js';
import { authorizeFirmJobActor } from '../auth/index.js';
import { PERMISSIONS } from '../auth/permissions.js';
import { assertTransactionFeature, withFirmEntitlementTransaction, type FeatureKey } from '../entitlements/index.js';
import { applyPortalQuotationDecision, customerQuotationSnapshot, isCustomerQuotationDecisionOpen } from '../quotations/index.js';
import { assertSalesCapability, readCustomerSellerSnapshot } from '../settings/index.js';
import { PORTAL_CONSENT, type portalInviteSchema, type portalGrantSchema, type portalDecisionSchema, type portalListSchema } from './portal.schema.js';
import { matchesPortalToken, newPortalToken, portalCsrfToken, portalTokenHash } from './portal-tokens.js';

function unavailable() { return new AppError('Portal access unavailable or expired', 401); }
const identityInclude = { company: true, contact: true } satisfies Prisma.PortalIdentityInclude;
const sessionInclude = { identity: { include: identityInclude }, invitation: true } satisfies Prisma.PortalSessionInclude;
type PortalSessionRecord = Prisma.PortalSessionGetPayload<{ include: typeof sessionInclude }>;
type Grant = PortalGrant;
function validIdentity(identity: Prisma.PortalIdentityGetPayload<{ include: typeof identityInclude }>) {
  return !identity.revokedAt && !identity.company.deletedAt && identity.company.isActive && !identity.contact.deletedAt && identity.contact.email?.trim().toLowerCase() === identity.email;
}
export class PortalRepository {
  constructor(private readonly db: PrismaClient) {}
  private async staff(tx: Prisma.TransactionClient, firmId: number, actorId: number) { await authorizeFirmJobActor(tx, firmId, actorId, PERMISSIONS.PORTAL_MANAGE); await assertTransactionFeature(tx, firmId, 'customer.portal'); await assertSalesCapability(tx, firmId, 'portal'); }
  private async documentAccess(tx: Prisma.TransactionClient, firmId: number, actorId: number, type: 'quotation' | 'invoice' | 'order') {
    const permission = type === 'quotation' ? PERMISSIONS.QUOTATIONS_VIEW : type === 'invoice' ? PERMISSIONS.INVOICES_VIEW : PERMISSIONS.SALES_ORDERS_VIEW;
    await authorizeFirmJobActor(tx, firmId, actorId, permission);
    await assertTransactionFeature(tx, firmId, type === 'quotation' ? 'quotations' : type === 'invoice' ? 'billing.invoices' : 'sales.orders');
  }
  private async audit(tx: Prisma.TransactionClient, firmId: number, entity: string, id: number, values: unknown, metadata: RequestMetadata) {
    await createAuditLog(tx, { metadata: { ...metadata, firmId }, entityType: entity, entityId: String(id), action: AuditAction.UPDATE, policy: 'REQUIRED', newValues: json(values) });
  }
  async invite(firmId: number, actorId: number, input: z.infer<typeof portalInviteSchema>, metadata: RequestMetadata) {
    const token = newPortalToken();
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.staff(tx, firmId, actorId);
      const contact = await tx.companyContact.findFirst({ where: { id: input.contactId, companyId: input.companyId, deletedAt: null, company: { firmId, deletedAt: null, isActive: true } } });
      if (!contact?.email) throw new AppError('An active company contact with an email is required', 404);
      const expiresAt = new Date(input.expiresAt);
      if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 7 * 86400000) throw new AppError('Invitation expiry must be within the next seven days', 400);
      let identity = await tx.portalIdentity.findUnique({ where: { firmId_contactId: { firmId, contactId: contact.id } } });
      const email = contact.email.trim().toLowerCase();
      if (identity && (identity.revokedAt || identity.email !== email)) throw new AppError('This portal identity was revoked or its email changed; review access with a new contact', 409);
      identity ??= await tx.portalIdentity.create({ data: { firmId, companyId: input.companyId, contactId: contact.id, name: contact.name, email } });
      const row = await tx.portalInvitation.create({ data: { firmId, companyId: input.companyId, identityId: identity.id, tokenHash: portalTokenHash(token), expiresAt, createdById: actorId } });
      await this.audit(tx, firmId, 'PortalInvitation', row.id, { identityId: identity.id, contactId: contact.id, expiresAt }, { ...metadata, userId: actorId });
      return { invitationId: row.id, identityId: identity.id, email, token, expiresAt: expiresAt.toISOString() };
    });
  }
  async share(firmId: number, actorId: number, input: z.infer<typeof portalGrantSchema>, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.staff(tx, firmId, actorId);
      const identity = await tx.portalIdentity.findFirst({ where: { id: input.identityId, firmId }, include: identityInclude });
      if (!identity || !validIdentity(identity)) throw new AppError('Portal identity unavailable', 404);
      const expiresAt = new Date(input.expiresAt);
      if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + 90 * 86400000) throw new AppError('Document expiry must be within the next ninety days', 400);
      let snapshot: Prisma.InputJsonObject;
      if (input.quotationId) {
        await this.documentAccess(tx, firmId, actorId, 'quotation');
        const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM quotations WHERE id = ${input.quotationId} AND firm_id = ${firmId} AND company_id = ${identity.companyId} AND deleted_at IS NULL FOR UPDATE`;
        if (locked.length !== 1) throw new AppError('Quotation unavailable', 404);
        const quote = await tx.quotation.findFirst({ where: { id: input.quotationId, firmId, companyId: identity.companyId, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
        if (!quote) throw new AppError('Quotation unavailable for sharing', 404);
        if (input.allowDecision && !isCustomerQuotationDecisionOpen(quote)) throw new AppError('Only a current open quotation supports decisions', 409);
        snapshot = json({ ...customerQuotationSnapshot(quote), seller: await readCustomerSellerSnapshot(tx, firmId) });
      } else if (input.invoiceId) {
        await this.documentAccess(tx, firmId, actorId, 'invoice');
        const invoice = await tx.invoice.findFirst({ where: { id: input.invoiceId, firmId, companyId: identity.companyId, kind: 'INVOICE', status: 'ISSUED' }, include: { lines: { orderBy: { lineNumber: 'asc' } } } });
        if (!invoice) throw new AppError('Issued invoice unavailable', 404);
        snapshot = json({ kind: 'INVOICE', id: invoice.id, documentNumber: invoice.documentNumber, invoiceDate: invoice.invoiceDate, dueDate: invoice.dueDate, currency: invoice.currency, buyer: invoice.buyerSnapshot, seller: invoice.sellerSnapshot, bank: invoice.bankSnapshot, paymentTerms: invoice.paymentTerms, subtotal: invoice.subtotal, taxAmount: invoice.taxAmount, grandTotal: invoice.grandTotal, items: invoice.lines.map((line) => line.snapshot) });
      } else {
        await this.documentAccess(tx, firmId, actorId, 'order');
        const order = await tx.salesOrder.findFirst({ where: { id: input.salesOrderId!, firmId, companyId: identity.companyId, status: { not: 'CANCELLED' } } });
        if (!order) throw new AppError('Sales order unavailable', 404);
        snapshot = json({ ...order.snapshot as Prisma.JsonObject, kind: 'SALES_ORDER', id: order.id, orderNumber: order.orderNumber, status: order.status });
      }
      const row = await tx.portalGrant.create({ data: { ...input, companyId: identity.companyId, firmId, snapshot, snapshotHash: requestHash(snapshot), expiresAt, createdById: actorId } });
      await this.audit(tx, firmId, 'PortalGrant', row.id, { identityId: identity.id, quotationId: row.quotationId, invoiceId: row.invoiceId, salesOrderId: row.salesOrderId, snapshotHash: row.snapshotHash, allowDecision: row.allowDecision, expiresAt }, { ...metadata, userId: actorId });
      return { id: row.id, snapshotHash: row.snapshotHash };
    });
  }
  async staffList(firmId: number, actorId: number, query: z.infer<typeof portalListSchema>) {
    return this.db.$transaction(async (tx) => {
      await this.staff(tx, firmId, actorId);
      const where = { firmId, companyId: query.companyId };
      // Evidence is internal-only. Tokens, hashes and document bodies are absent.
      const identities = await tx.portalIdentity.findMany({ where, skip: (query.page - 1) * 20, take: 20, orderBy: { id: 'desc' }, select: { id: true, companyId: true, contactId: true, email: true, name: true, revokedAt: true, _count: { select: { invitations: true, grants: true } }, invitations: { orderBy: { id: 'desc' }, skip: (query.historyPage - 1) * 20, take: 20, select: { id: true, expiresAt: true, consumedAt: true, revokedAt: true } }, grants: { orderBy: { id: 'desc' }, skip: (query.historyPage - 1) * 20, take: 20, select: { id: true, quotationId: true, invoiceId: true, salesOrderId: true, allowDecision: true, expiresAt: true, revokedAt: true, acceptances: { select: { id: true, decision: true, revisionNumber: true, actorName: true, createdAt: true, snapshotHash: true } } } } } });
      return { identities, total: await tx.portalIdentity.count({ where }), hasMoreHistory: identities.some((identity) => Math.max(identity._count.invitations, identity._count.grants) > query.historyPage * 20) };
    });
  }
  async contacts(firmId: number, actorId: number, companyId: number) {
    return this.db.$transaction(async (tx) => {
      await this.staff(tx, firmId, actorId);
      return tx.companyContact.findMany({ where: { companyId, deletedAt: null, email: { not: null }, company: { firmId, deletedAt: null, isActive: true } }, select: { id: true, name: true, email: true }, orderBy: { id: 'asc' }, take: 100 });
    });
  }
  async revoke(firmId: number, actorId: number, kind: 'identity' | 'invitation' | 'grant', id: number, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.staff(tx, firmId, actorId);
      const where = { id, firmId }; const data = { revokedAt: new Date() };
      const result = kind === 'identity' ? await tx.portalIdentity.updateMany({ where, data }) : kind === 'invitation' ? await tx.portalInvitation.updateMany({ where, data }) : await tx.portalGrant.updateMany({ where, data });
      if (result.count !== 1) throw new AppError('Portal record not found', 404);
      if (kind === 'identity') {
        await tx.portalInvitation.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data });
        await tx.portalSession.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data });
        await tx.portalGrant.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data });
      }
      await this.audit(tx, firmId, 'PortalRevocation', id, { kind, revokedAt: data.revokedAt }, { ...metadata, userId: actorId });
    });
  }
  async exchange(token: string, previousToken: string | undefined, metadata: RequestMetadata) {
    const found = await this.db.portalInvitation.findUnique({ where: { tokenHash: portalTokenHash(token) }, select: { firmId: true, id: true } });
    if (!found) throw unavailable();
    return withFirmEntitlementTransaction(this.db, found.firmId, async (tx) => {
      await assertTransactionFeature(tx, found.firmId, 'customer.portal');
      await assertSalesCapability(tx, found.firmId, 'portal');
      const invitation = await tx.portalInvitation.findUnique({ where: { id: found.id }, include: { identity: { include: identityInclude } } });
      const now = new Date();
      if (!invitation || invitation.revokedAt || invitation.consumedAt || invitation.expiresAt <= now || !validIdentity(invitation.identity)) throw unavailable();
      const consumed = await tx.portalInvitation.updateMany({ where: { id: invitation.id, consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
      if (consumed.count !== 1) throw unavailable();
      if (previousToken) await tx.portalSession.updateMany({ where: { tokenHash: portalTokenHash(previousToken) }, data: { revokedAt: now } });
      const sessionToken = newPortalToken(); const csrfToken = portalCsrfToken(sessionToken); const expiresAt = new Date(now.getTime() + 3600000);
      const session = await tx.portalSession.create({ data: { firmId: invitation.firmId, companyId: invitation.companyId, identityId: invitation.identityId, invitationId: invitation.id, tokenHash: portalTokenHash(sessionToken), csrfHash: portalTokenHash(csrfToken), expiresAt } });
      await this.audit(tx, found.firmId, 'PortalSession', session.id, { identityId: invitation.identityId, invitationId: invitation.id, expiresAt }, { ...metadata, userId: undefined });
      return { sessionToken, csrfToken, expiresAt };
    });
  }
  async restoreIdentity(firmId: number, actorId: number, id: number, metadata: RequestMetadata) {
    return withFirmEntitlementTransaction(this.db, firmId, async (tx) => {
      await this.staff(tx, firmId, actorId);
      const identity = await tx.portalIdentity.findFirst({ where: { id, firmId }, include: identityInclude });
      if (!identity || identity.company.deletedAt || !identity.company.isActive || identity.contact.deletedAt || !identity.contact.email) throw new AppError('Active contact unavailable', 404);
      // Restoration never revives old links, sessions or document grants.
      const revokedAt = new Date();
      await tx.portalInvitation.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data: { revokedAt } });
      await tx.portalSession.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data: { revokedAt } });
      await tx.portalGrant.updateMany({ where: { firmId, identityId: id, revokedAt: null }, data: { revokedAt } });
      await tx.portalIdentity.update({ where: { id }, data: { revokedAt: null, email: identity.contact.email.trim().toLowerCase(), name: identity.contact.name } });
      await this.audit(tx, firmId, 'PortalIdentity', id, { restored: true, contactId: identity.contactId, email: identity.contact.email.trim().toLowerCase() }, { ...metadata, userId: actorId });
    });
  }
  private async session<T>(token: string | undefined, csrf: string | undefined, work: (tx: Prisma.TransactionClient, session: PortalSessionRecord) => Promise<T>) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const found = await this.db.portalSession.findUnique({ where: { tokenHash: portalTokenHash(token) }, select: { id: true, firmId: true } });
    if (!found) throw unavailable();
    return withFirmEntitlementTransaction(this.db, found.firmId, async (tx) => {
      const session = await tx.portalSession.findUnique({ where: { id: found.id }, include: sessionInclude });
      if (!session || session.revokedAt || session.expiresAt <= new Date() || session.invitation.revokedAt || !validIdentity(session.identity)) throw unavailable();
      await assertTransactionFeature(tx, session.firmId, 'customer.portal');
      await assertSalesCapability(tx, session.firmId, 'portal');
      if (csrf !== undefined && !matchesPortalToken(csrf, session.csrfHash)) throw new AppError('Portal request confirmation required', 403);
      return work(tx, session);
    });
  }
  private async grant(tx: Prisma.TransactionClient, session: PortalSessionRecord, id: number) {
    const grant = await tx.portalGrant.findFirst({ where: { id, firmId: session.firmId, companyId: session.companyId, identityId: session.identityId, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!grant) throw new AppError('Shared document not found', 404);
    await this.liveDocument(tx, grant); return grant;
  }
  private async liveDocument(tx: Prisma.TransactionClient, grant: Grant) {
    const feature: FeatureKey = grant.quotationId ? 'quotations' : grant.invoiceId ? 'billing.invoices' : 'sales.orders';
    await assertTransactionFeature(tx, grant.firmId, feature);
    const where = { firmId: grant.firmId, companyId: grant.companyId };
    const live = grant.quotationId ? await tx.quotation.findFirst({ where: { ...where, id: grant.quotationId, deletedAt: null, status: { notIn: ['DRAFT', 'CANCELLED'] } }, select: { id: true } }) : grant.invoiceId ? await tx.invoice.findFirst({ where: { ...where, id: grant.invoiceId, status: 'ISSUED', kind: 'INVOICE' }, select: { id: true } }) : await tx.salesOrder.findFirst({ where: { ...where, id: grant.salesOrderId!, status: { not: 'CANCELLED' } }, select: { id: true } });
    if (!live) throw new AppError('Shared document no longer available', 404);
  }
  async listDocuments(token: string | undefined, page: number) {
    return this.session(token, undefined, async (tx, session) => {
      const rows = await tx.portalGrant.findMany({ where: { firmId: session.firmId, companyId: session.companyId, identityId: session.identityId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { id: 'desc' }, skip: (page - 1) * 20, take: 20 });
      const documents = [];
      for (const row of rows) {
        try { await this.liveDocument(tx, row); } catch (error) { if (error instanceof AppError && [403, 404].includes(error.statusCode)) continue; throw error; }
        const snapshot = row.snapshot as Prisma.JsonObject;
        documents.push({ id: row.id, kind: snapshot.kind, number: snapshot.orderNumber ?? snapshot.documentNumber ?? snapshot.quotationNumber, revisionNumber: snapshot.revisionNumber, expiresAt: row.expiresAt });
      }
      return { contactName: session.identity.name, documents, page, hasMore: rows.length === 20, consent: PORTAL_CONSENT };
    });
  }
  async document(token: string | undefined, id: number) {
    return this.session(token, undefined, async (tx, session) => {
      const grant = await this.grant(tx, session, id);
      const evidence = await tx.documentAcceptance.findFirst({ where: { firmId: session.firmId, quotationId: grant.quotationId ?? -1 }, select: { decision: true, revisionNumber: true, createdAt: true } });
      let canDecide = false;
      if (grant.allowDecision && grant.quotationId && !evidence) {
        const quote = await tx.quotation.findFirst({ where: { id: grant.quotationId, firmId: session.firmId, companyId: session.companyId, deletedAt: null, isLatestRevision: true, status: { in: ['PENDING', 'SENT'] } }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
        canDecide = quote !== null && isCustomerQuotationDecisionOpen(quote) && requestHash({ ...customerQuotationSnapshot(quote), seller: (grant.snapshot as Prisma.JsonObject).seller }) === grant.snapshotHash;
      }
      return { id: grant.id, snapshot: grant.snapshot, snapshotHash: grant.snapshotHash, canDecide, evidence, consent: PORTAL_CONSENT };
    });
  }
  async decide(token: string | undefined, csrf: string, input: z.infer<typeof portalDecisionSchema>, metadata: RequestMetadata) {
    return this.session(token, csrf, async (tx, session) => {
      const grant = await this.grant(tx, session, input.grantId);
      if (!grant.quotationId || !grant.allowDecision || input.snapshotHash !== grant.snapshotHash) throw new AppError('Decision is not authorized for this shared revision', 403);
      const hash = requestHash({ identityId: session.identityId, input });
      const replay = await tx.documentAcceptance.findUnique({ where: { firmId_idempotencyKey: { firmId: session.firmId, idempotencyKey: input.idempotencyKey } } });
      if (replay) { if (replay.requestHash !== hash || replay.identityId !== session.identityId) throw new AppError('Decision idempotency conflict', 409); return { id: replay.id, decision: replay.decision, createdAt: replay.createdAt }; }
      const locked = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM quotations WHERE id = ${grant.quotationId} AND firm_id = ${session.firmId} AND company_id = ${session.companyId} AND deleted_at IS NULL FOR UPDATE`;
      if (locked.length !== 1) throw new AppError('Quotation revision unavailable', 404);
      const quote = await tx.quotation.findUniqueOrThrow({ where: { id: grant.quotationId }, include: { items: { orderBy: { lineNumber: 'asc' } } } });
      if (requestHash({ ...customerQuotationSnapshot(quote), seller: (grant.snapshot as Prisma.JsonObject).seller }) !== grant.snapshotHash) throw new AppError('Quotation changed; request a new share', 409);
      const evidence = await tx.documentAcceptance.create({ data: { firmId: session.firmId, companyId: session.companyId, quotationId: quote.id, revisionNumber: quote.revisionNumber, grantId: grant.id, identityId: session.identityId, sessionId: session.id, decision: input.decision, snapshotHash: grant.snapshotHash, actorName: session.identity.name, actorEmail: session.identity.email, consent: input.consent, ipAddress: metadata.ipAddress, userAgent: metadata.userAgent, idempotencyKey: input.idempotencyKey, requestHash: hash } });
      await applyPortalQuotationDecision(tx, session.firmId, quote.id, input.decision, session.identity.name, evidence.id);
      await this.audit(tx, session.firmId, 'DocumentAcceptance', evidence.id, { quotationId: quote.id, revisionNumber: quote.revisionNumber, companyId: session.companyId, identityId: session.identityId, grantId: grant.id, decision: input.decision, snapshotHash: grant.snapshotHash }, { ...metadata, userId: undefined });
      return { id: evidence.id, decision: evidence.decision, createdAt: evidence.createdAt };
    });
  }
  async logout(token: string | undefined, csrf: string) {
    return this.session(token, csrf, async (tx, session) => { await tx.portalSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } }); });
  }
  async resume(token: string | undefined) {
    return this.session(token, undefined, async (tx, session) => {
      return { csrfToken: portalCsrfToken(token!), expiresAt: session.expiresAt };
    });
  }
}
export const portalRepository = new PortalRepository(prisma);
