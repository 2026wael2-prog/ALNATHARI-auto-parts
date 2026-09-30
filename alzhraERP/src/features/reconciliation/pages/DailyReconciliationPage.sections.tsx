import React from 'react';
import {
  Scale,
  Calendar,
  Lock,
  Unlock,
  CheckCircle2,
  AlertTriangle,
  Coffee,
  Printer,
  History,
  Check,
  Loader2,
  Coins,
  CreditCard,
  Banknote,
  MinusCircle,
  PlusCircle,
  Calculator,
} from 'lucide-react';
import { formatCurrency } from '../../../core/utils';
import Button from '../../../ui/base/Button';
import type { DailyDrawerSummary, ExistingReconciliationRecord } from '../types';
import { DenominationTouchCounter } from '../components/DenominationTouchCounter';
import { EmployeeSalesBreakdownCard } from '../components/EmployeeSalesBreakdownCard';
import { QuickDrawerExpenseModal } from '../components/QuickDrawerExpenseModal';
import { CashDropAndFloatCard } from '../components/CashDropAndFloatCard';
import { WhatsAppShareButton } from '../components/WhatsAppShareButton';
import { ReconciliationPrintModal } from '../components/ReconciliationPrintModal';
import { CardTerminalInputCard } from '../components/CardTerminalInputCard';
import { ReconciliationHistoryModal } from '../components/ReconciliationHistoryModal';
import type {
  ReconciliationFormApi,
  ReconciliationModalsApi,
  ReconciliationView,
} from './DailyReconciliationPage.helpers';
import type { ReconciliationPageController } from './useReconciliationPageController';
import {
  isNonEmptyString,
  isTruthyNumber,
  numberOr,
  resolveSettlementBannerTone,
  resolveSettlementHeadline,
  resolveSettlementIconTone,
} from './DailyReconciliationPage.helpers';

interface BrandProps {
  isAlreadyClosed: boolean;
  branchName: string | null | undefined;
}

const ReconciliationBrand: React.FC<BrandProps> = ({ isAlreadyClosed, branchName }) => (
  <div className="flex items-center gap-3">
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg)] text-emerald-600 shadow-sm dark:text-emerald-400">
      <Scale className="h-6 w-6" />
    </div>
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-black text-[var(--app-text)] sm:text-xl">
          المطابقة اليومية وإقفال الصندوق
        </h1>
        {isAlreadyClosed ? (
          <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <Lock className="h-3 w-3" />
            مقفلة ومعتمدة
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-700 dark:text-amber-400">
            <Unlock className="h-3 w-3" />
            يومية نشطة
          </span>
        )}
      </div>
      <p className="text-xs text-[var(--app-text-secondary)]">
        جرد درج النقدية، مطابقة تقرير ماكينة الشبكة، وتوريد الصافي للخزينة
        {isNonEmptyString(branchName) ? ` • ${branchName}` : ''}
      </p>
    </div>
  </div>
);

interface DateAndToolsProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
  onOpenExpenseModal: () => void;
  onOpenHistoryModal: () => void;
}

const ReconciliationDateAndTools: React.FC<DateAndToolsProps> = ({
  selectedDate,
  onDateChange,
  onOpenExpenseModal,
  onOpenHistoryModal,
}) => (
  <>
    {/* Date Selector */}
    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-card-bg)] px-2.5 py-1.5 shadow-sm">
      <Calendar className="h-4 w-4 text-[var(--app-text-secondary)]" />
      <input
        type="date"
        value={selectedDate}
        onChange={e => {
          onDateChange(e.target.value);
        }}
        className="bg-transparent text-xs font-bold text-[var(--app-text)] focus:outline-none"
      />
    </div>

    <Button
      type="button"
      variant="secondary"
      onClick={onOpenExpenseModal}
      className="gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400"
    >
      <Coffee className="h-4 w-4 text-amber-500" />
      <span>مصروف درج</span>
    </Button>

    <Button
      type="button"
      variant="secondary"
      onClick={onOpenHistoryModal}
      className="gap-1.5 text-xs font-bold"
    >
      <History className="h-4 w-4" />
      <span>سجل الأيام السابقة</span>
    </Button>
  </>
);

