/* eslint-disable complexity, max-lines-per-function, max-params, @typescript-eslint/explicit-function-return-type, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-nullish-coalescing */
import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { ArrowDown, ArrowRightLeft, ArrowUpCircle } from 'lucide-react';
import type { BondFormData, BondType } from '../types';
import { useAccounts } from '../../accounting/hooks/index';
import { useParties } from '../../parties/hooks';
import { useFeedbackStore } from '../../feedback/store';
import { formatLocalDate } from '../../../core/utils';
import { convertToBaseCurrency, ensureLatinDigits } from '../../../core/utils/currencyUtils';
import { createIdempotencyKey } from '../../../core/utils/idempotency';
import { useBondNumericInputs } from './useBondNumericInputs';
import { useBondCurrencyConversion } from './useBondCurrencyConversion';

/**
 * تعبئة مسبقة لنموذج السند — تُستخدم من منظومة الديون («تحصيل الآن»).
 * يجب تمرير كائن ثابت الهوية (useMemo) وإلا أُعيدت التعبئة أثناء الكتابة.
 */
export interface BondPrefill {
  partyId: string;
  partyName?: string;
  amount: number;
  currencyCode?: string;
  invoiceId?: string;
  description?: string;
}

interface PartySelectOption {
  id: string;
  name: string;
}

interface InvoiceSelectOption {
  id: string;
  invoice_number?: string;
  total_amount?: number | string;
  paid_amount?: number | string;
  currency_code?: string;
  currency?: string;
  exchange_rate?: number | string;
}

