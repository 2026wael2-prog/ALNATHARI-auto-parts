// ============================================
// مشاركة عروض الأسعار عبر واتساب وتيليجرام
// ============================================
// يبني رسالة نصية مقروءة (لا ملف مرفق) يقرأها العميل فوراً على الهاتف، مع الالتزام
// بعملة العرض: عرض السعر بالريال اليمني كان يُعرض كريال سعودي لأن formatCurrency
// يُستدعى بلا عملة فيقع على الافتراضي 'SAR'.

import { formatCurrency } from '@/core/utils/currencyUtils';
import { formatLocalDate } from '@/core/utils/dateUtils';
import { buildWhatsAppLink, hasValidWhatsAppPhone } from '@/features/debts/lib/whatsapp';

export interface QuotationShareItem {
  name: string;
  sku?: string | null;
  partNumber?: string | null;
  quantity: number | string;
  unitPrice: number | string;
  discountPercent?: number | string | null;
  total: number | string;
}

export interface QuotationSharePayload {
  companyName: string;
  /** ترويسة واتساب المُهيّأة من قالب المستند (اختيارية). */
  headerText?: string;
  quotationNumber: string;
  issueDate?: string | null;
  validUntil?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  /** 'العميل' (افتراضياً) أو 'المورد' في عروض المشتريات. */
  partyNoun?: string | null;
  currencyCode?: string | null;
  items: QuotationShareItem[];
  subtotal?: number | string | null;
  discountAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount: number | string;
  paymentTerms?: string | null;
  deliveryTerms?: string | null;
  notes?: string | null;
  termsAndConditions?: string | null;
}

const DIVIDER = '━━━━━━━━━━━━━━━━━━';

const currencyOf = (payload: QuotationSharePayload): string => payload.currencyCode ?? 'SAR';

const money = (value: number | string | null | undefined, currency: string): string =>
  formatCurrency(Number(value ?? 0), currency);

const nonEmpty = (value: string | null | undefined): string => (value ?? '').trim();

/** اسم الطرف كما يظهر في الرسالة: عميل للمبيعات ومورد للمشتريات. */
const partyNounOf = (payload: QuotationSharePayload): string => {
  const noun = nonEmpty(payload.partyNoun);
  return noun !== '' ? noun : 'العميل';
};

/** الأيام المتبقية على الصلاحية، أو null إن لم يُحدَّد تاريخ صالح. */
const daysRemaining = (validUntil: string | null | undefined): number | null => {
  const raw = nonEmpty(validUntil);
  if (raw === '') return null;
  const diff = new Date(raw).getTime() - Date.now();
  if (Number.isNaN(diff)) return null;
  return Math.ceil(diff / 86_400_000);
};

const validityLine = (validUntil: string | null | undefined): string | null => {
  const raw = nonEmpty(validUntil);
  if (raw === '') return null;
  const left = daysRemaining(raw);
  if (left === null) return `⏳ *صالح حتى:* ${raw}`;
  return left <= 0
    ? `⏳ *صالح حتى:* ${raw} (انتهت الصلاحية)`
    : `⏳ *صالح حتى:* ${raw} (متبقي ${String(left)} يوم)`;
};

const itemLines = (item: QuotationShareItem, index: number, currency: string): string[] => {
  const name = nonEmpty(item.name);
  const partNumber = nonEmpty(item.partNumber);
  const code = partNumber !== '' ? partNumber : nonEmpty(item.sku);
  const discount = Number(item.discountPercent ?? 0);

  const lines = [`${String(index + 1)}. *${name !== '' ? name : 'صنف بدون اسم'}*`];
  if (code !== '') lines.push(`   ▫️ رقم القطعة: \`${code}\``);
  lines.push(
    `   ▫️ الكمية: *${String(Number(item.quantity))}* × ${money(item.unitPrice, currency)}`
  );
  if (discount > 0) lines.push(`   ▫️ الخصم: ${String(discount)}%`);
  lines.push(`   ▫️ الإجمالي: *${money(item.total, currency)}*`, '');
  return lines;
};

const buildHeaderLines = (payload: QuotationSharePayload): string[] => {
  const lines: string[] = [];
  const header = nonEmpty(payload.headerText);
  if (header !== '') lines.push(header, '');

  lines.push(`🧾 *عرض سعر* \`${payload.quotationNumber}\``);
  lines.push(`🏢 *${payload.companyName}*`);
  lines.push(
    `📅 *التاريخ:* ${nonEmpty(payload.issueDate) !== '' ? nonEmpty(payload.issueDate) : formatLocalDate()}`
  );

  const customer = nonEmpty(payload.customerName);
  if (customer !== '') lines.push(`👤 *${partyNounOf(payload)}:* ${customer}`);

  const validity = validityLine(payload.validUntil);
  if (validity !== null) lines.push(validity);

  lines.push(DIVIDER);
  lines.push(`📦 *الأصناف (${String(payload.items.length)})* — *العملة:* ${currencyOf(payload)}`);
  return lines;
};

