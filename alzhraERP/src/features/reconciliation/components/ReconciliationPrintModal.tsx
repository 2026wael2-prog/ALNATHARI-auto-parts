import React, { useRef } from 'react';
import { Printer } from 'lucide-react';
import Modal from '../../../ui/base/Modal';
import Button from '../../../ui/base/Button';
import { currencySymbol, resolveSummaryCurrency } from '../services/reconciliationService';
import type { DailyDrawerSummary } from '../types';

interface ReconciliationPrintModalProps {
  isOpen: boolean;
  onClose: () => void;
  summary: DailyDrawerSummary;
  actualCash: number;
  actualCard: number;
  floatRetained: number;
  cashToOwner: number;
  shopName?: string;
}

interface SummarySectionProps {
  summary: DailyDrawerSummary;
}

/** رأس الإيصال: اسم المنشأة وعنوان المطابقة والتاريخ */
const ReceiptHeader: React.FC<{ shopName: string; date: string }> = ({ shopName, date }) => (
  <div className="border-b border-gray-400 pb-2 text-center">
    <h2 className="text-sm font-black">{shopName}</h2>
    <p className="text-[11px] font-bold">إيصال مطابقة وإقفال الصندوق اليومي</p>
    <p className="text-[10px] text-gray-600">التاريخ: {date}</p>
  </div>
);

/** مبيعات الموظفين: عدد الفواتير وإجمالي كل موظف */
const EmployeeBreakdownSection: React.FC<SummarySectionProps> = ({ summary }) => (
  <div className="my-2 border-b border-dashed border-gray-300 pb-2">
    <p className="mb-1 font-bold">مبيعات الموظفين:</p>
    {summary.employee_breakdown.map((emp, i) => (
      <div key={i} className="flex justify-between py-0.5">
        <span>
          {emp.employee_name} ({emp.invoice_count} ف):
        </span>
        <span className="font-bold">{emp.total_sales.toFixed(2)}</span>
      </div>
    ))}
  </div>
);

/**
 * بنود الآجل وبقية طرق الدفع وسندات القبض والصرف.
 * حقولها قد تعود null من دالة الخادم لذا تُقرأ بقيمة افتراضية صفرية قبل العرض.
 */
const DeferredSalesLines: React.FC<SummarySectionProps> = ({ summary }) => {
  const creditSales = summary.credit_sales ?? 0;
  const otherSales = summary.other_sales ?? 0;
  const cashReceipts = summary.cash_receipts ?? 0;
  const cashDisbursements = summary.cash_disbursements ?? 0;

  return (
    <>
      {creditSales > 0 && (
        <div className="flex justify-between text-purple-600">
          <span>مبيعات آجلة (ذمم):</span>
          <span>{creditSales.toFixed(2)}</span>
        </div>
      )}
      {otherSales > 0 && (
        <div className="flex justify-between text-gray-600">
          <span>مبيعات بطرق دفع أخرى:</span>
          <span>{otherSales.toFixed(2)}</span>
        </div>
      )}
      {cashReceipts > 0 && (
        <div className="flex justify-between text-emerald-600">
          <span>سندات قبض نقدية:</span>
          <span>+{cashReceipts.toFixed(2)}</span>
        </div>
      )}
      {cashDisbursements > 0 && (
        <div className="flex justify-between text-red-600">
          <span>سندات صرف نقدية:</span>
          <span>-{cashDisbursements.toFixed(2)}</span>
        </div>
      )}
    </>
  );
};

/** بنود حركة النقد: المرتجعات ومصروفات الدرج وعهدة فكة الصباح */
const CashMovementLines: React.FC<SummarySectionProps> = ({ summary }) => (
  <>
    {summary.returns_cash > 0 && (
      <div className="flex justify-between text-red-600">
        <span>مرتجع نقدي:</span>
        <span>-{summary.returns_cash.toFixed(2)}</span>
      </div>
    )}
    {summary.returns_card > 0 && (
      <div className="flex justify-between text-red-600">
        <span>مرتجع شبكة:</span>
        <span>-{summary.returns_card.toFixed(2)}</span>
      </div>
    )}
    {summary.petty_expenses_cash > 0 && (
      <div className="flex justify-between text-red-600">
        <span>مصروفات من الدرج:</span>
        <span>-{summary.petty_expenses_cash.toFixed(2)}</span>
      </div>
    )}
    {summary.opening_float > 0 && (
      <div className="flex justify-between text-gray-600">
        <span>عهدة فكة الصباح:</span>
        <span>+{summary.opening_float.toFixed(2)}</span>
      </div>
    )}
  </>
);

/** إجمالي المبيعات وطرق الدفع مع البنود الشرطية الراجعة من الخادم */
const SalesTotalsSection: React.FC<SummarySectionProps & { currency: string }> = ({
  summary,
  currency,
}) => (
  <div className="space-y-1 border-b border-dashed border-gray-300 pb-2">
    <div className="flex justify-between font-bold">
      <span>إجمالي المبيعات:</span>
      <span>
        {summary.total_sales.toFixed(2)} {currency}
      </span>
    </div>
    <div className="flex justify-between">
      <span>مبيعات الشبكة (مدى):</span>
      <span>{summary.card_sales.toFixed(2)}</span>
    </div>
    <div className="flex justify-between">
      <span>مبيعات الكاش:</span>
      <span>{summary.cash_sales.toFixed(2)}</span>
    </div>
    {summary.transfer_sales > 0 && (
      <div className="flex justify-between text-blue-600">
        <span>مبيعات تحويل بنكي:</span>
        <span>{summary.transfer_sales.toFixed(2)}</span>
      </div>
    )}
    <DeferredSalesLines summary={summary} />
    <CashMovementLines summary={summary} />
  </div>
);

