// ============================================
// useColumnResize — Hook مشتركة لتغيير حجم أعمدة الجداول
// قابلة للاستخدام في أي جدول عبر storageKey مخصص
// v3: يُحفظ تخصيص المستخدم فقط (لا الافتراضيات) + إعادة مزامنة عند تغيّر المفتاح
//     + ترحيل المفاتيح القديمة + إظهار فشل التخزين بدل ابتلاعه بصمت
// v2: دعم RTL صريح + تحديثات rAF ناعمة 60fps + قياس فعلي للعرض
// ============================================
import { useState, useRef, useCallback, useEffect } from 'react';
import { logger } from '../../../core/utils/logger';

export type ColumnWidths = Record<string, number>;

interface UseColumnResizeOptions {
  /** مفتاح التخزين المحلي لحفظ عرض الأعمدة (بدون حفظ عند غيابه) */
  storageKey?: string;
  /** العرض الافتراضي لكل عمود بالبكسل */
  defaultWidths?: ColumnWidths;
  /** الحد الأدنى لعرض أي عمود */
  minWidth?: number;
  /** اتجاه RTL صريح — عند غيابه يُكتشف من document.dir */
  isRTL?: boolean;
  /**
   * ترحيل اختياري لحمولة محفوظة بمفاتيح قديمة (مثل ترتيب الأعمدة) إلى مفاتيح الهوية.
   * يُطبَّق عند التحميل فقط.
   */
  migrateRaw?: ((raw: ColumnWidths) => ColumnWidths) | undefined;
}

interface UseColumnResizeReturn {
  colWidths: ColumnWidths;
  /** هل يوجد سحب جارٍ حالياً؟ (لتفعيل تحسينات الأداء مثل will-change) */
  isResizing: boolean;
  /** ربطها بحدث onMouseDown على مقبض تغيير الحجم في كل عمود */
  onResizeMouseDown: (e: React.MouseEvent, field: string) => void;
  /** إعادة العروض إلى الافتراضية ومسح تخصيص المستخدم المحفوظ */
  resetWidths: () => void;
}

/** حالة مستعادة من التخزين: العروض النهائية + الحقول التي خصّصها المستخدم */
interface StoredWidths {
  widths: ColumnWidths;
  customFields: string[];
}

/**
 * يقرأ العروض المحفوظة ويدمجها فوق الافتراضية.
 * يُستبعد أي عرض محفوظ أصغر من الحد الأدنى: أصغر عرض قابل للسحب هو minWidth،
 * فما دون ذلك لا ينتج إلا عن انضغاط تلقائي لعمود بلا عرض صريح في تخطيط table-fixed.
 */
const readStoredWidths = (
  storageKey: string | undefined,
  defaultWidths: ColumnWidths,
  minWidth: number,
  migrateRaw?: (raw: ColumnWidths) => ColumnWidths
): StoredWidths => {
  if (storageKey === undefined || storageKey === '') {
    return { widths: { ...defaultWidths }, customFields: [] };
  }
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { widths: { ...defaultWidths }, customFields: [] };
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') {
      return { widths: { ...defaultWidths }, customFields: [] };
    }
    const parsedWidths = parsed as ColumnWidths;
    const migrated = migrateRaw ? migrateRaw(parsedWidths) : parsedWidths;
    const usable = Object.entries(migrated).filter(
      ([, width]) => typeof width === 'number' && Number.isFinite(width) && width >= minWidth
    );
    return {
      widths: { ...defaultWidths, ...Object.fromEntries(usable) },
      customFields: usable.map(([field]) => field),
    };
  } catch {
    return { widths: { ...defaultWidths }, customFields: [] };
  }
};
/**
 * useColumnResize — قابل لإعادة الاستخدام في أي جدول عبر storageKey مخصص
 * - تحديثات rAF ناعمة أثناء السحب
 * - يحفظ ما خصّصه المستخدم فقط، فلا تطمر الافتراضيات تخصيصاته عند كل فتح للجدول
 */