export function useBondForm(
  isOpen: boolean,
  type: BondType,
  defaultAccountId: string | null | undefined,
  onSubmit: (data: BondFormData) => void,
  prefill?: BondPrefill | null
) {
  const { data: allAccounts } = useAccounts();
  const { showToast } = useFeedbackStore();
  const [partyQuery, setPartyQuery] = useState('');
  const [showPartyDropdown, setShowPartyDropdown] = useState(false);

  const { data: allParties } = useParties('all', partyQuery);

  const parties = useMemo(() => {
    return allParties || [];
  }, [allParties]);

  const idempotencyKeyRef = React.useRef(createIdempotencyKey('bond'));

  const { register, handleSubmit, reset, watch, setValue } = useForm<BondFormData>({
    defaultValues: {
      type,
      date: formatLocalDate(),
      currency_code: 'SAR',
      exchange_rate: 1,
      counterparty_type: type === 'transfer' ? 'account' : 'party',
      payment_method: 'cash',
      cash_account_id: defaultAccountId || '',
    },
  });

  const selectedCurrency = watch('currency_code');
  const counterpartyType = watch('counterparty_type');
  const counterpartyId = watch('counterparty_id');
  const selectedInvoiceId = watch('invoice_id');
  const cashAccountId = watch('cash_account_id');
  const commissionAmount = watch('commission_amount') || 0;
  const commissionAccountId = watch('commission_account_id');

  // Sub-hook 1: Strict Latin digit sanitization & input string states
  const numericInputs = useBondNumericInputs({
    selectedCurrency,
    setValue,
    watch,
  });

  const {
    amountInputStr,
    setAmountInputStr,
    rateInputStr,
    setRateInputStr,
    equivalentSarInputStr,
    setEquivalentSarInputStr,
    commissionInputStr,
    resetNumericInputs,
    handleAmountChange,
    handleRateChange,
    handleEquivalentSarChange,
    handleQuickAmount,
    handleClearAmount,
    handleCommissionChange,
  } = numericInputs;

  // Sub-hook 2: Currency conversion, rate resolution, and tafqeet
  const currencyConversion = useBondCurrencyConversion({
    selectedCurrency,
    setValue,
    watch,
    amountInputStr,
    equivalentSarInputStr,
    setRateInputStr,
    setEquivalentSarInputStr,
  });

  const {
    currencies,
    rates,
    currencyObj,
    isDivide,
    tafqeetText,
    enteredAmount,
    handleCalculateRateFromEquivalent,
    handleCurrencyQuickSwitch,
  } = currencyConversion;

  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = createIdempotencyKey('bond');
      const targetAccount = defaultAccountId
        ? allAccounts?.find(a => a.id === defaultAccountId)
        : undefined;
      const initialCurrency = targetAccount?.currency_code || 'SAR';

      reset({
        type,
        date: formatLocalDate(),
        currency_code: initialCurrency,
        exchange_rate: 1,
        counterparty_type: type === 'transfer' ? 'account' : 'party',
        payment_method: 'cash',
        cash_account_id: defaultAccountId || '',
      });
      setPartyQuery('');
      setShowPartyDropdown(false);
      resetNumericInputs();
    }
  }, [isOpen, type, reset, defaultAccountId, allAccounts, resetNumericInputs]);

  // Prefill hook from debt management ("Collect Now")
  useEffect(() => {
    if (!isOpen || !prefill) return;
    const currency = prefill.currencyCode || 'SAR';
    const partyLabel = prefill.partyName ? `: ${prefill.partyName}` : '';

    setValue('counterparty_type', 'party');
    setValue('counterparty_id', prefill.partyId);
    setValue('currency_code', currency);
    setValue('description', prefill.description || `تحصيل دفعة من العميل${partyLabel}`);
    if (prefill.invoiceId) setValue('invoice_id', prefill.invoiceId);

    setAmountInputStr(prefill.amount > 0 ? String(prefill.amount) : '');
    if (currency === 'SAR') {
      setValue('amount', prefill.amount);
      setValue('foreign_amount', 0);
    } else {
      setValue('foreign_amount', prefill.amount);
    }

    setPartyQuery(prefill.partyName ?? '');
    setShowPartyDropdown(false);
  }, [isOpen, prefill, setValue, setAmountInputStr]);

  const { cashAccounts, otherAccounts } = useMemo(() => {
    const cash = allAccounts?.filter(acc => acc.code.startsWith('10')) || [];
    const others = allAccounts?.filter(acc => !acc.code.startsWith('10')) || [];
    return { cashAccounts: cash, otherAccounts: others };
  }, [allAccounts]);

  // Auto-select primary cash account if none selected
  useEffect(() => {
    if (cashAccounts.length > 0 && !watch('cash_account_id')) {
      const primaryCash = cashAccounts.find(a => a.code === '1010') || cashAccounts[0];
      if (primaryCash) {
        setValue('cash_account_id', primaryCash.id);
      }
    }
  }, [cashAccounts, setValue, watch]);

  const handlePartySelect = useCallback(
    (party: PartySelectOption) => {
      setValue('counterparty_id', party.id);
      setValue('invoice_id', undefined);
      setPartyQuery(party.name);
      setShowPartyDropdown(false);
    },
    [setValue]
  );

  const handleInvoiceSelect = useCallback(
    (inv: InvoiceSelectOption | null | undefined) => {
      if (!inv) {
        setValue('invoice_id', undefined);
        return;
      }
      setValue('invoice_id', inv.id);
      const remaining = Number(inv.total_amount) - Number(inv.paid_amount || 0);
      const invCurrency = inv.currency_code || inv.currency || 'SAR';
      const invRate = Number(inv.exchange_rate) || (invCurrency === 'YER' ? 410 : 1);

      setValue('currency_code', invCurrency);
      setValue('exchange_rate', invRate);
      setRateInputStr(String(invRate));

      if (invCurrency !== 'SAR') {
        setValue('foreign_amount', remaining);
        setAmountInputStr(String(remaining));
        const baseAmount = convertToBaseCurrency({
          amount: remaining,
          currencyCode: invCurrency,
          exchangeRate: invRate,
          exchangeOperator:
            (currencyObj?.exchange_operator as 'multiply' | 'divide') ||
            (invCurrency === 'YER' ? 'divide' : 'multiply'),
        });
        setValue('amount', baseAmount);
        setEquivalentSarInputStr(String(baseAmount));
      } else {
        setValue('amount', remaining);
        setValue('foreign_amount', 0);
        setAmountInputStr(String(remaining));
        setEquivalentSarInputStr(String(remaining));
      }

      setValue(
        'description',
        `سداد فاتورة ${type === 'receipt' ? 'مبيعات' : 'مشتريات'} رقم ${inv.invoice_number ?? ''}`
      );
    },
    [type, currencyObj, setValue, setRateInputStr, setAmountInputStr, setEquivalentSarInputStr]
  );

  const onValidSubmit = useCallback(
    (data: BondFormData) => {
      // 1. Sanitize reference number
      if (data.reference_number) {
        data.reference_number = ensureLatinDigits(data.reference_number);
      }

      // 2. Validate transfer accounts
      if (
        type === 'transfer' &&
        data.cash_account_id &&
        data.counterparty_id &&
        data.cash_account_id === data.counterparty_id
      ) {
        showToast(
          'لا يمكن إجراء تحويل داخلي إلى نفس الحساب (حساب المصدر وحساب الهدف متطابقان)',
          'error'
        );
        return;
      }

      // 3. Validate positive amount
      const mainAmount =
        data.currency_code === 'SAR' ? data.amount : data.foreign_amount || data.amount;
      if (!mainAmount || mainAmount <= 0) {
        showToast('يجب إدخال مبلغ صحيح أكبر من الصفر', 'error');
        return;
      }

      // 4. Validate exchange rate for foreign currency
      if (data.currency_code !== 'SAR' && (!data.exchange_rate || data.exchange_rate <= 0)) {
        showToast('يجب تحديد سعر صرف صالح أكبر من الصفر', 'error');
        return;
      }

      // 5. Validate commission account if commission amount is entered
      if (data.commission_amount && data.commission_amount > 0 && !data.commission_account_id) {
        showToast('يجب تحديد الحساب المحاسبي لتوجيه مبلغ العمولة / الخصم', 'error');
        return;
      }

      onSubmit({ ...data, idempotency_key: idempotencyKeyRef.current });
    },
    [type, showToast, onSubmit]
  );

  // Derived Account Names for Live Journal Preview
  const selectedCashAccount = useMemo(() => {
    return cashAccounts.find(a => a.id === cashAccountId);
  }, [cashAccounts, cashAccountId]);

  const selectedCounterpartyAccount = useMemo(() => {
    if (counterpartyType === 'account') {
      return (type === 'transfer' ? cashAccounts : otherAccounts).find(
        a => a.id === counterpartyId
      );
    }
    return null;
  }, [counterpartyType, counterpartyId, type, cashAccounts, otherAccounts]);

  const selectedParty = useMemo(() => {
    if (counterpartyType === 'party') {
      return parties.find(p => p.id === counterpartyId);
    }
    return null;
  }, [counterpartyType, counterpartyId, parties]);

  const selectedCommissionAccount = useMemo(() => {
    return otherAccounts.find(a => a.id === commissionAccountId);
  }, [otherAccounts, commissionAccountId]);

  const theme = useMemo(() => {
    if (type === 'receipt') {
      return {
        color: 'emerald',
        icon: ArrowDown,
        title: 'سند قبض جديد',
        description: 'تسجيل عملية قبض نقدية أو بنكية في وضع ملء الشاشة للكمبيوتر',
      };
    }
    if (type === 'transfer') {
      return {
        color: 'blue',
        icon: ArrowRightLeft,
        title: 'تحويل داخلي جديد',
        description: 'تحويل مبالغ بين الخزائن والحسابات البنكية في وضع ملء الشاشة للكمبيوتر',
      };
    }
    return {
      color: 'rose',
      icon: ArrowUpCircle,
      title: 'سند صرف جديد',
      description: 'تسجيل عملية صرف نقدية أو بنكية في وضع ملء الشاشة للكمبيوتر',
    };
  }, [type]);

  return {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    currencies,
    rates,
    parties,
    partyQuery,
    setPartyQuery,
    showPartyDropdown,
    setShowPartyDropdown,
    selectedCurrency,
    counterpartyType,
    counterpartyId,
    selectedInvoiceId,
    cashAccountId,
    enteredAmount,
    commissionAmount,
    currencyObj,
    isDivide,
    cashAccounts,
    otherAccounts,
    handlePartySelect,
    handleInvoiceSelect,
    handleQuickAmount,
    handleClearAmount,
    onValidSubmit,
    selectedCashAccount,
    selectedCounterpartyAccount,
    selectedParty,
    selectedCommissionAccount,
    tafqeetText,
    theme,
    amountInputStr,
    rateInputStr,
    equivalentSarInputStr,
    commissionInputStr,
    handleAmountChange,
    handleRateChange,
    handleEquivalentSarChange,
    handleCalculateRateFromEquivalent,
    handleCurrencyQuickSwitch,
    handleCommissionChange,
  };
}
