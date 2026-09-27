import { describe, it, expect, vi, beforeEach } from 'vitest';
import { purchaseQuotationsApi } from './quotationsApi';
import type { CreatePurchaseQuotationDTO } from '../types/quotation';

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
const { mockGenerateNumber } = vi.hoisted(() => ({ mockGenerateNumber: vi.fn() }));

vi.mock('../../../lib/supabaseClient', () => ({ supabase: { from: mockFrom } }));
vi.mock('../../../lib/quotationNumbering', () => ({
  generateQuotationNumber: mockGenerateNumber,
}));

interface RecordedCall {
  method: string;
  args: unknown[];
}

const createInsertRecorder = (final: { data: unknown; error: unknown }) => {
  const calls: RecordedCall[] = [];
  const build = (): unknown => {
    const target = () => {
      return undefined;
    };
    (target as Record<string, unknown>).then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(final).then(resolve);
    return new Proxy(target, {
      get: (_target, prop): unknown => {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown) => Promise.resolve(final).then(resolve);
        }
        if (typeof prop !== 'string') return undefined;
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          if (prop === 'single' || prop === 'maybeSingle') {
            return Promise.resolve(final);
          }
          return build();
        };
      },
    });
  };
  return { calls, build };
};

const baseDto = (
  overrides: Partial<CreatePurchaseQuotationDTO> = {}
): CreatePurchaseQuotationDTO => ({
  partyId: 'party-1',
  issueDate: '2026-08-26',
  items: [
    { productId: 'prod-1', description: 'قطعة أصلية', quantity: 2, unitPrice: 100 },
    { productId: '', description: 'خدمة تركيب', quantity: 1, unitPrice: 50, discountPercent: 10 },
  ],
  ...overrides,
});

describe('purchaseQuotationsApi.createQuotation — atomic write & safe numbering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateNumber.mockResolvedValue('QP-0042');
  });

  it('inserts header into quotations and items into quotation_items', async () => {
    const insertedRow = { id: 'q-1', quotation_number: 'QP-0042', rfq_group_id: 'rfq-1' };
    const quotationsRecorder = createInsertRecorder({ data: insertedRow, error: null });
    const itemsRecorder = createInsertRecorder({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'quotations') return quotationsRecorder.build();
      if (table === 'quotation_items') return itemsRecorder.build();
      return undefined;
    });

    const result = await purchaseQuotationsApi.createQuotation('comp-1', 'user-1', baseDto());

    expect(mockFrom.mock.calls[0]?.[0]).toBe('quotations');
    expect(mockFrom.mock.calls[1]?.[0]).toBe('quotation_items');

    const headerCall = quotationsRecorder.calls.find(c => c.method === 'insert');
    expect(headerCall).toBeDefined();
    const headerPayload = headerCall?.args[0] as Record<string, unknown>;
    expect(headerPayload.quotation_number).toBe('QP-0042');
    expect(headerPayload.type).toBe('purchase');
    expect(headerPayload.company_id).toBe('comp-1');

    const itemsCall = itemsRecorder.calls.find(c => c.method === 'insert');
    expect(itemsCall).toBeDefined();
    const itemRows = itemsCall?.args[0] as Array<Record<string, unknown>>;
    expect(itemRows).toHaveLength(2);
    expect(itemRows[0]).toMatchObject({
      quotation_id: 'q-1',
      product_id: 'prod-1',
      quantity: 2,
      unit_price: 100,
      total: 200,
      sort_order: 0,
      company_id: 'comp-1',
    });
    expect(itemRows[1]).toMatchObject({
      quotation_id: 'q-1',
      product_id: null,
      total: 45,
      discount_percent: 10,
      sort_order: 1,
    });

    expect(result).toEqual(insertedRow);
  });

  it('propagates the database error when header insert fails', async () => {
    const { build } = createInsertRecorder({
      data: null,
      error: new Error('duplicate key value violates unique constraint'),
    });
    mockFrom.mockImplementation(() => build());

    await expect(
      purchaseQuotationsApi.createQuotation('comp-1', 'user-1', baseDto())
    ).rejects.toThrow(/duplicate key/);
  });

  it('rolls back header when items insert fails', async () => {
    const insertedRow = { id: 'q-1', quotation_number: 'QP-0042', rfq_group_id: 'rfq-1' };
    const quotationsRecorder = createInsertRecorder({ data: insertedRow, error: null });
    const itemsRecorder = createInsertRecorder({
      data: null,
      error: new Error('item insert error'),
    });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'quotations') return quotationsRecorder.build();
      if (table === 'quotation_items') return itemsRecorder.build();
      return undefined;
    });

    await expect(
      purchaseQuotationsApi.createQuotation('comp-1', 'user-1', baseDto())
    ).rejects.toThrow(/item insert error/);

    const deleteCall = quotationsRecorder.calls.find(c => c.method === 'delete');
    expect(deleteCall).toBeDefined();
  });

  it('refuses to save a quotation with zero items (client-side fail-fast)', async () => {
    await expect(
      purchaseQuotationsApi.createQuotation('comp-1', 'user-1', baseDto({ items: [] }))
    ).rejects.toThrow(/بدون أصناف/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('delegates numbering to the shared race-resistant generator', async () => {
    const insertedRow = { id: 'q-2', quotation_number: 'QP-0042', rfq_group_id: 'rfq-2' };
    const quotationsRecorder = createInsertRecorder({ data: insertedRow, error: null });
    const itemsRecorder = createInsertRecorder({ data: null, error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'quotations') return quotationsRecorder.build();
      if (table === 'quotation_items') return itemsRecorder.build();
      return undefined;
    });

    await purchaseQuotationsApi.createQuotation('comp-1', 'user-1', baseDto());

    expect(mockGenerateNumber).toHaveBeenCalledWith('comp-1', 'purchase');
  });
});
