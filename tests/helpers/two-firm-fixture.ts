import { randomUUID } from 'node:crypto';
import { AccountType, AddressType, PrismaClient } from '@prisma/client';
import { expect } from 'vitest';

export function assertDisposableTenantDatabase(value: string, wave: '01' | '02' | '03' = '01') {
  const url = new URL(value);
  if (url.protocol !== 'mysql:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !new RegExp(`^/wave${wave}_test_[a-zA-Z0-9_]+$`).test(url.pathname)) {
    throw new Error(`Use a local disposable MySQL database named wave${wave}_test_<suffix>`);
  }
}

export type TenantFixture = Awaited<ReturnType<TwoFirmFixture['createTenant']>>;

// Never applies migrations or falls back to the application's DATABASE_URL.
// Register roots immediately so partially created fixtures can be cleaned up.
export class TwoFirmFixture {
  readonly firmIds: number[] = [];
  readonly platformUserIds: number[] = [];
  constructor(readonly db: PrismaClient, private readonly options: { platformLedger?: boolean } = {}) {}

  async createActor(firmId: number | null, accountType: AccountType, firmRoleId?: number) {
    const unique = randomUUID();
    const actor = await this.db.user.create({ data: {
      firmId, firmRoleId, accountType, name: `Fixture ${accountType}`,
      email: `${unique}@example.invalid`, username: unique, passwordHash: 'unused-fixture-hash',
    } });
    if (firmId === null) this.platformUserIds.push(actor.id);
    return actor;
  }

  async createTenant(label: string) {
    const unique = randomUUID();
    const firm = await this.db.firm.create({ data: { name: `Wave01 ${label}`, slug: `wave01-${unique}` } });
    this.firmIds.push(firm.id);
    const admin = await this.createActor(firm.id, AccountType.FIRM_ADMIN);
    const role = await this.db.firmRole.create({ data: {
      firmId: firm.id, name: 'Reader', permissions: ['quotations.view'],
    } });
    const reader = await this.createActor(firm.id, AccountType.FIRM_USER, role.id);
    const profile = await this.db.businessProfile.create({ data: {
      firmId: firm.id, legalName: firm.name, displayName: firm.name,
      addressLine1: 'Fixture address', city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001',
    } });
    await this.db.quotationSetting.create({ data: { businessProfileId: profile.id, quotationPrefix: `T${firm.id}` } });
    const bank = await this.db.bankDetail.create({ data: {
      businessProfileId: profile.id, bankName: 'Fixture bank', accountName: firm.name, accountNumber: '123456789',
    } });
    const company = await this.db.company.create({ data: {
      firmId: firm.id, companyCode: 'TEST-1', name: `Customer ${label} ${unique}`, createdById: admin.id,
    } });
    const contact = await this.db.companyContact.create({ data: { companyId: company.id, name: `Contact ${label}` } });
    const address = await this.db.companyAddress.create({ data: {
      companyId: company.id, addressType: AddressType.BILLING, addressLine1: `Private address ${label}`,
      city: 'Ahmedabad', state: 'Gujarat', postalCode: '380001',
    } });
    const category = await this.db.itemCategory.create({ data: { firmId: firm.id, name: `Category ${label}`, slug: 'fixture' } });
    const unit = await this.db.measurementUnit.create({ data: { firmId: firm.id, name: 'Piece', symbol: 'PCS' } });
    const item = await this.db.item.create({ data: {
      firmId: firm.id, itemCode: 'TEST-1', name: `Item ${label} ${unique}`,
      categoryId: category.id, measurementUnitId: unit.id, createdById: admin.id,
    } });
    return { firm, admin, reader, role, profile, bank, company, contact, address, category, unit, item };
  }

  async cleanup() {
    const firmId = { in: this.firmIds };
    const quotation = { firmId };
    const ledgerFirmIds = this.options.platformLedger
      ? (await this.db.platformCharge.findMany({ where: { firmId }, select: { firmId: true }, distinct: ['firmId'] })).map((charge) => charge.firmId)
      : [];
    // Immutable platform events intentionally survive fixture actor deletion.
    // Their scalar snapshots remain evidence; no production or shared data is removed.
    await this.db.$transaction(async (tx) => {
      await tx.notificationDelivery.deleteMany({ where: { firmId } });
      await tx.jobAttempt.deleteMany({ where: { event: { firmId } } });
      await tx.outboxEvent.deleteMany({ where: { firmId } });
      await tx.notificationPreference.deleteMany({ where: { firmId } });
      await tx.firmBusinessPolicy.deleteMany({ where: { firmId } });
      await tx.documentSequence.deleteMany({ where: { firmId } });
      await tx.quotationCommunication.deleteMany({ where: { quotation } });
      await tx.generatedDocument.deleteMany({ where: { quotation } });
      await tx.quotationAttachment.deleteMany({ where: { quotation } });
      await tx.quotationStatusHistory.deleteMany({ where: { quotation } });
      await tx.quotationVersion.deleteMany({ where: { quotation } });
      await tx.quotationItem.deleteMany({ where: { quotation } });
      await tx.quotation.updateMany({ where: { firmId }, data: { rootQuotationId: null, previousRevisionId: null } });
      await tx.quotation.deleteMany({ where: { firmId } });
      await tx.importRow.deleteMany({ where: { importBatch: { firmId } } });
      await tx.importBatch.deleteMany({ where: { firmId } });
      await tx.termsTemplate.deleteMany({ where: { firmId } });
      await tx.company.deleteMany({ where: { firmId } });
      await tx.item.deleteMany({ where: { firmId } });
      await tx.itemCategory.deleteMany({ where: { firmId } });
      await tx.measurementUnit.deleteMany({ where: { firmId } });
      await tx.bankDetail.deleteMany({ where: { businessProfile: { firmId } } });
      await tx.quotationSetting.deleteMany({ where: { businessProfile: { firmId } } });
      await tx.businessProfile.deleteMany({ where: { firmId } });
      await tx.auditLog.deleteMany({ where: {
        entityType: { not: 'PlatformFirmAccess' },
        OR: [{ firmId }, { userId: { in: this.platformUserIds } }],
      } });
      await tx.user.deleteMany({ where: { OR: [{ firmId }, { id: { in: this.platformUserIds } }] } });
      await tx.firmRole.deleteMany({ where: { firmId } });
      await tx.firm.deleteMany({ where: { id: { in: this.firmIds.filter((id) => !ledgerFirmIds.includes(id)) } } });
      // Retain owned tombstones when append-only platform charges reference them.
      await tx.firm.updateMany({ where: { id: { in: ledgerFirmIds } }, data: { deletedAt: new Date(), status: 'SUSPENDED' } });
    }, { timeout: 30_000 });
  }
}

export async function expectDenied(response: Response, status = 404) {
  expect(response.status, await response.clone().text()).toBe(status);
  expect(await response.json()).toMatchObject({ success: false });
}
