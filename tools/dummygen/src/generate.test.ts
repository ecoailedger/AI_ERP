import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCore } from '@ai-erp/core';
import { addDays, DatasetSchema } from '@ai-erp/domain';
import { describe, expect, it } from 'vitest';
import { datasetToFiles } from './files';
import { DEFAULT_OPTIONS, generate, SPEC } from './generate';

const dataset = generate();
const core = createCore(dataset);
const { startDate, endDate } = dataset.meta;
const inRange = (date: string): boolean => date >= startDate && date <= endDate;

describe('dummy data generator', () => {
  it('gives the same dataset for the same seed', () => {
    expect(generate()).toEqual(dataset);
  });

  it('gives a different dataset for a different seed', () => {
    const other = generate({ ...DEFAULT_OPTIONS, seed: 7 });
    expect(other.suppliers.map((supplier) => supplier.name)).not.toEqual(dataset.suppliers.map((supplier) => supplier.name));
  });

  it('matches the canonical schema', () => {
    expect(DatasetSchema.safeParse(dataset).success).toBe(true);
  });

  it('matches the files committed in data/dummy', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'dummy');
    for (const [name, text] of datasetToFiles(dataset)) {
      const onDisk = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n');
      expect(onDisk === text, `${name} is out of date: run npm run generate -w @ai-erp/dummygen`).toBe(true);
    }
  });

  it('has the master data the spec asks for', () => {
    expect(dataset.suppliers).toHaveLength(SPEC.suppliers);
    expect(dataset.customers).toHaveLength(SPEC.customers);
    expect(dataset.products).toHaveLength(SPEC.products);
    expect(dataset.categories).toHaveLength(SPEC.categories);
    expect(new Set(dataset.suppliers.map((supplier) => supplier.name)).size).toBe(SPEC.suppliers);
    expect(new Set(dataset.customers.map((customer) => customer.name)).size).toBe(SPEC.customers);
  });

  it('covers 90 days with about 400 purchase orders and 3,000 sales orders', () => {
    expect(startDate).toBe('2026-08-03');
    expect(endDate).toBe('2026-10-31');
    const purchaseOrders = dataset.purchaseOrders.filter((order) => inRange(order.orderDate)).length;
    const salesOrders = dataset.salesOrders.filter((order) => inRange(order.orderDate)).length;
    expect(purchaseOrders).toBeGreaterThan(340);
    expect(purchaseOrders).toBeLessThan(460);
    expect(salesOrders).toBeGreaterThan(2700);
    expect(salesOrders).toBeLessThan(3300);
  });

  it('keeps every dated fact inside the simulated period', () => {
    const dates = [
      ...dataset.goodsReceipts.flatMap((receipt) => [receipt.date, receipt.putawayDate]),
      ...dataset.salesOrders.flatMap((order) => [order.allocatedDate, order.pickedDate, order.shippedDate, order.deliveredDate]),
      ...dataset.salesInvoices.flatMap((invoice) => [invoice.date, invoice.paidDate]),
      ...dataset.purchaseInvoices.flatMap((invoice) => [invoice.date, invoice.paidDate]),
    ].filter((date): date is string => date !== null);
    expect(dates.every((date) => date <= endDate)).toBe(true);
  });

  it('delivers about one purchase order in ten late', () => {
    const firstReceipt = new Map<string, string>();
    for (const receipt of dataset.goodsReceipts) {
      if (!firstReceipt.has(receipt.purchaseOrderId)) firstReceipt.set(receipt.purchaseOrderId, receipt.date);
    }
    const late = dataset.purchaseOrders.filter((order) => {
      const due = order.lines[0]?.dueDate ?? '';
      const arrived = firstReceipt.get(order.id);
      return arrived ? arrived > due : due < endDate;
    });
    const share = late.length / dataset.purchaseOrders.length;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.14);
  });

  it('concentrates lateness in a few suppliers', () => {
    const lateDays = new Map<string, number>();
    for (let day = startDate; day <= endDate; day = addDays(day, 7)) {
      for (const supplier of core.state(day).suppliers) {
        lateDays.set(supplier.id, (lateDays.get(supplier.id) ?? 0) + supplier.latePoCount);
      }
    }
    const ranked = [...lateDays.values()].sort((a, b) => b - a);
    const total = ranked.reduce((sum, count) => sum + count, 0);
    const topThree = ranked.slice(0, SPEC.lateProneSuppliers).reduce((sum, count) => sum + count, 0);
    expect(topThree / total).toBeGreaterThan(0.45);
  });

  it('seeds the exceptions the world must show', () => {
    const state = core.state(endDate);
    expect(state.customers.filter((customer) => customer.onStop)).toHaveLength(SPEC.customersOnStop);
    expect(state.customers.filter((customer) => customer.overLimit && !customer.onStop).length).toBeGreaterThanOrEqual(SPEC.customersOverLimit);
    const bands = state.stockpiles.map((pile) => pile.ageBand);
    expect(bands.filter((band) => band >= 1)).toHaveLength(SPEC.agedCategories.length);
    expect(new Set(bands)).toEqual(new Set([0, 1, 2, 3]));
    expect(state.fog).toHaveLength(SPEC.negativeStockRows);
    expect(state.purchaseOrders.some((order) => order.late)).toBe(true);
    expect(state.purchaseOrders.some((order) => order.unacknowledged)).toBe(true);
    expect(state.salesOrders.some((order) => order.status === 'back_ordered')).toBe(true);
  });

  it('is already busy on the first day', () => {
    const state = core.state(startDate);
    expect(state.purchaseOrders.length).toBeGreaterThan(30);
    expect(state.figures.find((figure) => figure.id === 'debtors')?.value).toBeGreaterThan(0);
    expect(state.fog).toHaveLength(0);
  });
});