interface ActionBarProps {
  modals: ReconciliationModalsApi;
  selectedDate: string;
  onDateChange: (date: string) => void;
  view: ReconciliationView;
  form: ReconciliationFormApi;
  summary: DailyDrawerSummary | undefined;
  shopName: string;
}

const ReconciliationActionBar: React.FC<ActionBarProps> = ({
  modals,
  selectedDate,
  onDateChange,
  view,
  form,
  summary,
  shopName,
}) => (
  <div className="flex flex-wrap items-center gap-2">
    <ReconciliationDateAndTools
      selectedDate={selectedDate}
      onDateChange={onDateChange}
      onOpenExpenseModal={modals.openExpenseModal}
      onOpenHistoryModal={modals.openHistoryModal}
    />

    {summary && (
      <>
        <Button
          type="button"
          variant="secondary"
          onClick={modals.openPrintModal}
          className="gap-1.5 text-xs font-bold"
        >
          <Printer className="h-4 w-4" />
          <span>طباعة الإيصال</span>
        </Button>

        <WhatsAppShareButton
          summary={summary}
          actualCash={view.actualCashCounted}
          actualCard={form.values.actualCard}
          floatRetained={form.values.floatRetained}
          cashToOwner={view.cashToOwner}
          shopName={shopName}
        />
      </>
    )}
  </div>
);

interface TopBarProps extends ActionBarProps {
  isAlreadyClosed: boolean;
  branchName: string | null | undefined;
}

export const ReconciliationTopBar: React.FC<TopBarProps> = ({
  isAlreadyClosed,
  branchName,
  ...actionBar
}) => (
  <div className="flex flex-col gap-4 border-b border-[var(--app-border)] pb-4 sm:flex-row sm:items-center sm:justify-between">
    <ReconciliationBrand isAlreadyClosed={isAlreadyClosed} branchName={branchName} />
    <ReconciliationActionBar {...actionBar} />
  </div>
);

interface CompanyScopeBannerProps {
  summary: DailyDrawerSummary | undefined;
}

export const CompanyScopeBanner: React.FC<CompanyScopeBannerProps> = ({ summary }) => {
  const isCompanyScope = summary?.scope_is_company ?? false;
  const branchCount = summary?.company_branch_count ?? 0;
  if (!isCompanyScope || branchCount <= 1) return null;

  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-800 dark:text-blue-300">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
      <div>
        <p className="font-bold">
          هذه المطابقة تُجمّع حركات {branchCount} فروع في درج واحد (نطاق المنشأة كاملة)
        </p>
        <p className="mt-0.5">
          لم يتم اختيار فرع محدد، لذا دخلت كاشيريات جميع الفروع في نفس الرصيد المتوقع. إن كنت تُطابق
          درج فرع واحد فاختر الفرع من منتقي الفروع قبل الجرد.
        </p>
      </div>
    </div>
  );
};

export const ReconciliationLoadingCard: React.FC = () => (
  <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg)] text-[var(--app-text-secondary)]">
    <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
    <p className="text-xs font-semibold">جاري جرد الصندوق وتجميع مبيعات اليومية...</p>
  </div>
);

interface ErrorCardProps {
  onRetry: () => void;
}

export const ReconciliationErrorCard: React.FC<ErrorCardProps> = ({ onRetry }) => (
  <div className="flex h-44 flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
    <AlertTriangle className="h-6 w-6 text-red-500" />
    <p className="text-xs font-bold">تعذر استرجاع بيانات الصندوق لليوم المحدد</p>
    <Button variant="ghost" onClick={onRetry} className="text-xs">
      إعادة المحاولة
    </Button>
  </div>
);

interface LedgerMetricProps {
  summary: DailyDrawerSummary;
  currency: string;
}

const OpeningFloatMetric: React.FC<LedgerMetricProps> = ({ summary, currency }) => (
  <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5">
    <div className="flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
      <span>عهدة بداية الصباح</span>
      <Coins className="h-3.5 w-3.5 text-indigo-500" />
    </div>
    <div className="mt-1 text-sm font-black text-indigo-600 dark:text-indigo-400">
      {formatCurrency(summary.opening_float, currency)}
    </div>
    <span className="text-[10px] text-[var(--app-text-secondary)]">فكة مرحلة من الأمس</span>
  </div>
);

