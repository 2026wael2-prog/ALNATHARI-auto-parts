-- ============================================================
-- harden: process_sales_return item fallbacks (description, cost)
-- ============================================================
-- The invoice_items insert read name and cost_price straight from the client
-- payload with no fallback:
--
--     COALESCE((item->>'name'), '')                 -> empty description
--     COALESCE((item->>'cost_price')::NUMERIC, 0)   -> cost 0
--
-- A client that sends only product_id/quantity/unit_price (salesApi.commitReturnRPC
-- did exactly that) therefore produced return lines with a blank description and
-- cost_price 0. Because fn_auto_post_invoice_journal derives the COGS reversal from
-- invoice_items.cost_price, the posted journal reversed revenue but not cost of
-- goods sold — a silently unbalanced-in-substance accounting entry.
--
-- The client is being fixed too, but the fallback belongs here so that ANY client
-- cannot corrupt the ledger. Two further guards are added: empty strings are
-- treated as absent before casting (''::numeric raises 22P02), and a cost of
-- exactly 0 is treated as "unknown" so the catalog cost is used instead.
--
-- The function is otherwise reproduced verbatim from the live definition.

CREATE OR REPLACE FUNCTION public.process_sales_return(p_invoice_id uuid, p_party_id uuid DEFAULT NULL::uuid, p_payment_method text DEFAULT 'cash'::text, p_items jsonb DEFAULT '[]'::jsonb, p_return_reason text DEFAULT ''::text, p_status text DEFAULT 'posted'::text, p_notes text DEFAULT ''::text, p_issue_date date DEFAULT CURRENT_DATE, p_currency_code text DEFAULT 'SAR'::text, p_exchange_rate numeric DEFAULT 1, p_company_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_return_invoice_id UUID;
  v_invoice_number    TEXT;
  v_branch_id         UUID;
  v_orig_currency     TEXT;
  v_orig_rate         NUMERIC;
  v_effective_currency TEXT;
  v_effective_rate     NUMERIC;
  v_total_amount      NUMERIC := 0;
  v_subtotal          NUMERIC := 0;
  v_cost_total        NUMERIC := 0;
  v_warehouse_id      UUID;
  v_item              RECORD;
  v_catalog_sale      NUMERIC;
  v_catalog_cost      NUMERIC;
  v_price_ratio       NUMERIC;
  v_effective_company UUID;
  v_effective_user    UUID;
BEGIN
  v_effective_user := COALESCE(auth.uid(), p_user_id);
  v_effective_company := p_company_id;

  IF v_effective_company IS NULL AND p_invoice_id IS NOT NULL THEN
    SELECT company_id INTO v_effective_company FROM public.invoices WHERE id = p_invoice_id;
  END IF;

  IF v_effective_company IS NULL THEN
    RAISE EXCEPTION 'معرف المنشأة (company_id) مفقود';
  END IF;

  PERFORM public.fn_assert_company_access(v_effective_company);

  IF NOT EXISTS (
    SELECT 1 FROM public.fiscal_years
    WHERE company_id = v_effective_company
      AND p_issue_date BETWEEN start_date AND end_date
      AND is_closed = false
  ) THEN
    RAISE EXCEPTION 'التاريخ يقع خارج سنة مالية مفتوحة';
  END IF;

  -- 1. التحقق والوراثة من الفاتورة الأصلية (إن وجدت)
  IF p_invoice_id IS NOT NULL THEN
    SELECT branch_id, currency_code, exchange_rate, party_id
    INTO v_branch_id, v_orig_currency, v_orig_rate, p_party_id
    FROM public.invoices 
    WHERE id = p_invoice_id AND company_id = v_effective_company;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'الفاتورة الأصلية المرجعية غير موجودة أو لا تنتمي لهذه المنشأة';
    END IF;

    v_effective_currency := COALESCE(v_orig_currency, p_currency_code, 'SAR');
    v_effective_rate := COALESCE(v_orig_rate, p_exchange_rate, 1);
  ELSE
    v_effective_currency := COALESCE(p_currency_code, 'SAR');
    v_effective_rate := COALESCE(p_exchange_rate, 1);
  END IF;

  -- 2. التحقق من سلامة العملة وسعر الصرف للمرتجع
  IF v_effective_currency = 'SAR' AND v_effective_rate != 1 THEN
    v_effective_rate := 1;
  ELSIF v_effective_currency = 'YER' AND (v_effective_rate IS NULL OR v_effective_rate <= 1) THEN
    RAISE EXCEPTION 'سعر صرف الريال اليمني للمرتجع غير صالح (يجب أن يكون أكبر من 1)';
  END IF;

  -- 3. توليد رقم المرتجع التسلسلي
  v_invoice_number := public.generate_invoice_number(v_effective_company, 'sale_return', v_branch_id);

  -- 4. فحص بنود المرتجع ومنع التناقضات السعرية أو الحسابية
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items)
      AS x(product_id uuid, quantity numeric, unit_price numeric, cost_price numeric)
  LOOP
    IF COALESCE(v_item.quantity, 0) <= 0 THEN
      RAISE EXCEPTION 'كمية الإرجاع يجب أن تكون أكبر من صفر';
    END IF;

    IF COALESCE(v_item.unit_price, 0) < 0 THEN
      RAISE EXCEPTION 'سعر بند الإرجاع لا يمكن أن يكون سالباً';
    END IF;

    IF v_item.product_id IS NOT NULL THEN
      SELECT sale_price, cost_price INTO v_catalog_sale, v_catalog_cost
      FROM public.products
      WHERE id = v_item.product_id AND company_id = v_effective_company;

      IF FOUND AND v_catalog_sale > 0 THEN
        v_price_ratio := v_item.unit_price / v_catalog_sale;
        IF v_effective_currency = 'SAR' AND v_price_ratio > 40 THEN
          RAISE EXCEPTION 'السعر المدخل (%) مرتفع جداً مقارنة بكتالوج الصنف (%). تأكد من اختيار العملة المناسبة (YER vs SAR).',
            v_item.unit_price, v_catalog_sale;
        END IF;
        IF v_effective_currency = 'YER' AND v_item.unit_price < (v_catalog_sale * 2) THEN
          RAISE EXCEPTION 'السعر المدخل بالريال اليمني (%) منخفض جداً مقارنة بسعر الصنف الأساسي (%). تأكد من إدخال السعر بالريال اليمني.',
            v_item.unit_price, v_catalog_sale;
        END IF;
      END IF;
    END IF;

    v_subtotal := v_subtotal + (v_item.quantity * v_item.unit_price);
    v_cost_total := v_cost_total + (v_item.quantity * COALESCE(v_item.cost_price, v_catalog_cost, 0));
  END LOOP;

  v_total_amount := v_subtotal;

  INSERT INTO public.invoices (
    company_id, invoice_number, type, status, party_id,
    issue_date, due_date, total_amount, subtotal,
    tax_amount, discount_amount, notes, payment_method,
    currency_code, exchange_rate, reference_invoice_id,
    return_reason, branch_id, created_by
  ) VALUES (
    v_effective_company, v_invoice_number, 'sale_return', 'draft', p_party_id,
    p_issue_date, p_issue_date, v_total_amount, v_subtotal,
    0, 0, p_notes, p_payment_method,
    v_effective_currency, v_effective_rate, p_invoice_id,
    p_return_reason, v_branch_id, v_effective_user
  ) RETURNING id INTO v_return_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, product_id, description, quantity,
    unit_price, total, cost_price, tax_amount, company_id
  )
  SELECT
    v_return_invoice_id,
    CASE 
      WHEN (item->>'product_id') IS NOT NULL AND (item->>'product_id') ~ '^[0-9a-fA-F-]{36}$'
      THEN (item->>'product_id')::UUID 
      ELSE NULL 
    END,
    -- الوصف: نص البند إن وُجد، وإلا اسم الصنف من الكتالوج.
    COALESCE(NULLIF(BTRIM(COALESCE(item->>'name', '')), ''), p.name_ar, ''),
    COALESCE(NULLIF(item->>'quantity', '')::NUMERIC, 0),
    COALESCE(NULLIF(item->>'unit_price', '')::NUMERIC, 0),
    COALESCE(NULLIF(item->>'quantity', '')::NUMERIC, 0) * COALESCE(NULLIF(item->>'unit_price', '')::NUMERIC, 0),
    -- التكلفة: قيمة البند إن كانت أكبر من صفر، وإلا تكلفة الكتالوج، وإلا صفر.
    -- عميل لا يرسل cost_price كان يُصفّر عكس تكلفة البضاعة في القيد المحاسبي.
    COALESCE(NULLIF(NULLIF(item->>'cost_price', '')::NUMERIC, 0), p.cost_price, 0),
    0,
    v_effective_company
  FROM jsonb_array_elements(p_items) AS item
  LEFT JOIN public.products p
    ON p.company_id = v_effective_company
   AND p.id = CASE
                WHEN (item->>'product_id') IS NOT NULL AND (item->>'product_id') ~ '^[0-9a-fA-F-]{36}$'
                THEN (item->>'product_id')::UUID
              END;

  IF p_status = 'posted' THEN
    SELECT id INTO v_warehouse_id
    FROM public.warehouses
    WHERE company_id = v_effective_company AND (v_branch_id IS NULL OR branch_id = v_branch_id)
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1;

    FOR v_item IN
      SELECT * FROM jsonb_to_recordset(p_items)
        AS x(product_id uuid, quantity numeric, unit_price numeric, cost_price numeric)
    LOOP
      IF v_item.product_id IS NOT NULL AND v_warehouse_id IS NOT NULL THEN
        -- إدخال حركة واحدة فقط: trg_update_product_stock هو من يحدّث product_stock
        -- اعتماداً على transaction_type = 'sales_return' (أي +ABS(quantity)).
        INSERT INTO public.inventory_transactions (
          company_id, product_id, warehouse_id, quantity,
          transaction_type, reference_type, reference_id, created_by,
          unit_cost, total_cost
        ) VALUES (
          v_effective_company, v_item.product_id, v_warehouse_id, ABS(v_item.quantity),
          'sales_return', 'invoice', v_return_invoice_id, v_effective_user,
          COALESCE(v_item.cost_price, 0),
          ROUND(ABS(v_item.quantity) * COALESCE(v_item.cost_price, 0), 4)
        );
      END IF;
    END LOOP;

    -- الترحيل يُطلق fn_auto_post_invoice_journal عبر تغيير الحالة
    UPDATE public.invoices
    SET status = 'posted'
    WHERE id = v_return_invoice_id;

    -- حارس: مرتجع مُرحَّل بلا قيد محاسبي كان يمر بصمت قبل هذا الإصلاح
    IF NOT EXISTS (
      SELECT 1 FROM public.journal_entries
      WHERE reference_id = v_return_invoice_id
        AND reference_type = 'sales_return'
        AND deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'فشل الترحيل المحاسبي التلقائي لمرتجع المبيعات % - لم يُنشأ أي قيد',
        v_invoice_number;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_return_invoice_id,
    'return_invoice_id', v_return_invoice_id,
    'invoice_number', v_invoice_number,
    'total_amount', v_total_amount,
    'currency_code', v_effective_currency,
    'exchange_rate', v_effective_rate,
    'branch_id', v_branch_id
  );
END;
$function$;

-- CREATE OR REPLACE keeps the existing ACL; restate it so a rebuilt database matches.
REVOKE ALL ON FUNCTION public.process_sales_return(uuid, uuid, text, jsonb, text, text, text, date, text, numeric, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_sales_return(uuid, uuid, text, jsonb, text, text, text, date, text, numeric, uuid, uuid) TO authenticated, service_role;
