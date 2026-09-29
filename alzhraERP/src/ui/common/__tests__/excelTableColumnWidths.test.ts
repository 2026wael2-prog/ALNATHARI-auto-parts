/**
 * Tests لربط عروض الأعمدة بهوية العمود (لا بترتيبه) ولترحيل الحمولات القديمة.
 * يغطي: استخراج الهوية، تمييز العناوين المتكررة، استخراج الافتراضي من أصناف Tailwind،
 * ترحيل مفاتيح الترتيب القديمة، وإسقاط الافتراضيات القديمة حتى لا تطمر تحديثها.
 */
import { describe, expect, it } from 'vitest';
import type { Column } from '../ExcelTable';
import {
  buildDefaultColumnWidths,
  getColumnId,
  getColumnIds,
  migrateLegacyIndexWidths,
  toIndexedWidths,
} from '../excelTableColumnWidths';

const col = (header: string, width?: string, accessorKey?: string): Column<unknown> => ({
  header,
  accessor: () => null,
  ...(width === undefined ? {} : { width }),
  ...(accessorKey === undefined ? {} : { accessorKey }),
});

describe('getColumnId', () => {
  it('يفضّل accessorKey ثم العنوان ثم الترتيب', () => {
    expect(getColumnId(col('سعر البيع', 'w-28', 'sale_price'), 3)).toBe('sale_price');
    expect(getColumnId(col('اسم القطعة', 'w-72'), 1)).toBe('اسم القطعة');
    expect(getColumnId(col(''), 2)).toBe('2');
    expect(getColumnId(undefined, 5)).toBe('5');
  });
});

describe('getColumnIds', () => {
  it('يميّز الأعمدة المتكررة العنوان بلاحقة حتى لا تتشارك عرضاً واحداً', () => {
    expect(
      getColumnIds([col('المخزون'), col('المخزون'), col('المخزون', undefined, 'qty')])
    ).toEqual(['المخزون', 'المخزون#2', 'qty']);
  });
});

describe('buildDefaultColumnWidths', () => {
  it('يترجم أصناف Tailwind إلى بكسل ويستخدم هوية العمود مفتاحاً', () => {
    expect(buildDefaultColumnWidths([col('اسم القطعة', 'w-72'), col('المقاس', 'w-20')])).toEqual({
      'اسم القطعة': 288,
      المقاس: 80,
    });
  });

  it('يقبل العرض الرقمي الصريح ويهمل غير الصالح', () => {
    expect(buildDefaultColumnWidths([col('أ', '150'), col('ب', 'auto'), col('ج')])).toEqual({
      أ: 150,
    });
  });
});

describe('migrateLegacyIndexWidths', () => {
  const ids = ['اسم القطعة', 'سعر البيع'];
  const defaults = { 'اسم القطعة': 288, 'سعر البيع': 112 };

  it('يحوّل مفاتيح ترتيب الأعمدة القديمة إلى مفاتيح هوية', () => {
    expect(migrateLegacyIndexWidths({ 0: 420, 1: 200 }, ids, defaults)).toEqual({
      'اسم القطعة': 420,
      'سعر البيع': 200,
    });
  });

  it('يبقي المفاتيح المعرّفة بالهوية كما هي', () => {
    expect(migrateLegacyIndexWidths({ 'سعر البيع': 260 }, ids, defaults)).toEqual({
      'سعر البيع': 260,
    });
  });

  it('يُسقط القيم المطابقة للافتراضي الحالي لأنها كانت تُكتب تلقائياً في السابق', () => {
    expect(migrateLegacyIndexWidths({ 0: 288, 1: 200 }, ids, defaults)).toEqual({
      'سعر البيع': 200,
    });
  });

  it('يُسقط المفاتيح غير المعروفة والخارجة عن عدد الأعمدة', () => {
    expect(migrateLegacyIndexWidths({ 7: 300, 'عمود محذوف': 300, '': 300 }, ids, defaults)).toEqual(
      {}
    );
  });
});

describe('toIndexedWidths', () => {
  it('يحوّل خريطة الهوية إلى خريطة ترتيب للترويسة و colgroup', () => {
    expect(toIndexedWidths({ 'سعر البيع': 260 }, ['اسم القطعة', 'سعر البيع'])).toEqual({ 1: 260 });
  });

  it('يعيد كائناً فارغاً عند غياب أي عرض مخصص', () => {
    expect(toIndexedWidths({}, ['اسم القطعة', 'سعر البيع'])).toEqual({});
  });

  it('يبقي العرض على عموده الصحيح عند إخفاء عمود آخر (بلا انزياح)', () => {
    const columns = [col('اسم القطعة', 'w-72'), col('رقم القطعة', 'w-32'), col('المقاس', 'w-20')];
    const widths = { المقاس: 260 };
    const visible = columns.filter(column => column.header !== 'رقم القطعة');

    expect(toIndexedWidths(widths, getColumnIds(visible))).toEqual({ 1: 260 });
  });
});
