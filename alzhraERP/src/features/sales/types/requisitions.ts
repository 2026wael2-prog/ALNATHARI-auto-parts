// ============================================
// Sales Requisitions Types (المطلوبات)
// ============================================

/**
 * Real lifecycle of a saved requisition.
 * `draft` = saved but not handed to a supplier yet, `sent` = shared with the
 * supplier, `received` = supplier confirmed delivery, `cancelled` = abandoned.
 */
export type RequisitionStatus = 'draft' | 'sent' | 'received' | 'cancelled';

/**
 * Where a record came from: a numbered row on the server, or a local fallback
 * draft that could not be uploaded (offline / entity not deployed yet).
 */
export type RequisitionOrigin = 'server' | 'local';

export interface RequisitionItem {
  id: string;
  productId?: string | undefined;
  name: string;
  partNumber: string;
  brand: string;
  /** Positive number. 0 marks an invalid cell the user still has to fix. */
  quantity: number;
  notes?: string | undefined;
}

export interface RequisitionSupplier {
  id?: string | undefined;
  name: string;
  phone?: string | undefined;
}

/** The editable grid state persisted as a per-user, per-company draft. */
export interface RequisitionGridPayload {
  title: string;
  supplier: RequisitionSupplier | null;
  notes: string;
  items: RequisitionItem[];
}

/** What gets written to the server when the user saves the requisition. */
export interface RequisitionSavePayload {
  title: string;
  supplier: RequisitionSupplier | null;
  notes: string;
  items: readonly RequisitionItem[];
}

/** One row in the history list — server record or unsynced local draft. */
export interface RequisitionRecord {
  id: string;
  origin: RequisitionOrigin;
  /** Server document number (REQ-YYYY-NNNN); null for local drafts. */
  number: string | null;
  title: string;
  status: RequisitionStatus;
  supplier: RequisitionSupplier | null;
  notes: string;
  items: RequisitionItem[];
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string | undefined;
}

/** Outcome of a clipboard import so the UI can report skips honestly. */
export interface RequisitionImportResult {
  imported: number;
  duplicates: number;
  invalid: number;
}
