// ============================================
// excelTableColumnWidths — هوية الأعمدة وربط عروض المستخدم بها
// العرض المخصص يُحفظ بهوية العمود (accessorKey/header) لا بترتيبه، فيبقى
// على العمود نفسه عند إخفاء/إظهار أعمدة أو تغيّر ترتيبها أو إضافة أعمدة.
// ============================================
import type { Column } from './ExcelTable';

export type ColumnWidths = Record<string, number>;

/** هوية العمود: المفتاح الداخلي إن وُجد، وإلا العنوان، وإلا الترتيب كحل أخير */
export const getColumnId = <T>(col: Column<T> | undefined, idx: number): string => {
  const accessor = col?.accessorKey;
  if (accessor !== undefined && String(accessor) !== '') {
    return String(accessor);
  }
  const header = col?.header;
  if (header !== undefined && header !== '') {
    return header;
  }
  return String(idx);
};

/** هويات الأعمدة مع تمييز المتكرر بلاحقة حتى لا تتشارك الأعمدة المتماثلة عنواناً عرضاً واحداً */
export const getColumnIds = <T>(columns: Array<Column<T>>): string[] => {
  const seen = new Map<string, number>();
  return columns.map((col, idx) => {
    const base = getColumnId(col, idx);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : base + '#' + String(count + 1);
  });
};

/** العرض الافتراضي لكل عمود معرّفاً بهويته، مستخرجاً من أصناف Tailwind (w-72 ثم 288px) أو من رقم صريح */
export const buildDefaultColumnWidths = <T>(columns: Array<Column<T>>): ColumnWidths => {
  const entries: Array<[string, number]> = [];
  columns.forEach((col, idx) => {
    const width = col.width;
    if (width === undefined || width === '') return;
    const twMatch = /^w-(\d+)$/.exec(width);
    const parsed = twMatch ? parseInt(twMatch[1], 10) * 4 : parseInt(width, 10);
    if (!Number.isNaN(parsed)) entries.push([getColumnId(col, idx), parsed]);
  });
  return Object.fromEntries(entries);
};

/**
 * ترحيل حمولة قديمة محفوظة بمفاتيح ترتيب الأعمدة ("0","1",...) إلى مفاتيح الهوية.
 * تُهمل القيم المطابقة للعرض الافتراضي الحالي، لأن الإصدارات السابقة كانت تكتب
 * الافتراضيات تلقائياً عند كل فتح للجدول فإبقاؤها يمنع أي تحديث لاحق للافتراضي.
 */
export const migrateLegacyIndexWidths = (
  raw: ColumnWidths,
  columnIds: string[],
  defaultWidths: ColumnWidths
): ColumnWidths => {
  const ids = new Set(columnIds);
  const defaults = new Map(Object.entries(defaultWidths));
  const entries: Array<[string, number]> = [];
  Object.entries(raw).forEach(([key, value]) => {
    // مفتاح الترتيب يُترجم إلى هوية العمود في ذلك الترتيب، ويُهمل إن خرج عن المدى
    const id = ids.has(key) ? key : /^\d+$/.test(key) ? columnIds.at(Number(key)) : undefined;
    if (id === undefined || defaults.get(id) === value) return;
    entries.push([id, value]);
  });
  return Object.fromEntries(entries);
};

/** تحويل عروض بهوية الأعمدة إلى خريطة بترتيب الأعمدة (الصيغة التي تستهلكها الترويسة و colgroup) */
export const toIndexedWidths = (colWidths: ColumnWidths, columnIds: string[]): ColumnWidths => {
  const widths = new Map(Object.entries(colWidths));
  const entries: Array<[string, number]> = [];
  columnIds.forEach((id, idx) => {
    const width = widths.get(id);
    if (width !== undefined) entries.push([String(idx), width]);
  });
  return Object.fromEntries(entries);
};
