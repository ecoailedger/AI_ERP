import { describe, expect, it } from 'vitest';
import {
  addDays,
  clampDate,
  daysBetween,
  DatasetSchema,
  DOMAIN_SCHEMA_VERSION,
  isIsoDate,
  isWeekend,
  nextWorkday,
} from './index';

describe('dates', () => {
  it('adds days across a month end', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-08-03', '2026-10-31')).toBe(89);
    expect(daysBetween('2026-10-31', '2026-10-30')).toBe(-1);
  });

  it('knows weekends and the next workday', () => {
    expect(isWeekend('2026-10-31')).toBe(true);
    expect(isWeekend('2026-11-02')).toBe(false);
    expect(nextWorkday('2026-10-31')).toBe('2026-11-02');
    expect(nextWorkday('2026-11-03')).toBe('2026-11-03');
  });

  it('validates and clamps', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('28/02/2026')).toBe(false);
    expect(clampDate('2027-01-01', '2026-08-03', '2026-10-31')).toBe('2026-10-31');
  });
});

describe('dataset schema', () => {
  it('rejects a dataset with a malformed date', () => {
    const result = DatasetSchema.safeParse({
      meta: {
        schemaVersion: DOMAIN_SCHEMA_VERSION,
        source: 'test',
        seed: 1,
        startDate: '03/08/2026',
        endDate: '2026-10-31',
        openingCash: 0,
        site: null,
        simulated: [],
      },
      suppliers: [],
      customers: [],
      categories: [],
      products: [],
      openingStock: [],
      purchaseOrders: [],
      goodsReceipts: [],
      salesOrders: [],
      salesInvoices: [],
      purchaseInvoices: [],
    });
    expect(result.success).toBe(false);
  });
});
