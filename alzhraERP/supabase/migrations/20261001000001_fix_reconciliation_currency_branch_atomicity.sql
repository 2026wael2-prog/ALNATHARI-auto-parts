-- ==============================================================================
-- Migration: 20261001000001_fix_reconciliation_currency_branch_atomicity.sql
-- Description: إصلاحات جوهرية لنظام المطابقة اليومية وإقفال درج الصندوق
--   (تكملة لـ 20260905000001 و 20260905000002 — دون تعديل عليهما):
--
--   1) العملة (P0): كانت كل المجاميع تُجمع خامًا بلا تحويل (YER + SAR معًا) فتُضخّم
--      النقدية حتى 410×. الآن كل مبلغ يُحوَّل إلى عملة المنشأة الأساسية
--      (companies.base_currency) عبر الدالة المعتمدة public.fn_to_base_amount
--      (نفس مُسند 20260922000004 و ADR-017)، مع كشف المبيعات غير المصنّفة
--      (other_sales) وتفصيل المبيعات حسب العملة (sales_by_currency).
--
--   2) الفرع (P0): كان المُسند غير متسق داخل الدالة نفسها (صارم للعهدة والمراجعة
--      السابقة، واستيعابي «كل الفروع» للفواتير والسندات والمصروفات). صار مُسندًا
--      واحدًا صارمًا في كل الاستعلامات: branch_id IS NOT DISTINCT FROM p_branch_id
--      (NULL = نطاق المنشأة الواحدة)، مع إرجاع company_branch_count وscope_is_company.
--
--   3) مصروف الدرج السريع (P0): كان يُدرج صفًا في expenses بدون عملة صحيحة وبدون أي
--      قيد محاسبي إطلاقًا (لا يوجد Trigger على expenses يُرحّل القيود؛ فالترحيل يحدث
--      داخل commit_expense_v2 فقط) فكان الكاش يخرج من الدرج دون تسجيل محاسبي.
--      الآن يفوّض commit_expense_v2 (عملة + سعر صرف + قيد + رقم إيصال موحّد)
--      مع منع تكرار النقر المزدوج وحارس يمنع السعر الوهمي 1 لعملة غير أساسية.
--
--   4) الإقفال (P1): قفل استشاري ذرّي (pg_advisory_xact_lock)، وإلزام مبرر الفارق
--      خارج حد التسامح، واشتقاق عهدة الصباح من الخادم لا من العميل، ومنع الإقفال
--      على نطاق المنشأة كاملة عند وجود أكثر من فرع.
--
--   5) تفصيل الموظفين (P0): كان يُضاعف المبيعات لأن JOIN كان على العرض متعدد الصفوف
--      user_profiles (profiles × user_company_roles). الآن على public.profiles مباشرة،
--      مع عمودي credit_sales وother_sales.
--
-- تشغيل: لا يتوفر Docker محليًا، لذا تُطبَّق الهجرة عبر supabase db push أو CI،
--        ويُتحقق من عقد الواجهة في اختبارات TS: reconciliationApi.test.ts.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1) get_daily_drawer_summary — عملة الأساس + مُسند فرع موحّد + تفصيل صحيح
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_drawer_summary(
    p_company_id uuid,
    p_date date,
    p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id uuid;
    v_base_currency text := 'SAR';
    v_branch_count integer := 0;
    v_last_petty_currency text;
    v_opening_float numeric(19,4) := 0;
    v_total_sales numeric(19,4) := 0;
    v_cash_sales numeric(19,4) := 0;
    v_card_sales numeric(19,4) := 0;
    v_transfer_sales numeric(19,4) := 0;
    v_credit_sales numeric(19,4) := 0;
    v_other_sales numeric(19,4) := 0;
    v_returns_cash numeric(19,4) := 0;
    v_returns_card numeric(19,4) := 0;
    v_cash_receipts numeric(19,4) := 0;
    v_cash_disbursements numeric(19,4) := 0;
    v_card_receipts numeric(19,4) := 0;
    v_petty_expenses numeric(19,4) := 0;
    v_expected_cash numeric(19,4) := 0;
    v_expected_card numeric(19,4) := 0;
    v_sales_by_currency jsonb := '[]'::jsonb;
    v_employee_breakdown jsonb := '[]'::jsonb;
    v_existing_reconciliation jsonb := NULL;
    v_tolerance numeric(19,4) := 10;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'عذراً، يجب تسجيل الدخول أولاً' USING ERRCODE = '42501';
    END IF;

    PERFORM public.verify_company_access(p_company_id);

    -- 0) مصدر الحقيقة للعملة: companies.base_currency
    SELECT COALESCE(NULLIF(TRIM(c.base_currency), ''), 'SAR')
    INTO v_base_currency
    FROM public.companies c
    WHERE c.id = p_company_id
    LIMIT 1;
    v_base_currency := COALESCE(v_base_currency, 'SAR');

    -- عدد فروع المنشأة (للتنبيه عند العرض على نطاق المنشأة كاملة)
    SELECT COUNT(*)::integer INTO v_branch_count
    FROM public.branches br
    WHERE br.company_id = p_company_id;

    -- 1) العهدة الافتتاحية (فكة الأمس المرحّلة لنفس نطاق الفرع بالضبط)
    SELECT r.float_retained_for_tomorrow INTO v_opening_float
    FROM public.daily_reconciliations r
    WHERE r.company_id = p_company_id
      AND r.branch_id IS NOT DISTINCT FROM p_branch_id
      AND r.reconciliation_date < p_date
    ORDER BY r.reconciliation_date DESC, r.shift_number DESC
    LIMIT 1;
    v_opening_float := COALESCE(v_opening_float, 0);
    -- 2) مبيعات ومرتجعات اليوم — محوّلة إلى عملة الأساس (كانت تجمع YER+SAR خامًا)
    SELECT
        COALESCE(SUM(CASE WHEN i.type = 'sale' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale' AND i.payment_method = 'cash' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale' AND i.payment_method IN ('card', 'network', 'mada') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale' AND i.payment_method IN ('transfer', 'bank') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale' AND i.payment_method = 'credit' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale' AND COALESCE(i.payment_method, '') NOT IN ('cash', 'card', 'network', 'mada', 'transfer', 'bank', 'credit') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale_return' AND i.payment_method = 'cash' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN i.type = 'sale_return' AND i.payment_method IN ('card', 'network', 'mada') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 0)
    INTO
        v_total_sales,
        v_cash_sales,
        v_card_sales,
        v_transfer_sales,
        v_credit_sales,
        v_other_sales,
        v_returns_cash,
        v_returns_card
    FROM public.invoices i
    WHERE i.company_id = p_company_id
      AND i.branch_id IS NOT DISTINCT FROM p_branch_id
      AND i.issue_date = p_date
      AND i.status NOT IN ('draft', 'cancelled', 'void')
      AND i.deleted_at IS NULL;

    -- 3) السندات (مقبوضات ومدفوعات نقدية/شبكة) — محوّلة إلى عملة الأساس
    SELECT
        COALESCE(SUM(CASE WHEN pay.type = 'receipt' AND pay.payment_method = 'cash' THEN public.fn_to_base_amount(pay.currency_code, pay.amount, pay.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.type IN ('payment', 'disbursement') AND pay.payment_method = 'cash' THEN public.fn_to_base_amount(pay.currency_code, pay.amount, pay.exchange_rate) ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN pay.type = 'receipt' AND pay.payment_method IN ('card', 'network', 'mada') THEN public.fn_to_base_amount(pay.currency_code, pay.amount, pay.exchange_rate) ELSE 0 END), 0)
    INTO
        v_cash_receipts,
        v_cash_disbursements,
        v_card_receipts
    FROM public.payments pay
    WHERE pay.company_id = p_company_id
      AND pay.branch_id IS NOT DISTINCT FROM p_branch_id
      AND pay.payment_date = p_date
      AND pay.status NOT IN ('draft', 'void', 'cancelled')
      AND pay.deleted_at IS NULL;
    -- 4) المصروفات النثرية النقدية من الدرج — محوّلة إلى عملة الأساس
    SELECT COALESCE(SUM(public.fn_to_base_amount(e.currency_code, e.amount, e.exchange_rate)), 0)
    INTO v_petty_expenses
    FROM public.expenses e
    WHERE e.company_id = p_company_id
      AND e.branch_id IS NOT DISTINCT FROM p_branch_id
      AND e.expense_date = p_date
      AND e.payment_method = 'cash'
      AND e.status NOT IN ('draft', 'void', 'cancelled')
      AND e.deleted_at IS NULL;

    -- 4ب) آخر عملة استُخدمت في مصروفات الدرج (تذكّر التفضيل — AGENTS §6)
    SELECT e.currency_code INTO v_last_petty_currency
    FROM public.expenses e
    WHERE e.company_id = p_company_id
      AND e.payment_method = 'cash'
      AND e.currency_code IS NOT NULL
      AND e.deleted_at IS NULL
    ORDER BY e.created_at DESC
    LIMIT 1;

    -- 5) النقد والشبكة المتوقعان في الدرج (بعملة الأساس)
    v_expected_cash := v_opening_float + v_cash_sales - v_returns_cash + v_cash_receipts - v_cash_disbursements - v_petty_expenses;
    v_expected_card := v_card_sales - v_returns_card + v_card_receipts;

    -- 6) تفصيل المبيعات حسب العملة (شفافية على المبالغ الخام قبل التحويل)
    SELECT COALESCE(jsonb_agg(row_to_json(sc) ORDER BY sc.base_total DESC), '[]'::jsonb)
    INTO v_sales_by_currency
    FROM (
        SELECT COALESCE(NULLIF(TRIM(i.currency_code), ''), v_base_currency) AS currency_code,
               COUNT(*)::integer AS invoice_count,
               ROUND(SUM(i.total_amount), 4) AS raw_total,
               ROUND(SUM(public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate)), 4) AS base_total
        FROM public.invoices i
        WHERE i.company_id = p_company_id
          AND i.branch_id IS NOT DISTINCT FROM p_branch_id
          AND i.issue_date = p_date
          AND i.type = 'sale'
          AND i.status NOT IN ('draft', 'cancelled', 'void')
          AND i.deleted_at IS NULL
        GROUP BY 1
    ) sc;

    -- 7) تفصيل مبيعات كل موظف — بلا تضخيم JOIN على user_profiles متعدد الصفوف
    SELECT COALESCE(jsonb_agg(emp_row), '[]'::jsonb)
    INTO v_employee_breakdown
    FROM (
        SELECT
            i.created_by AS user_id,
            COALESCE(NULLIF(TRIM(pr.full_name), ''), 'موظف') AS employee_name,
            COUNT(*)::integer AS invoice_count,
            ROUND(SUM(public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate)), 4) AS total_sales,
            ROUND(SUM(CASE WHEN i.payment_method = 'cash' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 4) AS cash_sales,
            ROUND(SUM(CASE WHEN i.payment_method IN ('card', 'network', 'mada') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 4) AS card_sales,
            ROUND(SUM(CASE WHEN i.payment_method IN ('transfer', 'bank') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 4) AS transfer_sales,
            ROUND(SUM(CASE WHEN i.payment_method = 'credit' THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 4) AS credit_sales,
            ROUND(SUM(CASE WHEN COALESCE(i.payment_method, '') NOT IN ('cash', 'card', 'network', 'mada', 'transfer', 'bank', 'credit') THEN public.fn_to_base_amount(i.currency_code, i.total_amount, i.exchange_rate) ELSE 0 END), 4) AS other_sales
        FROM public.invoices i
        LEFT JOIN public.profiles pr ON pr.id = i.created_by
        WHERE i.company_id = p_company_id
          AND i.branch_id IS NOT DISTINCT FROM p_branch_id
          AND i.issue_date = p_date
          AND i.type = 'sale'
          AND i.status NOT IN ('draft', 'cancelled', 'void')
          AND i.deleted_at IS NULL
        GROUP BY i.created_by, pr.full_name
        ORDER BY total_sales DESC
    ) emp_row;

    v_employee_breakdown := COALESCE(v_employee_breakdown, '[]'::jsonb);
    -- 8) سجل الإقفال الحالي إن وجد (بنفس نطاق الفرع بالضبط)
    SELECT row_to_json(r)::jsonb INTO v_existing_reconciliation
    FROM public.daily_reconciliations r
    WHERE r.company_id = p_company_id
      AND r.branch_id IS NOT DISTINCT FROM p_branch_id
      AND r.reconciliation_date = p_date
    ORDER BY r.shift_number DESC
    LIMIT 1;

    RETURN jsonb_build_object(
        'date', p_date,
        'base_currency', v_base_currency,
        'currency', v_base_currency,
        'scope_branch_id', p_branch_id,
        'scope_is_company', (p_branch_id IS NULL),
        'company_branch_count', v_branch_count,
        'variance_tolerance', v_tolerance,
        'last_petty_expense_currency', COALESCE(v_last_petty_currency, v_base_currency),
        'opening_float', v_opening_float,
        'total_sales', v_total_sales,
        'cash_sales', v_cash_sales,
        'card_sales', v_card_sales,
        'transfer_sales', v_transfer_sales,
        'credit_sales', v_credit_sales,
        'other_sales', v_other_sales,
        'sales_buckets_total', ROUND(v_cash_sales + v_card_sales + v_transfer_sales + v_credit_sales + v_other_sales, 4),
        'returns_cash', v_returns_cash,
        'returns_card', v_returns_card,
        'cash_receipts', v_cash_receipts,
        'cash_disbursements', v_cash_disbursements,
        'card_receipts', v_card_receipts,
        'petty_expenses_cash', v_petty_expenses,
        'expected_cash_in_drawer', v_expected_cash,
        'expected_card_terminal', v_expected_card,
        'sales_by_currency', v_sales_by_currency,
        'employee_breakdown', v_employee_breakdown,
        'existing_reconciliation', v_existing_reconciliation,
        'is_already_closed', (
            v_existing_reconciliation IS NOT NULL
            AND COALESCE(v_existing_reconciliation->>'is_locked', 'false') = 'true'
        )
    );
END;
$$;
-- ------------------------------------------------------------------------------
-- 2) commit_daily_reconciliation — إقفال ذرّي + مبرر الفارق إلزامي + عهدة من الخادم
--    (نفس التوقيع تمامًا: لا تغيير في عقد الواجهة، لذا يُستبدل بـ CREATE OR REPLACE)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_daily_reconciliation(
    p_company_id uuid,
    p_date date,
    p_branch_id uuid,
    p_opening_float numeric,
    p_actual_cash_counted numeric,
    p_cash_denominations jsonb,
    p_card_terminal_receipt_total numeric,
    p_float_retained_for_tomorrow numeric,
    p_cash_handed_to_owner numeric,
    p_variance_reason text DEFAULT NULL,
    p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id uuid;
    v_user_role text;
    v_summary jsonb;
    v_opening_float numeric(19,4);
    v_expected_cash numeric(19,4);
    v_cash_variance numeric(19,4);
    v_expected_card numeric(19,4);
    v_card_variance numeric(19,4);
    v_tolerance numeric(19,4) := 10;
    v_branch_count integer := 0;
    v_reconciliation_id uuid;
    v_existing_locked boolean := false;
BEGIN
    -- ملاحظة: p_opening_float يُقبل للتوافق مع الواجهة لكن لا يُحتسب؛
    -- العهدة الافتتاحية تُشتق من الخادم (فكة اليوم السابق) لمنع تلاعب العميل بها.
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'عذراً، يجب تسجيل الدخول أولاً' USING ERRCODE = '42501';
    END IF;

    PERFORM public.verify_company_access(p_company_id);

    SELECT ucr.role INTO v_user_role
    FROM public.user_company_roles ucr
    WHERE ucr.user_id = v_user_id AND ucr.company_id = p_company_id
    LIMIT 1;

    IF v_user_role = 'viewer' THEN
        RAISE EXCEPTION 'عذراً، لا تمتلك صلاحية لإقفال يومية الصندوق والمطابقة'
            USING ERRCODE = '42501';
    END IF;

    -- (P1) قفل استشاري ذرّي: يمنع إقفالين متزامنين لنفس (منشأة + فرع + يوم) فيولّد صفوفًا مكررة
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            p_company_id::text || ':' || COALESCE(p_branch_id::text, 'company-scope') || ':' || p_date::text,
            0
        )
    );

    -- (P0) منع الإقفال على نطاق المنشأة كاملة عند تعدد الفروع (كان يجمع كل الفروع في صف واحد)
    SELECT COUNT(*)::integer INTO v_branch_count
    FROM public.branches br
    WHERE br.company_id = p_company_id;

    IF p_branch_id IS NULL AND v_branch_count > 1 THEN
        RAISE EXCEPTION 'عذراً، يجب تحديد الفرع قبل إقفال اليومية (هذه المنشأة بها % فروع). اختر الفرع ثم أعد المحاولة', v_branch_count
            USING ERRCODE = '22023';
    END IF;

    -- وجود إقفال سابق لنفس اليوم والفرع (مطابقة صارمة IS NOT DISTINCT FROM)
    SELECT dr.id, dr.is_locked INTO v_reconciliation_id, v_existing_locked
    FROM public.daily_reconciliations dr
    WHERE dr.company_id = p_company_id
      AND dr.branch_id IS NOT DISTINCT FROM p_branch_id
      AND dr.reconciliation_date = p_date
      AND dr.shift_number = 1
    LIMIT 1;

    -- حارس المالك الصارم: اليومية المقفلة لا تُعدّل إلا من المالك
    IF v_reconciliation_id IS NOT NULL AND v_existing_locked = true THEN
        IF v_user_role <> 'owner' THEN
            RAISE EXCEPTION 'عذراً، لا تمتلك صلاحية لتعديل إقفال يومية مقفلة بالفعل. هذا الإجراء مقتصر على المالك فقط'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    v_summary := public.get_daily_drawer_summary(p_company_id, p_date, p_branch_id);

    v_expected_cash := COALESCE((v_summary->>'expected_cash_in_drawer')::numeric, 0);
    v_expected_card := COALESCE((v_summary->>'expected_card_terminal')::numeric, 0);
    v_tolerance := COALESCE((v_summary->>'variance_tolerance')::numeric, 10);
    v_opening_float := COALESCE((v_summary->>'opening_float')::numeric, 0);

    v_cash_variance := ROUND(COALESCE(p_actual_cash_counted, 0) - v_expected_cash, 4);
    v_card_variance := ROUND(COALESCE(p_card_terminal_receipt_total, 0) - v_expected_card, 4);
    -- (P1) إلزام مبرر الفارق خارج حد التسامح
    --      كان p_variance_reason اختياريًا تمامًا فلا يوجد أي حارس فعلي للفروقات.
    --      ERRCODE 22023 لأن 42501 تُترجم في errorUtils إلى رسالة صلاحيات عامة فتُبتلع الرسالة.
    IF ABS(v_cash_variance) > v_tolerance
       AND COALESCE(NULLIF(TRIM(p_variance_reason), ''), '') = '' THEN
        RAISE EXCEPTION 'عذراً، يجب كتابة سبب (مبرر) فارق الكاش % عندما يتجاوز حد التسامح %',
            v_cash_variance, v_tolerance
            USING ERRCODE = '22023';
    END IF;

    IF ABS(v_card_variance) > v_tolerance
       AND COALESCE(NULLIF(TRIM(p_variance_reason), ''), '') = '' THEN
        RAISE EXCEPTION 'عذراً، يجب كتابة سبب (مبرر) فارق الشبكة % عندما يتجاوز حد التسامح %',
            v_card_variance, v_tolerance
            USING ERRCODE = '22023';
    END IF;

    IF v_reconciliation_id IS NOT NULL THEN
        UPDATE public.daily_reconciliations SET
            opening_float = v_opening_float,
            float_retained_for_tomorrow = COALESCE(p_float_retained_for_tomorrow, 0),
            cash_handed_to_owner = COALESCE(p_cash_handed_to_owner, 0),
            total_sales = COALESCE((v_summary->>'total_sales')::numeric, 0),
            cash_sales = COALESCE((v_summary->>'cash_sales')::numeric, 0),
            card_sales = COALESCE((v_summary->>'card_sales')::numeric, 0),
            transfer_sales = COALESCE((v_summary->>'transfer_sales')::numeric, 0),
            credit_sales = COALESCE((v_summary->>'credit_sales')::numeric, 0),
            returns_cash = COALESCE((v_summary->>'returns_cash')::numeric, 0),
            returns_card = COALESCE((v_summary->>'returns_card')::numeric, 0),
            cash_receipts = COALESCE((v_summary->>'cash_receipts')::numeric, 0),
            cash_disbursements = COALESCE((v_summary->>'cash_disbursements')::numeric, 0),
            petty_expenses_cash = COALESCE((v_summary->>'petty_expenses_cash')::numeric, 0),
            expected_cash_in_drawer = v_expected_cash,
            actual_cash_counted = COALESCE(p_actual_cash_counted, 0),
            cash_denominations = COALESCE(p_cash_denominations, '{}'::jsonb),
            card_terminal_receipt_total = COALESCE(p_card_terminal_receipt_total, 0),
            cash_variance = v_cash_variance,
            card_variance = v_card_variance,
            variance_reason = p_variance_reason,
            employee_breakdown = COALESCE(v_summary->'employee_breakdown', '[]'::jsonb),
            notes = p_notes,
            closed_by = v_user_id,
            closed_at = now(),
            is_locked = true,
            updated_at = now()
        WHERE id = v_reconciliation_id;
    ELSE
        INSERT INTO public.daily_reconciliations (
            company_id,
            branch_id,
            reconciliation_date,
            shift_number,
            status,
            opening_float,
            float_retained_for_tomorrow,
            cash_handed_to_owner,
            total_sales,
            cash_sales,
            card_sales,
            transfer_sales,
            credit_sales,
            returns_cash,
            returns_card,
            cash_receipts,
            cash_disbursements,
            petty_expenses_cash,
            expected_cash_in_drawer,
            actual_cash_counted,
            cash_denominations,
            card_terminal_receipt_total,
            cash_variance,
            card_variance,
            variance_reason,
            employee_breakdown,
            notes,
            closed_by,
            closed_at,
            is_locked
        ) VALUES (
            p_company_id,
            p_branch_id,
            p_date,
            1,
            'closed',
            v_opening_float,
            COALESCE(p_float_retained_for_tomorrow, 0),
            COALESCE(p_cash_handed_to_owner, 0),
            COALESCE((v_summary->>'total_sales')::numeric, 0),
            COALESCE((v_summary->>'cash_sales')::numeric, 0),
            COALESCE((v_summary->>'card_sales')::numeric, 0),
            COALESCE((v_summary->>'transfer_sales')::numeric, 0),
            COALESCE((v_summary->>'credit_sales')::numeric, 0),
            COALESCE((v_summary->>'returns_cash')::numeric, 0),
            COALESCE((v_summary->>'returns_card')::numeric, 0),
            COALESCE((v_summary->>'cash_receipts')::numeric, 0),
            COALESCE((v_summary->>'cash_disbursements')::numeric, 0),
            COALESCE((v_summary->>'petty_expenses_cash')::numeric, 0),
            v_expected_cash,
            COALESCE(p_actual_cash_counted, 0),
            COALESCE(p_cash_denominations, '{}'::jsonb),
            COALESCE(p_card_terminal_receipt_total, 0),
            v_cash_variance,
            v_card_variance,
            p_variance_reason,
            COALESCE(v_summary->'employee_breakdown', '[]'::jsonb),
            p_notes,
            v_user_id,
            now(),
            true
        ) RETURNING id INTO v_reconciliation_id;
    END IF;
    RETURN jsonb_build_object(
        'success', true,
        'reconciliation_id', v_reconciliation_id,
        'base_currency', COALESCE(v_summary->>'base_currency', 'SAR'),
        'opening_float', v_opening_float,
        'expected_cash_in_drawer', v_expected_cash,
        'expected_card_terminal', v_expected_card,
        'cash_variance', v_cash_variance,
        'card_variance', v_card_variance,
        'variance_tolerance', v_tolerance,
        'is_within_tolerance', (ABS(v_cash_variance) <= v_tolerance AND ABS(v_card_variance) <= v_tolerance),
        'cash_handed_to_owner', COALESCE(p_cash_handed_to_owner, 0),
        'float_retained_for_tomorrow', COALESCE(p_float_retained_for_tomorrow, 0),
        'message', 'تم إقفال يومية المحل واعتماد المطابقة بنجاح'
    );
