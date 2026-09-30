import { useEffect, useRef, useState } from 'react';
import { formatLocalDate } from '../../../core/utils/dateUtils';
import { useAuthStore } from '../../auth/store';
import { useBranchFilter } from '../../branches/hooks/useBranchFilter';
import { useFeedbackStore } from '../../feedback/store';
import {
  useCommitDailyReconciliation,
  useDailyDrawerSummary,
  useReconciliationHistory,
} from '../hooks/useDailyReconciliation';
import type {
  CashDenominationCounts,
  DailyDrawerSummary,
  ExistingReconciliationRecord,
} from '../types';
import type {
  CountMode,
  ReconciliationFormApi,
  ReconciliationModalsApi,
  ReconciliationView,
} from './DailyReconciliationPage.helpers';
import {
  buildCommitPayload,
  buildZeroCashConfirmMessage,
  deriveReconciliationView,
  planSummarySync,
  resolveShopName,
  resolveVarianceReasonBlocker,
} from './DailyReconciliationPage.helpers';

const useReconciliationModals = (): ReconciliationModalsApi => {
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isPrintModalOpen, setIsPrintModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

  return {
    isExpenseModalOpen,
    isPrintModalOpen,
    isHistoryModalOpen,
    openExpenseModal: () => {
      setIsExpenseModalOpen(true);
    },
    closeExpenseModal: () => {
      setIsExpenseModalOpen(false);
    },
    openPrintModal: () => {
      setIsPrintModalOpen(true);
    },
    closePrintModal: () => {
      setIsPrintModalOpen(false);
    },
    openHistoryModal: () => {
      setIsHistoryModalOpen(true);
    },
    closeHistoryModal: () => {
      setIsHistoryModalOpen(false);
    },
  };
};

/**
 * سبب تجاوز حد max-lines-per-function هنا ليس تشعّباً منطقياً (التعقيد الدوري = 1)
 * بل توسيع المُنسِّق (prettier) لكائن API مسطح من 8 قيم + 8 محدِّثات تستهلكه ستة أقسام؛
 * أي تقسيم إضافي سينقل الأسطر فقط أو يكسر شكل الـ API المسطح المستخدم في الواجهة.
 */
// eslint-disable-next-line max-lines-per-function -- حاوية حالة مسطحة سببُ طولها توسيع المُنسِّق لا تعقيد المنطق
const useReconciliationFormState = (
  selectedDate: string,
  summary: DailyDrawerSummary | undefined
): ReconciliationFormApi => {
  const [countMode, setCountMode] = useState<CountMode>('quick');
  const [cashCounts, setCashCounts] = useState<CashDenominationCounts>({});
  const [manualCashTotal, setManualCashTotal] = useState<number>(0);
  const [actualCard, setActualCard] = useState<number>(0);
  const [cardTerminalRef, setCardTerminalRef] = useState<string>('');
  const [floatRetained, setFloatRetained] = useState<number>(300);
  const [varianceReason, setVarianceReason] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Reset form state when date changes to prevent stale data from previous day
  useEffect(() => {
    setCashCounts({});
    setManualCashTotal(0);
    setCountMode('quick');
    setActualCard(0);
    setCardTerminalRef('');
    setFloatRetained(300);
    setVarianceReason('');
    setNotes('');
  }, [selectedDate]);

  // Sync state when existing reconciliation is loaded
  useEffect(() => {
    const plan = planSummarySync(summary);
    if (plan === null) return;
    if (plan.kind === 'expected-card') {
      setActualCard(plan.actualCard);
      return;
    }
    setCashCounts(plan.cashCounts);
    setManualCashTotal(plan.manualCashTotal);
    setCountMode(plan.countMode);
    setActualCard(plan.actualCard);
    setFloatRetained(plan.floatRetained);
    setVarianceReason(plan.varianceReason);
    setNotes(plan.notes);
  }, [summary]);

  return {
    values: {
      countMode,
      cashCounts,
      manualCashTotal,
      actualCard,
      cardTerminalRef,
      floatRetained,
      varianceReason,
      notes,
    },
    setCountMode,
    setCashCounts,
    setManualCashTotal,
    setActualCard,
    setCardTerminalRef,
    setFloatRetained,
    setVarianceReason,
    setNotes,
  };
};

