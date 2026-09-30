export interface EmployeeSalesSummary {
  user_id: string;
  employee_name: string;
  invoice_count: number;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  credit_sales?: number | undefined;
  other_sales?: number | undefined;
}

/**
 * تفصيل المبيعات حسب عملة الفاتورة — `raw_total` بالمبلغ الأصلي كما حُرر،
 * و`base_total` بعد التحويل إلى عملة المنشأة الأساسية (مصدر الحقيقة للمجاميع).
 */
export interface SalesByCurrencyRow {
  currency_code: string;
  invoice_count: number;
  raw_total: number;
  base_total: number;
}

export type DenominationValue = 500 | 200 | 100 | 50 | 20 | 10 | 5 | 1 | 0.5;

export type CashDenominationCounts = Record<string, number>;

export interface ExistingReconciliationRecord {
  id: string;
  company_id: string;
  branch_id: string | null;
  reconciliation_date: string;
  shift_number: number;
  status: 'draft' | 'closed';
  opening_float: number;
  float_retained_for_tomorrow: number;
  cash_handed_to_owner: number;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  credit_sales?: number | undefined;
  returns_cash: number;
  returns_card: number;
  cash_receipts?: number | undefined;
  cash_disbursements?: number | undefined;
  petty_expenses_cash: number;
  expected_cash_in_drawer: number;
  actual_cash_counted: number;
  cash_denominations: CashDenominationCounts;
  card_terminal_receipt_total: number;
  cash_variance: number;
  card_variance: number;
  variance_reason: string | null;
  employee_breakdown: EmployeeSalesSummary[];
  notes: string | null;
  closed_by: string;
  closed_at: string;
  is_locked: boolean;
}

export interface DailyDrawerSummary {
  date: string;
  /** عملة المنشأة الأساسية — كل المبالغ أدناه محوّلة إليها عبر fn_to_base_amount */
  base_currency?: string | undefined;
  /** اسم بديل متوافق للخلف مع base_currency */
  currency?: string | undefined;
  /** نطاق الفرع الفعلي المستخدم في الاستعلام (null = نطاق المنشأة كاملة) */
  scope_branch_id?: string | null | undefined;
  scope_is_company?: boolean | undefined;
  company_branch_count?: number | undefined;
  /** حد التسامح المسموح به بالعملة الأساسية (يُحسب على الخادم) */
  variance_tolerance?: number | undefined;
  /** آخر عملة استُخدمت في مصروف نثري للمنشأة (ذاكرة العملة على الخادم) */
  last_petty_expense_currency?: string | null | undefined;
  opening_float: number;
  total_sales: number;
  cash_sales: number;
  card_sales: number;
  transfer_sales: number;
  credit_sales?: number | undefined;
  /** مبيعات بطرق دفع غير مصنّفة (كانت تُهمل قبل الإصلاح فتُخفِض الإجمالي) */
  other_sales?: number | undefined;
  sales_buckets_total?: number | undefined;
  returns_cash: number;
  returns_card: number;
  cash_receipts?: number | undefined;
  cash_disbursements?: number | undefined;
  card_receipts?: number | undefined;
  petty_expenses_cash: number;
  expected_cash_in_drawer: number;
  expected_card_terminal: number;
  sales_by_currency?: SalesByCurrencyRow[] | undefined;
  employee_breakdown: EmployeeSalesSummary[];
  existing_reconciliation: ExistingReconciliationRecord | null;
  is_already_closed: boolean;
}

export interface CommitDailyReconciliationResult {
  success: boolean;
  reconciliation_id: string;
  base_currency?: string | undefined;
  opening_float?: number | undefined;
  expected_cash_in_drawer?: number | undefined;
  expected_card_terminal?: number | undefined;
  cash_variance?: number | undefined;
  card_variance?: number | undefined;
  variance_tolerance?: number | undefined;
  is_within_tolerance?: boolean | undefined;
  cash_handed_to_owner?: number | undefined;
  float_retained_for_tomorrow?: number | undefined;
  message: string;
}

export interface QuickDrawerExpenseResult {
  success: boolean;
  /** true عندما يكون الطلب مكرراً (نقر مزدوج) فلم يُنشأ مصروف جديد */
  duplicate?: boolean | undefined;
  expense_id: string | null;
  voucher_number?: string | null | undefined;
  journal_entry_id?: string | null | undefined;
  amount?: number | undefined;
  base_amount?: number | null | undefined;
  currency_code?: string | undefined;
  exchange_rate?: number | undefined;
  base_currency?: string | undefined;
  description?: string | undefined;
  expense_date?: string | undefined;
  message: string;
}

export interface CommitDailyReconciliationDTO {
  company_id: string;
  date: string;
  branch_id?: string | null | undefined;
  opening_float: number;
  actual_cash_counted: number;
  cash_denominations: CashDenominationCounts;
  card_terminal_receipt_total: number;
  float_retained_for_tomorrow: number;
  cash_handed_to_owner: number;
  variance_reason?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface QuickDrawerExpenseDTO {
  company_id: string;
  amount: number;
  description: string;
  branch_id?: string | null | undefined;
  expense_date?: string | null | undefined;
  /** عملة المصروف كما حُررت فعلياً (يجب ألا تُفرض SAR قسراً) */
  currency_code?: string | undefined;
  /** سعر الصرف مقابل عملة المنشأة الأساسية (SAR) */
  exchange_rate?: number | undefined;
  /** مفتاح منع التكرار لمنع النقر المزدوج وتكرار الترحيل */
  idempotency_key?: string | undefined;
}
