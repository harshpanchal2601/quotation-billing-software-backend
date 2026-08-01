import { AuditAction, Prisma, QuotationStatus, type PrismaClient } from '@prisma/client';

import { AppError } from '../../core/errors/AppError.js';
import { createAuditLog, type RequestMetadata } from '../../core/audit/audit-log.service.js';
import { calculateQuotationTotals } from './quotation-calculation.service.js';
import {
  isValidUntilBeforeQuotationDate,
  parseDateOnlyToUtcDate,
  serialiseDateOnly,
  VALID_UNTIL_DATE_MESSAGE,
} from './quotation-dates.js';
import { generateUniqueQuotationNumber } from './quotation-number.service.js';
import {
  deriveCompanySnapshots,
  validateAndSnapshotQuotationItems,
} from './quotation-snapshot.service.js';
import {
  getStatusTimestampUpdate,
  recordStatusHistory,
  validateStatusTransition,
} from './quotation-status.service.js';
import { createQuotationVersion } from './quotation-version.service.js';
import {
  serialiseQuotationDetail,
  serialiseQuotationListItem,
} from './quotations.serializer.js';
import type {
  CalculationPreviewInput,
  QuotationCreateInput,
  QuotationListQuery,
  QuotationStatusUpdateInput,
  QuotationUpdateInput,
} from './quotations.types.js';

export class QuotationsService {
  constructor(private readonly db: PrismaClient) {}

  async calculatePreview(input: CalculationPreviewInput) {
    const validatedItems = await validateAndSnapshotQuotationItems(this.db, input.items);
    return calculateQuotationTotals({
      ...input,
      items: validatedItems,
    });
  }

