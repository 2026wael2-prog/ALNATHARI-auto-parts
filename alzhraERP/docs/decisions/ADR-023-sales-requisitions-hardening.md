# ADR-023 — Sales Requisitions (المطلوبات) hardening

- **Status:** Accepted (client layer) / Pending operator approval (server storage)
- **Date:** 2026-09-29
- **Scope:** `src/features/sales/**/requisitions*`

## Context

An audit of the sales requisitions screen (the "المطلوبات" build-a-purchase-list
sheet that is shared with suppliers over WhatsApp/Telegram/PDF/Excel) found that
the whole feature lived in one Zustand store persisted to a **single global
localStorage key** and never reached the database. The audit produced 23 findings
(F1–F23); this ADR records the decisions behind the fixes.

Two facts shaped the decisions:

1. `database.types.ts` already contains a full procurement schema
   (`prc_purchase_requests`, `prc_purchase_request_items`, `prc_suppliers`, …)
   with relationships, **but no migration in `supabase/migrations` creates it and
   no `src` file uses it** (only `supabase/migrations_archive/` exists, with a
   single unrelated file). Its live shape is therefore unverifiable from this
   repository.
2. Project rules require confirmation before database schema changes
   ("Ask first: Database schema changes").

## Decision

1. **Fix and harden the client layer now, in full.** The grid, store, print
   sheet, Excel export, WhatsApp/Telegram share and history modal are all driven
   by one pure validation module (`utils/requisitionsValidation.ts`) so a bad row
   is always named to the user and can never be silently coerced.
2. **Do not invent a third requisitions entity.** The server-side home for this
   document is the *existing* procurement entity — `prc_purchase_requests` +
   `prc_purchase_request_items` — not a new `requisitions` table and not a
   parallel local-only model.
3. **Until that entity is reconciled, saving produces an honest local draft.**
   The record is stored per company + per user, is stamped "بدون رقم — مسودة
   محلية", and the UI states that it will receive a `REQ-YYYY-NNNN` number only
   once server storage is enabled. The app never shows a fake "saved to server"
   confirmation.

## Audit findings addressed in this change

| # | Finding | Fix |
|---|---------|-----|
| F1 | Draft stored in one global key, shared across users/companies | Key scoped to `sales_requisitions:<companyId>:<userId>:active`; in-memory grid reset + rehydrate when the scope changes; the legacy `alzhra_sales_requisitions_v1` key is purged on first read |
| F2 | No server persistence / no document number | Local numbered draft + explicit "local only" labelling; server path blocked on the schema decision below |
| F3 | Autofill dropped `part_number`/`brand` (wrote SKU + never-populated `category`) | `useProductSearch` exposes both; the grid fills the real part number/brand and preserves the typed quantity |
| F4 | Row reorder used visible indices, so filtering swapped hidden rows | `moveItem(id, 'up')` / `moveItem(id, 'down')`; arrows disabled while the quick filter is active |
| F5 | Save was unguarded and unnumbered | Save is blocked by blocking issues, gated by permission, and reports the real number/local status |
| F6 | No permission gate on issuing to a supplier | `usePermission('purchases:create')` gates Save/WhatsApp/Telegram + a read-only banner |
| F10 | Print CSS used bare `table`/`th, td` selectors (leaked app-wide) | All rules scoped to `.requisitions-print-wrapper` |
| F17 | Unparsable/zero quantities were silently rewritten to `1` | `0` marks the cell invalid, the row is highlighted, an amber banner names it and every outgoing action is blocked |
| F22 | WhatsApp helpers imported across feature boundaries | Canonical `core/utils/whatsapp.ts`; requisitions import from core |
| — | Clipboard import silently dropped/mangled rows | `importFromText` returns `{ imported, duplicates, invalid }` and the modal states each count |
| — | Storage quota/private-mode failures were invisible | `storageWarning` banner + `CloudOff` notice telling the user to export/print |

## Server storage — pending operator decision (do not run blindly)

