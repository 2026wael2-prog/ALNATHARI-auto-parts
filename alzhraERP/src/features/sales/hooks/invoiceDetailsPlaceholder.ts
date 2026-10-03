import type { InvoiceWithDetails } from '@/features/sales/api';

/**
 * ── الحقول المبدئية لنافذة تفاصيل الفاتورة (قبل وصول بيانات الخادم) ──────────
 *
 * تُشتقّ من صفوف قوائم المبيع في كاش TanStack Query، وفيها **دلالة المبالغ
 * حاكمة** (انظر `src/core/utils/documentMoney.ts`):
 *
 *   `total`     في صفوف القوائم = مبلغ المستند بعملة الفاتورة (مثال: 14,000 ر.ي)
 *   `baseTotal` في صفوف القوائم = معادل الأساس بالريال السعودي (مثال: 31.08)
 *
 * وإسقاط `total` على `total_amount` (حقل الأساس) يقلب الدلالة، فيظهر
 * «31.08 ر.ي» بدل «14,000 ر.ي» — وهو الخطأ المرصود على الفاتورة
 * `2-مبيع:64262` (currency YER · rate 0.00222 · أساس 31.08 · مستند 14,000).
 */

/** أعمدة مبالغ المستند (هجرة 20261002000001) — لم تُولَّد في database.types بعد. */
export interface DocumentMoneyColumns {
  total_document_amount?: number | null;
  subtotal_document_amount?: number | null;
}

/** صف فاتورة مختصر من الكاش (snake_case من الـRPC أو camelCase من الخدمة). */
export interface CachedInvoiceRow {
  id?: string;
  invoice_number?: string;
  invoiceNumber?: string;
  issue_date?: string;
  date?: string;
  // — مبالغ: الأساس (SAR) ثم مبلغ المستند بعملة الفاتورة —
  total_amount?: number | null;
  baseTotal?: number | null;
  total_document_amount?: number | null;
  /** في صفوف القوائم = مبلغ المستند بعملة الفاتورة */
  total?: number | null;
  currency_code?: string | null;
  currencyCode?: string | null;
  exchange_rate?: number | null;
  exchangeRate?: number | null;
  status?: string;
  type?: string;
  payment_method?: string | null;
  paymentMethod?: string | null;
  party_id?: string | null;
  party?: { id?: string; name?: string } | null;
  parties?: { name?: string } | null;
  customerName?: string;
  invoice_items?: InvoiceWithDetails['invoice_items'];
  payment_allocations?: InvoiceWithDetails['payment_allocations'];
}

/** يستخرج أول حقل نصّي غير فارغ (snake_case أولاً) بعد إزالة الفراغات. */
const pickStr = (a?: string | null, b?: string | null, fallback = ''): string => {
  const first = (a ?? '').trim();
  if (first !== '') return first;
  const second = (b ?? '').trim();
  if (second !== '') return second;
  return fallback;
};

/** يستخرج أول حقل رقمي معرَّف (snake_case أولاً) بلا اعتبار للصفر قيمة غائبة. */
const pickNum = (a?: number | null, b?: number | null, fallback = 0): number => a ?? b ?? fallback;

/** يوحّد رمز العملة نحو الحروف الكبيرة، مع الأساس كافتراضي. */
const normalizeCurrency = (raw?: string | null): string => {
  const code = (raw ?? '').trim().toUpperCase();
  return code === '' ? 'SAR' : code;
};

/** يبني بيانات الطرف (العميل/المورد) من صف القائمة. */
const buildParty = (found: CachedInvoiceRow): InvoiceWithDetails['parties'] =>
  ({
    id: found.party_id ?? found.party?.id ?? '',
    name: found.parties?.name ?? found.party?.name ?? found.customerName ?? 'عميل نقدي',
  }) as InvoiceWithDetails['parties'];

/**
 * سعر الصرف: القيمة الصريحة من الصف، وإلا يُشتق من (الأساس ÷ مبلغ المستند)
 * بدل افتراض 1 الذي يقلب عرض العملة الأجنبية (31.08 ر.ي بدل 14,000 ر.ي).
 */
const resolveExchangeRate = (
  found: CachedInvoiceRow,
  currency: string,
  baseAmount: number,
  documentAmount: number
): number => {
  const explicit = pickNum(found.exchange_rate, found.exchangeRate, 0);
  if (explicit > 0) return explicit;
  if (currency !== 'SAR' && baseAmount > 0 && documentAmount > 0) return baseAmount / documentAmount;
  return 1;
};

/**
 * يحوّل صف قائمة إلى شكل بيانات الفاتورة، **بترتيبٍ لا يقلب دلالة المبالغ**:
 * أساس SAR في `total_amount`، ومبلغ المستند في `total_document_amount`.
 */
export const mapCachedInvoiceRow = (found: CachedInvoiceRow): InvoiceWithDetails => {
  const baseAmount = pickNum(found.total_amount, found.baseTotal, 0);
  const documentAmount = pickNum(found.total_document_amount, found.total, 0);
  const currency = normalizeCurrency(pickStr(found.currency_code, found.currencyCode));

  const mapped = { ...(found as unknown as InvoiceWithDetails) } as InvoiceWithDetails &
    DocumentMoneyColumns;

  mapped.id = found.id ?? '';
  mapped.invoice_number = pickStr(found.invoice_number, found.invoiceNumber);
  mapped.issue_date = pickStr(found.issue_date, found.date);
  mapped.currency_code = currency;
  mapped.exchange_rate = resolveExchangeRate(found, currency, baseAmount, documentAmount);

  // ⚠️ الأساس أولاً، ثم مبلغ المستند — العكس يُظهر 31.08 ر.ي بدل 14,000 ر.ي
  mapped.total_amount = baseAmount;
  mapped.total_document_amount = documentAmount;
  mapped.subtotal = baseAmount;
  mapped.subtotal_document_amount = documentAmount;

  mapped.status = found.status ?? 'draft';
  mapped.type = found.type ?? 'sale';
  mapped.payment_method = pickStr(found.payment_method, found.paymentMethod, 'cash');
  mapped.parties = buildParty(found);
  mapped.invoice_items = found.invoice_items ?? [];
  mapped.payment_allocations = found.payment_allocations ?? [];

  return mapped;
};
