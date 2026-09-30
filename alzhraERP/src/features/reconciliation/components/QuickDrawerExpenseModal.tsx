import React, { useEffect, useMemo, useRef, useState } from 'react';
import Modal from '../../../ui/base/Modal';
import { useAuthStore } from '../../auth/store';
import { useBranchFilter } from '../../branches/hooks/useBranchFilter';
import { useRecordQuickDrawerExpense } from '../hooks/useDailyReconciliation';
import { useCurrencies } from '../../settings/hooks';
import type { ExchangeRate, SupportedCurrency } from '../../settings/types';
import { CURRENCY_SYMBOLS, formatLocalDate, toBaseCurrency } from '../../../core/utils';
import { resolveAutoExchangeRate } from '../../../core/utils/currencyUtils';
import { createIdempotencyKey } from '../../../core/utils/idempotency';
import type { QuickDrawerExpenseDTO } from '../types';
import {
  ExpenseAmountSection,
  ExpenseDescriptionSection,
  ExpenseExchangeRateSection,
  ExpenseFormActions,
  ExpenseIntroBanner,
  OverstatedSarNotice,
} from './QuickDrawerExpenseModal.sections';

interface QuickDrawerExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: string;
  /** عملة المنشأة الأساسية كما أعلنها الخادم — المبالغ تُحوَّل إليها قبل الترحيل */
  baseCurrency?: string | undefined;
  /** ذاكرة العملة القادمة من الخادم (آخر مصروف نثري) لتفادي فرض SAR قسراً */
  lastExpenseCurrency?: string | null | undefined;
}

/**
 * نفس مفتاح ذاكرة العملة المستخدم في شاشة المصروفات (`useExpenseForm`) لضمان
 * تذكّر آخر عملة اختارها المستخدم في الوحدتين معاً بدل تفرّق التفضيلات.
 */
const LAST_PETTY_CURRENCY_KEY = 'alzhra_last_expense_currency';

const readStoredCurrency = (): string | null => {
  try {
    return localStorage.getItem(LAST_PETTY_CURRENCY_KEY);
  } catch {
    return null;
  }
};

const persistStoredCurrency = (code: string): void => {
  try {
    localStorage.setItem(LAST_PETTY_CURRENCY_KEY, code);
  } catch {
    // تجاهل أخطاء التخزين المحلي (وضع التصفح الخاص / امتلاء الحصة)
  }
};

/** حد تنبيه المبالغ الكبيرة بالريال السعودي (نفس حارس شاشة المصروفات) */
const SAR_OVERSTATEMENT_THRESHOLD = 500;

/**
 * أول رمز عملة غير فارغ من القائمة: ذاكرة الخادم ← ذاكرة الجهاز ← عملة المنشأة ← SAR.
 * يستخدم `find` بدل سلسلة `||` لأن الرمز الفارغ/الفاصل يُعدّ قيمة «موجودة» في `||`
 * فيهبط التفضيل إلى SAR قسراً (وهو أصل تضخّم المصروفات بالريال السعودي).
 */
const pickCurrencyCode = (...candidates: Array<string | null | undefined>): string => {
  const found = candidates.find(candidate => (candidate ?? '').trim().length > 0);
  return (found ?? 'SAR').trim().toUpperCase();
};