interface CommitHandlerParams {
  companyId: string | undefined;
  branchId: string | null | undefined;
  selectedDate: string;
  summary: DailyDrawerSummary | undefined;
  view: ReconciliationView;
  form: ReconciliationFormApi;
  commitReconciliation: ReturnType<typeof useCommitDailyReconciliation>['mutate'];
  showToast: (message: string, type: 'warning') => void;
}

const useReconciliationCommit = ({
  companyId,
  branchId,
  selectedDate,
  summary,
  view,
  form,
  commitReconciliation,
  showToast,
}: CommitHandlerParams): (() => void) => {
  const isSubmittingRef = useRef(false);

  return (): void => {
    if (companyId === undefined || companyId === '') return;
    if (isSubmittingRef.current) return;
    if (view.actualCashCounted === 0 && view.expectedCash > 0) {
      if (!confirm(buildZeroCashConfirmMessage(view.currency))) return;
    }

    const varianceBlocker = resolveVarianceReasonBlocker(
      view.cashVarianceInfo.isWithinTolerance,
      form.values.varianceReason
    );
    if (varianceBlocker !== null) {
      showToast(varianceBlocker, 'warning');
      return;
    }

    isSubmittingRef.current = true;
    commitReconciliation(
      buildCommitPayload(companyId, selectedDate, {
        branchId,
        summary,
        actualCashCounted: view.actualCashCounted,
        countMode: form.values.countMode,
        cashCounts: form.values.cashCounts,
        actualCard: form.values.actualCard,
        floatRetained: form.values.floatRetained,
        cashToOwner: view.cashToOwner,
        varianceReason: form.values.varianceReason,
        notes: form.values.notes,
      }),
      {
        onSettled: () => {
          isSubmittingRef.current = false;
        },
      }
    );
  };
};

export interface ReconciliationPageController {
  summary: DailyDrawerSummary | undefined;
  view: ReconciliationView;
  form: ReconciliationFormApi;
  modals: ReconciliationModalsApi;
  isLoading: boolean;
  isError: boolean;
  isCommitting: boolean;
  historyList: ExistingReconciliationRecord[] | undefined;
  isHistoryLoading: boolean;
  selectedDate: string;
  onDateChange: (date: string) => void;
  branchName: string | null | undefined;
  shopName: string;
  handleRetry: () => void;
  handleCommit: () => void;
}

/**
 * متحكّم صفحة المطابقة اليومية: يجمع الاستعلامات والحالة المشتقة ومعالجات الأحداث
 * في كائن واحد، لتبقى الصفحة طبقة عرض رقيقة قابلة للقراءة والمراجعة.
 */
export const useReconciliationPageController = (): ReconciliationPageController => {
  const { user } = useAuthStore();
  const { branchId, branchName } = useBranchFilter();
  const [selectedDate, setSelectedDate] = useState<string>(() => formatLocalDate());
  const modals = useReconciliationModals();
  const { showToast } = useFeedbackStore();
  const { data: summary, isLoading, isError, refetch } = useDailyDrawerSummary(selectedDate);
  const { mutate: commitReconciliation, isPending: isCommitting } = useCommitDailyReconciliation();
  const { data: historyList, isLoading: isHistoryLoading } = useReconciliationHistory(30);
  const form = useReconciliationFormState(selectedDate, summary);
  const view = deriveReconciliationView(summary, form.values, user?.role);
  const handleCommit = useReconciliationCommit({
    companyId: user?.company_id,
    branchId,
    selectedDate,
    summary,
    view,
    form,
    commitReconciliation,
    showToast,
  });
  const handleRetry = (): void => {
    void refetch();
  };

  return {
    summary,
    view,
    form,
    modals,
    isLoading,
    isError,
    isCommitting,
    historyList,
    isHistoryLoading,
    selectedDate,
    onDateChange: setSelectedDate,
    branchName,
    shopName: resolveShopName(user?.company_name),
    handleRetry,
    handleCommit,
  };
};
