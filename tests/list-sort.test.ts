import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { listOrderBy, listSortFields } from '../src/core/validation/list-sort.js';
import { crmListSchema, customerTimelineListSchema } from '../src/modules/crm/crm.schema.js';
import { importListSchema } from '../src/modules/imports/imports.schema.js';
import { inventoryListSchema } from '../src/modules/inventory/inventory.schema.js';
import { paymentListSchema, receivablesQuerySchema } from '../src/modules/payments/payments.schema.js';
import { approvalListSchema, automationVersionListSchema, workflowRunListSchema } from '../src/modules/automation/automation.schema.js';
import { platformFirmListSchema } from '../src/modules/platform/platform.schema.js';

describe('paginated list sorting', () => {
  it('preserves default ordering for requests without sorting and supports legacy ascending lists', () => {
    expect(listOrderBy({}, ['id', 'name'])).toEqual([{ id: 'desc' }]);
    expect(listOrderBy({}, ['id', 'name'], 'id', 'asc')).toEqual([{ id: 'asc' }]);
  });

  it.each(['asc', 'desc'] as const)('uses a stable ID tie-breaker for %s pagination', (sortOrder) => {
    expect(listOrderBy({ sortBy: 'name', sortOrder }, ['id', 'name'])).toEqual([{ name: sortOrder }, { id: sortOrder }]);
    expect(listOrderBy({ sortBy: 'id', sortOrder }, ['id', 'name'])).toEqual([{ id: sortOrder }]);
  });

  it('rejects unsupported fields at both the request and repository boundaries', () => {
    const schema = z.object(listSortFields(['id', 'name']));
    for (const sortBy of ['otherTenantId', 'name DESC', 'name; DROP TABLE Company', '__proto__']) {
      expect(schema.safeParse({ sortBy, sortOrder: 'asc' }).success).toBe(false);
      expect(() => listOrderBy({ sortBy }, ['id', 'name'])).toThrow('does not support');
    }
    expect(schema.safeParse({ sortBy: 'name', sortOrder: 'ascending' }).success).toBe(false);
  });

  it('retains filters and pagination while accepting sorting in the affected list contracts', () => {
    expect(automationVersionListSchema.parse({ page: '2', sortBy: 'version', sortOrder: 'asc' })).toEqual({ page: 2, sortBy: 'version', sortOrder: 'asc' });
    expect(workflowRunListSchema.safeParse({ sortBy: 'definition' }).success).toBe(false);
    expect(approvalListSchema.parse({ sortBy: 'expiresAt', sortOrder: 'desc' })).toEqual({ page: 1, sortBy: 'expiresAt', sortOrder: 'desc' });
    expect(approvalListSchema.safeParse({ sortBy: 'command' }).success).toBe(false);
    expect(crmListSchema.parse({ page: '2', companyId: '7', search: 'Client', sortBy: 'name', sortOrder: 'asc' }))
      .toMatchObject({ page: 2, limit: 20, companyId: 7, search: 'Client', sortBy: 'name', sortOrder: 'asc' });
    expect(customerTimelineListSchema.parse({ companyId: '7', sortBy: 'subject', sortOrder: 'asc' })).toMatchObject({ companyId: 7, sortBy: 'subject', sortOrder: 'asc', limit: 20 });
    expect(customerTimelineListSchema.safeParse({ sortBy: 'name' }).success).toBe(false);
    expect(inventoryListSchema.parse({ warehouseId: '3', itemId: '9', sortBy: 'quantity', sortOrder: 'desc' }))
      .toMatchObject({ page: 1, warehouseId: 3, itemId: 9, sortBy: 'quantity', sortOrder: 'desc' });
    expect(importListSchema.parse({ sortBy: 'startedAt', sortOrder: 'asc' })).toMatchObject({ page: 1, limit: 20, sortBy: 'startedAt' });
    expect(paymentListSchema.parse({ companyId: '7', currency: 'INR', sortBy: 'amount', sortOrder: 'asc' }))
      .toMatchObject({ companyId: 7, currency: 'INR', sortBy: 'amount', sortOrder: 'asc' });
    expect(receivablesQuerySchema.parse({ sortBy: 'outstanding', sortOrder: 'desc' }).sortBy).toBe('outstanding');
    expect(receivablesQuerySchema.safeParse({ sortBy: 'amount' }).success).toBe(false);
    expect(platformFirmListSchema.parse({ search: 'QA', sortBy: 'displayName', sortOrder: 'asc' }))
      .toMatchObject({ search: 'QA', page: 1, limit: 20, sortBy: 'displayName', sortOrder: 'asc' });
  });
});
