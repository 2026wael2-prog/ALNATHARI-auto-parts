/**
 * Sales Requisitions API (المطلوبات) — audit fixes F2 / F5
 * -------------------------------------------------------------------
 * A requisition used to live only in localStorage, so it had no official
 * number, was invisible to the rest of the ERP and could not survive a device
 * change. The server entity is the procurement table pair
 * `prc_purchase_requests` / `prc_purchase_request_items`, which already ships
 * with this database (baseline schema, RLS enabled under the standard
 * tenant-isolation policy, empty until this feature arrived).
 *
 * Writes go through `commit_sales_requisition` ONLY:
 *   * it numbers the document under a per-company advisory lock,
 *   * it is idempotent, so a double click cannot create two requisitions,
 *   * it writes an audit trail (audit_write + procurement_audit_logs),
 *   * it writes the header and its lines in ONE transaction.
 * There is deliberately no client-side insert fallback: inserting the header
 * and the lines separately would allow half-saved requisitions and duplicate
 * numbers.
 */

import { supabase } from '@/lib/supabaseClient';
import { parseError } from '@/core/utils/errorUtils';
import type { Json } from '@/core/database.types';
import type {
  RequisitionItem,
  RequisitionRecord,
  RequisitionSavePayload,
  RequisitionStatus,
} from '../types/requisitions';

/**
 * Status vocabulary accepted by `prc_purchase_requests.status`.
 * Source of truth: the live CHECK constraint `chk_pr_status` created by
 * `20260916000005_data_integrity_fixes.sql` — note it has `converted_to_rfq` /
 * `converted_to_po` and NO `closed`.
 */
export type ServerRequisitionStatus =
  | 'draft'
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'converted_to_rfq'
  | 'converted_to_po'
  | 'cancelled';

/** UI status -> server status. */
export const toServerStatus = (status: RequisitionStatus): ServerRequisitionStatus => {
  if (status === 'sent') return 'submitted';
  if (status === 'received') return 'approved';
  return status;
};

/** Server status -> UI status. `rejected` is not a UI state, it maps to cancelled. */
export const fromServerStatus = (status: string): RequisitionStatus => {
  switch (status) {
    case 'submitted':
    case 'in_review':
      return 'sent';
    case 'approved':
    case 'converted_to_rfq':
    case 'converted_to_po':
      return 'received';
    case 'rejected':
    case 'cancelled':
      return 'cancelled';
    default:
      return 'draft';
  }
};

/** Separator between the grid columns stored in a line description. */
export const REQUISITION_DESCRIPTION_SEPARATOR = ' | ';

export const serializeRequisitionItemDescription = (item: RequisitionItem): string => {
  const columns = [item.name, item.partNumber, item.brand, item.notes ?? ''];
  while (columns.length > 1 && columns[columns.length - 1]?.trim() === '') columns.pop();
  return columns.map(column => column.trim()).join(REQUISITION_DESCRIPTION_SEPARATOR);
};

export const parseRequisitionItemDescription = (
  description: string
): Pick<RequisitionItem, 'name' | 'partNumber' | 'brand' | 'notes'> => {
  const [name = '', partNumber = '', brand = '', ...rest] = description
    .split(REQUISITION_DESCRIPTION_SEPARATOR)
    .map(part => part.trim());
  return { name, partNumber, brand, notes: rest.join(REQUISITION_DESCRIPTION_SEPARATOR) };
}; /** Codes raised by the requisition RPCs, mapped to messages the user can act on. */
const REQUISITION_ERROR_MESSAGES: ReadonlyArray<readonly [string, string]> = [
  ['invalid_items', 'لا يمكن حفظ مطلوبات بدون بنود — أضف صنفاً واحداً على الأقل'],
  ['invalid_quantity', 'يوجد بند بكمية غير صحيحة: يجب أن تكون الكمية أكبر من صفر'],
  ['invalid_status', 'حالة الطلب غير صحيحة'],
  ['invalid_transition', 'لا يمكن إعادة فتح طلب مغلق أو ملغى'],
  ['requisition_not_found', 'لم يُعثر على الطلب في قاعدة البيانات — سيُحفظ كطلب جديد'],
  ['user_id_required', 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول'],
  ['company_id_required', 'تعذّر تحديد المنشأة الحالية'],
];

/**
 * Translates a server error into an actionable Arabic message. The RPC raises
 * `code: detail` messages, so the code is matched before falling back to the
 * shared error translator (which covers 23505 / 23503 / 42501 …).
 */
export const resolveRequisitionErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const known = REQUISITION_ERROR_MESSAGES.find(entry => raw.includes(entry[0]));
  if (known) return known[1];
  return parseError(error).message;
};

