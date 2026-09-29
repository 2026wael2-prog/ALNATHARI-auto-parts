-- ============================================
-- تصحيح انحراف reference_type في سجل حركة الأصناف
-- ============================================
-- المكتشف بالتدقيق: القيم المخزَّنة فعلاً في inventory_transactions.reference_type هي
--   stock_audit (651 صفاً)، invoice (322)، sales_invoice (265)، opening_balance (249)، void_invoice (8)
-- ولا وجود إطلاقاً للقيمتين 'audit' و'transfer'.
--
-- لكن دالة get_item_movements_with_balance — التي تغذّي شاشة سجل حركة الصنف —
-- تفحص القيمتين غير الموجودتين، فتُرجع '---' لكل حركة جرد (651 صفاً) وكل حركة
-- مناقلة، وتُسقط التسمية العربية للمصدر ورقم المستند. الواجهة تكرّر الانحراف
-- ذاته في ثلاثة ملفات (يُصحَّح في التزام منفصل).
--
-- التصحيح يستبدل القيمتين المفحوصتين بالقيم المخزَّنة فعلاً، دون المساس بالبيانات
-- القائمة (651 صفاً يعتمد عليها) ودون إعادة كتابة جسم الدالة يدوياً (استبدال
-- مُرسى على `reference_type='...'` لتقليل مخاطر الخطأ).

BEGIN;

DO $$
DECLARE
  d text;
  v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO d
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_item_movements_with_balance';

  IF d IS NULL THEN
    RAISE EXCEPTION 'get_item_movements_with_balance غير موجودة';
  END IF;

  v_before := d;
  d := replace(d, 'reference_type=''transfer''', 'reference_type=''stock_transfer''');
  d := replace(d, 'reference_type=''audit''', 'reference_type=''stock_audit''');

  IF d = v_before THEN
    RAISE EXCEPTION 'لم يُطبَّق أي استبدال — القيم لم تُوجد في نص الدالة';
  END IF;

  EXECUTE d;
END $$;

COMMIT;
