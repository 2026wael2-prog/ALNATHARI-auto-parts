# مراجعة دقيقة وعميقة — ALNATHARI Auto Parts (نظام الزهراء الذكي ERP)

**تاريخ المراجعة:** 2026-10-02
**النطاق:** `alzhraERP/` — 1,278 ملف `.ts/.tsx`، 227 هجرة SQL، 15 دالة حافة (Deno)، 29 قسم ميزات، 139 ملف اختبار.
**الطريقة:** ستة تدقيقات متوازية (أمان/RLS، محاسبة، تزامن وسلامة بيانات، واجهة عامة، مسارات تجارية وتغطية اختبارات، UI/UX ونشر) + **تحقّق مباشر على قاعدة البيانات الحيّة** (قراءة فقط: SELECT / GET) + تشغيل بوابات الجودة فعلياً.
**القيد:** لم يُعدَّل أي ملف من التطبيق. كل بند موسوم: **[مؤكَّد]** = تحقّقت منه بنفسي في الكود أو على القاعدة الحيّة، **[مُبلَّغ]** = من التدقيق العميق بدليل `path:line` لم أُعِد فحصه سطرياً.

---

## ملخّص تنفيذي

النظام **ليس مشروعاً مبتدئاً**: العزل بين المستأجرين مبني بعمق (187/187 جدولاً عليها RLS وسياسات فعّالة)، ومحرك القيود المحاسبية يفرض توازن مدين/دائن على مستوى قاعدة البيانات، والأنواع صفرية الأخطاء (`tsc --noEmit` = 0)، و1,037 اختبار وحدة تمرّ كلها.

لكن المراجعة كشفت **فجوة منهجية واحدة كبيرة** تشرح معظم المشكلات: *ما هو منشور فعلاً ≠ ما هو مكتوب في المستودع ≠ ما هو موثَّق في أدلة المشروع*. ثلاث طبقات تتباعد:

| الطبقة | الحالة |
|---|---|
| **قاعدة البيانات الحيّة** | مُستعادة من نسخة بتاريخ 2026-09-18 (آخر فاتورة `created_at = 2026-09-18`)، **وبلا سجل هجرات** (`supabase_migrations.schema_migrations` غير موجود)، وتحتوي كائنات لا تُنتجها أي هجرة في المستودع (`report_balance_sheet_detailed`)، وتنقصها كائنات تُنتجها الهجرات |
| **المستودع** | 227 هجرة تُعيد تعريف نفس الدوال عدة مرات بأجسام متعارضة، وبعضها (20260916000014) يُعيد إدخال أخطاء أُصلحت قبله، وترتيب التطبيق غير قابل للتكرار |
| **الأدلة** (`docs/`, `AGENTS.md`) | تُعلن التزامات (منع تكرار الأسماء/الهواتف، COGS معزول، لا مخزون سالب، أهداف لمس 44px) **لا تصحّ فعلياً** — وهي بالضبط أهم ما يجب تصحيحه لأنه يُبنى عليه قرارات |

**أخطر خمسة بنود (كلها مؤكَّدة حيّاً):**

1. 🔴 `party_balances` و`party_balances_by_currency` — **مقروءان بمفتاح `anon` العام**: سحب 1,829 صفاً لأرصدة العملاء/الموردين بلا مصادقة (بينما كل الجداول الأخرى محجوبة).
2. 🔴 `cleanup_old_records()` و`fn_release_payment_allocations()` — ممنوحتان لـ`authenticated` **بلا أي حارس منشأة**: أي مستخدم عادي (حتى `viewer`) يمحو سجل تدقيق 90 يوماً لكل المنشآت، أو يُبطل مقاصّات دفع فاتورة أي منشأة.
3. 🔴 `debt-reminder-dispatch` يفكّ حمولة JWT **دون التحقق من التوقيع** → انتحال `service_role` مجّاناً، ثم إرسال مطالبات بكل المنشآت بمفاتيح SMS/WhatsApp الخاصة بمستأجرين مدفوعين.
4. 🔴 المصروفات التشغيلية تُرحَّل افتراضياً إلى **5100 تكلفة البضاعة المباعة** → مجمل الربح ينخفض والمصروفات التشغيلية تنقص بنفس المبلغ.
5. 🔴 ترقيم فواتير الشراء يمرّر `'PUR'` بينما المخزَّن `'purchase'` → الرقم دائماً «1» → ثاني فاتورة شراء بلا رقم مورّد تُرفض بـ`23505`؛ والمرتجعات كذلك (`'RPR'`/`'RSL'`).

**إضافة إلى 3 حقائق تشغيلية حرجة:** لا توجد **أي دلو تخزين** (`storage.buckets = 0`) ⇒ كل الرفع والمرفقات معطّل في الإنتاج؛ ولا يوجد **CI** (`.github` غير موجود) و`pre-push` لا يشغّل الاختبارات ولا `type-check`؛ وسقف ESLint المتسامح **9,478 خطأ**.

---

## 1. منهجية التحقّق الحيّ (قابل للتكرار)

نُفِّذت كل الاستعلامات على قاعدة المشروع `gvjmpgxdmekjsgzhlzzz` عبر Management API وPostgREST، **قراءةً فقط** (`SELECT`/`GET`، وبـ`limit=0` حيث لا يلزم سحب بيانات):

| الفحص | النتيجة الفعلية |
|---|---|
| عدد الجداول / عليها RLS | **187 / 187** — ولا جدول واحد بلا RLS، ولا جدول مُفعَّل عليه RLS بلا سياسة |
| `party_balances` بمفتاح `anon` | **HTTP 200 + 1,829 صفاً** (بلا أي فلتر) ← تسريب مؤكَّد |
| بقية الـviews (27) | `security_invoker=true` ⇒ HTTP 401/0 صفوف ← سليمة |
| `invoices` / `parties` / `journal_entries` بمفتاح `anon` | HTTP 401 (محجوبة) |
| `storage.buckets` / `storage.objects` | **0 / 0** ← لا تخزين |
| قيود `product_stock` | **لا يوجد `product_stock_quantity_check`** ولا trigger `trg_prevent_negative_stock` ← المخزون السالب مسموح فعلاً |
| `fn_release_payment_allocations` / `cleanup_old_records` / `ensure_vehicle` / `security_alert` / `incentive_detect_...` | `authenticated=X` (ومسحوبة من `anon`/`PUBLIC` — خلافاً لما استنتجه التدقيق من الكود) |
| `generate_invoice_number` | تحميل واحد فقط: `(uuid, text, uuid)` — النسخة المُصلَحة (النسخة القديمة ذات المعاملين **غير موجودة حيّاً**) |
| `commit_purchase_invoice` | تحميل واحد فقط: 14 معاملاً (مع `p_paid_amount`) — نسخة الـ13 معاملاً **غير موجودة حيّاً** |
| `report_balance_sheet_detailed` | **موجودة حيّاً** `(uuid, date, uuid)` ولا تُنشئها أي هجرة في المستودع ← انزياح مؤكَّد |
| `supabase_migrations.schema_migrations` | **غير موجود** ← لا سجل هجرات |
| بيانات الفواتير | 64,631 فاتورة، **شركة واحدة**، آخرها 2026-09-18، وأرقامها بصيغة قديمة `2-مبيع:64316` (لا `INV-` ولا رقمية بحتة) |
| `tsc --noEmit` | **0 خطأ** |
| `eslint . --max-warnings 0` | **9,692 مشكلة (9,478 خطأ، 214 تحذير)** — والسقف المرجعي 9,616 ⇒ البوابة تمرّ والـlint يفشل |
| `vitest run` | **139 ملف / 1,037 اختبار — كلها تمرّ** (834 ثانية) |
| `check:fonts` / `check:classes` / `check:layers` / `check:encoding` / `validate:barrels` | كلها ✅ (لكن انظر §5: ثلاث منها أضيق من القاعدة التي تزعم حمايتها) |

**نتيجتان مهمتان للإنصاف:** (أ) ادعاء «`anon` يستطيع استدعاء `ensure_vehicle`/`incentive_detect_...`» **غير صحيح** على القاعدة الحيّة — صلاحياتها مسحوبة من `anon`/`PUBLIC` فعلاً. (ب) ادعاء «تحميلان متزامنان لـ`commit_purchase_invoice` والعميل يختار الأقدم» **غير صحيح حيّاً** — التحميل القديم غير موجود. هذان البندان كانا استنتاجاً من الكود، والتحقّق الحيّ أسقطهما.

---

## 2. 🔴 حرج (P0) — يُصلَح قبل أي شيء

### P0-1 — تسريب أرصدة العملاء/الموردين لكل المنشآت بمفتاح `anon` العام **[مؤكَّد حيّاً]**

**الدليل:** `GET https://<project>.supabase.co/rest/v1/party_balances?select=*` بترويسة `apikey: <anon>` ⇒ **HTTP 200 + 1,829 صفاً** `{party_id, company_id, type, balance}`. وبالمقابل `invoices` و`parties` تُرجع 401.

