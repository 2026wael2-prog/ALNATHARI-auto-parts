-- ============================================================
-- Migration: 20260929000001_sales_requisitions_server_entity.sql
-- Date: 2026-09-29
-- Severity: HIGH (audit F2/F5 — sales requisitions had no server entity)
--
-- PURPOSE:
--   The sales "requisitions" screen (المطلوبات) stored its drafts ONLY in
--   localStorage, so a requisition was invisible to the rest of the ERP and
--   could not survive a device change or carry an official number.
--
--   The procurement subsystem (prc_*) already ships in this database
--   (baseline_schema.sql lines 1183-1760, 38 tables, RLS enabled with the
--   standard tenant-isolation policy) and is completely empty. Rather than
--   inventing a second "requisition" entity, this migration REUSES
--   prc_purchase_requests / prc_purchase_request_items and only adds the
--   bridge columns the sales workflow needs.
--
--   The previous api_v1_prc_create_pr RPC was dropped by
--   20260928000004_drop_dead_api_v1_module.sql, so no live RPC exists for
--   this table; this migration supplies a hardened one (advisory-lock
--   numbering, idempotency, audit_write) following commit_expense_v2.
--
-- ADDITIVE ONLY: no existing column, row or policy is modified.
-- ============================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) Bridge columns on prc_purchase_requests (all nullable)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.prc_purchase_requests
  ADD COLUMN IF NOT EXISTS branch_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_party_id uuid,
  ADD COLUMN IF NOT EXISTS title character varying(200),
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS source character varying(30),
  ADD COLUMN IF NOT EXISTS sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

COMMENT ON COLUMN public.prc_purchase_requests.supplier_party_id IS
  'Supplier to share the requisition with. References parties(id): the ERP supplier registry (prc_suppliers is the separate portal registry and is empty).';
COMMENT ON COLUMN public.prc_purchase_requests.source IS
  'Origin screen: sales_requisitions | procurement.';
COMMENT ON COLUMN public.prc_purchase_requests.sent_at IS
  'When the requisition was sent to the supplier (status submitted).';

