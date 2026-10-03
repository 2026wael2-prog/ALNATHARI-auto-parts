-- ============================================================================
-- 20261002000002_fix_party_balances_to_match_ledger.sql
-- ----------------------------------------------------------------------------
-- العطل (مُثبت بالقياس مقابل نسخة الميزان الأصلية 2026-10-02):
--
--   `party_balances` كانت تحسب رصيد الطرف من سطور الدفتر بشرطين خاطئين:
--     1) حصر الحسابات في (1100% | 121% | 2100% | 231%) — فاستثنت حسابات
--        عملاء حقيقية في الميزان بأكواد 132% و135% و211% و124% ... إلخ.
--     2) عكس الإشارة للحسابات 2100%/231% (باعتبارها التزامات) — بينما
--        الميزان يحتفظ لكل وكيل بحسابه الخاص ورصيده = (مدين − دائن) دائماً.
--
--   الأثر المقيس:
--     مجموع ديون العملاء في الميزان            = 5,865,571.04
--     مجموع سطور الأطراف في القاعدة (مدين−دائن) = 5,865,571.03  ✔ مطابق
--     ما تعرضه الواجهة عبر العرض الحالي         = 1,939,932.47  ✘ نقص 3,925,639
--     عدد الأطراف ذات الرصيد الخاطئ            = 215 (منها عكس إشارة كامل)
--
--   ومطابقة كل طرف على حدة (1,762 طرفاً) أعطت **صفر اختلاف** بين سطور الدفتر
--   والميزان ⇒ البيانات سليمة 100%، والخلل في دالة الحساب فقط.
--
-- الإصلاح:
--   balance = SUM(debit_amount − credit_amount) لكل سطور الطرف المرحّلة،
--   بلا فلترة حسابات وبلا عكس إشارة. موجب = مدين (عليه)، سالب = دائن (له).
--   كما نُغلق في الوقت نفسه ثغرة أمنية: العرضان كانا بلا `security_invoker`
--   وممنوحين لـ`anon` ⇒ أي زائر يقرأ أرصدة كل المنشآت.
-- ============================================================================

BEGIN;

-- ── 1) party_balances: رصيد مطابق للدفتر والميزان ───────────────────────────
CREATE OR REPLACE VIEW public.party_balances AS
WITH journal_bals AS (
  SELECT jel.party_id,
         jel.company_id,
         sum(jel.debit_amount - jel.credit_amount)::numeric(14,2) AS journal_balance
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.deleted_at IS NULL
    AND jel.party_id IS NOT NULL
    AND je.status = 'posted'
    AND je.deleted_at IS NULL
  GROUP BY jel.party_id, jel.company_id
),
latest_rates AS (
  SELECT DISTINCT ON (er.company_id, er.currency_code)
         er.company_id, er.currency_code, er.rate_to_base
  FROM public.exchange_rates er
  ORDER BY er.company_id, er.currency_code, er.effective_date DESC, er.created_at DESC
),
opening_bals AS (
  SELECT ob.party_id,
         ob.company_id,
         sum(
           CASE
             WHEN upper(TRIM(BOTH FROM COALESCE(ob.currency_code, 'SAR'))) = 'SAR' OR sc.is_base THEN ob.amount
             WHEN upper(TRIM(BOTH FROM ob.currency_code)) = 'YER' OR sc.exchange_operator = 'divide' THEN
               CASE
                 WHEN COALESCE(lr.rate_to_base, 410) > 1 THEN ob.amount / lr.rate_to_base
                 WHEN COALESCE(lr.rate_to_base, 0) > 0 AND lr.rate_to_base < 1 THEN ob.amount * lr.rate_to_base
                 ELSE ob.amount / 410
               END
             WHEN COALESCE(lr.rate_to_base, 1) > 0 AND lr.rate_to_base < 1 THEN ob.amount * lr.rate_to_base
             ELSE ob.amount * COALESCE(lr.rate_to_base, 1)
           END
           * CASE WHEN ob.direction = 'debit' THEN 1 ELSE -1 END
         )::numeric(14,2) AS opening_balance
  FROM public.party_opening_balances ob
  LEFT JOIN latest_rates lr ON lr.company_id = ob.company_id AND lr.currency_code = ob.currency_code::text
  LEFT JOIN public.supported_currencies sc ON sc.code = ob.currency_code::text
  GROUP BY ob.party_id, ob.company_id
)
SELECT p.id AS party_id,
       p.company_id,
       p.type,
       (COALESCE(jb.journal_balance, 0) + COALESCE(ob.opening_balance, 0))::numeric(14,2) AS balance
