/**
 * verify_invoice_display.ts
 * ---------------------------------------------------------------
 * «تحقّق مرئي» رقمي للفاتورة: يقرأ الفاتورة وبنودها وأطراف قيدها من قاعدة
 * الإنتاج، ثم يعرض **نفس النصوص التي ترسمها الواجهة** عبر دوال
 * `src/core/utils/documentMoney`. قراءة فقط — لا يعدّل شيئاً.
 *
 * التشغيل:
 *   $env:SUPABASE_SERVICE_ROLE_KEY='<service_role>'; $env:INV='64262'; npx tsx scripts/verify_invoice_display.ts
 *
 * يُقرأ رابط المشروع تلقائياً من VITE_SUPABASE_URL في ملف .env
 * (أو مرّره صريحاً: $env:SUPABASE_URL).
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  formatBaseAmount,
  formatDocumentAmount,
  formatDocumentTotal,
  formatDocumentWithBase,
} from '../src/core/utils/documentMoney';

const ROOT = path.resolve(import.meta.dirname, '..');

const readDotEnv = (): Record<string, string> => {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
};

const dotenv = readDotEnv();
const url = (process.env.SUPABASE_URL ?? dotenv.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const INV = process.env.INV ?? '64262';

if (url === '') throw new Error('SUPABASE_URL مفقود (أو VITE_SUPABASE_URL في .env).');
if (key === '') {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY مفقود — مرّره كمتغيّر بيئة (لا تكتبه في ملف).');
}

interface InvoiceRow {
  id: string;
  invoice_number: string;
  issue_date: string;
  status: string;
  payment_method: string | null;
  currency_code: string | null;
  exchange_rate: number | null;
  total_amount: number | null;
  subtotal: number | null;
  total_document_amount: number | null;
  subtotal_document_amount: number | null;
  party_id: string | null;
}

interface LedgerLine {
  debit_amount: number;
  credit_amount: number;
  currency_code: string | null;
  exchange_rate: number | null;
  foreign_amount: number | null;
  description: string | null;
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };

async function rest<T>(endpoint: string): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${endpoint}`, { headers });
  const text = await res.text();
  if (res.status >= 400) throw new Error(`REST ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const invoices = await rest<InvoiceRow[]>(
    `invoices?select=*&invoice_number=ilike.*${encodeURIComponent(INV)}*&limit=1`
  );
  const inv = invoices[0];
  if (!inv) throw new Error(`لا توجد فاتورة مطابقة لـ ${INV}`);

  const items = await rest<
    Array<{ description: string | null; quantity: number; unit_price: number; total: number }>
  >(`invoice_items?select=description,quantity,unit_price,total&invoice_id=eq.${inv.id}&order=id`);

  const entries = await rest<Array<{ id: string }>>(
    `journal_entries?select=id&reference_id=eq.${inv.id}&reference_type=eq.sales_invoice`
  );
  const lines =
    entries.length === 0
      ? []
      : await rest<LedgerLine[]>(
          `journal_entry_lines?select=debit_amount,credit_amount,currency_code,exchange_rate,foreign_amount,description` +
            `&journal_entry_id=in.(${entries.map(e => e.id).join(',')})&order=debit_amount.desc`
        );

  const party = inv.party_id
    ? (await rest<Array<{ name: string }>>(`parties?select=name&id=eq.${inv.party_id}`))[0]
    : undefined;

  console.log(`\n═══ ${inv.invoice_number} ═══`);
  console.log(`التاريخ         : ${inv.issue_date} · ${inv.status} · ${inv.payment_method ?? '-'}`);
  console.log(`العميل          : ${party?.name ?? '-'}`);
  console.log(`العملة والسعر   : ${inv.currency_code} @ ${inv.exchange_rate}`);

  console.log('\n── المخزَّن في القاعدة ──');
  console.log(`total_amount (أساس SAR)         : ${inv.total_amount}`);
  console.log(`total_document_amount (المستند) : ${inv.total_document_amount}`);
  console.log(`subtotal_document_amount        : ${inv.subtotal_document_amount}`);

  console.log('\n── ما يرسمه الكود الحالي في الواجهة ──');
  console.log(`«المبلغ الإجمالي» : ${formatDocumentWithBase(inv)}`);
  console.log(`«الصافي النهائي»  : ${formatDocumentTotal(inv)}`);
  console.log(
    `«مجموع البنود»    : ${formatDocumentAmount(
      inv.subtotal ?? inv.total_amount,
      inv.currency_code,
      inv.exchange_rate
    )}`
  );
  console.log(`معادل الأساس      : ${formatBaseAmount(inv.total_amount)}`);
  for (const it of items) {
    console.log(
      `  • ${(it.description ?? '').slice(0, 58)} | كمية ${it.quantity}` +
        ` | سعر ${formatDocumentAmount(it.unit_price, inv.currency_code, inv.exchange_rate)}` +
        ` | إجمالي ${formatDocumentAmount(it.total, inv.currency_code, inv.exchange_rate)}`
    );
  }

  console.log('\n── أطراف القيد المحاسبي ──');
  for (const l of lines) {
    console.log(
      `  مدين ${l.debit_amount} / دائن ${l.credit_amount} · ${l.currency_code} @ ${l.exchange_rate}` +
        ` · foreign ${l.foreign_amount} · ${(l.description ?? '').slice(0, 46)}`
    );
  }

  const ledgerForeign = lines.find(l => Number(l.debit_amount) > 0)?.foreign_amount ?? null;
  const doc = Number(inv.total_document_amount ?? 0);
  console.log(
    '\n' +
      (ledgerForeign == null
        ? '⚠️ لا يوجد قيد مرتبط — تعذّرت المطابقة'
        : Math.abs(Number(ledgerForeign) - doc) < 0.01
          ? `✅ مبلغ المستند (${doc}) مطابق لطرف القيد بعملة الفاتورة (${ledgerForeign})`
          : `⚠️ فرق: مبلغ المستند ${doc} مقابل القيد ${ledgerForeign}`)
  );
  console.log(
    '\n⚠️ أي رقم مخالف لما أعلاه في شاشتك = نسخة عميل قديمة (بناء/كاش) — أعد التحميل بقوة (Ctrl+Shift+R).\n'
  );
}

await main();
