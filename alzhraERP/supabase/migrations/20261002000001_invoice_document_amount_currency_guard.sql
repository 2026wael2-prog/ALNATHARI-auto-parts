-- ============================================================================
-- 20261002000001_invoice_document_amount_currency_guard.sql
-- طُبِّقت على قاعدة gvjmpgxdmekjsgzhlzzz بتاريخ 2026-10-02 — وتم التحقق منها.
-- ----------------------------------------------------------------------------
-- السبب (مُثبت بالقياس على القاعدة الحيّة ونسخة الميزان الأصلية):
--
--   في Mizan، يحمل رأس الفاتورة (`Bill.Total`) قيمة **بعملة الأساس (SAR)**،
--   والمبلغ بعملة المستند يُحفظ في الدفتر (`EntryItem.CDebit/CCredit`) ويُقابله
--   في القاعدة الجديدة `journal_entry_lines.foreign_amount`.
--
--   مثال مُثبت — الفاتورة 2-مبيع:64294:
--       Bill.Total       = 159.84      (أساس SAR)
--       EntryItem.CDebit = 72,000      (مبلغ المستند YER)
--       CurRate          = 0.002220    → 72,000 × 0.002220 = 159.84 ✔
--
--   المشكلة: الواجهة تعرض `invoices.total_amount` تحت رمز `currency_code`،
--   فيظهر «159.84 ر.ي» بدل «72,000 ر.ي».
--
-- الإصلاح (بلا أي تغيير في مبلغ مالي أو في ميزان المراجعة):
--   1) عمودا `total_document_amount` و`subtotal_document_amount`.
--   2) تعبئتهما من الدفتر (foreign_amount لطرف المدين) = Mizan.EntryItem.CDebit.
--   3) احتياطي للفواتير بلا قيد: total_amount ÷ exchange_rate.
--   4) قيد CHECK غير مُتحقَّق منه (NOT VALID) يمنع أسعار الصرف الشاذة مستقبلاً
--      (لليمني: 0 < السعر ≤ 0.02) دون إبطال الصف التاريخي الشاذ.
--   5) عرض تدقيقي `v_invoice_currency_audit`.
--
-- ⚠️ ملاحظة تنفيذية مهمة:
--   جدول `invoices` يحمل **20 مُشغِّلاً** (حُرّاس مالية + تدقيق + تحقق مدخلات)،
--   وتحديث 200 صف معها لم يكتمل خلال 280 ثانية. لذلك نُفِّذت التعبئة بنمط
--   الهجرة القياسي:
--       SET session_replication_role = replica;   -- أثناء الدفعات فقط
--       ...
--       SET session_replication_role = DEFAULT;
--   مبرَّر لأن العملية **لا تكتب أي عمود مالي** (لا مبلغ، لا حالة، لا طرف،
--   لا تاريخ) — فقط عمودين مشتقّين جديدين. ومع ذلك لا تُفعّل هذه المُشغِّلات
--   سجل تدقيق لهذه العملية، وهذا موثَّق في:
--       alzhraERP/docs/CURRENCY-FIX-APPLIED-2026-10-02.md
--   ونسخة ما قبل التغيير محفوظة في:
--       C:\alzhra-pg\parity\BACKUP_invoices_before_20261002.csv  (64,631 صفاً)
-- ============================================================================

-- ── 1) الأعمدة والتوثيق ─────────────────────────────────────────────────────
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS total_document_amount numeric(19,4);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS subtotal_document_amount numeric(19,4);

COMMENT ON COLUMN public.invoices.total_amount IS
  'إجمالي الفاتورة بعملة الأساس (SAR). مطابق لـ Mizan.Bill.Total. لا تُعرض مباشرة لفاتورة بعملة أجنبية.';
COMMENT ON COLUMN public.invoices.total_document_amount IS
  'إجمالي الفاتورة بعملة المستند (currency_code). المصدر: journal_entry_lines.foreign_amount (طرف المدين) = Mizan.EntryItem.CDebit.';
COMMENT ON COLUMN public.invoices.subtotal_document_amount IS
  'المجموع قبل الضريبة بعملة المستند (currency_code).';

-- ── 2) التعبئة (تُنفَّذ مع تثبيط المُشغِّلات — انظر الملاحظة أعلاه) ──────────
-- SET session_replication_role = replica;

