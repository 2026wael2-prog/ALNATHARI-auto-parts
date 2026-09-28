-- ============================================================
-- guard the stock recalculation against an incomplete ledger
-- ============================================================
-- admin_recalculate_all_stock() rebuilds product_stock from inventory_transactions.
-- That ledger is missing its opening baseline for most items: it holds 249
-- opening_balance rows while product_stock has 1277 rows, and 246 stock rows (1057
-- units) have no ledger rows at all. Measured on the live database:
--
--   * 356 rows where product_stock > ledger net, by 1277 units
--   *   9 rows where ledger net > product_stock, by 377 units
--   * valuation from product_stock 61,046.18 vs from the ledger 52,541.61 (SAR)
--
-- So running this function as-is would have written off ~1277 units of real stock
-- and invented 377 more, silently. All reporting and valuation functions read
-- product_stock (never the ledger), which is why daily operation is unaffected —
-- but the recalculation is a live landmine: it is granted to authenticated and the
-- application never calls it.
--
-- It now measures the impact and refuses to write unless p_force := true is passed
-- explicitly, reporting the affected rows, units and value either way. The tenant +
-- owner check is unchanged. The old single-argument version is dropped first so no
-- overload is left behind, and callers passing only p_company_id still resolve via
-- the new default.

DROP FUNCTION IF EXISTS public.admin_recalculate_all_stock(uuid);

CREATE OR REPLACE FUNCTION public.admin_recalculate_all_stock(p_company_id uuid, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_changed int := 0;
  v_units   numeric := 0;
  v_value   numeric := 0;
  v_current numeric;
  v_cost    numeric;
  v_row     RECORD;
  v_qty     numeric;
BEGIN
  -- فقط للمالك
  IF NOT EXISTS (
    SELECT 1 FROM user_company_roles ucr
    WHERE ucr.user_id = auth.uid() AND ucr.company_id = p_company_id
      AND ucr.role = 'owner'
  ) THEN
    RAISE EXCEPTION 'access_denied: يتطلب صلاحية مالك';
  END IF;

  -- حارس: دفتر الحركات لا يحتوي أرصدة افتتاحية لمعظم الأصناف (249 قيد افتتاحي
  -- مقابل 1277 صف مخزون)، فإعادة الحساب منه تُشطب مخزوناً فعلياً. لذلك تُمنع
  -- الكتابة ما لم يُمرَّر p_force := true صراحةً، ويُعاد تقرير الأثر أولاً.
  FOR v_row IN
    SELECT DISTINCT product_id, warehouse_id
    FROM inventory_transactions
    WHERE company_id = p_company_id AND deleted_at IS NULL
  LOOP
    SELECT COALESCE(SUM(
      CASE transaction_type
        WHEN 'purchase'        THEN  ABS(quantity)
        WHEN 'sales_return'    THEN  ABS(quantity)
        WHEN 'transfer_in'     THEN  ABS(quantity)
        WHEN 'adj_in'          THEN  ABS(quantity)
        WHEN 'initial'         THEN  ABS(quantity)
        WHEN 'sales'           THEN -ABS(quantity)
        WHEN 'purchase_return' THEN -ABS(quantity)
        WHEN 'transfer_out'    THEN -ABS(quantity)
        WHEN 'adj_out'         THEN -ABS(quantity)
        WHEN 'adj'             THEN  quantity
        ELSE 0
      END
    ), 0) INTO v_qty
    FROM inventory_transactions
    WHERE product_id   = v_row.product_id
      AND warehouse_id = v_row.warehouse_id
      AND company_id   = p_company_id
      AND deleted_at   IS NULL;

    SELECT ps.quantity, COALESCE(p.cost_price, 0)
      INTO v_current, v_cost
    FROM product_stock ps JOIN products p ON p.id = ps.product_id
    WHERE ps.product_id = v_row.product_id AND ps.warehouse_id = v_row.warehouse_id;

    IF v_current IS NOT NULL AND ROUND(v_current, 4) <> ROUND(GREATEST(0, v_qty), 4) THEN
      v_changed := v_changed + 1;
      v_units   := v_units + ABS(v_current - GREATEST(0, v_qty));
      v_value   := v_value + (ABS(v_current - GREATEST(0, v_qty)) * v_cost);
    END IF;

    INSERT INTO product_stock(product_id, warehouse_id, quantity, company_id)
    VALUES (v_row.product_id, v_row.warehouse_id, GREATEST(0, v_qty), p_company_id)
    ON CONFLICT (product_id, warehouse_id)
    DO UPDATE SET
      quantity   = GREATEST(0, EXCLUDED.quantity),
      updated_at = now();

    v_updated := v_updated + 1;
  END LOOP;

  IF NOT p_force AND v_changed > 0 THEN
    RAISE EXCEPTION
      'stock_recalculation_blocked: إعادة الحساب ستغيّر % صف مخزون بمقدار % وحدة (بقيمة ~% ر.س) لأن دفتر الحركات ينقصه الرصيد الافتتاحي. مرِّر p_force := true للتنفيذ عمداً، أو أكمل الأرصدة الافتتاحية أولاً.',
      v_changed, ROUND(v_units, 2), ROUND(v_value, 2);
  END IF;

  RETURN jsonb_build_object(
    'updated_rows', v_updated,
    'changed_rows', v_changed,
    'units_delta',  ROUND(v_units, 2),
    'value_delta',  ROUND(v_value, 2),
    'forced',       p_force,
    'company_id',   p_company_id,
    'completed_at', now()
  );
END;
$function$
;

REVOKE ALL ON FUNCTION public.admin_recalculate_all_stock(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_recalculate_all_stock(uuid, boolean) TO authenticated, service_role;
