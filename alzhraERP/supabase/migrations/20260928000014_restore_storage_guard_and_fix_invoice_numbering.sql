-- ============================================
-- (1) إعادة ضابط أمني مفقود  (2) إصلاح مولّد رقم الفاتورة  (3) تطبيع قيم
-- ============================================
-- (1) trg_storage_guard_mime: الهجرة 20260826000000 تُنشئه، والدالة
--     storage_guard_dangerous_mime موجودة فعلاً، لكن الـ trigger **غائب** من
--     القاعدة الحيّة (pg_trigger = 0). فلا حاجز على رفع SVG/HTML/الملفات
--     التنفيذية ولا سقف 25MB على مستوى storage.objects. أُعيد إنشاؤه كما هو.

-- (2) generate_invoice_number: كان يحسب الرقم بـ COUNT(*)+1 مع استبعاد
--     المحذوف ناعماً، بينما الفهرس uq_invoice_number_company فريد **غير جزئي**
--     على (company_id, invoice_number) — أي أن الفاتورة المحذوفة ناعماً تظل
--     محتجزةً لرقمها. النتيجة: حذف ناعم ثم إنشاء فاتورة أخرى ⇒ نفس الرقم ⇒
--     خطأ 23505. يوجد حالياً 7 فواتير محذوفة ناعماً. خمسة مسارات أساسية تعتمد
--     على هذه الدالة (commit_sales_invoice_v2, commit_purchase_invoice,
--     process_sales_return, convert_quotation_to_invoice, fn_process_cross_branch_sale).
--     الإصلاح: الاشتقاق من MAX للاحقة الرقمية على **كل** الصفوف (بما فيها
--     المحذوفة) فلا يُعاد استخدام رقم قائم أبداً.

-- (3) vehicles.fuel_type: القيمة نفسها مخزَّنة بحالتين مختلفتين.

BEGIN;

-- ── (1) استعادة الضابط الأمني ────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_storage_guard_mime ON storage.objects;
CREATE TRIGGER trg_storage_guard_mime
  BEFORE INSERT ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION public.storage_guard_dangerous_mime();

-- ── (2) مولّد رقم الفاتورة ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.generate_invoice_number(
  p_company_id uuid,
  p_type text,
  p_branch_id uuid DEFAULT NULL::uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_count bigint;
  v_branch_code text := '';
  v_lock_key text;
BEGIN
  PERFORM public.fn_assert_company_access(p_company_id);

  v_prefix := CASE p_type
    WHEN 'sale' THEN 'INV'
    WHEN 'purchase' THEN 'PUR'
    WHEN 'sale_return' THEN 'RET'
    WHEN 'purchase_return' THEN 'RPR'
    ELSE 'DOC'
  END;

  IF p_branch_id IS NOT NULL THEN
    SELECT code INTO v_branch_code
    FROM branches
    WHERE id = p_branch_id AND company_id = p_company_id;

    IF v_branch_code IS NULL OR v_branch_code = '' THEN
      SELECT CASE WHEN is_main THEN 'WN' ELSE 'B' || UPPER(SUBSTRING(id::text, 1, 4)) END
      INTO v_branch_code
      FROM branches
      WHERE id = p_branch_id;
    END IF;

    IF v_branch_code IS NOT NULL AND v_branch_code <> '' THEN
      v_prefix := v_prefix || '-' || v_branch_code;
    END IF;

    v_lock_key := p_company_id::text || p_type || p_branch_id::text;
  ELSE
    v_lock_key := p_company_id::text || p_type;
  END IF;

  -- Advisory lock to prevent invoice number race conditions
  PERFORM pg_advisory_xact_lock(hashtext(v_lock_key));

  -- الاشتقاق من MAX للاحقة الرقمية على كل الصفوف (بلا استبعاد المحذوف ناعماً)
  -- حتى لا يُعاد رقم ما زال محتجزاً في الفهرس الفريد غير الجزئي.
  IF p_branch_id IS NOT NULL THEN
    SELECT COALESCE(MAX(
             CASE WHEN invoice_number ~ '\d+$'
                  THEN (regexp_match(invoice_number, '\d+$'))[1]::bigint END
           ), 0) + 1
    INTO v_count
    FROM invoices
    WHERE company_id = p_company_id
      AND branch_id = p_branch_id
      AND type = p_type;
  ELSE
    SELECT COALESCE(MAX(
             CASE WHEN invoice_number ~ '\d+$'
                  THEN (regexp_match(invoice_number, '\d+$'))[1]::bigint END
           ), 0) + 1
    INTO v_count
    FROM invoices
    WHERE company_id = p_company_id
      AND branch_id IS NULL
      AND type = p_type;
  END IF;

  RETURN v_prefix || '-' || TO_CHAR(CURRENT_DATE, 'YYYYMMDD') || '-' || LPAD(v_count::text, 4, '0');
END;
$function$;

-- ── (3) تطبيع fuels ──────────────────────────────────────────────────────────
UPDATE vehicles
SET fuel_type = 'gasoline'
WHERE fuel_type IS NOT NULL
  AND lower(btrim(fuel_type)) = 'gasoline'
  AND fuel_type <> 'gasoline';

COMMIT;