interface CommitRpcResponse {
  success?: boolean;
  error?: string;
  id?: string;
  pr_number?: string;
  status?: string;
  items_count?: number;
  total_estimated_value?: number;
  is_duplicate?: boolean;
}

export interface RequisitionCommitResult {
  recordId: string;
  number: string;
  status: RequisitionStatus;
  totalEstimatedValue: number;
  /** The server recognised a replay (same idempotency key) and changed nothing. */
  isDuplicate: boolean;
}

export interface CommitRequisitionInput {
  companyId: string;
  userId: string;
  /** Existing server record being edited (null = the grid is a new requisition). */
  recordId?: string | null;
  status?: RequisitionStatus;
  /** Stable key per save attempt: a double click reuses it and cannot duplicate. */
  idempotencyKey: string;
  branchId?: string | null;
  payload: RequisitionSavePayload;
}

interface PartyRow {
  id: string;
  name: string;
  phone: string | null;
}

interface ServerRow {
  pr_id: string;
  pr_number: string;
  title: string | null;
  justification: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  supplier_party_id: string | null;
}

interface ServerLineRow {
  pr_item_id: string;
  pr_id: string;
  description: string;
  quantity: number;
}

const toItemPayload = (item: RequisitionItem): Json => ({
  product_id: item.productId ?? null,
  name: item.name.trim(),
  description: serializeRequisitionItemDescription(item),
  quantity: item.quantity,
  uom: 'قطعة',
  unit_price: 0,
});