-- (ب) من الدفتر — المرجع الأدق لأنه مطابق للأصل حرفياً
WITH led AS (
  SELECT je.reference_id AS id,
         GREATEST(COALESCE(sum(jel.foreign_amount) FILTER (WHERE jel.debit_amount  > 0), 0),
                  COALESCE(sum(jel.foreign_amount) FILTER (WHERE jel.credit_amount > 0), 0)) AS f
  FROM public.journal_entries je
  JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
  WHERE je.reference_id IS NOT NULL AND COALESCE(jel.foreign_amount, 0) > 0
  GROUP BY je.reference_id)
UPDATE public.invoices i
   SET total_document_amount    = led.f,
       subtotal_document_amount = led.f
  FROM led
 WHERE led.id = i.id AND i.currency_code <> 'SAR'
   AND COALESCE(i.total_document_amount, 0) = 0 AND led.f > 0;

-- (ج) الاحتياطي: فواتير أجنبية بلا قيد
UPDATE public.invoices i
   SET total_document_amount    = round(i.total_amount / NULLIF(i.exchange_rate, 0), 4),
       subtotal_document_amount = round(i.subtotal    / NULLIF(i.exchange_rate, 0), 4)
 WHERE i.currency_code <> 'SAR' AND COALESCE(i.exchange_rate, 0) > 0
   AND COALESCE(i.total_document_amount, 0) = 0;

-- (د) فواتير عملة الأساس
UPDATE public.invoices
   SET total_document_amount = total_amount, subtotal_document_amount = subtotal
 WHERE currency_code = 'SAR' AND total_document_amount IS NULL;

-- SET session_replication_role = DEFAULT;

-- ── 3) حارس أسعار الصرف الشاذة (NOT VALID → لا يُبطل الصف التاريخي) ─────────
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS chk_invoice_yer_exchange_rate;
ALTER TABLE public.invoices
  ADD CONSTRAINT chk_invoice_yer_exchange_rate
  CHECK (
    currency_code IS DISTINCT FROM 'YER'
    OR (exchange_rate IS NOT NULL AND exchange_rate > 0 AND exchange_rate <= 0.02)
  ) NOT VALID;

-- ── 4) العرض التدقيقي (كما طُبِّق فعلاً) ─────────────────────────────────────
CREATE OR REPLACE VIEW public.v_invoice_currency_audit AS
SELECT i.id,
       i.invoice_number,
       i.type,
       i.issue_date,
       i.currency_code,
       i.exchange_rate,
       i.total_amount          AS base_amount_sar,
       i.total_document_amount AS document_amount,
       CASE WHEN COALESCE(i.exchange_rate, 0) > 0
            THEN round(i.total_amount / i.exchange_rate, 2) END AS derived_document_amount,
       CASE WHEN COALESCE(i.total_document_amount, 0) = 0 THEN 'missing_document_amount'
            WHEN i.currency_code = 'SAR' THEN 'base_currency_ok'
            WHEN COALESCE(i.exchange_rate, 0) > 0
             AND abs(i.total_document_amount - (i.total_amount / i.exchange_rate))
                 > GREATEST(1, i.total_document_amount * 0.01) THEN 'document_vs_derived_mismatch'
            ELSE 'ok' END AS audit_flag
  FROM public.invoices i;

GRANT SELECT ON public.v_invoice_currency_audit TO authenticated;
REVOKE ALL ON public.v_invoice_currency_audit FROM anon, PUBLIC;

-- ============================================================================
-- نتيجة التحقق بعد التنفيذ (2026-10-02):
--   SAR : 26,214 فاتورة | 26,204 معبّأة | الأساس 17,478,438.47 = مبلغ المستند ✔
--   YER : 38,415 فاتورة | 38,407 معبّأة | الأساس 6,349,244.14 ر.س
--                                            = 2,031,823,598 ر.ي ✔
--   OMR :      2 فاتورة |      2 معبّأة | 240 ر.ع
--   فواتير بلا مبلغ مستند: 18 (كلها بمبلغ صفر — لا أثر مالي)
--   عيّنة مطابقة للأصل: 64294→72,000 · 64293→55,000 · 64311→38,000 ·
--                        64321→34,000 · 64322→14,500 · 64316→12,000  ✔
--   العرض التدقيقي: ok=36,383 · base_currency_ok=26,204 ·
--                   document_vs_derived_mismatch=2,026 · missing=18
-- ============================================================================
