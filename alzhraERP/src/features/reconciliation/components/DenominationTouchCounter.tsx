import React, { useId } from 'react';
import { Banknote, RotateCcw, Calculator, Hash } from 'lucide-react';
import {
  reconciliationService,
  getDenominationsFor,
  currencySymbol,
  getDenominationCount,
} from '../services/reconciliationService';
import { formatCurrency } from '../../../core/utils';
import type { CashDenominationCounts } from '../types';

interface DenominationTouchCounterProps {
  counts: CashDenominationCounts;
  onChange: (counts: CashDenominationCounts) => void;
  manualTotal: number;
  onManualTotalChange: (val: number) => void;
  countMode: 'denominations' | 'quick';
  onCountModeChange: (mode: 'denominations' | 'quick') => void;
  currency?: string | undefined;
  disabled?: boolean | undefined;
}

interface ModeButtonProps {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

/** زر واحد لاختيار طريقة الجرد */
const ModeButton: React.FC<ModeButtonProps> = ({ active, icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${
      active
        ? 'bg-[var(--app-card-bg)] font-bold text-emerald-600 shadow-sm dark:text-emerald-400'
        : 'text-[var(--app-text-secondary)] hover:text-[var(--app-text)]'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

/** زر تصفير كل عدّادات الفئات */
const ResetCountButton: React.FC<{ onReset: () => void }> = ({ onReset }) => (
  <button
    type="button"
    onClick={onReset}
    title="تصفير الجرد"
    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--app-border)] text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-hover)] hover:text-red-500"
  >
    <RotateCcw className="h-4 w-4" />
  </button>
);

interface CounterHeaderProps {
  countMode: 'denominations' | 'quick';
  disabled: boolean;
  onModeChange: (mode: 'denominations' | 'quick') => void;
  onReset: () => void;
}

/** مبدّل طريقة الجرد: إدخال إجمالي سريع أو تفقيط تفصيلي للفئات */
const CounterModeToggle: React.FC<CounterHeaderProps> = ({
  countMode,
  disabled,
  onModeChange,
  onReset,
}) => (
  <div className="flex items-center gap-2 self-start sm:self-auto">
    <div className="flex rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-0.5 text-xs font-semibold">
      <ModeButton
        active={countMode === 'quick'}
        icon={<Hash className="h-3.5 w-3.5" />}
        label="إدخال إجمالي سريع"
        onClick={() => {
          onModeChange('quick');
        }}
      />
      <ModeButton
        active={countMode === 'denominations'}
        icon={<Calculator className="h-3.5 w-3.5" />}
        label="تفقيط الفئات والأوراق"
        onClick={() => {
          onModeChange('denominations');
        }}
      />
    </div>

    {!disabled && <ResetCountButton onReset={onReset} />}
  </div>
);

interface CashTotalIndicatorProps {
  label: string;
  total: number;
  currency: string;
}

/** شريط إجمالي النقد المعتمد للجرد (سريع أو محسوب من الفئات) */
const CashTotalIndicator: React.FC<CashTotalIndicatorProps> = ({ label, total, currency }) => (
  <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
    <span className="font-semibold">{label}</span>
    <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
      {formatCurrency(total, currency)}
    </span>
  </div>
);

/** رأس بطاقة الجرد مع مبدّل طريقة العد وزر التصفير */
const CounterHeader: React.FC<CounterHeaderProps> = ({
  countMode,
  disabled,
  onModeChange,
  onReset,
}) => (
  <div className="mb-4 flex flex-col gap-3 border-b border-[var(--app-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="flex items-center gap-2.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <Banknote className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-sm font-bold text-[var(--app-text)]">جرد الكاش والنقدية بالدرج</h3>
        <p className="text-[11px] text-[var(--app-text-secondary)]">
          اختر طريقة الجرد: إدخال سريع للمجموع أو تفقيط تفصيلي للفئات
        </p>
      </div>
    </div>

    <CounterModeToggle
      countMode={countMode}
      disabled={disabled}
      onModeChange={onModeChange}
      onReset={onReset}
    />
  </div>
);

