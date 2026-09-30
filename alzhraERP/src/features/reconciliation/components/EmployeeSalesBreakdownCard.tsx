import React, { useState } from 'react';
import {
  Users,
  ShoppingBag,
  CreditCard,
  Banknote,
  ChevronDown,
  ChevronUp,
  Receipt,
  ArrowLeftRight,
  Wallet,
} from 'lucide-react';
import { formatCurrency } from '../../../core/utils';
import type { EmployeeSalesSummary } from '../types';

interface EmployeeSalesBreakdownCardProps {
  breakdown: EmployeeSalesSummary[];
  totalSales: number;
  currency?: string | undefined;
  defaultExpanded?: boolean | undefined;
}

interface EmployeeLineProps {
  emp: EmployeeSalesSummary;
  currency: string;
}

interface AccordionHeaderProps {
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}

/** رأس بطاقة الموظف: الاسم وعدد الفواتير والإجمالي ونسبته من مبيعات اليوم */
const EmployeeCardHeader: React.FC<EmployeeLineProps & { percentage: number }> = ({
  emp,
  currency,
  percentage,
}) => (
  <div className="flex items-start justify-between">
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-card-bg)] text-xs font-black text-blue-600 dark:text-blue-400">
        {emp.employee_name.slice(0, 2)}
      </div>
      <div>
        <h4 className="text-xs font-bold text-[var(--app-text)]">{emp.employee_name}</h4>
        <div className="flex items-center gap-1 text-[11px] text-[var(--app-text-secondary)]">
          <ShoppingBag className="h-3 w-3" />
          <span>{emp.invoice_count} فاتورة</span>
        </div>
      </div>
    </div>

    <div className="text-left">
      <div className="text-xs font-black text-[var(--app-text)]">
        {formatCurrency(emp.total_sales, currency)}
      </div>
      <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400">
        {percentage}% من المبيعات
      </span>
    </div>
  </div>
);

/** شريط نسبة مساهمة الموظف من إجمالي مبيعات اليوم */
const EmployeeShareBar: React.FC<{ percentage: number }> = ({ percentage }) => (
  <div className="my-2 h-1.5 w-full overflow-hidden rounded-full border border-[var(--app-border)] bg-[var(--app-card-bg)]">
    <div
      className="h-full rounded-full bg-blue-600 transition-all duration-500"
      style={{ width: `${String(percentage)}%` }}
    />
  </div>
);

interface PaymentMethodItemProps {
  icon: React.ReactNode;
  label: string;
  amount: number;
  currency: string;
}

/** بند طريقة دفع واحدة داخل بطاقة الموظف */
const PaymentMethodItem: React.FC<PaymentMethodItemProps> = ({ icon, label, amount, currency }) => (
  <div className="flex items-center gap-1 text-[var(--app-text-secondary)]">
    {icon}
    <span>{label}</span>
    <span className="font-bold text-[var(--app-text)]">{formatCurrency(amount, currency)}</span>
  </div>
);

/** تفصيل طرق الدفع الأساسية (كاش وشبكة) مع بنود الدفع الأخرى */
const EmployeePaymentMix: React.FC<EmployeeLineProps> = ({ emp, currency }) => (
  <div className="grid grid-cols-2 gap-2 border-t border-[var(--app-border)] pt-2 text-[11px]">
    <PaymentMethodItem
      icon={<Banknote className="h-3.5 w-3.5 text-emerald-500" />}
      label="كاش:"
      amount={emp.cash_sales}
      currency={currency}
    />
    <PaymentMethodItem
      icon={<CreditCard className="h-3.5 w-3.5 text-blue-500" />}
      label="شبكة:"
      amount={emp.card_sales}
      currency={currency}
    />
    <EmployeeDeferredPaymentMix emp={emp} currency={currency} />
  </div>
);

