import { describe, it, expect, vi, afterEach } from 'vitest';
import { getPeriodDates } from './types';

/**
 * تُبنى التواريخ من مكونات محلية (سنة، شهر، يوم) فيصمد الاختبار في أي منطقة
 * زمنية يُشغَّل فيها: الادعاء أن الفلتر يعطي التقويم المحلي نفسه مهما كان UTC.
 */
describe('getPeriodDates (local-calendar safety)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the local calendar day for "today" even at 00:30 local time', () => {
    // 00:30 محلياً — الكود القديم (toISOString) كان يُرجع تاريخ الأمس في المناطق
    // الأسبق عن UTC مثل GMT+3.
    vi.setSystemTime(new Date(2026, 8, 3, 0, 30)); // 3 سبتمبر 2026، 00:30 صباحاً

    const { dateFrom, dateTo } = getPeriodDates('today');
    expect(dateFrom).toBe('2026-09-03');
    expect(dateTo).toBe('2026-09-03');
  });

  it('uses a rolling 7-day window (inclusive of today) for "last_7_days"', () => {
    // ⚡ نافذة متدرّجة لا أسبوع تقويمي: 7 أيام شاملة اليوم = اليوم − 6.
    // المنشأة تعمل كل يوم بلا أيام راحة، فحدود الأسبوع التقويمي لا معنى لها.
    vi.setSystemTime(new Date(2026, 8, 3, 1, 15)); // 3 سبتمبر 2026

    const { dateFrom, dateTo } = getPeriodDates('last_7_days');
    expect(dateFrom).toBe('2026-08-28'); // 28 أغسطس .. 3 سبتمبر = 7 أيام
    expect(dateTo).toBe('2026-09-03');
  });

  it('keeps month/year boundaries on the local calendar', () => {
    vi.setSystemTime(new Date(2026, 8, 1, 0, 30));

    expect(getPeriodDates('this_month').dateFrom).toBe('2026-09-01');
    expect(getPeriodDates('this_year').dateFrom).toBe('2026-01-01');
    expect(getPeriodDates('all_time')).toEqual({});
  });
});