const CashInflowMetric: React.FC<LedgerMetricProps> = ({ summary, currency }) => (
  <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5">
    <div className="flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
      <span>+ مقبوضات الكاش</span>
      <PlusCircle className="h-3.5 w-3.5 text-emerald-500" />
    </div>
    <div className="mt-1 text-sm font-black text-emerald-600 dark:text-emerald-400">
      {formatCurrency(summary.cash_sales + numberOr(summary.cash_receipts, 0), currency)}
    </div>
    <span className="text-[10px] text-[var(--app-text-secondary)]">
      {isTruthyNumber(summary.cash_receipts)
        ? `مبيعات + قبض (${formatCurrency(summary.cash_receipts, currency)})`
        : 'مبيعات نقدية'}
    </span>
  </div>
);

const CashOutflowMetric: React.FC<LedgerMetricProps> = ({ summary, currency }) => (
  <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5">
    <div className="flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
      <span>- مصروفات الدرج</span>
      <MinusCircle className="h-3.5 w-3.5 text-amber-500" />
    </div>
    <div className="mt-1 text-sm font-black text-amber-600 dark:text-amber-400">
      {formatCurrency(
        summary.petty_expenses_cash + numberOr(summary.cash_disbursements, 0),
        currency
      )}
    </div>
    <span className="text-[10px] text-[var(--app-text-secondary)]">نثريات مخصومة</span>
  </div>
);

const CardSalesMetric: React.FC<LedgerMetricProps> = ({ summary, currency }) => (
  <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-2.5">
    <div className="flex items-center justify-between text-[11px] text-[var(--app-text-secondary)]">
      <span>مبيعات الشبكة (مدى)</span>
      <CreditCard className="h-3.5 w-3.5 text-cyan-500" />
    </div>
    <div className="mt-1 text-sm font-black text-cyan-600 dark:text-cyan-400">
      {formatCurrency(summary.card_sales, currency)}
    </div>
    <span className="text-[10px] text-[var(--app-text-secondary)]">إيداع بنكي مباشر</span>
  </div>
);

interface ExpectedDrawerMetricProps {
  expectedCash: number;
  currency: string;
}

const ExpectedDrawerMetric: React.FC<ExpectedDrawerMetricProps> = ({ expectedCash, currency }) => (
  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5 dark:bg-emerald-950/20">
    <div className="flex items-center justify-between text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
      <span>= المتوقع بالدرج</span>
      <Banknote className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
    </div>
    <div className="mt-1 text-base font-black text-emerald-600 dark:text-emerald-400">
      {formatCurrency(expectedCash, currency)}
    </div>
    <span className="text-[10px] text-[var(--app-text-secondary)]">الرصيد الدفتري المطلوب</span>
  </div>
);

interface LedgerGridProps {
  summary: DailyDrawerSummary;
  currency: string;
  expectedCash: number;
}

const LedgerFlowGrid: React.FC<LedgerGridProps> = ({ summary, currency, expectedCash }) => (
  <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-3 lg:grid-cols-5">
    <OpeningFloatMetric summary={summary} currency={currency} />
    <CashInflowMetric summary={summary} currency={currency} />
    <CashOutflowMetric summary={summary} currency={currency} />
    <CardSalesMetric summary={summary} currency={currency} />
    <ExpectedDrawerMetric expectedCash={expectedCash} currency={currency} />
  </div>
);

const DrawerLedgerCard: React.FC<LedgerGridProps> = ({ summary, currency, expectedCash }) => (
  <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg)] p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between border-b border-[var(--app-border)] pb-2.5">
      <div className="flex items-center gap-2">
        <Calculator className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-xs font-black text-[var(--app-text)]">
          الحالة الدفترية للصندوق (معادلة الدرج المحاسبية)
        </h3>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-[var(--app-text-secondary)]">إجمالي المبيعات الشامل:</span>
        <span className="font-black text-[var(--app-text)]">
          {formatCurrency(summary.total_sales, currency)}
        </span>
      </div>
    </div>

    {/* Arithmetic Flow Breakdown */}
    <LedgerFlowGrid summary={summary} currency={currency} expectedCash={expectedCash} />
  </div>
);

