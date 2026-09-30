import type { CashDenominationCounts, DailyDrawerSummary } from '../types';
import { CURRENCY_SYMBOLS } from '../../../core/utils';

export const STANDARD_DENOMINATIONS = [
  { value: 500, label: '500 ر.س' },
  { value: 200, label: '200 ر.س' },
  { value: 100, label: '100 ر.س' },
  { value: 50, label: '50 ر.س' },
  { value: 20, label: '20 ر.س' },
  { value: 10, label: '10 ر.س' },
  { value: 5, label: '5 ر.س' },
  { value: 1, label: '1 ر.س' },
  { value: 0.5, label: '0.5 ر.س' },
] as const;

export const DEFAULT_TOLERANCE_SAR = 10;

/**
 * رمز العملة المعروض — يعود إلى كود العملة نفسه إذا لم يوجد رمز معروف
 * (تفادي فرض رمز الريال السعودي على منشآت تعمل بالريال اليمني).
 */
export const currencySymbol = (currencyCode?: string | null): string => {
  const code = (currencyCode || 'SAR').toUpperCase().trim();
  return CURRENCY_SYMBOLS[code] || code;
};

/**
 * عملة الملخص الأساسية كما حسبها الخادم (مصدر الحقيقة)، مع توافق خلفي لـ SAR.
 */
export const resolveSummaryCurrency = (summary: DailyDrawerSummary): string =>
  (summary.base_currency || summary.currency || 'SAR').toUpperCase().trim();

/**
 * فئات النقد مع تسمية بالعملة الأساسية للمنشأة (بدل تثبيت ر.س على الجميع).
 */
export const getDenominationsFor = (
  currencyCode?: string | null
): Array<{ value: number; label: string }> => {
  const symbol = currencySymbol(currencyCode);
  return STANDARD_DENOMINATIONS.map(denom => ({
    value: denom.value,
    label: `${denom.value} ${symbol}`,
  }));
};

/**
 * حد التسامح المعتمد: من الخادم إن أرسله، وإلا الحد الافتراضي.
 */
export const resolveTolerance = (summary?: DailyDrawerSummary | null): number => {
  const serverTolerance = summary?.variance_tolerance;
  if (serverTolerance === null || serverTolerance === undefined) return DEFAULT_TOLERANCE_SAR;
  const isUsableTolerance = Number.isFinite(serverTolerance) && serverTolerance >= 0;
  return isUsableTolerance ? serverTolerance : DEFAULT_TOLERANCE_SAR;
};

/**
 * قراءة عدّاد فئة نقدية واحدة بأمان — المفتاح ديناميكي (Record) لذا يُعزل الوصول
 * إليه هنا في طبقة الخدمة بدل الوصول المباشر بالمؤشر داخل مكوّنات الواجهة.
 */
export const getDenominationCount = (
  counts: CashDenominationCounts,
  denominationKey: string
): number => {
  const count = counts[denominationKey];
  return Number.isFinite(count) ? count : 0;
};

/** مدخلات صياغة رسالة الواتساب (كائن واحد بدل وسائط متفرقة) */
export interface WhatsAppSummaryInput {
  actualCash: number;
  actualCard: number;
  floatRetained: number;
  cashToOwner: number;
  shopName?: string | undefined;
}

