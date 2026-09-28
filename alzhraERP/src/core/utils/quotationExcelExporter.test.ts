import { describe, it, expect } from 'vitest';
import {
  generateQuotationWorkbook,
  normalizeAccent,
  quotationPalette,
} from './quotationExcelExporter';
import type { QuotationExcelData } from './quotationExcelExporter';
import type { XlsxSheet } from './excelExporterBase';
import { loadXLSX } from './excelExporterBase';

const SHEET = 'عرض سعر';
const NAVY = '1F4E78';

const SAMPLE: QuotationExcelData = {
  companyName: 'الجعفري لقطع غيار السيارات',
  companyNameEn: 'Aljaafari Auto Parts',
  companySpecialization: 'تجارة قطع غيار السيارات ومستلزماتها',
  companyAddress: 'شحن - المهرة',
  companyPhone: '777000111',
  taxNumber: '300000000000003',
  quotationNumber: 'QT-2026-0001',
  issueDate: '2026-09-28',
  validUntil: '2026-10-05',
  customerName: 'عميل تجريبي',
  customerPhone: '733222333',
  issuedBy: 'المدير',
  currency: 'YER',
  discountAmount: 1500,
  taxAmount: 0,
  paymentTerms: 'نقداً',
  deliveryTerms: 'تسليم فوري',
  items: [
    {
      name: 'غطاء تانكي بترول',
      partNumber: 'PN-99',
      brand: 'تويوتا',
      quantity: 2,
      unitPrice: 15000,
      discountPercent: 10,
      total: 27000,
    },
    {
      name: 'زيت مكينة',
      sku: 'SKU-7',
      brand: 'شل',
      quantity: 1,
      unitPrice: 3000,
      total: 3000,
    },
  ],
  subtotal: 30000,
  totalAmount: 28500,
  notes: 'ملاحظة العميل',
  accentColor: '#1F4E78',
};

interface StyledCell {
  v?: unknown;
  z?: string;
  s?: {
    fill?: { fgColor?: { rgb?: string } };
    font?: { sz?: number; bold?: boolean; color?: { rgb?: string } };
    alignment?: { horizontal?: string };
    border?: Record<string, unknown>;
  };
}

/** يقرأ خلية بمرجعها النصي (المرجع ديناميكي وفق مواصفات xlsx). */
const cellAt = (sheet: XlsxSheet, ref: string): StyledCell => {
  // eslint-disable-next-line security/detect-object-injection
  const cell: unknown = (sheet as Record<string, unknown>)[ref];
  return typeof cell === 'object' && cell !== null ? cell : {};
};

/** تنسيق الخلية ككائن مسطّح — يقلّل سلاسل `?.` المتكرّرة في كل تأكيد. */
const styleOf = (sheet: XlsxSheet, ref: string): NonNullable<StyledCell['s']> =>
  cellAt(sheet, ref).s ?? {};

const sheetOf = async (data: QuotationExcelData = SAMPLE): Promise<XlsxSheet> => {
  const wb = await generateQuotationWorkbook(data);
  const entry = Object.entries(wb.Sheets).find(([name]) => name === SHEET);
  if (entry === undefined) throw new Error('sheet missing');
  return entry[1];
};