interface QuickTotalInputProps {
  manualTotal: number;
  currency: string;
  disabled: boolean;
  activeTotal: number;
  onManualTotalChange: (val: number) => void;
}

/** الإدخال السريع لإجمالي الكاش المعدود بدون تفقيط الفئات */
const QuickTotalInput: React.FC<QuickTotalInputProps> = ({
  manualTotal,
  currency,
  disabled,
  activeTotal,
  onManualTotalChange,
}) => {
  const inputId = useId();
  return (
    <div className="space-y-3 py-2">
      <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-4">
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-bold text-[var(--app-text)]">
          إجمالي الكاش الفعلي المعدود بالدرج:
        </label>
        <div className="relative">
          <input
            id={inputId}
            type="number"
            step="any"
            min="0"
            disabled={disabled}
            value={manualTotal === 0 ? '' : manualTotal}
            onChange={e => {
              const val = parseFloat(e.target.value) || 0;
              onManualTotalChange(val);
            }}
            placeholder="0.00"
            className="h-12 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-card-bg)] px-4 text-xl font-black text-[var(--app-text)] focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--app-text-secondary)]">
            {currencySymbol(currency)}
          </span>
        </div>
        <p className="mt-2 text-[11px] text-[var(--app-text-secondary)]">
          أدخل القيمة الإجمالية مباشرة إذا تم عد الكاش عبر آلة عد النقود أو تم فرزه مسبقاً.
        </p>
      </div>

      <CashTotalIndicator
        label="الكاش الفعلي المعتمد للجرد:"
        total={activeTotal}
        currency={currency}
      />
    </div>
  );
};

interface DenominationStepperProps {
  count: number;
  disabled: boolean;
  onCountChange: (count: number) => void;
  onStep: (delta: number) => void;
}

/** أزرار الزيادة والنقصان مع حقل إدخال عدد الفئة */
const DenominationStepper: React.FC<DenominationStepperProps> = ({
  count,
  disabled,
  onCountChange,
  onStep,
}) => (
  <div className="mt-2 flex items-center gap-1">
    {!disabled && (
      <button
        type="button"
        onClick={() => {
          onStep(-1);
        }}
        disabled={count === 0}
        className="flex h-7 w-7 items-center justify-center rounded bg-[var(--app-card-bg)] text-xs font-bold text-[var(--app-text)] shadow-sm hover:bg-[var(--app-hover)] disabled:opacity-40"
      >
        -
      </button>
    )}

    <input
      type="number"
      min="0"
      disabled={disabled}
      value={count === 0 ? '' : count}
      onChange={e => {
        onCountChange(parseInt(e.target.value, 10) || 0);
      }}
      placeholder="0"
      className="h-7 w-full rounded border border-[var(--app-border)] bg-[var(--app-card-bg)] text-center text-xs font-bold text-[var(--app-text)] focus:border-emerald-500 focus:outline-none"
    />

    {!disabled && (
      <button
        type="button"
        onClick={() => {
          onStep(1);
        }}
        className="flex h-7 w-7 items-center justify-center rounded bg-[var(--app-card-bg)] text-xs font-bold text-[var(--app-text)] shadow-sm hover:bg-[var(--app-hover)]"
      >
        +
      </button>
    )}
  </div>
);

interface DenominationCellProps {
  label: string;
  subtotal: number;
  count: number;
  disabled: boolean;
  currency: string;
  onCountChange: (count: number) => void;
  onStep: (delta: number) => void;
}

/** خلية فئة واحدة: القيمة الإجمالية وعدّاد القطع */
const DenominationCell: React.FC<DenominationCellProps> = ({
  label,
  subtotal,
  count,
  disabled,
  currency,
  onCountChange,
  onStep,
}) => (
  <div
    className={`flex flex-col justify-between rounded-lg border p-2.5 transition-all ${
      count > 0
        ? 'border-emerald-500/40 bg-emerald-500/5 dark:bg-emerald-950/20'
        : 'border-[var(--app-border)] bg-[var(--app-bg)]'
    }`}
  >
    <div className="flex items-center justify-between">
      <span className="text-xs font-bold text-[var(--app-text)]">{label}</span>
      <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
        {subtotal > 0 ? formatCurrency(subtotal, currency) : '-'}
      </span>
    </div>

    <DenominationStepper
      count={count}
      disabled={disabled}
      onCountChange={onCountChange}
      onStep={onStep}
    />
  </div>
);