The reconciliation below is **additive and idempotent**, and is deliberately not
shipped as a migration until the origin of the `prc_*` tables is confirmed
(which project/migration created them, and whether the live columns match
`database.types.ts`). Split it out and run it as a normal migration once
confirmed:

```sql
-- 1) Bridge columns the requisition grid needs (all additive).
ALTER TABLE public.prc_purchase_requests
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS supplier_name text,
  ADD COLUMN IF NOT EXISTS supplier_phone text;

ALTER TABLE public.prc_purchase_request_items
  ADD COLUMN IF NOT EXISTS part_number text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS line_number integer NOT NULL DEFAULT 1;

-- 2) Atomic, race-free numbering per company and year (same pattern as
--    get_next_invoice_number: advisory lock, no MAX()+1 race).
CREATE OR REPLACE FUNCTION public.next_requisition_number(p_company_id uuid, p_year integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_next integer;
BEGIN
  IF NOT public.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'عذراً، لا تمتلك صلاحية الوصول إلى هذه المنشأة';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('requisition_number:' || p_company_id::text || ':' || p_year::text));
  SELECT COALESCE(MAX(NULLIF(regexp_replace(pr_number, '^REQ-\d{4}-', ''), '')::integer), 0) + 1
    INTO v_next
    FROM public.prc_purchase_requests
   WHERE company_id = p_company_id
     AND pr_number LIKE 'REQ-' || p_year::text || '-%';
  RETURN 'REQ-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
END; $$;
REVOKE ALL ON FUNCTION public.next_requisition_number(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_requisition_number(uuid, integer) TO authenticated;
```

Then: RLS policies mirroring the existing tenant pattern
(`company_id = (auth.jwt() ->> 'company_id')::uuid` style guards + `has_permission`),
a `commit_sales_requisition(p_company_id, p_user_id, p_data jsonb)` RPC that writes
header + items in one transaction (mirroring `commit_expense_v2`), `audit_logs`
entries on create/update/delete, and regeneration of `database.types.ts`.

## Consequences

- The grid is now safe to use: no silent data loss, no cross-user leakage, no
  invented quantities, and no permission bypass on supplier-facing actions.
- Requisitions remain single-device until the server entity is wired; the UI says
  so instead of implying otherwise. Wiring the API later is additive: the store
  already carries `serverNumber`/`serverRecordId` and the record type already
  distinguishes `origin: 'server' | 'local'`.
- Drafts are intentionally **not** deleted on logout: keys are already scoped per
  user + company, so nothing leaks, while deleting them would destroy unsaved
  work. Scoping provides the isolation that F1 asked for.
---

## Status update - server entity resolved and validated (2026-09-29)

