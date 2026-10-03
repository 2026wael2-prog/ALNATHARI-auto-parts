import { formatCurrency } from './currencyUtils';

/**
 * ── دلالة المبالغ في المستندات (فواتير/سندات/مرتجعات) ─────────────────────────
 *
 * القاعدة المُثبتة بالقياس على قاعدة الإنتاج ونسخة الميزان الأصلية (2026-10-02):
 *
 *   كل مبلغ مخزَّن في جداول المستندات (`invoices.total_amount`,
 *   `invoice_items.unit_price`, ...) هو **بعملة الأساس (SAR)** — مطابقةً
 *   لـ `Mizan.Bill.Total` و`Mizan.BillItem.UnitPrice`.
 *
 *   والمبلغ بعملة المستند (ما دفعه العميل فعلاً) يُخزَّن في الدفتر:
 *   `journal_entry_lines.foreign_amount` = `Mizan.EntryItem.CDebit`،
 *   وتمّت تعبئته في `invoices.total_document_amount`.
 *
 *   مثال: الفاتورة 2-مبيع:64294 — الأساس 159.84 ر.س، سعر الصرف 0.002220
 *   ⇒ مبلغ المستند 72,000 ر.ي.
 *
 * لذلك أي عرض لمبلغ مستند بعملة أجنبية يجب أن يمرّ من هنا، وإلا ظهر معادل
 * الأساس تحت رمز العملة الأجنبية (وهو الخطأ الذي كان قائماً).
 */

export const BASE_CURRENCY = 'SAR';

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** معامل التحويل من عملة الأساس إلى عملة المستند (1 لعملة الأساس). */
export const documentFactor = (
  currencyCode?: string | null,
  exchangeRate?: number | string | null
): number => {
  const currency = (currencyCode ?? BASE_CURRENCY).trim().toUpperCase();
  if (currency === BASE_CURRENCY || currency === '') return 1;
  const rate = num(exchangeRate);
  return rate > 0 ? 1 / rate : 1;
};

/** يحوّل مبلغ الأساس إلى مبلغ بعملة المستند. */
export const toDocumentAmount = (
  baseAmount: unknown,
  currencyCode?: string | null,
  exchangeRate?: number | string | null
): number => num(baseAmount) * documentFactor(currencyCode, exchangeRate);

/**
 * الإجمالي بعملة المستند: يُفضّل `invoices.total_document_amount` (المأخوذ من
 * الأصل)، وإلا يُشتق من الأساس ÷ سعر الصرف.
 */
export const toDocumentTotal = (
  row:
    | {
        total_amount?: unknown;
        total_document_amount?: unknown;
        currency_code?: string | null;
        exchange_rate?: number | string | null;
      }
    | null
    | undefined
): number => {
  if (!row) return 0;
  const stored = num(row.total_document_amount);
  if (stored > 0) return stored;
  return toDocumentAmount(row.total_amount, row.currency_code, row.exchange_rate);
};

/** يوحّد رمز العملة (حروف كبيرة) ليطابق مفاتيح `CURRENCY_SYMBOLS` دائماً. */
const normalizeCurrency = (currencyCode?: string | null): string => {
  const code = (currencyCode ?? BASE_CURRENCY).trim().toUpperCase();
  return code === '' ? BASE_CURRENCY : code;
};

/** نص منسّق لمبلغ بند/حقل بعملة المستند. */
export const formatDocumentAmount = (
  baseAmount: unknown,
  currencyCode?: string | null,
  exchangeRate?: number | string | null
): string =>
  formatCurrency(
    toDocumentAmount(baseAmount, currencyCode, exchangeRate),
    normalizeCurrency(currencyCode)
  );

/** نص منسّق لإجمالي فاتورة بعملة المستند (مع تفضيل العمود المخزَّن). */
export const formatDocumentTotal = (
  row:
    | {
        total_amount?: unknown;
        total_document_amount?: unknown;
        currency_code?: string | null;
        exchange_rate?: number | string | null;
      }
    | null
    | undefined
): string => formatCurrency(toDocumentTotal(row), normalizeCurrency(row?.currency_code));

/** نص منسّق لمبلغ الأساس (للعرض التوضيحي بجانب مبلغ المستند). */
export const formatBaseAmount = (baseAmount: unknown): string =>
  formatCurrency(num(baseAmount), BASE_CURRENCY);

/**
 * نص مزدوج للفواتير الأجنبية: «72,000 ر.ي (ما يعادل 159.84 ر.س)»،
 * ويفرد المبلغ مرة واحدة لعملة الأساس.
 */
export const formatDocumentWithBase = (
  row:
    | {
        total_amount?: unknown;
        total_document_amount?: unknown;
        currency_code?: string | null;
        exchange_rate?: number | string | null;
      }
    | null
    | undefined
): string => {
  if (!row) return formatCurrency(0, BASE_CURRENCY);
  const currency = normalizeCurrency(row.currency_code);
  const documentText = formatDocumentTotal(row);
  if (currency === BASE_CURRENCY) return documentText;
  return `${documentText} (ما يعادل ${formatBaseAmount(row.total_amount)})`;
};
