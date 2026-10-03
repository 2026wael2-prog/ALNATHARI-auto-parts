import React from 'react';
import { formatBaseAmount, formatDocumentAmount } from '../../../../core/utils';
import type { ReportView, ReturnsType } from '../../hooks/useReturnsReport';
import type { ReturnReportRow } from '../../hooks/returnsNormalizers';

interface Props {
  reportView: ReportView;
  filteredSalesReturns: ReturnReportRow[];
  filteredPurchaseReturns: ReturnReportRow[];
  type: ReturnsType;
}

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'posted':
      return 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20';
    case 'draft':
      return 'bg-amber-500/10 text-amber-600 border border-amber-500/20';
    case 'paid':
      return 'bg-blue-500/10 text-blue-600 border border-blue-500/20';
    case 'cancelled':
      return 'bg-rose-500/10 text-rose-600 border border-rose-500/20';
    default:
      return 'bg-slate-500/10 text-slate-600 border border-slate-500/20';
  }
};

const getReasonText = (reason: string): string => {
  switch (reason) {
    case 'defective':
      return 'منتج تالف';
    case 'not_as_described':
      return 'غير مطابق';
    case 'wrong_item':
      return 'صنف خاطئ';
    case 'quality_issue':
      return 'مشكلة جودة';
    case 'changed_mind':
      return 'تغيير رأي';
    case 'expired':
      return 'منتهي الصلاحية';
    case 'other':
      return 'أخرى';
    default:
      return reason !== '' ? reason : '-';
  }
};

const ReturnAmountCell: React.FC<{ item: ReturnReportRow }> = ({ item }) => {
  const code = item.currency_code;
  const isForeign = typeof code === 'string' && code !== '' && code !== 'SAR';
  return (
    <>
      <span className="font-mono text-xs font-bold text-slate-800 dark:text-white">
        {formatDocumentAmount(Number(item.total_amount ?? 0), code, item.exchange_rate)}
      </span>
      {isForeign ? (
        <span className="block font-mono text-[10px] text-slate-400">
          ≈ {formatBaseAmount(Number(item.total_amount ?? 0))}
        </span>
      ) : null}
    </>
  );
};

const ReturnsTransactionsTable: React.FC<Props> = ({
  reportView,
  filteredSalesReturns,
  filteredPurchaseReturns,
  type,
}) => {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--app-border)] bg-[var(--app-surface)] shadow-sm">
      <div className="flex items-center justify-between border-b border-[var(--app-border)] bg-[var(--app-surface-hover)] p-3.5 sm:p-4">
        <div>
          <h4 className="text-sm font-bold text-slate-800 dark:text-white">
            {reportView === 'overview'
              ? 'سجل العمليات التفصيلي'
              : reportView === 'sales'
                ? 'سجل مرتجعات المبيعات'
                : 'سجل مرتجعات المشتريات'}
          </h4>
          <p className="text-[10px] font-semibold text-slate-400">بيانات حركات الإرجاع المسجلة</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-400">عدد الحركات:</span>
          <span className="rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold text-rose-600">
            {reportView === 'overview'
              ? filteredSalesReturns.length + filteredPurchaseReturns.length
              : reportView === 'sales'
                ? filteredSalesReturns.length
                : filteredPurchaseReturns.length}
          </span>
        </div>
      </div>

      <div className="table-scroll-viewport overflow-x-auto">
        <table className="w-full border-collapse text-right">
          <thead>
            <tr className="border-b border-[var(--app-border)] bg-[var(--app-surface-hover)]">
              <th className="px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                رقم المرجع
              </th>
              <th className="px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                التاريخ
              </th>
              <th className="px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                {/*
                  ⚡ في وضع «نظرة عامة» يُدمج النوعان في جدول واحد، فالعنوان
                  المفرد («العميل» أو «المورد») يوسم نصف الصفوف خطأً. «الطرف»
                  يصدق على الحالتين، والشارة في عمود المرجع تبيّن النوع.
                */}
                {reportView === 'overview' ? 'الطرف' : type === 'purchase' ? 'المورد' : 'العميل'}
              </th>
              <th className="px-3.5 py-2.5 text-center text-xs font-bold text-slate-600 dark:text-slate-300">
                الفاتورة الأصلية
              </th>
              <th className="px-3.5 py-2.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                سبب الإرجاع
              </th>
              <th className="px-3.5 py-2.5 text-left text-xs font-bold text-slate-600 dark:text-slate-300">
                المبلغ الإجمالي
              </th>
              <th className="px-3.5 py-2.5 text-center text-xs font-bold text-slate-600 dark:text-slate-300">
                الحالة
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--app-border)]">
            {(reportView === 'overview'
              ? [...filteredSalesReturns, ...filteredPurchaseReturns]
              : reportView === 'sales'
                ? filteredSalesReturns
                : filteredPurchaseReturns
            )
              .slice(0, 20)
              .map((item, index) => (
                <tr key={index} className="transition-colors hover:bg-[var(--app-surface-hover)]">
                  <td className="px-3.5 py-2.5">
                    <span className="text-xs font-bold text-slate-800 dark:text-white">
                      {item.invoice_number}
                    </span>
                    {reportView === 'overview' && (
                      <span
                        className={
                          item.kind === 'purchase'
                            ? 'mr-1.5 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-600'
                            : 'mr-1.5 rounded bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-600'
                        }
                      >
                        {item.kind === 'purchase' ? 'مشتريات' : 'مبيعات'}
                      </span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-xs text-slate-500">
                    {item.issue_date || '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {item.party?.name || '—'}
                  </td>
                  <td className="px-3.5 py-2.5 text-center">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {/* «داخلي» كانت قيمة احتياطية صامتة تُعرض لكل صف حتى
                          حين يكون الربط موجوداً فعلاً. الآن تُعرض «غير مرتبط»
                          فقط عندما لا توجد فاتورة أصلية بحق. */}
                      {item.reference_invoice?.invoice_number || 'غير مرتبط'}
                    </span>
                  </td>
                  <td className="px-3.5 py-2.5 text-xs text-slate-600 dark:text-slate-400">
                    {getReasonText(item.return_reason ?? '')}
                  </td>
                  <td className="px-3.5 py-2.5 text-left">
                    <ReturnAmountCell item={item} />
                  </td>
                  <td className="px-3.5 py-2.5 text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${getStatusColor(item.status ?? '')}`}
                    >
                      {item.status === 'draft'
                        ? 'مسودة'
                        : item.status === 'posted'
                          ? 'مرحّل'
                          : item.status === 'paid'
                            ? 'مدفوع'
                            : item.status === 'cancelled'
                              ? 'ملغي'
                              : item.status}
                    </span>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {(reportView === 'overview'
        ? [...filteredSalesReturns, ...filteredPurchaseReturns]
        : reportView === 'sales'
          ? filteredSalesReturns
          : filteredPurchaseReturns
      ).length > 20 && (
        <div className="border-t border-[var(--app-border)] bg-[var(--app-surface-hover)] p-3 text-center">
          <p className="text-xs font-semibold text-slate-400">
            عرض أول 20 حركة من إجمالي{' '}
            {reportView === 'overview'
              ? filteredSalesReturns.length + filteredPurchaseReturns.length
              : reportView === 'sales'
                ? filteredSalesReturns.length
                : filteredPurchaseReturns.length}{' '}
            حركة مسجلة
          </p>
        </div>
      )}
    </div>
  );
};

export default ReturnsTransactionsTable;