interface DenominationGridProps {
  denominations: ReturnType<typeof getDenominationsFor>;
  counts: CashDenominationCounts;
  activeTotal: number;
  currency: string;
  disabled: boolean;
  onCountChange: (denomKey: string, count: number) => void;
}

/** شبكة تفقيط الفئات مع إجمالي الفئات المحسوبة */
const DenominationGrid: React.FC<DenominationGridProps> = ({
  denominations,
  counts,
  activeTotal,
  currency,
  disabled,
  onCountChange,
}) => (
  <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      {denominations.map(({ value, label }) => {
        const key = value.toString();
        const count = getDenominationCount(counts, key);
        const handleStep = (delta: number): void => {
          onCountChange(key, count + delta);
        };

        return (
          <DenominationCell
            key={key}
            label={label}
            subtotal={value * count}
            count={count}
            disabled={disabled}
            currency={currency}
            onCountChange={newCount => {
              onCountChange(key, newCount);
            }}
            onStep={handleStep}
          />
        );
      })}
    </div>

    <CashTotalIndicator label="إجمالي الفئات المحسوبة:" total={activeTotal} currency={currency} />
  </div>
);

interface CounterBodyProps {
  countMode: 'denominations' | 'quick';
  activeTotal: number;
  manualTotal: number;
  denominations: ReturnType<typeof getDenominationsFor>;
  counts: CashDenominationCounts;
  currency: string;
  disabled: boolean;
  onManualTotalChange: (val: number) => void;
  onCountChange: (denomKey: string, count: number) => void;
}

/** جسم العدّاد: إدخال سريع للمجموع أو شبكة تفقيط الفئات التفصيلية */
const CounterBody: React.FC<CounterBodyProps> = ({
  countMode,
  activeTotal,
  manualTotal,
  denominations,
  counts,
  currency,
  disabled,
  onManualTotalChange,
  onCountChange,
}) =>
  countMode === 'quick' ? (
    <QuickTotalInput
      manualTotal={manualTotal}
      currency={currency}
      disabled={disabled}
      activeTotal={activeTotal}
      onManualTotalChange={onManualTotalChange}
    />
  ) : (
    <DenominationGrid
      denominations={denominations}
      counts={counts}
      activeTotal={activeTotal}
      currency={currency}
      disabled={disabled}
      onCountChange={onCountChange}
    />
  );

export const DenominationTouchCounter: React.FC<DenominationTouchCounterProps> = ({
  counts,
  onChange,
  manualTotal,
  onManualTotalChange,
  countMode,
  onCountModeChange,
  currency = 'SAR',
  disabled = false,
}) => {
  const denomTotal = reconciliationService.calculateDenominationsTotal(counts);
  const activeTotal = countMode === 'denominations' ? denomTotal : manualTotal;
  // فئات النقد تُعرض برمز عملة المنشأة الأساسية بدل تثبيت ر.س
  const denominations = getDenominationsFor(currency);
  const handleCountChange = (denomKey: string, newCount: number): void => {
    const nextCounts = { ...counts, [denomKey]: Math.max(0, Math.floor(newCount)) };
    onChange(nextCounts);
    onManualTotalChange(reconciliationService.calculateDenominationsTotal(nextCounts));
  };
  const handleReset = (): void => {
    onChange({});
    onManualTotalChange(0);
  };
  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg)] p-4 shadow-sm transition-all">
      <CounterHeader
        countMode={countMode}
        disabled={disabled}
        onModeChange={onCountModeChange}
        onReset={handleReset}
      />
      <CounterBody
        countMode={countMode}
        activeTotal={activeTotal}
        manualTotal={manualTotal}
        denominations={denominations}
        counts={counts}
        currency={currency}
        disabled={disabled}
        onManualTotalChange={onManualTotalChange}
        onCountChange={handleCountChange}
      />
    </div>
  );
};
