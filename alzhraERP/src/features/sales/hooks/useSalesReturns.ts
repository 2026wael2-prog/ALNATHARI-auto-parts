// ============================================
// Sales Returns Hook
// Custom hooks for managing sales returns data
// ============================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';
import { useAuthStore } from '../../auth/store';
import { useFeedbackStore } from '../../feedback/store';
import { invalidateByPreset } from '../../../lib/invalidation';
import type { Invoice, Party, InvoiceItem } from '../../../core/types/supabase-helpers';
import type { InvoiceStatus } from '../types';
import { toReturnPayloadItems } from '../../returns/utils/returnHelpers';
import type { Json } from '../../../core/database.types';
import { normalizeSearch } from '../../../core/utils';
import { formatLocalDate } from '../../../core/utils/dateUtils';
import { logger } from '../../../core/utils/logger';
import { parseError } from '../../../core/utils/errorUtils';

export interface SalesReturn {
  id: string;
  invoice_number: string;
  issue_date: string;
  total_amount: number;
  status: InvoiceStatus;
  notes?: string | null;
  currency_code?: string | null;
  exchange_rate?: number | null;
  reference_invoice_id?: string | null;
  /** سبب الإرجاع كما خُزِّن عند الإنشاء (كان يُرسَل في p_return_reason ولم يُقرأ) */
  return_reason?: string | null;
  party?: {
    id: string;
    name: string;
  } | null;
  invoice_items?: Array<{
    id: string;
    product_id: string;
    description: string;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  created_at: string;
}

export type SalesReturnQueryResult = Pick<
  Invoice,
  | 'id'
  | 'invoice_number'
  | 'issue_date'
  | 'total_amount'
  | 'status'
  | 'notes'
  | 'created_at'
  | 'reference_invoice_id'
  | 'return_reason'
  | 'currency_code'
  | 'exchange_rate'
> & {
  party: Pick<Party, 'id' | 'name'> | null;
  invoice_items: Array<
    Pick<InvoiceItem, 'id' | 'product_id' | 'description' | 'quantity' | 'unit_price' | 'total'> & {
      cost_price?: number | null;
      product?: {
        id?: string;
        name_ar?: string | null;
        sku?: string | null;
        part_number?: string | null;
        brand?: string | null;
      } | null;
    }
  >;
};

/*
interface SalesReturnsStats {
    returnCount: number;
    totalReturns: number;
    avgReturn: number;
    pendingCount: number;
}
*/

// Fetch all sales returns with optional filters
export const useSalesReturns = (filters?: {
  searchTerm?: string;
  status?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
}) => {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['sales-returns', filters],
    queryFn: async () => {
      if (!user?.company_id) return [];

      let query = supabase
        .from('invoices')
        .select(
          `
          id,
          invoice_number,
          issue_date,
          total_amount,
          status,
          notes,
          currency_code,
          exchange_rate,
          party:party_id(id, name),
          invoice_items:invoice_items(
            id,
            product_id,
            description,
            quantity,
            unit_price,
            total,
            cost_price
          ),
          reference_invoice_id,
          return_reason,
          created_at
        `
        )
        .eq('company_id', user.company_id)
        .eq('type', 'sale_return')
        .is('deleted_at', null);

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }

      if (filters?.startDate) {
        query = query.gte('issue_date', filters.startDate);
      }

      if (filters?.endDate) {
        query = query.lte('issue_date', filters.endDate);
      }

      const { data, error } = await query.order('issue_date', { ascending: false });

      if (error) throw error;
      const typedData = data as unknown as SalesReturnQueryResult[];

      // Client-side search filtering
      let returns = typedData || [];

      if (filters?.searchTerm) {
        const term = normalizeSearch(filters.searchTerm);
        if (term) {
          returns = returns.filter(
            (r: SalesReturnQueryResult) =>
              normalizeSearch(r.invoice_number).includes(term) ||
              normalizeSearch(r.party?.name).includes(term) ||
              normalizeSearch(r.notes).includes(term)
          );
        }
      }

      return returns as SalesReturn[];
    },
    enabled: !!user?.company_id,
  });
};

// Fetch sales returns statistics
export const useSalesReturnsStats = () => {
  const { user } = useAuthStore();

  return useQuery({
    queryKey: ['sales-returns-stats', user?.company_id],
    queryFn: async () => {
      if (!user?.company_id) {
        return { returnCount: 0, totalReturns: 0, avgReturn: 0, pendingCount: 0 };
      }

      const { data, error } = await supabase
        .from('invoices')
        .select('id, total_amount, status, currency_code, exchange_rate')
        .eq('company_id', user.company_id)
        .eq('type', 'sale_return')
        .is('deleted_at', null);

      if (error) throw error;
      const returns = data || [];
      const returnCount = returns.length;
      const totalReturns = returns.reduce((sum: number, r: any) => {
        const amount = Number(r.total_amount) || 0;
        const rate = Number(r.exchange_rate) || 1;
        const code = r.currency_code || 'SAR';
        let baseAmount = amount;
        if (code === 'YER' && rate > 0) {
          baseAmount = rate < 1 ? amount * rate : amount / rate;
        }
        return sum + baseAmount;
      }, 0);
      const avgReturn = returnCount > 0 ? totalReturns / returnCount : 0;
      const pendingCount = returns.filter(
        (r: any) => r.status === 'draft' || r.status === 'posted'
      ).length;

      return {
        returnCount,
        totalReturns,
        avgReturn,
        pendingCount,
      };
    },
    enabled: !!user?.company_id,
  });
};

