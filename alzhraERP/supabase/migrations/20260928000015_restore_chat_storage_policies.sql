-- ============================================
-- استعادة سياسات التخزين لدلو المحادثات (chat-attachments)
-- ============================================
-- المكتشف بالتدقيق: مخطط storage فيه RLS مفعّلة على storage.objects لكن **صفر
-- سياسات** في القاعدة الحيّة، رغم أن الهجرة 20260825000006 تنشئ سياستين
-- مقيّدتين بالمنشأة. والنتيجة أن مسار الرفع الوحيد في التطبيق
-- (attachmentService.uploadAttachment → مسار "<companyId>/<messageId>/<file>")
-- مرفوض بالكامل، لأن غياب أي سياسة = منع. ويوجد كائن واحد فقط في التخزين كله.
--
-- كما أن هجرة 20260912000007 (المسجَّلة كمطبَّقة) تُنشئ سياسات منشأة لدلوّي
-- invoices وcompany-assets فقط، ولا تشمل chat-attachments — فأُعيد إنشاء
-- السياستين هنا بنفس تصميم الهجرة الأصلية (عزل بالمنشأة عبر أول مقطع من المسار).

BEGIN;

DROP POLICY IF EXISTS "chat_storage_insert" ON storage.objects;
CREATE POLICY "chat_storage_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'chat-attachments'
        AND (storage.foldername(name))[1] IN (
            SELECT ucr.company_id::text
            FROM public.user_company_roles ucr
            WHERE ucr.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "chat_storage_select" ON storage.objects;
CREATE POLICY "chat_storage_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'chat-attachments'
        AND (storage.foldername(name))[1] IN (
            SELECT ucr.company_id::text
            FROM public.user_company_roles ucr
            WHERE ucr.user_id = auth.uid()
        )
    );

COMMIT;