/** تحويل مُدخل نصي إلى رقم صالح (0 عند الفراغ أو النص غير الرقمي) */
const toNumberOrZero = (raw: string): number => {
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * حارس المبالغ غير المنطقية: مبلغ كبير بالريال السعودي في منشأة أساسها الريال اليمني.
 * بدون هذا التنبيه يُسجَّل 500 ر.س كما هي فتظهر مضخَّمة ×410 في الدفاتر.
 */
const isOverstatedSarAmount = (
  currencyCode: string,
  baseCurrency: string,
  amount: number
): boolean =>
  currencyCode.trim().toUpperCase() === 'SAR' &&
  baseCurrency === 'YER' &&
  amount >= SAR_OVERSTATEMENT_THRESHOLD;

/** تاريخ المصروف: تاريخ اليومية المختار وليس تاريخ جهاز المستخدم (دون انزياح UTC) */
const resolveExpenseDate = (date?: string): string => {
  const trimmed = (date ?? '').trim();
  return trimmed.length > 0 ? trimmed : formatLocalDate();
};

/** قوائم العملات وأسعار الصرف القادمة من الإعدادات (نفس تغليف useMemo السابق) */
interface ExpenseCurrencyCatalogState {
  currencyList: SupportedCurrency[];
  rateList: ExchangeRate[];
}

/** حالة حقول النموذج ومُعدِّلاتها — المصدر الوحيد للحقيقة داخل النموذج */
interface QuickDrawerExpenseFormState {
  amount: string;
  description: string;
  currencyCode: string;
  exchangeRate: string;
  isManualRate: boolean;
  idempotencyKey: string;
  setAmount: React.Dispatch<React.SetStateAction<string>>;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  setCurrencyCode: React.Dispatch<React.SetStateAction<string>>;
  setExchangeRate: React.Dispatch<React.SetStateAction<string>>;
  setIsManualRate: React.Dispatch<React.SetStateAction<boolean>>;
  setIdempotencyKey: React.Dispatch<React.SetStateAction<string>>;
  /** حارس النقر المزدوج — يبقى مع الحالة في نفس المكوّن المالك */
  isSubmittingRef: React.RefObject<boolean>;
}

interface QuickDrawerExpenseFormStateParams {
  isOpen: boolean;
  lastExpenseCurrency: string | null | undefined;
  normalizedBaseCurrency: string;
  catalog: ExpenseCurrencyCatalogState;
}

/** المُشتقّات قبل الترحيل: المعادل بعملة المنشأة + حارس المبلغ غير المنطقي */
interface QuickDrawerExpensePreview {
  numericAmount: number;
  numericRate: number;
  isBaseCurrencySelected: boolean;
  basePreview: number;
  isOverstatedSar: boolean;
}

interface QuickDrawerExpensePreviewParams {
  state: QuickDrawerExpenseFormState;
  catalog: ExpenseCurrencyCatalogState;
  normalizedBaseCurrency: string;
}

/** مُعالجات العملة وسعر الصرف والتحويل لعملة المنشأة */
interface ExpenseCurrencyActions {
  currencyOptions: string[];
  handleCurrencyChange: (nextCode: string) => void;
  handleExchangeRateChange: (value: string) => void;
  handleResetAutoRate: () => void;
  handleConvertToBaseCurrency: () => void;
}

interface ExpenseCurrencyActionsParams {
  state: QuickDrawerExpenseFormState;
  catalog: ExpenseCurrencyCatalogState;
  preview: QuickDrawerExpensePreview;
  normalizedBaseCurrency: string;
}

/** بناء خيارات العملة الموحّدة */
interface ExpenseCurrencyOptionsParams {
  currencyList: SupportedCurrency[];
  normalizedBaseCurrency: string;
  currencyCode: string;
}

/** الإرسال: معالج الحفظ بمفتاح منع التكرار + حالة التحميل */
interface QuickDrawerExpenseSubmit {
  handleSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
  isPending: boolean;
}

interface QuickDrawerExpenseSubmitParams {
  onClose: () => void;
  selectedDate: string | undefined;
  state: QuickDrawerExpenseFormState;
  preview: QuickDrawerExpensePreview;
}

/** وسائط بناء حمولة الترحيل */
interface ExpensePayloadParams {
  companyId: string;
  branchId: string | null | undefined;
  selectedDate: string | undefined;
  state: QuickDrawerExpenseFormState;
  preview: QuickDrawerExpensePreview;
}

/** النموذج الكامل الذي يستهلكه العرض (الحالة + المُشتقّات + المُعالجات) */
interface QuickDrawerExpenseModel {
  normalizedBaseCurrency: string;
  state: QuickDrawerExpenseFormState;
  preview: QuickDrawerExpensePreview;
  actions: ExpenseCurrencyActions;
  isPending: boolean;
  handleSubmit: (event: React.SyntheticEvent<HTMLFormElement>) => void;
}

interface QuickDrawerExpenseModelParams {
  isOpen: boolean;
  onClose: () => void;
  selectedDate: string | undefined;
  baseCurrency: string;
  lastExpenseCurrency: string | null | undefined;
}

/**
 * حارس الإرسال: مبلغ صالح، بيان مكتوب، وسعر صرف موجب للعملات الأجنبية.
 * لا يجوز إرسال مبلغ بعملة أجنبية بسعر صرف صفري أو سالب — هذا ما كان يضخّم المبالغ
 * 410× عند غياب/تلف سعر الصرف، لذا نرفض الإرسال بدل ترحيل رقم خطأ.
 */
const isAmountAndRateReady = (
  amount: number,
  rate: number,
  description: string,
  isBaseCurrencySelected: boolean
): boolean => {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (description.trim().length === 0) return false;
  if (isBaseCurrencySelected) return true;
  return Number.isFinite(rate) && rate > 0;
};

/** حمولة الترحيل كما ينتظرها الخادم — نفس الحقول ونفس القيم السابقة */
const buildExpensePayload = (params: ExpensePayloadParams): QuickDrawerExpenseDTO => ({
  company_id: params.companyId,
  amount: params.preview.numericAmount,
  description: params.state.description.trim(),
  branch_id: params.branchId,
  expense_date: resolveExpenseDate(params.selectedDate),
  currency_code: params.state.currencyCode.toUpperCase(),
  exchange_rate: params.preview.isBaseCurrencySelected ? 1 : params.preview.numericRate,
  idempotency_key: params.state.idempotencyKey,
});

/** قوائم العملات وأسعار الصرف القادمة من الإعدادات */
const useExpenseCurrencyCatalog = (): ExpenseCurrencyCatalogState => {
  const { currencies, rates } = useCurrencies();
  const currencyList = useMemo(
    () => (currencies.data ?? []) as unknown as SupportedCurrency[],
    [currencies.data]
  );
  const rateList = useMemo(() => (rates.data ?? []) as unknown as ExchangeRate[], [rates.data]);
  return { currencyList, rateList };
};

/**
 * الحالة تبقى هنا (المالك الوحيد) وتُمرَّر للأسفل كنموذج للعرض فقط.
 * تجمع: الحقول + ذاكرة العملة (الخادم ← الجهاز ← عملة المنشأة) + سعر الصرف التلقائي.
 */
const useQuickDrawerExpenseFormState = (
  params: QuickDrawerExpenseFormStateParams
): QuickDrawerExpenseFormState => {
  const { isOpen, lastExpenseCurrency, normalizedBaseCurrency, catalog } = params;
  const { rateList, currencyList } = catalog;
  const [amount, setAmount] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [currencyCode, setCurrencyCode] = useState<string>('SAR');
  const [exchangeRate, setExchangeRate] = useState<string>('1');
  const [isManualRate, setIsManualRate] = useState(false);
  // مفتاح منع التكرار: يُولَّد مرة لكل «نية» حفظ ويُجدَّد بعد النجاح فقط
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    createIdempotencyKey('quick_drawer_expense')
  );
  const isSubmittingRef = useRef(false);

  // ذاكرة العملة: الخادم ← جهاز المستخدم ← عملة المنشأة الأساسية
  useEffect(() => {
    if (!isOpen) return;
    const remembered = pickCurrencyCode(
      lastExpenseCurrency,
      readStoredCurrency(),
      normalizedBaseCurrency
    );
    setCurrencyCode(remembered);
    setAmount('');
    setDescription('');
    setIsManualRate(false);
    isSubmittingRef.current = false;
  }, [isOpen, lastExpenseCurrency, normalizedBaseCurrency]);

  // سعر الصرف التلقائي ما لم يعدّله المستخدم يدوياً (نفس سلوك شاشة المصروفات)
  useEffect(() => {
    if (!isOpen || isManualRate) return;
    setExchangeRate(String(resolveAutoExchangeRate(currencyCode, rateList, currencyList)));
  }, [isOpen, currencyCode, isManualRate, rateList, currencyList]);

  return {
    amount,
    description,
    currencyCode,
    exchangeRate,
    isManualRate,
    idempotencyKey,
    setAmount,
    setDescription,
    setCurrencyCode,
    setExchangeRate,
    setIsManualRate,
    setIdempotencyKey,
    isSubmittingRef,
  };
};