// Create a new sales return
export const useCreateSalesReturn = () => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const { showToast } = useFeedbackStore();

  return useMutation({
    mutationFn: async (data: {
      invoiceId: string;
      partyId?: string | null | undefined;
      paymentMethod?: string | undefined;
      items: any[];
      returnReason?: string | undefined;
      status?: string | undefined;
      notes?: string | undefined;
      issueDate?: string | undefined;
      currency?: string | undefined;
      exchangeRate?: number | undefined;
    }) => {
      if (!user?.company_id || !user?.id) {
        throw new Error('Missing authentication context');
      }

      const partyId =
        typeof data.partyId === 'string' && data.partyId.trim().length > 0
          ? data.partyId.trim()
          : null;
      const payloadItems = toReturnPayloadItems(data.items ?? []) as unknown as Json;
      const currency = data.currency ?? 'SAR';
      const exchangeRate = typeof data.exchangeRate === 'number' ? data.exchangeRate : 1;
      const issueDate = data.issueDate ?? formatLocalDate();

      try {
        const { data: result, error } = await supabase.rpc('process_sales_return', {
          p_invoice_id: data.invoiceId,
          p_party_id: partyId as unknown as string,
          p_payment_method: data.paymentMethod ?? 'cash',
          p_items: payloadItems,
          p_return_reason: data.returnReason ?? '',
          p_status: data.status ?? 'posted',
          p_notes: data.notes ?? '',
          p_issue_date: issueDate,
          p_currency_code: currency,
          p_exchange_rate: exchangeRate,
          p_company_id: user.company_id,
          p_user_id: user.id,
        });

        if (error) throw error;
        return result as { invoice_number: string };
      } catch (primaryError: unknown) {
        logger.warn(
          'useSalesReturns',
          'process_sales_return failed, attempting fallback to commit_sale_return:',
          primaryError
        );

        const fallbackParams = {
          p_company_id: user.company_id,
          p_user_id: user.id,
          p_party_id: partyId as unknown as string,
          p_items: payloadItems,
          p_currency: currency,
          p_exchange_rate: exchangeRate,
          ...(data.notes !== undefined ? { p_notes: data.notes } : {}),
          ...(data.invoiceId ? { p_reference_invoice_id: data.invoiceId } : {}),
          ...(data.returnReason !== undefined ? { p_return_reason: data.returnReason } : {}),
        };

        const { data: fallbackResult, error: fallbackError } = await supabase.rpc(
          'commit_sale_return',
          fallbackParams
        );

        if (fallbackError) {
          throw parseError(fallbackError);
        }

        return fallbackResult as { invoice_number: string };
      }
    },
    onSuccess: invoice => {
      showToast(`تم إنشاء مرتجع المبيعات #${invoice.invoice_number} بنجاح`, 'success');
      invalidateByPreset(queryClient, 'saleReturn');
    },
    onError: (error: Error) => {
      showToast(parseError(error).message, 'error');
    },
  });
};

// Fetch sales invoices for return selection
export const useSalesInvoicesForReturn = (
  customerId?: string | null,
  options?: { enabled?: boolean }
) => {
  const { user } = useAuthStore();
  const isEnabled = (options?.enabled ?? true) && !!user?.company_id;

  return useQuery({
    queryKey: ['sales-invoices-for-return', user?.company_id, customerId],
    queryFn: async () => {
      if (!user?.company_id) return [];

      let query = supabase
        .from('invoices')
        .select(
          `
          id,
          invoice_number,
          issue_date,
          total_amount,
          currency_code,
          exchange_rate,
          payment_method,
          created_by,
          party:party_id(id, name),
          invoice_items(id, product_id, description, quantity, unit_price, total, cost_price, product:products!fk_invoice_items_company_product(id, name_ar, sku, part_number, brand))
        `
        )
        .eq('company_id', user.company_id)
        .eq('type', 'sale')
        .neq('status', 'void')
        .neq('status', 'cancelled')
        .is('deleted_at', null);

      if (customerId) {
        query = query.eq('party_id', customerId);
      }

      const { data, error } = await query.order('issue_date', { ascending: false }).limit(1000);

      if (error) throw error;
      const typedData = data as unknown as SalesReturnQueryResult[];

      return typedData || [];
    },
    enabled: isEnabled,
    staleTime: 1000 * 60 * 3,
  });
};
