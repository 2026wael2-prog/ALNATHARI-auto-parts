-- ============================================================
-- automate the monthly rent + payroll accrual
-- ============================================================
-- Two changes to post_monthly_rent_and_payroll():
--
-- 1. It queried `public.company_users`, a table that does not exist in this
--    database. The tenant membership table is `user_company_roles`, which is what
--    fn_assert_company_access and every other permission check use. The lookup sits
--    behind `auth.uid() IS NOT NULL`, so it was unreachable when the function runs
--    from cron (no JWT) — but any signed-in admin other than the owner would have
--    hit "relation company_users does not exist" instead of the intended
--    permission check. This was the last dangling reference in the database.
--
-- 2. The accrual is now scheduled monthly. The function is idempotent per calendar
--    month (it looks for existing journal entries whose description matches
--    "استحقاق إيجار"/"استحقاق رواتب" in that month), so a re-run cannot double-post.
--
-- Schedule: 00:30 UTC on the 1st. The database runs in UTC, and the function dates
-- the entries with date_trunc('month', current_date), matching the existing manual
-- entries which are all dated the 1st of their month. Running at 00:30 UTC on the
-- 1st avoids any chance of current_date still being the previous month (which it
-- would be if this ran on the last local day of the month).
--
-- Verified before scheduling, inside a transaction that was rolled back: accruing a
-- clean month produced two balanced entries — rent 743.90 (500 SAR + 100,000 YER at
-- 0.002439) and salaries 500.00 — and left no rows behind.