/** بنود التحويل والآجل وبقية الطرق: تظهر فقط عند وجود مبلغ فعلي */
const EmployeeDeferredPaymentMix: React.FC<EmployeeLineProps> = ({ emp, currency }) => {
  const creditSales = emp.credit_sales ?? 0;
  const otherSales = emp.other_sales ?? 0;

  return (
    <>
      {emp.transfer_sales > 0 && (
        <PaymentMethodItem
          icon={<ArrowLeftRight className="h-3.5 w-3.5 text-indigo-500" />}
          label="تحويل:"
          amount={emp.transfer_sales}
          currency={currency}
        />
      )}
      {creditSales > 0 && (
        <PaymentMethodItem
          icon={<Receipt className="h-3.5 w-3.5 text-amber-500" />}
          label="آجل:"
          amount={creditSales}
          currency={currency}
        />
      )}
      {otherSales > 0 && (
        <PaymentMethodItem
          icon={<Wallet className="h-3.5 w-3.5 text-gray-500" />}
          label="أخرى:"
          amount={otherSales}
          currency={currency}
        />
      )}
    </>
  );
};

interface EmployeeSalesCardProps extends EmployeeLineProps {
  percentage: number;
}

/** بطاقة موظف واحدة: الاسم والإجمالي وشريط النسبة وتفصيل طرق الدفع */
const EmployeeSalesCard: React.FC<EmployeeSalesCardProps> = ({ emp, currency, percentage }) => (
  <div className="flex flex-col justify-between rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3 transition-colors hover:border-blue-500/30">
    <EmployeeCardHeader emp={emp} currency={currency} percentage={percentage} />
    <EmployeeShareBar percentage={percentage} />
    <EmployeePaymentMix emp={emp} currency={currency} />
  </div>
);

interface BreakdownGridProps {
  breakdown: EmployeeSalesSummary[];
  totalSales: number;
  currency: string;
}

/** شبكة بطاقات الموظفين مع نسبة كل موظف من مبيعات اليوم */
const BreakdownGrid: React.FC<BreakdownGridProps> = ({ breakdown, totalSales, currency }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {breakdown.map((emp, index) => {
      const percentage = totalSales > 0 ? Math.round((emp.total_sales / totalSales) * 100) : 0;

      return (
        <EmployeeSalesCard
          key={emp.user_id || index}
          emp={emp}
          currency={currency}
          percentage={percentage}
        />
      );
    })}
  </div>
);

/** رأس البطاقة القابل للنقر لفتح وطي بيان مبيعات الموظفين */
const AccordionHeader: React.FC<AccordionHeaderProps> = ({ count, isExpanded, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    className="hover:bg-[var(--app-hover)]/50 flex w-full items-center justify-between rounded-xl p-3.5 text-right transition-colors"
  >
    <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
        <Users className="h-4 w-4" />
      </div>
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-[var(--app-text)]">فرز مبيعات الموظفين لليوم</h3>
          <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400">
            {count} موظف
          </span>
        </div>
        <p className="text-[11px] text-[var(--app-text-secondary)]">
          بيان مساهمة وفواتير كل كاشير وموظف مبيعات لحفظ الحقوق والشفافية
        </p>
      </div>
    </div>

    <div className="flex items-center gap-2 text-xs text-[var(--app-text-secondary)]">
      <span className="hidden font-semibold sm:inline">
        {isExpanded ? 'طي التفاصيل' : 'عرض التفاصيل'}
      </span>
      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
    </div>
  </button>
);

export const EmployeeSalesBreakdownCard: React.FC<EmployeeSalesBreakdownCardProps> = ({
  breakdown,
  totalSales,
  currency = 'SAR',
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-xl border border-[var(--app-border)] bg-[var(--app-card-bg)] shadow-sm transition-all">
      <AccordionHeader
        count={breakdown.length}
        isExpanded={isExpanded}
        onToggle={() => {
          setIsExpanded(!isExpanded);
        }}
      />

      {isExpanded && (
        <div className="border-t border-[var(--app-border)] p-4">
          {breakdown.length === 0 ? (
            <div className="py-6 text-center text-xs text-[var(--app-text-secondary)]">
              لا توجد مبيعات مسجلة في هذا التاريخ حتى الآن
            </div>
          ) : (
            <BreakdownGrid breakdown={breakdown} totalSales={totalSales} currency={currency} />
          )}
        </div>
      )}
    </div>
  );
};
