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
  // A) Does SET ROLE actually apply the role-level statement_timeout in SQL context?
  let r = await query(`
BEGIN;
SET LOCAL ROLE authenticated;
SELECT current_setting('statement_timeout') AS effective_statement_timeout,
       current_user AS effective_role;
ROLLBACK;`);
  console.log('--- A) timeout when SET LOCAL ROLE authenticated ---');
  console.log(r.status, r.text.slice(0, 600));

  // B) Would the production call survive an 8s statement_timeout?
  r = await query(`
BEGIN;
SET LOCAL statement_timeout = '8s';
SELECT set_config('request.jwt.claims', '{"sub":"938092a5-992b-41ce-bc85-cee649333e92","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS rows_returned FROM public.search_invoices_advanced(
  '7f3a9c21-5b4e-4d8a-9e12-6c0d3b8a5f47'::uuid, 'sale', NULL, NULL, NULL, NULL, NULL, NULL, 500, 0);
ROLLBACK;`);
  console.log('\n--- B) production call under an 8s timeout ---');
  console.log(r.status, r.text.slice(0, 800));

  // C) Plan + exit: is the RPC's plan re-created for every fresh connection?
  r = await query(`SELECT count(*) AS prepared_from_rpc FROM pg_prepared_statements;`);
  console.log('\n--- C) prepared statements visible ---');
  console.log(r.status, r.text.slice(0, 400));
}

main().catch(e => { console.error(e); process.exit(1); });
