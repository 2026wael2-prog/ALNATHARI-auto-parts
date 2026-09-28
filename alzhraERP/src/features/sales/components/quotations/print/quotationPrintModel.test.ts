import { describe, it, expect } from 'vitest';
import { formatCurrency } from '@/core/utils/currencyUtils';
import {
  mapQuotationToPrintData,
  quotationStatusLabel,
  statusToneClasses,
  toQuotationExcelData,
  toSharePayload,
} from './quotationPrintModel';
import type { QuotationDetailRow } from '../../../api/quotationsApi';

const makeQuotation = (overrides: Partial<QuotationDetailRow> = {}): QuotationDetailRow =>
  ({
    id: 'q-1',
    quotation_number: 'QT-2026-0001',
    type: 'sales',
    status: 'draft',
    party_id: 'p-1',
    issue_date: '2026-09-28',
    valid_until: '2026-10-05',
    subtotal: 30000,
    discount_amount: 0,
    tax_amount: 0,
    total_amount: 30000,
    currency_code: 'YER',
    exchange_rate: 410,
    notes: 'ملاحظة',
    terms_and_conditions: 'الشروط',
    delivery_terms: 'التسليم',
    payment_terms: 'الدفع',
    party: { id: 'p-1', name: 'عميل تجريبي', phone: '777000111', email: null },
    quotation_items: [
      {
        id: 'i-1',
        product_id: 'prod-1',
        description: 'وصف احتياطي',
        quantity: 2,
        unit_price: 15000,
        discount_percent: 10,
        total: 27000,
        notes: null,
        sort_order: 0,
        product: {
          name_ar: 'غطاء تانكي',
          sku: 'SKU-1',
          part_number: 'PN-99',
          brand: 'تويوتا',
          cost_price: 8.25,
        },
      },
      {
        id: 'i-2',
        product_id: null,
        description: 'صنف بلا منتج',
        quantity: 1,
        unit_price: 3000,
        discount_percent: 0,
        total: 3000,
        notes: null,
        sort_order: 1,
        product: null,
      },
    ],
    ...overrides,
  }) as unknown as QuotationDetailRow;

describe('quotationPrintModel', () => {
  it('يحفظ عملة العرض بدل الافتراضي السعودي', () => {
    const data = mapQuotationToPrintData(makeQuotation());
    expect(data.header.currencyCode).toBe('YER');
    // الصيغتان مختلفتان فعلاً — وهذا سبب العطل الأصلي
    expect(formatCurrency(30000, 'YER')).not.toBe(formatCurrency(30000, 'SAR'));
  });

  it('يقع على SAR فقط عند غياب العملة', () => {
    const data = mapQuotationToPrintData(makeQuotation({ currency_code: '' }));
    expect(data.header.currencyCode).toBe('SAR');
  });

  it('يحوّل بنود العرض مع رقم القطعة والماركة والاسم', () => {
    const data = mapQuotationToPrintData(makeQuotation());
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({
      name: 'غطاء تانكي',
      code: 'PN-99',
      brand: 'تويوتا',
      quantity: 2,
      unitPrice: 15000,
      discountPercent: 10,
      total: 27000,
    });
    // بند بلا منتج: الاسم من الوصف والرمز فارغ
    expect(data.items[1]).toMatchObject({ name: 'صنف بلا منتج', code: '' });
  });

  it('يستخدم مجموع البنود عندما يكون المجموع المخزّن صفراً', () => {
    const data = mapQuotationToPrintData(makeQuotation({ subtotal: 0 }));
    expect(data.subtotal).toBe(30000);
  });

  it('يترجم حالات العرض إلى وسوم عربية', () => {
    expect(quotationStatusLabel('sent').label).toBe('مُرسل');
    expect(quotationStatusLabel('accepted').label).toBe('مقبول');
    expect(quotationStatusLabel('rejected').label).toBe('مرفوض');
    expect(quotationStatusLabel('anything-else').label).toBe('مسودة');
    expect(statusToneClasses('success').text).toContain('emerald');
  });

  it('يسمّي الطرف «المورد» في عروض المشتريات و«العميل» في المبيعات', () => {
    const sales = mapQuotationToPrintData(makeQuotation());
    expect(sales.header.partyNoun).toBe('العميل');
    expect(sales.header.partyFallbackName).toBe('عميل نقدي');

    const purchase = mapQuotationToPrintData(makeQuotation({ type: 'purchase' }));
    expect(purchase.header.partyNoun).toBe('المورد');
    expect(purchase.header.partyFallbackName).toBe('مورد غير محدد');

    // الاسم ينتقل إلى حمولتي المشاركة والإكسل حتى لا يصل المورد ملف يدّعي أنه العميل.
    const share = toSharePayload(purchase, { companyName: 'الجعفري', headerText: '' });
    expect(share.partyNoun).toBe('المورد');
    const excel = toQuotationExcelData(purchase, {
      companyName: 'الجعفري',
      companyNameEn: 'Aljaafari',
      companySpecialization: 'قطع غيار',
      companyAddress: 'شحن',
      companyPhone: '777',
      taxNumber: '300',
      issuedBy: 'المدير',
      accentColor: '1F4E78',
    });
    expect(excel.partyNoun).toBe('المورد');
  });

  it('يبني حمولة المشاركة من نفس بيانات الطباعة', () => {
    const data = mapQuotationToPrintData(makeQuotation());
    const payload = toSharePayload(data, { companyName: 'الجعفري', headerText: 'ترويسة' });

    expect(payload.currencyCode).toBe('YER');
    expect(payload.quotationNumber).toBe('QT-2026-0001');
    expect(payload.customerName).toBe('عميل تجريبي');
    expect(payload.totalAmount).toBe(30000);
    expect(payload.headerText).toBe('ترويسة');
    expect(payload.items[0]).toMatchObject({
      name: 'غطاء تانكي',
      quantity: 2,
      unitPrice: 15000,
      total: 27000,
    });
  });

  it('يحوّل النموذج إلى حمولة إكسل بعملة العرض الكاملة', () => {
    const data = mapQuotationToPrintData(makeQuotation());
    const excel = toQuotationExcelData(data, {
      companyName: 'الجعفري',
      companyNameEn: 'Aljaafari',
      companySpecialization: 'قطع غيار',
      companyAddress: 'شحن',
      companyPhone: '777',
      taxNumber: '300',
      issuedBy: 'المدير',
      accentColor: '1F4E78',
    });

    expect(excel.currency).toBe('YER');
    expect(excel.quotationNumber).toBe('QT-2026-0001');
    expect(excel.companyPhone).toBe('777');
    expect(excel.accentColor).toBe('1F4E78');
    // البند يحمل رقم القطعة والماركة ونسبة الخصم لوضعهما في أعمدة الشبكة
    expect(excel.items[0]).toMatchObject({
      name: 'غطاء تانكي',
      partNumber: 'PN-99',
      brand: 'تويوتا',
      quantity: 2,
      unitPrice: 15000,
      discountPercent: 10,
      total: 27000,
    });
    expect(excel.totalAmount).toBe(30000);
  });
});
