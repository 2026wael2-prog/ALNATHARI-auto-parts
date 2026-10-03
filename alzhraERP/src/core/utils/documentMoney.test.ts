import { describe, expect, it } from 'vitest';
import {
  BASE_CURRENCY,
  documentFactor,
  formatBaseAmount,
  formatDocumentAmount,
  formatDocumentTotal,
  formatDocumentWithBase,
  toDocumentAmount,
  toDocumentTotal,
} from './documentMoney';

/**
 * مراجع مُثبتة من قاعدة الإنتاج `gvjmpgxdmekjsgzhlzzz` (2026-10-03):
 *
 *  2-مبيع:64262 → currency YER · rate 0.002220 · total_amount 31.08 (أساس SAR)
 *                  · total_document_amount 14,000.00 (الدفتر) · مدين حساب العميل 14,000 ر.ي
 *  2-مبيع:64294 → currency YER · rate 0.002220 · total_amount 159.84 · total_document_amount 72,000.00
 *  2-مبيع:40443 → currency SAR · rate 1 · total_amount 138,043.00 · total_document_amount 138,043.00
 */
const INVOICE_64262 = {
  total_amount: 31.08,
  total_document_amount: 14000,
  currency_code: 'YER',
  exchange_rate: 0.00222,
};

const INVOICE_64294 = {
  total_amount: 159.84,
  total_document_amount: 72000,
  currency_code: 'YER',
  exchange_rate: 0.00222,
};

const INVOICE_SAR = {
  total_amount: 138043,
  total_document_amount: 138043,
  currency_code: 'SAR',
  exchange_rate: 1,
};

describe('documentMoney — معامل التحويل', () => {
  it('يعيد 1 لعملة الأساس (SAR) مهما كان سعر الصرف', () => {
    expect(documentFactor('SAR', 410)).toBe(1);
    expect(documentFactor('sar', 1)).toBe(1);
    expect(documentFactor(undefined, undefined)).toBe(1);
  });

  it('يقلب سعر الصرف (الأساس ← عملة المستند) للعملات الأجنبية', () => {
    expect(documentFactor('YER', 0.00222)).toBeCloseTo(1 / 0.00222, 10);
    expect(documentFactor('YER', '0.00222')).toBeCloseTo(1 / 0.00222, 10);
  });

  it('لا ينهار عند سعر صرف صفري/مفقود ويعيد المعامل 1', () => {
    expect(documentFactor('YER', 0)).toBe(1);
    expect(documentFactor('YER', null)).toBe(1);
    expect(documentFactor('YER', undefined)).toBe(1);
    expect(documentFactor('YER', 'abc')).toBe(1);
  });
});

describe('documentMoney — مبلغ المستند', () => {
  it('يستخدم العمود المخزَّن total_document_amount عندما يكون موجباً', () => {
    expect(toDocumentTotal(INVOICE_64262)).toBe(14000);
    expect(toDocumentTotal(INVOICE_64294)).toBe(72000);
  });

  it('يشتق مبلغ المستند من الأساس ÷ سعر الصرف عند غياب العمود المخزَّن', () => {
    expect(
      toDocumentTotal({
        total_amount: 31.08,
        currency_code: 'YER',
        exchange_rate: 0.00222,
      })
    ).toBeCloseTo(14000, 1);
  });

  it('يعيد الصفر لصف فارغ', () => {
    expect(toDocumentTotal(null)).toBe(0);
    expect(toDocumentTotal(undefined)).toBe(0);
  });

  it('لا يضاعف التحويل لعملة الأساس', () => {
    expect(toDocumentAmount(31.08, 'SAR', 1)).toBe(31.08);
    expect(toDocumentAmount(31.08, null, null)).toBe(31.08);
  });
});

describe('documentMoney — النصوص المعروضة', () => {
  it('يعرض 14,000 ر.ي بدل 31.08 ر.ي للفاتورة اليمنية (64262)', () => {
    expect(formatDocumentTotal(INVOICE_64262)).toBe('14,000.00 ر.ي');
    expect(formatDocumentTotal(INVOICE_64262)).not.toContain('31.08');
  });

  it('يعرض 72,000 ر.ي للفاتورة اليمنية (64294)', () => {
    expect(formatDocumentTotal(INVOICE_64294)).toBe('72,000.00 ر.ي');
  });

  it('يعرض الفاتورة السعودية بمبلغها الأساسي بلا تحويل', () => {
    expect(formatDocumentTotal(INVOICE_SAR)).toBe('138,043.00 ر.س');
  });

  it('يحوّل مبالغ البنود (سعر الوحدة) بعملة المستند', () => {
    expect(formatDocumentAmount(31.08, 'YER', 0.00222)).toBe('14,000.00 ر.ي');
    expect(formatDocumentAmount(31.08, 'SAR', 1)).toBe('31.08 ر.س');
  });

  it('يقبل رمز عملة بحروف صغيرة ويصيّره لأعلى', () => {
    expect(formatDocumentTotal({ ...INVOICE_64262, currency_code: 'yer' })).toBe('14,000.00 ر.ي');
    expect(formatDocumentAmount(10, 'sar', 1)).toBe('10.00 ر.س');
  });

  it('يعرض الأساس صراحةً مع مبلغ المستند للفواتير الأجنبية', () => {
    expect(formatDocumentWithBase(INVOICE_64262)).toBe('14,000.00 ر.ي (ما يعادل 31.08 ر.س)');
    expect(formatDocumentWithBase(INVOICE_SAR)).toBe('138,043.00 ر.س');
  });

  it('يعرض مبلغ الأساس برمز الأساس دائماً', () => {
    expect(BASE_CURRENCY).toBe('SAR');
    expect(formatBaseAmount(31.08)).toBe('31.08 ر.س');
  });
});
