import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { useAuthStore } from '../../auth/store';
import { useBranchFilter } from '../../branches/hooks/useBranchFilter';
import { useFeedbackStore } from '../../feedback/store';
import { parseError } from '../../../core/utils/errorUtils';
import { reconciliationApi } from '../api/reconciliationApi';
import type {
  CommitDailyReconciliationDTO,
  CommitDailyReconciliationResult,
  QuickDrawerExpenseDTO,
  QuickDrawerExpenseResult,
  DailyDrawerSummary,
  ExistingReconciliationRecord,
} from '../types';

/** فحص مُضيَّق لعقد المنشأة — يتفادى مطالبة الخادم بجلسة بلا منشأة */
const isValidCompanyId = (companyId: string | null | undefined): companyId is string =>
  typeof companyId === 'string' && companyId.length > 0;

export const useDailyDrawerSummary = (date: string): UseQueryResult<DailyDrawerSummary> => {
  const { user } = useAuthStore();
  const { branchId } = useBranchFilter();
  const companyId = user?.company_id;

  return useQuery<DailyDrawerSummary>({
    queryKey: ['daily_drawer_summary', companyId, date, branchId],
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
    enabled: isValidCompanyId(companyId) && date !== '',
    queryFn: async () => {
      if (!isValidCompanyId(companyId)) {
        throw new Error('جلسة العمل منتهية أو لم يتم تحديد المنشأة');
      }
      return reconciliationApi.fetchDailyDrawerSummary(companyId, date, branchId);
    },
  });
};

export const useCommitDailyReconciliation = (): UseMutationResult<
  CommitDailyReconciliationResult,
  Error,
  CommitDailyReconciliationDTO
> => {
  const queryClient = useQueryClient();
  const { showToast } = useFeedbackStore();

  return useMutation<CommitDailyReconciliationResult, Error, CommitDailyReconciliationDTO>({
    mutationFn: async (payload: CommitDailyReconciliationDTO) => {
      return reconciliationApi.commitReconciliation(payload);
    },
    onSuccess: data => {
      // الخادم يحسب الفارق وحد التسامح بالعملة الأساسية؛ نُبرز خارج التسامح كتحذير
      // بدل رسالة نجاح مسطّحة حتى لا يمر العجز الكبير بصمت.
      const isOutsideTolerance = data.is_within_tolerance === false;
      showToast(
        data.message || 'تم إقفال يومية المحل واعتماد المطابقة بنجاح',
        isOutsideTolerance ? 'warning' : 'success'
      );
      void queryClient.invalidateQueries({ queryKey: ['daily_drawer_summary'] });
      void queryClient.invalidateQueries({ queryKey: ['reconciliation_history'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard_data'] });
      void queryClient.invalidateQueries({ queryKey: ['journal_entries'] });
    },
    onError: (error: unknown) => {
      const parsed = parseError(error);
      showToast(parsed.message, 'error');
    },
  });
};

export const useRecordQuickDrawerExpense = (): UseMutationResult<
  QuickDrawerExpenseResult,
  Error,
  QuickDrawerExpenseDTO
> => {
  const queryClient = useQueryClient();
  const { showToast } = useFeedbackStore();

  return useMutation<QuickDrawerExpenseResult, Error, QuickDrawerExpenseDTO>({
    mutationFn: async (payload: QuickDrawerExpenseDTO) => {
      return reconciliationApi.recordQuickExpense(payload);
    },
    onSuccess: data => {
      // طلب مكرر (نقر مزدوج) → لا مصروف جديد؛ نُعلم المستخدم بحقيقة ما جرى
      // بدل رسالة نجاح مضللة توهمه بتسجيل مصروف ثانٍ.
      if (data.duplicate === true) {
        showToast(data.message || 'تم تجاهل الطلب المكرر — المصروف مسجّل مسبقاً', 'info');
      } else {
        showToast(data.message || 'تم تسجيل مصروف الدرج بنجاح', 'success');
      }
      void queryClient.invalidateQueries({ queryKey: ['daily_drawer_summary'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard_data'] });
      void queryClient.invalidateQueries({ queryKey: ['journal_entries'] });
    },
    onError: (error: unknown) => {
      const parsed = parseError(error);
      showToast(parsed.message, 'error');
    },
  });
};

export const useReconciliationHistory = (
  limit = 30
): UseQueryResult<ExistingReconciliationRecord[]> => {
  const { user } = useAuthStore();
  const { branchId } = useBranchFilter();
  const companyId = user?.company_id;

  return useQuery<ExistingReconciliationRecord[]>({
    queryKey: ['reconciliation_history', companyId, branchId, limit],
    queryFn: async () => {
      if (companyId === undefined || companyId === '') return [];
      return reconciliationApi.fetchReconciliationHistory(companyId, limit, branchId);
    },
    enabled: isValidCompanyId(companyId),
    staleTime: 60 * 1000,
  });
};