const toRequisitionRecord = (
  row: ServerRow,
  lines: readonly ServerLineRow[],
  supplier: PartyRow | null
): RequisitionRecord => {
  const items: RequisitionItem[] = lines.map(line => ({
    id: line.pr_item_id,
    ...parseRequisitionItemDescription(line.description),
    quantity: line.quantity,
  }));

  return {
    id: row.pr_id,
    origin: 'server',
    number: row.pr_number,
    title: row.title !== null && row.title.trim() !== '' ? row.title : row.pr_number,
    status: fromServerStatus(row.status),
    supplier: supplier
      ? { id: supplier.id, name: supplier.name, phone: supplier.phone ?? undefined }
      : null,
    notes: row.justification ?? '',
    items,
    itemCount: items.length,
    totalQuantity: items.reduce(
      (total, item) => total + (Number.isFinite(item.quantity) ? item.quantity : 0),
      0
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const fetchServerLines = async (requestIds: readonly string[]): Promise<ServerLineRow[]> => {
  const { data, error } = await supabase
    .from('prc_purchase_request_items')
    .select('pr_item_id, pr_id, description, quantity')
    .in('pr_id', requestIds);
  if (error) throw parseError(error);
  return data ?? [];
};

const fetchSupplierRows = async (supplierIds: readonly string[]): Promise<PartyRow[]> => {
  if (supplierIds.length === 0) return [];
  const { data, error } = await supabase
    .from('parties')
    .select('id, name, phone')
    .in('id', supplierIds);
  if (error) throw parseError(error);
  return data ?? [];
};

export const requisitionsApi = {
  /**
   * Create or update a requisition on the server. One transaction: header,
   * lines, number and audit trail all land together or not at all.
   */
  commitRequisition: async (input: CommitRequisitionInput): Promise<RequisitionCommitResult> => {
    if (!input.companyId) throw new Error('company_id_required');
    if (!input.userId) throw new Error('user_id_required');

    const { data, error } = await supabase.rpc('commit_sales_requisition', {
      p_company_id: input.companyId,
      p_user_id: input.userId,
      p_data: {
        idempotency_key: input.idempotencyKey,
        ...(input.recordId ? { pr_id: input.recordId } : {}),
        title: input.payload.title,
        notes: input.payload.notes,
        status: toServerStatus(input.status ?? 'draft'),
        branch_id: input.branchId ?? null,
        supplier_id: input.payload.supplier?.id ?? null,
        items: input.payload.items.map(toItemPayload),
      } as unknown as Json,
    });
    if (error) throw error;

    const response = (data ?? {}) as unknown as CommitRpcResponse;
    if (response.success !== true || !response.id || !response.pr_number) {
      throw new Error(response.error ?? 'requisition_not_found');
    }

    return {
      recordId: response.id,
      number: response.pr_number,
      status: fromServerStatus(response.status ?? 'draft'),
      totalEstimatedValue: response.total_estimated_value ?? 0,
      isDuplicate: response.is_duplicate === true,
    };
  },

  /** Move a requisition to another status (audited server side). */
  setRequisitionStatus: async (recordId: string, status: RequisitionStatus): Promise<void> => {
    const { data, error } = await supabase.rpc('set_sales_requisition_status', {
      p_pr_id: recordId,
      p_status: toServerStatus(status),
    });
    if (error) throw error;
    const response = (data ?? {}) as unknown as { success?: boolean; error?: string };
    if (response.success !== true) throw new Error(response.error ?? 'invalid_status');
  },

  /**
   * Server side history of the requisitions issued from the sales screen.
   * Plain joins (no PostgREST embeds) keep the typing honest: the table is
   * reached through scalar columns only.
   */
  listRequisitions: async (companyId: string, limit = 200): Promise<RequisitionRecord[]> => {
    if (!companyId) return [];

    const { data, error } = await supabase
      .from('prc_purchase_requests')
      .select(
        'pr_id, pr_number, title, justification, status, created_at, updated_at, supplier_party_id'
      )
      .eq('company_id', companyId)
      .eq('source', 'sales_requisitions')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw parseError(error);

    const rows = (data ?? []) as unknown as ServerRow[];
    if (rows.length === 0) return [];

    const supplierIds = Array.from(
      new Set(
        rows
          .map(row => row.supplier_party_id)
          .filter((id): id is string => id !== null && id !== undefined)
      )
    );

    const [lines, suppliers] = await Promise.all([
      fetchServerLines(rows.map(row => row.pr_id)),
      fetchSupplierRows(supplierIds),
    ]);

    const linesByRequest = new Map<string, ServerLineRow[]>();
    lines.forEach(line => {
      const bucket = linesByRequest.get(line.pr_id) ?? [];
      bucket.push(line);
      linesByRequest.set(line.pr_id, bucket);
    });
    const supplierById = new Map<string, PartyRow>(
      suppliers.map(supplier => [supplier.id, supplier])
    );

    return rows.map(row =>
      toRequisitionRecord(
        row,
        linesByRequest.get(row.pr_id) ?? [],
        row.supplier_party_id === null ? null : (supplierById.get(row.supplier_party_id) ?? null)
      )
    );
  },

  /** The number the next requisition will take — display only, never authoritative. */
  getNextRequisitionNumber: async (companyId: string): Promise<string | null> => {
    const { data, error } = await supabase.rpc('get_next_requisition_number', {
      p_company_id: companyId,
    });
    if (error) return null;
    return data;
  },
};
