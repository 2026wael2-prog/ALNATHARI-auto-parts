/**
 * Dashboard Service Types
 * Type definitions for dashboard queries with complex joins
 */

import type { Database } from '@/core/database.types';
import { formatLocalDate } from '@/core/utils/dateUtils';

// Journal Entry with Lines (for bonds)
export interface JournalEntryWithLines {
  id: string;
  entry_date: string;
  reference_type: 'receipt_bond' | 'payment_bond';
  journal_entry_lines: Array<{
    debit_amount: number;
    credit_amount: number;
  }>;
}

// Product with Stock
export interface ProductWithStock {
  id: string;
  name_ar: string;
  min_stock_level: number;
  product_stock: Array<{
    quantity: number;
    warehouse_id: string;
  }>;
}

// Invoice Item with Product and Invoice info
export interface InvoiceItemWithDetails {
  product_id: string;
  quantity: number;
  total: number;
  products: {
    name_ar: string;
  } | null;
  invoices: {
    company_id: string;
    type: string;
    status: string;
  } | null;
}

// Re-export common types from database
export type { Database };

export type DashboardPeriod = 'today' | 'last_7_days' | 'this_month' | 'this_year' | 'all_time';

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  today: 'اليوم',
  last_7_days: 'آخر 7 أيام',
  this_month: 'هذا الشهر',
  this_year: 'هذا العام',
  all_time: 'جميع الأوقات',
};

export function getPeriodDates(period: DashboardPeriod): {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
} {
  const now = new Date();
  // [FIX] التاريخ المحلي وليس UTC: كانت toISOString() تُرجع تاريخ الأمس قبل
  // منتصف الليل UTC (مثلاً قبل 3 صباحاً بتوقيت GMT+3)، فتصبح فترة "اليوم"
  // هي الأمس. formatLocalDate() مخصصة لهذه المشكلة بالضبط.
  const dateTo = formatLocalDate(now);

  if (period === 'today') {
    return { dateFrom: dateTo, dateTo };
  }
  if (period === 'last_7_days') {
    // ⚡ نافذة متدرّجة لا أسبوع تقويمي: المنشأة تعمل كل يوم بلا أيام راحة، فحدود
    // الأسبوع التقويمي لا ترتكز على شيء في العمل الفعلي. وهي أيضاً ما تستخدمه
    // شرائط الفلترة ووحدة السندات، فتوحّدت الأنظمة الثلاثة أخيراً.
    // 7 أيام **شاملة اليوم** = اليوم − 6. وكانت الأسبوعية التقويمية تبدأ السبت.
    const start = new Date(now);
    start.setDate(now.getDate() - 6);
    return { dateFrom: formatLocalDate(start), dateTo };
  }
  if (period === 'this_month') {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return { dateFrom: `${year}-${month}-01`, dateTo };
  }
  if (period === 'this_year') {
    return { dateFrom: `${now.getFullYear()}-01-01`, dateTo };
  }
  // 'all_time'
  return {};
}