interface MixedCurrencyProps {
  summary: DailyDrawerSummary;
  currency: string;
  currencyLabel: string;
  salesByCurrency: NonNullable<DailyDrawerSummary['sales_by_currency']>;
}

const MixedCurrencyBreakdown: React.FC<MixedCurrencyProps> = ({
  summary,
  currency,
  currencyLabel,
  salesByCurrency,
}) => (
  <div className="mt-3 border-t border-[var(--app-border)] pt-3">
    <div className="mb-2 flex items-center gap-2">
      <Coins className="h-3.5 w-3.5 text-blue-500" />
      <h4 className="text-xs font-bold text-[var(--app-text)]">
        المبيعات حسب عملة الفاتورة (المجاميع محوّلة إلى {currencyLabel} سعر اليوم)
      </h4>
    </div>
    <div className="flex flex-wrap gap-2">
      {salesByCurrency.map(row => (
        <div
          key={row.currency_code}
          className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2.5 py-1.5 text-[11px]"
        >
          <span className="font-black text-[var(--app-text)]">
            {formatCurrency(row.base_total, currency)}
          </span>
          <span className="mx-1 text-[var(--app-text-secondary)]">•</span>
          <span className="text-[var(--app-text-secondary)]">
            {row.invoice_count} فاتورة بعملة {row.currency_code} (
            {formatCurrency(row.raw_total, row.currency_code)})
          </span>
        </div>
      ))}
      {(summary.other_sales ?? 0) > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
          مبيعات بطرق دفع غير مصنّفة: {formatCurrency(summary.other_sales ?? 0, currency)}
        </div>
      )}
    </div>
  </div>
);

interface PhysicalCountProps {
  summary: DailyDrawerSummary;
  form: ReconciliationFormApi;
  view: ReconciliationView;
}

const PhysicalCountSection: React.FC<PhysicalCountProps> = ({ summary, form, view }) => (
  <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
    {/* Cash Counter (7 Cols) */}
    <div className="lg:col-span-7">
      <DenominationTouchCounter
        counts={form.values.cashCounts}
        onChange={form.setCashCounts}
        manualTotal={form.values.manualCashTotal}
        onManualTotalChange={form.setManualCashTotal}
        countMode={form.values.countMode}
        onCountModeChange={form.setCountMode}
        currency={view.currency}
        disabled={view.isLocked}
      />
    </div>

    {/* Terminal Input + Float Retained (5 Cols) */}
    <div className="flex flex-col gap-4 lg:col-span-5">
      <CardTerminalInputCard
        expectedCard={summary.expected_card_terminal}
        actualCard={form.values.actualCard}
        onActualCardChange={form.setActualCard}
        terminalRef={form.values.cardTerminalRef}
        onTerminalRefChange={form.setCardTerminalRef}
        currency={view.currency}
        disabled={view.isLocked}
      />

      <CashDropAndFloatCard
        actualCash={view.actualCashCounted}
        floatRetained={form.values.floatRetained}
        onFloatRetainedChange={form.setFloatRetained}
        cashToOwner={view.cashToOwner}
        currency={view.currency}
        disabled={view.isLocked}
      />
    </div>
  </div>
);

interface VarianceReasonFieldProps {
  isWithinTolerance: boolean;
  isLocked: boolean;
  varianceReason: string;
  onVarianceReasonChange: (value: string) => void;
}

const VarianceReasonField: React.FC<VarianceReasonFieldProps> = ({
  isWithinTolerance,
  isLocked,
  varianceReason,
  onVarianceReasonChange,
}) => {
  if (isWithinTolerance) return null;

  return (
    <div className="mt-3 border-t border-[var(--app-border)] pt-3">
      <label
        htmlFor="reconciliation-variance-reason"
        className="mb-1 block text-xs font-bold text-[var(--app-text)]"
      >
        مبرر وسبب الفارق (مطلوب في حال العجز أو الزيادة الكبيرة):
      </label>
      <input
        id="reconciliation-variance-reason"
        type="text"
        disabled={isLocked}
        value={varianceReason}
        onChange={e => {
          onVarianceReasonChange(e.target.value);
        }}
        placeholder="اكتب توضيحاً للسبب (مثال: نسيان تسجيل فاتورة فلان، أو فرق فكة زبون)"
        className="h-9 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-card-bg)] px-3 text-xs text-[var(--app-text)] focus:border-red-500 focus:outline-none"
      />
    </div>
  );
};

