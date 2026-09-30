import React from 'react';
import { Coffee, Check, Loader2, AlertTriangle, ArrowLeftRight } from 'lucide-react';
import Button from '../../../ui/base/Button';
import { formatCurrency } from '../../../core/utils';
import { currencySymbol } from '../services/reconciliationService';

/**
 * أقسام العرض لنموذج المصروف النثري السريع (عرض بحت).
 * لا حالة (`state`) ولا منطق حسابي داخل هذه الأقسام — القيم والمُعالجات تصل
 * جاهزة عبر `model` من المكوّن الحاوي، فيبقى سلوك النموذج كما هو بالحرف.
 */

/** الحقول التفاعلية كما تحتاجها أقسام العرض */
interface ExpenseFieldsView {
  amount: string;
  description: string;
  currencyCode: string;
  exchangeRate: string;
  isManualRate: boolean;
  setAmount: (value: string) => void;
  setDescription: (value: string) => void;
}

/** القيم المحسوبة: المعادل بعملة المنشأة + حارس المبالغ غير المنطقية */
interface ExpensePreviewView {
  numericAmount: number;
  isBaseCurrencySelected: boolean;
  basePreview: number;
  isOverstatedSar: boolean;
}

/** مُعالجات العملة وسعر الصرف والمبلغ */
interface ExpenseCurrencyActionsView {
  currencyOptions: string[];
  handleCurrencyChange: (nextCode: string) => void;
  handleExchangeRateChange: (value: string) => void;
  handleResetAutoRate: () => void;
  handleConvertToBaseCurrency: () => void;
}

/** النموذج الموحّد الذي تعرضه أقسام المصروف النثري */
interface ExpenseFormSectionsModel {
  normalizedBaseCurrency: string;
  state: ExpenseFieldsView;
  preview: ExpensePreviewView;
  actions: ExpenseCurrencyActionsView;
  isPending: boolean;
}

interface ExpenseSectionProps {
  model: ExpenseFormSectionsModel;
}

/** بيانات سريعة جاهزة للبيان (تُعرض كأزرار اختيار سريع) */
const PRESET_DESCRIPTIONS = [
  'شاي وضيافة',
  'نظافة ومستهلكات',
  'مشوار وتوصيل سريع',
  'صيانة خفيفة للمحل',
  'مستلزمات مكتبية',
  'فطور عمال',
];

/** شريط تعريفي أعلى النموذج */
export const ExpenseIntroBanner: React.FC = () => (
  <div className="flex items-center gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
    <Coffee className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
    <span>
      أي مبلغ يخرج من درج الكاشير سجله هنا فوراً، وسيُخصم تلقائياً من النقدية المطلوبة بنهاية اليوم.
    </span>
  </div>
);

/** حقل المبلغ المصروف (بالعملة المختارة في الدرج) */
const ExpenseAmountField: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div>
    <label
      htmlFor="quick-drawer-expense-amount"
      className="mb-1 block text-xs font-bold text-[var(--app-text)]"
    >
      المبلغ المصروف ({currencySymbol(model.state.currencyCode)}) *
    </label>
    <div className="relative">
      <input
        id="quick-drawer-expense-amount"
        type="number"
        step="any"
        min="0.5"
        required
        // eslint-disable-next-line jsx-a11y/no-autofocus -- تركيز مقصود على حقل المبلغ لتسريع إدخال المصروف (سلوك أصلي محفوظ)
        autoFocus
        value={model.state.amount}
        onChange={event => {
          model.state.setAmount(event.target.value);
        }}
        placeholder="مثال: 35"
        className="h-11 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-lg font-black text-[var(--app-text)] focus:border-amber-500 focus:outline-none"
      />
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-[var(--app-text-secondary)]">
        {currencySymbol(model.state.currencyCode)}
      </span>
    </div>
  </div>
);

/** اختيار عملة المصروف (يُعيد حساب الرمز وسعر الصرف فوراً عبر المُعالج) */
const ExpenseCurrencySelect: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div>
    <label
      htmlFor="quick-drawer-expense-currency"
      className="mb-1 block text-xs font-bold text-[var(--app-text)]"
    >
      العملة
    </label>
    <select
      id="quick-drawer-expense-currency"
      value={model.state.currencyCode}
      onChange={event => {
        model.actions.handleCurrencyChange(event.target.value);
      }}
      className="h-11 w-full min-w-[7.5rem] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 text-sm font-bold text-[var(--app-text)] focus:border-amber-500 focus:outline-none"
    >
      {model.actions.currencyOptions.map(code => (
        <option key={code} value={code}>
          {currencySymbol(code)} ({code})
        </option>
      ))}
    </select>
  </div>
);

/** المبلغ + العملة (شبكة سطر واحد كما في التصميم الأصلي) */
export const ExpenseAmountSection: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
    <ExpenseAmountField model={model} />
    <ExpenseCurrencySelect model={model} />
  </div>
);

