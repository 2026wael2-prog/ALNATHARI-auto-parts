import fs from 'node:fs';

const token = (process.env.SUPABASE_ACCESS_TOKEN
  ?? (fs.existsSync(process.env.USERPROFILE + '/.supabase/access-token')
    ? fs.readFileSync(process.env.USERPROFILE + '/.supabase/access-token', 'utf8').trim()
    : null));
if (!token) throw new Error('No Supabase access token.');
const projectRef = 'gvjmpgxdmekjsgzhlzzz';

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  return { status: res.status, text: await res.text() };
}

async function main() {
  // Role-level timeouts: does `authenticated` get a short statement_timeout?
  let r = await query(`
    SELECT rolname, rolconfig FROM pg_roles
    WHERE rolname IN ('authenticated','anon','service_role','postgres');`);
  console.log('--- role configs ---');
  console.log(r.status, r.text.slice(0, 3000));

  r = await query(`SHOW statement_timeout;`);
  console.log('\n--- admin statement_timeout ---');
  console.log(r.status, r.text.slice(0, 500));

  // Time the function itself as authenticated.
  r = await query(`
BEGIN;
SELECT set_config('request.jwt.claims', '{"sub":"938092a5-992b-41ce-bc85-cee649333e92","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
EXPLAIN (ANALYZE, TIMING OFF, SUMMARY ON, FORMAT TEXT, COSTS OFF)
SELECT count(*) FROM public.search_invoices_advanced(
  '7f3a9c21-5b4e-4d8a-9e12-6c0d3b8a5f47'::uuid, 'sale', NULL, NULL, NULL, NULL, NULL, NULL, 500, 0);
ROLLBACK;`);
  console.log('\n--- EXPLAIN ANALYZE as authenticated ---');
  console.log(r.status, r.text.slice(0, 3000));

  // Long-running / idle-in-transaction sessions and locks
  r = await query(`
    SELECT pid, state, wait_event_type, now()-xact_start AS xact_age, left(query, 90) AS q
    FROM pg_stat_activity WHERE state <> 'idle' AND pid <> pg_backend_pid()
    ORDER BY xact_start NULLS LAST LIMIT 20;`);
  console.log('\n--- active sessions ---');
  console.log(r.status, r.text.slice(0, 3000));

  r = await query(`SELECT current_setting('session_replication_role') AS srr;`);
  console.log('\n--- session_replication_role on this connection ---');
  console.log(r.status, r.text.slice(0, 300));

  r = await query(`
    SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_vacuum
    FROM pg_stat_user_tables WHERE relname IN ('invoices','invoice_items','journal_entry_lines');`);
  console.log('\n--- table stats ---');
  console.log(r.status, r.text.slice(0, 1500));
}

main().catch(e => { console.error(e); process.exit(1); });