/** المبلغ الرقمي + المعادل بعملة المنشأة + حارس المبالغ غير المنطقية */
const useQuickDrawerExpensePreview = (
  params: QuickDrawerExpensePreviewParams
): QuickDrawerExpensePreview => {
  const { state, catalog, normalizedBaseCurrency } = params;
  const { amount, exchangeRate, currencyCode } = state;
  const { rateList, currencyList } = catalog;
  const numericAmount = toNumberOrZero(amount);
  const numericRate = toNumberOrZero(exchangeRate);
  const isBaseCurrencySelected = currencyCode.toUpperCase() === normalizedBaseCurrency;

  // معاينة المبلغ بعملة الأساس — نفس معادلة fn_to_base_amount على الخادم
  const basePreview = useMemo(() => {
    if (numericAmount <= 0) return 0;
    if (isBaseCurrencySelected) return numericAmount;
    const rate =
      numericRate > 0 ? numericRate : resolveAutoExchangeRate(currencyCode, rateList, currencyList);
    try {
      return toBaseCurrency({
        amount: numericAmount,
        currency_code: currencyCode,
        exchange_rate: rate,
      });
    } catch {
      return 0;
    }
  }, [numericAmount, numericRate, currencyCode, isBaseCurrencySelected, rateList, currencyList]);

  // حارس المبالغ غير المنطقية: مبلغ كبير بالريال السعودي في منشأة أساسها الريال اليمني
  const isOverstatedSar = isOverstatedSarAmount(
    currencyCode,
    normalizedBaseCurrency,
    numericAmount
  );

  return { numericAmount, numericRate, isBaseCurrencySelected, basePreview, isOverstatedSar };
};

