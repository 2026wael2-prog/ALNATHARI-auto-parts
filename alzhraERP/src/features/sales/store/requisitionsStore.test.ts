import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ScopeUser {
  id: string;
  company_id: string;
}

interface MockAuthStore {
  __setUser: (user: ScopeUser | null) => void;
}

// The requisitions draft is scoped by company + user, so the auth store is
// mocked with a switchable user to prove the isolation (audit F1) instead of
// depending on a live session.
vi.mock('@/features/auth/store', () => {
  const listeners = new Set<() => void>();
  const state: { user: ScopeUser | null } = {
    user: { id: 'user-1', company_id: 'company-1' },
  };
  const useAuthStore = Object.assign((): { user: ScopeUser | null } => state, {
    getState: (): { user: ScopeUser | null } => state,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    __setUser: (user: ScopeUser | null): void => {
      state.user = user;
      listeners.forEach(listener => {
        listener();
      });
    },
  });
  return { useAuthStore };
});

import { useAuthStore } from '@/features/auth/store';
import { useRequisitionsStore } from './requisitionsStore';
import { filledRequisitionItems } from '../utils/requisitionsValidation';

const setAuthUser = (useAuthStore as unknown as MockAuthStore).__setUser;

const filledNames = (): string[] =>
  filledRequisitionItems(useRequisitionsStore.getState().items).map(row => row.name);

/** Stored keys as seen by the app: the test storage mock exposes length/key(). */
const storedKeys = (): string[] =>
  Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '');

const resetStore = (): void => {
  useRequisitionsStore.setState({
    items: [],
    supplier: null,
    notes: '',
    title: 'طلب اختبار',
    localDrafts: [],
    serverNumber: null,
    serverRecordId: null,
    storageWarning: false,
  });
  useRequisitionsStore.getState().clearItems();
};

describe('requisitionsStore — row reordering (audit F4)', () => {
  beforeEach(() => {
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    resetStore();
  });

  it('moves a row by its id, independent of the visible index', () => {
    useRequisitionsStore.getState().addItem({ name: 'أول', quantity: 1 });
    useRequisitionsStore.getState().addItem({ name: 'ثاني', quantity: 1 });
    useRequisitionsStore.getState().addItem({ name: 'ثالث', quantity: 1 });
    const rows = filledRequisitionItems(useRequisitionsStore.getState().items);
    expect(rows.map(row => row.name)).toEqual(['أول', 'ثاني', 'ثالث']);
    const secondId = rows[1].id;

    useRequisitionsStore.getState().moveItem(secondId, 'up');
    expect(filledNames()).toEqual(['ثاني', 'أول', 'ثالث']);

    useRequisitionsStore.getState().moveItem(secondId, 'down');
    useRequisitionsStore.getState().moveItem(secondId, 'down');
    expect(filledNames()).toEqual(['أول', 'ثالث', 'ثاني']);
  });

  it('ignores moves beyond the edges and unknown ids', () => {
    useRequisitionsStore.getState().addItem({ name: 'وحيد', quantity: 1 });
    const rowId = filledRequisitionItems(useRequisitionsStore.getState().items)[0].id;
    useRequisitionsStore.getState().moveItem(rowId, 'up');
    useRequisitionsStore.getState().moveItem(rowId, 'down');
    useRequisitionsStore.getState().moveItem('missing-id', 'up');
    expect(filledNames()).toEqual(['وحيد']);
  });
});

describe('requisitionsStore — clipboard import contract', () => {
  beforeEach(() => {
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    resetStore();
  });

  it('reports imported rows, skipped duplicates and unusable quantities', () => {
    const result = useRequisitionsStore
      .getState()
      .importFromText(
        'فلتر زيت\tfl-100\tبوش\t4\tأصلي\nفلتر زيت\tFL-100\tبوش\t4\nشمعات\tsk20\tدنسو\tصفر\n\nمسمار كفر'
      );

    expect(result.imported).toBe(3);
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);

    const rows = filledRequisitionItems(useRequisitionsStore.getState().items);
    expect(rows.map(row => row.name)).toEqual(['فلتر زيت', 'شمعات', 'مسمار كفر']);
    expect(rows[0]?.partNumber).toBe('FL-100');
    expect(rows[0]?.brand).toBe('بوش');
    expect(rows[0]?.notes).toBe('أصلي');
    // Audit F17: an unusable quantity stays visible as 0 so the save is blocked.
    expect(rows[1]?.quantity).toBe(0);
    expect(rows[2]?.quantity).toBe(1);
  });

  it('does not swallow rows that duplicate what is already in the grid', () => {
    useRequisitionsStore.getState().addItem({ name: 'فلتر', partNumber: 'FL-1', quantity: 1 });
    const result = useRequisitionsStore.getState().importFromText('فلتر\tFL-1\tبوش\t2');
    expect(result.imported).toBe(0);
    expect(result.duplicates).toBe(1);
    expect(filledNames()).toEqual(['فلتر']);
  });
});

