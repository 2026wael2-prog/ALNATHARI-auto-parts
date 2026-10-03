CREATE OR REPLACE FUNCTION public.search_invoices_advanced(p_company_id uuid, p_type text DEFAULT NULL::text, p_query text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_status text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_branch_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 500, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, company_id uuid, invoice_number text, type text, status text, payment_method text, total_amount numeric, currency_code text, exchange_rate numeric, issue_date date, party_id uuid, party_name text, party_phone text, notes text, reference_invoice_id uuid, item_count bigint, matched_items jsonb, total_matching_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_clean_query TEXT;
  v_norm_query TEXT;
  v_tokens TEXT[];
  v_first_token TEXT;
BEGIN
  -- 1. التحقق الصارم من الأمان وعزل المنشأة
  PERFORM verify_company_access(p_company_id);

  -- 2. تنظيف وتجهيز مدخلات البحث وتطبيع العربية
  v_clean_query := NULLIF(TRIM(p_query), '');
  IF v_clean_query IS NOT NULL THEN
    v_norm_query := public.normalize_arabic(v_clean_query);
    -- تقسيم النص إلى كلمات دلالية للبحث الذكي
    v_tokens := regexp_split_to_array(v_norm_query, E'\\s+');
    v_first_token := v_tokens[1];
  END IF;

  -- 3. تنفيذ الاستعلام مع احتساب العدد الإجمالي والتطابق الدقيق
  RETURN QUERY
  WITH filtered_invoices AS (
    SELECT
      i.id,
      i.company_id,
      i.invoice_number,
      i.type,
      i.status,
      i.payment_method,
      i.total_amount,
      i.currency_code,
      i.exchange_rate,
      i.issue_date,
      i.party_id,
      prt.name AS party_name,
      prt.phone AS party_phone,
      i.notes,
      i.reference_invoice_id,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.invoice_items cnt_items
        WHERE cnt_items.invoice_id = i.id
      ) AS item_count,
      COUNT(*) OVER()::BIGINT AS total_matching_count
    FROM public.invoices i
    LEFT JOIN public.parties prt ON prt.id = i.party_id
    WHERE i.company_id = p_company_id
      AND i.deleted_at IS NULL
      AND i.status <> 'void'
      -- فلترة النوع: دعم شمول مرتجع المشتريات تلقائياً عند طلب المشتريات
      AND (
        p_type IS NULL
        OR (p_type = 'purchase' AND i.type IN ('purchase', 'purchase_return'))
        OR i.type = ANY(string_to_array(p_type, ','))
      )
      -- فلترة الحالة
      AND (p_status IS NULL OR i.status = p_status)
      -- فلترة طريقة الدفع
      AND (p_payment_method IS NULL OR i.payment_method = p_payment_method)
      -- فلترة الفرع
      AND (p_branch_id IS NULL OR i.branch_id = p_branch_id)
      -- فلترة التاريخ
      AND (p_date_from IS NULL OR i.issue_date >= p_date_from)
      AND (p_date_to IS NULL OR i.issue_date <= p_date_to)
      -- شرط البحث الذكي متعدد الأبعاد مع تطبيع العربية
      AND (
        v_norm_query IS NULL
        -- مطابقة رقم الفاتورة أو بيانات العميل/المورد
        OR public.normalize_arabic(i.invoice_number) LIKE '%' || v_norm_query || '%'
        OR (v_clean_query IS NOT NULL AND i.invoice_number ILIKE '%' || v_clean_query || '%')
        OR public.normalize_arabic(prt.name) LIKE '%' || v_norm_query || '%'
        OR (prt.phone IS NOT NULL AND prt.phone LIKE '%' || v_clean_query || '%')
        -- مطابقة الأصناف عبر الكلمات المفتاحية والأرقام البديلة
        OR EXISTS (
          SELECT 1
          FROM public.invoice_items ii
          LEFT JOIN public.products p ON p.id = ii.product_id
          WHERE ii.invoice_id = i.id
            AND (
              -- فحص مطابقة العبارة الكاملة أو الرموز
              public.normalize_arabic(ii.description) LIKE '%' || v_norm_query || '%'
              OR (p.name_ar IS NOT NULL AND public.normalize_arabic(p.name_ar) LIKE '%' || v_norm_query || '%')
              OR (p.sku IS NOT NULL AND public.normalize_arabic(p.sku) LIKE '%' || v_norm_query || '%')
              OR (p.part_number IS NOT NULL AND public.normalize_arabic(p.part_number) LIKE '%' || v_norm_query || '%')
              OR (p.brand IS NOT NULL AND public.normalize_arabic(p.brand) LIKE '%' || v_norm_query || '%')
              OR (p.barcode IS NOT NULL AND public.normalize_arabic(p.barcode) LIKE '%' || v_norm_query || '%')
              OR (p.alternative_numbers IS NOT NULL AND public.normalize_arabic(p.alternative_numbers) LIKE '%' || v_norm_query || '%')
              OR (p.description IS NOT NULL AND public.normalize_arabic(p.description) LIKE '%' || v_norm_query || '%')
              -- في حال تعدد الكلمات، نفحص أول كلمة دلالية ومطابقتها أيضاً
              OR (
                array_length(v_tokens, 1) > 1 AND (
                  public.normalize_arabic(ii.description) LIKE '%' || v_first_token || '%'
                  OR (p.name_ar IS NOT NULL AND public.normalize_arabic(p.name_ar) LIKE '%' || v_first_token || '%')
                  OR (p.part_number IS NOT NULL AND public.normalize_arabic(p.part_number) LIKE '%' || v_first_token || '%')
                )
              )
            )
        )
      )
    ORDER BY i.issue_date DESC, i.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 5000)
    OFFSET GREATEST(p_offset, 0)
  )
  SELECT
    fi.id,
    fi.company_id,
    fi.invoice_number,
    fi.type,
    fi.status,
    fi.payment_method,
    fi.total_amount,
    fi.currency_code,
    fi.exchange_rate,
    fi.issue_date,
    fi.party_id,
    fi.party_name,
    fi.party_phone,
    fi.notes,
    fi.reference_invoice_id,
    fi.item_count,
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', mii.id,
            'product_id', mii.product_id,
            'product_name', COALESCE(mp.name_ar, mii.description, 'صنف غير محدد'),
            'sku', mp.sku,
            'part_number', mp.part_number,
            'brand', mp.brand,
            'quantity', mii.quantity,
            'unit_price', mii.unit_price,
            'total', mii.total,
            'is_direct_match', (
              v_norm_query IS NOT NULL AND (
                public.normalize_arabic(mii.description) LIKE '%' || v_norm_query || '%'
                OR (mp.name_ar IS NOT NULL AND public.normalize_arabic(mp.name_ar) LIKE '%' || v_norm_query || '%')
                OR (mp.sku IS NOT NULL AND public.normalize_arabic(mp.sku) LIKE '%' || v_norm_query || '%')
                OR (mp.part_number IS NOT NULL AND public.normalize_arabic(mp.part_number) LIKE '%' || v_norm_query || '%')
                OR (mp.brand IS NOT NULL AND public.normalize_arabic(mp.brand) LIKE '%' || v_norm_query || '%')
                OR (mp.barcode IS NOT NULL AND public.normalize_arabic(mp.barcode) LIKE '%' || v_norm_query || '%')
                OR (mp.alternative_numbers IS NOT NULL AND public.normalize_arabic(mp.alternative_numbers) LIKE '%' || v_norm_query || '%')
                OR (
                  array_length(v_tokens, 1) > 1 AND (
                    public.normalize_arabic(mii.description) LIKE '%' || v_first_token || '%'
                    OR (mp.name_ar IS NOT NULL AND public.normalize_arabic(mp.name_ar) LIKE '%' || v_first_token || '%')
                    OR (mp.part_number IS NOT NULL AND public.normalize_arabic(mp.part_number) LIKE '%' || v_first_token || '%')
                  )
                )
              )
            )
          )
        )
        FROM (
          SELECT ii.*
          FROM public.invoice_items ii
          WHERE ii.invoice_id = fi.id
          LIMIT 5
        ) mii
        LEFT JOIN public.products mp ON mp.id = mii.product_id
      ),
      '[]'::jsonb
    ) AS matched_items,
    fi.total_matching_count
  FROM filtered_invoices fi;
END;
$function$