END;
$$;
-- ------------------------------------------------------------------------------
-- 3) record_quick_drawer_expense — تسجيل محاسبي حقيقي + عملة/سعر صرف + منع تكرار
--    قبل الإصلاح: صف في expenses بـ currency_code = SAR و exchange_rate = 1 دائمًا،
--    وبلا أي قيد محاسبي (لا Trigger على expenses يُرحّل القيود) → الكاش يخرج من الدرج
--    بلا أثر في دفتر الأستاذ، وتضخّم 410× عند إدخال مبالغ بالريال اليمني.
--    الشرائح: نمرّر المبلغ/العملة/السعر إلى commit_expense_v2 (المسار المعتمد للترحيل).
-- ------------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.record_quick_drawer_expense(uuid, numeric, text, uuid, date);

CREATE OR REPLACE FUNCTION public.record_quick_drawer_expense(
    p_company_id uuid,
    p_amount numeric,
    p_description text,
    p_branch_id uuid DEFAULT NULL::uuid,
    p_expense_date date DEFAULT CURRENT_DATE,
    p_currency_code text DEFAULT NULL::text,
    p_exchange_rate numeric DEFAULT NULL::numeric,
    p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id uuid;
    v_base_currency text := 'SAR';
    v_currency text;
    v_rate numeric;
    v_category_id uuid;
    v_actual_date date;
    v_existing record;
    v_result jsonb;
BEGIN
    -- ملاحظة: p_exchange_rate يُقرأ عبر jsonb_build_object أدناه، وp_idempotency_key
    -- يمرّ للتوافق مع عقود مستقبلية (التكرار يُكتشف حاليًا بنافذة زمنية 3 دقائق).
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'عذراً، يجب تسجيل الدخول أولاً' USING ERRCODE = '42501';
    END IF;

    PERFORM public.verify_company_access(p_company_id);

    v_actual_date := COALESCE(p_expense_date, CURRENT_DATE);

    -- حارس يوم الإقفال (مطابقة صارمة للفرع: كان NULL يشمل كل الفروع)
    IF EXISTS (
        SELECT 1 FROM public.daily_reconciliations dr
        WHERE dr.company_id = p_company_id
          AND dr.branch_id IS NOT DISTINCT FROM p_branch_id
          AND dr.reconciliation_date = v_actual_date
          AND dr.is_locked = true
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.user_company_roles ucr
            WHERE ucr.user_id = v_user_id
              AND ucr.company_id = p_company_id
              AND ucr.role = 'owner'
        ) THEN
            RAISE EXCEPTION 'عذراً، لا تمتلك صلاحية لإضافة مصروف ليوم تم إقفاله ومطابقته (تاريخ: %). هذا الإجراء مقتصر على المالك', v_actual_date
                USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'عذراً، مبلغ المصروف يجب أن يكون أكبر من صفر' USING ERRCODE = '22023';
    END IF;

    IF p_description IS NULL OR TRIM(p_description) = '' THEN
        RAISE EXCEPTION 'عذراً، يرجى كتابة بيان المصروف' USING ERRCODE = '22023';
    END IF;
    SELECT COALESCE(NULLIF(TRIM(c.base_currency), ''), 'SAR') INTO v_base_currency
    FROM public.companies c
    WHERE c.id = p_company_id
    LIMIT 1;
    v_base_currency := COALESCE(v_base_currency, 'SAR');

    -- العملة: الممرَّرة ← آخر عملة استُخدمت في مصروفات الدرج (تذكّر التفضيل) ← عملة الأساس
    v_currency := NULLIF(UPPER(TRIM(COALESCE(p_currency_code, ''))), '');
    IF v_currency IS NULL THEN
        SELECT e.currency_code INTO v_currency
        FROM public.expenses e
        WHERE e.company_id = p_company_id
          AND e.payment_method = 'cash'
          AND e.currency_code IS NOT NULL
          AND e.deleted_at IS NULL
        ORDER BY e.created_at DESC
        LIMIT 1;
    END IF;
    v_currency := COALESCE(v_currency, v_base_currency);

    -- سعر الصرف: الممرَّر ← أحدث سعر مسجل في exchange_rates ← رفض صريح (لا سعر وهمي 1)
    v_rate := NULLIF(p_exchange_rate, 0);
    IF v_currency = v_base_currency THEN
        v_rate := 1;
    ELSE
        IF v_rate IS NULL OR v_rate <= 0 THEN
            SELECT er.rate_to_base INTO v_rate
            FROM public.exchange_rates er
            WHERE er.company_id = p_company_id
              AND er.currency_code = v_currency
              AND er.effective_date <= v_actual_date
            ORDER BY er.effective_date DESC, er.created_at DESC
            LIMIT 1;
        END IF;

        IF v_rate IS NULL OR v_rate <= 0 THEN
            RAISE EXCEPTION 'عذراً، لا يوجد سعر صرف مسجل لعملة % بتاريخ %. يرجى تحديث أسعار الصرف من الإعدادات ثم إعادة المحاولة', v_currency, v_actual_date
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- منع تكرار النقر المزدوج: نفس (الفرع + اليوم + المبلغ + البيان) خلال 3 دقائق
    SELECT e.id, e.voucher_number, e.amount, e.currency_code, e.exchange_rate INTO v_existing
    FROM public.expenses e
    WHERE e.company_id = p_company_id
      AND e.branch_id IS NOT DISTINCT FROM p_branch_id
      AND e.expense_date = v_actual_date
      AND e.payment_method = 'cash'
      AND e.deleted_at IS NULL
      AND ABS(e.amount - p_amount) < 0.0001
      AND TRIM(e.description) = TRIM(p_description)
      AND e.created_at > (now() - interval '3 minutes')
    ORDER BY e.created_at DESC
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'duplicate', true,
            'expense_id', v_existing.id,
            'voucher_number', v_existing.voucher_number,
            'amount', v_existing.amount,
            'currency_code', v_existing.currency_code,
            'exchange_rate', v_existing.exchange_rate,
            'description', TRIM(p_description),
            'expense_date', v_actual_date,
            'message', 'تم تجاهل النقر المزدوج — المصروف مسجَّل بالفعل بنفس البيانات'
        );
    END IF;

    -- تصنيف المصروفات النثرية (أو العام) — نفس سلوك النسخة السابقة
    SELECT ec.id INTO v_category_id
    FROM public.expense_categories ec
    WHERE ec.company_id = p_company_id AND ec.deleted_at IS NULL
    ORDER BY (CASE WHEN ec.name LIKE '%نثر%' OR ec.name LIKE '%نثريات%' THEN 0 ELSE 1 END), ec.created_at ASC
    LIMIT 1;

    IF v_category_id IS NULL THEN
        INSERT INTO public.expense_categories (company_id, name, description)
        VALUES (p_company_id, 'نثريات ومصروفات الدرج', 'المصروفات النثرية اليومية السريعة من الدرج')
        RETURNING id INTO v_category_id;
    END IF;

    -- التفويض للمسار المعتمد: يُنشئ المصروف + قيد اليومية المتوازن معًا
    v_result := public.commit_expense_v2(
        p_company_id,
        v_user_id,
        jsonb_build_object(
            'category_id', v_category_id,
            'amount', p_amount,
            'currency_code', v_currency,
            'exchange_rate', v_rate,
            'expense_date', v_actual_date,
            'description', TRIM(p_description),
            'payment_method', 'cash',
            'branch_id', p_branch_id,
            'idempotency_key', p_idempotency_key
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'duplicate', false,
        'expense_id', v_result->>'id',
        'voucher_number', v_result->>'voucher_number',
        'journal_entry_id', v_result->>'journal_entry_id',
        'amount', p_amount,
        'base_amount', v_result->>'base_amount',
        'currency_code', v_currency,
        'exchange_rate', v_rate,
        'base_currency', v_base_currency,
        'description', TRIM(p_description),
        'expense_date', v_actual_date,
        'message', 'تم تسجيل مصروف الدرج وترحيل قيده المحاسبي بنجاح'
    );
END;
$$;
-- ------------------------------------------------------------------------------
-- 3-ب) commit_expense_v2 — إصلاح تحويل سطور القيد إلى عملة الأساس + تقوية الهوية
--   (نفس التوقيع والعقد تمامًا: idempotent عبر CREATE OR REPLACE، والترتيب بعد
--    record_quick_drawer_expense لا يؤثر لأن نداء الدوال في PL/pgSQL يُحل وقت التنفيذ.)
--   لماذا: النسخة الحالية (من 20260916000014) تُسجّل debit_amount/credit_amount
--   بالمبلغ الأجنبي كما هو في دفتر بعملة الأساس وتُهمل exchange_rate/foreign_amount
--   → مصروف 15,000 YER يُقيَّد 15,000 في دفتر الأساس (تضخّم 410×). وهذا مسار كل
--   مصروفات النظام لا مصروف الدرج فقط. كما تُهمل created_by = auth.uid().
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_expense_v2(p_company_id uuid, p_user_id uuid, p_data jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();   -- لا نأتمن p_user_id القادم من العميل على created_by
  v_expense_id uuid;
  v_voucher_number text;
  v_category_id uuid;
  v_amount numeric;
  v_base_amount numeric;
  v_currency_code text;
  v_exchange_rate numeric;
  v_date date;
  v_description text;
  v_payment_method text;
  v_branch_id uuid;
  v_fiscal_year_id uuid;
  v_cash_account_id uuid;
  v_expense_account_id uuid;
  v_entry_id uuid;
  v_raw_cat text;
  v_raw_branch text;
  v_raw_amount text;
  v_raw_rate text;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id_required: معرف المنشأة مطلوب';
  END IF;

  PERFORM public.verify_company_access(p_company_id);

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'عذراً، يجب تسجيل الدخول أولاً' USING ERRCODE = '42501';
  END IF;

  -- 1) تصفية معرف التصنيف (UUID سليم + ملكية المنشأة)
  v_raw_cat := TRIM(COALESCE(p_data->>'category_id', ''));
  IF v_raw_cat <> '' AND v_raw_cat ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_category_id := v_raw_cat::uuid;
  ELSE
    v_category_id := NULL;
  END IF;

  IF v_category_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.expense_categories ec
    WHERE ec.id = v_category_id AND ec.company_id = p_company_id AND ec.deleted_at IS NULL
  ) THEN
    v_category_id := NULL;
  END IF;

  IF v_category_id IS NULL THEN
    SELECT ec.id INTO v_category_id FROM public.expense_categories ec
    WHERE ec.company_id = p_company_id AND ec.deleted_at IS NULL
    ORDER BY ec.is_system DESC, ec.created_at ASC
    LIMIT 1;

    IF v_category_id IS NULL THEN
      INSERT INTO public.expense_categories (company_id, name, is_system)
      VALUES (p_company_id, 'مصروفات عامة', true)
      RETURNING id INTO v_category_id;
    END IF;
  END IF;

  -- 2) تصفية المبلغ
  v_raw_amount := REPLACE(REPLACE(COALESCE(p_data->>'amount', '0'), ',', '.'), ' ', '');
  v_amount := COALESCE(NULLIF(v_raw_amount, '')::numeric, 0);
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount: مبلغ المصروف يجب أن يكون أكبر من الصفر';
  END IF;

  -- 3) العملة وسعر الصرف (استرجاع أحدث سعر مسجل عند غياب السعر)
  v_currency_code := UPPER(COALESCE(NULLIF(TRIM(p_data->>'currency_code'), ''), NULLIF(TRIM(p_data->>'currency'), ''), 'SAR'));

  v_raw_rate := REPLACE(TRIM(COALESCE(p_data->>'exchange_rate', '')), ',', '.');
  IF v_raw_rate <> '' AND v_raw_rate ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_exchange_rate := v_raw_rate::numeric;
  ELSE
    v_exchange_rate := NULL;
  END IF;

  IF v_currency_code = 'SAR' THEN
    v_exchange_rate := 1;
  ELSIF v_exchange_rate IS NULL OR v_exchange_rate <= 0 THEN
    SELECT er.rate_to_base INTO v_exchange_rate
    FROM public.exchange_rates er
    WHERE er.company_id = p_company_id AND er.currency_code = v_currency_code
    ORDER BY er.effective_date DESC, er.created_at DESC
    LIMIT 1;
    v_exchange_rate := COALESCE(NULLIF(v_exchange_rate, 0), 1);
  END IF;

  -- 4) تحويل المبلغ إلى عملة الأساس (المُسند المعتمد fn_to_base_amount)
  v_base_amount := public.fn_to_base_amount(v_currency_code, v_amount, v_exchange_rate);
  -- 5) تصفية التاريخ والفرع
  BEGIN
    v_date := COALESCE(
      NULLIF(p_data->>'expense_date', '')::date,
      NULLIF(p_data->>'date', '')::date,
      CURRENT_DATE
    );
  EXCEPTION WHEN OTHERS THEN
    v_date := CURRENT_DATE;
  END;

  v_description := COALESCE(NULLIF(TRIM(p_data->>'description'), ''), 'مصروف نثري');
  v_payment_method := COALESCE(NULLIF(TRIM(p_data->>'payment_method'), ''), 'cash');

  v_raw_branch := TRIM(COALESCE(p_data->>'branch_id', ''));
  IF v_raw_branch <> '' AND v_raw_branch ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_branch_id := v_raw_branch::uuid;
  ELSE
    v_branch_id := NULL;
  END IF;

  -- 6) السنة المالية المفتوحة
  SELECT fy.id INTO v_fiscal_year_id FROM public.fiscal_years fy
  WHERE fy.company_id = p_company_id AND fy.is_closed = false
    AND v_date BETWEEN fy.start_date AND fy.end_date
  LIMIT 1;

  -- 7) رقم إيصال المصروف (نمط EXP-YYYYMMDD-XXXX المتبع في النظام)
  v_voucher_number := TRIM(COALESCE(p_data->>'voucher_number', ''));
  IF v_voucher_number = '' THEN
    v_voucher_number := 'EXP-' || to_char(v_date, 'YYYYMMDD') || '-' ||
      UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 4));
  END IF;

  -- 8) إدراج المصروف (entry_number في القيود يولّده trg_generate_entry_number تلقائيًا)
  INSERT INTO public.expenses (
    company_id, category_id, voucher_number, description,
    amount, currency_code, exchange_rate, expense_date,
    status, payment_method, created_by, branch_id
  ) VALUES (
    p_company_id, v_category_id, v_voucher_number, v_description,
    v_amount, v_currency_code, v_exchange_rate, v_date,
    'posted', v_payment_method, v_uid, v_branch_id
  ) RETURNING id INTO v_expense_id;

  -- 9) حساب المصروف القابل للترحيل
  SELECT a.id INTO v_expense_account_id
  FROM public.expense_categories ec
  JOIN public.accounts a ON a.id = ec.account_id
  WHERE ec.id = v_category_id
    AND a.company_id = p_company_id
    AND a.allow_posting = true
    AND a.is_active = true
    AND a.deleted_at IS NULL;

  IF v_expense_account_id IS NULL THEN
    SELECT a.id INTO v_expense_account_id FROM public.accounts a
    WHERE a.company_id = p_company_id
      AND (a.type = 'expense' OR a.code LIKE '5%')
      AND a.allow_posting = true
      AND a.is_active = true
      AND a.deleted_at IS NULL
    ORDER BY CASE WHEN a.code LIKE '5%' THEN 0 ELSE 1 END, a.code
    LIMIT 1;
  END IF;

  -- 10) حساب الصندوق/النقد القابل للترحيل (يفضّل نفس عملة المصروف)
  SELECT a.id INTO v_cash_account_id FROM public.accounts a
  WHERE a.company_id = p_company_id
    AND (a.code LIKE '101%' OR a.code LIKE '1101%' OR (a.type = 'asset' AND (a.name_ar LIKE '%صندوق%' OR a.name_ar LIKE '%نقد%' OR a.name_ar LIKE '%كاش%')))
    AND a.allow_posting = true
    AND a.is_active = true
    AND a.deleted_at IS NULL
  ORDER BY CASE WHEN a.currency_code = v_currency_code THEN 0 ELSE 1 END, a.code
  LIMIT 1;

  IF v_cash_account_id IS NULL THEN
    SELECT a.id INTO v_cash_account_id FROM public.accounts a
    WHERE a.company_id = p_company_id
      AND a.type = 'asset'
      AND a.allow_posting = true
      AND a.is_active = true
      AND a.deleted_at IS NULL
    ORDER BY a.code
    LIMIT 1;
  END IF;

  -- 11) القيد: مدين مصروف / دائن نقدية — بعملة الأساس مع حفظ المبلغ الأجنبي
  IF v_cash_account_id IS NOT NULL AND v_expense_account_id IS NOT NULL THEN
    INSERT INTO public.journal_entries (
      company_id, entry_date, description,
      reference_type, reference_id, status, created_by, branch_id, fiscal_year_id
    ) VALUES (
      p_company_id, v_date, v_description,
      'expense', v_expense_id, 'posted', v_uid, v_branch_id, v_fiscal_year_id
    ) RETURNING id INTO v_entry_id;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit_amount, credit_amount,
      description, currency_code, exchange_rate, foreign_amount, company_id, branch_id
    ) VALUES (
      v_entry_id, v_expense_account_id, v_base_amount, 0,
      v_description, v_currency_code, v_exchange_rate, v_amount, p_company_id, v_branch_id
    );

    INSERT INTO public.journal_entry_lines (
      journal_entry_id, account_id, debit_amount, credit_amount,
      description, currency_code, exchange_rate, foreign_amount, company_id, branch_id
    ) VALUES (
      v_entry_id, v_cash_account_id, 0, v_base_amount,
      v_description, v_currency_code, v_exchange_rate, v_amount, p_company_id, v_branch_id
    );
  END IF;

  -- 12) إرجاع عقد متوافق للأمام (id/voucher_number كما كانت) + بيانات التحويل
  RETURN jsonb_build_object(
    'id', v_expense_id,
    'expense_id', v_expense_id,
    'voucher_number', v_voucher_number,
    'journal_entry_id', v_entry_id,
    'amount', v_amount,
    'base_amount', v_base_amount,
    'currency_code', v_currency_code,
    'exchange_rate', v_exchange_rate,
    'status', 'posted'
  );