interface DrawerSectionProps extends SummarySectionProps {
  actualCash: number;
  actualCard: number;
}

/** مطابقة الدرج: المتوقع مقابل الفعلي وفروقات الكاش والشبكة */
const DrawerSection: React.FC<DrawerSectionProps> = ({ summary, actualCash, actualCard }) => {
  const cashVariance = Math.round((actualCash - summary.expected_cash_in_drawer) * 100) / 100;
  const cardVariance = Math.round((actualCard - summary.expected_card_terminal) * 100) / 100;

  return (
    <div className="my-2 space-y-1 border-b border-gray-400 pb-2">
      <div className="flex justify-between">
        <span>الكاش المتوقع بالدرج:</span>
        <span className="font-bold">{summary.expected_cash_in_drawer.toFixed(2)}</span>
      </div>
      <div className="flex justify-between text-sm font-black">
        <span>الكاش الفعلي الموجود:</span>
        <span>{actualCash.toFixed(2)}</span>
      </div>
      <div className="flex justify-between font-bold">
        <span>فارق الكاش:</span>
        <span>
          {cashVariance === 0
            ? '0.00 (متطابق)'
            : `${cashVariance > 0 ? '+' : ''}${cashVariance.toFixed(2)}`}
        </span>
      </div>
      <div className="flex justify-between">
        <span>فارق الشبكة:</span>
        <span>{cardVariance === 0 ? 'مطابق' : cardVariance.toFixed(2)}</span>
      </div>
    </div>
  );
};

/** فكة صباح الغد والمبلغ المسلم للمالك أو الخزينة */
const PayoutSection: React.FC<{ floatRetained: number; cashToOwner: number; currency: string }> = ({
  floatRetained,
  cashToOwner,
  currency,
}) => (
  <div className="space-y-1 border-b border-gray-400 pb-2">
    <div className="flex justify-between">
      <span>فكة مستبقاة لصباح الغد:</span>
      <span className="font-bold">
        {floatRetained.toFixed(2)} {currency}
      </span>
    </div>
    <div className="flex justify-between text-sm font-black text-black">
      <span>المسلم للمالك / الخزينة:</span>
      <span>
        {cashToOwner.toFixed(2)} {currency}
      </span>
    </div>
  </div>
);

/** توقيعات الموظفين والمستلم أسفل الإيصال */
const SignatureSection: React.FC = () => (
  <div className="mt-4 space-y-3 pt-2 text-[10px]">
    <div className="flex justify-between">
      <span>توقيع الموظف (1): ............</span>
      <span>توقيع الموظف (2): ............</span>
    </div>
    <div className="pt-1 text-center">
      <span>توقيع المستلم / صاحب المحل: ....................</span>
    </div>
  </div>
);

/** تنسيق الطباعة الحرارية 80mm وعزل بقية الواجهة عن الطباعة */
const ReceiptPrintStyles: React.FC = () => (
  <style>{`
          @media print {
            body * {
              visibility: hidden !important;
            }
            #reconciliation-print-receipt, #reconciliation-print-receipt * {
              visibility: visible !important;
            }
            #reconciliation-print-receipt {
              position: fixed !important;
              left: 0 !important;
              top: 0 !important;
              width: 80mm !important;
              margin: 0 auto !important;
              padding: 4mm !important;
              box-shadow: none !important;
              border: none !important;
              background: #fff !important;
              color: #000 !important;
              font-size: 11px !important;
            }
            @page {
              size: 80mm auto;
              margin: 0;
            }
          }
        `}</style>
);

/** أزرار الإغلاق والطباعة أسفل نافذة الإيصال */
const ReceiptActionsSection: React.FC<{ onClose: () => void; onPrint: () => void }> = ({
  onClose,
  onPrint,
}) => (
  <div className="flex items-center justify-end gap-2 border-t border-[var(--app-border)] pt-3 print:hidden">
    <Button variant="ghost" onClick={onClose}>
      إغلاق
    </Button>
    <Button variant="primary" onClick={onPrint} className="gap-1.5">
      <Printer className="h-4 w-4" />
      طباعة الإيصال
    </Button>
  </div>
);

export const ReconciliationPrintModal: React.FC<ReconciliationPrintModalProps> = ({
  isOpen,
  onClose,
  summary,
  actualCash,
  actualCard,
  floatRetained,
  cashToOwner,
  shopName = 'المنشأة',
}) => {
  const printAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const currency = currencySymbol(resolveSummaryCurrency(summary));

  const handlePrint = (): void => {
    window.print();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="طباعة إيصال إقفال اليومية">
      <div className="space-y-4">
        <ReceiptPrintStyles />

        <div
          id="reconciliation-print-receipt"
          ref={printAreaRef}
          className="mx-auto max-w-[340px] rounded-lg border border-dashed border-gray-300 bg-white p-4 font-mono text-xs text-gray-900 shadow-sm print:m-0 print:w-full print:border-none print:p-0"
        >
          <ReceiptHeader shopName={shopName} date={summary.date} />
          <EmployeeBreakdownSection summary={summary} />
          <SalesTotalsSection summary={summary} currency={currency} />
          <DrawerSection summary={summary} actualCash={actualCash} actualCard={actualCard} />
          <PayoutSection
            floatRetained={floatRetained}
            cashToOwner={cashToOwner}
            currency={currency}
          />
          <SignatureSection />
        </div>

        <ReceiptActionsSection onClose={onClose} onPrint={handlePrint} />
      </div>
    </Modal>
  );
};
