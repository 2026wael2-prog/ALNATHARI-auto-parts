import type { Dispatch, SetStateAction } from 'react';
import { formatCurrency } from '../../../core/utils';
import {
  currencySymbol,
  reconciliationService,
  resolveSummaryCurrency,
  resolveTolerance,
} from '../services/reconciliationService';
import type {
  CashDenominationCounts,
  CommitDailyReconciliationDTO,
  DailyDrawerSummary,
} from '../types';

export type CountMode = 'denominations' | 'quick';

export interface ReconciliationFormValues {
  countMode: CountMode;
  cashCounts: CashDenominationCounts;
  manualCashTotal: number;
  actualCard: number;
  cardTerminalRef: string;
  floatRetained: number;
  varianceReason: string;
  notes: string;
}

export interface ReconciliationFormApi {
  values: ReconciliationFormValues;
  setCountMode: Dispatch<SetStateAction<CountMode>>;
  setCashCounts: Dispatch<SetStateAction<CashDenominationCounts>>;
  setManualCashTotal: Dispatch<SetStateAction<number>>;
  setActualCard: Dispatch<SetStateAction<number>>;
  setCardTerminalRef: Dispatch<SetStateAction<string>>;
  setFloatRetained: Dispatch<SetStateAction<number>>;
  setVarianceReason: Dispatch<SetStateAction<string>>;
  setNotes: Dispatch<SetStateAction<string>>;
}

export interface ReconciliationView {
  currency: string;
  currencyLabel: string;
  actualCashCounted: number;
  expectedCash: number;
  cashVarianceInfo: ReturnType<typeof reconciliationService.calculateVariance>;
  salesByCurrency: NonNullable<DailyDrawerSummary['sales_by_currency']>;
  hasMixedCurrencySales: boolean;
  isAlreadyClosed: boolean;
  isOwner: boolean;
  isLocked: boolean;
  cashToOwner: number;
}
/**
 * مبرر الفارق إلزامي عند تجاوز حد التسامح: الخادم يرفض الإقفال بدونه (ERRCODE 22023)،
 * فنفرض نفس الشرط محلياً برسالة واضحة بدل رحلة ذهاب وإياب مرفوضة.
 */
export const resolveVarianceReasonBlocker = (
  isWithinTolerance: boolean,
  varianceReason: string
): string | null => {
  if (isWithinTolerance) return null;
  if (varianceReason.trim().length > 0) return null;
  return 'مبرر الفارق إلزامي: الفارق يتجاوز حد التسامح المسموح، اكتب السبب قبل اعتماد الإقفال';
};

/** نفس دلالة الشرط (truthy) في JS للأرقام، مع إرضاء strict-boolean-expressions. */
export const isTruthyNumber = (value: number | null | undefined): value is number =>
  value !== null && value !== undefined && value !== 0 && !Number.isNaN(value);

/** نفس دلالة الشرط (truthy) في JS للنصوص، مع إرضاء strict-boolean-expressions. */
export const isNonEmptyString = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== '';

/** بديل مطابق لدلالة `|| ''` على نص قد يكون null من الخادم. */
export const stringOrEmpty = (value: string | null | undefined): string => value ?? '';

/** بديل مطابق لدلالة `??` على رقم قد يكون null من الخادم (بدون شرط ميت). */
export const numberOr = (value: number | null | undefined, fallback: number): number =>
  value ?? fallback;

const countsOrEmpty = (counts: CashDenominationCounts | null | undefined): CashDenominationCounts =>
  counts ?? {};

/** اسم المنشأة المعروض، مع الاسم الافتراضي نفسه المستخدم سابقاً عند الفراغ. */
export const resolveShopName = (companyName: string | null | undefined): string =>
  isNonEmptyString(companyName) ? companyName : 'مؤسسة الجعفري';

export const buildZeroCashConfirmMessage = (currency: string): string =>
  `الكاش الفعلي المدخل هو ${formatCurrency(0, currency)}، هل أنت متأكد من المتابعة؟`;

export interface ExpectedCardSync {
  kind: 'expected-card';
  actualCard: number;
}

export interface ExistingReconciliationSync {
  kind: 'existing';
  cashCounts: CashDenominationCounts;
  manualCashTotal: number;
  countMode: CountMode;
  actualCard: number;
  floatRetained: number;
  varianceReason: string;
  notes: string;
}

export type SummarySyncPlan = ExistingReconciliationSync | ExpectedCardSync;

/** خطة مزامنة النموذج مع اليومية القائمة — دالة نقية خارج المكوّن لخفض التعقيد. */
export const planSummarySync = (
  summary: DailyDrawerSummary | null | undefined
): SummarySyncPlan | null => {
  const rec = summary?.existing_reconciliation;
  if (rec === null || rec === undefined) {
    if (summary === null || summary === undefined) return null;
    // Default initial actual card to expected card for convenience
    return { kind: 'expected-card', actualCard: summary.expected_card_terminal || 0 };
  }
  const denoms = countsOrEmpty(rec.cash_denominations);
  const counted = numberOr(
    rec.actual_cash_counted,
    reconciliationService.calculateDenominationsTotal(denoms)
  );
  return {
    kind: 'existing',
    cashCounts: denoms,
    manualCashTotal: counted,
    countMode: Object.keys(denoms).length > 0 ? 'denominations' : 'quick',
    actualCard: rec.card_terminal_receipt_total || 0,
    floatRetained: rec.float_retained_for_tomorrow || 300,
    varianceReason: stringOrEmpty(rec.variance_reason),
    notes: stringOrEmpty(rec.notes),
  };
};

