-- ============================================
-- تطبيع الفراغات في البيانات المرجعية
-- ============================================
-- المشكلة المكتشفة بالتدقيق:
--   * اسم المنشأة مخزَّن بفراغ زائد في نهايته في `name_ar` و`name_en`، فيظهر
--     هذا الفراغ في كل ترويسة مطبوعة ورسالة واتساب وملف إكسل (عُثر عليه فعلياً
--     في الخلية A1 لملف عرض السعر المُصدَّر: "الجعفري لقطع غيار السيارات ").
--   * 58 منتجاً بأسماء تحوي فراغاً زائداً في النهاية أو فراغات مزدوجة داخلية.
--   * 21 منتجاً بماركة (brand) بفراغات زائدة.
--   * 3 أطراف (عملاء/موردون) بأسماء بفراغات زائدة.
--
-- الأثر: الفراغات الزائدة تُضعف كشف التكرار — فسجلان متطابقان منطقياً يختلفان
-- نصياً فيمرّان من فهارس منع التكرار (اسم المنتج، رقم القطعة+الماركة، اسم الطرف).
--
-- تم التحقق قبل التنفيذ (صفر تصادمات) عبر _audit/normalize-collisions.sql:
--   منتجات: اسم مطابق بعد التطبيع = 0
--   منتجات: رقم قطعة+ماركة متطابق بعد التطبيع = 0
--   أطراف: اسم مطابق بعد التطبيع = 0
--
-- idempotent: إعادة التشغيل لا تغيّر شيئاً.

BEGIN;

UPDATE companies
SET name_ar = regexp_replace(btrim(name_ar), '\s+', ' ', 'g'),
    name_en = regexp_replace(btrim(name_en), '\s+', ' ', 'g')
WHERE name_ar IS DISTINCT FROM regexp_replace(btrim(name_ar), '\s+', ' ', 'g')
   OR name_en IS DISTINCT FROM regexp_replace(btrim(name_en), '\s+', ' ', 'g');

UPDATE products
SET name_ar = regexp_replace(btrim(name_ar), '\s+', ' ', 'g')
WHERE name_ar IS DISTINCT FROM regexp_replace(btrim(name_ar), '\s+', ' ', 'g');

UPDATE products
SET brand = btrim(brand)
WHERE brand IS NOT NULL AND brand <> btrim(brand);

UPDATE parties
SET name = regexp_replace(btrim(name), '\s+', ' ', 'g')
WHERE name IS DISTINCT FROM regexp_replace(btrim(name), '\s+', ' ', 'g');

COMMIT;
