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
 * IMPORTANT: only use this for parameters whose default is NULL. For a
 * parameter with a non-null default (e.g. `search_parties.p_type DEFAULT 'all'`)
 * omitting the argument changes behaviour, and for a required parameter you
 * must guard the value instead — never silence it with this helper.
 */
export function optArg<K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } {
  if (value === null || value === undefined) return {} as { [P in K]?: V };
  return { [key]: value } as { [P in K]?: V };
}
