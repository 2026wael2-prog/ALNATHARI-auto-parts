// ============================================
// نموذج طباعة عرض السعر — منطق خالص بلا JSX
// ============================================
// يفصل تحويل بيانات العرض القادمة من الـAPI عن قالب الطباعة، حتى يبقى القالب
// مسؤولاً عن العرض فقط. العملة تُنقل صراحةً إلى كل تنسيق مبلغ: عرض سعر بالريال
// اليمني كان يُطبع كريال سعودي لأن formatCurrency يُستدعى بلا عملة.
//
// ملاحظة: حقول العرض مُعرَّفة أرقاماً في نوع الـAPI، فلا نمرّرها على Number()
// (قاعدة no-unnecessary-type-conversion ترفض ذلك).

import type { QuotationDetailItem, QuotationDetailRow } from '../../../api/quotationsApi';
import type { QuotationShareItem, QuotationSharePayload } from '../../../utils/quotationShareHelper';

export interface QuotationPrintItem {
  id: string;
  name: string;
  /** رقم القطعة إن وُجد وإلا رمز الصنف (SKU). */
  code: string;
  brand: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  total: number;
}

export interface QuotationPrintHeader {
  number: string;
  issueDate: string;
  validUntil: string;
  statusLabel: string;
  statusTone: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  currencyCode: string;
}

export interface QuotationPrintData {
  header: QuotationPrintHeader;
  items: QuotationPrintItem[];
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paymentTerms: string;
  deliveryTerms: string;
  notes: string;
  termsAndConditions: string;
}

const hasText = (value: string): boolean => value.trim() !== '';

const text = (value: string | null | undefined): string => value ?? '';

/** وصف حالة العرض بالأثر البصري المناسب (زمردي=مقبول، أحمر=مرفوض...). */
export const quotationStatusLabel = (status: string): { label: string; tone: string } => {
  switch (status) {
    case 'sent':
      return { label: 'مُرسل', tone: 'info' };
    case 'accepted':
      return { label: 'مقبول', tone: 'success' };
    case 'rejected':
      return { label: 'مرفوض', tone: 'danger' };
    case 'expired':
      return { label: 'منتهي الصلاحية', tone: 'warning' };
    case 'converted':
      return { label: 'تحوّل إلى فاتورة', tone: 'info' };
    default:
      return { label: 'مسودة', tone: 'neutral' };
  }
};

/**
 * ألوان شريحة الحالة للطباعة (خلفية فاتحة + نص غامق).
 * دالة switch بدل Record مُفهرَس: الفهرسة بمفتاح متغيّر تُنشئ إنذار
 * `security/detect-object-injection` في هذا المستودع.
 */
export const statusToneClasses = (tone: string): { chip: string; text: string } => {
  switch (tone) {
    case 'info':
      return { chip: 'bg-blue-50 border-blue-300', text: 'text-blue-700' };
    case 'success':
      return { chip: 'bg-emerald-50 border-emerald-300', text: 'text-emerald-700' };
    case 'danger':
      return { chip: 'bg-rose-50 border-rose-300', text: 'text-rose-700' };
    case 'warning':
      return { chip: 'bg-amber-50 border-amber-300', text: 'text-amber-700' };
    default:
      return { chip: 'bg-slate-100 border-slate-300', text: 'text-slate-700' };
  }
};

const mapItem = (item: QuotationDetailItem): QuotationPrintItem => {
  const product = item.product;
  const productName = text(product?.name_ar);
  const partNumber = text(product?.part_number);
  return {
    id: item.id,
    name: hasText(productName) ? productName.trim() : text(item.description),
    code: hasText(partNumber) ? partNumber.trim() : text(product?.sku),
    brand: text(product?.brand),
    quantity: item.quantity,
    unitPrice: item.unit_price,
    discountPercent: item.discount_percent,
    total: item.total,
  };
};

const mapHeader = (quotation: QuotationDetailRow): QuotationPrintHeader => {
  const status = quotationStatusLabel(quotation.status);
  const currency = text(quotation.currency_code);
  return {
    number: text(quotation.quotation_number),
    issueDate: text(quotation.issue_date),
    validUntil: text(quotation.valid_until),
    statusLabel: status.label,
    statusTone: status.tone,
    customerName: text(quotation.party?.name),
    customerPhone: text(quotation.party?.phone),
    customerEmail: text(quotation.party?.email),
    currencyCode: hasText(currency) ? currency : 'SAR',
  };
};

/** يحوّل صف العرض إلى نموذج جاهز للطباعة والمشاركة. */
export const mapQuotationToPrintData = (quotation: QuotationDetailRow): QuotationPrintData => {
  const items = quotation.quotation_items.map(mapItem);
  const lineSum = items.reduce((sum, item) => sum + item.total, 0);

  return {
    header: mapHeader(quotation),
    items,
    subtotal: quotation.subtotal > 0 ? quotation.subtotal : lineSum,
    discountAmount: quotation.discount_amount,
    taxAmount: quotation.tax_amount,
    totalAmount: quotation.total_amount,
    paymentTerms: text(quotation.payment_terms),
    deliveryTerms: text(quotation.delivery_terms),
    notes: text(quotation.notes),
    termsAndConditions: text(quotation.terms_and_conditions),
  };
};

export interface QuotationShareContext {
  companyName: string;
  /** ترويسة واتساب المُهيّأة من قالب المستند (قد تكون فارغة). */
  headerText: string;
}

const toShareItem = (item: QuotationPrintItem): QuotationShareItem => ({
  name: item.name,
  sku: item.code,
  partNumber: item.code,
  quantity: item.quantity,
  unitPrice: item.unitPrice,
  discountPercent: item.discountPercent,
  total: item.total,
});

/**
 * يبني حمولة المشاركة من نفس نموذج الطباعة، فلا تتباعد الرسالة عن المستند
 * المطبوع في العملة أو الأصناف أو الإجمالي.
 */
export const toSharePayload = (
  data: QuotationPrintData,
  context: QuotationShareContext
): QuotationSharePayload => ({
  companyName: context.companyName,
  headerText: context.headerText,
  quotationNumber: data.header.number,
  issueDate: data.header.issueDate,
  validUntil: data.header.validUntil,
  customerName: data.header.customerName,
  customerPhone: data.header.customerPhone,
  currencyCode: data.header.currencyCode,
  items: data.items.map(toShareItem),
  subtotal: data.subtotal,
  discountAmount: data.discountAmount,
  taxAmount: data.taxAmount,
  totalAmount: data.totalAmount,
  paymentTerms: data.paymentTerms,
  deliveryTerms: data.deliveryTerms,
  notes: data.notes,
  termsAndConditions: data.termsAndConditions,
});