export const useColumnResize = ({
  storageKey,
  defaultWidths = {},
  minWidth = 40,
  isRTL,
  migrateRaw,
}: UseColumnResizeOptions): UseColumnResizeReturn => {
  const [initialStored] = useState<StoredWidths>(() =>
    readStoredWidths(storageKey, defaultWidths, minWidth, migrateRaw)
  );
  const [colWidths, setColWidths] = useState<ColumnWidths>(initialStored.widths);
  const [isResizing, setIsResizing] = useState(false);

  const resizingRef = useRef<{ field: string; startX: number; startWidth: number } | null>(null);
  const lastDeltaRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const minWidthRef = useRef(minWidth);
  const isRtlRef = useRef(
    typeof isRTL === 'boolean'
      ? isRTL
      : typeof document !== 'undefined'
        ? document.dir === 'rtl'
        : false
  );
  // مراجع للقيم التي تتغيّر هويتها في كل رسم (تُبنى في مكان الاستدعاء من الأعمدة)
  const defaultWidthsRef = useRef(defaultWidths);
  const migrateRawRef = useRef(migrateRaw);
  // الحقول التي خصّصها المستخدم — لا يُحفظ غيرها حتى لا تطمر الافتراضيات تخصيصاته
  const customFieldsRef = useRef<Set<string>>(new Set(initialStored.customFields));
  // المفتاح الذي تعبّر عنه الحالة الحالية (لمنع كتابة عروض جدول فوق محفوظات جدول آخر)
  const stateKeyRef = useRef(storageKey);

  minWidthRef.current = minWidth;
  if (typeof isRTL === 'boolean') isRtlRef.current = isRTL;
  defaultWidthsRef.current = defaultWidths;
  migrateRawRef.current = migrateRaw;

  // إعادة المزامنة عند تغيّر مفتاح التخزين (جدول آخر أو عنوان يتغيّر مع البيانات):
  // بدونها تبقى عروض الجدول السابق في الحالة ثم تُكتب فوق محفوظات الجدول الجديد.
  useEffect(() => {
    if (stateKeyRef.current === storageKey) return;
    stateKeyRef.current = storageKey;
    const stored = readStoredWidths(
      storageKey,
      defaultWidthsRef.current,
      minWidthRef.current,
      migrateRawRef.current
    );
    customFieldsRef.current = new Set(stored.customFields);
    setColWidths(stored.widths);
  }, [storageKey]);

  // حفظ تخصيصات المستخدم فقط. لا يُكتب شيء عند الفتح إن لم يعدّل المستخدم شيئاً،
  // وبذلك تبقى آخر قيم وزّنها المستخدم ولا تطمرها الافتراضيات.
  useEffect(() => {
    if (storageKey === undefined || storageKey === '' || stateKeyRef.current !== storageKey) {
      return;
    }
    if (customFieldsRef.current.size === 0) return;
    try {
      // يُحفظ ما خصّصه المستخدم فقط — دمج حسب حقول التخصيص المسجّلة
      const payload = Object.fromEntries(
        Object.entries(colWidths).filter(([field]) => customFieldsRef.current.has(field))
      );
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (error) {
      logger.warn('useColumnResize', 'تعذّر حفظ تخصيص عروض الأعمدة في التخزين المحلي', error);
    }
  }, [colWidths, storageKey]);
  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!resizingRef.current) return;
    lastDeltaRef.current = e.pageX - resizingRef.current.startX;

    // تحديث واحد لكل إطار (rAF) لتفادي إعادة الرسم المزدحمة
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const ref = resizingRef.current;
      if (!ref) return;
      const delta = lastDeltaRef.current;
      const newWidth = Math.max(
        minWidthRef.current,
        Math.round(ref.startWidth + (isRtlRef.current ? -delta : delta))
      );
      // تسجيل الحقل كمخصّص من المستخدم حتى يُحفظ ولا تُفقد باقي تخصيصاته
      customFieldsRef.current.add(ref.field);
      setColWidths(prev =>
        prev[ref.field] === newWidth ? prev : { ...prev, [ref.field]: newWidth }
      );
    });
  }, []);

  const onMouseUp = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    resizingRef.current = null;
    lastDeltaRef.current = 0;
    setIsResizing(false);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [onMouseMove]);

  // تنظيف المستمعين وإطار الرسم عند إلغاء التحميل
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [onMouseMove, onMouseUp]);

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent, field: string) => {
      e.preventDefault();
      e.stopPropagation();
      // المقبض عنصر داخل الـ th، فنصعد منه إلى الخلية لقياس عرضها الفعلي
      const th = e.target instanceof HTMLElement ? e.target.closest('th') : null;
      if (!th) return;
      resizingRef.current = { field, startX: e.pageX, startWidth: th.offsetWidth };
      setIsResizing(true);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    },
    [onMouseMove, onMouseUp]
  );

  const resetWidths = useCallback(() => {
    customFieldsRef.current = new Set();
    setColWidths({ ...defaultWidthsRef.current });
    if (storageKey === undefined || storageKey === '') return;
    try {
      localStorage.removeItem(storageKey);
    } catch (error) {
      logger.warn('useColumnResize', 'تعذّر مسح تخصيص عروض الأعمدة المحفوظ', error);
    }
  }, [storageKey]);

  return { colWidths, isResizing, onResizeMouseDown, resetWidths };
};
