import { Prisma, type PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/core/errors/AppError.js';
import { requestHash } from '../src/core/idempotency/request-hash.js';
import { ManufacturingRepository } from '../src/modules/manufacturing/manufacturing.repository.js';
import { bomCreateSchema, workOrderActionSchema, workOrderCreateSchema } from '../src/modules/manufacturing/manufacturing.schema.js';

const mocks = vi.hoisted(() => ({ actor: vi.fn(), feature: vi.fn(), post: vi.fn(), context: vi.fn(), policy: vi.fn() }));
vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: mocks.actor }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: mocks.feature, withFirmEntitlementTransaction: (db: PrismaClient, _firm: number, work: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(work) }));
vi.mock('../src/modules/settings/index.js', () => ({ resolveBusinessPolicy: mocks.policy }));
vi.mock('../src/modules/inventory/index.js', async () => ({ assertStockQuantity: (await import('../src/modules/inventory/stock-ledger.js')).assertStockQuantity, readStockContext: mocks.context, postStock: mocks.post }));
const snapshot = { bomCode: 'ASSEMBLY', bomRevision: 1, output: { itemId: 1, unitId: 1, name: 'Output', unit: 'PCS', quantity: '1.000' }, components: [{ lineId: 10, itemId: 2, unitId: 1, name: 'First', unit: 'KG', quantity: '2.000' }, { lineId: 11, itemId: 3, unitId: 1, name: 'Second', unit: 'KG', quantity: '1.500' }] };
const action = () => workOrderActionSchema.parse({ expectedVersion: 1, idempotencyKey: 'completion-key', reason: 'Approved production' });
function fixture() {
  const row = { id: 100, firmId: 1, bomId: 9, warehouseId: 5, quantity: new Prisma.Decimal(1), currency: 'INR', status: 'DRAFT', version: 1, snapshot, createdAt: new Date(), movements: [] };
  const tx = { workOrder: { findFirst: vi.fn().mockResolvedValue(row), findUnique: vi.fn(), create: vi.fn(), update: vi.fn().mockResolvedValue({ ...row, status: 'COMPLETED', version: 2 }) }, billOfMaterials: { findFirst: vi.fn() }, stockMovement: { findMany: vi.fn() }, auditLog: { create: vi.fn() } };
  const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
  return { tx, row, repository: new ManufacturingRepository(db) };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.context.mockResolvedValue({ policy: { currency: 'INR' }, item: { measurementUnitId: 1, measurementUnit: { allowDecimal: true } } });
  mocks.policy.mockResolvedValue({ policy: { currency: 'INR' } });
  mocks.post.mockImplementation(async (_tx, input: { eventType: string; sourceLineId: number }) => ({ value: new Prisma.Decimal(input.eventType === 'CONSUME' ? input.sourceLineId === 10 ? '-1.234567' : '-2.000001' : '3.234568') }));
});
describe('Wave 10 manufacturing ledger commands', () => {
  it('receives output at the exact sum of consumed ledger values in the same transaction', async () => {
    const { repository, tx } = fixture(); await repository.transition(1, 20, 100, 'complete', action(), {});
    expect(mocks.post).toHaveBeenCalledTimes(3);
    const postings = mocks.post.mock.calls.map((call) => call[1]);
    expect(postings.map((entry) => entry.eventType)).toEqual(['CONSUME', 'CONSUME', 'PRODUCE']);
    expect(postings[0].quantity.toFixed(3)).toBe('-2.000'); expect(postings[1].quantity.toFixed(3)).toBe('-1.500');
    expect(postings[2].inboundValue.toFixed(6)).toBe('3.234568');
    for (const call of mocks.post.mock.calls) { expect(call[0]).toBe(tx); expect(call[1]).toMatchObject({ firmId: 1, actorId: 20, workOrderId: 100, sourceType: 'WORK_ORDER', sourceId: 100, warehouseId: 5, currency: 'INR' }); }
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ firmId: 1, userId: 20, entityType: 'WorkOrder' }) }));
  });
  it('replays only an identical completed command and rejects stale alternatives', async () => {
    const { repository, tx, row } = fixture(); const input = action();
    tx.workOrder.findFirst.mockResolvedValue({ ...row, status: 'COMPLETED', version: 2, completionHash: requestHash({ action: 'complete', ...input }) });
    expect((await repository.transition(1, 20, 100, 'complete', input, {})).status).toBe('COMPLETED');
    expect(mocks.post).not.toHaveBeenCalled();
    await expect(repository.transition(1, 20, 100, 'complete', { ...input, reason: 'Changed production' }, {})).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it('reverses output before restoring components at their original values', async () => {
    const { repository, tx, row } = fixture(); tx.workOrder.findFirst.mockResolvedValue({ ...row, status: 'COMPLETED' });
    const movement = (id: number, eventType: string, itemId: number, quantity: string, value: string) => ({ id, eventType, sourceLineId: id, quantity: new Prisma.Decimal(quantity), value: new Prisma.Decimal(value), corrections: [], position: { warehouseId: 5, itemId } });
    tx.stockMovement.findMany.mockResolvedValue([movement(10, 'CONSUME', 2, '-2', '-1.234567'), movement(11, 'CONSUME', 3, '-1.5', '-2.000001'), movement(12, 'PRODUCE', 1, '1', '3.234568')]);
    await repository.transition(1, 20, 100, 'cancel', action(), {});
    const postings = mocks.post.mock.calls.map((call) => call[1]);
    expect(postings.map((entry) => entry.eventType)).toEqual(['PRODUCE_REVERSAL', 'CONSUME_REVERSAL', 'CONSUME_REVERSAL']);
    expect(postings[0].quantity.toString()).toBe('-1'); expect(postings[0].reversalValue.toFixed(6)).toBe('-3.234568');
    expect(postings[1].inboundValue.toFixed(6)).toBe('1.234567'); expect(postings[2].inboundValue.toFixed(6)).toBe('2.000001');
    expect(postings.map((entry) => entry.originalMovementId)).toEqual([12, 10, 11]);
  });
  it('denies source changes and foreign work orders before posting', async () => {
    const { repository, tx } = fixture(); mocks.context.mockResolvedValue({ item: { measurementUnitId: 99 } });
    await expect(repository.transition(1, 20, 100, 'complete', action(), {})).rejects.toMatchObject({ statusCode: 409 }); expect(mocks.post).not.toHaveBeenCalled();
    tx.workOrder.findFirst.mockResolvedValue(null);
    await expect(repository.transition(1, 20, 100, 'complete', action(), {})).rejects.toMatchObject({ statusCode: 404 });
    expect(tx.workOrder.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: 100, firmId: 1 } }));
  });
  it('does not round an incompatible scaled component quantity into a different recipe', async () => {
    const { repository, tx } = fixture();
    tx.billOfMaterials.findFirst.mockResolvedValue({ id: 9, code: 'ASSEMBLY', revision: 1, outputItemId: 1, outputUnitId: 1, outputQuantity: new Prisma.Decimal(3), outputName: 'Output', outputUnit: 'PCS', components: [{ id: 10, itemId: 2, unitId: 1, quantity: new Prisma.Decimal(1), name: 'Component', unit: 'PCS' }] });
    await expect(repository.createOrder(1, 20, workOrderCreateSchema.parse({ bomId: 9, warehouseId: 5, quantity: '1', idempotencyKey: 'new-order-key' }), {})).rejects.toMatchObject({ statusCode: 400 });
    expect(tx.workOrder.create).not.toHaveBeenCalled();
  });
  it('fails before ledger work when the feature or role is denied', async () => {
    const { repository } = fixture(); mocks.actor.mockRejectedValueOnce(new AppError('Denied', 403));
    await expect(repository.transition(1, 20, 100, 'complete', action(), {})).rejects.toMatchObject({ statusCode: 403 });
    mocks.feature.mockRejectedValueOnce(new AppError('Denied', 403));
    await expect(repository.transition(1, 20, 100, 'complete', action(), {})).rejects.toMatchObject({ statusCode: 403 }); expect(mocks.post).not.toHaveBeenCalled();
  });
  it('rejects self-consumption, duplicate components and client-supplied firm ownership', () => {
    const base = { code: 'ASSEMBLY', name: 'Assembly', outputItemId: 1, outputQuantity: '1', components: [{ itemId: 2, quantity: '1' }], idempotencyKey: 'new-bom-key' };
    expect(bomCreateSchema.safeParse({ ...base, components: [{ itemId: 1, quantity: '1' }] }).success).toBe(false);
    expect(bomCreateSchema.safeParse({ ...base, components: [base.components[0], base.components[0]] }).success).toBe(false);
    expect(bomCreateSchema.safeParse({ ...base, firmId: 2 }).success).toBe(false);
  });
});
