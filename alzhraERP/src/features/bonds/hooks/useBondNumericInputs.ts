/* eslint-disable max-lines-per-function, @typescript-eslint/explicit-function-return-type */
import type React from 'react';
import { useState, useCallback } from 'react';
import type { UseFormSetValue, UseFormWatch } from 'react-hook-form';
import type { BondFormData } from '../types';
import { sanitizeNumericInput } from '../../../core/utils/currencyUtils';

interface UseBondNumericInputsProps {
  selectedCurrency: string;
  setValue: UseFormSetValue<BondFormData>;
  watch: UseFormWatch<BondFormData>;
}

export function useBondNumericInputs({
  selectedCurrency,
  setValue,
  watch,
}: UseBondNumericInputsProps) {
  // Controlled String States for strict English digits sanitization (No Arabic numerals)
  const [amountInputStr, setAmountInputStr] = useState<string>('');
  const [rateInputStr, setRateInputStr] = useState<string>('1');
  const [equivalentSarInputStr, setEquivalentSarInputStr] = useState<string>('');
  const [commissionInputStr, setCommissionInputStr] = useState<string>('');

  const resetNumericInputs = useCallback(() => {
    setAmountInputStr('');
    setRateInputStr('1');
    setEquivalentSarInputStr('');
    setCommissionInputStr('');
  }, []);

  const handleAmountChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeNumericInput(e.target.value);
      setAmountInputStr(sanitized);
      const numVal = sanitized === '' ? 0 : parseFloat(sanitized);
      const cleanNum = isNaN(numVal) ? 0 : numVal;
      if (selectedCurrency === 'SAR') {
        setValue('amount', cleanNum);
      } else {
        setValue('foreign_amount', cleanNum);
      }
    },
    [selectedCurrency, setValue]
  );

  const handleRateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeNumericInput(e.target.value);
      setRateInputStr(sanitized);
      const numVal = sanitized === '' ? 1 : parseFloat(sanitized);
      const cleanNum = isNaN(numVal) || numVal <= 0 ? 1 : numVal;
      setValue('exchange_rate', cleanNum);
    },
    [setValue]
  );

  const handleEquivalentSarChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const sanitized = sanitizeNumericInput(e.target.value);
    setEquivalentSarInputStr(sanitized);
  }, []);

  const handleQuickAmount = useCallback(
    (delta: number) => {
      const watchVal = watch(selectedCurrency === 'SAR' ? 'amount' : 'foreign_amount');
      const current = typeof watchVal === 'number' ? watchVal : 0;
      const updated = Math.max(0, current + delta);
      if (selectedCurrency === 'SAR') {
        setValue('amount', updated);
      } else {
        setValue('foreign_amount', updated);
      }
      setAmountInputStr(String(updated));
    },
    [selectedCurrency, setValue, watch]
  );

  const handleClearAmount = useCallback(() => {
    if (selectedCurrency === 'SAR') {
      setValue('amount', 0);
    } else {
      setValue('foreign_amount', 0);
    }
    setAmountInputStr('');
    setEquivalentSarInputStr('');
  }, [selectedCurrency, setValue]);

  const handleCommissionChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const sanitized = sanitizeNumericInput(e.target.value);
      setCommissionInputStr(sanitized);
      const numVal = sanitized === '' ? 0 : parseFloat(sanitized);
      setValue('commission_amount', isNaN(numVal) ? 0 : numVal);
    },
    [setValue]
  );

  return {
    amountInputStr,
    setAmountInputStr,
    rateInputStr,
    setRateInputStr,
    equivalentSarInputStr,
    setEquivalentSarInputStr,
    commissionInputStr,
    setCommissionInputStr,
    resetNumericInputs,
    handleAmountChange,
    handleRateChange,
    handleEquivalentSarChange,
    handleQuickAmount,
    handleClearAmount,
    handleCommissionChange,
  };
}
