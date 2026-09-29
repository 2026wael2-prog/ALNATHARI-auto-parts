-- ============================================
-- تحصين دوال RPC التي تأخذ معرّفاً بلا company_id (عزل المنشأة)
-- ============================================
-- المشكلة المكتشفة بالتدقيق: هذه الدوال SECURITY DEFINER وتملك `authenticated`
-- صلاحية EXECUTE عليها، لكنها لا تتحقق من انتماء المستخدم إلى منشأة الكائن
-- المطلوب. ولأن SECURITY DEFINER يتجاوز RLS بالكامل، فإن أي مستخدم مصادَق
-- (من أي منشأة، وبأي دور) يستطيع استدعاءها عبر PostgREST بمعرّف عشوائي.
--
-- الأخطر: save_product_uoms تحذف وتعيد كتابة وحدات القياس لأي منتج في أي منشأة،
-- وسياسات RLS على product_uoms تفرض صراحةً العضوية + دور admin/manager — أي أن
-- الدالة كانت تتجاوز القاعدة المُعلنة صراحةً في الجدول. المسار البديل في الواجهة
-- (الكتابة المباشرة) يمرّ عبر RLS ويفرضهما فعلاً، فكان المساران متناقضين أمنياً.
--
-- الإصلاح: نفس القاعدة المُعلنة في RLS تُفرض داخل الدالة، بمصدر واحد
-- (verify_company_access) بدل منطق مكرر.

BEGIN;

-- (1) save_product_uoms — عزل المنشأة + اشتراط دور إداري (مطابقة سياسات product_uoms).
CREATE OR REPLACE FUNCTION public.save_product_uoms(p_product_id uuid, p_uoms jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uom jsonb;
  v_company_id uuid;
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.products p
  WHERE p.id = p_product_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'access_denied: المنتج غير موجود أو لا تملك صلاحية الوصول إليه'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.verify_company_access(v_company_id);

  IF NOT public.user_is_admin_or_manager(v_company_id) THEN
    RAISE EXCEPTION 'access_denied: لا تملك صلاحية تعديل وحدات القياس'
      USING ERRCODE = '42501';
  END IF;

  -- أ) حذف جميع وحدات القياس الحالية للمنتج
  DELETE FROM public.product_uoms WHERE product_id = p_product_id;

  -- ب) إدخال الوحدات الجديدة إذا تم تمريرها
  IF p_uoms IS NOT NULL AND jsonb_array_length(p_uoms) > 0 THEN
    FOR v_uom IN SELECT * FROM jsonb_array_elements(p_uoms) LOOP
      INSERT INTO public.product_uoms (product_id, uom_name, conversion_factor)
      VALUES (
        p_product_id,
        (v_uom->>'uom_name')::text,
        (v_uom->>'conversion_factor')::numeric
      );
    END LOOP;
  END IF;
END;
$function$;