FROM public.parties p
LEFT JOIN journal_bals jb ON jb.party_id = p.id AND jb.company_id = p.company_id
LEFT JOIN opening_bals ob ON ob.party_id = p.id AND ob.company_id = p.company_id
WHERE p.deleted_at IS NULL;

-- ── 2) party_balances_by_currency: نفس القاعدة + المبلغ بعملة السطر ─────────
CREATE OR REPLACE VIEW public.party_balances_by_currency AS
WITH combined AS (
  SELECT jel.party_id,
         jel.company_id,
         jel.currency_code,
         sum(
           CASE
             WHEN jel.currency_code IS NOT NULL AND upper(TRIM(BOTH FROM jel.currency_code)) <> 'SAR'
               THEN COALESCE(NULLIF(jel.foreign_amount, 0), abs(jel.debit_amount - jel.credit_amount))
                    * CASE WHEN jel.debit_amount >= jel.credit_amount THEN 1 ELSE -1 END
             ELSE jel.debit_amount - jel.credit_amount
           END
         )::numeric(14,2) AS balance,
         count(*)::integer AS transaction_count,
         max(je.entry_date) AS last_activity_date
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.deleted_at IS NULL
    AND jel.party_id IS NOT NULL
    AND jel.currency_code IS NOT NULL
    AND je.status = 'posted'
    AND je.deleted_at IS NULL
  GROUP BY jel.party_id, jel.company_id, jel.currency_code
  UNION ALL
  SELECT ob.party_id,
         ob.company_id,
         ob.currency_code::text AS currency_code,
         sum(CASE WHEN ob.direction = 'debit' THEN ob.amount ELSE -ob.amount END)::numeric(14,2) AS balance,
         0 AS transaction_count,
         NULL::date AS last_activity_date
  FROM public.party_opening_balances ob
  GROUP BY ob.party_id, ob.company_id, ob.currency_code
)
SELECT party_id,
       company_id,
       currency_code,
       sum(balance)::numeric(14,2) AS balance,
       sum(transaction_count)::integer AS transaction_count,
       max(last_activity_date) AS last_activity_date
FROM combined
GROUP BY party_id, company_id, currency_code;

-- ── 3) إغلاق الثغرة: تنفيذ بامتيازات المستدعي + منع anon ────────────────────
ALTER VIEW public.party_balances SET (security_invoker = true);
ALTER VIEW public.party_balances_by_currency SET (security_invoker = true);

REVOKE ALL ON public.party_balances FROM anon, PUBLIC;
REVOKE ALL ON public.party_balances_by_currency FROM anon, PUBLIC;
GRANT SELECT ON public.party_balances TO authenticated;
GRANT SELECT ON public.party_balances_by_currency TO authenticated;

-- ── 4) توحيد دالة إعادة حساب رصيد طرف واحد على نفس القاعدة ──────────────────
CREATE OR REPLACE FUNCTION public.recalculate_party_balance_from_ledger(p_party_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_balance NUMERIC(14,4);
  v_company_id uuid;
BEGIN
  SELECT company_id INTO v_company_id FROM public.parties WHERE id = p_party_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'access_denied: الطرف غير موجود أو لا تملك صلاحية الوصول إليه'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.verify_company_access(v_company_id);

  -- نفس قاعدة الميزان: رصيد الوكيل = مجموع (مدين − دائن) على كل سطوره،
  -- بلا فلترة حساب وبلا عكس إشارة (موجب = مدين، سالب = دائن).
  SELECT COALESCE(SUM(jel.debit_amount) - SUM(jel.credit_amount), 0) INTO v_balance
  FROM public.journal_entry_lines jel
  JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE jel.party_id = p_party_id
    AND jel.deleted_at IS NULL
    AND je.status = 'posted'
    AND je.deleted_at IS NULL;

  RETURN COALESCE(v_balance, 0);
END;
$function$;

COMMIT;
