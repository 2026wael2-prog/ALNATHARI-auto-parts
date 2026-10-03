import fs from 'node:fs';

// Prefer env var so the secret is never written to disk; fall back to the CLI token file.
const token = (process.env.SUPABASE_ACCESS_TOKEN
  ?? (fs.existsSync(process.env.USERPROFILE + '/.supabase/access-token')
    ? fs.readFileSync(process.env.USERPROFILE + '/.supabase/access-token', 'utf8').trim()
    : null));
if (!token) throw new Error('No Supabase access token. Set SUPABASE_ACCESS_TOKEN.');
const projectRef = 'gvjmpgxdmekjsgzhlzzz';

async function query(sql, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Query failed: ${res.status} ${text}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === retries) throw err;
      console.log(`[retry ${attempt}/${retries}] ${err.message}`);
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

const results = {};
const SALES = `i.type = 'sale' AND i.deleted_at IS NULL`;

async function step(label, sql) {
  console.log(`\n--- ${label} ---`);
  try {
    const rows = await query(sql);
    results[label] = rows;
    console.table(rows.slice ? rows.slice(0, 12) : rows);
    return rows;
  } catch (e) {
    results[label] = { error: e.message };
    console.log('ERROR:', e.message);
    return null;
  }
}

async function main() {
  // Consolidated findings: every flagged sales invoice with its contradiction class
  const rows = await query(`
    WITH ledger AS (
      SELECT je.reference_id,
             sum(jel.foreign_amount) FILTER (WHERE jel.debit_amount > 0) AS fa,
             max(jel.currency_code) AS lcur
      FROM public.journal_entries je
      JOIN public.journal_entry_lines jel ON jel.journal_entry_id = je.id
      WHERE je.reference_type='sales_invoice'
      GROUP BY je.reference_id
    )
    SELECT i.invoice_number, i.issue_date, i.currency_code, i.exchange_rate,
           i.total_amount AS base_sar, i.total_document_amount AS doc_amount,
           l.fa AS ledger_foreign, l.lcur AS ledger_currency,
           CASE
             WHEN i.currency_code='OMR' THEN 'E_OMR_should_be_YER'
             WHEN i.currency_code='YER' AND i.exchange_rate > 0.02 AND i.exchange_rate < 1 THEN 'F_absurd_rate'
             WHEN i.currency_code='YER' AND coalesce(i.total_document_amount,0) > 0
                  AND i.total_document_amount < 1000 THEN 'C_tiny_YER_implausible'
             WHEN i.currency_code='YER' AND coalesce(i.exchange_rate,0) > 0
                  AND coalesce(i.total_document_amount,0) > 0
                  AND abs(i.total_document_amount - i.total_amount/i.exchange_rate) > greatest(1, i.total_document_amount*0.01)
                  AND abs(i.total_document_amount - i.total_amount*i.exchange_rate) > greatest(1, i.total_document_amount*0.01)
                  THEN 'A_YER_rate_doc_mismatch'
             WHEN i.currency_code='SAR' AND i.total_amount >= 50000 THEN 'B_SAR_huge_maybe_YER'
           END AS finding
    FROM public.invoices i
    LEFT JOIN ledger l ON l.reference_id = i.id
    WHERE i.type='sale' AND i.deleted_at IS NULL
      AND (
        (i.currency_code='OMR')
        OR (i.currency_code='YER' AND i.exchange_rate > 0.02 AND i.exchange_rate < 1)
        OR (i.currency_code='YER' AND coalesce(i.total_document_amount,0) > 0 AND i.total_document_amount < 1000)
        OR (i.currency_code='YER' AND coalesce(i.exchange_rate,0) > 0 AND coalesce(i.total_document_amount,0) > 0
            AND abs(i.total_document_amount - i.total_amount/i.exchange_rate) > greatest(1, i.total_document_amount*0.01)
            AND abs(i.total_document_amount - i.total_amount*i.exchange_rate) > greatest(1, i.total_document_amount*0.01))
        OR (i.currency_code='SAR' AND i.total_amount >= 50000)
      )
    ORDER BY finding, i.invoice_number;`);

  // Summary counts by class
  const summary = {};
  for (const r of rows) summary[r.finding] = (summary[r.finding] || 0) + 1;
  console.log('--- FINDINGS BY CLASS ---');
  console.table(Object.entries(summary).map(([finding, count]) => ({ finding, count })));
  console.log('TOTAL flagged invoices:', rows.length);

  // CSV export
  const header = ['finding','invoice_number','issue_date','currency_code','exchange_rate',
                  'base_sar','doc_amount','ledger_foreign','ledger_currency'];
  const csv = [
    header.join(','),
    ...rows.map(r => header.map(h => (r[h] ?? '')).join(','))
  ].join('\n');
  const { writeFileSync } = await import('node:fs');
  writeFileSync('sales_currency_findings.csv', '\uFEFF' + csv, 'utf8'); // BOM for Excel Arabic
  writeFileSync('sales_currency_findings_summary.json', JSON.stringify(summary, null, 2), 'utf8');
  console.log('Saved -> sales_currency_findings.csv , sales_currency_findings_summary.json');
}

main().catch(e => { console.error(e); process.exit(1); });

