import type { PrismaClient } from '@prisma/client';
import { AuditAction } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { createAuditLog } from '../src/core/audit/audit-log.service.js';

describe('audit persistence policy', () => {
  const input = {
    metadata: { firmId: 1, userId: 1 },
    entityType: 'Quotation',
    entityId: '1',
    action: AuditAction.STATUS_CHANGE,
  };

  it('propagates required audit failures to the owning transaction', async () => {
    const failure = new Error('audit unavailable');
    const db = { auditLog: { create: vi.fn().mockRejectedValue(failure) } };
    await expect(createAuditLog(db as unknown as PrismaClient, {
      ...input, policy: 'REQUIRED',
    })).rejects.toBe(failure);
  });

  it('preserves best effort behavior for existing callers', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const db = { auditLog: { create: vi.fn().mockRejectedValue(new Error('unavailable')) } };
      await expect(createAuditLog(db as unknown as PrismaClient, input)).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
