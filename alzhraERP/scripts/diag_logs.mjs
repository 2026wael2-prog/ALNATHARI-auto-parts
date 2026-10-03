import fs from 'node:fs';

const token = (process.env.SUPABASE_ACCESS_TOKEN
  ?? (fs.existsSync(process.env.USERPROFILE + '/.supabase/access-token')
    ? fs.readFileSync(process.env.USERPROFILE + '/.supabase/access-token', 'utf8').trim()
    : null));
if (!token) throw new Error('No Supabase access token.');
const projectRef = 'gvjmpgxdmekjsgzhlzzz';

async function logs(sql) {
  const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status, text: await res.text() };
}

async function main() {
  const sqls = [
    `select timestamp, event_message from postgres_logs order by timestamp desc limit 5`,
    `select timestamp, event_message from postgres_logs where event_message ilike '%search_invoices_advanced%' order by timestamp desc limit 10`,
    `select timestamp, event_message from postgres_logs where event_message ilike '%ERROR%' or event_message ilike '%500%' order by timestamp desc limit 20`,
    `select timestamp, event_message from edge_logs order by timestamp desc limit 3`,
  ];
  for (const sql of sqls) {
    const url = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    console.log('\n---', sql.slice(0, 95), '->', res.status);
    console.log((await res.text()).slice(0, 4000));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