END;
$$;
-- ------------------------------------------------------------------------------
-- 4) الصلاحيات
--    (أ) التوقيعات الثلاثة الأولى لم تتغير → CREATE OR REPLACE يحافظ على ACL القائم،
--        لكن نُعيد السحب/المنح صراحةً للأمان والثبات مقابل أي تلاعب سابق بالمنح.
--    (ب) record_quick_drawer_expense أُعيد إنشاؤها بتوقيع موسّع (8 معاملات) بعد DROP،
--        والدوال الجديدة في PostgreSQL تحصل افتراضياً على EXECUTE لـ PUBLIC (ومنهم anon)،
--        لذا سحب المنح منها إلزامي لتفادي أي تنفيذ غير موثّق عبر PostgREST
--        (نفس نمط 20260819000004_privileges.sql و 2026090500000x).
-- ------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_daily_drawer_summary(uuid, date, uuid) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_daily_reconciliation(uuid, date, uuid, numeric, numeric, jsonb, numeric, numeric, numeric, text, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_quick_drawer_expense(uuid, numeric, text, uuid, date, text, numeric, text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commit_expense_v2(uuid, uuid, jsonb) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_daily_drawer_summary(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_drawer_summary(uuid, date, uuid) TO service_role;

GRANT EXECUTE ON FUNCTION public.commit_daily_reconciliation(uuid, date, uuid, numeric, numeric, jsonb, numeric, numeric, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_daily_reconciliation(uuid, date, uuid, numeric, numeric, jsonb, numeric, numeric, numeric, text, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.record_quick_drawer_expense(uuid, numeric, text, uuid, date, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_quick_drawer_expense(uuid, numeric, text, uuid, date, text, numeric, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.commit_expense_v2(uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commit_expense_v2(uuid, uuid, jsonb) TO service_role;