/** خيارات العملة الموحّدة (الإعدادات + رموز النظام + العملة المختارة) */
const useExpenseCurrencyOptions = (params: ExpenseCurrencyOptionsParams): string[] => {
  const { currencyList, normalizedBaseCurrency, currencyCode } = params;
  return useMemo(() => {
    const codes = new Set<string>([
      'SAR',
      normalizedBaseCurrency,
      ...currencyList.map(currency => currency.code.toUpperCase()),
      ...Object.keys(CURRENCY_SYMBOLS),
      currencyCode.toUpperCase(),
    ]);
    return Array.from(codes).sort();
  }, [currencyList, normalizedBaseCurrency, currencyCode]);
};

/** مُعالجات تغيير العملة وسعر الصرف والتحويل لعملة المنشأة */
const useExpenseCurrencyActions = (
  params: ExpenseCurrencyActionsParams
): ExpenseCurrencyActions => {
  const { state, catalog, preview, normalizedBaseCurrency } = params;
  const { currencyCode, setCurrencyCode, setIsManualRate, setExchangeRate, setAmount } = state;
  const { currencyList, rateList } = catalog;
  const currencyOptions = useExpenseCurrencyOptions({
    currencyList,
    normalizedBaseCurrency,
    currencyCode,
  });

  const handleCurrencyChange = (nextCode: string): void => {
    const code = nextCode.toUpperCase();
    setCurrencyCode(code);
    setIsManualRate(false);
    setExchangeRate(String(resolveAutoExchangeRate(code, rateList, currencyList)));
    persistStoredCurrency(code);
  };

  const handleExchangeRateChange = (value: string): void => {
    setIsManualRate(true);
    setExchangeRate(value);
  };

  const handleResetAutoRate = (): void => {
    setIsManualRate(false);
    setExchangeRate(String(resolveAutoExchangeRate(currencyCode, rateList, currencyList)));
  };

  const handleConvertToBaseCurrency = (): void => {
    if (preview.basePreview <= 0) {
      // لا معاينة صالحة (سعر صرف مفقود) → نكتفي بتبديل العملة وإعادة المبلغ كما هو
      handleCurrencyChange(normalizedBaseCurrency);
      return;
    }
    setCurrencyCode(normalizedBaseCurrency);
    setExchangeRate('1');
    setIsManualRate(false);
    setAmount(String(preview.basePreview));
    persistStoredCurrency(normalizedBaseCurrency);
  };

  return {
    currencyOptions,
    handleCurrencyChange,
    handleExchangeRateChange,
    handleResetAutoRate,
    handleConvertToBaseCurrency,
  };
};

