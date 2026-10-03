/**
 * verify_search_rpc_rewrite.mjs
 * ---------------------------------------------------------------
 * يتحقق أن هجرة 20261003000001 لا تُغيّر أي مخرج، وأنها تُسرّع الاستدعاء.
 * يعمل بمراحل منفصلة (لأن كل أمر محدود بـ30 ثانية):
 *
 *   PHASE=create   → ينشئ public.search_invoices_advanced_v2 من ملف الهجرة
 *   PHASE=compare  → يقارن المخرجات حرفياً (jsonb) قبل/بعد لكل المعاملات
 *   PHASE=timing   → يقيس EXPLAIN ANALYZE للأثنتين
 *   PHASE=apply    → يطبّق الهجرة على الدالة الحيّة + إعادة تحميل مخطط PostgREST
 *   PHASE=drop     → يحذف النسخة المؤقتة _v2
 *
 * التشغيل:
 *   $env:SUPABASE_ACCESS_TOKEN='...'; node scripts/verify_search_rpc_rewrite.mjs      (كل المراحل)
 *   $env:PHASE='create'; node scripts/verify_search_rpc_rewrite.mjs
 */
import fs from 'node:fs';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) throw new Error('SUPABASE_ACCESS_TOKEN مفقود.');
const projectRef = 'gvjmpgxdmekjsgzhlzzz';
const COMPANY = '7f3a9c21-5b4e-4d8a-9e12-6c0d3b8a5f47';
const MIGRATION = 'supabase/migrations/20261003000001_optimize_search_invoices_advanced_window.sql';
const FN_V1 = 'search_invoices_advanced';
const FN_V2 = 'search_invoices_advanced_v2';
const SIG = '(uuid,text,text,date,date,text,text,uuid,integer,integer)';
const PHASE = (process.env.PHASE ?? 'all').toLowerCase();

async function query(sql, attempt = 1) {
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    });
    const text = await res.text();
    if (res.status >= 400) throw new Error(`SQL ${res.status}: ${text.slice(0, 700)}`);
    return JSON.parse(text);
  } catch (e) {
    const transient = /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|ENOTFOUND|EAI_AGAIN/i.test(e.message);
    if (transient && attempt < 4) {
      const wait = attempt * 2000;
      console.warn(`[net] محاولة ${attempt} فشلت (${e.message}) — إعادة المحاولة بعد ${wait}ms`);
      await new Promise(r => setTimeout(r, wait));
      return query(sql, attempt + 1);
    }
    throw e;
  }
}

const q = v => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const call = (fn, p) =>
  `public.${fn}(${q(COMPANY)}::uuid, ${q(p.type)}, ${q(p.query)}, ${q(p.dateFrom)}, ${q(p.dateTo)}, ` +
  `${q(p.status)}, ${q(p.payment)}, NULL, ${p.limit}, ${p.offset})`;

const readMigration = () => {
  const raw = fs.readFileSync(MIGRATION, 'utf8');
  const createOnly = raw.split('COMMENT ON FUNCTION')[0].trim();
  if (!createOnly.includes('CREATE OR REPLACE FUNCTION')) throw new Error('ملف الهجرة لا يحتوي CREATE FUNCTION.');
  return { createOnly, full: raw };
};

async function createV2() {
  const { createOnly } = readMigration();
  const v2sql = createOnly.replace(`public.${FN_V1}(`, `public.${FN_V2}(`);
  if (!v2sql.includes(FN_V2)) throw new Error('فشل إنتاج نسخة _v2.');
  await query(`DROP FUNCTION IF EXISTS public.${FN_V2}${SIG};`);
  await query(v2sql);
  console.log(`[OK] أُنشئت ${FN_V2} من ملف الهجرة نفسه.`);
}

async function sample() {
  const [s] = await query(`
    SELECT (SELECT status FROM public.invoices WHERE company_id='${COMPANY}' AND deleted_at IS NULL LIMIT 1) AS status,
           (SELECT payment_method FROM public.invoices WHERE company_id='${COMPANY}' AND deleted_at IS NULL AND payment_method IS NOT NULL LIMIT 1) AS payment,
           (SELECT issue_date FROM public.invoices WHERE company_id='${COMPANY}' AND deleted_at IS NULL ORDER BY issue_date DESC LIMIT 1) AS max_date,
           (SELECT issue_date FROM public.invoices WHERE company_id='${COMPANY}' AND deleted_at IS NULL ORDER BY issue_date ASC LIMIT 1) AS min_date,
           (SELECT invoice_number FROM public.invoices WHERE company_id='${COMPANY}' AND deleted_at IS NULL ORDER BY issue_date DESC LIMIT 1) AS num_prefix;`);
  return s;
}

const CASES = s => ([
  { name: 'بيع بلا فلاتر (500)', type: 'sale', query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 500, offset: 0 },
  { name: 'بيع بكامل المدى الزمني', type: 'sale', query: null, dateFrom: s.min_date, dateTo: s.max_date, status: null, payment: null, limit: 500, offset: 0 },
  { name: `بيع بحالة ${s.status}`, type: 'sale', query: null, dateFrom: null, dateTo: null, status: s.status, payment: null, limit: 500, offset: 0 },
  { name: `بيع بدفع ${s.payment}`, type: 'sale', query: null, dateFrom: null, dateTo: null, status: null, payment: s.payment, limit: 500, offset: 0 },
  { name: 'بيع offset=500', type: 'sale', query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 500, offset: 500 },
  { name: `بحث برقم "${s.num_prefix}"`, type: 'sale', query: s.num_prefix, dateFrom: null, dateTo: null, status: null, payment: null, limit: 200, offset: 0 },
  { name: 'مشتريات (100)', type: 'purchase', query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 100, offset: 0 },
  { name: 'بلا نوع (25)', type: null, query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 25, offset: 0 },
]);

