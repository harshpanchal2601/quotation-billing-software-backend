import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PaymentsRepository } from '../src/modules/payments/payments.repository.js';
import { paymentCustomerQuerySchema } from '../src/modules/payments/payments.schema.js';

vi.mock('../src/core/database/prisma.js', () => ({ prisma: {} }));
vi.mock('../src/modules/auth/index.js', () => ({ authorizeFirmJobActor: vi.fn() }));
vi.mock('../src/modules/entitlements/index.js', () => ({ assertTransactionFeature: vi.fn() }));

describe('receipt customer lookup', () => {
  it('resolves a selected ID while retaining tenant and active-customer boundaries', async () => {
    const tx = { company: { findMany: vi.fn().mockResolvedValue([{ id: 87, name: 'Linked customer' }]) } };
    const db = { $transaction: (work: (value: typeof tx) => Promise<unknown>) => work(tx) } as unknown as PrismaClient;
    const query = paymentCustomerQuerySchema.parse({ id: '87' });
    const result = await new PaymentsRepository(db).customers(3, 8, query.search, query.id);
    expect(tx.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { firmId: 3, id: 87, deletedAt: null, isActive: true, name: { contains: '' } }, take: 50 }));
    expect(result).toEqual([{ id: 87, name: 'Linked customer' }]);
  });
  it.each(['0', '-1', '1.5', 'invalid'])('rejects invalid selected ID %s', (id) => {
    expect(paymentCustomerQuerySchema.safeParse({ id }).success).toBe(false);
  });
});