/**
 * معالج الحفظ: يمنع النقر المزدوج (ref + مفتاح منع التكرار)، ويرفض الإرسال بلا
 * مبلغ أو بيان أو جلسة فعّالة (`company_id`)، أو بعملة أجنبية بسعر صرف غير موجب.
 */
const useQuickDrawerExpenseSubmit = (
  params: QuickDrawerExpenseSubmitParams
): QuickDrawerExpenseSubmit => {
  const { onClose, selectedDate, state, preview } = params;
  const {
    currencyCode,
    description,
    setAmount,
    setDescription,
    setIdempotencyKey,
    isSubmittingRef,
  } = state;
  const { numericAmount, numericRate, isBaseCurrencySelected } = preview;
  const { user } = useAuthStore();
  const { branchId } = useBranchFilter();
  const { mutate: recordExpense, isPending } = useRecordQuickDrawerExpense();

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (isSubmittingRef.current || isPending) return;
    const companyId = user?.company_id;
    if (companyId === undefined) return;
    if (!isAmountAndRateReady(numericAmount, numericRate, description, isBaseCurrencySelected)) {
      return;
    }

    // الـ ref يحمي من النقر المزدوج قبل بدء الحفظ، ثم يُحرَّر في onSettled
    isSubmittingRef.current = true;

    recordExpense(buildExpensePayload({ companyId, branchId, selectedDate, state, preview }), {
      onSuccess: () => {
        persistStoredCurrency(currencyCode.toUpperCase());
        setAmount('');
        setDescription('');
        // تجديد المفتاح للنية التالية (النقر المزدوج داخل النية نفسها يبقى مرفوضاً)
        setIdempotencyKey(createIdempotencyKey('quick_drawer_expense'));
        onClose();
      },
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  return { handleSubmit, isPending };
};

/**
 * تركيب (Composition) بلا أي منطق إضافي: يبني نموذج العرض الواحد من الـ hooks
 * الفرعية بنفس ترتيب اعتماد القيم السابق (القوائم ← الحالة ← المُشتقّات ← المُعالجات).
 */
const useQuickDrawerExpenseModel = (
  params: QuickDrawerExpenseModelParams
): QuickDrawerExpenseModel => {
  const { isOpen, onClose, selectedDate, baseCurrency, lastExpenseCurrency } = params;
  const normalizedBaseCurrency = pickCurrencyCode(baseCurrency);
  const catalog = useExpenseCurrencyCatalog();
  const state = useQuickDrawerExpenseFormState({
    isOpen,
    lastExpenseCurrency,
    normalizedBaseCurrency,
    catalog,
  });
  const preview = useQuickDrawerExpensePreview({ state, catalog, normalizedBaseCurrency });
  const actions = useExpenseCurrencyActions({ state, catalog, preview, normalizedBaseCurrency });
  const { handleSubmit, isPending } = useQuickDrawerExpenseSubmit({
    onClose,
    selectedDate,
    state,
    preview,
  });

  return {
    normalizedBaseCurrency,
    state,
    preview,
    actions,
    isPending,
    handleSubmit,
  };
};

export const QuickDrawerExpenseModal: React.FC<QuickDrawerExpenseModalProps> = ({
  isOpen,
  onClose,
  selectedDate,
  baseCurrency = 'SAR',
  lastExpenseCurrency,
}) => {
  const model = useQuickDrawerExpenseModel({
    isOpen,
    onClose,
    selectedDate,
    baseCurrency,
    lastExpenseCurrency,
  });

  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="تسجيل مصروف نثري من الدرج (سريع)">
      <form onSubmit={model.handleSubmit} className="space-y-4">
        <ExpenseIntroBanner />
        <ExpenseAmountSection model={model} />
        {!model.preview.isBaseCurrencySelected && <ExpenseExchangeRateSection model={model} />}
        {model.preview.isOverstatedSar && <OverstatedSarNotice model={model} />}
        <ExpenseDescriptionSection model={model} />
        <ExpenseFormActions model={model} onClose={onClose} />
      </form>
    </Modal>
  );
};
