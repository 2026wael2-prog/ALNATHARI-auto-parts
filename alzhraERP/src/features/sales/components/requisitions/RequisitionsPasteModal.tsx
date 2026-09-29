/* eslint-disable max-lines-per-function */
import React, { useState } from 'react';
import { Clipboard, Check, X, AlertTriangle, CopyCheck } from 'lucide-react';
import { useRequisitionsStore } from '../../store/requisitionsStore';
import type { RequisitionImportResult } from '../../types/requisitions';

interface RequisitionsPasteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RequisitionsPasteModal: React.FC<RequisitionsPasteModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [pasteContent, setPasteContent] = useState('');
  const [result, setResult] = useState<RequisitionImportResult | null>(null);
  const importFromText = useRequisitionsStore(state => state.importFromText);

  if (!isOpen) return null;

  const handleImport = (): void => {
    // The store reports skipped rows instead of hiding them: a silently dropped
    // duplicate or a quantity that could not be parsed is a data-loss bug in an
    // order document, so the modal states exactly what happened.
    const importResult = importFromText(pasteContent);
    setResult(importResult);
    if (importResult.imported > 0) {
      setTimeout(() => {
        setResult(null);
        setPasteContent('');
        onClose();
      }, 1200);
    }
  };

  return (
    <div className="backdrop-blur-xs fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
        dir="rtl"
      >
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2 dark:border-slate-800">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
            <Clipboard size={18} className="text-blue-600" />
            <h3 className="text-sm font-bold">لصق سريع من ملف إكسل</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X size={16} />
          </button>
        </div>

        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          انسخ الخلايا من جدول إكسل (اسم القطعة، رقم القطعة، الشركة، الكمية، ملاحظات) والصقها هنا
          مباشرة:
        </p>

        <textarea
          rows={6}
          value={pasteContent}
          onChange={e => {
            setPasteContent(e.target.value);
          }}
          placeholder={`مثال:\nفحمات سيراميك\t04465-33470\tتويوتا\t4\tأصلية ياباني\nشمعات إشعال\tSK20HR11\tدنسو\t8\tمطلوب كرتون`}
          className="w-full rounded-lg border border-slate-300 p-2.5 font-mono text-xs text-slate-800 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          dir="ltr"
        />

        {result !== null && (
          <div className="mt-2 space-y-1 text-xs font-bold">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <Check size={14} />
              <span>تم استيراد {result.imported} صنف بنجاح.</span>
            </div>
            {result.duplicates > 0 && (
              <div className="flex items-center gap-1.5 text-slate-500">
                <CopyCheck size={14} />
                <span>تم تجاهل {result.duplicates} سطر مكرر موجود مسبقاً في الجدول.</span>
              </div>
            )}
            {result.invalid > 0 && (
              <div className="flex items-center gap-1.5 text-amber-600">
                <AlertTriangle size={14} />
                <span>
                  {result.invalid} سطر بكمية غير صحيحة — استُورد بكمية 0 وبانتظار تصحيحك (لن
                  يُحفظ الطلب قبل التصحيح).
                </span>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={!pasteContent.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          >
            <Clipboard size={14} />
            <span>استيراد إلى الجدول</span>
          </button>
        </div>
      </div>
    </div>
  );
};
