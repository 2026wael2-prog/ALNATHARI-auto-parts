import React from 'react';
import { FileSpreadsheet, MessageCircle, Printer } from 'lucide-react';

/**
 * الإجراءات الثلاثة المتاحة لأي عرض سعر: إرسال واتساب (ملف إكسل)، طباعة، وتنزيل إكسل.
 * تُستخدم في قائمة عروض المبيعات وقائمة عروض المشتريات على السواء، حتى تبقى
 * الأيقونات الثلاثة ظاهرة ومتطابقة في كل شاشة تعرض العروض.
 */
export type QuotationRowAction = 'share' | 'print' | 'excel';

interface QuotationActionIconsProps {
  /** يُستدعى مع الإجراء المطلوب — والصفحة مسؤولة عن تنفيذه. */
  onAction: (action: QuotationRowAction) => void;
  size?: number;
}

interface ActionButtonProps {
  title: string;
  tone: string;
  onClick: () => void;
  children: React.ReactNode;
}

const ActionButton: React.FC<ActionButtonProps> = ({ title, tone, onClick, children }) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    onClick={event => {
      // الصف نفسه قابل للنقر (فتح التفاصيل) — نمنع فتح النافذة مرتين.
      event.stopPropagation();
      onClick();
    }}
    className={`rounded-lg border p-1.5 transition-colors ${tone}`}
  >
    {children}
  </button>
);

export const QuotationActionIcons: React.FC<QuotationActionIconsProps> = ({
  onAction,
  size = 14,
}) => (
  <div className="flex items-center justify-center gap-1">
    <ActionButton
      title="إرسال عبر واتساب (ملف إكسل)"
      tone="border-emerald-200 text-emerald-600 hover:bg-emerald-50 dark:border-emerald-800/30 dark:text-emerald-400 dark:hover:bg-emerald-900/20"
      onClick={() => {
        onAction('share');
      }}
    >
      <MessageCircle size={size} />
    </ActionButton>
    <ActionButton
      title="طباعة عرض السعر"
      tone="border-gray-200 text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:border-slate-700 dark:text-gray-400 dark:hover:bg-slate-800 dark:hover:text-white"
      onClick={() => {
        onAction('print');
      }}
    >
      <Printer size={size} />
    </ActionButton>
    <ActionButton
      title="تنزيل ملف إكسل"
      tone="border-teal-200 text-teal-600 hover:bg-teal-50 dark:border-teal-800/30 dark:text-teal-400 dark:hover:bg-teal-900/20"
      onClick={() => {
        onAction('excel');
      }}
    >
      <FileSpreadsheet size={size} />
    </ActionButton>
  </div>
);

export default QuotationActionIcons;