describe('requisitionsStore — local draft register', () => {
  beforeEach(() => {
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    resetStore();
  });

  it('stores counts from filled rows only and updates instead of duplicating', () => {
    useRequisitionsStore.getState().setTitle('طلبية أسبوعية');
    useRequisitionsStore.getState().addItem({ name: 'زيت', quantity: 3 });
    useRequisitionsStore.getState().addItem({ name: 'فلتر', quantity: 2 });

    const first = useRequisitionsStore.getState().saveLocalDraft();
    expect(first.origin).toBe('local');
    expect(first.number).toBeNull();
    expect(first.title).toBe('طلبية أسبوعية');
    expect(first.itemCount).toBe(2);
    expect(first.totalQuantity).toBe(5);
    expect(useRequisitionsStore.getState().localDrafts).toHaveLength(1);

    useRequisitionsStore.getState().addItem({ name: 'بوجيه', quantity: 1 });
    const second = useRequisitionsStore.getState().saveLocalDraft();
    expect(second.id).toBe(first.id);
    expect(useRequisitionsStore.getState().localDrafts).toHaveLength(1);
    expect(useRequisitionsStore.getState().localDrafts[0]?.itemCount).toBe(3);
  });

  it('starts a new record after the current one is deleted', () => {
    useRequisitionsStore.getState().addItem({ name: 'زيت', quantity: 1 });
    const first = useRequisitionsStore.getState().saveLocalDraft();
    useRequisitionsStore.getState().deleteLocalDraft(first.id);
    expect(useRequisitionsStore.getState().localDrafts).toHaveLength(0);
    expect(useRequisitionsStore.getState().serverRecordId).toBeNull();

    const second = useRequisitionsStore.getState().saveLocalDraft();
    expect(second.id).not.toBe(first.id);
  });

  it('loads a stored record back into the editable grid', () => {
    useRequisitionsStore.getState().addItem({ name: 'زيت', quantity: 4 });
    const record = useRequisitionsStore.getState().saveLocalDraft();
    resetStore();
    expect(filledNames()).toEqual([]);

    useRequisitionsStore.getState().loadIntoGrid(
      {
        title: record.title,
        supplier: record.supplier,
        notes: record.notes,
        items: record.items,
      },
      { number: record.number, recordId: record.id }
    );

    expect(filledNames()).toEqual(['زيت']);
    expect(useRequisitionsStore.getState().serverRecordId).toBe(record.id);
  });
});

describe('requisitionsStore — company/user scoped persistence (audit F1)', () => {
  it('purges the legacy global key and keeps drafts per user', async () => {
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    resetStore();
    localStorage.setItem('alzhra_sales_requisitions_v1', '{"state":{"items":[]}}');
    await useRequisitionsStore.persist.rehydrate();
    expect(localStorage.getItem('alzhra_sales_requisitions_v1')).toBeNull();

    useRequisitionsStore.getState().clearItems();
    useRequisitionsStore.getState().addItem({ name: 'مسودة المستخدم الأول', quantity: 2 });
    expect(storedKeys().some(key => key.includes('company-1:user-1'))).toBe(true);

    // A different user on the same browser must never inherit that draft.
    setAuthUser({ id: 'user-2', company_id: 'company-1' });
    expect(filledNames()).toEqual([]);

    // Switching back restores only that user own draft.
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    await useRequisitionsStore.persist.rehydrate();
    expect(filledNames()).toEqual(['مسودة المستخدم الأول']);
  });

  it('keeps the same user drafts separate per company', async () => {
    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    resetStore();
    useRequisitionsStore.getState().addItem({ name: 'طلب الشركة الأولى', quantity: 1 });

    setAuthUser({ id: 'user-1', company_id: 'company-2' });
    await useRequisitionsStore.persist.rehydrate();
    expect(filledNames()).toEqual([]);

    setAuthUser({ id: 'user-1', company_id: 'company-1' });
    await useRequisitionsStore.persist.rehydrate();
    expect(filledNames()).toEqual(['طلب الشركة الأولى']);
  });
});