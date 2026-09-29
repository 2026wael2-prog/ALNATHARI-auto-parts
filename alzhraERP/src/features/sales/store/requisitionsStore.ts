/* eslint-disable complexity, max-lines-per-function */
// ============================================
// Sales Requisitions Store (المطلوبات)
// ============================================
// Editable draft of the requisition grid. Audit finding F1: the old store
// persisted to a single GLOBAL localStorage key (`alzhra_sales_requisitions_v1`),
// so any user or company signing in on the same browser inherited the previous
// user's requisitions. The key is now scoped to company + user, and the legacy
// global key is purged on first read.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { StateStorage } from 'zustand/middleware';
import type {
  RequisitionGridPayload,
  RequisitionImportResult,
  RequisitionItem,
  RequisitionOrigin,
  RequisitionRecord,
  RequisitionSupplier,
} from '../types/requisitions';
import {
  filledRequisitionItems,
  requisitionItemKey,
  sumRequisitionQuantities,
} from '../utils/requisitionsValidation';
import { formatLocalDate } from '@/core/utils/dateUtils';
import { normalizeArabicDigits, parseNumberFlexible } from '@/core/utils';
import { logger } from '@/core/utils/logger';
import { useAuthStore } from '@/features/auth/store';
import { requisitionsApi, resolveRequisitionErrorMessage } from '../api/requisitionsApi';

/** Storage key prefix — mirrors `draftStorage` scoping (company + user isolation). */
export const REQUISITIONS_DRAFT_PREFIX = 'sales_requisitions:';

/** Pre-F1 key: global, never scoped, therefore purged on first read. */
const LEGACY_STORAGE_KEY = 'alzhra_sales_requisitions_v1';

const DEFAULT_ROW_COUNT = 5;

export const createEmptyRequisitionItem = (): RequisitionItem => ({
  id: crypto.randomUUID(),
  name: '',
  partNumber: '',
  brand: '',
  quantity: 1,
  notes: '',
});

export const createEmptyRequisitionRows = (count: number): RequisitionItem[] =>
  Array.from({ length: Math.max(1, count) }, createEmptyRequisitionItem);

/** Company + user scope of the signed-in session. */
export const resolveRequisitionsScope = (): string => {
  const { user } = useAuthStore.getState();
  return (user?.company_id ?? 'no-company') + ':' + (user?.id ?? 'anonymous');
};

// Storage failures (quota exceeded / private browsing) must be visible to the
// user instead of silently dropping the draft. Handlers are registered after
// the store exists to avoid a forward reference to it.
const storageFailureHandlers: Array<() => void> = [];
const reportStorageFailure = (): void => {
  storageFailureHandlers.forEach(handler => {
    handler();
  });
};

const purgeLegacyKey = (): void => {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Private browsing — nothing to purge.
  }
};

const scopedKey = (name: string): string =>
  REQUISITIONS_DRAFT_PREFIX + resolveRequisitionsScope() + ':' + name;

// Storage writes must be suspended while the company/user scope changes:
// otherwise the "clear the previous scope" reset below would be persisted into
// the *new* scope key and destroy the draft we are about to rehydrate.
let suspendWrites = false;