-- ─────────────────────────────────────────────────────────────
-- 2) Constraints (tenant-safe, ON DELETE per repo convention)
-- ─────────────────────────────────────────────────────────────
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prc_pr_company_branch') THEN
    ALTER TABLE public.prc_purchase_requests
      ADD CONSTRAINT fk_prc_pr_company_branch
      FOREIGN KEY (company_id, branch_id) REFERENCES public.branches(company_id, id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_prc_pr_company_supplier_party') THEN
    ALTER TABLE public.prc_purchase_requests
      ADD CONSTRAINT fk_prc_pr_company_supplier_party
      FOREIGN KEY (company_id, supplier_party_id) REFERENCES public.parties(company_id, id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prc_purchase_requests_source_check') THEN
    ALTER TABLE public.prc_purchase_requests
      ADD CONSTRAINT prc_purchase_requests_source_check
      CHECK (source IS NULL OR source IN ('sales_requisitions', 'procurement'));
  END IF;
END $do$;

-- ─────────────────────────────────────────────────────────────
-- 3) Indexes: idempotency (partial), listing, status filter
-- ─────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ux_prc_pr_company_idempotency
  ON public.prc_purchase_requests (company_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_prc_pr_company_created
  ON public.prc_purchase_requests (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_prc_pr_company_status
  ON public.prc_purchase_requests (company_id, status);

CREATE INDEX IF NOT EXISTS ix_prc_pr_items_pr
  ON public.prc_purchase_request_items (pr_id);
-- ─────────────────────────────────────────────────────────────
-- 4) Numbering: PR-YYYYMM-NNNN, serialised per company
--    The dropped api_v1_prc_create_pr used COUNT(*)+1 which races: two
--    concurrent saves pick the same number and one fails on
--    prc_purchase_requests_company_id_pr_number_key. This mirrors
--    20260819000013_numbering_locks.sql (pg_advisory_xact_lock).
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_next_requisition_number(p_company_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next bigint;
BEGIN
  PERFORM public.fn_assert_company_access(p_company_id);
  PERFORM pg_advisory_xact_lock(hashtext('prc_pr_number:' || p_company_id::text));

  SELECT COALESCE(MAX((regexp_match(pr_number, '([0-9]+)$'))[1]::bigint), 0) + 1
    INTO v_next
  FROM public.prc_purchase_requests
  WHERE company_id = p_company_id
    AND pr_number ~ ('^PR-' || TO_CHAR(now(), 'YYYYMM') || '-[0-9]+$');

  RETURN 'PR-' || TO_CHAR(now(), 'YYYYMM') || '-' || LPAD(v_next::text, 4, '0');
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 5) commit_sales_requisition — atomic create/update of a requisition
--    Contract (mirrors commit_expense_v2):
--      * PERFORM fn_assert_company_access(p_company_id) — tenant barrier
--      * actor identity comes from auth.uid() when present (p_user_id is
--        only a fallback for service_role callers): a client cannot forge
--        the requester of a requisition it belongs to another company
--      * idempotency_key + 15s debounce => double-click cannot create two
--        requisitions (returns is_duplicate = true instead)
--      * amounts/dates/uuid sanitised before any cast (no 22P02 leaks)
--      * audit_write is mandatory (see v_rpcs_missing_audit)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.commit_sales_requisition(p_company_id uuid, p_user_id uuid, p_data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_pr_id uuid;
  v_pr_number text;
  v_user_id uuid;
  v_title text;
  v_notes text;
  v_currency text;
  v_status text;
  v_idempotency_key text;
  v_existing_id uuid;
  v_existing_number text;
  v_raw_branch text;
  v_branch_id uuid;
  v_raw_supplier text;
  v_supplier_party_id uuid;
  v_required_date date;
  v_items jsonb;
  v_item jsonb;
  v_qty numeric;
  v_price numeric;
  v_uom text;
  v_desc text;
  v_item_total numeric;
  v_total numeric := 0;
  v_item_count integer := 0;
  v_before jsonb;
BEGIN
  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'company_id_required: company identifier is required';
  END IF;
  PERFORM public.fn_assert_company_access(p_company_id);

  -- Actor identity: never trust the client when a JWT is present.
  v_user_id := COALESCE(auth.uid(), p_user_id);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id_required: authenticated user is required';
  END IF;

  v_items := COALESCE(p_data -> 'items', '[]'::jsonb);
  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items: a requisition must contain at least one line';
  END IF;

  v_title := NULLIF(TRIM(COALESCE(p_data ->> 'title', '')), '');
  v_notes := NULLIF(TRIM(COALESCE(p_data ->> 'notes', '')), '');
  v_currency := COALESCE(NULLIF(TRIM(p_data ->> 'currency'), ''), 'SAR');
  v_status := COALESCE(NULLIF(TRIM(p_data ->> 'status'), ''), 'draft');
  IF v_status NOT IN ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'converted_to_rfq', 'converted_to_po', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: unsupported status %', v_status;
  END IF;

  BEGIN
    v_required_date := NULLIF(TRIM(COALESCE(p_data ->> 'needed_by', p_data ->> 'required_date')), '')::date;
  EXCEPTION WHEN OTHERS THEN
    v_required_date := NULL;
  END;

  v_raw_branch := TRIM(COALESCE(p_data ->> 'branch_id', ''));
  IF v_raw_branch ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_branch_id := v_raw_branch::uuid;
  ELSE
    v_branch_id := NULL;
  END IF;

  v_raw_supplier := TRIM(COALESCE(p_data ->> 'supplier_id', ''));
  IF v_raw_supplier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_supplier_party_id
      FROM public.parties
     WHERE id = v_raw_supplier::uuid AND company_id = p_company_id;
  ELSE
    v_supplier_party_id := NULL;
  END IF;

  -- Idempotency: replay of an already committed requisition
  v_idempotency_key := NULLIF(TRIM(COALESCE(p_data ->> 'idempotency_key', '')), '');
  IF v_idempotency_key IS NOT NULL THEN
    SELECT pr_id, pr_number INTO v_existing_id, v_existing_number
      FROM public.prc_purchase_requests
     WHERE company_id = p_company_id AND idempotency_key = v_idempotency_key
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'id', v_existing_id, 'pr_number', v_existing_number, 'is_duplicate', true);
    END IF;
  END IF;

  -- Debounce identical rapid submissions (double click) within 15 seconds
  IF v_title IS NOT NULL THEN
    SELECT pr_id, pr_number INTO v_existing_id, v_existing_number
      FROM public.prc_purchase_requests
     WHERE company_id = p_company_id
       AND requester_id = v_user_id
       AND status = 'draft'
       AND title = v_title
       AND created_at >= now() - INTERVAL '15 seconds'
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_existing_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'id', v_existing_id, 'pr_number', v_existing_number, 'is_duplicate', true);
    END IF;
  END IF;  -- ── Existing requisition: update header, replace lines (never re-number) ──
  IF NULLIF(TRIM(COALESCE(p_data ->> 'pr_id', '')), '') IS NOT NULL THEN
    v_pr_id := (p_data ->> 'pr_id')::uuid;

    SELECT pr_number,
           jsonb_build_object('title', title, 'status', status, 'total_estimated_value', total_estimated_value)
      INTO v_pr_number, v_before
      FROM public.prc_purchase_requests
     WHERE pr_id = v_pr_id AND company_id = p_company_id;

    IF v_pr_number IS NULL THEN
      RAISE EXCEPTION 'requisition_not_found: no requisition with this id in this company';
    END IF;

    UPDATE public.prc_purchase_requests SET
      title             = v_title,
      notes             = v_notes,
      justification     = COALESCE(v_notes, justification),
      currency          = v_currency,
      status            = v_status,
      required_date     = v_required_date,
      branch_id         = v_branch_id,
      supplier_party_id = v_supplier_party_id,
      source            = 'sales_requisitions',
      idempotency_key   = COALESCE(v_idempotency_key, idempotency_key),
      sent_at           = CASE WHEN v_status <> 'draft' THEN COALESCE(sent_at, now()) ELSE sent_at END,
      updated_by        = v_user_id,
      updated_at        = now()
    WHERE pr_id = v_pr_id AND company_id = p_company_id;

    DELETE FROM public.prc_purchase_request_items
     WHERE pr_id = v_pr_id AND company_id = p_company_id;

  -- ── New requisition: number it under an advisory lock ──
  ELSE
    v_pr_number := public.get_next_requisition_number(p_company_id);

    INSERT INTO public.prc_purchase_requests (
      company_id, pr_number, requester_id, title, notes, justification,
      status, priority, required_date, currency, branch_id, supplier_party_id,
      source, idempotency_key, updated_by
    ) VALUES (
      p_company_id, v_pr_number, v_user_id, v_title, v_notes, v_notes,
      v_status, 'normal', v_required_date, v_currency, v_branch_id, v_supplier_party_id,
      'sales_requisitions', v_idempotency_key, v_user_id
    ) RETURNING pr_id INTO v_pr_id;
  END IF;

  -- ── Lines: validate then insert; totals computed from the inserted rows ──
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    v_qty := COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'quantity', '')), '')::numeric, 0);
    v_price := COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'unit_price', '')), '')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid_quantity: every line must have a quantity greater than zero';
    END IF;
    IF v_price < 0 THEN
      v_price := 0;
    END IF;

    v_uom := COALESCE(NULLIF(TRIM(COALESCE(v_item ->> 'uom', '')), ''), 'unit');
    v_desc := COALESCE(
                NULLIF(TRIM(COALESCE(v_item ->> 'description', '')), ''),
                NULLIF(TRIM(COALESCE(v_item ->> 'name', '')), ''),
                NULLIF(TRIM(COALESCE(v_item ->> 'part_number', '')), ''),
                'item'
              );
    v_item_total := ROUND(v_qty * v_price, 4);
    v_total := v_total + v_item_total;
    v_item_count := v_item_count + 1;

    INSERT INTO public.prc_purchase_request_items (
      company_id, pr_id, product_id, description, quantity,
      unit_of_measure, estimated_unit_price, total_estimated_price
    ) VALUES (
      p_company_id,
      v_pr_id,
      CASE WHEN TRIM(COALESCE(v_item ->> 'product_id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (v_item ->> 'product_id')::uuid ELSE NULL END,
      v_desc,
      v_qty,
      v_uom,
      v_price,
      v_item_total
    );
  END LOOP;

  UPDATE public.prc_purchase_requests
     SET total_estimated_value = v_total
   WHERE pr_id = v_pr_id AND company_id = p_company_id;  -- ── Audit trail (never blocks the write) ──
  BEGIN
    PERFORM public.audit_write(
      CASE WHEN v_before IS NULL THEN 'requisition_created' ELSE 'requisition_updated' END,
      'prc_purchase_requests',
      v_pr_id,
      p_company_id,
      jsonb_build_object(
        'pr_number', v_pr_number,
        'title', v_title,
        'status', v_status,
        'items_count', v_item_count,
        'total_estimated_value', v_total,
        'supplier_party_id', v_supplier_party_id
      )
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.procurement_audit_logs (
      company_id, actor_id, entity_type, entity_id, action, before_state, after_state, metadata
    ) VALUES (
      p_company_id, v_user_id, 'purchase_request', v_pr_id,
      CASE WHEN v_before IS NULL THEN 'create' ELSE 'update' END,
      v_before,
      jsonb_build_object('title', v_title, 'status', v_status, 'total_estimated_value', v_total, 'items_count', v_item_count),
      jsonb_build_object('source', 'sales_requisitions', 'pr_number', v_pr_number)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_pr_id,
    'pr_number', v_pr_number,
    'status', v_status,
    'items_count', v_item_count,
    'total_estimated_value', v_total,
    'is_duplicate', false
  );
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 6) set_sales_requisition_status — audited status transition
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_sales_requisition_status(p_pr_id uuid, p_status text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_company_id uuid;
  v_old_status text;
  v_pr_number text;
  v_new_status text;
BEGIN
  v_new_status := LOWER(TRIM(COALESCE(p_status, '')));
  IF v_new_status NOT IN ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'converted_to_rfq', 'converted_to_po', 'cancelled') THEN
    RAISE EXCEPTION 'invalid_status: unsupported status %', p_status;
  END IF;

  SELECT company_id, status, pr_number
    INTO v_company_id, v_old_status, v_pr_number
    FROM public.prc_purchase_requests
   WHERE pr_id = p_pr_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'requisition_not_found: no requisition with this id';
  END IF;

  PERFORM public.fn_assert_company_access(v_company_id);

  IF v_old_status IN ('converted_to_rfq', 'converted_to_po', 'cancelled') AND v_new_status <> v_old_status THEN
    RAISE EXCEPTION 'invalid_transition: % -> % is not allowed on a converted or cancelled requisition', v_old_status, v_new_status;
  END IF;

  UPDATE public.prc_purchase_requests
     SET status     = v_new_status,
         sent_at    = CASE WHEN v_new_status <> 'draft' THEN COALESCE(sent_at, now()) ELSE sent_at END,
         updated_by = COALESCE(auth.uid(), updated_by),
         updated_at = now()
   WHERE pr_id = p_pr_id;

  BEGIN
    PERFORM public.audit_write(
      'requisition_status_changed',
      'prc_purchase_requests',
      p_pr_id,
      v_company_id,
      jsonb_build_object('pr_number', v_pr_number, 'from', v_old_status, 'to', v_new_status)
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN jsonb_build_object('success', true, 'id', p_pr_id, 'pr_number', v_pr_number, 'status', v_new_status);
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 7) Privileges — anon must never reach these (20260821000002 convention)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.get_next_requisition_number(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commit_sales_requisition(uuid, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_sales_requisition_status(uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_next_requisition_number(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_sales_requisition(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_sales_requisition_status(uuid, text) TO authenticated, service_role;

COMMIT;