  async createQuotation(input: QuotationCreateInput, metadata: RequestMetadata, userId: number) {
    const companySnapshots = await deriveCompanySnapshots(
      this.db,
      input.companyId,
      input.companyContactId,
      input.billingAddressId,
      input.shippingAddressId,
    );

    const validatedItems = await validateAndSnapshotQuotationItems(this.db, input.items);

    const calculated = calculateQuotationTotals({
      taxMode: input.taxMode,
      quotationDiscountType: input.quotationDiscountType,
      quotationDiscountValue: input.quotationDiscountValue,
      freightAmount: input.freightAmount,
      otherCharges: input.otherCharges,
      items: validatedItems,
    });

    const quotationDate = parseDateOnlyToUtcDate(input.quotationDate);
    const validUntil = input.validUntil ? parseDateOnlyToUtcDate(input.validUntil) : null;

    validateValidUntilDate(quotationDate, validUntil);

    const newQuotation = await this.db.$transaction(async (tx) => {
      const quotationNumber = await generateUniqueQuotationNumber(tx, this.db, quotationDate);

      const created = await tx.quotation.create({
        data: {
          quotationNumber,
          revisionNumber: 0,
          isLatestRevision: true,
          companyId: input.companyId,
          companyContactId: input.companyContactId ?? null,
          billingAddressId: input.billingAddressId ?? null,
          shippingAddressId: input.shippingAddressId ?? null,
          companyNameSnapshot: companySnapshots.companyNameSnapshot,
          companyGstinSnapshot: companySnapshots.companyGstinSnapshot,
          companyPanSnapshot: companySnapshots.companyPanSnapshot,
          contactNameSnapshot: companySnapshots.contactNameSnapshot,
          contactEmailSnapshot: companySnapshots.contactEmailSnapshot,
          contactPhoneSnapshot: companySnapshots.contactPhoneSnapshot,
          billingAddressSnapshot: companySnapshots.billingAddressSnapshot as Prisma.InputJsonValue,
          shippingAddressSnapshot: companySnapshots.shippingAddressSnapshot as Prisma.InputJsonValue,
          quotationDate,
          validUntil,
          customerReference: input.customerReference ?? null,
          internalReference: input.internalReference ?? null,
          status: QuotationStatus.DRAFT,
          currency: input.currency || 'INR',
          taxMode: input.taxMode ?? 'CGST_SGST',
          subtotal: new Prisma.Decimal(calculated.subtotal),
          itemDiscountAmount: new Prisma.Decimal(calculated.itemDiscountAmount),
          quotationDiscountType: calculated.quotationDiscountType,
          quotationDiscountValue: new Prisma.Decimal(calculated.quotationDiscountValue),
          quotationDiscountAmount: new Prisma.Decimal(calculated.quotationDiscountAmount),
          taxableAmount: new Prisma.Decimal(calculated.taxableAmount),
          cgstAmount: new Prisma.Decimal(calculated.cgstAmount),
          sgstAmount: new Prisma.Decimal(calculated.sgstAmount),
          igstAmount: new Prisma.Decimal(calculated.igstAmount),
          freightAmount: new Prisma.Decimal(calculated.freightAmount),
          otherCharges: new Prisma.Decimal(calculated.otherCharges),
          roundOffAmount: new Prisma.Decimal(calculated.roundOffAmount),
          grandTotal: new Prisma.Decimal(calculated.grandTotal),
          amountInWords: calculated.amountInWords,
          deliveryTerms: input.deliveryTerms ?? null,
          dispatchTerms: input.dispatchTerms ?? null,
          paymentTerms: input.paymentTerms ?? null,
          taxTerms: input.taxTerms ?? null,
          freightTerms: input.freightTerms ?? null,
          warrantyTerms: input.warrantyTerms ?? null,
          remarks: input.remarks ?? null,
          termsAndConditions: input.termsAndConditions ?? null,
          internalNotes: input.internalNotes ?? null,
          createdById: userId,
        },
      });

      const itemCreateData = calculated.items.map((line) => ({
        quotationId: created.id,
        itemId: line.itemId,
        lineNumber: line.lineNumber,
        itemCodeSnapshot: line.itemCodeSnapshot,
        itemNameSnapshot: line.itemNameSnapshot,
        descriptionSnapshot: line.descriptionSnapshot,
        specificationsSnapshot: line.specificationsSnapshot as Prisma.InputJsonValue,
        measurementUnitSnapshot: line.measurementUnitSnapshot,
        quantity: new Prisma.Decimal(line.quantity),
        unitRate: new Prisma.Decimal(line.unitRate),
        discountType: line.discountType,
        discountValue: new Prisma.Decimal(line.discountValue),
        discountAmount: new Prisma.Decimal(line.discountAmount),
        gstRate: new Prisma.Decimal(line.gstRate),
        baseAmount: new Prisma.Decimal(line.baseAmount),
        taxableAmount: new Prisma.Decimal(line.taxableAmount),
        taxAmount: new Prisma.Decimal(line.taxAmount),
        lineTotal: new Prisma.Decimal(line.lineTotal),
        sortOrder: line.sortOrder,
      }));

      await tx.quotationItem.createMany({
        data: itemCreateData,
      });

      await tx.quotationStatusHistory.create({
        data: {
          quotationId: created.id,
          fromStatus: null,
          toStatus: QuotationStatus.DRAFT,
          changedById: userId,
          comment: 'Initial quotation created.',
        },
      });

      await createQuotationVersion(tx, created.id, { created, items: itemCreateData }, userId);

      return tx.quotation.update({
        where: { id: created.id },
        data: { rootQuotationId: created.id },
      });
    });

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Quotation',
      entityId: String(newQuotation.id),
      action: AuditAction.CREATE,
      newValues: {
        quotationNumber: newQuotation.quotationNumber,
        companyId: newQuotation.companyId,
        grandTotal: newQuotation.grandTotal.toFixed(2),
      },
    });

    return this.getQuotation(newQuotation.id);
  }

  async getQuotation(id: number) {
    const quotation = await this.db.quotation.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: true,
        createdBy: true,
        updatedBy: true,
        items: {
          orderBy: [{ sortOrder: 'asc' }, { lineNumber: 'asc' }],
        },
        statusHistory: {
          include: { changedBy: true },
          orderBy: { changedAt: 'asc' },
        },
        previousRevision: true,
        nextRevision: true,
      },
    });

    if (!quotation) {
      throw new AppError('Quotation not found.', 404);
    }

    const familyRootId = quotation.rootQuotationId ?? quotation.id;
    const latestRevision = quotation.isLatestRevision === false
      ? await this.db.quotation.findFirst({
          where: { rootQuotationId: familyRootId, deletedAt: null },
          orderBy: { revisionNumber: 'desc' },
        })
      : quotation;

    return serialiseQuotationDetail({
      ...quotation,
      latestRevision,
    });
  }

  async listQuotations(query: QuotationListQuery) {
    const {
      page,
      limit,
      search,
      companyId,
      status,
      dateFrom,
      dateTo,
      validFrom,
      validTo,
      minTotal,
      maxTotal,
      sortBy,
      sortOrder,
    } = query;

    if (minTotal !== undefined && maxTotal !== undefined && minTotal > maxTotal) {
      throw new AppError('Minimum total cannot exceed maximum total.', 400);
    }

    const where: Prisma.QuotationWhereInput = {
      deletedAt: null,
      isLatestRevision: true,
    };

    if (companyId) {
      where.companyId = companyId;
    }

    if (status) {
      where.status = status;
    }

    if (dateFrom || dateTo) {
      where.quotationDate = {};
      if (dateFrom) where.quotationDate.gte = new Date(dateFrom);
      if (dateTo) where.quotationDate.lte = new Date(dateTo);
    }

    if (validFrom || validTo) {
      where.validUntil = {};
      if (validFrom) where.validUntil.gte = new Date(validFrom);
      if (validTo) where.validUntil.lte = new Date(validTo);
    }

    if (minTotal !== undefined || maxTotal !== undefined) {
      where.grandTotal = {};
      if (minTotal !== undefined) where.grandTotal.gte = new Prisma.Decimal(minTotal);
      if (maxTotal !== undefined) where.grandTotal.lte = new Prisma.Decimal(maxTotal);
    }

    if (search && search.trim().length > 0) {
      const q = search.trim();
      where.OR = [
        { quotationNumber: { contains: q } },
        { companyNameSnapshot: { contains: q } },
        { contactNameSnapshot: { contains: q } },
        { contactPhoneSnapshot: { contains: q } },
        { remarks: { contains: q } },
      ];
    }

    const skip = (page - 1) * limit;

    const [total, records] = await Promise.all([
      this.db.quotation.count({ where }),
      this.db.quotation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
        include: {
          company: true,
          createdBy: true,
          _count: {
            select: { items: true },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
      quotations: records.map(serialiseQuotationListItem),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  async updateQuotation(
    id: number,
    input: QuotationUpdateInput,
    metadata: RequestMetadata,
    userId: number,
  ) {
    const existing = await this.db.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { items: true },
    });

    if (!existing) {
      throw new AppError('Quotation not found.', 404);
    }

    if (existing.status !== QuotationStatus.DRAFT) {
      throw new AppError('This quotation can no longer be edited.', 409);
    }

    if (!existing.isLatestRevision) {
      throw new AppError('This quotation revision can no longer be edited. Edit the latest draft revision instead.', 409);
    }

    const companyId = input.companyId ?? existing.companyId;
    const companySnapshots = await deriveCompanySnapshots(
      this.db,
      companyId,
      input.companyContactId !== undefined ? input.companyContactId : existing.companyContactId,
      input.billingAddressId !== undefined ? input.billingAddressId : existing.billingAddressId,
      input.shippingAddressId !== undefined ? input.shippingAddressId : existing.shippingAddressId,
    );

    const itemsToProcess = input.items
      ? input.items
      : existing.items.map((itm) => ({
          itemId: itm.itemId,
          lineNumber: itm.lineNumber,
          itemName: itm.itemNameSnapshot,
          description: itm.descriptionSnapshot,
          specifications: itm.specificationsSnapshot,
          measurementUnit: itm.measurementUnitSnapshot,
          quantity: itm.quantity.toFixed(3),
          unitRate: itm.unitRate.toFixed(2),
          discountType: itm.discountType,
          discountValue: itm.discountValue.toFixed(2),
          gstRate: itm.gstRate.toFixed(2),
          sortOrder: itm.sortOrder,
        }));

    const validatedItems = await validateAndSnapshotQuotationItems(this.db, itemsToProcess);

    const calculated = calculateQuotationTotals({
      taxMode: input.taxMode ?? existing.taxMode,
      quotationDiscountType: input.quotationDiscountType ?? existing.quotationDiscountType,
      quotationDiscountValue: input.quotationDiscountValue ?? existing.quotationDiscountValue.toFixed(2),
      freightAmount: input.freightAmount ?? existing.freightAmount.toFixed(2),
      otherCharges: input.otherCharges ?? existing.otherCharges.toFixed(2),
      items: validatedItems,
    });

    const quotationDate = input.quotationDate ? parseDateOnlyToUtcDate(input.quotationDate) : existing.quotationDate;
    const validUntil =
      input.validUntil !== undefined
        ? input.validUntil
          ? parseDateOnlyToUtcDate(input.validUntil)
          : null
        : existing.validUntil;

    validateValidUntilDate(quotationDate, validUntil);

    await this.db.$transaction(async (tx) => {
      await createQuotationVersion(tx, existing.id, existing, userId);

      await tx.quotationItem.deleteMany({
        where: { quotationId: existing.id },
      });

      await tx.quotation.update({
        where: { id: existing.id },
        data: {
          companyId,
          companyContactId: input.companyContactId !== undefined ? input.companyContactId : existing.companyContactId,
          billingAddressId: input.billingAddressId !== undefined ? input.billingAddressId : existing.billingAddressId,
          shippingAddressId: input.shippingAddressId !== undefined ? input.shippingAddressId : existing.shippingAddressId,
          companyNameSnapshot: companySnapshots.companyNameSnapshot,
          companyGstinSnapshot: companySnapshots.companyGstinSnapshot,
          companyPanSnapshot: companySnapshots.companyPanSnapshot,
          contactNameSnapshot: companySnapshots.contactNameSnapshot,
          contactEmailSnapshot: companySnapshots.contactEmailSnapshot,
          contactPhoneSnapshot: companySnapshots.contactPhoneSnapshot,
          billingAddressSnapshot: companySnapshots.billingAddressSnapshot as Prisma.InputJsonValue,
          shippingAddressSnapshot: companySnapshots.shippingAddressSnapshot as Prisma.InputJsonValue,
          quotationDate,
          validUntil,
          customerReference: input.customerReference !== undefined ? input.customerReference : existing.customerReference,
          internalReference: input.internalReference !== undefined ? input.internalReference : existing.internalReference,
          currency: input.currency ?? existing.currency,
          taxMode: input.taxMode ?? existing.taxMode,
          subtotal: new Prisma.Decimal(calculated.subtotal),
          itemDiscountAmount: new Prisma.Decimal(calculated.itemDiscountAmount),
          quotationDiscountType: calculated.quotationDiscountType,
          quotationDiscountValue: new Prisma.Decimal(calculated.quotationDiscountValue),
          quotationDiscountAmount: new Prisma.Decimal(calculated.quotationDiscountAmount),
          taxableAmount: new Prisma.Decimal(calculated.taxableAmount),
          cgstAmount: new Prisma.Decimal(calculated.cgstAmount),
          sgstAmount: new Prisma.Decimal(calculated.sgstAmount),
          igstAmount: new Prisma.Decimal(calculated.igstAmount),
          freightAmount: new Prisma.Decimal(calculated.freightAmount),
          otherCharges: new Prisma.Decimal(calculated.otherCharges),
          roundOffAmount: new Prisma.Decimal(calculated.roundOffAmount),
          grandTotal: new Prisma.Decimal(calculated.grandTotal),
          amountInWords: calculated.amountInWords,
          deliveryTerms: input.deliveryTerms !== undefined ? input.deliveryTerms : existing.deliveryTerms,
          dispatchTerms: input.dispatchTerms !== undefined ? input.dispatchTerms : existing.dispatchTerms,
          paymentTerms: input.paymentTerms !== undefined ? input.paymentTerms : existing.paymentTerms,
          taxTerms: input.taxTerms !== undefined ? input.taxTerms : existing.taxTerms,
          freightTerms: input.freightTerms !== undefined ? input.freightTerms : existing.freightTerms,
          warrantyTerms: input.warrantyTerms !== undefined ? input.warrantyTerms : existing.warrantyTerms,
          remarks: input.remarks !== undefined ? input.remarks : existing.remarks,
          termsAndConditions: input.termsAndConditions !== undefined ? input.termsAndConditions : existing.termsAndConditions,
          internalNotes: input.internalNotes !== undefined ? input.internalNotes : existing.internalNotes,
          updatedById: userId,
        },
      });

      const itemCreateData = calculated.items.map((line) => ({
        quotationId: existing.id,
        itemId: line.itemId,
        lineNumber: line.lineNumber,
        itemCodeSnapshot: line.itemCodeSnapshot,
        itemNameSnapshot: line.itemNameSnapshot,
        descriptionSnapshot: line.descriptionSnapshot,
        specificationsSnapshot: line.specificationsSnapshot as Prisma.InputJsonValue,
        measurementUnitSnapshot: line.measurementUnitSnapshot,
        quantity: new Prisma.Decimal(line.quantity),
        unitRate: new Prisma.Decimal(line.unitRate),
        discountType: line.discountType,
        discountValue: new Prisma.Decimal(line.discountValue),
        discountAmount: new Prisma.Decimal(line.discountAmount),
        gstRate: new Prisma.Decimal(line.gstRate),
        baseAmount: new Prisma.Decimal(line.baseAmount),
        taxableAmount: new Prisma.Decimal(line.taxableAmount),
        taxAmount: new Prisma.Decimal(line.taxAmount),
        lineTotal: new Prisma.Decimal(line.lineTotal),
        sortOrder: line.sortOrder,
      }));

      await tx.quotationItem.createMany({
        data: itemCreateData,
      });
    });

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Quotation',
      entityId: String(existing.id),
      action: AuditAction.UPDATE,
      newValues: {
        quotationNumber: existing.quotationNumber,
        grandTotal: calculated.grandTotal,
      },
    });

    return this.getQuotation(existing.id);
  }

  async createQuotationRevision(id: number, metadata: RequestMetadata, userId: number) {
    const source = await this.db.quotation.findFirst({
      where: { id, deletedAt: null },
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { lineNumber: 'asc' }] } },
    });

    if (!source) {
      throw new AppError('Quotation not found.', 404);
    }

    if (!source.isLatestRevision) {
      throw new AppError('Only the latest quotation revision can be revised.', 409);
    }

    if (source.status === QuotationStatus.DRAFT) {
      throw new AppError('The latest draft revision is already editable.', 409);
    }

    const familyRootId = source.rootQuotationId ?? source.id;

    try {
      const newRevision = await this.db.$transaction(async (tx) => {
        const latest = await tx.quotation.findFirst({
          where: { rootQuotationId: familyRootId, deletedAt: null },
          include: { items: { orderBy: [{ sortOrder: 'asc' }, { lineNumber: 'asc' }] } },
          orderBy: { revisionNumber: 'desc' },
        });

        if (!latest) {
          throw new AppError('Quotation revision family not found.', 404);
        }

        if (latest.id !== source.id) {
          throw new AppError('Only the latest quotation revision can be revised.', 409);
        }

        if (latest.status === QuotationStatus.DRAFT) {
          throw new AppError('The latest draft revision is already editable.', 409);
        }

        const nextRevisionNumber = latest.revisionNumber + 1;

        await tx.quotation.updateMany({
          where: {
            rootQuotationId: familyRootId,
            isLatestRevision: true,
          },
          data: { isLatestRevision: false },
        });

        const created = await tx.quotation.create({
          data: {
            quotationNumber: latest.quotationNumber,
            revisionNumber: nextRevisionNumber,
            rootQuotationId: familyRootId,
            previousRevisionId: latest.id,
            isLatestRevision: true,
            companyId: latest.companyId,
            companyContactId: latest.companyContactId,
            billingAddressId: latest.billingAddressId,
            shippingAddressId: latest.shippingAddressId,
            companyNameSnapshot: latest.companyNameSnapshot,
            companyGstinSnapshot: latest.companyGstinSnapshot,
            companyPanSnapshot: latest.companyPanSnapshot,
            contactNameSnapshot: latest.contactNameSnapshot,
            contactEmailSnapshot: latest.contactEmailSnapshot,
            contactPhoneSnapshot: latest.contactPhoneSnapshot,
            billingAddressSnapshot: latest.billingAddressSnapshot as Prisma.InputJsonValue,
            shippingAddressSnapshot: latest.shippingAddressSnapshot as Prisma.InputJsonValue,
            quotationDate: latest.quotationDate,
            validUntil: latest.validUntil,
            customerReference: latest.customerReference,
            internalReference: latest.internalReference,
            status: QuotationStatus.DRAFT,
            currency: latest.currency,
            taxMode: latest.taxMode,
            subtotal: latest.subtotal,
            itemDiscountAmount: latest.itemDiscountAmount,
            quotationDiscountType: latest.quotationDiscountType,
            quotationDiscountValue: latest.quotationDiscountValue,
            quotationDiscountAmount: latest.quotationDiscountAmount,
            taxableAmount: latest.taxableAmount,
            cgstAmount: latest.cgstAmount,
            sgstAmount: latest.sgstAmount,
            igstAmount: latest.igstAmount,
            freightAmount: latest.freightAmount,
            freightIncluded: latest.freightIncluded,
            freightIsTaxable: latest.freightIsTaxable,
            otherCharges: latest.otherCharges,
            roundOffAmount: latest.roundOffAmount,
            grandTotal: latest.grandTotal,
            amountInWords: latest.amountInWords,
            deliveryTerms: latest.deliveryTerms,
            dispatchTerms: latest.dispatchTerms,
            paymentTerms: latest.paymentTerms,
            taxTerms: latest.taxTerms,
            freightTerms: latest.freightTerms,
            warrantyTerms: latest.warrantyTerms,
            remarks: latest.remarks,
            termsAndConditions: latest.termsAndConditions,
            internalNotes: latest.internalNotes,
            createdById: userId,
          },
        });

        const itemCreateData = latest.items.map((item) => ({
          quotationId: created.id,
          itemId: item.itemId,
          lineNumber: item.lineNumber,
          itemCodeSnapshot: item.itemCodeSnapshot,
          itemNameSnapshot: item.itemNameSnapshot,
          descriptionSnapshot: item.descriptionSnapshot,
          specificationsSnapshot: item.specificationsSnapshot as Prisma.InputJsonValue,
          measurementUnitSnapshot: item.measurementUnitSnapshot,
          quantity: item.quantity,
          unitRate: item.unitRate,
          discountType: item.discountType,
          discountValue: item.discountValue,
          discountAmount: item.discountAmount,
          gstRate: item.gstRate,
          baseAmount: item.baseAmount,
          taxableAmount: item.taxableAmount,
          taxAmount: item.taxAmount,
          lineTotal: item.lineTotal,
          sortOrder: item.sortOrder,
        }));

        if (itemCreateData.length > 0) {
          await tx.quotationItem.createMany({ data: itemCreateData });
        }

        await tx.quotationStatusHistory.create({
          data: {
            quotationId: created.id,
            fromStatus: null,
            toStatus: QuotationStatus.DRAFT,
            changedById: userId,
            comment: `Revision ${nextRevisionNumber} created from Revision ${latest.revisionNumber}.`,
          },
        });

        await createQuotationVersion(
          tx,
          created.id,
          {
            created,
            items: itemCreateData,
            sourceQuotationId: latest.id,
            sourceRevisionNumber: latest.revisionNumber,
          },
          userId,
        );

        return created;
      });

      await createAuditLog(this.db, {
        metadata,
        entityType: 'Quotation',
        entityId: String(newRevision.id),
        action: AuditAction.CREATE,
        newValues: {
          quotationNumber: newRevision.quotationNumber,
          revisionNumber: newRevision.revisionNumber,
          sourceQuotationId: source.id,
          sourceRevisionNumber: source.revisionNumber,
        },
      });

      return this.getQuotation(newRevision.id);
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('A newer revision already exists. Refresh the quotation and try again.', 409);
      }
      throw error;
    }
  }

  async updateQuotationStatus(
    id: number,
    input: QuotationStatusUpdateInput,
    metadata: RequestMetadata,
    userId: number,
  ) {
    const existing = await this.db.quotation.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError('Quotation not found.', 404);
    }

    if (!existing.isLatestRevision) {
      throw new AppError('Only the latest quotation revision can change status.', 409);
    }

    validateStatusTransition(existing.status, input.status);

    const timestampUpdates = getStatusTimestampUpdate(input.status);

    const updated = await this.db.quotation.update({
      where: { id: existing.id },
      data: {
        status: input.status,
        updatedById: userId,
        ...timestampUpdates,
      },
    });

    await recordStatusHistory(
      this.db,
      existing.id,
      existing.status,
      input.status,
      userId,
      input.comment,
    );

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Quotation',
      entityId: String(existing.id),
      action: AuditAction.STATUS_CHANGE,
      oldValues: { status: existing.status },
      newValues: { status: input.status },
    });

    return this.getQuotation(updated.id);
  }

  async deleteQuotation(id: number, metadata: RequestMetadata) {
    const existing = await this.db.quotation.findFirst({
      where: { id, deletedAt: null },
    });

    if (!existing) {
      throw new AppError('Quotation not found.', 404);
    }

    if (existing.status !== QuotationStatus.DRAFT) {
      throw new AppError('Only draft quotations can be deleted.', 409);
    }

    if (!existing.isLatestRevision) {
      throw new AppError('Only the latest draft quotation revision can be deleted.', 409);
    }

    await this.db.$transaction(async (tx) => {
      await tx.quotation.update({
        where: { id: existing.id },
        data: {
          deletedAt: new Date(),
          isLatestRevision: false,
        },
      });

      if (existing.previousRevisionId) {
        await tx.quotation.update({
          where: { id: existing.previousRevisionId },
          data: { isLatestRevision: true },
        });
      }
    });

    await createAuditLog(this.db, {
      metadata,
      entityType: 'Quotation',
      entityId: String(existing.id),
      action: AuditAction.DELETE,
      oldValues: { quotationNumber: existing.quotationNumber },
    });
  }
}

function validateValidUntilDate(quotationDate: Date, validUntil: Date | null) {
  if (!validUntil) return;

  if (isValidUntilBeforeQuotationDate(serialiseDateOnly(validUntil), serialiseDateOnly(quotationDate))) {
    throw new AppError(VALID_UNTIL_DATE_MESSAGE, 400, {
      fieldErrors: {
        validUntil: VALID_UNTIL_DATE_MESSAGE,
      },
    });
  }
}
