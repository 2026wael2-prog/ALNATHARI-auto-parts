import { useQuery, useQueryClient } from '@tanstack/react-query';
import { salesApi, type InvoiceWithDetails } from '@/features/sales/api';
import { useAuthStore } from '@/features/auth/store';
import { mapCachedInvoiceRow, type CachedInvoiceRow } from './invoiceDetailsPlaceholder';

const searchList = (
  list: CachedInvoiceRow[] | undefined,
  invoiceId: string
): InvoiceWithDetails | undefined => {
  if (!Array.isArray(list)) return undefined;
  const found = list.find(inv => inv.id === invoiceId);
  return found != null ? mapCachedInvoiceRow(found) : undefined;
};

export const useInvoiceDetails = (
  invoiceId: string | null
): ReturnType<typeof useQuery<InvoiceWithDetails | null>> => {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const companyId = user?.company_id;
  const isEnabled = invoiceId != null && invoiceId !== '';

  return useQuery({
    queryKey: ['invoice_details', invoiceId],
    queryFn: async (): Promise<InvoiceWithDetails | null> => {
      if (!isEnabled) return null;
      return salesApi.getInvoiceDetails(invoiceId, companyId);
    },
    enabled: isEnabled,
    staleTime: 1000 * 60 * 5,
    placeholderData: (previousData): InvoiceWithDetails | undefined => {
      if (previousData != null) return previousData;
      if (!isEnabled) return undefined;

      // Seed instant view from existing lists in query cache (sales, returns, etc.)
      const allQueries = queryClient.getQueriesData<CachedInvoiceRow[]>({ queryKey: ['invoices'] });
      for (const [, list] of allQueries) {
        const hit = searchList(list, invoiceId);
        if (hit != null) return hit;
      }

      // Also check sales-returns queries
      const returnQueries = queryClient.getQueriesData<CachedInvoiceRow[]>({
        queryKey: ['sales_returns'],
      });
      for (const [, list] of returnQueries) {
        const hit = searchList(list, invoiceId);
        if (hit != null) return hit;
      }

      return undefined;
    },
  });
};
