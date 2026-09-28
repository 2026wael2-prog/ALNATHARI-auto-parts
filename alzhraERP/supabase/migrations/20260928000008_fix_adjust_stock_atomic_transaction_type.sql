-- ============================================================
-- fix adjust_stock_atomic: it could never change stock
-- ============================================================
-- The function is the app's "set stock" path (warehouseApi.updateStock). It inserts
-- a movement with transaction_type = 'adjustment', but:
--
--   1. 'adjustment' is NOT in the CHECK constraint on inventory_transactions
--      (allowed: purchase, sales, purchase_return, sales_return, transfer_in,
--       transfer_out, adj_in, adj_out, adj, initial) -> every call failed with
--      "23514 ... violates check constraint transaction_type_check".
--   2. trg_update_product_stock, which maintains product_stock, has no branch for
--      'adjustment' (its CASE ends in ELSE 0), so even had it been accepted the
--      quantity would never have changed.
--
-- Verified live before fixing: calling it raised 23514 with the failing row
-- "(..., 1.0000, adjustment, manual_update, ...)".
--
-- 'adj' is the correct value: it is permitted, and the trigger maps it to
-- `NEW.quantity` unchanged (a SIGNED delta, unlike adj_in/adj_out which take ABS).
-- The function already computes `v_adjustment := p_target_quantity - v_current`,
-- i.e. a signed delta — exactly what 'adj' expects — so this single word restores
-- the intended behaviour without changing any other logic.
--
-- The matching client-side fallback in src/features/inventory/api/warehouseApi.ts
-- had the same value and is fixed in the same commit.

CREATE OR REPLACE FUNCTION public.adjust_stock_atomic(p_company_id uuid, p_product_id uuid, p_warehouse_id uuid, p_target_quantity numeric, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_current numeric;
  v_adjustment numeric;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  -- بوابة المستأجر (R-26 pattern)
  perform public.fn_assert_company_access(p_company_id);

  select coalesce(quantity, 0)
    into v_current
    from public.product_stock
   where product_id = p_product_id
     and warehouse_id = p_warehouse_id;

  v_adjustment := p_target_quantity - v_current;

  if v_adjustment <> 0 then
    insert into public.inventory_transactions (
      company_id, created_by, product_id, warehouse_id, quantity,
      total_cost, unit_cost, transaction_type, reference_type
    ) values (
      p_company_id, p_user_id, p_product_id, p_warehouse_id, v_adjustment,
      0, 0, 'adj', 'manual_update'
    );

    -- R-28: تدقيق (failsafe — فشل التدقيق لا يكسر العملية الأصلية)
    begin
      perform public.audit_write(
        'stock_adjusted',
        'inventory_transactions',
        p_product_id,
        p_company_id,
        jsonb_build_object('warehouse_id', p_warehouse_id, 'adjustment', v_adjustment)
      );
    exception when others then
      null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'adjustment', v_adjustment);
end;
$function$
;
