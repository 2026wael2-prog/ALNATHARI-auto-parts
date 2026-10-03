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
  let r = await query(`
    SELECT pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='search_invoices_advanced';`);
  const def = JSON.parse(r.text)[0]?.def ?? '';
  fs.writeFileSync('scripts/_rpc_definition.sql', def, 'utf8');
  console.log('--- function source saved to scripts/_rpc_definition.sql, chars =', def.length);
  console.log(def.slice(0, 2600));

  r = await query(`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename IN ('invoice_items','invoices')
    ORDER BY tablename, indexname;`);
  console.log('\n--- indexes on invoices / invoice_items ---');
  console.log(r.status, r.text.slice(0, 3000));

  r = await query(`
EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON, FORMAT TEXT, COSTS OFF)
SELECT id, item_count, total_matching_count
FROM public.search_invoices_advanced(
  '7f3a9c21-5b4e-4d8a-9e12-6c0d3b8a5f47'::uuid, 'sale', NULL, NULL, NULL, NULL, NULL, NULL, 500, 0);`);
  console.log('\n--- EXPLAIN ANALYZE of the real call (limit 500) ---');
  console.log(r.status, r.text.slice(0, 6000));
}

main().catch(e => { console.error(e); process.exit(1); });