const buildItemLines = (payload: QuotationSharePayload): string[] => {
  if (payload.items.length === 0) return ['(لا توجد أصناف في هذا العرض)'];
  const currency = currencyOf(payload);
  return payload.items.flatMap((item, index) => itemLines(item, index, currency));
};

const buildAmountLines = (payload: QuotationSharePayload): string[] => {
  const currency = currencyOf(payload);
  const lines: string[] = [DIVIDER];

  const subtotal = Number(payload.subtotal ?? 0);
  const discount = Number(payload.discountAmount ?? 0);
  const tax = Number(payload.taxAmount ?? 0);

  if (subtotal > 0) lines.push(`المجموع قبل الخصم: ${money(subtotal, currency)}`);
  if (discount > 0) lines.push(`الخصم: −${money(discount, currency)}`);
  if (tax > 0) lines.push(`الضريبة: ${money(tax, currency)}`);
  lines.push(`💰 *الإجمالي النهائي: ${money(payload.totalAmount, currency)}*`);
  return lines;
};

const buildTermsLines = (payload: QuotationSharePayload): string[] => {
  const lines: string[] = [];
  const payment = nonEmpty(payload.paymentTerms);
  const delivery = nonEmpty(payload.deliveryTerms);
  const notes = nonEmpty(payload.notes);
  const terms = nonEmpty(payload.termsAndConditions);

  if (payment !== '') lines.push(`💳 *شروط الدفع:* ${payment}`);
  if (delivery !== '') lines.push(`🚚 *شروط التسليم:* ${delivery}`);
  if (notes !== '') lines.push(`📝 *ملاحظات:* ${notes}`);
  if (terms !== '') lines.push(`📌 *الشروط والأحكام:* ${terms}`);

  lines.push('', 'نشكر لكم ثقتكم. العرض ساري ما لم يُذكر خلاف ذلك.');
  return lines;
};

/** يبني نص عرض السعر الجاهز للإرسال. */
export const buildQuotationMessageText = (payload: QuotationSharePayload): string =>
  [
    ...buildHeaderLines(payload),
    ...buildItemLines(payload),
    ...buildAmountLines(payload),
    ...buildTermsLines(payload),
  ].join('\n');

/**
 * تعليق مختصر يُرفق مع ملف الإكسل.
 * يبقى قصيراً عمداً: تعليقات واتساب محدودة الطول، وسرد كل الأصناف داخل الرسالة
 * قد يُقتطع — التفاصيل كاملة في الملف المرفق.
 */
export const buildQuotationCaption = (payload: QuotationSharePayload): string => {
  const currency = currencyOf(payload);
  const lines: string[] = [];

  const header = nonEmpty(payload.headerText);
  if (header !== '') lines.push(header);

  lines.push(`🧾 *عرض سعر* \`${payload.quotationNumber}\``);
  const customer = nonEmpty(payload.customerName);
  if (customer !== '') lines.push(`👤 *${partyNounOf(payload)}:* ${customer}`);
  lines.push(`💰 *الإجمالي:* ${money(payload.totalAmount, currency)}`);

  const validity = validityLine(payload.validUntil);
  if (validity !== null) lines.push(validity);

  lines.push('', '📎 تفاصيل العرض كاملة في الملف المرفق.');
  return lines.join('\n');
};

/** أقصى طول لنص يُمرَّر داخل رابط مشاركة (wa.me/t.me) قبل أن يُرفض أو يُقتطع. */
const MAX_SHARE_TEXT_LENGTH = 1600;

/**
 * نص المشاركة المناسب لحجم العرض: عرض ببنود كثيرة يُنتج رابطاً أطول من قدرة
 * واتساب/تيليجرام على استقباله فيتعذّر فتح المحادثة. في هذه الحالة نُرسل التعليق
 * المختصر (والملف المرفق يحمل التفاصيل كاملة).
 */
const shareTextFor = (payload: QuotationSharePayload): string => {
  const full = buildQuotationMessageText(payload);
  if (full.length <= MAX_SHARE_TEXT_LENGTH) return full;
  return buildQuotationCaption(payload);
};

/**
 * يفتح واتساب على رقم العميل مع النص مُعبّأً؛ وإن لم يكن الرقم صالحاً يفتح نافذة
 * اختيار المحادثة مع النص نفسه.
 */
export const openQuotationWhatsApp = (
  payload: QuotationSharePayload,
  customPhone?: string
): void => {
  const text = shareTextFor(payload);
  const fromArgument = nonEmpty(customPhone);
  const target = fromArgument !== '' ? fromArgument : nonEmpty(payload.customerPhone);
  const link = hasValidWhatsAppPhone(target)
    ? buildWhatsAppLink(target, text)
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(link, '_blank', 'noopener,noreferrer');
};

/** يفتح تيليجرام مع النص نفسه. */
export const openQuotationTelegram = (payload: QuotationSharePayload): void => {
  const text = shareTextFor(payload);
  const link = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(text)}`;
  window.open(link, '_blank', 'noopener,noreferrer');
};

/** نسخ النص إلى الحافظة (بديل عند تعذّر فتح التطبيقات). */
export const copyQuotationText = async (payload: QuotationSharePayload): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(buildQuotationMessageText(payload));
    return true;
  } catch {
    return false;
  }
};
