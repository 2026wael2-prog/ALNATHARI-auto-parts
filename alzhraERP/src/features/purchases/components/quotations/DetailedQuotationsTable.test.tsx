import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DetailedQuotationsTable } from './DetailedQuotationsTable';
import type { QuotationRowAction } from '../../../sales/components/quotations/QuotationActionIcons';
import type { QuotationListRow } from './types';

const makeQuotation = (id: string, numbers: string[]): QuotationListRow => ({
  id,
  quotation_number: `QP-${id}`,
  status: 'draft',
  total_amount: 500,
  currency_code: 'SAR',
  rfq_group_id: null,
  created_at: '2026-09-28T10:00:00.000Z',
  supplier_name: 'مورد تجريبي',
  items: numbers.map((part, idx) => ({
    id: `${id}-${String(idx)}`,
    description: 'بند',
    quantity: 1,
    unit_price: 100,
    total: 100,
    size: null,
    part_number: part,
    sku: null,
  })),
  item_count: numbers.length,
});

describe('DetailedQuotationsTable — أزرار الإجراءات', () => {
  it('يعرض الأيقونات الثلاث مرة واحدة لكل عرض (لا تُكرَّر مع كل بند)', () => {
    render(
      <DetailedQuotationsTable
        quotations={[makeQuotation('a', ['P1', 'P2']), makeQuotation('b', ['P3'])]}
        onQuotationAction={() => undefined}
      />
    );

    // عرضان: 3 أزرار × 2 عروض = 6 — لا 3 أزرار × 3 بنود = 9.
    expect(screen.getAllByTitle('طباعة عرض السعر')).toHaveLength(2);
    expect(screen.getAllByTitle('إرسال عبر واتساب (ملف إكسل)')).toHaveLength(2);
    expect(screen.getAllByTitle('تنزيل ملف إكسل')).toHaveLength(2);
    // عمود الإجراءات موجود في الترويسة.
    expect(screen.getByText('إجراءات')).toBeInTheDocument();
  });

  it('يربط الإجراء بمعرّف عرضه الصحيح', () => {
    const onQuotationAction = vi.fn<(id: string, action: QuotationRowAction) => void>();
    render(
      <DetailedQuotationsTable
        quotations={[makeQuotation('a', ['P1', 'P2']), makeQuotation('b', ['P3'])]}
        onQuotationAction={onQuotationAction}
      />
    );

    const printButtons = screen.getAllByTitle('طباعة عرض السعر');
    fireEvent.click(printButtons[0]);
    expect(onQuotationAction).toHaveBeenLastCalledWith('a', 'print');

    fireEvent.click(screen.getAllByTitle('تنزيل ملف إكسل')[1]);
    expect(onQuotationAction).toHaveBeenLastCalledWith('b', 'excel');

    fireEvent.click(screen.getAllByTitle('إرسال عبر واتساب (ملف إكسل)')[1]);
    expect(onQuotationAction).toHaveBeenLastCalledWith('b', 'share');
  });

  it('لا يعرض الأيقونات إذا لم تُمرَّر معالجة الإجراء', () => {
    render(<DetailedQuotationsTable quotations={[makeQuotation('a', ['P1'])]} />);

    expect(screen.queryByTitle('طباعة عرض السعر')).not.toBeInTheDocument();
  });
});