### What was unknown before
An earlier draft of this ADR left the storage question open ("adopt prc_* versus stay
client-local") because the prc_* tables appeared to have no owning migration.

### Findings, verified against the live project (orxlyiokccaodypindye)

| Question | Answer |
|---|---|
| Where do prc_* come from? | supabase/migrations/20260819000001_baseline_schema.sql, lines 1183-1760 (38 tables) |
| Do they exist in production? | Yes, all 38, and every one has 0 rows (never used) |
| Is RLS active? | Yes: relrowsecurity = true, policy `*_isolation_policy` = is_super_admin() OR company_id IN (SELECT get_auth_companies()) |
| Is there a live RPC? | No: api_v1_prc_create_pr was dropped by 20260928000004_drop_dead_api_v1_module.sql (api_v1_* count in pg_proc = 0) |
| Header columns? | pr_id, company_id, pr_number, requester_id, department_id, justification, status, priority, required_date, total_estimated_value, currency, created_at, updated_at - no branch, supplier or title |
| Status / priority vocabulary? | status in draft, submitted, in_review, approved, rejected, closed, cancelled; priority in normal, high, urgent |

Repo conventions this feature must copy: pg_advisory_xact_lock numbering
(20260819000013_numbering_locks.sql), the commit_expense_v2 write-RPC shape (idempotency
column + 15s debounce), public.audit_write(...) is mandatory for commit_*/update_* names
(view v_rpcs_missing_audit), and composite tenant-safe FKs (fk_expenses_company_branch ->
REFERENCES branches(company_id, id)).

### Decision
Reuse prc_purchase_requests / prc_purchase_request_items and ship one ADDITIVE migration:
supabase/migrations/20260929000001_sales_requisitions_server_entity.sql

* 8 nullable bridge columns (branch_id, supplier_party_id, title, notes, idempotency_key,
  source, sent_at, updated_by) - no existing column touched, no row rewritten.
* 2 composite FKs (branches(company_id, id) RESTRICT, parties(company_id, id) SET NULL),
  1 CHECK on source, 3 indexes (partial unique on idempotency_key, listing, status).
* get_next_requisition_number(uuid) -> PR-YYYYMM-NNNN under a per-company advisory lock.
  The dropped RPC used COUNT(*)+1, which races on the (company_id, pr_number) unique key.
* commit_sales_requisition(uuid, uuid, jsonb) - header + lines + total in ONE transaction,
  idempotent, audited, and it takes the actor from auth.uid() instead of trusting the
  client argument (a hardening commit_expense_v2 does not have).
* set_sales_requisition_status(uuid, text) - audited transition with a terminal-state guard.
* Privileges: REVOKE ALL ... FROM PUBLIC, anon then GRANT EXECUTE ... TO authenticated, service_role.

### Evidence - validated against production inside a ROLLED BACK transaction
Method: BEGIN; <migration>; <smoke test>; ROLLBACK; - nothing was persisted.

| # | Check | Result |
|---|---|---|
| 1 | next number | PR-202609-0001 |
| 2 | create, 2 lines (3 x 45.5 + 2 x 30) | success, total 196.5, items_count 2 |
| 3 | same idempotency key replayed | same id, is_duplicate: true (double click safe) |
| 4 | update with pr_id | number unchanged, lines replaced, total recomputed |
| 5 | audit trail | audit_logs = 2, procurement_audit_logs = 2 |
| 6 | reopen a closed requisition | blocked: invalid_transition |
| 7 | empty items / zero quantity | blocked: invalid_items / invalid_quantity |
| 8 | branch from another company | FK violation 23503 (tenant guard holds) |
| 9 | branch_id = not-a-uuid, supplier_id = DROP TABLE x | sanitised to NULL, no error |
| 10 | v_rpcs_missing_audit | the three new functions are NOT listed |
| 11 | grants | no anon EXECUTE on any of the three functions |

### Correction found during the pre-push review (2026-09-29)
The status vocabulary originally drafted here (`... approved, rejected, closed, cancelled`) came
from the baseline-era definition. The **authoritative** constraint in this database is
`chk_pr_status`, (re)created by `20260916000005_data_integrity_fixes.sql`:

```
CHECK (status IN ('draft','submitted','in_review','approved','rejected','converted_to_rfq','converted_to_po','cancelled'))
```

Two consequences, both now fixed in the migration and the client:

1. `closed` is **not** an allowed value. `commit_sales_requisition` and
   `set_sales_requisition_status` would have raised a raw `23514` (check violation) instead of
   the intended Arabic message. The write whitelist in both functions now mirrors the constraint
   exactly, and the terminal-state guard treats `converted_to_rfq`, `converted_to_po` and
   `cancelled` as final.
2. `converted_to_rfq` / `converted_to_po` are real states the UI never invents but can read back:
   `fromServerStatus` maps them to `received`, and `ServerRequisitionStatus` lists them instead of
   `closed`.

A regression test now pins the writer against the constraint's value set, so this cannot drift
back silently.

### Client side (shipped with this ADR)

src/features/sales/api/requisitionsApi.ts is the only writer (RPC, never table inserts).
requisitionsStore.saveRequisition() tries the server first and reports exactly what
happened. RequisitionsHistoryModal lists the server history through TanStack Query and
labels every row "on the server" or "on this device". The grid columns round-trip
losslessly through the single description column (serializeRequisitionItemDescription).
A separate serverBackedId keeps a LOCAL draft id from ever being sent as pr_id, which
would have made every later save look like "document not found" and frozen the feature in
local-only mode for ever.