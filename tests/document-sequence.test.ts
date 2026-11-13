import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import { reserveDocumentSequence, sequencePeriod } from '../src/core/sequences/index.js';

describe('document sequence scopes', () => {
  it('computes explicit reset boundaries with UTC dates', () => {
    expect(sequencePeriod(new Date('2026-03-31T23:59:59Z'), 'FINANCIAL_YEAR')).toBe('FY:2025:4');
    expect(sequencePeriod(new Date('2026-04-01T00:00:00Z'), 'FINANCIAL_YEAR')).toBe('FY:2026:4');
    expect(sequencePeriod(new Date('2027-01-01T00:00:00Z'), 'CALENDAR_YEAR')).toBe('CY:2027');
    expect(sequencePeriod(new Date('2027-01-01T00:00:00Z'), 'NEVER')).toBe('ALL');
    expect(sequencePeriod(new Date('2026-07-01T00:00:00Z'), 'FINANCIAL_YEAR', 7)).toBe('FY:2026:7');
    expect(() => sequencePeriod(new Date('invalid'), 'NEVER')).toThrow();
  });
  it('reserves exact BigInt values without a float conversion', async () => {
    const tx = { $executeRaw: vi.fn(), documentSequence: { findUniqueOrThrow: vi.fn().mockResolvedValue({ nextValue: 9007199254740993n }) } };
    await expect(reserveDocumentSequence(tx as unknown as Prisma.TransactionClient, { firmId: 1, documentType: 'INVOICE', period: 'CY:2026' })).resolves.toBe(9007199254740992n);
    expect(tx.$executeRaw.mock.calls[0]?.[0].join('')).toContain('ON DUPLICATE KEY UPDATE');
  });
});
