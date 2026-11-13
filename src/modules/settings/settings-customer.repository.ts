import type { Prisma } from '@prisma/client';
import { AppError } from '../../core/errors/AppError.js';

export async function readCustomerSellerSnapshot(tx: Prisma.TransactionClient, firmId: number) {
  const profile = await tx.businessProfile.findUnique({ where: { firmId } });
  if (!profile) throw new AppError('Complete the seller profile first', 409);
  return { legalName: profile.legalName, displayName: profile.displayName, gstin: profile.gstin, pan: profile.pan, addressLine1: profile.addressLine1, addressLine2: profile.addressLine2, city: profile.city, state: profile.state, postalCode: profile.postalCode, country: profile.country };
}
