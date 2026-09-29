import React from 'react';
import { Calendar, Clock, User, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import { cn, formatNumberDisplay } from '../../../../core/utils';
import Avatar from '../../../../ui/base/Avatar';

interface AuditLogTableProps {
  log: any[];
}

const AuditLogTable: React.FC<AuditLogTableProps> = ({ log }) => {
  return (
    <table className="w-full border-collapse select-all text-right">
      <thead className="sticky top-0 z-10 border-b-2 border-gray-200 bg-gray-50 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <tr>
          <th className="w-16 border border-gray-100 p-4 text-center text-[10px] font-black uppercase tracking-tighter text-gray-500 dark:border-slate-700">
            #
          </th>
          <th className="border border-gray-100 p-4 text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <Calendar size={12} className="text-blue-500" />
              التاريخ والوقت
            </div>
          </th>
          <th className="border border-gray-100 p-4 text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <Clock size={12} className="text-blue-500" />
              نوع العملية / المرجع
            </div>
          </th>
          <th className="border border-gray-100 p-4 text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            الجهة / المورد / العميل
          </th>
          <th className="w-24 border border-gray-100 p-4 text-center text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            الحالة
          </th>
          <th className="w-32 border border-gray-100 p-4 text-left text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            الكمية
          </th>
          <th className="w-32 border border-gray-100 p-4 text-left text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            الرصيد بعدها
          </th>
          <th className="w-40 border border-gray-100 p-4 text-[11px] font-bold text-gray-600 dark:border-slate-700 dark:text-gray-300">
            <div className="flex items-center gap-2">
              <User size={12} className="text-blue-500" />
              المستخدم
            </div>
          </th>
        </tr>
      </thead>
      <tbody className="divide-y dark:divide-slate-800">
        {log.map((entry: any, i: number) => {
          const isIncoming = entry.transaction_type === 'in';
          return (
            <tr
              key={i}
              className="group transition-colors odd:bg-white even:bg-gray-50/30 hover:bg-blue-500/5 dark:odd:bg-slate-900 dark:even:bg-slate-800/20 dark:hover:bg-blue-500/10"
            >
              <td className="border border-gray-50 p-4 text-center font-mono text-xs font-bold text-gray-400 group-hover:text-blue-500 dark:border-slate-800/60">
                {log.length - i}
              </td>
              <td className="whitespace-nowrap border border-gray-50 p-4 text-[11px] text-gray-600 dark:border-slate-800/60 dark:text-gray-400">
                {new Date(entry.date).toLocaleString('en-GB', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </td>
              <td className="border border-gray-50 p-4 dark:border-slate-800/60">
                <div className="mb-1 font-black text-blue-700 dark:text-blue-400">
                  {entry.document_number}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                  {entry.reference_type === 'invoice' || entry.reference_type?.includes('invoice')
                    ? 'فاتورة إلكترونية'
                    : entry.reference_type === 'stock_transfer'
                      ? 'مناقلة مخزنية'
                      : entry.reference_type === 'stock_audit'
                        ? 'تسوية جردية'
                        : 'مستند يدوي'}
                </div>
              </td>
              <td className="border border-gray-50 p-4 text-[11px] font-black text-gray-700 dark:border-slate-800/60 dark:text-slate-200">
                {entry.source_name || '--'}
              </td>
              <td className="border border-gray-50 p-4 text-center dark:border-slate-800/60">
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1 text-[10px] font-black uppercase tracking-tighter',
                    isIncoming
                      ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                      : 'border-rose-500/20 bg-rose-500/10 text-rose-600'
                  )}
                >
                  {isIncoming ? (
                    <ArrowDownLeft size={10} strokeWidth={3} />
                  ) : (
                    <ArrowUpRight size={10} strokeWidth={3} />
                  )}
                  {isIncoming ? 'وارد' : 'صادر'}
                </div>
              </td>
              <td
                dir="ltr"
                className={cn(
                  'border border-gray-50 p-4 text-left font-mono text-sm font-black dark:border-slate-800/60',
                  isIncoming ? 'text-emerald-600' : 'text-rose-600'
                )}
              >
                {isIncoming ? '+' : '-'}
                {formatNumberDisplay(Math.abs(entry.quantity))}
              </td>
              <td
                dir="ltr"
                className="border border-gray-50 bg-blue-500/5 p-4 text-left font-mono text-sm font-black text-gray-900 dark:border-slate-800/60 dark:bg-blue-500/10 dark:text-white"
              >
                {formatNumberDisplay(entry.balance_after)}
              </td>
              <td className="border border-gray-50 p-4 dark:border-slate-800/60">
                <div className="flex items-center gap-3">
                  <Avatar name={entry.source_user || entry.created_by_name || 'System'} size="xs" />
                  <div className="flex flex-col">
                    <span className="max-w-[100px] truncate text-[10px] font-black text-gray-700 dark:text-slate-200">
                      {entry.source_user?.split('@')[0] ||
                        entry.created_by_name?.split(' ')[0] ||
                        'النظام'}
                    </span>
                    <span className="text-[10px] font-bold uppercase text-gray-400">المسؤول</span>
                  </div>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};

export default AuditLogTable;
