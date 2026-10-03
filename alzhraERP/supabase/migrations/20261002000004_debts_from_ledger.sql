-- 2026-10-02: توحيد مصدر مديونية العملاء — قراءة الرصيد من دفتر الذمم (حساب 121 الزبائن)
--
-- المشكلة: كانت الدالة تحسب المديونية من رؤوس الفواتير (total_amount − paid_amount)
--          فتُهمل 14,479 سند قبض بقيمة 7,371,080.66 ر.س مُقيَّدة في الدفتر على حساب الزبائن
--          ولم تُخصَّص على الفواتير ⇒ يظهر الدين 2,622,207.91 بينما الدفتر يقول 1,574,741.60
--          (تناقض صريح بين صفحة الديون وكشوف الحسابات).
--
-- الحل:   المبلغ  ← من دفتر الذمم (121) لكل طرف ولكل عملة  (المصدر المحاسبي الوحيد)
--          التقادم ← من تواريخ استحقاق الفواتير (كما هو، مع سقف أعلى لا يتجاوز رصيد الدفتر)
--
-- الأثر:  تتطابق صفحة الديون مع كشوف الحسابات تماماً، ويختفي التناقض.

CREATE OR REPLACE FUNCTION public.get_debt_followup_dashboard(
  p_company_id uuid,
  p_due_soon_days integer DEFAULT 7,
  p_critical_days integer DEFAULT 30,
  p_reminder_window_days integer DEFAULT 3,
  p_branch_id uuid DEFAULT NULL::uuid,
  p_limit integer DEFAULT NULL::integer
)
RETURNS TABLE(
  party_id uuid, party_name text, party_phone text, category text, credit_limit numeric,
  currency_code text, outstanding_balance numeric, overdue_amount numeric,
  oldest_due_date date, next_due_date date, days_overdue integer, classification text,
  reminder_status text, last_reminded_at timestamp with time zone, last_contact_date timestamp with time zone,
  has_broken_promise boolean, pending_promise_count bigint, pending_promise_amount numeric,
  pending_promise_date date, invoice_count bigint, opening_balance numeric, escalation_stage text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_allowed_branches uuid[];
    v_target_branches uuid[];
    v_is_super boolean;
    v_has_all_branches boolean := false;
    v_stage_call integer;
    v_stage_visit integer;
    v_stage_legal integer;
BEGIN
    PERFORM public.fn_assert_company_access(p_company_id);

    SELECT c.stage_call_days, c.stage_visit_days, c.stage_legal_days
      INTO v_stage_call, v_stage_visit, v_stage_legal
      FROM public.debt_followup_config c
     WHERE c.company_id = p_company_id
     LIMIT 1;

    v_stage_call  := COALESCE(v_stage_call, 30);
    v_stage_visit := COALESCE(v_stage_visit, 60);
    v_stage_legal := COALESCE(v_stage_legal, 90);

    v_is_super := public.is_super_admin() OR current_user IN ('postgres', 'supabase_admin');

    SELECT ARRAY_AGG(b) INTO v_allowed_branches FROM public.get_auth_branches(p_company_id) AS b;

    IF v_allowed_branches IS NULL OR ARRAY_LENGTH(v_allowed_branches, 1) = 0 THEN
        IF v_is_super THEN
            SELECT ARRAY_AGG(id) INTO v_allowed_branches FROM public.branches WHERE company_id = p_company_id;
        ELSE
            RETURN;
        END IF;
    END IF;

    IF p_branch_id IS NOT NULL THEN
        IF NOT (p_branch_id = ANY(v_allowed_branches)) AND NOT v_is_super THEN
            RETURN;
        END IF;
        v_target_branches := ARRAY[p_branch_id];
    ELSE
        v_target_branches := v_allowed_branches;
        SELECT (COUNT(*) = (SELECT COUNT(*) FROM public.branches WHERE company_id = p_company_id))
        INTO v_has_all_branches
        FROM unnest(v_allowed_branches);
    END IF;

    RETURN QUERY
    WITH ar_accounts AS (
        SELECT a.id
          FROM public.accounts a
         WHERE a.deleted_at IS NULL AND left(a.code, 3) = '121'
    ),
    -- المديونية من دفتر الذمم (المصدر المحاسبي الوحيد) لكل طرف ولكل عملة
    ledger_debts AS (
        SELECT jel.party_id,
               jel.currency_code::text AS cur,
               sum(
                 CASE
                   WHEN upper(TRIM(BOTH FROM jel.currency_code)) <> 'SAR'
                     THEN COALESCE(NULLIF(jel.foreign_amount, 0), abs(jel.debit_amount - jel.credit_amount))
                          * CASE WHEN jel.debit_amount >= jel.credit_amount THEN 1 ELSE -1 END
                   ELSE jel.debit_amount - jel.credit_amount
                 END
               )::numeric AS outstanding
          FROM public.journal_entry_lines jel
          JOIN public.journal_entries je ON je.id = jel.journal_entry_id
         WHERE jel.deleted_at IS NULL
           AND jel.party_id IS NOT NULL
           AND jel.currency_code IS NOT NULL
           AND je.status = 'posted'
           AND je.deleted_at IS NULL
           AND jel.account_id IN (SELECT id FROM ar_accounts)
         GROUP BY jel.party_id, jel.currency_code
    ),
    -- تقادم الفواتير (للتواريخ والتصنيف فقط)
    invoice_aging AS (
        SELECT i.party_id,
               SUM(CASE WHEN i.due_date < v_today
                        THEN i.total_amount - COALESCE(i.paid_amount, 0) ELSE 0 END) AS overdue_amount,
               MIN(i.due_date) FILTER (WHERE i.due_date < v_today) AS oldest_due_date,
               MIN(i.due_date) FILTER (WHERE i.due_date >= v_today) AS next_due_date,
               COUNT(*) AS invoice_count
          FROM public.invoices i
         WHERE i.company_id = p_company_id
           AND i.type = 'sale'
           AND i.status IN ('posted', 'confirmed', 'partially_paid')
           AND (i.total_amount - COALESCE(i.paid_amount, 0)) > 0
           AND i.deleted_at IS NULL
           AND i.party_id IS NOT NULL
           AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
           AND (p_branch_id IS NOT NULL OR v_is_super OR v_has_all_branches OR i.branch_id = ANY(v_target_branches))
         GROUP BY i.party_id
    ),
    opening_balances AS (
        SELECT ob.party_id,
               ob.currency_code::text AS cur,
               sum(CASE WHEN ob.direction = 'debit' THEN ob.amount ELSE -ob.amount END) AS opening_amount
          FROM public.party_opening_balances ob
         WHERE ob.company_id = p_company_id
           AND (p_branch_id IS NULL OR ob.branch_id = p_branch_id)
           AND (p_branch_id IS NOT NULL OR v_is_super OR v_has_all_branches OR ob.branch_id = ANY(v_target_branches))
         GROUP BY ob.party_id, ob.currency_code
    ),
    combined AS (
        SELECT COALESCE(ld.party_id, ob.party_id) AS party_id,
               COALESCE(ld.cur, ob.cur) AS cur,
               COALESCE(ld.outstanding, 0) + COALESCE(ob.opening_amount, 0) AS outstanding_balance,
               COALESCE(ag.overdue_amount, 0) AS overdue_amount,
               ag.oldest_due_date,
               ag.next_due_date,
               COALESCE(ag.invoice_count, 0) AS invoice_count,
               COALESCE(ob.opening_amount, 0) AS opening_balance
          FROM ledger_debts ld
          FULL OUTER JOIN opening_balances ob ON ob.party_id = ld.party_id AND ob.cur = ld.cur
          LEFT JOIN invoice_aging ag ON ag.party_id = COALESCE(ld.party_id, ob.party_id)
    ),
    ranked_candidates AS (
        SELECT c.party_id,
               p.name::TEXT AS party_name,
               p.phone::TEXT AS party_phone,
               COALESCE(pc.name, 'عام')::TEXT AS category,
               p.credit_limit,
               c.cur AS currency_code,
               c.outstanding_balance,
               c.overdue_amount,
               c.oldest_due_date,
               c.next_due_date,
               CASE WHEN c.oldest_due_date IS NOT NULL THEN (v_today - c.oldest_due_date) ELSE 0 END AS days_overdue,
               CASE
                   WHEN c.oldest_due_date IS NOT NULL AND (v_today - c.oldest_due_date) >= p_critical_days THEN 'critical'
                   WHEN c.oldest_due_date IS NOT NULL AND c.oldest_due_date < v_today THEN 'overdue'
                   WHEN c.next_due_date = v_today THEN 'due_today'
                   WHEN c.next_due_date IS NOT NULL AND c.next_due_date <= v_today + p_due_soon_days THEN 'due_soon'
                   ELSE 'current'
               END AS classification,
               c.invoice_count,
               c.opening_balance
          FROM combined c
          JOIN public.parties p ON p.id = c.party_id AND p.deleted_at IS NULL
            AND (p_branch_id IS NULL OR p.branch_id = p_branch_id OR p.branch_id IS NULL)
          LEFT JOIN public.party_categories pc ON pc.id = p.category_id
         WHERE c.outstanding_balance > 0
         ORDER BY c.outstanding_balance DESC NULLS LAST
         LIMIT p_limit
    )
    SELECT rc.party_id, rc.party_name, rc.party_phone, rc.category, rc.credit_limit,
           rc.currency_code, rc.outstanding_balance,
           LEAST(rc.overdue_amount, rc.outstanding_balance) AS overdue_amount,
           rc.oldest_due_date, rc.next_due_date, rc.days_overdue, rc.classification,
           CASE
               WHEN lr.last_reminded_at IS NOT NULL
                    AND lr.last_reminded_at >= NOW() - make_interval(days => p_reminder_window_days)
                    THEN 'reminded'
               ELSE 'needs_reminder'
           END AS reminder_status,
           lr.last_reminded_at, lc.last_contact_date,
           COALESCE(ps.has_broken_promise, false) AS has_broken_promise,
           COALESCE(ps.pending_promise_count, 0) AS pending_promise_count,
           COALESCE(ps.pending_promise_amount, 0) AS pending_promise_amount,
           ps.pending_promise_date,
           rc.invoice_count, rc.opening_balance,
           CASE
               WHEN rc.days_overdue >= v_stage_legal THEN 'legal'
               WHEN rc.days_overdue >= v_stage_visit THEN 'visit'
               WHEN rc.days_overdue >= v_stage_call  THEN 'call'
               WHEN rc.days_overdue >  p_critical_days THEN 'reminder'
               ELSE 'monitor'
           END AS escalation_stage
      FROM ranked_candidates rc
      LEFT JOIN LATERAL (
          SELECT BOOL_OR(pp.status = 'broken') AS has_broken_promise,
                 COUNT(*) FILTER (WHERE pp.status = 'pending') AS pending_promise_count,
                 SUM(pp.amount) FILTER (WHERE pp.status = 'pending') AS pending_promise_amount,
                 MIN(pp.promise_date) FILTER (WHERE pp.status = 'pending') AS pending_promise_date
            FROM public.debt_payment_promises pp
           WHERE pp.company_id = p_company_id AND pp.party_id = rc.party_id
      ) ps ON true
      LEFT JOIN LATERAL (
          SELECT ml.created_at AS last_reminded_at
            FROM public.debt_message_log ml
           WHERE ml.company_id = p_company_id AND ml.party_id = rc.party_id AND ml.status = 'sent'
           ORDER BY ml.created_at DESC LIMIT 1
      ) lr ON true
      LEFT JOIN LATERAL (
          SELECT ca.created_at AS last_contact_date
            FROM public.customer_activities ca
           WHERE ca.company_id = p_company_id AND ca.customer_id = rc.party_id
           ORDER BY ca.created_at DESC LIMIT 1
      ) lc ON true
     ORDER BY rc.outstanding_balance DESC NULLS LAST, rc.days_overdue DESC NULLS LAST;
END;
$function$;
