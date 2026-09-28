-- ============================================================
-- revoke the unguarded stock recalculation from the API surface
-- ============================================================
-- recalculate_product_stock() and recalculate_product_stock_for_warehouse() rebuild
-- product_stock from inventory_transactions. They have no refusal guard, and the
-- ledger cannot support that rebuild: it has one opening row per item where
-- product_stock holds two (97 products entered on 2026-08-26 were applied twice),
-- the 8 purchase_return rows are soft-deleted, and it contains no movement at all
-- for 246 stock rows. Running either one silently rewrites real inventory.
--
-- They were granted to `authenticated`, so any signed-in user could invoke them
-- over the API. Verified before revoking: 0 functions call them, 0 triggers call
-- them, and the application never references either name.
--
-- This only removes the ability to invoke them; the definitions are untouched and
-- service_role retains access for deliberate maintenance. This is the same
-- precaution already applied to admin_recalculate_all_stock(), which now also
-- refuses unless p_force := true.

REVOKE ALL ON FUNCTION public.recalculate_product_stock(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_product_stock(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.recalculate_product_stock_for_warehouse(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_product_stock_for_warehouse(uuid,uuid) TO service_role;
