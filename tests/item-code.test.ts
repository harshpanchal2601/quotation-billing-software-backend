import { describe, expect, it } from 'vitest';

import {
  findLatestItemCodeSequence,
  formatItemCode,
  parseItemCodeSequence,
} from '../src/modules/items/code/item-code.js';

describe('item code helpers', () => {
  it('formats item codes with prefix and zero padding', () => {
    expect(formatItemCode(1)).toBe('ITEM-000001');
    expect(formatItemCode(123456)).toBe('ITEM-123456');
  });

  it('parses valid item code sequences', () => {
    expect(parseItemCodeSequence('ITEM-000001')).toBe(1);
    expect(parseItemCodeSequence('ITEM-000042')).toBe(42);
    expect(parseItemCodeSequence('INVALID')).toBeNull();
    expect(parseItemCodeSequence(undefined)).toBeNull();
  });

  it('finds the latest sequence across item codes', () => {
    expect(
      findLatestItemCodeSequence([
        { itemCode: 'ITEM-000010' },
        { itemCode: 'ITEM-000003' },
        { itemCode: 'INVALID' },
        { itemCode: 'ITEM-000099' },
      ]),
    ).toBe(99);
  });
});
