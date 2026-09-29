-- ============================================
-- إصلاح جذري: حارسا عزل المنشأة كانا معطّلين تماماً
-- ============================================
-- الثغرة المكتشفة (مُثبتة بالقياس): داخل أي دالة SECURITY DEFINER تكون
-- `current_user` هي **مالك الدالة** (postgres) لا المستدعي. وكل من
-- `verify_company_access` و`fn_assert_company_access` يبدآن بـ:
--
--     IF current_user IN ('postgres','supabase_admin') THEN RETURN; END IF;
--
-- وبما أن الدالتين SECURITY DEFINER ومملوكتان لـ postgres، فإن هذا الشرط يتحقق
-- **دائماً**، فتعود الدالة فوراً بلا أي فحص عضوية. النتيجة: كل دالة تعتمد عليهما
-- (78 دالة عبر fn_assert_company_access و20 عبر verify_company_access) كانت بلا
-- عزل منشأة فعلي، وأي مستخدم مصادَق يستطيع تمرير company_id لأي منشأة.
--
-- الإثبات المقيس (عبر Management API، بدور authenticated وuid غير منتمٍ):
--   داخل SECURITY DEFINER → current_user=postgres session_user=postgres
--                            uid=00000000-...-001 membership_rows=0
--   verify_company_access = PASSED   (يجب أن يكون DENIED)
--
-- الإصلاح: يُبنى الاستثناء على (1) غياب سياق JWT، و(2) كون الجلسة جلسة قاعدة
-- بيانات داخلية مميّزة. `session_user` لا يتأثر بـ SECURITY DEFINER، بخلاف
-- `current_user`. هذا يحافظ على عمل مهام cron والترحيلات (بلا JWT) بينما يفرض
-- العضوية على كل طلب قادم من PostgREST (session_user = authenticator + JWT).

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_company_access(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_user_id uuid;
  v_user_company_id uuid;
  v_claims text;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);

  -- (1) مفتاح الخدمة (service_role): الـ JWT موقّع ومتحقَّق منه من PostgREST،
  --     فيُعتمد الدور المعلَن فيه. لازم لإبقاء Edge Functions عاملة
  --     (مثل check_rate_limit الذي تستدعيه 15 دالة حافة).
  IF v_claims IS NOT NULL AND btrim(v_claims) <> ''
     AND left(btrim(v_claims), 1) = '{'
     AND (v_claims::jsonb ->> 'role') = 'service_role' THEN
    RETURN p_company_id;
  END IF;

  -- (2) جلسة داخلية بلا سياق مستخدم: مهام cron والترحيلات والدوال الداخلية.
  --     لا يُعتمد على current_user (دائماً postgres داخل SECURITY DEFINER).
  IF (v_claims IS NULL OR btrim(v_claims) = '')
     AND session_user IN ('postgres', 'supabase_admin') THEN
    RETURN p_company_id;
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_company_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_company_roles ucr
      WHERE ucr.user_id = v_user_id AND ucr.company_id = p_company_id
    ) THEN
      RAISE EXCEPTION 'Access denied: لا تملك صلاحية الوصول لبيانات هذه الشركة'
        USING ERRCODE = '42501';
    END IF;
    RETURN p_company_id;
  END IF;

  SELECT company_id INTO v_user_company_id
  FROM public.user_company_roles
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_user_company_id IS NULL THEN
    RAISE EXCEPTION 'User not associated with any company' USING ERRCODE = '42501';
  END IF;

  RETURN v_user_company_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_assert_company_access(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_claims text;
BEGIN
  v_claims := current_setting('request.jwt.claims', true);

  -- (1) مفتاح الخدمة الموثوق (انظر الشرح في verify_company_access أعلاه).
  IF v_claims IS NOT NULL AND btrim(v_claims) <> ''
     AND left(btrim(v_claims), 1) = '{'
     AND (v_claims::jsonb ->> 'role') = 'service_role' THEN
    RETURN;
  END IF;

  -- (2) جلسة داخلية مميّزة وبلا سياق مستخدم (cron/ترحيل) — نفس المنطق.
  IF (v_claims IS NULL OR btrim(v_claims) = '')
     AND session_user IN ('postgres', 'supabase_admin') THEN
    RETURN;
  END IF;

  -- المشرف العام يمتلك صلاحية الوصول لكافة المنشآت
  IF public.is_super_admin() THEN
    RETURN;
  END IF;

  -- التحقق من انتماء المستخدم إلى المنشأة
  IF NOT EXISTS (
    SELECT 1 FROM public.user_company_roles ucr
    WHERE ucr.user_id = auth.uid() AND ucr.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'access_denied: لا تملك صلاحية الوصول لبيانات هذه المنشأة'
      USING ERRCODE = '42501';
  END IF;

  -- التحقق من أن المنشأة نشطة وغير موقوفة
  IF NOT EXISTS (
    SELECT 1 FROM public.companies c
    WHERE c.id = p_company_id AND c.is_active = true
  ) THEN
    RAISE EXCEPTION 'access_denied: هذه المنشأة غير نشطة أو تم إيقاف تفعيلها. يرجى التواصل مع إدارة النظام'
      USING ERRCODE = '42501';
  END IF;
END;
$function$;

COMMIT;