interface CommitActionPanelProps {
  isAlreadyClosed: boolean;
  isOwner: boolean;
  isCommitting: boolean;
  onCommit: () => void;
}

const CommitActionPanel: React.FC<CommitActionPanelProps> = ({
  isAlreadyClosed,
  isOwner,
  isCommitting,
  onCommit,
}) => (
  <div>
    {isAlreadyClosed ? (
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
          ✓ تم إقفال هذا اليوم بنجاح
        </span>
        {isOwner && (
          <Button
            type="button"
            variant="secondary"
            onClick={onCommit}
            disabled={isCommitting}
            className="text-xs font-bold"
          >
            {isCommitting ? 'جاري التحديث...' : 'تحديث الاعتماد (المالك)'}
          </Button>
        )}
      </div>
    ) : (
      <Button
        type="button"
        variant="primary"
        onClick={onCommit}
        disabled={isCommitting}
        className="h-10 bg-emerald-600 px-5 text-xs font-bold text-white shadow-sm hover:bg-emerald-700"
      >
        {isCommitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            جاري الإقفال والقفل...
          </>
        ) : (
          <>
            <Check className="mr-2 h-4 w-4" />
            اعتماد وإقفال يومية المحل
          </>
        )}
      </Button>
    )}
  </div>
);

interface VarianceStatusSummaryProps {
  view: ReconciliationView;
}

