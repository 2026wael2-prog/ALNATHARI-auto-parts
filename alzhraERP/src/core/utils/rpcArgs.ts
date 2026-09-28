/**
 * RPC argument helper — omitting a null instead of sending it.
 *
 * Why this exists
 * ---------------
 * The generated `database.types.ts` declares every optional RPC parameter as
 * `p_x?: string` (present-or-absent), while call sites naturally build
 * `p_x: valueOrNull`. Under `exactOptionalPropertyTypes`, `null` is not
 * assignable to `string | undefined`, so those call sites stopped compiling the
 * moment the types were regenerated against the live schema — which is correct:
 * the types were simply describing the database accurately for the first time.
 *
 * PostgreSQL treats a MISSING argument as the parameter's DEFAULT, and every
 * optional parameter in this schema declares `DEFAULT NULL` (verified against
 * pg_get_function_arguments for each function involved). Dropping a null is
 * therefore byte-for-byte the same call as sending one — `optArg` makes that
 * intent explicit and keeps `exactOptionalPropertyTypes` meaningful instead of
 * weakening it for the whole project.
 *
 * Empty strings are absent too
 * ----------------------------
 * An empty string is NOT the same as an omitted argument: PostgREST forwards it
 * verbatim and PostgreSQL rejects it for any non-text parameter.
 *
 *   p_from_date: ''  ->  22007 invalid input syntax for type date: ""
 *
 * That produced a live HTTP 400 on `get_party_statement` whenever a date filter
 * was left blank, because an untouched `<input type="date">` yields `''` rather
 * than `undefined`. The same hazard applies to every uuid (`p_branch_id`,
 * `p_payment_account_id`), boolean (`p_is_core`, `p_resolved`) and numeric
 * parameter; for text parameters an empty string silently filters to zero rows
 * (e.g. `status = ''`) instead of meaning "no filter".
 *
 * Because every optional parameter reachable through this helper declares
 * `DEFAULT NULL`, treating `''` as absent is exactly equivalent to letting the
 * server apply its default. This was verified per-function against the live
 * schema for all call sites (get_party_statement, search_invoices_advanced,
 * search_inventory_paginated, get_security_alerts_*, get_debt_*,
 * get_admin_*, generate_invoice_number, admin_resolve_security_alert).
 *
 * `false` and `0` are deliberately preserved — they are legitimate values, so
 * this check is a string-emptiness test, never a truthiness test.
 *
 * IMPORTANT: only use this for parameters whose default is NULL. For a
 * parameter with a non-null default (e.g. `search_parties.p_type DEFAULT 'all'`,
 * or `commit_payment.p_payment_method DEFAULT 'cash'`) omitting the argument
 * changes behaviour, and for a required parameter you must guard the value
 * instead — never silence it with this helper.
 */
export function optArg<K extends string, V>(
  key: K,
  value: V | null | undefined
): Partial<Record<K, V>> {
  if (value === null || value === undefined) return {};
  if (typeof value === 'string' && value.trim() === '') return {};
  return { [key]: value } as Partial<Record<K, V>>;
}