/** حقل سعر الصرف + زر استرجاع السعر التلقائي */
const ExchangeRateField: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div>
    <label className="mb-1 block text-xs font-semibold text-[var(--app-text-secondary)]">
      سعر الصرف: 1 {model.state.currencyCode.toUpperCase()} = ؟{' '}
      {currencySymbol(model.normalizedBaseCurrency)}
    </label>
    <input
      type="number"
      step="any"
      min="0.000001"
      value={model.state.exchangeRate}
      onChange={event => {
        model.actions.handleExchangeRateChange(event.target.value);
      }}
      className="h-10 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-sm font-bold text-[var(--app-text)] focus:border-amber-500 focus:outline-none"
    />
    {model.state.isManualRate && (
      <button
        type="button"
        onClick={model.actions.handleResetAutoRate}
        className="mt-1 text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-400"
      >
        استرجاع السعر التلقائي
      </button>
    )}
  </div>
);

/** معاينة المعادل بعملة المنشأة (المبلغ الذي سيُخصم فعلياً) */
const BaseAmountPreview: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div className="flex flex-col justify-center rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2">
    <span className="text-[11px] text-[var(--app-text-secondary)]">
      المعادل بعملة المنشأة (المبلغ الذي سيُخصم فعلياً):
    </span>
    <span className="text-base font-black text-emerald-600 dark:text-emerald-400">
      {formatCurrency(model.preview.basePreview, model.normalizedBaseCurrency)}
    </span>
  </div>
);

/** سعر الصرف + المعادل بعملة المنشأة قبل الترحيل */
export const ExpenseExchangeRateSection: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <ExchangeRateField model={model} />
    <BaseAmountPreview model={model} />
  </div>
);

/** حارس المبالغ غير المنطقية: مبلغ كبير بالريال السعودي في منشأة أساسها الريال اليمني */
export const OverstatedSarNotice: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">
    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
    <div className="space-y-1.5">
      <p className="font-bold">تنبيه: مبلغ كبير بالريال السعودي</p>
      <p>
        {formatCurrency(model.preview.numericAmount, 'SAR')} تعادل{' '}
        {formatCurrency(model.preview.basePreview, model.normalizedBaseCurrency)} بعملة المنشأة،
        وسيُخصم هذا المعادل من الدرج. تأكد أنك لم تخلط العملتين قبل الحفظ.
      </p>
      <button
        type="button"
        onClick={model.actions.handleConvertToBaseCurrency}
        className="inline-flex items-center gap-1 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-bold text-white transition-colors hover:bg-amber-700"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        تحويل المبلغ إلى {currencySymbol(model.normalizedBaseCurrency)} (
        {model.preview.basePreview.toFixed(2)})
      </button>
    </div>
  </div>
);

/** أزرار البيانات السريعة للبيان */
const ExpensePresetPicker: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div>
    <span className="mb-1.5 block text-xs font-semibold text-[var(--app-text-secondary)]">
      اختر بياناً سريعاً:
    </span>
    <div className="flex flex-wrap gap-1.5">
      {PRESET_DESCRIPTIONS.map(preset => (
        <button
          key={preset}
          type="button"
          onClick={() => {
            model.state.setDescription(preset);
          }}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
            model.state.description === preset
              ? 'bg-amber-600 text-white shadow-sm'
              : 'border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-text)] hover:bg-[var(--app-hover)]'
          }`}
        >
          {preset}
        </button>
      ))}
    </div>
  </div>
);

/** البيان / السبب (نص حر) */
const ExpenseDescriptionField: React.FC<ExpenseSectionProps> = ({ model }) => (
  <div>
    <label
      htmlFor="quick-drawer-expense-description"
      className="mb-1 block text-xs font-bold text-[var(--app-text)]"
    >
      البيان / السبب *
    </label>
    <input
      id="quick-drawer-expense-description"
      type="text"
      required
      value={model.state.description}
      onChange={event => {
        model.state.setDescription(event.target.value);
      }}
      placeholder="مثال: شاي وضيافة، أو فاتورة مياه"
      className="h-10 w-full rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 text-xs text-[var(--app-text)] focus:border-amber-500 focus:outline-none"
    />
  </div>
);

/** البيان: اختيار سريع أو كتابة حرة (بنفس ترتيب العرض السابق) */
export const ExpenseDescriptionSection: React.FC<ExpenseSectionProps> = ({ model }) => (
  <>
    <ExpensePresetPicker model={model} />
    <ExpenseDescriptionField model={model} />
  </>
);

interface ExpenseFormActionsProps {
  model: ExpenseFormSectionsModel;
  onClose: () => void;
}

/**
 * أزرار الإجراءات: «إلغاء» و«خصم من الدرج الآن».
 * نفس شرط التعطيل السابق: لا إرسال بلا مبلغ أو بيان (ولا مرتين أثناء الحفظ).
 */
export const ExpenseFormActions: React.FC<ExpenseFormActionsProps> = ({ model, onClose }) => (
  <div className="flex items-center justify-end gap-2 border-t border-[var(--app-border)] pt-3">
    <Button type="button" variant="ghost" onClick={onClose} disabled={model.isPending}>
      إلغاء
    </Button>
    <Button
      type="submit"
      variant="primary"
      disabled={
        model.isPending ||
        model.state.amount.length === 0 ||
        model.state.description.trim().length === 0
      }
      className="bg-amber-600 text-white hover:bg-amber-700"
    >
      {model.isPending ? (
        <>
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          جاري الحفظ...
        </>
      ) : (
        <>
          <Check className="mr-1.5 h-4 w-4" />
          خصم من الدرج الآن
        </>
      )}
    </Button>
  </div>
);
