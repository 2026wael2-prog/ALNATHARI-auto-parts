-- ============================================================
-- drop the retired api_v1_* / prc_publish_* module
-- ============================================================
-- A second, parallel procurement + supplier-portal API (RFQ, purchase orders, goods
-- receipts, supplier approval, job queue, event publishing) that the application
-- never calls. It remained granted to `authenticated`, so any client could invoke
-- it, and two of its functions referenced tables that no longer exist
-- (fin_journal_lines, inv_stock_movement_items) and would have failed with a 500.
--
-- Verified against the live database before dropping:
--   * 54 functions: 43 api_v1_* + 11 prc_publish_* event helpers
--   * 0 functions outside this set reference it (textual scan of all 430 functions)
--   * 0 views, 0 cron jobs, 0 objects in other schemas
--   * dependency discovery via pg_depend found exactly 11 dependents, all triggers
--     on prc_* tables owned by this same module (listed below)
--   * the React app never calls any api_v1_* name (only generated types mention them)
--
-- The fin_* / prc_* / inv_stock_* tables are deliberately NOT dropped here; that is
-- a separate data-retention decision.

-- Triggers must go first: they are the only objects that depend on prc_publish_*.
DROP TRIGGER IF EXISTS trg_prc_grn_status_changed_event ON public.prc_goods_receipts;
DROP TRIGGER IF EXISTS trg_prc_invoice_status_changed_event ON public.prc_purchase_invoices;
DROP TRIGGER IF EXISTS trg_prc_po_created_event ON public.prc_purchase_orders;
DROP TRIGGER IF EXISTS trg_prc_po_status_changed_event ON public.prc_purchase_orders;
DROP TRIGGER IF EXISTS trg_prc_pr_created_event ON public.prc_purchase_requests;
DROP TRIGGER IF EXISTS trg_prc_pr_status_changed_event ON public.prc_purchase_requests;
DROP TRIGGER IF EXISTS trg_prc_quotation_status_changed_event ON public.prc_quotations;
DROP TRIGGER IF EXISTS trg_prc_evaluation_status_changed_event ON public.prc_rfq_evaluations;
DROP TRIGGER IF EXISTS trg_prc_rfq_status_changed_event ON public.prc_rfqs;
DROP TRIGGER IF EXISTS trg_prc_sla_violation_recorded_event ON public.prc_supplier_sla_violations;
DROP TRIGGER IF EXISTS trg_prc_supplier_created_event ON public.prc_suppliers;

-- Functions in leaves-first order, so no CASCADE is required.
DROP FUNCTION IF EXISTS public.api_v1_fin_generate_grn_je(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_inv_create_warehouse(uuid,character varying,character varying,character varying,text,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_accept_grn(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_act_on_pr(uuid,uuid,character varying,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_add_supplier_product(uuid,uuid,uuid,character varying,numeric,numeric,smallint,boolean,smallint);
DROP FUNCTION IF EXISTS public.api_v1_prc_approve_supplier(uuid,uuid,boolean,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_approve_variance(uuid,uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_award_rfq(uuid,uuid,uuid,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.api_v1_prc_block_supplier(uuid,uuid,character varying,text,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_calculate_ranking(uuid,uuid,numeric,numeric,numeric);
DROP FUNCTION IF EXISTS public.api_v1_prc_calculate_supplier_metrics(uuid,uuid,date,date);
DROP FUNCTION IF EXISTS public.api_v1_prc_cancel_po(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_cancel_pr(uuid,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_close_rfq(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_create_grn(uuid,uuid,uuid,character varying,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.api_v1_prc_create_po_from_quotation(uuid,uuid,uuid,date,character varying,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_create_pr(uuid,uuid,uuid,text,character varying,date,character varying,jsonb);
DROP FUNCTION IF EXISTS public.api_v1_prc_create_rfq(uuid,uuid,character varying,timestamp with time zone,date,text,jsonb,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_create_supplier(uuid,character varying,character varying,character varying,uuid,character varying,character varying,character varying,character varying,character varying,character varying,character varying,smallint);
DROP FUNCTION IF EXISTS public.api_v1_prc_instantiate_pr_workflow(uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_invite_supplier_to_rfq(uuid,uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_issue_po(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_publish_rfq(uuid,uuid,uuid,uuid[]);
DROP FUNCTION IF EXISTS public.api_v1_prc_record_supplier_document(uuid,uuid,character varying,character varying,character varying,date,date,smallint[],uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_run_three_way_match(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_schedule_analytics_job(uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_score_quotation(uuid,uuid,uuid,numeric,numeric,numeric);
DROP FUNCTION IF EXISTS public.api_v1_prc_start_evaluation(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_submit_pr(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_submit_quotation(uuid,uuid,uuid,character varying,date,character varying,smallint,text,jsonb);
DROP FUNCTION IF EXISTS public.api_v1_prc_submit_supplier_approval(uuid,uuid,uuid);
DROP FUNCTION IF EXISTS public.api_v1_prc_update_supplier_scores(uuid,uuid,date,date);
DROP FUNCTION IF EXISTS public.api_v1_prc_update_supplier_terms(uuid,uuid,character varying,numeric,smallint,character varying,character varying,character varying,text,text,text);
DROP FUNCTION IF EXISTS public.api_v1_prc_upsert_supplier_price(uuid,uuid,numeric,character varying,numeric,numeric,numeric,timestamp with time zone,timestamp with time zone);
DROP FUNCTION IF EXISTS public.api_v1_sys_claim_job(character varying,integer);
DROP FUNCTION IF EXISTS public.api_v1_sys_complete_job(uuid,character varying);
DROP FUNCTION IF EXISTS public.api_v1_sys_fail_job(uuid,text,character varying,integer);
DROP FUNCTION IF EXISTS public.api_v1_sys_is_feature_enabled(character varying,uuid,uuid,character varying);
DROP FUNCTION IF EXISTS public.api_v1_sys_worker_heartbeat(character varying);
DROP FUNCTION IF EXISTS public.prc_publish_evaluation_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_grn_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_invoice_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_po_created_event();
DROP FUNCTION IF EXISTS public.prc_publish_po_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_pr_created_event();
DROP FUNCTION IF EXISTS public.prc_publish_pr_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_quotation_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_rfq_status_changed_event();
DROP FUNCTION IF EXISTS public.prc_publish_sla_violation_event();
DROP FUNCTION IF EXISTS public.prc_publish_supplier_created_event();
DROP FUNCTION IF EXISTS public.api_v1_fin_post_journal_entry(uuid,date,character varying,uuid,text,jsonb,uuid,boolean);
DROP FUNCTION IF EXISTS public.api_v1_inv_record_movement(uuid,uuid,inv_movement_type,character varying,uuid,jsonb,uuid,text);
DROP FUNCTION IF EXISTS public.api_v1_sys_enqueue_job(uuid,character varying,jsonb,uuid,timestamp with time zone);
DROP FUNCTION IF EXISTS public.api_v1_sys_publish_event(uuid,character varying,uuid,character varying,jsonb,uuid,character varying,uuid);
