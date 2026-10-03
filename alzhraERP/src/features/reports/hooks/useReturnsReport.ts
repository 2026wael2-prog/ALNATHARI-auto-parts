import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabaseClient';
import { useSalesReturns } from '../../sales/hooks/useSalesReturns';
import { usePurchaseReturns } from '../../purchases/hooks/usePurchaseReturns';
import { exportReturnsToExcel } from '../../../core/utils/returnsExcelExporter';
import { formatLocalDate } from '../../../core/utils/dateUtils';
import {
  normalizeSalesReturn,
  normalizePurchaseReturn,
  type ReturnReportRow,
} from './returnsNormalizers';

export {
  normalizeSalesReturn,
  normalizePurchaseReturn,
  type ReturnReportRow,
} from './returnsNormalizers';

export type DateRange = 'today' | 'week' | 'month' | 'year' | 'custom';
export type ReturnsType = 'all' | 'sales' | 'purchase';
export type ReportView = 'overview' | 'sales' | 'purchase';

export interface FilterState {
  dateRange: DateRange;
  type: ReturnsType;
  status: string;
  reason: string;
  startDate?: string;
  endDate?: string;
}

// eslint-disable-next-line complexity, @typescript-eslint/explicit-function-return-type
function mapReturnRowToExcelItem(r: ReturnReportRow) {
  return {
    invoiceNumber: r.invoice_number ?? '',
    issueDate: r.issue_date ?? '',
    customerName: r.party?.name ?? '',
    referenceInvoice: r.reference_invoice?.invoice_number ?? '',
    returnReason: r.return_reason ?? '',
    items: r.invoice_items?.length ?? 0,
    totalAmount: Number(r.total_amount ?? 0),
    currencyCode: r.currency_code ?? 'SAR',
    status: r.status ?? 'draft',
    notes: r.notes ?? '',
  };
}