CREATE OR REPLACE FUNCTION public.post_monthly_rent_and_payroll(p_period_start date, p_company_id uuid DEFAULT 'cd8123f3-3cd4-4310-8b7a-042546c2b09c'::uuid, p_yer_rate numeric DEFAULT NULL::numeric, p_rent_sar numeric DEFAULT 500, p_rent_yer numeric DEFAULT 100000, p_sal_khader numeric DEFAULT 200, p_sal_mohammed_r numeric DEFAULT 200, p_sal_mohammed_h numeric DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user            uuid;
  v_period_label    text;
  v_seq             bigint;
  v_lock_key        bigint;
  v_je_rent         uuid;
  v_je_sal          uuid;
  v_yer_rate        numeric;
  -- حسابات
  v_acc_rent_exp    uuid;
  v_acc_rent_sar    uuid;
  v_acc_rent_yer    uuid;
  v_acc_salary      uuid;
  v_acc_emp1        uuid;
  v_acc_emp2        uuid;
  v_acc_emp3        uuid;
  -- أطراف
  v_party_landlord  uuid;
  v_party_khader    uuid;
  v_party_mohammed_r uuid;
  v_party_mohammed_h uuid;
  -- حماية التكرار
  v_already_rent    boolean := false;
  v_already_sal     boolean := false;
BEGIN
  -- التحقق من صلاحية المستخدم
  SELECT owner_id INTO v_user FROM public.companies WHERE id = p_company_id;
  IF auth.uid() IS NOT NULL AND auth.uid() <> v_user THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_company_roles
      WHERE company_id = p_company_id AND user_id = auth.uid()
        AND role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'عذراً، لا تمتلك صلاحية تشغيل القيود التلقائية';
    END IF;
    v_user := auth.uid();
  END IF;

  -- ➊ قراءة سعر الصرف تلقائياً من exchange_rates إذا لم يُمرَّر
  IF p_yer_rate IS NULL THEN
    SELECT rate_to_base INTO v_yer_rate
    FROM public.exchange_rates
    WHERE company_id = p_company_id AND currency_code = 'YER'
    ORDER BY effective_date DESC
    LIMIT 1;

    IF v_yer_rate IS NULL THEN
      RAISE EXCEPTION 'لا يوجد سعر صرف للريال اليمني في النظام. أضف سعر الصرف أولاً.';
    END IF;
  ELSE
    v_yer_rate := p_yer_rate;
  END IF;

  v_period_label := to_char(p_period_start, 'FMMonth YYYY');

  -- التحقق من عدم التكرار (بالشهر كاملاً لا اليوم فقط)
  SELECT EXISTS(
    SELECT 1 FROM public.journal_entries
    WHERE company_id = p_company_id
      AND entry_date >= date_trunc('month', p_period_start)::date
      AND entry_date <  (date_trunc('month', p_period_start) + INTERVAL '1 month')::date
      AND reference_type = 'manual'
      AND description ILIKE '%استحقاق إيجار%'
  ) INTO v_already_rent;

  SELECT EXISTS(
    SELECT 1 FROM public.journal_entries
    WHERE company_id = p_company_id
      AND entry_date >= date_trunc('month', p_period_start)::date
      AND entry_date <  (date_trunc('month', p_period_start) + INTERVAL '1 month')::date
      AND reference_type = 'manual'
      AND description ILIKE '%استحقاق رواتب%'
  ) INTO v_already_sal;

  IF v_already_rent AND v_already_sal THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'تم ترحيل قيود شهر ' || v_period_label || ' مسبقاً'
    );
  END IF;

  -- جلب معرّفات الحسابات
  SELECT id INTO v_acc_rent_exp FROM public.accounts WHERE company_id = p_company_id AND code = '5500';
  SELECT id INTO v_acc_rent_sar FROM public.accounts WHERE company_id = p_company_id AND code = '240001';
  SELECT id INTO v_acc_rent_yer FROM public.accounts WHERE company_id = p_company_id AND code = '240002';
  SELECT id INTO v_acc_salary   FROM public.accounts WHERE company_id = p_company_id AND code = '5400';
  SELECT id INTO v_acc_emp1     FROM public.accounts WHERE company_id = p_company_id AND code = '140001';
  SELECT id INTO v_acc_emp2     FROM public.accounts WHERE company_id = p_company_id AND code = '140002';
  SELECT id INTO v_acc_emp3     FROM public.accounts WHERE company_id = p_company_id AND code = '140003';

  -- جلب معرّفات الأطراف
  SELECT id INTO v_party_landlord   FROM public.parties WHERE company_id = p_company_id AND name = 'صاحب الإيجار'    AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_party_khader     FROM public.parties WHERE company_id = p_company_id AND name = 'الخضر صالح'      AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_party_mohammed_r FROM public.parties WHERE company_id = p_company_id AND name = 'محمد عبدالرقيب' AND deleted_at IS NULL LIMIT 1;
  SELECT id INTO v_party_mohammed_h FROM public.parties WHERE company_id = p_company_id AND name = 'محمد الحمادي'   AND deleted_at IS NULL LIMIT 1;

  -- ➋ حساب مفتاح advisory lock فريد لهذه الشركة
  v_lock_key := ('x' || substr(md5(p_company_id::text || '_journal_seq'), 1, 16))::bit(64)::bigint;

  -- ========================================================
  -- قيد استحقاق الإيجار
  -- ========================================================
  IF NOT v_already_rent THEN
    PERFORM pg_advisory_xact_lock(v_lock_key);
    SELECT COALESCE(MAX(entry_number), 0) + 1
    INTO v_seq
    FROM public.journal_entries WHERE company_id = p_company_id;

    INSERT INTO public.journal_entries
      (company_id, entry_number, entry_date, description, reference_type, status, created_by)
    VALUES
      (p_company_id, v_seq, p_period_start,
       'استحقاق إيجار المحل - ' || v_period_label,
       'manual', 'draft', v_user)
    RETURNING id INTO v_je_rent;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, company_id, party_id,
       debit_amount, credit_amount, currency_code, exchange_rate, foreign_amount, description)
    VALUES
      -- مدين: مصروف الإيجار (ر.س)
      (v_je_rent, v_acc_rent_exp, p_company_id, NULL,
       p_rent_sar, 0, 'SAR', 1, p_rent_sar,
       'مصروف إيجار المحل - ريال سعودي ' || v_period_label),
      -- دائن: مستحقات الإيجار (ر.س) ← مع ربط الطرف
      (v_je_rent, v_acc_rent_sar, p_company_id, v_party_landlord,
       0, p_rent_sar, 'SAR', 1, p_rent_sar,
       'مستحق إيجار لصاحب المحل - ريال سعودي'),
      -- مدين: مصروف الإيجار (ر.ي محوَّل)
      (v_je_rent, v_acc_rent_exp, p_company_id, NULL,
       ROUND(p_rent_yer * v_yer_rate, 4), 0,
       'YER', v_yer_rate, p_rent_yer,
       'مصروف إيجار المحل - ريال يمني ' || v_period_label),
      -- دائن: مستحقات الإيجار (ر.ي) ← مع ربط الطرف
      (v_je_rent, v_acc_rent_yer, p_company_id, v_party_landlord,
       0, ROUND(p_rent_yer * v_yer_rate, 4),
       'YER', v_yer_rate, p_rent_yer,
       'مستحق إيجار لصاحب المحل - ريال يمني');

    UPDATE public.journal_entries SET status = 'posted' WHERE id = v_je_rent;
  END IF;

  -- ========================================================
  -- قيد استحقاق الرواتب
  -- ========================================================
  IF NOT v_already_sal THEN
    PERFORM pg_advisory_xact_lock(v_lock_key);
    SELECT COALESCE(MAX(entry_number), 0) + 1
    INTO v_seq
    FROM public.journal_entries WHERE company_id = p_company_id;

    INSERT INTO public.journal_entries
      (company_id, entry_number, entry_date, description, reference_type, status, created_by)
    VALUES
      (p_company_id, v_seq, p_period_start,
       'استحقاق رواتب الموظفين - ' || v_period_label,
       'manual', 'draft', v_user)
    RETURNING id INTO v_je_sal;

    INSERT INTO public.journal_entry_lines
      (journal_entry_id, account_id, company_id, party_id,
       debit_amount, credit_amount, currency_code, exchange_rate, foreign_amount, description)
    VALUES
      -- مدين: مصروف الرواتب الإجمالي
      (v_je_sal, v_acc_salary, p_company_id, NULL,
       p_sal_khader + p_sal_mohammed_r + p_sal_mohammed_h, 0,
       'SAR', 1, p_sal_khader + p_sal_mohammed_r + p_sal_mohammed_h,
       'مصروف رواتب ' || v_period_label ||
       ': الخضر صالح + محمد عبدالرقيب + محمد الحمادي'),
      -- دائن: راتب مستحق - الخضر صالح
      (v_je_sal, v_acc_emp1, p_company_id, v_party_khader,
       0, p_sal_khader, 'SAR', 1, p_sal_khader,
       'راتب ' || v_period_label || ' - الخضر صالح'),
      -- دائن: راتب مستحق - محمد عبدالرقيب
      (v_je_sal, v_acc_emp2, p_company_id, v_party_mohammed_r,
       0, p_sal_mohammed_r, 'SAR', 1, p_sal_mohammed_r,
       'راتب ' || v_period_label || ' - محمد عبدالرقيب'),
      -- دائن: راتب مستحق - محمد الحمادي
      (v_je_sal, v_acc_emp3, p_company_id, v_party_mohammed_h,
       0, p_sal_mohammed_h, 'SAR', 1, p_sal_mohammed_h,
       'راتب ' || v_period_label || ' - محمد الحمادي');

    UPDATE public.journal_entries SET status = 'posted' WHERE id = v_je_sal;
  END IF;

  RETURN jsonb_build_object(
    'success',         true,
    'period',          v_period_label,
    'yer_rate_used',   v_yer_rate,
    'rent_entry_id',   v_je_rent,
    'salary_entry_id', v_je_sal,
    'rent_posted',     NOT v_already_rent,
    'salary_posted',   NOT v_already_sal,
    'message',         'تم ترحيل قيود ' || v_period_label || ' بنجاح'
  );
END;
$function$
;

-- Schedule the monthly run (idempotent: replace any job with this name).
DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'monthly-rent-payroll';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
END $$;

SELECT cron.schedule(
  'monthly-rent-payroll',
  '30 0 1 * *',
  $cron$SELECT public.post_monthly_rent_and_payroll(date_trunc('month', current_date)::date, 'cd8123f3-3cd4-4310-8b7a-042546c2b09c'::uuid);$cron$
);