describe('quotationExcelExporter — شبكة احترافية', () => {
  it('يطبّع لون التمييز ويرفض القيم غير الصالحة', () => {
    expect(normalizeAccent('#1f4e78')).toBe(NAVY);
    expect(normalizeAccent('abc123')).toBe('ABC123');
    expect(normalizeAccent('غير-صالح')).toBe(NAVY);
    expect(quotationPalette(NAVY).headerFill).toBe(NAVY);
  });

  it('يرسم ترويسة فخمة: شريط اسم المنشأة بلون التمييز وخط أبيض عريض', async () => {
    const ws = await sheetOf();
    const style = styleOf(ws, 'A1');
    expect(cellAt(ws, 'A1').v).toBe(SAMPLE.companyName);
    expect(style.fill?.fgColor?.rgb).toBe(NAVY);
    expect(style.font?.color?.rgb).toBe('FFFFFF');
    expect(style.font?.bold).toBe(true);
    expect(style.font?.sz).toBe(18);
  });

  it('يرفع ارتفاع صف الترويسة ويدمج الأشرطة على عرض الورقة (8 أعمدة)', async () => {
    const ws = await sheetOf();
    const rows = ws['!rows'] as Array<{ hpt?: number }> | undefined;
    expect(rows?.[0]?.hpt).toBe(34);

    const merges = ws['!merges'] ?? [];
    expect(merges).toContainEqual({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } });
    expect(merges).toContainEqual({ s: { r: 4, c: 0 }, e: { r: 4, c: 7 } });
  });

  it('يجعل الورقة من اليمين لليسار فعلياً في الملف المكتوب', async () => {
    const wb = await generateQuotationWorkbook(SAMPLE);
    // العقد الحقيقي لـ xlsx-js-style: الاتجاه يُقرأ من مستوى الملف لا من `!view`.
    expect(wb.Workbook?.Views?.[0]?.RTL).toBe(true);

    // تحقّق تسلسلي: كتابة بلا ضغط تُبقي XML مقروءاً فيمكن الجزم بما سيصل لإكسل.
    const XLSX = await loadXLSX();
    const binary = XLSX.write(wb, { bookType: 'xlsx', type: 'binary', compression: false });
    expect(typeof binary).toBe('string');
    expect(binary as string).toContain('rightToLeft="1"');
  });

  it('يبني شبكة أعمدة واسعة', async () => {
    const ws = await sheetOf();
    const cols = ws['!cols'] as Array<{ wch?: number }> | undefined;
    expect(cols).toHaveLength(8);
    expect(cols?.[2]?.wch).toBeGreaterThanOrEqual(40);
  });

  it('يبني رأس جدول ملوّناً بأعمدته الثمانية', async () => {
    const ws = await sheetOf();
    const header = cellAt(ws, 'A11');
    expect(header.s?.fill?.fgColor?.rgb).toBe(NAVY);
    expect(header.s?.font?.color?.rgb).toBe('FFFFFF');

    expect(cellAt(ws, 'B11').v).toBe('رقم القطعة');
    expect(cellAt(ws, 'C11').v).toBe('الوصف');
    expect(cellAt(ws, 'E11').v).toBe('الكمية');
    expect(String(cellAt(ws, 'F11').v)).toContain('YER');
    expect(cellAt(ws, 'G11').v).toBe('خصم %');
  });

  it('يكتب بنود العرض كخلايا: رقم القطعة والماركة والخصم كنسبة', async () => {
    const ws = await sheetOf();
    expect(cellAt(ws, 'A12').v).toBe(1);
    expect(cellAt(ws, 'B12').v).toBe('PN-99');
    expect(cellAt(ws, 'C12').v).toBe('غطاء تانكي بترول');
    expect(cellAt(ws, 'D12').v).toBe('تويوتا');
    expect(cellAt(ws, 'E12').v).toBe(2);
    expect(cellAt(ws, 'F12').v).toBe(15000);
    expect(cellAt(ws, 'G12').v).toBe('10%');
    expect(cellAt(ws, 'H12').v).toBe(27000);

    // البند الثاني بلا رقم قطعة → يقع على رمز الصنف
    expect(cellAt(ws, 'B13').v).toBe('SKU-7');
    expect(cellAt(ws, 'G13').v).toBe('—');
  });

  it('يظلّل الصفوف المتناوبة ويمنح الأرقام تنسيقاً مالياً', async () => {
    const ws = await sheetOf();
    // صف البند الثاني (13) فردي ⇒ ظل متناوب
    expect(cellAt(ws, 'C13').s?.fill?.fgColor?.rgb).toBe('F8FAFC');
    expect(cellAt(ws, 'F12').z).toBe('#,##0.00');
    expect(cellAt(ws, 'E12').z).toBe('#,##0');
    // الأرقام النصية تُحوَّل إلى أرقام حقيقية عند التنسيق
    expect(typeof cellAt(ws, 'H12').v).toBe('number');
    // حدود على كل خلية
    expect(cellAt(ws, 'C12').s?.border).toBeDefined();
  });

  it('يبرز كتلة الإجماليات وشريط الإجمالي النهائي', async () => {
    const ws = await sheetOf();
    // البنود في 12-13 ⇒ فاصل 14 ⇒ المجموع الفرعي 15 حتى الإجمالي النهائي 18
    expect(String(cellAt(ws, 'A15').v)).toContain('المجموع الفرعي');
    expect(cellAt(ws, 'G15').v).toBe(30000);
    expect(String(cellAt(ws, 'A16').v)).toContain('الخصم');
    expect(cellAt(ws, 'G16').v).toBe(1500);
    expect(String(cellAt(ws, 'A17').v)).toContain('الضريبة');
    expect(String(cellAt(ws, 'A18').v)).toContain('الإجمالي النهائي');
    expect(cellAt(ws, 'G18').v).toBe(28500);
    // الشريط النهائي بلون التمييز وخط أبيض
    expect(cellAt(ws, 'A18').s?.fill?.fgColor?.rgb).toBe(NAVY);
    expect(cellAt(ws, 'A18').s?.font?.color?.rgb).toBe('FFFFFF');
    // قيمة الإجمالي مدموجة على عمودين
    const merges = ws['!merges'] ?? [];
    expect(merges).toContainEqual({ s: { r: 17, c: 6 }, e: { r: 17, c: 7 } });
  });

  it('يضيف شروط الدفع والملاحظات وشريط الشكر', async () => {
    const ws = await sheetOf();
    expect(cellAt(ws, 'A20').v).toBe('شروط الدفع');
    expect(cellAt(ws, 'B20').v).toBe('نقداً');
    expect(cellAt(ws, 'A21').v).toBe('شروط التسليم');
    expect(cellAt(ws, 'A22').v).toBe('ملاحظات');
    expect(String(cellAt(ws, 'A23').v)).toContain('شكراً لتعاملكم');
    expect(cellAt(ws, 'A23').s?.fill?.fgColor?.rgb).toBe('EAF1FA');
  });

  it('يستخدم كحلياً افتراضياً عندما لا يُمرَّر لون', async () => {
    const ws = await sheetOf({ ...SAMPLE, accentColor: undefined });
    expect(cellAt(ws, 'A1').s?.fill?.fgColor?.rgb).toBe(NAVY);
  });
});
