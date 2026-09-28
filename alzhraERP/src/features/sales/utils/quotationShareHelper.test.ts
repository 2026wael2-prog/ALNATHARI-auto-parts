import { describe, expect, it } from 'vitest';
import {
  buildQuotationCaption,
  buildQuotationMessageText,
  openQuotationTelegram,
  openQuotationWhatsApp,
} from './quotationShareHelper';
import type { QuotationShareItem, QuotationSharePayload } from './quotationShareHelper';

const item = (index: number): QuotationShareItem => ({
  name: `صنف رقم ${String(index)}`,
  sku: `SKU-${String(index)}`,
  partNumber: `PN-${String(index)}`,
  quantity: 2,
  unitPrice: 1500,
  discountPercent: 5,
  total: 2850,
});

const makePayload = (itemCount: number): QuotationSharePayload => ({
  companyName: 'الجعفري لقطع غيار السيارات',
  quotationNumber: 'QP-0001',
  issueDate: '2026-09-28',
  validUntil: '2026-10-05',
  customerName: 'مورد تجريبي',
  customerPhone: null,
  partyNoun: 'المورد',
  currencyCode: 'YER',
  items: Array.from({ length: itemCount }, (_, i) => item(i)),
  subtotal: itemCount * 2850,
  totalAmount: itemCount * 2850,
});

const captureOpen = (run: () => void): string => {
  let url = '';
  // bind مقصود: يمنع خطأ unbound-method عند حفظ مرجع الدالة الأصلية.
  const original = window.open.bind(window);
  window.open = (target?: string | URL): Window | null => {
    url = String(target);
    return null;
  };
  try {
    run();
  } finally {
    window.open = original;
  }
  return url;
};

describe('quotationShareHelper — حدود روابط المشاركة', () => {
  it('يرسل النص الكامل للعرض الصغير داخل رابط تيليجرام', () => {
    const payload = makePayload(2);
    const url = captureOpen(() => {
      openQuotationTelegram(payload);
    });
    const text = decodeURIComponent(url.split('&text=')[1] ?? '');
    expect(url.startsWith('https://t.me/share/url?url=')).toBe(true);
    expect(text).toContain('صنف رقم 1');
  });

  it('يستبدل النص المكتظ بالتعليق المختصر في العرض الكبير حتى يبقى الرابط صالحاً', () => {
    const payload = makePayload(63);
    // النص الكامل يتجاوز حدود الرابط، والتعليق المختصر يبقى مقبولاً.
    expect(buildQuotationMessageText(payload).length).toBeGreaterThan(1600);
    expect(buildQuotationCaption(payload).length).toBeLessThan(1600);

    const telegramUrl = captureOpen(() => {
      openQuotationTelegram(payload);
    });
    const whatsappUrl = captureOpen(() => {
      openQuotationWhatsApp(payload);
    });

    const telegramText = decodeURIComponent(telegramUrl.split('&text=')[1] ?? '');
    const whatsappText = decodeURIComponent(whatsappUrl.split('?text=')[1] ?? '');

    expect(telegramText).not.toContain('صنف رقم 62');
    expect(telegramText).toContain('QP-0001');
    expect(whatsappUrl.startsWith('https://wa.me/')).toBe(true);
    expect(whatsappText).toContain('*المورد:*');
    // الرابط يبقى ضمن الحد الآمن للخوادم (لا يتحول إلى رابط مقتطع أو مرفوض).
    expect(telegramUrl.length).toBeLessThan(4000);
    expect(whatsappUrl.length).toBeLessThan(4000);
  });
});
