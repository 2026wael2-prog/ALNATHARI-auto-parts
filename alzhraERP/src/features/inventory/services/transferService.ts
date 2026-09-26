// Transfer Service - Handles stock transfer operations
import type { CreateTransferDTO } from '../types';
import { supabase } from '../../../lib/supabaseClient';

export const transferService = {
  /**
   * Create a new stock transfer
   */
  createTransfer: async (data: CreateTransferDTO) => {
    const { data: transfer, error } = await supabase.rpc('create_stock_transfer', {
      p_from_warehouse: data.from_warehouse_id,
      p_to_warehouse: data.to_warehouse_id,
      p_items: data.items,
      p_company_id: data.company_id,
      p_user_id: data.user_id,
      ...(data.notes !== undefined && { p_notes: data.notes }),
    });
    if (error) throw error;
    return transfer;
  },

  /**
   * Get all transfers for a company
   */
  getTransfers: async (companyId: string) => {
    const { data, error } = await supabase
      .from('stock_transfers')
      .select(
        `
                *,
                from_warehouse:warehouses!fk_stock_transfers_company_from_wh(name_ar),
                to_warehouse:warehouses!fk_stock_transfers_company_to_wh(name_ar),
                items:stock_transfer_items!fk_sti_company_transfer(*, product:products!fk_sti_company_product(name_ar, sku))
            `
      )
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
};

export default transferService;
