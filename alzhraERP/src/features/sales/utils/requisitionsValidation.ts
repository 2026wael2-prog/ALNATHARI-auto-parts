// ============================================
// Requisitions validation (المطلوبات)
// ============================================
// Pure, testable rules shared by the grid, the save flow and the exporters so
// a bad row is named explicitly instead of being silently coerced (audit F17).

import type { RequisitionItem } from '../types/requisitions';

export interface RequisitionRowIssue {
  /** 1-based row number as the user sees it in the grid. */
  row: number;
  message: string;
}

const normalizeKeyPart = (value: string): string => value.replace(/[ ]+/g, ' ').trim().toUpperCase();

/** Identity of a row for duplicate detection (name + part number). */
export const requisitionItemKey = (item: RequisitionItem): string =>
  normalizeKeyPart(item.name) + '|' + normalizeKeyPart(item.partNumber);

/** Placeholder rows the user has not typed into yet. */
export const isBlankRequisitionItem = (item: RequisitionItem): boolean =>
  item.name.trim() === '' && item.partNumber.trim() === '';

/** Rows worth saving / exporting. */
export const filledRequisitionItems = (items: readonly RequisitionItem[]): RequisitionItem[] =>
  items.filter(item => !isBlankRequisitionItem(item));

export const sumRequisitionQuantities = (items: readonly RequisitionItem[]): number =>
  items.reduce((sum, item) => sum + (Number.isFinite(item.quantity) ? item.quantity : 0), 0);

/**
 * Quantities must be positive finite numbers. The old grid rewrote anything
 * unusable to `1` silently; now the row is reported and the save is blocked.
 */
export const findQuantityIssues = (items: readonly RequisitionItem[]): RequisitionRowIssue[] => {
  const issues: RequisitionRowIssue[] = [];
  items.forEach((item, index) => {
    if (isBlankRequisitionItem(item)) return;
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      issues.push({
        row: index + 1,
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- a numeral in an Arabic sentence is intentional
        message: `الكمية في السطر ${index + 1} غير صحيحة — يجب أن تكون رقماً أكبر من صفر.`,
      });
    }
  });
  return issues;
};

/** Duplicate rows (same name + part number) are surfaced as row numbers. */
export const findDuplicateRows = (items: readonly RequisitionItem[]): number[] => {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  items.forEach((item, index) => {
    if (isBlankRequisitionItem(item)) return;
    const key = requisitionItemKey(item);
    if (key === '|') return;
    if (seen.has(key)) {
      duplicates.push(index + 1);
      return;
    }
    seen.add(key);
  });
  return duplicates;
};

/** Blocking issues: saving/exporting while these exist is refused. */
export const findBlockingIssues = (items: readonly RequisitionItem[]): RequisitionRowIssue[] =>
  findQuantityIssues(items);