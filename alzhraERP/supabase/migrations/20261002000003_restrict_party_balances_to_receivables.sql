-- 2026-10-02: قصر أرصدة الأطراف على حسابات الذمم الفعلية
--
-- المشكلة: كانت party_balances و party_balances_by_currency تجمعان كل سطر دفتر موسوم بطرف
--          بغضّ النظر عن الحساب ⇒ فأرصدة الصناديق والمخزون ورأس المال ظهرت كديون عملاء:
--            132  صندوق ريال يمني      +3,410,409.62
--            5101 بضاعة أول المدة       +1,309,125.25
--            135  صندوق سعودي            −638,231.76
--            2112 رأس مال شريك           +265,432.17
--          ⇒ تشويه ~4,080,290 ر.س في أرقام الديون.
--
-- الحل: قصر المجموع على شجرة الذمم فقط:
--          121 = الزبائن (ذمم مدينة)     ·     231 = الموردون (ذمم دائنة)
--
-- المرجع المحاسبي بعد الإصلاح: صافي ذمم الزبائن = 1,574,741.60 ر.س
--                              مجموع الأرصدة المدينة = 1,859,166.16 ر.س
--                              (بما يقابل سندات قبض بقيمة 7,371,080.66 ر.س غير مُخصَّصة على الفواتير)

CREATE OR REPLACE VIEW public.party_balances AS
WITH party_accts AS (
  SELECT a.id
    FROM public.accounts a
   WHERE a.deleted_at IS NULL
     AND (left(a.code, 3) = '121' OR left(a.code, 3) = '231')
), journal_bals AS (
  SELECT jel.party_id,
         jel.company_id,
         sum(jel.debit_amount - jel.credit_amount)::numeric(14,2) AS journal_balance
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
   WHERE jel.deleted_at IS NULL
     AND jel.party_id IS NOT NULL
     AND je.status = 'posted'
     AND je.deleted_at IS NULL
     AND jel.account_id IN (SELECT id FROM party_accts)
   GROUP BY jel.party_id, jel.company_id
), latest_rates AS (
  SELECT DISTINCT ON (er.company_id, er.currency_code)
         er.company_id, er.currency_code, er.rate_to_base
    FROM public.exchange_rates er
   ORDER BY er.company_id, er.currency_code, er.effective_date DESC, er.created_at DESC
), opening_bals AS (
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
    LEFT JOIN latest_rates lr ON lr.company_id = ob.company_id AND lr.currency_code = ob.currency_code
    LEFT JOIN public.supported_currencies sc ON sc.code = ob.currency_code
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

CREATE OR REPLACE VIEW public.party_balances_by_currency AS
WITH party_accts AS (
  SELECT a.id
    FROM public.accounts a
   WHERE a.deleted_at IS NULL
     AND (left(a.code, 3) = '121' OR left(a.code, 3) = '231')
), combined AS (
  SELECT jel.party_id,
         jel.company_id,
         jel.currency_code,
         sum(
           CASE
             WHEN jel.currency_code IS NOT NULL AND upper(TRIM(BOTH FROM jel.currency_code)) <> 'SAR'
               THEN COALESCE(NULLIF(jel.foreign_amount, 0), abs(jel.debit_amount - jel.credit_amount))
                    * CASE WHEN jel.debit_amount >= jel.credit_amount THEN 1 ELSE '-1'::integer END::numeric
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
     AND jel.account_id IN (SELECT id FROM party_accts)
   GROUP BY jel.party_id, jel.company_id, jel.currency_code
  UNION ALL
  SELECT ob.party_id,
         ob.company_id,
         ob.currency_code::text,
         sum(CASE WHEN ob.direction = 'debit' THEN ob.amount ELSE -ob.amount END)::numeric(14,2),
         0,
         NULL::date
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

-- الحفاظ على الوضع الأمني (منع القراءة العامة بمفتاح anon)
ALTER VIEW public.party_balances SET (security_invoker = true);
ALTER VIEW public.party_balances_by_currency SET (security_invoker = true);
REVOKE ALL ON public.party_balances FROM anon, PUBLIC;
REVOKE ALL ON public.party_balances_by_currency FROM anon, PUBLIC;
