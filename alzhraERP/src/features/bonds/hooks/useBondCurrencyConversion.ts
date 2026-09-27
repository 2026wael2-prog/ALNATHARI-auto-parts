/* eslint-disable max-lines-per-function, complexity, @typescript-eslint/explicit-function-return-type, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unnecessary-condition, @typescript-eslint/prefer-nullish-coalescing */
import { useEffect, useMemo, useCallback } from 'react';
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import type { BondFormData } from '../types';
import { useCurrencies } from '../../settings/hooks';
import { useFeedbackStore } from '../../feedback/store';
import { convertToBaseCurrency } from '../../../core/utils/currencyUtils';
import { tafqeet } from '../../../core/utils/tafqeet';
import { logger } from '../../../core/utils/logger';

interface UseBondCurrencyConversionProps {
  selectedCurrency: string;
  setValue: UseFormSetValue<BondFormData>;
  watch: UseFormWatch<BondFormData>;
  amountInputStr: string;
  equivalentSarInputStr: string;
  setRateInputStr: (val: string) => void;
  setEquivalentSarInputStr: (val: string) => void;
}

export function useBondCurrencyConversion({
  selectedCurrency,
  setValue,
  watch,
  amountInputStr,
  equivalentSarInputStr,
  setRateInputStr,
  setEquivalentSarInputStr,
}: UseBondCurrencyConversionProps) {
  const { currencies, rates } = useCurrencies();
  const { showToast } = useFeedbackStore();

  const enteredAmount = watch(selectedCurrency === 'SAR' ? 'amount' : 'foreign_amount') || 0;
  const foreignAmount = watch('foreign_amount');
  const exchangeRate = watch('exchange_rate');

  const currencyObj = useMemo(() => {
    return currencies.data?.find(
      (c: { code: string; exchange_operator?: string }) => c.code === selectedCurrency
    );
  }, [currencies.data, selectedCurrency]);

  const isDivide = currencyObj?.exchange_operator === 'divide';

  // Tafqeet text for quick confirmation
  const tafqeetText = useMemo(() => {
    if (!enteredAmount || enteredAmount <= 0) return '';
    const label =
      selectedCurrency === 'YER'
        ? 'ريال يمني'
        : selectedCurrency === 'SAR'
          ? 'ريال سعودي'
          : selectedCurrency;
    try {
      return tafqeet(enteredAmount, label);
    } catch {
      return '';
    }
  }, [enteredAmount, selectedCurrency]);

  // Currency switch and default rate loader
  useEffect(() => {
    if (selectedCurrency === 'SAR') {
      setValue('exchange_rate', 1);
      setValue('foreign_amount', 0);
      setRateInputStr('1');
      setEquivalentSarInputStr('');
    } else {
      const rate = rates.data?.find(
        (r: { currency_code: string; rate_to_base: number }) => r.currency_code === selectedCurrency
      );
      // For YER, if no rate or 1 is set, default to 410 (standard Yemeni Rial market divider)
      const defaultRate =
        rate?.rate_to_base && rate.rate_to_base !== 1
          ? rate.rate_to_base
          : selectedCurrency === 'YER'
            ? 410
            : 1;

      setValue('exchange_rate', defaultRate);
      setRateInputStr(String(defaultRate));
    }
  }, [selectedCurrency, rates.data, setValue, setRateInputStr, setEquivalentSarInputStr]);

  // Sync equivalent base amount (SAR)
  useEffect(() => {
    if (selectedCurrency !== 'SAR' && foreignAmount && exchangeRate) {
      try {
        const baseAmount = convertToBaseCurrency({
          amount: foreignAmount,
          currencyCode: selectedCurrency,
          exchangeRate: exchangeRate,
          exchangeOperator:
            (currencyObj?.exchange_operator as 'multiply' | 'divide') ||
            (selectedCurrency === 'YER' ? 'divide' : 'multiply'),
        });
        setValue('amount', baseAmount);
        setEquivalentSarInputStr(String(baseAmount));
      } catch (e) {
        logger.error('useBondCurrencyConversion', 'Conversion failed', e);
      }
    } else if (selectedCurrency === 'SAR') {
      const sarAmount = watch('amount') || 0;
      setEquivalentSarInputStr(sarAmount > 0 ? String(sarAmount) : '');
    }
  }, [
    selectedCurrency,
    foreignAmount,
    exchangeRate,
    currencyObj,
    setValue,
    watch,
    setEquivalentSarInputStr,
  ]);

  // Smart Bi-directional Auto Calculation of Exchange Rate
  const handleCalculateRateFromEquivalent = useCallback(() => {
    const sarVal = parseFloat(equivalentSarInputStr);
    const foreignVal = parseFloat(amountInputStr);
    if (isNaN(sarVal) || sarVal <= 0 || isNaN(foreignVal) || foreignVal <= 0) {
      showToast('يجب إدخال المبلغ والمقابل بالريال السعودي لحساب سعر الصرف تلقائياً', 'warning');
      return;
    }
    const currentIsDivide =
      currencyObj?.exchange_operator === 'divide' || selectedCurrency === 'YER';
    let calculatedRate = 1;
    if (currentIsDivide) {
      // SAR = YER / Rate => Rate = YER / SAR
      calculatedRate = Math.round((foreignVal / sarVal) * 10000) / 10000;
    } else {
      // SAR = USD * Rate => Rate = SAR / USD
      calculatedRate = Math.round((sarVal / foreignVal) * 10000) / 10000;
    }
    setValue('exchange_rate', calculatedRate);
    setRateInputStr(String(calculatedRate));
    setValue('amount', sarVal);
    showToast(`تم حساب وتثبيت سعر الصرف تلقائياً: ${String(calculatedRate)}`, 'success');
  }, [
    equivalentSarInputStr,
    amountInputStr,
    currencyObj,
    selectedCurrency,
    setValue,
    setRateInputStr,
    showToast,
  ]);

  const handleCurrencyQuickSwitch = useCallback(
    (newCurrency: string) => {
      setValue('currency_code', newCurrency);
      if (newCurrency === 'SAR') {
        setValue('exchange_rate', 1);
        setRateInputStr('1');
        const curAmount = parseFloat(amountInputStr) || 0;
        setValue('amount', curAmount);
        setValue('foreign_amount', 0);
      } else {
        const rate = rates.data?.find(
          (r: { currency_code: string; rate_to_base: number }) => r.currency_code === newCurrency
        );
        const defaultRate =
          rate?.rate_to_base && rate.rate_to_base !== 1
            ? rate.rate_to_base
            : newCurrency === 'YER'
              ? 410
              : 1;
        setValue('exchange_rate', defaultRate);
        setRateInputStr(String(defaultRate));
        const curAmount = parseFloat(amountInputStr) || 0;
        setValue('foreign_amount', curAmount);
      }
    },
    [rates.data, amountInputStr, setValue, setRateInputStr]
  );

  return {
    currencies,
    rates,
    currencyObj,
    isDivide,
    tafqeetText,
    enteredAmount,
    handleCalculateRateFromEquivalent,
    handleCurrencyQuickSwitch,
  };
}
