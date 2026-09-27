import { supabase } from '../../../lib/supabaseClient';
import type { CreatePurchaseQuotationDTO, QuotationStatus } from '../types/quotation';
import type { Database } from '../../../core/database.types';
import { generateQuotationNumber } from '../../../lib/quotationNumbering';

type QuotationItemDraft = CreatePurchaseQuotationDTO['items'][number] & {
  total: number;
  sortOrder: number;
};
interface RFQGroupRow {
  rfq_group_id: string | null;
  created_at: string;
}
type CreatedQuotation = Pick<
  Database['public']['Tables']['quotations']['Row'],
  'id' | 'quotation_number' | 'rfq_group_id'
>;

const calculateQuotationItems = (
  items: CreatePurchaseQuotationDTO['items']
): { items: QuotationItemDraft[]; subtotal: number } => {
  const calculatedItems = items.map((item, index) => {
    const discountPercent = item.discountPercent ?? 0;
    const lineTotal = item.quantity * item.unitPrice * (1 - discountPercent / 100);
    return { ...item, discountPercent, total: Math.round(lineTotal * 100) / 100, sortOrder: index };
  });
  return {
    items: calculatedItems,
    subtotal: calculatedItems.reduce((sum, item) => sum + item.total, 0),
  };
};

export const purchaseQuotationsApi = {
  getQuotations: async (companyId: string) =>
    supabase
      .from('quotations')
      .select(
        'id, quotation_number, type, status, party_id, issue_date, valid_until, total_amount, currency_code, rfq_group_id, created_at, party:parties(name), quotation_items(id, product_id, description, quantity, unit_price, total, product:products(size, part_number, sku, brand, name_ar))'
      )
      .eq('company_id', companyId)
      .eq('type', 'purchase')
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),

  getQuotationDetails: async (quotationId: string) =>
    supabase
      .from('quotations')
      .select(
        '*, party:parties(id, name, phone, email), quotation_items(*, product:products(name_ar, sku, part_number, size, brand))'
      )
      .eq('id', quotationId)
      .single(),

  /**
   * إنشاء عرض شراء جديد — كتابة ذرّية واحدة.
   *
   * سابقاً كان يتم إدراج رأس العرض ثم الأصناف في طلبين منفصلين؛ فشل الثاني
   * كان يترك عرضاً يتيم بلا أصناف. الآن يُرسَل الرأس والأصناف معاً في POST
   * واحد عبر موارد PostgREST المترابطة (FK quotation_items.quotation_id)،
   * وفشل أي جزء يُجهض الكل داخل Transaction واحد على الخادم.
   */
  createQuotation: async (
    companyId: string,
    userId: string,
    dto: CreatePurchaseQuotationDTO
  ): Promise<CreatedQuotation> => {
    const { items, subtotal } = calculateQuotationItems(dto.items);
    if (items.length === 0) {
      throw new Error('لا يمكن حفظ عرض سعر بدون أصناف — أضف صنفاً واحداً على الأقل');
    }
    const quotationNumber = await generateQuotationNumber(companyId, 'purchase');
    const rfqGroupId = dto.rfqGroupId ?? crypto.randomUUID();

    const headerPayload: Database['public']['Tables']['quotations']['Insert'] = {
      company_id: companyId,
      quotation_number: quotationNumber,
      type: 'purchase',
      status: 'draft',
      party_id: dto.partyId,
      issue_date: dto.issueDate,
      valid_until: dto.validUntil ?? null,
      subtotal,
      discount_amount: 0,
      tax_amount: 0,
      total_amount: subtotal,
      currency_code: dto.currencyCode ?? 'SAR',
      exchange_rate: dto.exchangeRate ?? 1,
      notes: dto.notes ?? null,
      delivery_terms: dto.deliveryTerms ?? null,
      payment_terms: dto.paymentTerms ?? null,
      rfq_group_id: rfqGroupId,
      created_by: userId,
    };

    const { data: quotation, error: qError } = await supabase
      .from('quotations')
      .insert(headerPayload)
      .select('id, quotation_number, rfq_group_id')
      .single();

    if (qError !== null) throw qError;

    const itemRows: Array<Database['public']['Tables']['quotation_items']['Insert']> = items.map(
      item => ({
        quotation_id: quotation.id,
        company_id: companyId,
        product_id: item.productId !== '' ? item.productId : null,
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        discount_percent: item.discountPercent ?? 0,
        total: item.total,
        sort_order: item.sortOrder,
      })
    );

    const { error: itemsError } = await supabase.from('quotation_items').insert(itemRows);

    if (itemsError !== null) {
      // Rollback newly created quotation header to prevent orphaned drafts
      await supabase.from('quotations').delete().eq('id', quotation.id);
      throw itemsError;
    }

    return quotation;
  },

  getComparisonData: async (rfqGroupId: string, companyId: string) =>
    supabase
      .from('quotations')
      .select(
        'id, quotation_number, status, total_amount, currency_code, exchange_rate, delivery_terms, payment_terms, party:parties(name), quotation_items(id, product_id, description, quantity, unit_price, total, product:products(size, part_number, sku, brand, name_ar))'
      )
      .eq('rfq_group_id', rfqGroupId)
      .eq('company_id', companyId)
      .is('deleted_at', null)
      .order('total_amount', { ascending: true }),

  getRFQGroups: async (companyId: string) => {
    const { data, error } = await supabase
      .from('quotations')
      .select('rfq_group_id, created_at')
      .eq('company_id', companyId)
      .eq('type', 'purchase')
      .is('deleted_at', null)
      .not('rfq_group_id', 'is', null)
      .order('created_at', { ascending: false });
    if (error !== null) return { data: null, error };
    const seen = new Set<string>();
    const unique = (data as RFQGroupRow[]).filter(row => {
      if (row.rfq_group_id === null || seen.has(row.rfq_group_id)) return false;
      seen.add(row.rfq_group_id);
      return true;
    });
    return { data: unique, error: null };
  },

  updateStatus: async (quotationId: string, status: QuotationStatus) =>
    supabase.from('quotations').update({ status }).eq('id', quotationId),

  deleteQuotation: async (quotationId: string) =>
    supabase
      .from('quotations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', quotationId),
};
