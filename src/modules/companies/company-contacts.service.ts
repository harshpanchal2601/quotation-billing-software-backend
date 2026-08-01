import type { CompanyContact, Prisma, PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, pickChangedFields, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { serialiseContact } from './companies.serializer.js';
import type {
  CompanyContactCreateInput,
  CompanyContactUpdateInput,
} from './companies.validation.js';

const contactAuditFields = [
  'name',
  'designation',
  'email',
  'phone',
  'alternatePhone',
  'isPrimary',
] as const;

export class CompanyContactsService {
  constructor(private readonly db: PrismaClient) {}

  async createContact(companyId: number, input: CompanyContactCreateInput, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);

    const created = await this.db.$transaction(async (tx) => {
      if (input.isPrimary) {
        await tx.companyContact.updateMany({
          where: { companyId, deletedAt: null, isPrimary: true },
          data: { isPrimary: false },
        });
      }

      return tx.companyContact.create({
        data: {
          companyId,
          name: input.name,
          designation: input.designation ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
          alternatePhone: input.alternatePhone ?? null,
          isPrimary: input.isPrimary,
        },
      });
    });

    await this.auditContact(AuditAction.CREATE, created, metadata);
    return serialiseContact(created);
  }

  async updateContact(
    companyId: number,
    contactId: number,
    input: CompanyContactUpdateInput,
    metadata: RequestMetadata,
  ) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveContact(companyId, contactId);
    const data = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.designation === undefined ? {} : { designation: input.designation ?? null }),
      ...(input.email === undefined ? {} : { email: input.email ?? null }),
      ...(input.phone === undefined ? {} : { phone: input.phone ?? null }),
      ...(input.alternatePhone === undefined ? {} : { alternatePhone: input.alternatePhone ?? null }),
      ...(input.isPrimary === undefined ? {} : { isPrimary: input.isPrimary }),
    };

    if (Object.keys(data).length === 0) {
      return serialiseContact(existing);
    }

    const updated = await this.db.$transaction(async (tx) => {
      if (input.isPrimary === true) {
        await tx.companyContact.updateMany({
          where: { companyId, deletedAt: null, isPrimary: true, NOT: { id: contactId } },
          data: { isPrimary: false },
        });
      }

      return tx.companyContact.update({
        where: { id: contactId },
        data,
      });
    });

    await this.auditContact(AuditAction.UPDATE, updated, metadata, existing);
    return serialiseContact(updated);
  }

  async deleteContact(companyId: number, contactId: number, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveContact(companyId, contactId);

    await this.db.$transaction(async (tx) => {
      await tx.companyContact.update({
        where: { id: contactId },
        data: { deletedAt: new Date(), isPrimary: false },
      });

      if (existing.isPrimary) {
        const replacement = await tx.companyContact.findFirst({
          where: { companyId, deletedAt: null, NOT: { id: contactId } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        if (replacement !== null) {
          await tx.companyContact.update({
            where: { id: replacement.id },
            data: { isPrimary: true },
          });
        }
      }
    });

    await this.auditContact(AuditAction.DELETE, existing, metadata);
  }

  async setPrimaryContact(companyId: number, contactId: number, metadata: RequestMetadata) {
    await this.ensureActiveCompany(companyId);
    const existing = await this.getActiveContact(companyId, contactId);

    const updated = await this.db.$transaction(async (tx) => {
      await tx.companyContact.updateMany({
        where: { companyId, deletedAt: null, isPrimary: true, NOT: { id: contactId } },
        data: { isPrimary: false },
      });

      return tx.companyContact.update({
        where: { id: contactId },
        data: { isPrimary: true },
      });
    });

    await this.auditContact(AuditAction.UPDATE, updated, metadata, existing, {
      primaryChanged: true,
    });
    return serialiseContact(updated);
  }

  private async ensureActiveCompany(companyId: number) {
    const company = await this.db.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (company === null) throw new AppError('Company not found', 404);
  }

  private async getActiveContact(companyId: number, contactId: number) {
    const contact = await this.db.companyContact.findFirst({
      where: { id: contactId, companyId, deletedAt: null, company: { deletedAt: null } },
    });
    if (contact === null) throw new AppError('Company contact not found', 404);
    return contact;
  }

  private async auditContact(
    action: AuditAction,
    contact: CompanyContact,
    metadata: RequestMetadata,
    previous?: CompanyContact,
    extra?: Prisma.InputJsonObject,
  ) {
    const changed = previous
      ? pickChangedFields(
          previous as unknown as Record<string, unknown>,
          contact as unknown as Record<string, unknown>,
          [...contactAuditFields],
        )
      : undefined;

    await createAuditLog(this.db, {
      metadata,
      entityType: 'CompanyContact',
      entityId: String(contact.id),
      action,
      oldValues: changed?.oldValues,
      newValues: {
        ...(changed?.newValues ?? {
          companyId: contact.companyId,
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          isPrimary: contact.isPrimary,
        }),
        ...extra,
      },
    });
  }
}