async function compare() {
  const s = await sample();
  console.log('[sample]', JSON.stringify(s));
  let allSame = true;
  const from = Number(process.env.CASE_FROM ?? 0);
  const to = Number(process.env.CASE_TO ?? 999);
  const batch = CASES(s).slice(from, to);
  console.log(`[batch] الحالات ${from}..${to - 1} (${batch.length} حالة)`);
  for (const c of batch) {
    const sql = `
      WITH a AS MATERIALIZED (SELECT * FROM ${call(FN_V1, c)}),
           b AS MATERIALIZED (SELECT * FROM ${call(FN_V2, c)})
      SELECT (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM a)
             IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(b) ORDER BY b.id) FROM b) AS same_set,
             (SELECT jsonb_agg(to_jsonb(a)) FROM a)
             IS NOT DISTINCT FROM (SELECT jsonb_agg(to_jsonb(b)) FROM b) AS same_order,
             (SELECT count(*) FROM a) AS rows_v1,
             (SELECT count(*) FROM b) AS rows_v2,
             (SELECT max(total_matching_count) FROM a) AS total_v1,
             (SELECT max(total_matching_count) FROM b) AS total_v2;`;
    const [row] = await query(sql);
    const ok = row.same_set === true && row.rows_v1 === row.rows_v2 && row.total_v1 === row.total_v2;
    allSame = allSame && ok;
    console.log(
      `${ok ? 'IDENTICAL' : '*** DIFFERENT ***'} | ${c.name} | rows ${row.rows_v1}/${row.rows_v2} | ` +
      `total ${row.total_v1}/${row.total_v2} | نفس المجموعة=${row.same_set} نفس الترتيب=${row.same_order}`
    );
  }
  console.log(`\nالخلاصة: ${allSame ? 'كل المخرجات متطابقة (نفس الصفوف ونفس العدّ الكلي)' : 'يوجد اختلاف — لا تُطبَّق الهجرة'}`);
  if (!allSame) process.exit(2);
}

async function timing() {
  const base = { type: 'sale', query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 500, offset: 0 };
  for (const fn of [FN_V1, FN_V2]) {
    const plan = await query(
      `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, SUMMARY ON, COSTS OFF, FORMAT TEXT) SELECT * FROM ${call(fn, base)};`
    );
    const lines = plan.map(r => r['QUERY PLAN']);
    console.log(`${fn.padEnd(32)} ${lines.find(l => l.includes('Execution Time'))?.trim()} | ${lines.find(l => l.includes('Buffers:'))?.trim()}`);
  }
}

async function apply() {
  const { full } = readMigration();
  await query(full.trim());
  console.log('[OK] طُبّقت الهجرة على الدالة الحيّة.');
  const r = await query(`NOTIFY pgrst, 'reload schema';`);
  console.log('[OK] NOTIFY pgrst reload schema ->', JSON.stringify(r));
}

async function dropV2() {
  await query(`DROP FUNCTION IF EXISTS public.${FN_V2}${SIG};`);
  console.log(`[OK] حُذفت ${FN_V2}.`);
}

async function inspect() {
  const [row] = await query(`
    SELECT position('page_invoice_id' in prosrc) > 0 AS is_new_version,
           position('COUNT(*) OVER()' in prosrc) > 0 AS still_has_window,
           (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='${FN_V1}') AS overloads,
           (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='${FN_V2}') AS v2_leftover
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='${FN_V1}'
    LIMIT 1;`);
  console.log('[inspect]', JSON.stringify(row));
}

async function rolecheck() {
  const USER = '938092a5-992b-41ce-bc85-cee649333e92';
  const base = { type: 'sale', query: null, dateFrom: null, dateTo: null, status: null, payment: null, limit: 500, offset: 0 };
  const r = await query(`
    BEGIN;
    SET LOCAL ROLE authenticated;
    SET LOCAL statement_timeout = '8s';
    SET LOCAL request.jwt.claims = '{"sub":"${USER}","role":"authenticated","aud":"authenticated"}';
    SET LOCAL request.jwt.claim.sub = '${USER}';
    CREATE TEMP TABLE _rc ON COMMIT PRESERVE ROWS AS
      SELECT count(*) AS rows_returned,
             max(total_matching_count) AS total_matching,
             round(extract(epoch FROM (clock_timestamp() - now())) * 1000) AS ms_db
      FROM ${call(FN_V1, base)};
    COMMIT;
    SELECT * FROM _rc;`);
  console.log('[rolecheck authenticated @8s timeout]', JSON.stringify(r));
}

async function main() {
  if (PHASE === 'create' || PHASE === 'all') await createV2();
  if (PHASE === 'compare' || PHASE === 'all') await compare();
  if (PHASE === 'timing' || PHASE === 'all') await timing();
  if (PHASE === 'apply') await apply();
  if (PHASE === 'inspect' || PHASE === 'all') await inspect();
  if (PHASE === 'rolecheck' || PHASE === 'all') await rolecheck();
  if (PHASE === 'drop' || PHASE === 'all') await dropV2();
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