-- (2) sync_product_search_numbers — عزل المنشأة (كانت تكتب فهرس بحث أي منشأة).
CREATE OR REPLACE FUNCTION public.sync_product_search_numbers(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_prod RECORD;
  v_alt_num TEXT;
BEGIN
  -- Get product
  SELECT * INTO v_prod FROM public.products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'access_denied: المنتج غير موجود أو لا تملك صلاحية الوصول إليه'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.verify_company_access(v_prod.company_id);

  DELETE FROM public.product_search_numbers WHERE product_id = p_product_id;

  -- Insert PRIMARY part_number
  IF v_prod.part_number IS NOT NULL AND TRIM(v_prod.part_number) <> '' THEN
    INSERT INTO public.product_search_numbers (company_id, product_id, original_number, normalized_number, number_type)
    VALUES (v_prod.company_id, v_prod.id, TRIM(v_prod.part_number), public.normalize_oem_v1(v_prod.part_number), 'PRIMARY')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Insert SKU
  IF v_prod.sku IS NOT NULL AND TRIM(v_prod.sku) <> '' THEN
    INSERT INTO public.product_search_numbers (company_id, product_id, original_number, normalized_number, number_type)
    VALUES (v_prod.company_id, v_prod.id, TRIM(v_prod.sku), public.normalize_oem_v1(v_prod.sku), 'SKU')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Insert BARCODE
  IF v_prod.barcode IS NOT NULL AND TRIM(v_prod.barcode) <> '' THEN
    INSERT INTO public.product_search_numbers (company_id, product_id, original_number, normalized_number, number_type)
    VALUES (v_prod.company_id, v_prod.id, TRIM(v_prod.barcode), public.normalize_oem_v1(v_prod.barcode), 'BARCODE')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Insert ALTERNATIVE_NUMBERS (comma separated)
  IF v_prod.alternative_numbers IS NOT NULL AND TRIM(v_prod.alternative_numbers) <> '' THEN
    FOR v_alt_num IN SELECT unnest(string_to_array(v_prod.alternative_numbers, ',')) LOOP
      v_alt_num := TRIM(v_alt_num);
      IF v_alt_num <> '' THEN
        INSERT INTO public.product_search_numbers (company_id, product_id, original_number, normalized_number, number_type)
        VALUES (v_prod.company_id, v_prod.id, v_alt_num, public.normalize_oem_v1(v_alt_num), 'ALTERNATIVE')
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  -- Insert CROSS_REF from product_cross_references (where this product is the alternative)
  INSERT INTO public.product_search_numbers (company_id, product_id, original_number, normalized_number, number_type)
  SELECT pcr.company_id, pcr.base_product_id, alt.part_number, public.normalize_oem_v1(alt.part_number), 'CROSS_REF'
  FROM public.product_cross_references pcr
  JOIN public.products alt ON alt.id = pcr.alternative_product_id
  WHERE pcr.base_product_id = p_product_id
    AND alt.part_number IS NOT NULL
    AND TRIM(alt.part_number) <> ''
  ON CONFLICT DO NOTHING;
END;
$function$;

-- (3) recalculate_party_balance_from_ledger — عزل المنشأة (كانت تقرأ دفتر أي طرف).
--     recalculate_party_balance تفوّض إليها، فتغطيها بنفس الحارس.
CREATE OR REPLACE FUNCTION public.recalculate_party_balance_from_ledger(p_party_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_balance NUMERIC(14,4);
  v_party_type TEXT;
  v_company_id uuid;
BEGIN
  SELECT type, company_id INTO v_party_type, v_company_id
  FROM public.parties
  WHERE id = p_party_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'access_denied: الطرف غير موجود أو لا تملك صلاحية الوصول إليه'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.verify_company_access(v_company_id);

  IF v_party_type = 'customer' THEN
    SELECT COALESCE(SUM(jel.debit_amount) - SUM(jel.credit_amount), 0) INTO v_balance
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN public.accounts a ON a.id = jel.account_id
    WHERE jel.party_id = p_party_id
      AND jel.deleted_at IS NULL
      AND je.status = 'posted'
      AND je.deleted_at IS NULL
      AND a.code = '1100';
  ELSIF v_party_type = 'supplier' THEN
    SELECT COALESCE(SUM(jel.credit_amount) - SUM(jel.debit_amount), 0) INTO v_balance
    FROM public.journal_entry_lines jel
    JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    JOIN public.accounts a ON a.id = jel.account_id
    WHERE jel.party_id = p_party_id
      AND jel.deleted_at IS NULL
      AND je.status = 'posted'
      AND je.deleted_at IS NULL
      AND a.code = '2100';
  ELSE
    v_balance := 0;
  END IF;

  RETURN COALESCE(v_balance, 0);
END;
$function$;

-- (4) validate_journal_entry_balance — عزل المنشأة (كانت تقرأ قيد أي منشأة).
CREATE OR REPLACE FUNCTION public.validate_journal_entry_balance(p_journal_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_debit numeric;
  v_credit numeric;
  v_company_id uuid;
BEGIN
  SELECT je.company_id INTO v_company_id
  FROM public.journal_entries je
  WHERE je.id = p_journal_entry_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'access_denied: القيد غير موجود أو لا تملك صلاحية الوصول إليه'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.verify_company_access(v_company_id);

  SELECT COALESCE(SUM(debit_amount), 0), COALESCE(SUM(credit_amount), 0)
  INTO v_debit, v_credit
  FROM public.journal_entry_lines
  WHERE journal_entry_id = p_journal_entry_id;

  IF v_debit != v_credit THEN
    RAISE EXCEPTION 'Journal entry lines are not balanced. Debit: %, Credit: %', v_debit, v_credit;
  END IF;

  RETURN TRUE;
END;
$function$;

-- (5) incentive_check_allocation_complete — عزل المنشأة (كانت تقرأ تخصيصات أي فاتورة).
CREATE OR REPLACE FUNCTION public.incentive_check_allocation_complete(p_invoice_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sum numeric;
  v_company_id uuid;
BEGIN
  SELECT i.company_id INTO v_company_id
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  PERFORM public.verify_company_access(v_company_id);

  SELECT COALESCE(SUM(l.allocation_pct), 0) INTO v_sum
  FROM public.incentive_engineer_links l
  WHERE l.invoice_id = p_invoice_id
    AND l.company_id = v_company_id
    AND l.status IN ('assigned', 'approved');

  RETURN v_sum = 100.0;
END;
$function$;

-- (6) تثبيت search_path للدالتين المُبلَّغ عنهما (منع اختطاف مسار البحث).
ALTER FUNCTION public.fn_to_base_amount(text, numeric, numeric)
  SET search_path TO 'public', 'pg_temp';

ALTER FUNCTION public.render_debt_template(text, text, numeric, text, date, integer, text, text)
  SET search_path TO 'public', 'pg_temp';

COMMIT;
