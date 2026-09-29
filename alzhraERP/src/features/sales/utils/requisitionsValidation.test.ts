import { describe, expect, it } from 'vitest';
import type { RequisitionItem } from '../types/requisitions';
import {
  filledRequisitionItems,
  findBlockingIssues,
  findDuplicateRows,
  findQuantityIssues,
  isBlankRequisitionItem,
  requisitionItemKey,
  sumRequisitionQuantities,
} from './requisitionsValidation';

const item = (overrides: Partial<RequisitionItem> = {}): RequisitionItem => ({
  id: overrides.id ?? crypto.randomUUID(),
  name: overrides.name ?? '',
  partNumber: overrides.partNumber ?? '',
  brand: overrides.brand ?? '',
  quantity: overrides.quantity ?? 1,
  notes: overrides.notes ?? '',
  productId: overrides.productId,
});

describe('requisitionsValidation', () => {
  it('treats rows without name and part number as blank placeholders', () => {
    expect(isBlankRequisitionItem(item())).toBe(true);
    expect(isBlankRequisitionItem(item({ brand: 'بوش', quantity: 4 }))).toBe(true);
    expect(isBlankRequisitionItem(item({ partNumber: '04465' }))).toBe(false);
  });

  it('normalizes name and part number for duplicate detection', () => {
    const first = item({ name: ' فحمات   سيراميك ', partNumber: 'abc-1' });
    const second = item({ name: 'فحمات سيراميك', partNumber: 'ABC-1' });
    expect(requisitionItemKey(first)).toBe(requisitionItemKey(second));
  });

  it('drops blank rows from the filled set', () => {
    const rows = [item(), item({ name: 'فلتر', quantity: 2 }), item({ name: '' })];
    expect(filledRequisitionItems(rows)).toHaveLength(1);
  });

  it('sums only finite quantities (no Math.abs style coercion)', () => {
    const rows = [item({ name: 'أ', quantity: 3 }), item({ name: 'ب', quantity: 0 })];
    expect(sumRequisitionQuantities(rows)).toBe(3);
  });

  it('flags unusable quantities with the 1-based row the user sees', () => {
    const rows = [
      item({ name: 'سليم', quantity: 2 }),
      item({ name: 'خطأ', quantity: 0 }),
      item({ name: 'خطأ آخر', quantity: Number.NaN }),
      item(),
    ];
    const issues = findQuantityIssues(rows);
    expect(issues.map(issue => issue.row)).toEqual([2, 3]);
    expect(issues[0]?.message).toContain('السطر 2');
  });

  it('reports duplicate rows by their visible row number', () => {
    const rows = [
      item({ name: 'شمعات', partNumber: 'SK20' }),
      item({ name: 'شمعات', partNumber: 'SK20' }),
      item({ name: 'شمعات', partNumber: 'SK21' }),
    ];
    expect(findDuplicateRows(rows)).toEqual([2]);
  });

  it('blocks saving on quantity issues and nothing else', () => {
    const rows = [item({ name: 'أ', quantity: -1 }), item({ name: 'ب', quantity: 1 })];
    expect(findBlockingIssues(rows)).toHaveLength(1);
    expect(findBlockingIssues([item({ name: 'أ', quantity: 1 })])).toHaveLength(0);
  });
});