**السبب الجذري:** `ALTER VIEW public.party_balances SET (security_invoker = false);` — في [20260918000003:84](alzhraERP/supabase/migrations/20260918000003_fix_party_balances_and_report_account_balances_timeouts.sql#L84) — وحيّاً `reloptions = (none)` أي أن العرض يعمل بامتيازات مالكه (يتجاوز RLS). وكل الـviews الأخرى في المخطط (27 عرضاً) تحمل `security_invoker=true` فتُرجع صفر صفوف ← **هذان العرضان وحدهما استثناء**.

**تعقيد إضافي:** المستودع يحوي `REVOKE SELECT ... FROM anon` (في [20260919000004](alzhraERP/supabase/migrations/20260919000004_revoke_anon_on_party_balance_views.sql)) لكن **القاعدة الحيّة لم تستقبل ذلك**: ACL الفعلي هو `anon=arwdDxtm | authenticated=arwdDxtm` — أي صلاحيات كاملة. وهذا دليل مباشر على أن بعض هجرات الإصلاح لم تُطبَّق أبداً.

**الأثر:** مفتاح `anon` **عام بطبيعته** ويُشحن في حزمة المتصفح. أي شخص على الإنترنت — بلا حساب — يستطيع سحب صورة الذمم الكاملة للمنشأة (هوية كل عميل/مورد + رصيده)، وتكرار السحب مع الوقت. تسريب مالي/تجاري مباشر، وهو في نظام متعدد المنشآت يعني كل مستأجر.

**الإصلاح (هجرة جديدة):**
```sql
ALTER VIEW public.party_balances SET (security_invoker = true);
ALTER VIEW public.party_balances_by_currency SET (security_invoker = true);
REVOKE ALL ON public.party_balances, public.party_balances_by_currency FROM anon, authenticated;
GRANT SELECT ON public.party_balances, public.party_balances_by_currency TO authenticated; -- بعد security_invoker
-- وإذا احتُفظ بالوصول: أضف فلتراً صريحاً
-- WHERE company_id IN (SELECT public.get_auth_companies())
```
**التحقق بعد الإصلاح:** `GET /rest/v1/party_balances?select=*&limit=1` بمفتاح `anon` ⇒ يجب أن يعود 401 أو `[]`.

---

### P0-2 — دالتان مُدمِّرتان بلا حارس منشأة، ممنوحتان لكل مستخدم مصادَق **[مؤكَّد حيّاً + سطرياً]**

**الدليل:** ACL الحيّ: `fn_release_payment_allocations` ⇒ `authenticated=X`، `cleanup_old_records` ⇒ `authenticated=X`.

1. **`fn_release_payment_allocations(p_payment_id, p_invoice_id)`** — [baseline_functions.sql:4620-4644](alzhraERP/supabase/migrations/20260819000002_baseline_functions.sql#L4620): `SECURITY DEFINER` **بلا أي فحص منشأة أو دور**، والجسم يمرّ على `payment_allocations` وينفّذ `UPDATE invoices SET paid_amount = GREATEST(0, paid_amount - amount)` ثم يحذف التخصيص. لا `REVOKE` لاحق (الوارد في 20260916000014:1511 تعليق فقط).
2. **`cleanup_old_records()`** — [baseline_functions.sql:2494-2515](alzhraERP/supabase/migrations/20260819000002_baseline_functions.sql#L2494): `SECURITY DEFINER` بلا معامل وبلا فحص، ويمسح `audit_logs` (90 يوماً) و`notification_log` و`api_rate_limits` **لكل المنشآت**.

**الأثر:** أي مستخدم مُصادَق — بأي دور، من أي منشأة — يستطيع: (أ) إبطال مقاصّات دفع فاتورة منشأة أخرى وإرجاعها «غير مدفوعة» (يحتاج معرفة UUID الهدف: UUIDv4 غير قابل للتخمين، لكنه يظهر في روابط مشتركة وتصديرات Excel ومنتجات API — أي أن الحاجز حاجز «سرّية معرّف» لا حاجز صلاحية)، و(ب) **محو أدلة التدقيق لكل المستأجرين** خلال 90 يوماً وتفريغ جدول تحديد المعدل (وهو تعطيل دفاعي ذاتي: نفس المستدعي يستطيع تجاوز حدود المعدل بعدها).

**الإصلاح:**
```sql
REVOKE ALL ON FUNCTION public.fn_release_payment_allocations(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cleanup_old_records() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_old_records() TO service_role;   -- cron فقط
-- وأضف داخل fn_release_payment_allocations:
--   PERFORM public.fn_assert_company_access(v_company_id);  -- مع اشتراط دور admin/accountant
```
ملاحظة: `ensure_vehicle(...)` و`security_alert(...)` و`incentive_detect_pending_invoices_system()` ممنوحة أيضاً لـ`authenticated` بلا فحص مستدعٍ — درجة أخطرها أدنى لكنها من نفس العائلة وتستحق نفس المعالجة.

---

### P0-3 — انتحال `service_role` في دالة الحافة `debt-reminder-dispatch` **[مؤكَّد سطرياً، سلسلة كاملة]**

**الدليل:** [debt-reminder-dispatch/index.ts:40-54](alzhraERP/supabase/functions/debt-reminder-dispatch/index.ts#L40):
```ts
const parts = token.split('.');
if (parts.length !== 3) return false;
const payload = JSON.parse(atob(parts[1]...)) as { role?: string };
return payload.role === 'service_role';      // ← بلا أي تحقق من التوقيع
```
ثم [:160-176](alzhraERP/supabase/functions/debt-reminder-dispatch/index.ts#L160): `if (!isService) {... companyId = ... }` ⇒ عند انتحال الخدمة يبقى `companyId = null`، ويُنادى `claim_debt_reminders({ p_limit, /* بلا p_company_id */ })`.
والدالة الفعّالة [20260923000005:74-95](alzhraERP/supabase/migrations/20260923000005_debt_dispatch_hardening.sql#L74) تحتوي `AND (p_company_id IS NULL OR q.company_id = p_company_id)` — أي **NULL = كل المنشآت** — وتُرجع `provider_url` و`provider_key` (مفاتيح SMS/WhatsApp الخاصة بكل مستأجر) ورسالة المطالبة ورقم هاتف عميله. والدالة مسحوبة من `authenticated` حيّاً ⇒ دالة الحافة هي الحارس الوحيد، وقد سقط.

**الأثر:** مهاجم غير مصادَق يرسل `Authorization: Bearer x.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.y` فيستهلك رصيد مزوّدي الرسائل لكل المستأجرين، ويُرسل مطالبات فعلية لعملائهم، ويقرأ مفاتيح مزوّديهم، ويعلّم الصفوف `cancelled`. ضرر مالي وقانوني (إزعاج عملاء الغير).

**الإصلاح:** لا تفكّ حمولة JWT يدوياً. إمّا مطابقة سرّية لتوكن داخلي، أو `supabase.auth.getUser(token)` + فحص دور، أو اشتراط `p_company_id` إلزامياً وإرجاع 400 عند غيابه:
```ts
const isService = serviceToken !== '' && token === serviceToken;   // لا atob/payload.role
if (!companyId && !isService) return json({ error: 'company_id is required' }, 400);
if (isService && !companyId) return json({ error: 'company_id is required for service calls' }, 400);
```

---

### P0-4 — المصروفات التشغيلية تُرحَّل إلى 5100 (تكلفة البضاعة المباعة) **[مؤكَّد سطرياً + بالبيانات]**

**الدليل:** [20261001000001:833-841](alzhraERP/supabase/migrations/20261001000001_fix_reconciliation_currency_branch_atomicity.sql#L833):
```sql
IF v_expense_account_id IS NULL THEN
  SELECT a.id INTO v_expense_account_id FROM public.accounts a
  WHERE a.company_id = p_company_id AND (a.type = 'expense' OR a.code LIKE '5%') ...
  ORDER BY CASE WHEN a.code LIKE '5%' THEN 0 ELSE 1 END, a.code LIMIT 1;
END IF;
```
الفئات المزروعة **بلا `account_id`** (`INSERT INTO expense_categories(company_id, name, color, is_system)` في [baseline_functions.sql:10411](alzhraERP/supabase/migrations/20260819000002_baseline_functions.sql#L10411) وفي 7 هجرات أخرى)، والفئة التلقائية كذلك ([20261001000001:742](alzhraERP/supabase/migrations/20261001000001_fix_reconciliation_currency_branch_atomicity.sql#L742)) ⇒ الفرع الاحتياطي هو المسار الطبيعي، والترتيب يرجّح `code LIKE '5%'` ثم الأصغر ⇒ **5100**.

**الأثر:** مصروف كهرباء 5,000 ر.س ⇒ «مدين 5100 / دائن الصندوق». وبما أن تقرير المصاريف التشغيلية يستبعد `51%` ([reports/api.ts:275](alzhraERP/src/features/reports/api.ts#L275)) فإن المبلغ **لا يظهر في أي تقرير مصروفات**، وينخفض به **مجمل الربح** بدل أن يخفض الربح التشغيلي. صافي الربح وحده يبقى صحيحاً — وهو ما يجعل الخطأ صعب الاكتشاف.

**الإصلاح:** في الفرع الاحتياطي: `AND a.type = 'expense' AND a.code NOT LIKE '51%'` (وأزل `OR a.code LIKE '5%'`)، واربط كل فئة مصروف بحسابها في بيانات التهيئة.

---

### P0-5 — ترقيم فواتير الشراء والمرتجعات: مفتاح نوع غير مطابق ⇒ الرقم دائماً «1» ثم `23505` **[مؤكَّد سطرياً]**

**الدليل:** [20260916000014:720-734](alzhraERP/supabase/migrations/20260916000014_patch_rpc_security_part2.sql#L720):
```sql
v_gen_number := case when p_invoice_number is not null and trim(p_invoice_number) != ''
                     then p_invoice_number
                     else get_next_invoice_number(p_company_id, 'PUR') end;
insert into invoices(... invoice_number ...) values (..., v_gen_number, 'purchase', 'draft', ...);
```
والدالة [20260916000015:697-700](alzhraERP/supabase/migrations/20260916000015_patch_rpc_security_part3.sql#L697):
```sql
SELECT COALESCE(MAX(NULLIF(invoice_number,'')::bigint),0)+1 INTO v_next
FROM public.invoices WHERE company_id = p_company_id AND type = p_type;   -- 'PUR' ≠ 'purchase'
```
⇒ لا صفوف مطابقة ⇒ النتيجة `1` دائماً. وبما أن `uq_invoice_number_company UNIQUE (company_id, invoice_number)` ([baseline:3044](alzhraERP/supabase/migrations/20260819000001_baseline_schema.sql#L3044))، فإن **ثاني فاتورة شراء بلا رقم مورّد تُرفض بـ`23505`**، وتُعرض للمستخدم برسالة مضلِّلة («تم إرسال هذه الفاتورة مسبقاً»). ونفس النمط في المرتجعات: `'RPR'` ([20260916000014:864](alzhraERP/supabase/migrations/20260916000014_patch_rpc_security_part2.sql#L864)) و`'RSL'` (:1000).

**ملاحظة حيّة مهمة:** النسخة المُصلَحة `generate_invoice_number(uuid,text,uuid)` **هي الموجودة حيّاً** وحدها، والنسخة القديمة `(uuid,text)` غير موجودة — أي أن القاعدة الحيّة سليمة هنا، لكن **إعادة تشغيل هجرات المستودع ستُدخل العطل**. هذا يقلب الأولوية: إعادة البناء من الهجرات أخطر من الوضع الحالي.

**الإصلاح:** استخدم `type` المخزَّن فعلاً (`'purchase'`/`'sale_return'`/`'purchase_return'`) أو وحّد كل الترقيم على `generate_invoice_number(uuid,text,uuid)`، وأزل النسخة القديمة نهائياً من الهجرات:
```sql
DROP FUNCTION IF EXISTS public.generate_invoice_number(uuid, text);
DROP FUNCTION IF EXISTS public.get_next_invoice_number(uuid, text);
```

---

### P0-6 — لا منع للمخزون السالب في قاعدة البيانات **[مؤكَّد حيّاً + سطرياً]**

**الدليل الحيّ:** `product_stock` لا يحمل `product_stock_quantity_check` (القيود: FKs + PK + `uq_product_stock_per_warehouse` فقط)، والمُشغِّلات: `set_updated_at` / `trg_check_product_stock_tenant` / `trg_prevent_company_id_change` / `trg_set_updated_by` — **لا `trg_prevent_negative_stock`**.
**سبب الكود:** [20260908000005:12-26](alzhraERP/supabase/migrations/20260908000005_allow_zero_and_negative_stock_sales.sql#L12) يُسقط القيد والـtrigger ويستبدل الدالة بـ`RETURN NEW;` بلا فحص — **ولا هجرة لاحقة تُعيدها**.

**الأثر:** كاشيران يبيعان آخر وحدة في نفس اللحظة ⇒ الرصيد `-1` بلا اعتراض؛ والكميات السالبة تُشوّه متوسط التكلفة وتقارير النواقص واقتراحات المناقلة. (التدقيق أشار إلى `POSPage.tsx:154 maxStock: 0` كدليل أن الواجهة لم تعد تعترض أيضاً.)

**الإصلاح:** إمّا إعادة `CHECK (quantity >= 0)` (مع سياسة لكل منشأة إن لزم)، أو فحص توفّر صريح داخل دالة البيع `SELECT ... FOR UPDATE` قبل الخصم، مع رسالة عربية واضحة بدل السكوت.

---

### P0-7 — مصروف يُبلَّغ عنه «تم بنجاح» بلا أي قيد، ومفتاح منع التكرار عشوائي في كل نداء **[مؤكَّد سطرياً]**

**الدليل (نصفان يتكاملان):**
1. [20261001000001:866](alzhraERP/supabase/migrations/20261001000001_fix_reconciliation_currency_branch_atomicity.sql#L866): `IF v_cash_account_id IS NOT NULL AND v_expense_account_id IS NOT NULL THEN INSERT INTO journal_entries ... END IF;` — ثم [:893-903](alzhraERP/supabase/migrations/20261001000001_fix_reconciliation_currency_branch_atomicity.sql#L893) تُرجع الدالة `status: 'posted'` **بلا شرط**، والمصروف أُدرج `posted` قبل ذلك بـ`p_data` وحده.
2. [expenses/api.ts:68](alzhraERP/src/features/expenses/api.ts#L68): `idempotency_key: (data as any).idempotency_key || crypto.randomUUID()` — والحقل `idempotency_key` معرَّف في [types.ts:48](alzhraERP/src/features/expenses/types.ts#L48) لكن **لا مكان في الميزة يعبّئه** (لا `useRef` ولا حالة) ⇒ مفتاح جديد في كل نقرة. والتحقق من المفتاح داخل الدالة أصلاً غير موجود.

**الأثران:** (أ) إن غاب حساب صندوق/مصروف قابل للترحيل، يُسجّل المصروف ويُعلن النجاح بلا قيد ⇒ فجوة دائمة بين السجل الفرعي والأستاذ والميزانية. (ب) النقر المزدوج (أو تكرار الإرسال بعد بطء الشبكة) ينشئ **مصروفين وقيدين ونقداً مخصوماً مرتين** — أي خسارة مالية مباشرة على الدرج.

**الإصلاح:** (1) `IF v_entry_id IS NULL THEN RAISE EXCEPTION 'accounting_posting_failed: ...'` كما تفعل فواتير الشراء والمرتجعات؛ (2) ثبّت المفتاح في الواجهة (`useRef(() => crypto.randomUUID())`) ولا تجدّده إلا بعد النجاح — على نمط `CreateInvoiceView.tsx:130` و`useBondForm.ts:61`؛ (3) فهرس `UNIQUE (company_id, idempotency_key) WHERE idempotency_key IS NOT NULL` على `expenses`.

---

### P0-8 — ترقيم فواتير المبيعات يعتمد `COUNT` مع استبعاد المحذوف ناعماً ⇒ تصادم بعد أي حذف **[مؤكَّد سطرياً / لا ينطبق على القاعدة الحالية]**

**الدليل:** [20260916000014:1579-1581](alzhraERP/supabase/migrations/20260916000014_patch_rpc_security_part2.sql#L1579):
```sql
SELECT COUNT(*) + 1 INTO v_count FROM invoices
WHERE company_id = p_company_id AND type = p_type AND deleted_at IS NULL;
```
مع فهرس فريد **غير جزئي** `uq_invoice_number_company` ([baseline:3044](alzhraERP/supabase/migrations/20260819000001_baseline_schema.sql#L3044)) — أي أن الفواتير المحذوفة ناعماً **تشغل أرقامها**. حذف الفاتورة رقم 3 من أصل 5 ثم إنشاء فاتورة ⇒ `COUNT=4` ⇒ الرقم 5 ⇒ تصادم مع الفاتورة الخامسة القائمة.
**الحالة الحيّة:** النسخة الفعّالة حيّاً هي 3-معاملات (`MAX` للاحقة الرقمية، بلا استبعاد المحذوف) ⇒ **العطل نظري على هذه القاعدة، لكنه يتحقق فوراً بعد إعادة تشغيل الهجرات** — وهو ما يجعله P0 في أي مسار بناء/استعادة.

**الإصلاح:** إلغاء النسخة القديمة كلياً، وقياس التسلسل من `MAX` على **كل** الصفوف، مع `pg_advisory_xact_lock` على نوع المستند، أو الأفضل: `SEQUENCE` لكل (منشأة، نوع) أو الاعتماد على `ON CONFLICT` مع إعادة المحاولة.

---

## 3. 🟠 عالٍ (P1)

### P1-1 — `invite-user`: مدير بلا فرع يدعو بدور `owner` ⇒ استيلاء على المنشأة **[مؤكَّد سطرياً]**
[invite-user/index.ts:112-138](alzhraERP/supabase/functions/invite-user/index.ts#L112): الشرط المانع لمنح `owner/admin` **متداخل داخل `if (callerBranch)`** ⇒ مدير بلا فرع (الحالة الافتراضية) يتخطاه بالكامل، ثم [:141-150](alzhraERP/supabase/functions/invite-user/index.ts#L141) يكتب بـ`service_role` **فتتجاوز RLS** ويُبطل إصلاح [20260821000001](alzhraERP/supabase/migrations/20260821000001_fix_invitation_privescalation.sql) الذي يشترط `role IN ('owner','admin')` للمُدعِي.
**الإصلاح:** احسم الدور قبل استخدام مفتاح الخدمة: `const mayGrantOwner = callerRole === 'owner'; if (['owner','admin'].includes(role) && !mayGrantOwner) return 403;`

### P1-2 — لا دلو تخزين في الإنتاج ⇒ الرفع والمرفقات معطّلة **[مؤكَّد حيّاً]**
`SELECT count(*) FROM storage.buckets` ⇒ **0**، و`storage.objects` ⇒ **0**، بينما المستودع ينشئ `company-assets` و`invoices` بـ`public = true` ([20260819000005:74-77](alzhraERP/supabase/migrations/20260819000005_file_attachments_storage.sql#L74)) ولا هجرة تُلغي العمومية. فحص الدلاء حيّاً يُظهر أن الدلاء **غير موجودة أصلاً** (لا عامة ولا خاصة) — أي أن أي ميزة رفع (مرفقات الفواتير، صور المنتجات، مرفقات الدردشة، الشعارات، الصور الرمزية) تفشل في الإنتاج.
**ملاحظة:** يلزم تأكيد يدوي من لوحة Supabase (قد تكون صلاحية قراءة `storage.buckets` محدودة عبر Management API) — لكن إرجاع `count = 0` مع `objects = 0` مع بقاء كل ميزات الرفع موثَّقة كـ«تعمل» يستحق تحقيقاً فورياً.
**الإصلاح:** أعد إنشاء الدلاء، **واجعلها خاصة** (`public = false`) مع سياسات العزل المذكورة في [20260912000007](alzhraERP/supabase/migrations/20260912000007_storage_per_bucket_tenant_policies.sql) و`createSignedUrl` بدل `getPublicUrl`.

### P1-3 — الميزانية العمومية غير متزنة بمقدار صافي ربح الفترة، ودالة التقرير التفصيلي مفقودة من المستودع **[مؤكَّد: تحميلان + غياب تعريفي، ودالة موجودة حيّاً فقط]**
`report_balance_sheet` لها تحميلان: 3-وسائط مصنَّف بـ`a.type` ([20260820000004:93](alzhraERP/supabase/migrations/20260820000004_accounting_type_based_reports_and_journal_guards.sql#L93)) و2-وسيط مصنَّف بالكود `LIKE '1%'/'2%'/'3%'` ([20260916000016:1153](alzhraERP/supabase/migrations/20260916000016_patch_rpc_security_part4.sql#L1153)). والواجهة تستدعي **2 وسيط** عند «كل الفروع» و3 عند اختيار فرع ([reports/service.ts:149-152](alzhraERP/src/features/reports/service.ts#L149)) ⇒ **نفس البيانات تعطي تصنيفاً مختلفاً حسب الفلتر**، وحقوق الملكية تُجمع من `3%` فقط بلا ربح الفترة ⇒ فرق يساوي صافي الربح (تظهر لافتة «غير متزنة»).
و**حيّاً**: `report_balance_sheet_detailed` **موجودة** بينما **لا هجرة في المستودع تُنشئها**، ومع ذلك يستدعيها الكود في موضعين ([reports/service.ts:153](alzhraERP/src/features/reports/service.ts#L153)، [accounting/services/reportService.ts:360](alzhraERP/src/features/accounting/services/reportService.ts#L360)) عبر `as any`.
**الإصلاح:** `DROP` للتحميل 2-وسيط وتوحيد التصنيف على `a.type`، وأضف ربح/خسارة الفترة لحقوق الملكية، وولّد هجرة للدالة المفقودة من القاعدة الحيّة (`pg_get_functiondef`) لإعادة المزامنة.

### P1-4 — `process_sales_return`: لا سقف لكمية الإرجاع ولا تتبّع تراكمي **[مُبلَّغ بدليل]**
آخر تعريف [20260928000003:99-131](alzhraERP/supabase/migrations/20260928000003_harden_process_sales_return_item_fallbacks.sql#L99) يتحقق فقط من `quantity > 0` والسعر — **لا مقارنة بـ`invoice_items.quantity` ولا بمرتجعات سابقة**، ولا يوجد عمود تتبّع في المخطط كله، ويُقبل `p_invoice_id IS NULL`. الحماية في الواجهة فقط (`Math.min(..., maxQty)`).
**الأثر:** إرجاع قطعة واحدة 3 مرات ⇒ مخزون +3، عكس إيراد 3×، وتقييد نقدية/ذمة 3×. ومستخدم مصادَق يستطيع استدعاء الـRPC مباشرة بكمية 100.
**الإصلاح:** احسب `SUM(كميات المرتجعات السابقة)` لنفس `reference_invoice_id` وامنع التجاوز، وتحقّق من `type='sale'` والحالة، وأضف مفتاح idempotency للمرتجع.

### P1-5 — المرتجع يعيد المخزون إلى مستودع مختلف عن مستودع البيع، وبتكلفة حركة صفرية **[مؤكَّد سطرياً]**
البيع يسجّل الحركة بمستودع البند ([20260916000008:3354](alzhraERP/supabase/migrations/20260916000008_inventory_source_of_truth.sql#L3354): `COALESCE(v_item.warehouse_id, v_warehouse_id)`)، والمرتجع يسجّل `ABS(quantity)` في **مستودع الفرع الأساسي** ([20260928000003:179-201](alzhraERP/supabase/migrations/20260928000003_harden_process_sales_return_item_fallbacks.sql#L179)). ⇒ المخزون «ينتقل» بين المستودعات عند كل إرجاع.
ويضاف: تكلفة حركة المرتجع `COALESCE(v_item.cost_price, 0)` بلا احتياطي الكتالوج (:197-200) بينما بند الفاتورة يستخدم `COALESCE(..., p.cost_price, 0)` (:167)، والعميل ([sales/api/index.ts:218-222](alzhraERP/src/features/sales/api/index.ts#L218)) يرسل `product_id/quantity/unit_price` فقط ⇒ **كل مرتجع من الواجهة يسجّل `unit_cost = 0`** بينما القيد يعكس COGS بتكلفة الكتالوج ⇒ تشويه متوسط التكلفة.
**الإصلاح:** اشتقّ المستودع والتكلفة من حركة/بند الفاتورة الأصلية (`reference_id = p_invoice_id`)، لا من «أول مستودع في الفرع».

### P1-6 — فاتورة المبيعات تُرحَّل بلا التحقق من إنشاء القيد (بخلاف الشراء والمرتجع) **[مُبلَّغ بدليل]**
[20260916000008:3362-3368](alzhraERP/supabase/migrations/20260916000008_inventory_source_of_truth.sql#L3362): يحدّث الحالة ويعيد المعرّف بلا فحص `journal_entries`، بينما الشراء يرمي `'فشل الترحيل المحاسبي...'` ([20260916000014:791](alzhraERP/supabase/migrations/20260916000014_patch_rpc_security_part2.sql#L791)) والمرتجع كذلك ([20260928000003:210-219](alzhraERP/supabase/migrations/20260928000003_harden_process_sales_return_item_fallbacks.sql#L210)). ومحرك الترحيل يعود بلا خطأ إن لم تكن الحالة مؤهّلة أو كان القيد موجوداً.
**الإصلاح:** نفس حارس الشراء قبل `RETURN`.

### P1-7 — تصنيف القيود العكسية بلا `branch_id` ⇒ تقارير الفروع تُظهر فواتير ملغاة **[مُبلَّغ بدليل]**
[20260916000014:1534-1545](alzhraERP/supabase/migrations/20260916000014_patch_rpc_security_part2.sql#L1534) ينشئ رأس القيد وأسطره **بلا `branch_id`** (والعمود nullable)، ويُستخدم في `void_invoice`/`void_expense`/`void_bond`؛ وتقارير الفرع تُفلتر بـ`jel.branch_id` ⇒ تُستبعد الأسطر العكسية ويبقى إيراد الفاتورة الملغاة ظاهراً في تقرير الفرع (بينما تقرير «كل الفروع» صحيح).
**الإصلاح:** انسخ `branch_id` من القيد الأصلي إلى الرأس والأسطر.

### P1-8 — تقارير الضريبة والتدفق النقدي: فلتر حالة ناقص وسعر صرف مُثبَّت **[مُبلَّغ بدليل — مُصحَّح]**

> ⚠️ **تصحيح ذاتي (2026-10-02):** الادعاء الأصلي بأن هذه التقارير «تتضخم 410 مرة لأنها تجمع عملات بلا تحويل» **غير صحيح**. القياس على القاعدة الحيّة أثبت أن `invoices.total_amount`/`subtotal` مخزّنان **بعملة الأساس (SAR)** لكل الفواتير، فجمعهما سليم رقمياً. التفاصيل في [CURRENCY-INVERSION-AUDIT-2026-10-02.md](alzhraERP/docs/CURRENCY-INVERSION-AUDIT-2026-10-02.md). يبقى من البند صحيحاً: فلتر الحالة الناقص، وتجاهُل اتجاه الإشارة، وأن `foreign_amount` (بعملة المستند) لا يصلح للتجميع المالي المباشر.
- إقرار الضريبة [20260908000003:771-792](alzhraERP/supabase/migrations/20260908000003_comprehensive_accounting_automation.sql#L771): `SUM(CASE WHEN type='sale' THEN subtotal ELSE -subtotal END)` بلا أي تحويل، وبفلتر `status IN ('posted','paid')` **يُسقط `partially_paid`** رغم أن القيد التلقائي يقبلها ([20260919000008:43](alzhraERP/supabase/migrations/20260919000008_fix_sales_returns_and_security_hardening.sql#L43)).
- التدفق النقدي [20260916000016:1229-1263](alzhraERP/supabase/migrations/20260916000016_patch_rpc_security_part4.sql#L1229): `SUM(i.total_amount)` و`SUM(e.amount)` بلا تحويل ⇒ بيع 410,000 YER يُحتسب 410,000 حيث القيمة الحقيقية ~1,000 ر.س (تضخّم 410×).
- `report_account_balances` [20260918000003:229-231](alzhraERP/supabase/migrations/20260918000003_fix_party_balances_and_report_account_balances_timeouts.sql#L229): `CASE WHEN COALESCE(exchange_rate,1) > 1 THEN exchange_rate ELSE 410 END` — سعر افتراضي مُثبَّت واتجاه مضاعفة قد يكون معكوساً.
**الإصلاح:** اقرأ الحركات من `journal_entry_lines` لحسابات النقد/الضريبة مع `fn_to_base_amount` و`supported_currencies.exchange_operator`، وضمّ الحالات الأربع.

### P1-9 — فجوة دائمة بين السجل الفرعي والأستاذ بعد تعديل أسعار الصرف: أقدم سعر يفوز **[مُبلَّغ بدليل]**
[reports/service.ts:365](alzhraERP/src/features/reports/service.ts#L365) `.order('effective_date', { ascending: false })` ثم بناء `new Map(...)` الذي يُبقي **آخر** عنصر ⇒ **أقدم** سعر هو المستخدم، ويُضرب المبلغ في السعر (`exRate > 1 ? abs(debit-credit) * exRate : ...`) بما يمحو الاتجاه ويضخّم أرصدة العملات الأجنبية.
**الإصلاح:** `for` يُبقي أول صف فقط، والاعتماد على منطق `fn_to_base_amount`.

### P1-10 — قوانين منع التكرار في `AGENTS.md` غير مفروضة في قاعدة البيانات **[مؤكَّد حيّاً/سطرياً]**
- **`parties`**: لا فهرس فريد على الاسم/الهاتف/الرقم الضريبي — الفهارس الوحيدة `parties_pkey` و`uq_parties_company_id (company_id, id)`. ومعلومة مضلِّلة في [20260924000005:69](alzhraERP/supabase/migrations/20260924000005_drop_redundant_indexes.sql#L69) تُشير إلى فهرس `ux_parties_company_type_norm_name` **غير موجود**. الحماية فحص عميل فقط ([parties/service.ts:319](alzhraERP/src/features/parties/service.ts#L319)) ⇒ إدخالان متزامنان = طرفان منفصلان وأرصدة مشطورة.
- **`products`**: لا `UNIQUE` على `name_ar` ولا على (part_number+brand) — فهرس [20260902000004:128](alzhraERP/supabase/migrations/20260902000004_fix_audit_finalize_and_unique_constraints.sql#L128) **غير فريد**.
- **الباركود**: الفهرس يعتمد `TRIM(barcode)` فقط بلا `lower` ولا إزالة فراغ داخلي ⇒ `abc123` و`ABC123` (أو `123 456` و`123456`) يُقبلان كمنتجين — خلافاً لنص القانون حرفياً.
- **`sku`**: القيد فريد **غير جزئي** ([baseline:3078](alzhraERP/supabase/migrations/20260819000001_baseline_schema.sql#L3078)) بينما فحص العميل يستبعد المحذوف ⇒ أرشفة منتج ثم إنشاء آخر بنفس الـSKU يفشل بـ`23505` على مسار طبيعي.
**الإصلاح:** فهارس فريدة جزئية بنفس تعبير التطبيع المستخدم في الكتابة:
```sql
CREATE UNIQUE INDEX ux_parties_company_type_norm_name ON public.parties
  (company_id, type, lower(btrim(regexp_replace(name,'\s+',' ','g')))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX ux_products_company_norm_barcode ON public.products
  (company_id, lower(regexp_replace(btrim(barcode),'\s+','','g')))
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '' AND deleted_at IS NULL;
```

### P1-11 — نص الواجهة يُقرأ بـ 8.4–9px على الهاتف، وحارس الـ10px لا يراه **[مؤكَّد بالحساب + بالقياس]**
`html { font-size: calc(var(--app-font-size,15px) * var(--scale,1)) }` ([index.css:51](alzhraERP/src/index.css#L51)) مع `@media (max-width:767px){ --scale: 0.8 }` ([:28-33](alzhraERP/src/index.css#L28))، وافتراضي `fontSize: 14` في [themeStore.ts:214](alzhraERP/src/lib/themeStore.ts#L214) المُطبَّق عبر `applyFontSize`. ⇒ الجذر على الهاتف = **11.2px**، و`.text-xs` (0.75rem) = **8.4px**، و`.phone-portrait .excel-table` = 8.4px ([index.css:708](alzhraERP/src/index.css#L708))، و`.landscape-compact .stat-card .label` = **7px** ([:689](alzhraERP/src/index.css#L689))، و`AdvancedTabBar/styles.css:469` = 6.2px.
والقياس: **`text-xs` في 1,995 موضعاً (444 ملفاً)** و`text-[10px]` في 1,711 موضعاً (404 ملفات) — أي أن أغلب نص الجداول والنماذج يهبط تحت الحد الذي يفرضه `AGENTS.md §5`.
**سبب الفشل الصامت:** [check-tiny-fonts.mjs:11](alzhraERP/scripts/check-tiny-fonts.mjs#L11) يبحث عن النمط الحرفي `text-[1-9px]` فقط: لا يرى `rem`، ولا `fontSize:` المضمَّن (5 مواضع recharts بـ`fontSize: 9`)، ولا ملفات `.css` إطلاقاً (وهو ما يفوت 13 تعريف خط < 0.75rem).
**الإصلاح:** إلغاء `--scale: 0.8` على الجذر ورفع الخط الأدنى للموبايل، وتوسيع الحارس ليقيس `text-xs/sm/base` + `fontSize` + `.css`، وإدخاله في CI.

### P1-12 — 54 استخداماً لمتغيّرات CSS **غير معرّفة** ⇒ بطاقات شفافة **[مؤكَّد بالبحث الشامل]**
`--app-card` (17 استخداماً)، `--app-card-bg` (19)، `--app-hover` (7)، `--app-border-hover` (1): **صفر تعريف** في كل `src` (لا في `:root` ولا `.dark` ولا أي ملف). أمثلة: [CommissionReportComponents.tsx:16](alzhraERP/src/features/commissions/pages/CommissionReportComponents.tsx#L16)، [DailyReconciliationPage.sections.tsx:54](alzhraERP/src/features/reconciliation/pages/DailyReconciliationPage.sections.tsx#L54)، [DenominationTouchCounter.tsx:37](alzhraERP/src/features/reconciliation/components/DenominationTouchCounter.tsx#L37)، [index.css:114](alzhraERP/src/index.css#L114).
**الأثر:** تصريح `background-color` غير صالح ⇒ يُلغى ⇒ بطاقة/زر **شفاف** ويختفي حدّه البصري (أسوأ في الوضع الداكن): شاشة التسوية اليومية وتقارير العمولات.
**الإصلاح:** عرّفها في `:root` و`.dark` أو استبدلها بـ`--app-surface`/`--app-surface-hover`، وأضف فحصاً يرفض `var(--x)` بلا تعريف.

### P1-13 — طابور المزامنة offline يُنفَّذ بجلسة مستخدم آخر ومفتاح IndexedDB واحد **[مؤكَّد سطرياً]**
[sync-store.ts:16](alzhraERP/src/core/lib/sync-store.ts#L16) مفتاح `alzhra-pending-sync` بلا ربط بمستخدم، و[store.ts:53-64](alzhraERP/src/features/auth/store.ts#L53) عند الخروج يمسح `queryClient` والمُثبِّت **ولا يمسّ طابور المزامنة**؛ و[sync-registry.ts:100-104](alzhraERP/src/core/lib/sync-registry.ts#L100) يُعيد التنفيذ بـ`company_id`/`user_id` **من الحمولة المخزَّنة** لا من الجلسة الحالية.
**الأثر:** جهاز مشترك في محل قطع غيار ⇒ فاتورة كتبها المستخدم A تُرحَّل تحت جلسة B؛ وإن لم يكن B عضواً في تلك المنشأة ترفض RLS ويُسقَط العنصر بعد 5 محاولات = **فقدان نهائي لعملية مالية**.
**الإصلاح:** اربط كل عنصر بـ`userId/companyId` وارفض (بإشعار) أي عنصر لا يطابق الجلسة، وامسح/صدّر الطابور عند الخروج.

### P1-14 — أسرار التكامل (SMTP، مفاتيح API، IBAN) في `localStorage` وتبقى بعد الخروج **[مُبلَّغ بدليل]**
[settingsStore.ts:262-269](alzhraERP/src/features/settings/settingsStore.ts#L262) يحفظ `integration` كاملاً داخل `partialize`، والحقول تشمل `email_password`، `sms_api_key`، `api_secret_key`، `zatca_secret` ([integrationSettings.ts:27-37](alzhraERP/src/features/settings/types/integrationSettings.ts#L27)) و`bank_accounts[].iban`، وتكتبها الواجهة فعلاً ([IntegrationsSettings.tsx:133](alzhraERP/src/features/settings/components/integrations/IntegrationsSettings.tsx#L133)).
**الأثر:** أي XSS/إضافة/مستخدم على نفس الجهاز يقرأ كلمة مرور SMTP ومفاتيح المزودين وتبقى بعد تسجيل الخروج.
**الإصلاح:** أزل `integration` من `partialize`، وانقل الأسرار إلى جدول محمي/Edge Function، وامسح المفتاح في `logout`.

### P1-15 — لا CI، والاختبارات ليست في `pre-push`، وe2e لا يمكن أن يفشل (ولا ينجح) **[مُبلَّغ + مؤكَّد جزئياً]**
`Test-Path .github` ⇒ **غير موجود**؛ و`pre-push` = `check:encoding && check-ts-baseline && check:classes && check:fonts && check:layers && check:lint-total` — **بلا `test` وبلا `type-check`**؛ و`test:ci` لا يستدعيه شيء. و[e2e/auth.spec.ts:10-12](alzhraERP/e2e/auth.spec.ts#L10) يستهدف `getByRole('textbox',{name:/email/i})` بينما التسميات عربية ([ar.json:68](alzhraERP/src/lib/locales/ar.json#L68)) وحقل كلمة المرور لا يحمل دور `textbox` ⇒ **لا يمكن أن ينجح**؛ وبقية الملفات تأكيداتها `expect(page.locator('body')).not.toBeEmpty()` داخل شروط `isVisible()` ⇒ **لا يمكن أن تفشل**.
**الإصلاح:** مهمة CI تشغّل `test:ci` + `type-check` + بوابات الأنماط، و`storageState` لجلسة مصادقة حقيقية، وتأكيدات على `total_amount`/`paid_amount`/`product_stock`/`journal_entries` بعد عملية POS كاملة.

---

## 4. 🟡 متوسط (P2)

| # | البند | الدليل | الأثر |
|---|---|---|---|
| P2-1 | `errorUtils` لا يعالج `23514` (انتهاك قيد) رغم أن `AGENTS.md §1` ينص على معالجته | [errorUtils.ts:120-157](alzhraERP/src/core/utils/errorUtils.ts#L120) (لا `case '23514'`) ← يسقط إلى «حدث خطأ غير متوقع» | رسالة لا تشرح أي قيد انتهك (مؤكَّد بنفسي) |
| P2-2 | مفاتيح `product_stock`/`stocked_products`/`warehouse_products` غير مُبطَلة | [invalidation.ts:48-58](alzhraERP/src/lib/invalidation.ts#L48) مقابل `useWarehouseStock.ts:102` و`useProducts.ts:345` | كمية ومستودع قديمان على الشاشة بعد أي بيع/تعديل (3 دقائق+) |
| P2-3 | 46 مفتاح استعلام مستخدم لا يغطيه أي preset، و37 مدخلاً معلناً بلا مستخدم، وتعارض `sales-returns` مقابل `sales_returns` | `invalidation.ts:22` مقابل `useInvoiceDetails.ts:91` | مرتجعات لا تُبطَل بعد العمليات |
| P2-4 | البيع بأقل من التكلفة مسموح؛ الحارس يقارن بـ`sale_price*0.7` لا بـ`cost_price` | [20260916000008:3255-3261](alzhraERP/supabase/migrations/20260916000008_inventory_source_of_truth.sql#L3255) | دور `sales/manager/accountant` يبيع بـ70% من القائمة وبأقل من التكلفة بلا تنبيه |
| P2-5 | خصم الفاتورة «يُخبز» في سعر الوحدة و`discount_amount` يبقى صفراً | [sales/service.ts:186-200](alzhraERP/src/features/sales/service.ts#L186)، [api/index.ts:151-161](alzhraERP/src/features/sales/api/index.ts#L151) | سعر مطبوع مختلف عن القائمة، وسجل بلا خصم، ورفض بيع مشروع عند خصم > 30% |
| P2-6 | `report_balance_sheet_detailed` موجودة حيّاً ولا تُنشئها أي هجرة (والعكس لكائنات أخرى) | **مؤكَّد حيّاً** | استعادة القاعدة من الهجرات تُنتج نظاماً مختلفاً |
| P2-7 | `Math.abs()` على مجموع الالتزامات في نسبة السيولة | [analyticsService.ts:13](alzhraERP/src/features/accounting/services/analyticsService.ts#L13) | نسبة سيولة مضلِّلة (خرق مباشر لقانون المشروع) |
| P2-8 | قالب الضريبة لا يعكس ضريبة المدخلات في مرتجع المشتريات | [20260912000010:948-966](alzhraERP/supabase/migrations/20260912000010_harden_accounting_security_and_currencies.sql#L948) | `net_vat_payable` أقل بـ1,500 لكل مرتجع 10,000 |
| P2-9 | ثقوب إقفال الفترة: تاريخ بلا سنة مالية يمرّ، والعكس بتاريخ اليوم | [baseline_functions.sql:8682](alzhraERP/supabase/migrations/20260819000002_baseline_functions.sql#L8682) | قيود بصمت خارج الإقفال؛ storno في الفترة الخطأ |
| P2-10 | ميزان المراجعة يفلتر برأس القيد وقائمة الدخل بسطر القيد | `20260921000001:660` مقابل `20260910000002:75` | لا يمكن مطابقة التقريرين لقيود عابرة للفروع |
| P2-11 | `setPrimaryWarehouse` يصفّر الأساسي لكل الشركة ولا يتراجع فعلاً | [settings/api.ts:132-154](alzhraERP/src/features/settings/api.ts#L132) | فرع بلا مستودع أساسي ⇒ سقوط على `LIMIT 1` بلا ترتيب |
| P2-12 | تحويل عرض السعر يُظهر نجاحاً بلا فحص نتيجة الكتابة | [QuotationDetailsModal.tsx:418-420](alzhraERP/src/features/sales/components/quotations/QuotationDetailsModal.tsx#L418) | تحويل مزدوج ⇒ فاتورتان |
| P2-13 | «الاستيراد الذكي» معطّل: المحرك stub يُرجع `items: []` ويُتهم «وضوح المستند» | [documentService.ts:7-13](alzhraERP/src/features/ai/documentService.ts#L7) و[SmartImportView.tsx:79](alzhraERP/src/features/smart-import/components/SmartImportView.tsx#L79) | ميزة ميتة برسالة مضلِّلة، والقسم بصفر اختبارات |
| P2-14 | الإتاحة: `Modal` الأساسي بلا `Escape`/احتباس تركيز، و49 نافذة يدوية، و`control-has-associated-label` مُطفأة | [Modal.tsx:230-247](alzhraERP/src/ui/base/Modal.tsx#L230)، `eslint.config.js` | لوحة المفاتيح/قارئ الشاشة معطّلان في نظام إدخال سريع |
| P2-15 | `tracking-*` على نص عربي في 510 مواضع يفكّك اتصال الحروف؛ و`bg-white` 593 مرة | القياس: `tracking-widest` 184، `tracking-tight` 170، `bg-white` 593 | «م ر ا ج ع ة» في شاشة الكاشير + انجراف لوني/وضع داكن مكسور |
| P2-16 | ملفات نشر متباعدة: `alzhraERP/vercel.json` rewrite `/(.*)` (بلا استثناء `assets`) مقابل `vercel.json` الجذر `/((?!assets/).*)` | [alzhraERP/vercel.json:2](alzhraERP/vercel.json#L2) مقابل [vercel.json:8](vercel.json#L8) | تكرار علّة «MIME type text/html» التي أُصلحت سابقاً، حسب أي ملف يُحترم |
| P2-17 | تخطيط الطبقات قابل للتجاوز (`import * as`, dynamic import, barrel) ويفحص `.tsx` فقط؛ وEdge Functions غير مشمولة بـeslint ولا tsc | [check-layer-boundaries.mjs:25-48](alzhraERP/scripts/check-layer-boundaries.mjs#L25)، `eslint.config.js` (`ignores: supabase/**`) | القاعدة اسمية؛ 15 دالة حافة بلا أي فحص ثابت |
| P2-18 | 115 `as any` + 207 `as unknown as` + 245 `: any` + 149 `eslint-disable` (و0 `@ts-ignore`) | القياس المباشر | `tsc = 0` يتحقق جزئياً بهذه المنافذ |
| P2-19 | 7 أقسام بصفر اختبارات (أهمها `smart-import`, `branches`, `notifications`) و`pos` بـ11 حالة لا تلمس الاعتماد | جدول التغطية أدناه | أخطر المسارات (استيراد، فروع، إشعارات) بلا شبكة أمان |
| P2-20 | بقايا PWA: `manifest.json` + `mobile-web-app-capable` بلا service worker (يُلغى برمجياً) وأيقونة Vite الافتراضية | `index.html:6-12`، [index.tsx:83](alzhraERP/src/index.tsx#L83)، [ADR-0003](../..//plans/adr/0003-pending-security-decisions.md) | «PWA وهمي» وقرار مالك معلّق |
| P2-21 | أشكال الترقيم القديمة في كل البيانات الحيّة (`2-مبيع:64316`) مع دوال ترقيم جديدة (`INV-YYYYMMDD-…`) | **مؤكَّد حيّاً** | نظامان للترقيم يتعايشان ⇒ بحث/مطابقة/تدقيق مربك |

---

## 5. بوابات الجودة: الادعاء مقابل الواقع

| البوابة | الواقع | الحكم |
|---|---|---|
| `tsc --noEmit` | 0 خطأ (والسقف `ts-error-baseline.txt` = 0) | ✅ حقيقي |
| `pre-push` | لا يشغّل `test` ولا `type-check` | ⚠️ ناقص |
| `check:lint-total` | **يمرّ** لأن السقف 9,616 والواقع 9,478 خطأ | 🔴 يمنع التدهور فقط، لا يعني نظافة |
| `npm run lint` | **يفشل**: 9,478 خطأ + 214 تحذير | 🔴 دين ضخم |
| `check:fonts` | يمرّ، لكنه لا يرى `rem`/`fontSize`/`.css` — والواقع 8.4px شائع | 🔴 حارس أضيق من القاعدة |
| `check:layers` | يمرّ، لكنه يفوت `import *`/dynamic/barrel و`.ts` | ⚠️ حارس أضيق من القاعدة |
| `check:encoding` | يمرّ، وفحص مستقل لـ1,732 ملفاً أكّد صفر تشوّه — لكنه **لا يشمل `index.html` ولا `docs/**` ولا الجذر الخارجي** | ✅ فعّال / ⚠️ نطاق ناقص |
| `check-ts-baseline.ts` | يحسب الأخطاء من مخرجات `tsc` النصية؛ لو فشل التشغيل (مخرجات فارغة) = 0 خطأ = نجاح | ⚠️ قابل للتعطيل الصامت |
| `vitest` | 139 ملفاً / 1,037 اختباراً تمرّ (834 ثانية) | ✅ جيد، وبلا CI |
| `playwright` e2e | 5 ملفات، أغلبها لا يمكن أن ينجح/يفشل | 🔴 وهم تغطية |
| CI | `.github` غير موجود | 🔴 لا شيء تلقائي |

---

## 6. القوانين المكتوبة (`AGENTS.md`) مقابل الواقع

| الفقرة | الحكم الفعلي |
|---|---|
| §1 منع تكرار المنتجات (باركود/SKU/اسم/رقم قطعة+ماركة) | **جزئي/مخالف**: الباركود `TRIM` بلا `lower`؛ لا فهرس على الاسم ولا (part+brand)؛ `sku` فريد غير جزئي ⇒ سلوك متناقض |
| §1 منع تكرار العملاء/الموردين (اسم/هاتف/ضريبي) | **مخالف**: لا يوجد أي فهرس فريد — الحماية في العميل فقط |
| §1 ترقيم تسلسلي ذري + منع النقر المزدوج | **مخالف جزئياً**: دوال الترقيم تحمل أقفالاً لكن مفاتيح الأنواع خاطئة؛ ومصروف بلا idempotency فعّال |
| §1 تحويل 23505/23503/23514/42501 لرسائل عربية | **23514 مفقود** (يسقط إلى «خطأ غير متوقع») |
| §2 منع `toISOString().split` والاعتماد على `formatLocalDate` | **✅ محقَّق بالكامل**: صفر استخدام ممنوع، و201 استخدام لـ`formatLocalDate` |
| §3 حارس المالك وعدم ابتلاع رفض الخادم | **مخالف**: تجاوز `owner` يأتي من `localStorage` ([usePermission.ts:52](alzhraERP/src/core/hooks/usePermission.ts#L52))، ويوجد fallback عند فشل RPC |
| §4 صفر أخطاء نوعية | ✅ 0 خطأ فعلاً (مع 567 منفذ `any`) |
| §4 بوابات pre-push | تعمل، لكن اثنتين منها غير مشمولتين في CI (لا CI أصلاً) |
| §5 منع الخطوط < 10px | **مخالف فعلياً**: 8.4px شائع على الهاتف و7px في مواضع |
| §5 أهداف لمس مريحة | **مخالف**: أزرار الموبايل 26/34/40px ([Button.tsx:47-49](alzhraERP/src/ui/base/Button.tsx#L47)) بينما `STYLE_GUIDE.md:67` يفرض 44px و`MOBILE-UX-FINAL-REPORT.md:63` يزعم «44–48px ✅» |
| §6 عزل COGS 5100 عن تقارير المصاريف | **مخالف على مستوى الكتابة**: المصروف الافتراضي يُرحَّل إلى 5100 نفسه |
| §6 منع `Math.abs()` على المجاميع | **مخالف** في [analyticsService.ts:13](alzhraERP/src/features/accounting/services/analyticsService.ts#L13) (وفي مواضع عرض مقبولة) |
| §6 تذكّر عملة المصروف والافتراضي YER + تحذير SAR ≥ 500 | **✅ محقَّق** ([useExpenseForm.ts:15-24](alzhraERP/src/features/expenses/components/CreateExpenseModal/hooks/useExpenseForm.ts#L15) و[ExpenseAmountSection.tsx:169-189](alzhraERP/src/features/expenses/components/ExpenseAmountSection.tsx#L169)) |

---

## 7. ما هو متين فعلاً (بأدلة)

1. **العزل بين المستأجرين على مستوى القاعدة ممتاز:** 187/187 جدولاً عليها RLS وسياسات فعّالة، ولا جدول بلا RLS. وإصلاح الفخّ الخطير `current_user = postgres` داخل `SECURITY DEFINER` (الذي كان يُبطل ~98 دالة) صحيح ومُثبت: [20260928000012:51-59](alzhraERP/supabase/migrations/20260928000012_fix_broken_tenant_guards.sql#L51) يستخدم `session_user` + غياب سياق JWT، ويرفض `auth.uid() IS NULL` بـ`42501`.
2. **سلامة القيود المحاسبية مفروضة في قاعدة البيانات:** `CONSTRAINT TRIGGER ensure_journal_balance DEFERRABLE INITIALLY DEFERRED` يرفض عند COMMIT أي قيد مرحّل غير متوازن أو صفري ([20260820000004:276-290](alzhraERP/supabase/migrations/20260820000004_accounting_type_based_reports_and_journal_guards.sql#L276))، وكل الأعمدة المالية `numeric(19,4)`/`numeric(15,2)` — **صفر `float`/`double precision`** في الأعمدة المالية.
3. **الأرصدة مشتقة من الأستاذ لا من عمود قابل للانحراف:** جدول `parties` بلا عمود رصيد (فقط `credit_limit`)، والأرصدة تُحسب من `journal_entry_lines` بحالة `posted` مع الأرصدة الافتتاحية.
4. **منع الاعتماد المكرر للفواتير مفروض على الخادم:** فهرس فريد `(company_id, idempotency_key)` ([20260826000000:146-148](alzhraERP/supabase/migrations/20260826000000_security_sweep_audit.sql#L146)) + مفتاح ثابت في الواجهة عبر `useRef` يُجدَّد بعد النجاح فقط.
5. **المخزون له مصدر واحد:** `trg_update_product_stock` يحدّث `product_stock` ذرّياً بـ`ON CONFLICT ... quantity = quantity + delta` ([20260916000008:6-46](alzhraERP/supabase/migrations/20260916000008_inventory_source_of_truth.sql#L6)) مع تعطيل الكتابات المباشرة.
6. **الانضباط الزمني:** صفر استخدام للنمط المحظور، و`formatLocalDate()` في 80 ملفاً — القانون §2 الوحيد المُحقَّق حرفياً.
7. **لا تسريب لمفتاح `service_role` من الواجهة:** `.env` **غير متعقَّب** بـgit (مؤكَّد)، والحزمة تستخدم `anon` فقط، والمفتاح الأساسي لا يُستعمل إلا في دوال الحافة و`scripts/`.
8. **دوال الحافة (عدا الاستثناء) تُصادق فعلاً:** `ai-proxy`، `invite-user`، `ai-part-lookup`، `part-search`، `vin-decode`، `validate-upload`، `vin-parts`، `zatca-integration`، `ai-product-image` كلها تنادي `auth.getUser()`، وCORS بقائمة أصول صريحة، و`ai-proxy` يحدّد المعدل لكل مستخدم ويفشل مُغلقاً.
9. **الطبقات نظيفة في `.tsx`:** صفر استدعاء `supabase.*` داخل أي مكوّن واجهة، وعميل Supabase مُهيكل بـcircuit breaker وإلغاء `AbortController` وretry محدود.
10. **تصدير Excel عربي RTL صحيح على مستوى المصنّف** (`wb.Workbook.Views = [{RTL:true}]`) مع اختبار يتحقق من البايت `rightToLeft="1"` — حل نادر ودقيق.
11. **الطباعة الحراريّة/A4 منفَّذة بجدية:** `@page { size: 80mm auto }` + عزل كامل لقالب الإيصال + `print-color-adjust: exact`، في 5 قوالب.
12. **الأداء المقاس جيد:** التقطيع اليدوي نجح فعلاً (jsPDF/xlsx/recharts **خارج** التحميل المبدئي)، و`lazy()` في 74 موضعاً، والافتراضية (`@tanstack/react-virtual`) مفعّلة في جدول Excel وأدوات البحث، و`formatLocalDate` — أي أن أساس الأداء سليم.
13. **مفاتيح الاستعلام تحمل `companyId`/`branchId`، والكاش يُفرَّغ عند تبديل المنشأة/الخروج** في 5 مواضع ([auth/store.ts:60,122,211,243,321](alzhraERP/src/features/auth/store.ts#L60)) — لا تسريب كاش بين المستأجرين.

---

## 8. خطة الإصلاح المرتبة

### أسبوع 1 — إغلاق النزيف (P0 + الحرجة التشغيلية)
1. **هجرة إصلاح العرضين** (P0-1) ثم التحقّق بمفتاح `anon`. *جهد: أقل من ساعة.*
2. **سحب صلاحيات `fn_release_payment_allocations` و`cleanup_old_records`** من `authenticated` وإضافة `fn_assert_company_access` داخلهما (P0-2). *ساعة.*
3. **إصلاح `isServiceCaller`** في `debt-reminder-dispatch` واشتراط `p_company_id` (P0-3). *ساعة.*
4. **ربط فئات المصروفات بحساباتها** + تصحيح الفرع الاحتياطي (P0-4)، ورفع استثناء عند غياب القيد + تثبيت `idempotency_key` في الواجهة + فهرس فريد على `expenses` (P0-7). *نصف يوم.*
5. **توحيد مفاتيح نوع المستند في الترقيم** وحذف الدوال القديمة من الهجرات (P0-5، P0-8). *نصف يوم.*
6. **تدوير المفاتيح المُسرَّبة** (انظر §9) وإعادة الدلاء الخاصة (P1-2). *ساعة.*
7. **إصلاح `invite-user`** (P1-1) وحلّ سقف كمية المرتجع (P1-4). *نصف يوم.*

### أسبوع 2–3 — تصحيح الأرقام والتكامل
8. سقف المرتجع + تكلفة/مستودع المرتجع من الفاتورة الأصلية (P1-5)، وحارس قيد فاتورة المبيعات (P1-6)، و`branch_id` في القيود العكسية (P1-7).
9. إصلاح العملات في تقارير الضريبة/التدفق/الميزانية + أقدم سعر يفوز (P1-3، P1-8، P1-9) + إضافة الفترة لحقوق الملكية.
10. **فهارس التطبيع الفريدة** للعملاء والمنتجات والباركود (P1-10) — مباشرة بعد تنظيف التكرارات القائمة (استعلامات `GROUP BY ... HAVING count(*)>1` أولاً).
11. **إصلاح الواجهة:** إلغاء `--scale: 0.8`، تعريف المتغيّرات الناقصة، رفع أهداف اللمس، توسيع حارس الخطوط (P1-11، P1-12).
12. **طابور المزامنة:** ربط العناصر بالمستخدم/المنشأة وتفريغه عند الخروج (P1-13)، وإخراج أسرار التكامل من `localStorage` (P1-14).

### أسبوع 4 — بناء الضمانات
13. **`report_balance_sheet_detailed`:** ولّد هجرة من القاعدة الحيّة (`pg_get_functiondef`) — وأصلح اتجاه المزامنة (P2-6).
14. **حاكم `23514`** في `errorUtils` (P2-1) + إبطال مفاتيح المخزون (P2-2/P2-3).
15. **CI إلزامي:** `type-check` + `test:ci` + `check:fonts` + `check:classes` + `check:i18n-keys`، مع `storageState` لاختبار e2e حقيقي واحد على مسار POS→فاتورة→مخزون→دفتر.
16. **قياس الهجرات:** اعتماد جدول `schema_migrations` خاص بالمشروع، وإصلاح السكربت بحيث يسجّل كل هجرة مُطبَّقة، وإنتاج `schema-diff.mjs` كبوابة (المستودع يحوي `scripts/schema-diff.mjs` فعلاً).
17. الاختبارات للأقسام السبعة الفارغة، وأولها `smart-import` و`branches` و`notifications`.

---

## 9. 🔴 تنبيه أمني: المفاتيح التي لُصقت في المحادثة

خلال هذه الجلسة لُصقت **مفاتيح إنتاج حقيقية**:

| المفتاح | الخطورة | الإجراء الفوري |
|---|---|---|
| `service_role` JWT | **يتجاوز RLS بالكامل على كل الجداول** — يقرأ/يكتب/يمحو كل منشأة بلا قيود. مكافئ لكلمة مرور قاعدة البيانات | **دوّره الآن** (Settings → API → Rotate) وأعد نشر دوال الحافة |
| `sbp_...` (Personal Access Token) | **Management API**: يستطيع تعديل الإعدادات، تشغيل SQL، وإسقاط الجداول | **ألغِه الآن** (Account → Access Tokens) |
| `anon` JWT | عام بطبيعته ويُشحن في الحزمة — لا يحتاج تدويراً بذاته، لكنه هو ما يجعل P0-1 خطيرة | لا تدويره؛ **أصلح العرضين** |

المفاتيح التي تمرّ في محادثة أو لصق في شات أو ملف تُعدّ **مكشوفة**، ويجب تدويرها بغض النظر عن ثقة الأطراف. ولا تُخزَّن `service_role` أو `sbp_` في `.env` الخاص بالواجهة إطلاقاً (المستودع يحترم هذا — `.env` يحوي `anon` فقط وهو غير متعقَّب بـgit).
**ملاحظة نصيحة إضافية:** سجّل جدولاً دائماً (Audit) لكل استدعاء بهذين المفتاحين قبل التدوير، ثم راجع `audit_logs` و`security_alerts` بحثاً عن أي استخدام غير معتاد.

---

## 10. ما لم أتحقق منه (حدود هذه المراجعة)

1. **لم أُنفِّذ أي عملية كتابة** على قاعدة البيانات — كل الاستعلامات `SELECT`/`GET`، وبعضها بـ`limit=0` لتقليل سحب البيانات. لا هجرة ولا DDL ولا DML.
2. `storage.buckets = 0` — أنصح بتأكيده من لوحة Supabase مباشرة (قد تكون هناك قيود قراءة على مخطط `storage` عبر Management API)، لكن مؤشّرا `buckets` و`objects` صفر معاً مع بقاء كل ميزات الرفع في الواجهة يستحق تحقيقاً فورياً.
3. **لم أشغّل Playwright** — الحكم على e2e مبني على قراءة الملفات، وعلى أن تسميات ARIA عربية.
4. **لم أُنفِّذ SQL على القاعدة الحيّة لقياس أثر الأعطال المحاسبية** (مثل حجم المبالغ المرحَّلة إلى 5100)؛ التحليل مبني على الكود والبيانات الوصفية. أوصي بتقرير فرق فعلي: `SELECT sum(debit_amount) FROM journal_entry_lines WHERE account_id = <5100> AND ...`.
5. **مخطط `auth`/`storage`/`realtime`** لم يُفحص إلا بقدر ما يلزم.
6. بنود `[مُبلَّغ]` وردت بدليل `path:line` من التدقيق العميق ولم أُعِد فحصها سطرياً كلها؛ وقد أسقطت بنوداً ثبت خطؤها بالتحقق الحيّ (صلاحيات `anon` على الدوال، وتحميلا `commit_purchase_invoice`).
7. لم أغطِّ بعمق: تحويلات الفروع المخزنية، العمولات، VIN، بوابة الموردين، ومطابقة الديون اليومية.

---

### ملحق: تغطية الاختبارات لكل قسم (مقاسة)

| القسم | ملفات | حالات | القسم | ملفات | حالات |
|---|---|---|---|---|---|
| accompanying-info | 0 | 0 | notifications | 0 | 0 |
| accounting | 7 | 39 | parties | 1 | 2 |
| admin | 8 | 59 | pos | 2 | 11 |
| ai | 2 | 14 | purchases | 9 | 73 |
| appearance | 0 | 0 | reconciliation | 1 | 15 |
| auth | 6 | 17 | reports | 4 | 8 |
| bonds | 2 | 6 | returns | 2 | 22 |
| branches | 0 | 0 | sales | 9 | 53 |
| chat | 2 | 21 | settings | 3 | 10 |
| command | 0 | 0 | smart-import | 0 | 0 |
| commissions | 3 | 15 | supplier-portal | 1 | 2 |
| dashboard | 5 | 45 | vin-intelligence | 15 | 131 |
| debts | 10 | 64 | dhikr | 2 | 10 |
| expenses | 1 | 9 | feedback | 0 | 0 |
| inventory | 6 | 31 | | | |

**المجموع: 139 ملفاً / 1,037 حالة — وأقسام بصفر اختبارات: 7.**
