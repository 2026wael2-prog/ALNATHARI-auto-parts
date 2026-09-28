import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import QuotationActionIcons, { type QuotationRowAction } from './QuotationActionIcons';

describe('QuotationActionIcons', () => {
  it('يعرض أيقونات الإرسال والطباعة وملف الإكسل الثلاث معاً', () => {
    render(<QuotationActionIcons onAction={() => undefined} />);

    expect(screen.getByTitle('إرسال عبر واتساب (ملف إكسل)')).toBeInTheDocument();
    expect(screen.getByTitle('طباعة عرض السعر')).toBeInTheDocument();
    expect(screen.getByTitle('تنزيل ملف إكسل')).toBeInTheDocument();
  });

  it('يرسل الإجراء المطلوب دون تضمين النقرة في الصف (stopPropagation)', () => {
    const onAction = vi.fn<(action: QuotationRowAction) => void>();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <QuotationActionIcons onAction={onAction} />
      </div>
    );

    fireEvent.click(screen.getByTitle('طباعة عرض السعر'));
    expect(onAction).toHaveBeenCalledWith('print');
    expect(onRowClick).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('إرسال عبر واتساب (ملف إكسل)'));
    expect(onAction).toHaveBeenCalledWith('share');

    fireEvent.click(screen.getByTitle('تنزيل ملف إكسل'));
    expect(onAction).toHaveBeenCalledWith('excel');
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
