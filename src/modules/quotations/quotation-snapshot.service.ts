import type { PrismaClient } from '@prisma/client';

import { AppError } from '../../utils/AppError.js';
import type { AddressSnapshot, QuotationItemInput } from './quotations.types.js';

export async function deriveCompanySnapshots(
  db: PrismaClient,
  companyId: number,
  contactId?: number | null,
  billingAddressId?: number | null,
  shippingAddressId?: number | null,
) {
  const company = await db.company.findFirst({
    where: { id: companyId, deletedAt: null },
  });

  if (!company) {
    throw new AppError('Company not found or unavailable.', 404);
  }

  if (!company.isActive) {
    throw new AppError('Company is inactive or unavailable.', 409);
  }

  let contactNameSnapshot: string | null = null;
  let contactEmailSnapshot: string | null = null;
  let contactPhoneSnapshot: string | null = null;

  if (contactId) {
    const contact = await db.companyContact.findFirst({
      where: { id: contactId, companyId: company.id, deletedAt: null },
    });

    if (!contact) {
      throw new AppError('Contact does not belong to the selected company.', 400);
    }

    contactNameSnapshot = contact.name;
    contactEmailSnapshot = contact.email;
    contactPhoneSnapshot = contact.phone;
  }

  let billingAddressSnapshot: AddressSnapshot | null = null;
  if (billingAddressId) {
    const bAddress = await db.companyAddress.findFirst({
      where: { id: billingAddressId, companyId: company.id, deletedAt: null },
    });

    if (!bAddress) {
      throw new AppError('Billing address does not belong to the selected company.', 400);
    }

    billingAddressSnapshot = {
      addressLine1: bAddress.addressLine1,
      addressLine2: bAddress.addressLine2,
      city: bAddress.city,
      state: bAddress.state,
      postalCode: bAddress.postalCode,
      country: bAddress.country,
    };
  }

  let shippingAddressSnapshot: AddressSnapshot | null = null;
  if (shippingAddressId) {
    const sAddress = await db.companyAddress.findFirst({
      where: { id: shippingAddressId, companyId: company.id, deletedAt: null },
    });

    if (!sAddress) {
      throw new AppError('Shipping address does not belong to the selected company.', 400);
    }

    shippingAddressSnapshot = {
      addressLine1: sAddress.addressLine1,
      addressLine2: sAddress.addressLine2,
      city: sAddress.city,
      state: sAddress.state,
      postalCode: sAddress.postalCode,
      country: sAddress.country,
    };
  }

  return {
    companyNameSnapshot: company.name,
    companyGstinSnapshot: company.gstin,
    companyPanSnapshot: company.pan,
    contactNameSnapshot,
    contactEmailSnapshot,
    contactPhoneSnapshot,
    billingAddressSnapshot,
    shippingAddressSnapshot,
  };
}

export async function validateAndSnapshotQuotationItems(
  db: PrismaClient,
  itemsInput: QuotationItemInput[],
): Promise<QuotationItemInput[]> {
  if (!itemsInput || itemsInput.length === 0) {
    throw new AppError('At least 1 item is required.', 400);
  }

  if (itemsInput.length > 100) {
    throw new AppError('Quotation cannot exceed 100 line items.', 400);
  }

  const enrichedItems: QuotationItemInput[] = [];

  for (let i = 0; i < itemsInput.length; i++) {
    const itemInput = itemsInput[i]!;
    const lineNumber = itemInput.lineNumber ?? i + 1;
    const qtyNum = Number(itemInput.quantity);

    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      throw new AppError(`Item #${lineNumber} quantity must be greater than zero.`, 400);
    }

    if (itemInput.itemId) {
      const masterItem = await db.item.findFirst({
        where: { id: itemInput.itemId, deletedAt: null },
        include: {
          category: true,
          measurementUnit: true,
        },
      });

      if (!masterItem || !masterItem.isActive) {
        throw new AppError(`Item #${lineNumber} is inactive or unavailable.`, 409);
      }

      if (masterItem.measurementUnit.deletedAt !== null) {
        throw new AppError(`Measurement unit for item "${masterItem.name}" is unavailable.`, 409);
      }

      if (!masterItem.measurementUnit.allowDecimal && qtyNum % 1 !== 0) {
        throw new AppError(
          `Quantity must be a whole number for measurement unit ${masterItem.measurementUnit.symbol}.`,
          400,
        );
      }

      enrichedItems.push({
        ...itemInput,
        lineNumber,
        itemName: itemInput.itemName || masterItem.name,
        description: itemInput.description ?? masterItem.shortDescription,
        specifications: itemInput.specifications ?? masterItem.specifications,
        measurementUnit: masterItem.measurementUnit.symbol,
        gstRate: itemInput.gstRate ?? masterItem.gstRate.toFixed(2),
        unitRate: itemInput.unitRate ?? masterItem.defaultRate.toFixed(2),
      });
    } else {
      if (!itemInput.itemName || itemInput.itemName.trim().length === 0) {
        throw new AppError(`Item #${lineNumber} name is required.`, 400);
      }

      enrichedItems.push({
        ...itemInput,
        lineNumber,
        itemName: itemInput.itemName.trim(),
        measurementUnit: itemInput.measurementUnit || 'NOS',
      });
    }
  }

  return enrichedItems;
}
