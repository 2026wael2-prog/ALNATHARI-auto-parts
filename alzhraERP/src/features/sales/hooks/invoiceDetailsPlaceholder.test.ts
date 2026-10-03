import { describe, expect, it } from 'vitest';
import { formatDocumentAmount, formatDocumentTotal } from '@/core/utils/documentMoney';
import { mapCachedInvoiceRow } from './invoiceDetailsPlaceholder';

/**
 * مرجع مُثبت من الإنتاج — الفاتورة `2-مبيع:64262`:
 *   currency_code YER · exchange_rate 0.002220 · total_amount 31.08 (أساس SAR)
 *   total_document_amount 14,000.00 · مدين حساب العميل 14,000 ر.ي
 */
describe('mapCachedInvoiceRow — بيانات النافذة قبل وصول رد الخادم', () => {
  it('لا تُسقط مبلغ المستند على حقل الأساس (64262: 14,000 ر.ي لا 31.08 ر.ي)', () => {
    const mapped = mapCachedInvoiceRow({
      id: '987e05b6-65f2-4ccd-9a34-c3143586d177',
      invoice_number: '2-مبيع:64262',
      issue_date: '2026-09-16',
      currencyCode: 'YER',
      exchangeRate: 0.00222,
      total: 14000, // مبلغ المستند بعملة الفاتورة
      baseTotal: 31.08, // معادل الأساس (SAR)
    });

    expect(mapped.total_amount).toBe(31.08);
    expect(mapped.total_document_amount).toBe(14000);
    expect(formatDocumentTotal(mapped)).toBe('14,000.00 ر.ي');
  });

  it('يشتق مبلغ المستند من الأساس ÷ سعر الصرف عند غيابه في الصف (صفوف الـRPC)', () => {
    const mapped = mapCachedInvoiceRow({
      id: 'x',
      invoice_number: '2-مبيع:64262',
      currency_code: 'YER',
      exchange_rate: 0.00222,
      total_amount: 31.08,
    });

    expect(mapped.total_document_amount).toBe(0);
    expect(formatDocumentTotal(mapped)).toBe('14,000.00 ر.ي');
  });

  it('يترك الفاتورة السعودية بلا أي تحويل', () => {
    const mapped = mapCachedInvoiceRow({
      id: 'y',
      invoice_number: '2-مبيع:40443',
      currencyCode: 'SAR',
      exchangeRate: 1,
      total: 138043,
      baseTotal: 138043,
    });

    expect(mapped.total_amount).toBe(138043);
    expect(formatDocumentTotal(mapped)).toBe('138,043.00 ر.س');
  });

  it('يطبّع رمز العملة ويسدّ الحقول الناقصة بقيم آمنة', () => {
    const mapped = mapCachedInvoiceRow({ id: 'z' });

    expect(mapped.currency_code).toBe('SAR');
    expect(mapped.exchange_rate).toBe(1);
    expect(mapped.total_amount).toBe(0);
    expect(mapped.total_document_amount).toBe(0);
    expect(mapped.invoice_items).toEqual([]);
    expect(mapped.payment_allocations).toEqual([]);
    expect(mapped.status).toBe('draft');
    expect(mapped.payment_method).toBe('cash');
    expect(formatDocumentTotal(mapped)).toBe('0.00 ر.س');
  });

  it('يشتق سعر الصرف من الصف عند غيابه بدل افتراض 1 فلا يقلب العرض', () => {
    const mapped = mapCachedInvoiceRow({
      id: 'v',
      currency_code: 'YER',
      total: 14000,
      baseTotal: 31.08,
    });

    expect(mapped.exchange_rate).toBeCloseTo(31.08 / 14000, 8);
    expect(formatDocumentTotal(mapped)).toBe('14,000.00 ر.ي');
    expect(
      formatDocumentAmount(31.08, mapped.currency_code, mapped.exchange_rate)
    ).toBe('14,000.00 ر.ي');
  });

  it('يحتفظ بالعملة بحروف صغيرة ويطبّعها في الحقل المعروض', () => {
    const mapped = mapCachedInvoiceRow({ id: 'w', currency_code: 'yer', exchange_rate: 0.00222 });

    expect(mapped.currency_code).toBe('YER');
    expect(formatDocumentTotal(mapped)).toBe('0.00 ر.ي');
  });
});
