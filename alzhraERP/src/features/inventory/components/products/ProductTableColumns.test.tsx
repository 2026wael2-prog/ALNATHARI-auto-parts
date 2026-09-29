import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getProductColumns } from './ProductTableColumns';
import type { Product } from '../../types';

const longNamedProduct = {
  id: 'p1',
  name: 'غطاء تانكي وقود خلفي أصلي ماركة تويوتا لاندكروزر موديل 2018 رقم 77001-60C41',
  name_ar: 'غطاء تانكي وقود خلفي أصلي ماركة تويوتا لاندكروزر موديل 2018 رقم 77001-60C41',
  brand: 'F.T.R',
  part_number: '77001-60C41',
  size: null,
  category: 'عام',
  location: 'المستودع الرئيسي',
  stock_quantity: 3,
  min_stock_level: 2,
  cost_price: 120,
  sale_price: 150,
  is_core: false,
  isLowStock: false,
} as unknown as Product;

const fullName = (product: Product) => product.name_ar || product.name || '';

const nameColumn = () => getProductColumns({}).find(column => column.sortKey === 'name');

describe('getProductColumns — عمود اسم القطعة', () => {
  it('يملك عرضاً صريحاً بصيغة w-<رقم> قابلة للتحويل إلى بكسل', () => {
    // الهدف: منع انضغاط العمود في تخطيط table-fixed. بدون عرض صريح يُعصر العمود
    // إلى أدنى عرض ممكن (~26px) فتختفي أسماء المنتجات، ويصبح عرض الجدول الكلي
    // رهينةً للمحتوى فينزاح الجدول عند ظهور/اختفاء أشرطة التمرير.
    // ExcelTable يترجم أصناف العرض من الصيغة w-<رقم> فقط، لذا نفحص ذات الصيغة.
    const column = nameColumn();
    expect(column, 'يجب أن يوجد عمود اسم القطعة').toBeDefined();
    expect(column?.width, 'عمود اسم القطعة يحتاج عرضاً صريحاً').toMatch(/^w-\d+$/);
    const px = parseInt(String(column?.width).replace('w-', ''), 10) * 4;
    expect(px).toBeGreaterThanOrEqual(240);
  });

  it('يعرض اسم المنتج نصّاً، ويوفّر الاسم الكامل في title عند قصّه', () => {
    const column = nameColumn();
    const { container } = render(<div>{column?.accessor(longNamedProduct)}</div>);
    const titleSpan = container.querySelector('span[title]');

    expect(titleSpan).not.toBeNull();
    expect(titleSpan?.getAttribute('title')).toBe(fullName(longNamedProduct));
    expect(screen.getByText(fullName(longNamedProduct))).toBeInTheDocument();
    // القصّ يعتمد على truncate، فلا يزيد النص الطويل عرض العمود
    expect(titleSpan?.className).toContain('truncate');
  });
});