export const useReturnsReport = () => {
  const [filters, setFilters] = useState<FilterState>({
    dateRange: 'month',
    type: 'all',
    status: 'all',
    reason: 'all',
  });
  const [reportView, setReportView] = useState<ReportView>('overview');

  // Calculate date range
  const dateRange = useMemo(() => {
    const now = new Date();
    const endDate = formatLocalDate(now);
    let startDate: string;

    switch (filters.dateRange) {
      case 'today':
        startDate = endDate;
        break;
      // ⚡ كل مدى هنا كان لا يطابق تسميته في ReturnsFilterBar:
      //   «آخر 7 أيام»  كان اليوم−7 = 8 أيام
      //   «آخر 30 يوم»  كان شهراً تقويمياً كاملاً (28–31 يوماً)
      //   «السنة الحالية» كان سنة متدرّجة تبدأ من مثل هذا اليوم من السنة الماضية!
      case 'week': {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
        startDate = formatLocalDate(d);
        break;
      }
      case 'month': {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        startDate = formatLocalDate(d);
        break;
      }
      case 'year': {
        // السنة الحالية فعلاً: من 1 يناير، لا نافذة متدرّجة.
        startDate = formatLocalDate(new Date(now.getFullYear(), 0, 1));
        break;
      }
      case 'custom':
        startDate = filters.startDate || endDate;
        break;
      default: {
        // يطابق 'month' (آخر 30 يوماً) حتى لا يختلف السلوك الافتراضي عن المختار
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
        startDate = formatLocalDate(d);
      }
    }

    return {
      startDate,
      endDate: filters.dateRange === 'custom' && filters.endDate ? filters.endDate : endDate,
    };
  }, [filters.dateRange, filters.startDate, filters.endDate]);

  // Fetch data
  const { data: salesReturns, isLoading: salesLoading } = useSalesReturns({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  });

  const { data: purchaseReturns, isLoading: purchaseLoading } = usePurchaseReturns();

  // ⚡ أرقام الفواتير الأصلية: الاستعلام لا يجلبها والتضمين الذاتي في PostgREST
  // غامض هنا (قيدان أجنبيان من invoices إلى نفسها: PGRST201)، فيُجلب الرقم
  // بطلب واحد مقيَّد بالمعرّفات بدل الاعتماد على embed غير موثوق.
  const referenceIds = useMemo(
    () => [
      ...new Set(
        (salesReturns || [])
          .map(r => r.reference_invoice_id)
          .filter((v): v is string => typeof v === 'string' && v.length > 0)
      ),
    ],
    [salesReturns]
  );

  const { data: referenceNumbers } = useQuery({
    queryKey: ['returns_reference_invoice_numbers', referenceIds],
    enabled: referenceIds.length > 0,
    staleTime: 5 * 60_000,
    // ⚠️ يجب أن تكون القيمة قابلة للتسلسل: ذاكرة React Query تُحفَظ في IndexedDB
    // عبر JSON (see lib/persister.ts)، و JSON يحوّل Map إلى {}. إرجاع Map هنا
    // كان يُسقط التقرير عند أول إعادة تحميل بعد حفظ الذاكرة:
    // "TypeError: o?.get is not a function".
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number')
        .in('id', referenceIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map(r => [r.id, r.invoice_number ?? '']));
    },
  });

  // توحيد نوعي البيانات (مبيعات/مشتريات) في مصفوفتين موحدتين
  const normalizedSalesReturns = useMemo(
    () =>
      (salesReturns || []).map(normalizeSalesReturn).map(r => ({
        ...r,
        // كان الحقل لا يُملأ إطلاقاً فتظهر «داخلي» لكل صف رغم أن الربط موجود
        reference_invoice: r.reference_invoice_id
          ? { invoice_number: referenceNumbers?.[r.reference_invoice_id] ?? null }
          : null,
      })),
    [salesReturns, referenceNumbers]
  );
  const normalizedPurchaseReturns = useMemo(
    () => (purchaseReturns || []).map(normalizePurchaseReturn),
    [purchaseReturns]
  );

  // Filter returns based on status and reason
  const filteredSalesReturns = useMemo(() => {
    return normalizedSalesReturns.filter((r: ReturnReportRow) => {
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.reason !== 'all' && r.return_reason !== filters.reason) return false;
      return true;
    });
  }, [normalizedSalesReturns, filters.status, filters.reason]);

  const filteredPurchaseReturns = useMemo(() => {
    return normalizedPurchaseReturns.filter((r: ReturnReportRow) => {
      if (filters.status !== 'all' && r.status !== filters.status) return false;
      if (filters.reason !== 'all' && r.return_reason !== filters.reason) return false;
      return true;
    });
  }, [normalizedPurchaseReturns, filters.status, filters.reason]);

  // ⚠️ `total_amount` في جداول المستندات مخزَّن بعملة الأساس (SAR) مطابقةً
  // لـ Mizan ⇒ لا تحويل. كان `toBaseCurrency` يقسم على سعر صرف اليمني
  // فيضخّم إجمالي المرتجعات نحو 415 مرة.
  const getRowBaseAmount = (r: ReturnReportRow): number => Number(r.total_amount) || 0;

  // Calculate statistics
  const stats = useMemo(() => {
    const salesTotal = filteredSalesReturns.reduce(
      (sum: number, r: ReturnReportRow) => sum + getRowBaseAmount(r),
      0
    );
    const purchaseTotal = filteredPurchaseReturns.reduce(
      (sum: number, r: ReturnReportRow) => sum + getRowBaseAmount(r),
      0
    );

    return {
      salesCount: filteredSalesReturns.length,
      salesTotal,
      salesAvg: filteredSalesReturns.length > 0 ? salesTotal / filteredSalesReturns.length : 0,
      purchaseCount: filteredPurchaseReturns.length,
      purchaseTotal,
      purchaseAvg:
        filteredPurchaseReturns.length > 0 ? purchaseTotal / filteredPurchaseReturns.length : 0,
      totalCount: filteredSalesReturns.length + filteredPurchaseReturns.length,
      totalAmount: salesTotal + purchaseTotal,
    };
  }, [filteredSalesReturns, filteredPurchaseReturns]);

  // Reason distribution for pie chart
  const reasonDistribution = useMemo(() => {
    const reasonMap: Record<string, number> = {};
    const returns =
      filters.type === 'sales'
        ? filteredSalesReturns
        : filters.type === 'purchase'
          ? filteredPurchaseReturns
          : [...filteredSalesReturns, ...filteredPurchaseReturns];

    returns.forEach((r: ReturnReportRow) => {
      const reason = r.return_reason || 'أخرى';
      reasonMap[reason] = (reasonMap[reason] || 0) + getRowBaseAmount(r);
    });

    return Object.entries(reasonMap).map(([name, value]) => ({ name, value }));
  }, [filteredSalesReturns, filteredPurchaseReturns, filters.type]);

  // Monthly trends for line chart
  const monthlyTrends = useMemo(() => {
    const monthMap: Record<string, { sales: number; purchase: number }> = {};
    const now = new Date();

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      monthMap[key] = { sales: 0, purchase: 0 };
    }

    // Aggregate sales returns
    filteredSalesReturns.forEach((r: ReturnReportRow) => {
      const date = new Date(r.issue_date || r.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthMap[key]) {
        monthMap[key].sales += getRowBaseAmount(r);
      }
    });

    // Aggregate purchase returns
    filteredPurchaseReturns.forEach((r: ReturnReportRow) => {
      const date = new Date(r.issue_date || r.created_at);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthMap[key]) {
        monthMap[key].purchase += getRowBaseAmount(r);
      }
    });

    return Object.entries(monthMap).map(([month, data]) => ({
      month,
      ...data,
    }));
  }, [filteredSalesReturns, filteredPurchaseReturns]);

  // Top parties
  const topParties = useMemo(() => {
    const partyMap: Record<string, { name: string; count: number; total: number }> = {};
    const returns =
      filters.type === 'sales'
        ? filteredSalesReturns
        : filters.type === 'purchase'
          ? filteredPurchaseReturns
          : [...filteredSalesReturns, ...filteredPurchaseReturns];

    returns.forEach((r: ReturnReportRow) => {
      const partyName = r.party?.name || 'غير معروف';
      if (!partyMap[partyName]) {
        partyMap[partyName] = { name: partyName, count: 0, total: 0 };
      }
      partyMap[partyName].count += 1;
      partyMap[partyName].total += getRowBaseAmount(r);
    });

    return Object.values(partyMap)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [filteredSalesReturns, filteredPurchaseReturns, filters.type]);

  // Export to Excel
  const handleExportExcel = async () => {
    const returns =
      filters.type === 'sales'
        ? filteredSalesReturns
        : filters.type === 'purchase'
          ? filteredPurchaseReturns
          : [...filteredSalesReturns, ...filteredPurchaseReturns];

    const excelData = {
      companyName: 'Al-Jaafari Smart',
      returns: returns.map(mapReturnRowToExcelItem),
      summary: {
        totalReturns: stats.totalAmount,
        totalAmount: stats.totalAmount,
        averageAmount: stats.totalCount > 0 ? stats.totalAmount / stats.totalCount : 0,
        count: stats.totalCount,
      },
      type: filters.type === 'all' ? 'sales' : filters.type,
    };

    await exportReturnsToExcel(excelData);
  };

  return {
    filters,
    setFilters,
    reportView,
    setReportView,
    salesLoading,
    purchaseLoading,
    filteredSalesReturns,
    filteredPurchaseReturns,
    stats,
    reasonDistribution,
    monthlyTrends,
    topParties,
    handleExportExcel,
  };
};