const VarianceStatusSummary: React.FC<VarianceStatusSummaryProps> = ({ view }) => {
  const { cashVarianceInfo } = view;

  return (
    <div className="flex items-start gap-3">
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${resolveSettlementIconTone(cashVarianceInfo.status)}`}
      >
        {cashVarianceInfo.status === 'balanced' ? (
          <CheckCircle2 className="h-6 w-6" />
        ) : (
          <AlertTriangle className="h-6 w-6" />
        )}
      </div>

      <div>
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold text-[var(--app-text)]">
            {resolveSettlementHeadline(
              cashVarianceInfo.status,
              cashVarianceInfo.variance,
              view.currency
            )}
          </h4>
          {cashVarianceInfo.isWithinTolerance && cashVarianceInfo.status !== 'balanced' && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
              ضمن حد التسامح (فكة مقبولة)
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-[var(--app-text-secondary)]">
          المتوقع بالدرج:{' '}
          <strong className="text-[var(--app-text)]">
            {formatCurrency(view.expectedCash, view.currency)}
          </strong>{' '}
          | الكاش الفعلي المعدود:{' '}
          <strong className="text-[var(--app-text)]">
            {formatCurrency(view.actualCashCounted, view.currency)}
          </strong>{' '}
          | الصافي للمالك:{' '}
          <strong className="text-emerald-600 dark:text-emerald-400">
            {formatCurrency(view.cashToOwner, view.currency)}
          </strong>
        </p>
      </div>
    </div>
  );
};

interface SettlementBannerProps {
  view: ReconciliationView;
  form: ReconciliationFormApi;
  isCommitting: boolean;
  onCommit: () => void;
}

const SettlementBanner: React.FC<SettlementBannerProps> = ({
  view,
  form,
  isCommitting,
  onCommit,
}) => (
  <div
    className={`rounded-xl border p-4 shadow-sm transition-colors ${resolveSettlementBannerTone(view.cashVarianceInfo.status)}`}
  >
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <VarianceStatusSummary view={view} />

      {/* Commit Action Button */}
      <CommitActionPanel
        isAlreadyClosed={view.isAlreadyClosed}
        isOwner={view.isOwner}
        isCommitting={isCommitting}
        onCommit={onCommit}
      />
    </div>

    {/* Explanation / Notes if variance exists */}
    <VarianceReasonField
      isWithinTolerance={view.cashVarianceInfo.isWithinTolerance}
      isLocked={view.isLocked}
      varianceReason={form.values.varianceReason}
      onVarianceReasonChange={form.setVarianceReason}
    />
  </div>
);

interface DailySectionsProps {
  summary: DailyDrawerSummary;
  view: ReconciliationView;
  form: ReconciliationFormApi;
  isCommitting: boolean;
  onCommit: () => void;
}

export const ReconciliationDailySections: React.FC<DailySectionsProps> = ({
  summary,
  view,
  form,
  isCommitting,
  onCommit,
}) => (
  <>
    <DrawerLedgerCard summary={summary} currency={view.currency} expectedCash={view.expectedCash} />

    {/* تفصيل المبيعات حسب عملة الفاتورة — يمنع تكرار خلط العملات بلا تحويل */}
    {view.hasMixedCurrencySales && (
      <MixedCurrencyBreakdown
        summary={summary}
        currency={view.currency}
        currencyLabel={view.currencyLabel}
        salesByCurrency={view.salesByCurrency}
      />
    )}

    {/* Phase 2: Physical Count (Cash Counter + Card Terminal) */}
    <PhysicalCountSection summary={summary} form={form} view={view} />

    {/* Phase 3: Final Settlement Banner & Drawer Lock Action */}
    <SettlementBanner view={view} form={form} isCommitting={isCommitting} onCommit={onCommit} />

    {/* Phase 4: Collapsible Employee Breakdown */}
    <EmployeeSalesBreakdownCard
      breakdown={summary.employee_breakdown}
      totalSales={summary.total_sales}
      currency={view.currency}
      defaultExpanded={false}
    />
  </>
);

interface ModalsProps {
  modals: ReconciliationModalsApi;
  form: ReconciliationFormApi;
  view: ReconciliationView;
  summary: DailyDrawerSummary | undefined;
  historyList: ExistingReconciliationRecord[] | undefined;
  isHistoryLoading: boolean;
  selectedDate: string;
  shopName: string;
  onDateChange: (date: string) => void;
}

export const ReconciliationModals: React.FC<ModalsProps> = ({
  modals,
  form,
  view,
  summary,
  historyList,
  isHistoryLoading,
  selectedDate,
  shopName,
  onDateChange,
}) => (
  <>
    <QuickDrawerExpenseModal
      isOpen={modals.isExpenseModalOpen}
      onClose={modals.closeExpenseModal}
      selectedDate={selectedDate}
      baseCurrency={view.currency}
      lastExpenseCurrency={summary?.last_petty_expense_currency ?? null}
    />

    {summary && (
      <ReconciliationPrintModal
        isOpen={modals.isPrintModalOpen}
        onClose={modals.closePrintModal}
        summary={summary}
        actualCash={view.actualCashCounted}
        actualCard={form.values.actualCard}
        floatRetained={form.values.floatRetained}
        cashToOwner={view.cashToOwner}
        shopName={shopName}
      />
    )}

    <ReconciliationHistoryModal
      isOpen={modals.isHistoryModalOpen}
      onClose={modals.closeHistoryModal}
      onSelectDate={date => {
        onDateChange(date);
      }}
      historyList={historyList}
      isLoading={isHistoryLoading}
      currency={view.currency}
    />
  </>
);

interface PageLayoutProps {
  page: ReconciliationPageController;
}

export const ReconciliationPageLayout: React.FC<PageLayoutProps> = ({ page }) => (
  <div className="mx-auto max-w-7xl space-y-5 p-4 sm:p-6">
    <ReconciliationTopBar
      summary={page.summary}
      view={page.view}
      form={page.form}
      modals={page.modals}
      selectedDate={page.selectedDate}
      onDateChange={page.onDateChange}
      isAlreadyClosed={page.view.isAlreadyClosed}
      branchName={page.branchName}
      shopName={page.shopName}
    />
    <CompanyScopeBanner summary={page.summary} />

    {page.isLoading ? (
      <ReconciliationLoadingCard />
    ) : page.isError ? (
      <ReconciliationErrorCard onRetry={page.handleRetry} />
    ) : page.summary ? (
      <ReconciliationDailySections
        summary={page.summary}
        view={page.view}
        form={page.form}
        isCommitting={page.isCommitting}
        onCommit={page.handleCommit}
      />
    ) : null}

    <ReconciliationModals
      modals={page.modals}
      form={page.form}
      view={page.view}
      summary={page.summary}
      historyList={page.historyList}
      isHistoryLoading={page.isHistoryLoading}
      selectedDate={page.selectedDate}
      shopName={page.shopName}
      onDateChange={page.onDateChange}
    />
  </div>
);
