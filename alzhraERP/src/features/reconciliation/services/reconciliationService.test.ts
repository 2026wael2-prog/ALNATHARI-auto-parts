import { describe, it, expect } from 'vitest';
import {
  reconciliationService,
  currencySymbol,
  getDenominationsFor,
  resolveSummaryCurrency,
  resolveTolerance,
  DEFAULT_TOLERANCE_SAR,
} from './reconciliationService';
import type { DailyDrawerSummary } from '../types';

const buildSummary = (overrides: Partial<DailyDrawerSummary> = {}): DailyDrawerSummary => ({
  date: '2026-09-10',
  opening_float: 0,
  total_sales: 0,
  cash_sales: 0,
  card_sales: 0,
  transfer_sales: 0,
  returns_cash: 0,
  returns_card: 0,
  petty_expenses_cash: 0,
  expected_cash_in_drawer: 0,
  expected_card_terminal: 0,
  employee_breakdown: [],
  existing_reconciliation: null,
  is_already_closed: false,
  ...overrides,
});

describe('reconciliationService', () => {
  describe('currency helpers (base currency contract)', () => {
    it('prefers base_currency from the server over the legacy currency field', () => {
      expect(resolveSummaryCurrency(buildSummary({ base_currency: 'yer', currency: 'SAR' }))).toBe(
        'YER'
      );
    });

    it('falls back to the legacy currency field then SAR', () => {
      expect(resolveSummaryCurrency(buildSummary({ currency: 'OMR' }))).toBe('OMR');
      expect(resolveSummaryCurrency(buildSummary())).toBe('SAR');
    });

    it('maps known symbols and falls back to the raw code for unknown currencies', () => {
      expect(currencySymbol('YER')).toBe('ر.ي');
      expect(currencySymbol('sar')).toBe('ر.س');
      expect(currencySymbol('XAF')).toBe('XAF');
      expect(currencySymbol(null)).toBe('ر.س');
    });

    it('labels denominations with the base currency symbol instead of forcing ر.س', () => {
      const yerDenominations = getDenominationsFor('YER');
      expect(yerDenominations).toContainEqual({ value: 500, label: '500 ر.ي' });
      expect(yerDenominations.every(denomination => denomination.label.endsWith('ر.ي'))).toBe(true);
    });
  });

  describe('resolveTolerance', () => {
    it('uses the server tolerance when provided', () => {
      expect(resolveTolerance(buildSummary({ variance_tolerance: 25 }))).toBe(25);
      expect(resolveTolerance(buildSummary({ variance_tolerance: 0 }))).toBe(0);
    });

    it('falls back to the default tolerance for missing or invalid values', () => {
      expect(resolveTolerance(buildSummary())).toBe(DEFAULT_TOLERANCE_SAR);
      expect(resolveTolerance(null)).toBe(DEFAULT_TOLERANCE_SAR);
      expect(resolveTolerance(buildSummary({ variance_tolerance: Number.NaN }))).toBe(
        DEFAULT_TOLERANCE_SAR
      );
      expect(resolveTolerance(buildSummary({ variance_tolerance: -5 }))).toBe(
        DEFAULT_TOLERANCE_SAR
      );
    });
  });
  describe('calculateDenominationsTotal', () => {
    it('calculates 0 for empty counts', () => {
      expect(reconciliationService.calculateDenominationsTotal({})).toBe(0);
    });

    it('accurately sums various denominations including fractional coins', () => {
      const counts = {
        '500': 3, // 1500
        '100': 4, // 400
        '50': 2, // 100
        '10': 3, // 30
        '1': 5, // 5
        '0.5': 2, // 1
      };
      // 1500 + 400 + 100 + 30 + 5 + 1 = 2036
      expect(reconciliationService.calculateDenominationsTotal(counts)).toBe(2036);
    });
  });

  describe('calculateVariance', () => {
    it('returns balanced when actual equals expected', () => {
      const result = reconciliationService.calculateVariance(1500, 1500);
      expect(result.status).toBe('balanced');
      expect(result.variance).toBe(0);
      expect(result.isWithinTolerance).toBe(true);
    });

    it('detects surplus within tolerance threshold', () => {
      const result = reconciliationService.calculateVariance(1505, 1500, 10);
      expect(result.status).toBe('surplus');
      expect(result.variance).toBe(5);
      expect(result.isWithinTolerance).toBe(true);
    });

    it('detects shortage outside tolerance threshold', () => {
      const result = reconciliationService.calculateVariance(1450, 1500, 10);
      expect(result.status).toBe('shortage');
      expect(result.variance).toBe(-50);
      expect(result.isWithinTolerance).toBe(false);
    });
  });

  describe('formatWhatsAppSummary', () => {
    it('formats a structured Arabic WhatsApp summary correctly', () => {
      const mockSummary: DailyDrawerSummary = {
        date: '2026-09-05',
        opening_float: 200,
        total_sales: 3000,
        cash_sales: 1800,
        card_sales: 1200,
        transfer_sales: 0,
        returns_cash: 50,
        returns_card: 0,
        petty_expenses_cash: 30,
        expected_cash_in_drawer: 1920, // 200 + 1800 - 50 - 30 = 1920
        expected_card_terminal: 1200,
        employee_breakdown: [
          {
            user_id: 'u1',
            employee_name: 'أحمد',
            invoice_count: 10,
            total_sales: 1600,
            cash_sales: 1000,
            card_sales: 600,
            transfer_sales: 0,
          },
          {
            user_id: 'u2',
            employee_name: 'محمد',
            invoice_count: 8,
            total_sales: 1400,
            cash_sales: 800,
            card_sales: 600,
            transfer_sales: 0,
          },
        ],
        existing_reconciliation: null,
        is_already_closed: false,
      };

      const msg = reconciliationService.formatWhatsAppSummary(mockSummary, {
        actualCash: 1920,
        actualCard: 1200,
        floatRetained: 200,
        cashToOwner: 1720,
        shopName: 'محل الجعفري لقطع الغيار',
      });

      expect(msg).toContain('إقفال يومية محل الجعفري لقطع الغيار');
      expect(msg).toContain('2026-09-05');
      expect(msg).toContain('أحمد');
      expect(msg).toContain('محمد');
      expect(msg).toContain('متطابق تماماً');
      expect(msg).toContain('*المتبقي بالدرج لبكرة (فكة):* 200.00 ر.س');
      expect(msg).toContain('*الصافي المسلم للمالك:* 1720.00 ر.س');
    });

    it('includes bond cash receipts and disbursements when present', () => {
      const mockSummary: DailyDrawerSummary = {
        date: '2026-09-05',
        opening_float: 100,
        total_sales: 1000,
        cash_sales: 1000,
        card_sales: 0,
        transfer_sales: 0,
        returns_cash: 0,
        returns_card: 0,
        cash_receipts: 250,
        cash_disbursements: 50,
        petty_expenses_cash: 20,
        expected_cash_in_drawer: 1280, // 100 + 1000 + 250 - 50 - 20 = 1280
        expected_card_terminal: 0,
        employee_breakdown: [],
        existing_reconciliation: null,
        is_already_closed: false,
      };

      const msg = reconciliationService.formatWhatsAppSummary(mockSummary, {
        actualCash: 1280,
        actualCard: 0,
        floatRetained: 100,
        cashToOwner: 1180,
        shopName: 'محل الجعفري',
      });

      expect(msg).toContain('*سندات قبض نقدية:* +250.00 ر.س');
      expect(msg).toContain('*سندات صرف نقدية:* -50.00 ر.س');
    });

    it('renders amounts with the base currency symbol of a YER company', () => {
      const mockSummary = buildSummary({
        base_currency: 'YER',
        opening_float: 5000,
        total_sales: 410000,
        cash_sales: 410000,
        expected_cash_in_drawer: 415000,
      });

      const msg = reconciliationService.formatWhatsAppSummary(mockSummary, {
        actualCash: 415000,
        actualCard: 0,
        floatRetained: 5000,
        cashToOwner: 410000,
        shopName: 'محل الجعفري',
      });

      expect(msg).toContain('415000.00 ر.ي');
      expect(msg).not.toContain('ر.س');
    });

    it('exposes the per-currency breakdown and unclassified other sales', () => {
      const mockSummary = buildSummary({
        base_currency: 'YER',
        total_sales: 451000,
        cash_sales: 451000,
        expected_cash_in_drawer: 451000,
        other_sales: 1000,
        sales_by_currency: [
          { currency_code: 'YER', invoice_count: 10, raw_total: 410000, base_total: 410000 },
          { currency_code: 'SAR', invoice_count: 1, raw_total: 100, base_total: 41000 },
        ],
      });

      const msg = reconciliationService.formatWhatsAppSummary(mockSummary, {
        actualCash: 451000,
        actualCard: 0,
        floatRetained: 0,
        cashToOwner: 451000,
      });

      // العملة الأجنبية تُعرض بالمبلغ الخام وبالمعادل بعملة المنشأة
      expect(msg).toContain('SAR: 100.00 = 41000.00 ر.ي');
      // العملة الأساسية لا تُكرّر الإشارة للتحويل
      expect(msg).toContain('YER: 410000.00 (10 فاتورة)');
      expect(msg).toContain('🧾 *مبيعات بطرق دفع أخرى:* 1000.00 ر.ي');
    });
  });
});
