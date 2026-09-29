/* eslint-disable max-lines-per-function, @typescript-eslint/strict-boolean-expressions */
import React from 'react';
import { History, X, Trash2, ArrowRight, Calendar, User, Package, Hash, CloudOff, Cloud } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useRequisitionsStore } from '../../store/requisitionsStore';
import type { RequisitionRecord, RequisitionStatus } from '../../types/requisitions';
import { requisitionsApi } from '../../api/requisitionsApi';
import { useAuthStore } from '@/features/auth/store';
import { formatLocalDate } from '@/core/utils/dateUtils';

interface RequisitionsHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<RequisitionStatus, string> = {
  draft: 'مسودة',
  sent: 'أُرسل للمورد',
  received: 'تم التوريد',
  cancelled: 'ملغي',
};

const STATUS_CLASSES: Record<RequisitionStatus, string> = {
  draft: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  received: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
};

export const RequisitionsHistoryModal: React.FC<RequisitionsHistoryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const localDrafts = useRequisitionsStore(state => state.localDrafts);
  const loadIntoGrid = useRequisitionsStore(state => state.loadIntoGrid);
  const deleteLocalDraft = useRequisitionsStore(state => state.deleteLocalDraft);
  const companyId = useAuthStore(state => state.user?.company_id ?? '');

  // Audit F2/F5: the history is the SERVER history first; local drafts are the
  // honest fallback for whatever the server has not accepted yet.
  const {
    data: serverRecords = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['sales-requisitions', companyId],
    queryFn: () => requisitionsApi.listRequisitions(companyId),
    enabled: isOpen && companyId !== '',
    staleTime: 30_000,
  });

  if (!isOpen) return null;

  const records = [...localDrafts, ...serverRecords].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  const handleOpen = (record: RequisitionRecord): void => {
    loadIntoGrid(
      {
        title: record.title,
        supplier: record.supplier,
        notes: record.notes,
        items: record.items,
      },
      { number: record.number, recordId: record.id, recordOrigin: record.origin }
    );
    onClose();
  };

  return (
    <div className="backdrop-blur-xs fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        dir="rtl"
      >
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <History size={18} className="text-blue-600" />
            <h3 className="text-sm font-bold">سجل طلبات المطلوبات</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            title="إغلاق"
          >
            <X size={16} />
          </button>
        </div>

        {localDrafts.length > 0 && (
          <p className="mb-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 p-2 text-[11px] font-semibold text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <CloudOff size={13} className="mt-0.5 shrink-0" />
            <span>
              {localDrafts.length} طلب محفوظ على هذا الجهاز فقط (لم يقبله الخادم بعد)، ولا يُشارك
              بين المستخدمين أو الأجهزة. الطلبات ذات الرقم الرسمي محفوظة على الخادم.
            </span>
          </p>
        )}

        {isError && (
          <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50/70 p-2 text-[11px] font-semibold text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            تعذّر جلب الطلبات من الخادم — تُعرض المسودات المحلية فقط. تحقّق من الاتصال وأعد الفتح.
          </p>
        )}

        {isLoading && (
          <p className="mb-3 text-center text-[11px] font-semibold text-slate-400">
            جارٍ تحميل الطلبات من الخادم...
          </p>
        )}

        <div className="custom-scrollbar flex-1 overflow-y-auto">
          {records.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-400">
              لا توجد طلبات محفوظة حالياً. يمكنك حفظ أي قائمة مطلوبة للرجوع إليها لاحقاً.
            </div>
          ) : (
            <div className="space-y-2">
              {records.map(record => (
                <div
                  key={record.id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-3 transition-colors hover:bg-blue-50/40 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800"
                >
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                        {record.title}
                      </span>
                      <span
                        className={
                          'rounded px-1.5 py-0.5 text-[10px] font-bold ' +
                          STATUS_CLASSES[record.status]
                        }
                      >
                        {STATUS_LABELS[record.status]}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="flex items-center gap-1 font-mono">
                        {record.origin === 'server' ? (
                          <Cloud size={12} className="text-emerald-600" />
                        ) : (
                          <CloudOff size={12} className="text-amber-600" />
                        )}
                        <Hash size={12} />
                        {record.number ?? 'بدون رقم (محلي)'}
                      </span>
                      <span
                        className={
                          'rounded px-1.5 py-0.5 text-[10px] font-bold ' +
                          (record.origin === 'server'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300')
                        }
                      >
                        {record.origin === 'server' ? 'على الخادم' : 'على هذا الجهاز'}
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar size={12} />
                        {formatLocalDate(record.updatedAt)}
                      </span>
                      {record.supplier?.name && (
                        <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                          <User size={12} />
                          {record.supplier.name}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Package size={12} />
                        {record.itemCount} صنف | كمية {record.totalQuantity}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        handleOpen(record);
                      }}
                      className="shadow-2xs flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-blue-700"
                    >
                      <ArrowRight size={13} />
                      <span>فتح في الجدول</span>
                    </button>
                    {record.origin === 'local' && (
                      <button
                        type="button"
                        onClick={() => {
                          deleteLocalDraft(record.id);
                        }}
                        className="rounded-md p-1.5 text-rose-500 hover:bg-rose-100 hover:text-rose-700 dark:hover:bg-rose-950"
                        title="حذف المسودة المحلية"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
};