interface SummaryScalars {
  expectedCash: number;
  salesByCurrency: NonNullable<DailyDrawerSummary['sales_by_currency']>;
  isAlreadyClosed: boolean;
  otherSales: number;
}

const deriveSummaryScalars = (summary: DailyDrawerSummary | undefined): SummaryScalars => ({
  expectedCash: summary?.expected_cash_in_drawer ?? 0,
  salesByCurrency: summary?.sales_by_currency ?? [],
  isAlreadyClosed: summary?.is_already_closed ?? false,
  otherSales: summary?.other_sales ?? 0,
});

/**
 * كل القيم المشتقّة المعروضة — دالة نقية خارج المكوّن (نفس ترتيب الحساب السابق).
 */
export const deriveReconciliationView = (
  summary: DailyDrawerSummary | undefined,
  form: ReconciliationFormValues,
  role: string | undefined
): ReconciliationView => {
  const { expectedCash, salesByCurrency, isAlreadyClosed, otherSales } =
    deriveSummaryScalars(summary);
  const currency = summary ? resolveSummaryCurrency(summary) : 'SAR';
  const currencyLabel = currencySymbol(currency);
  const denomCalculatedTotal = reconciliationService.calculateDenominationsTotal(form.cashCounts);
  const actualCashCounted =
    form.countMode === 'denominations' ? denomCalculatedTotal : form.manualCashTotal;
  const cashVarianceInfo = reconciliationService.calculateVariance(
    actualCashCounted,
    expectedCash,
    resolveTolerance(summary)
  );
  const hasMixedCurrencySales =
    salesByCurrency.some(row => row.currency_code.toUpperCase() !== currency) || otherSales > 0;
  const isOwner = role === 'owner';
  const isLocked = isAlreadyClosed && !isOwner;
  const cashToOwner = Math.max(0, Math.round((actualCashCounted - form.floatRetained) * 100) / 100);

  return {
    currency,
    currencyLabel,
    actualCashCounted,
    expectedCash,
    cashVarianceInfo,
    salesByCurrency,
    hasMixedCurrencySales,
    isAlreadyClosed,
    isOwner,
    isLocked,
    cashToOwner,
  };
};

export interface CommitPayloadInput {
  branchId: string | null | undefined;
  summary: DailyDrawerSummary | undefined;
  actualCashCounted: number;
  countMode: CountMode;
  cashCounts: CashDenominationCounts;
  actualCard: number;
  floatRetained: number;
  cashToOwner: number;
  varianceReason: string;
  notes: string;
}

export const buildCommitPayload = (
  companyId: string,
  date: string,
  input: CommitPayloadInput
): CommitDailyReconciliationDTO => ({
  company_id: companyId,
  date,
  branch_id: input.branchId,
  opening_float: input.summary?.opening_float ?? 0,
  actual_cash_counted: input.actualCashCounted,
  cash_denominations: input.countMode === 'denominations' ? input.cashCounts : {},
  card_terminal_receipt_total: input.actualCard,
  float_retained_for_tomorrow: input.floatRetained,
  cash_handed_to_owner: input.cashToOwner,
  variance_reason: input.varianceReason,
  notes: input.notes,
});

export interface ReconciliationModalsApi {
  isExpenseModalOpen: boolean;
  isPrintModalOpen: boolean;
  isHistoryModalOpen: boolean;
  openExpenseModal: () => void;
  closeExpenseModal: () => void;
  openPrintModal: () => void;
  closePrintModal: () => void;
  openHistoryModal: () => void;
  closeHistoryModal: () => void;
}

export type VarianceStatus = ReturnType<typeof reconciliationService.calculateVariance>['status'];

/** إطار بطاقة التسوية النهائية حسب حالة الفارق (نفس الأصناف السابقة حرفياً). */
export const resolveSettlementBannerTone = (status: VarianceStatus): string => {
  if (status === 'balanced') return 'border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/20';
  if (status === 'surplus') return 'border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20';
  return 'border-red-500/30 bg-red-500/5 dark:bg-red-950/20';
};

/** خلفية أيقونة حالة الفارق حسب الحالة (نفس الأصناف السابقة حرفياً). */
export const resolveSettlementIconTone = (status: VarianceStatus): string => {
  if (status === 'balanced') return 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400';
  if (status === 'surplus') return 'bg-amber-500/20 text-amber-700 dark:text-amber-400';
  return 'bg-red-500/20 text-red-600 dark:text-red-400';
};

/** عنوان حالة الدرج بنفس النصوص والتنسيق السابق. */
export const resolveSettlementHeadline = (
  status: VarianceStatus,
  variance: number,
  currency: string
): string => {
  if (status === 'balanced') return 'الدرج متطابق تماماً بنسبة 100%';
  if (status === 'surplus') return `يوجد فائض بالدرج (+${formatCurrency(variance, currency)})`;
  return `يوجد عجز بالدرج (${formatCurrency(variance, currency)})`;
};
