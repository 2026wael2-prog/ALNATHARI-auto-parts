/**
 * Pure-function tests for the requisitions API layer.
 * The grid columns are stored in one server column (`description`), so the
 * serialiser and the parser must round-trip exactly — otherwise opening a saved
 * requisition from the history silently loses the part number or the brand.
 */
import { describe, expect, it } from 'vitest';
import {
  fromServerStatus,
  parseRequisitionItemDescription,
  resolveRequisitionErrorMessage,
  serializeRequisitionItemDescription,
  toServerStatus,
} from './requisitionsApi';
import type { RequisitionStatus } from '../types/requisitions';

describe('requisition status mapping', () => {
  const uiStatuses: RequisitionStatus[] = ['draft', 'sent', 'received', 'cancelled'];

  it('maps every UI status onto a status the server CHECK constraint accepts', () => {
    expect(uiStatuses.map(toServerStatus)).toEqual([
      'draft',
      'submitted',
      'approved',
      'cancelled',
    ]);
  });

  it('round-trips every UI status', () => {
    uiStatuses.forEach(status => {
      expect(fromServerStatus(toServerStatus(status))).toBe(status);
    });
  });

  it('maps workflow statuses the UI does not show onto the closest UI state', () => {
    expect(fromServerStatus('in_review')).toBe('sent');
    expect(fromServerStatus('converted_to_rfq')).toBe('received');
    expect(fromServerStatus('converted_to_po')).toBe('received');
    expect(fromServerStatus('rejected')).toBe('cancelled');
    expect(fromServerStatus('unexpected')).toBe('draft');
  });

  it('never writes a status outside the live chk_pr_status constraint', () => {
    // 20260916000005_data_integrity_fixes.sql is the source of truth.
    const allowed = new Set([
      'draft',
      'submitted',
      'in_review',
      'approved',
      'rejected',
      'converted_to_rfq',
      'converted_to_po',
      'cancelled',
    ]);
    uiStatuses.map(toServerStatus).forEach(status => {
      expect(allowed.has(status)).toBe(true);
    });
    expect(allowed.has('closed')).toBe(false);
  });
});

describe('requisition line serialisation', () => {
  it('round-trips a fully filled grid row', () => {
    const item = {
      id: 'row-1',
      name: 'فلتر زيت',
      partNumber: 'A-123',
      brand: 'DENSO',
      quantity: 4,
      notes: 'أصلي فقط',
    };

    expect(parseRequisitionItemDescription(serializeRequisitionItemDescription(item))).toEqual({
      name: 'فلتر زيت',
      partNumber: 'A-123',
      brand: 'DENSO',
      notes: 'أصلي فقط',
    });
  });

  it('keeps an empty middle column so the positions stay stable', () => {
    const parsed = parseRequisitionItemDescription(
      serializeRequisitionItemDescription({
        id: 'row-2',
        name: 'بوجيهات',
        partNumber: '',
        brand: 'NGK',
        quantity: 1,
      })
    );
    expect(parsed).toEqual({ name: 'بوجيهات', partNumber: '', brand: 'NGK', notes: '' });
  });

  it('drops trailing empty columns instead of padding them', () => {
    expect(
      serializeRequisitionItemDescription({
        id: 'row-3',
        name: 'مسامير',
        partNumber: '',
        brand: '',
        quantity: 2,
      })
    ).toBe('مسامير');
  });

  it('reads a description written by another writer as a plain name', () => {
    expect(parseRequisitionItemDescription('بند بدون وصف')).toEqual({
      name: 'بند بدون وصف',
      partNumber: '',
      brand: '',
      notes: '',
    });
  });
});

describe('requisition error messages', () => {
  it('translates the RPC error codes into actionable Arabic', () => {
    expect(resolveRequisitionErrorMessage(new Error('invalid_items: must contain at least one line'))).toBe(
      'لا يمكن حفظ مطلوبات بدون بنود — أضف صنفاً واحداً على الأقل'
    );
    expect(resolveRequisitionErrorMessage('invalid_quantity: qty > 0')).toContain('كمية غير صحيحة');
  });
});