const scopedStorage: StateStorage = {
  getItem: name => {
    purgeLegacyKey();
    try {
      return localStorage.getItem(scopedKey(name));
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    if (suspendWrites) return;
    try {
      localStorage.setItem(scopedKey(name), value);
    } catch {
      reportStorageFailure();
    }
  },
  removeItem: name => {
    try {
      localStorage.removeItem(scopedKey(name));
    } catch {
      // ignore
    }
  },
};

/** Outcome of a save attempt, so the UI can report exactly what happened. */
export interface RequisitionSaveOutcome {
  /** True = the document is on the server with an official number. */
  uploaded: boolean;
  record: RequisitionRecord;
  /** Arabic explanation of why the record stayed local (null when uploaded). */
  error: string | null;
}

interface RequisitionsState {
  items: RequisitionItem[];
  supplier: RequisitionSupplier | null;
  notes: string;
  /** Document title printed/exported/shared with the requisition. */
  title: string;
  /** Local drafts kept while the server entity is still unavailable. */
  localDrafts: RequisitionRecord[];
  /** Number of the server document this grid was last saved as / loaded from. */
  serverNumber: string | null;
  /** Record id backing the current grid (server id or local draft id). */
  serverRecordId: string | null;
  /**
   * Server-only id of the document backing this grid. Kept apart from
   * `serverRecordId` because a local draft id must NEVER be sent to the
   * server as `pr_id` — that would look like "requisition not found" and the
   * save would silently degrade to local-only for ever (audit F5).
   */
  serverBackedId: string | null;
  /** True when the browser refused to persist the draft (quota / private mode). */
  storageWarning: boolean;

  addItem: (initial?: Partial<RequisitionItem>) => void;
  updateItem: (id: string, updates: Partial<RequisitionItem>) => void;
  removeItem: (id: string) => void;
  duplicateItem: (id: string) => void;
  /** Id based reorder (audit F4): index based moves broke after filtering. */
  moveItem: (id: string, direction: 'up' | 'down') => void;
  clearItems: () => void;
  ensureMinimumRows: (count?: number) => void;

  setSupplier: (supplier: RequisitionSupplier | null) => void;
  setNotes: (notes: string) => void;
  setTitle: (title: string) => void;

  /** Load an existing record (history) back into the editable grid. */
  loadIntoGrid: (
    payload: RequisitionGridPayload,
    origin?: {
      number?: string | null;
      recordId?: string | null;
      /** Whether that record already exists on the server (audit F5). */
      recordOrigin?: RequisitionOrigin;
    }
  ) => void;

  saveLocalDraft: () => RequisitionRecord;
  /**
   * Save the grid on the server (audit F2/F5): official number, idempotent,
   * audited. Falls back to a device-only local draft when the server refuses or
   * is unreachable and reports which of the two happened.
   */
  saveRequisition: (options?: { idempotencyKey?: string }) => Promise<RequisitionSaveOutcome>;
  deleteLocalDraft: (id: string) => void;
  markServerSaved: (recordId: string, number: string) => void;
  dismissStorageWarning: () => void;
  resetGrid: () => void;

  importFromText: (text: string) => RequisitionImportResult;
}

const buildDraftTitle = (): string => 'طلب مشتريات - ' + formatLocalDate();

type GridSlice = Pick<
  RequisitionsState,
  'items' | 'supplier' | 'notes' | 'title' | 'serverNumber' | 'serverRecordId' | 'serverBackedId'
>;

const initialGrid = (): GridSlice => ({
  items: createEmptyRequisitionRows(DEFAULT_ROW_COUNT),
  supplier: null,
  notes: '',
  title: buildDraftTitle(),
  serverNumber: null,
  serverRecordId: null,
  serverBackedId: null,
});

/** Splits one clipboard line into the five grid columns. */
const parseImportedLine = (
  line: string
): { item: RequisitionItem; quantityIsValid: boolean } | null => {
  const delimiter = line.includes('\t') ? '\t' : line.includes(',') ? ',' : null;
  const parts = (delimiter === null ? [line] : line.split(delimiter)).map(part => part.trim());
  const name = parts[0] ?? '';
  const partNumber = (parts[1] ?? '').toUpperCase();
  if (name === '' && partNumber === '') return null;

  const rawQuantity = parts[3] ?? '';
  const parsedQuantity =
    rawQuantity === '' ? 1 : parseNumberFlexible(normalizeArabicDigits(rawQuantity));
  const quantityIsValid = Number.isFinite(parsedQuantity) && parsedQuantity > 0;

  return {
    item: {
      id: crypto.randomUUID(),
      name,
      partNumber,
      brand: parts[2] ?? '',
      // 0 keeps an unusable quantity visible to the user (audit F17) instead of
      // silently pretending the requested quantity is 1.
      quantity: quantityIsValid ? parsedQuantity : 0,
      notes: parts.slice(4).join(' ').trim(),
    },
    quantityIsValid,
  };
};

export const useRequisitionsStore = create<RequisitionsState>()(
  persist(
    (set, get) => ({
      ...initialGrid(),
      localDrafts: [],
      storageWarning: false,

      addItem: initial => {
        set(state => ({ items: [...state.items, { ...createEmptyRequisitionItem(), ...initial }] }));
      },

      updateItem: (id, updates) => {
        set(state => ({
          items: state.items.map(item => (item.id === id ? { ...item, ...updates } : item)),
        }));
      },

      removeItem: id => {
        set(state => {
          const next = state.items.filter(item => item.id !== id);
          return { items: next.length > 0 ? next : createEmptyRequisitionRows(1) };
        });
      },

      duplicateItem: id => {
        set(state => {
          const index = state.items.findIndex(item => item.id === id);
          const source = state.items.find(item => item.id === id);
          if (index === -1 || source === undefined) return state;
          const clone: RequisitionItem = { ...source, id: crypto.randomUUID() };
          const next = [...state.items];
          next.splice(index + 1, 0, clone);
          return { items: next };
        });
      },

      moveItem: (id, direction) => {
        set(state => {
          const index = state.items.findIndex(item => item.id === id);
          if (index === -1) return state;
          const target = direction === 'up' ? index - 1 : index + 1;
          if (target < 0 || target >= state.items.length) return state;
          const next = [...state.items];
          // `index` was validated above, so splice always yields exactly the row.
          const [row] = next.splice(index, 1);
          next.splice(target, 0, row);
          return { items: next };
        });
      },

      clearItems: () => {
        set(initialGrid());
      },

      ensureMinimumRows: (count = DEFAULT_ROW_COUNT) => {
        set(state => {
          const filled = filledRequisitionItems(state.items).length;
          const missing = Math.max(0, count - filled);
          if (missing === 0) return state;
          return { items: [...state.items, ...createEmptyRequisitionRows(missing)] };
        });
      },

      setSupplier: supplier => {
        set({ supplier });
      },
      setNotes: notes => {
        set({ notes });
      },
      setTitle: title => {
        set({ title });
      },

      loadIntoGrid: (payload, origin) => {
        const rows = payload.items.length > 0 ? payload.items : createEmptyRequisitionRows(1);
        set({
          title: payload.title.trim() === '' ? buildDraftTitle() : payload.title,
          supplier: payload.supplier,
          notes: payload.notes,
          items: rows.map(item => ({ ...item, id: crypto.randomUUID() })),
          serverNumber: origin?.number ?? null,
          serverRecordId: origin?.recordId ?? null,
          serverBackedId: origin?.recordOrigin === 'server' ? origin.recordId ?? null : null,
        });
      },

      saveLocalDraft: () => {
        const state = get();
        const items = filledRequisitionItems(state.items);
        const now = new Date().toISOString();
        const record: RequisitionRecord = {
          id: state.serverRecordId ?? crypto.randomUUID(),
          origin: 'local',
          number: state.serverNumber,
          title: state.title.trim() === '' ? buildDraftTitle() : state.title,
          status: 'draft',
          supplier: state.supplier,
          notes: state.notes,
          items: items.length > 0 ? items : state.items,
          itemCount: items.length,
          totalQuantity: sumRequisitionQuantities(items),
          createdAt: now,
          updatedAt: now,
        };
        set(current => ({
          localDrafts: [record, ...current.localDrafts.filter(draft => draft.id !== record.id)],
          serverRecordId: record.id,
        }));
        return record;
      },

      saveRequisition: async options => {
        const state = get();
        const { user } = useAuthStore.getState();
        const companyId = user?.company_id ?? '';
        const userId = user?.id ?? '';
        const items = filledRequisitionItems(state.items);
        const title = state.title.trim() === '' ? buildDraftTitle() : state.title;

        if (items.length === 0) {
          return {
            uploaded: false,
            record: get().saveLocalDraft(),
            error: 'لا يوجد بند صالح للحفظ — أكمل بيانات صنف واحد على الأقل',
          };
        }

        if (companyId === '' || userId === '') {
          return {
            uploaded: false,
            record: get().saveLocalDraft(),
            error: 'تعذّر تحديد المنشأة أو المستخدم الحالي، تم الحفظ على هذا الجهاز فقط',
          };
        }

        try {
          const result = await requisitionsApi.commitRequisition({
            companyId,
            userId,
            // Only a server id may be sent: a local draft id would look like a
            // foreign document and the save would degrade to local-only for ever.
            recordId: state.serverBackedId,
            idempotencyKey: options?.idempotencyKey ?? crypto.randomUUID(),
            payload: { title, supplier: state.supplier, notes: state.notes, items },
          });

          const now = new Date().toISOString();
          const record: RequisitionRecord = {
            id: result.recordId,
            origin: 'server',
            number: result.number,
            title,
            status: result.status,
            supplier: state.supplier,
            notes: state.notes,
            items,
            itemCount: items.length,
            totalQuantity: sumRequisitionQuantities(items),
            createdAt: now,
            updatedAt: now,
          };

          set(current => ({
            serverBackedId: result.recordId,
            serverRecordId: result.recordId,
            serverNumber: result.number,
            // The server now owns this document, so drop the local mirror: the
            // history must never list the same requisition twice.
            localDrafts: current.localDrafts.filter(draft => draft.id !== result.recordId),
          }));

          return { uploaded: true, record, error: null };
        } catch (error) {
          logger.warn('Requisitions', 'Server save failed — keeping a device-only draft', error);
          return {
            uploaded: false,
            record: get().saveLocalDraft(),
            error: resolveRequisitionErrorMessage(error),
          };
        }
      },

      deleteLocalDraft: id => {
        set(state => {
          const isCurrent = state.serverRecordId === id;
          return {
            localDrafts: state.localDrafts.filter(draft => draft.id !== id),
            ...(isCurrent ? { serverRecordId: null, serverNumber: null } : {}),
          };
        });
      },

      markServerSaved: (recordId, number) => {
        set({ serverRecordId: recordId, serverNumber: number });
      },

      dismissStorageWarning: () => {
        set({ storageWarning: false });
      },

      resetGrid: () => {
        set(initialGrid());
      },

      importFromText: text => {
        const result: RequisitionImportResult = { imported: 0, duplicates: 0, invalid: 0 };
        if (text.trim() === '') return result;

        const existingKeys = new Set(get().items.map(requisitionItemKey));
        const imported: RequisitionItem[] = [];

        text
          .split(/\r?\n/)
          .map(line => line.trim())
          .filter(Boolean)
          .forEach(line => {
            const parsed = parseImportedLine(line);
            if (parsed === null) return;
            if (!parsed.quantityIsValid) result.invalid += 1;
            const key = requisitionItemKey(parsed.item);
            if (existingKeys.has(key)) {
              result.duplicates += 1;
              return;
            }
            existingKeys.add(key);
            imported.push(parsed.item);
          });

        result.imported = imported.length;
        if (imported.length > 0) {
          set(current => ({
            items: [...filledRequisitionItems(current.items), ...imported],
            serverNumber: null,
            serverRecordId: null,
          }));
        }
        return result;
      },
    }),
    {
      name: 'active',
      version: 2,
      storage: createJSONStorage(() => scopedStorage),
      partialize: state => ({
        items: state.items,
        supplier: state.supplier,
        notes: state.notes,
        title: state.title,
        localDrafts: state.localDrafts,
        serverNumber: state.serverNumber,
        serverRecordId: state.serverRecordId,
        serverBackedId: state.serverBackedId,
      }),
    }
  )
);

storageFailureHandlers.push(() => {
  useRequisitionsStore.setState({ storageWarning: true });
});

// When another user or company signs in on the same browser the in-memory grid
// must not leak the previous scope: drop it and rehydrate the new scope key.
let activeScope = resolveRequisitionsScope();
useAuthStore.subscribe(() => {
  const nextScope = resolveRequisitionsScope();
  if (nextScope === activeScope) return;
  activeScope = nextScope;
  suspendWrites = true;
  useRequisitionsStore.setState({ ...initialGrid(), localDrafts: [], storageWarning: false });
  suspendWrites = false;
  void useRequisitionsStore.persist.rehydrate();
});