export const reconciliationService = {
  /**
   * حساب إجمالي النقدية من الفئات المعدودة
   */
  calculateDenominationsTotal: (counts: CashDenominationCounts): number => {
    let total = 0;
    for (const [denomStr, count] of Object.entries(counts)) {
      const denom = parseFloat(denomStr);
      const qty = Number.isFinite(count) ? count : 0;
      if (!isNaN(denom) && qty > 0) {
        total += denom * qty;
      }
    }
    return Math.round(total * 100) / 100;
  },

  /**
   * حساب الفارق بين الفعلي والمتوقع مع فحص حد التسامح
   */
  calculateVariance: (
    actual: number,
    expected: number,
    tolerance = DEFAULT_TOLERANCE_SAR
  ): {
    variance: number;
    status: 'balanced' | 'surplus' | 'shortage';
    isWithinTolerance: boolean;
  } => {
    const safeActual = Number.isFinite(actual) ? actual : 0;
    const safeExpected = Number.isFinite(expected) ? expected : 0;
    const variance = Math.round((safeActual - safeExpected) * 100) / 100;
    const absVariance = Math.abs(variance);
    const isWithinTolerance = absVariance <= tolerance;

    if (absVariance === 0) {
      return { variance: 0, status: 'balanced', isWithinTolerance: true };
    }
    if (variance > 0) {
      return { variance, status: 'surplus', isWithinTolerance };
    }
    return { variance, status: 'shortage', isWithinTolerance };
  },

  /**
   * صياغة رسالة الواتساب اليومية المنسقة للمالك
   *
   * كل المبالغ قادمة من الخادم بعملة المنشأة الأساسية (base_currency)، لذا تُعرض
   * برمز تلك العملة بدل تثبيت «ر.س» على منشآت تعمل بالريال اليمني.
   */
  formatWhatsAppSummary: (summary: DailyDrawerSummary, input: WhatsAppSummaryInput): string => {
    const { actualCash, actualCard, floatRetained, cashToOwner, shopName = 'المحل' } = input;
    const sym = currencySymbol(resolveSummaryCurrency(summary));
    const cashVariance = Math.round((actualCash - summary.expected_cash_in_drawer) * 100) / 100;
    const cardVariance = Math.round((actualCard - summary.expected_card_terminal) * 100) / 100;
    const otherSales = summary.other_sales ?? 0;
    const cardReceipts = summary.card_receipts ?? 0;

    let cashVarianceText = 'متطابق تماماً ✓ (0.00)';
    if (cashVariance > 0) {
      cashVarianceText = `زيادة +${cashVariance.toFixed(2)} ${sym} ⚠️`;
    } else if (cashVariance < 0) {
      cashVarianceText = `عجز ${cashVariance.toFixed(2)} ${sym} ❌`;
    }

    const employeeLines = (summary.employee_breakdown || [])
      .map(
        emp =>
          ` • ${emp.employee_name}: ${emp.total_sales.toFixed(2)} ${sym} (${emp.invoice_count} فاتورة)`
      )
      .join('\n');

    // تفصيل العملات — فقط عندما تكون الفواتير صادرة بأكثر من عملة (شفافية المبالغ الخام)
    const byCurrency = summary.sales_by_currency || [];
    const currencyLines =
      byCurrency.length > 1
        ? byCurrency
            .map(row => {
              const isBase = row.currency_code.toUpperCase() === resolveSummaryCurrency(summary);
              return isBase
                ? ` • ${row.currency_code}: ${row.raw_total.toFixed(2)} (${row.invoice_count} فاتورة)`
                : ` • ${row.currency_code}: ${row.raw_total.toFixed(2)} = ${row.base_total.toFixed(2)} ${sym}`;
            })
            .join('\n')
        : '';

    return [
      `📊 *إقفال يومية ${shopName}*`,
      `📅 *التاريخ:* ${summary.date}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `👥 *مبيعات الموظفين:*`,
      employeeLines || ' • لا توجد مبيعات مسجلة اليوم',
      currencyLines ? `--------------------\n💱 *تفصيل العملات:*\n${currencyLines}` : null,
      `--------------------`,
      `💰 *إجمالي مبيعات اليوم:* ${summary.total_sales.toFixed(2)} ${sym}`,
      `💳 *عمليات الشبكة (مدى):* ${summary.card_sales.toFixed(2)} ${sym} ${Math.abs(cardVariance) === 0 ? '[مطابق ✓]' : `[فارق: ${cardVariance.toFixed(2)}]`}`,
      `💵 *كاش المبيعات:* ${summary.cash_sales.toFixed(2)} ${sym}`,
      summary.transfer_sales > 0
        ? `🏦 *مبيعات تحويل بنكي:* ${summary.transfer_sales.toFixed(2)} ${sym}`
        : null,
      summary.credit_sales && summary.credit_sales > 0
        ? `📋 *مبيعات آجلة (ذمم):* ${summary.credit_sales.toFixed(2)} ${sym}`
        : null,
      otherSales > 0 ? `🧾 *مبيعات بطرق دفع أخرى:* ${otherSales.toFixed(2)} ${sym}` : null,
      summary.cash_receipts && summary.cash_receipts > 0
        ? `📥 *سندات قبض نقدية:* +${summary.cash_receipts.toFixed(2)} ${sym}`
        : null,
      summary.cash_disbursements && summary.cash_disbursements > 0
        ? `📤 *سندات صرف نقدية:* -${summary.cash_disbursements.toFixed(2)} ${sym}`
        : null,
      cardReceipts > 0 ? `🏧 *تحصيلات شبكة:* +${cardReceipts.toFixed(2)} ${sym}` : null,
      summary.returns_cash > 0
        ? `↩️ *مرتجع نقدي:* -${summary.returns_cash.toFixed(2)} ${sym}`
        : null,
      summary.returns_card > 0
        ? `↩️ *مرتجع شبكة:* -${summary.returns_card.toFixed(2)} ${sym}`
        : null,
      summary.petty_expenses_cash > 0
        ? `☕ *مصروفات من الدرج:* -${summary.petty_expenses_cash.toFixed(2)} ${sym}`
        : null,
      summary.opening_float > 0
        ? `🪙 *عهدة الفكة الافتتاحية:* +${summary.opening_float.toFixed(2)} ${sym}`
        : null,
      `--------------------`,
      `🎯 *الكاش المطلوب في الدرج:* ${summary.expected_cash_in_drawer.toFixed(2)} ${sym}`,
      `📥 *الكاش الفعلي الموجود:* ${actualCash.toFixed(2)} ${sym}`,
      `⚖️ *حالة الدرج:* ${cashVarianceText}`,
      `--------------------`,
      `🔒 *المتبقي بالدرج لبكرة (فكة):* ${floatRetained.toFixed(2)} ${sym}`,
      `💼 *الصافي المسلم للمالك:* ${cashToOwner.toFixed(2)} ${sym}`,
      `━━━━━━━━━━━━━━━━━━━━`,
      `تم الإقفال بنجاح عبر نظام الجعفري Smart ERP`,
    ]
      .filter(Boolean)
      .join('\n');
  },
};
