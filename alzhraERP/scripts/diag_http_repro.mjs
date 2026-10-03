import fs from 'node:fs';

const token = (process.env.SUPABASE_ACCESS_TOKEN
  ?? (fs.existsSync(process.env.USERPROFILE + '/.supabase/access-token')
    ? fs.readFileSync(process.env.USERPROFILE + '/.supabase/access-token', 'utf8').trim()
    : null));
if (!token) throw new Error('No Supabase access token.');
const projectRef = 'gvjmpgxdmekjsgzhlzzz';

const rpcUrl = `https://${projectRef}.supabase.co/rest/v1/rpc/search_invoices_advanced`;
const base = {
  p_company_id: '7f3a9c21-5b4e-4d8a-9e12-6c0d3b8a5f47',
  p_type: 'sale',
  p_limit: 5,
  p_offset: 0,
};

async function call(anon, key, body, label) {
  const t0 = Date.now();
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        apikey: anon,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    const ms = Date.now() - t0;
    const kb = (Buffer.byteLength(text) / 1024).toFixed(1);
    const detail = r.status === 200 ? '' : `  <-- ${text.slice(0, 300)}`;
    console.log(`${label.padEnd(26)} ${r.status}  ${String(ms).padStart(6)}ms  ${kb.padStart(8)}KB${detail}`);
  } catch (e) {
    console.log(`${label.padEnd(26)} NETWORK FAIL after ${Date.now() - t0}ms: ${e.message} / ${e.cause?.message ?? ''}`);
  }
}

async function main() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const keys = await res.json();
  const anon = keys.find(k => k.name === 'anon')?.api_key;
  const service = keys.find(k => k.name === 'service_role')?.api_key;
  console.log('anon:', Boolean(anon), '| service_role:', Boolean(service));
  console.log('--- exact production call, repeated ---');
  const t0 = Date.now();
  for (let i = 1; i <= 5; i++) await call(anon, service, { ...base, p_limit: 500 }, `sale limit=500 #${i}`);
  console.log(`--- burst of 5 finished in ${Date.now() - t0}ms ---`);
  for (let i = 1; i <= 2; i++) await call(anon, service, { ...base, p_limit: 25 }, `sale limit=25 #${i}`);
}

main().catch(e => { console.error(e); process.exit(1); });
