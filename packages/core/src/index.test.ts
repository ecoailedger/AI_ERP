import { DOMAIN_SCHEMA_VERSION, FIGURE_IDS, type Dataset, type FigureId, type WorldState } from '@ai-erp/domain';
import { describe, expect, it } from 'vitest';
import { createCore } from './index';

/** A tiny hand-built business, small enough to check every number by eye. */
function fixture(): Dataset {
  return {
    meta: {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      source: 'test',
      seed: null,
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      openingCash: 1000,
      site: null,
      simulated: ['cash'],
    },
    suppliers: [
      { id: 'S1', name: 'Supplier One', leadTimeDays: 10 },
      { id: 'S2', name: 'Supplier Two', leadTimeDays: 15 },
    ],
    customers: [
      { id: 'C1', name: 'Customer One', creditLimit: 100, termsDays: 30, onStopFrom: null, location: null },
      { id: 'C2', name: 'Customer Two', creditLimit: 5000, termsDays: 30, onStopFrom: '2026-09-10', location: { lat: 53.5, lon: -2.2 } },
    ],
    categories: [
      { id: 'K1', name: 'Cables' },
      { id: 'K2', name: 'Displays' },
    ],
    products: [
      { id: 'A', description: 'Cable A', categoryId: 'K1', supplierId: 'S1', unitCost: 10, sellPrice: 15 },
      { id: 'B', description: 'Display B', categoryId: 'K2', supplierId: 'S2', unitCost: 100, sellPrice: 150 },
      { id: 'N', description: 'Cable N', categoryId: 'K1', supplierId: 'S1', unitCost: 7, sellPrice: 9 },
    ],
    openingStock: [
      { productId: 'A', qty: 50, lastReceiptDate: '2026-08-01' },
      { productId: 'B', qty: 5, lastReceiptDate: '2025-01-01' },
      { productId: 'N', qty: 2, lastReceiptDate: '2026-08-20' },
    ],
    purchaseOrders: [
      {
        id: 'PO1',
        supplierId: 'S1',
        orderDate: '2026-09-01',
        acknowledgedDate: '2026-09-02',
        lines: [{ line: 1, productId: 'A', qty: 20, unitCost: 10, dueDate: '2026-09-10', originalDueDate: '2026-09-10' }],
      },
      {
        id: 'PO2',
        supplierId: 'S2',
        orderDate: '2026-09-05',
        acknowledgedDate: null,
        lines: [{ line: 1, productId: 'B', qty: 2, unitCost: 100, dueDate: '2026-09-20', originalDueDate: '2026-09-20' }],
      },
    ],
    goodsReceipts: [
      { id: 'R1', purchaseOrderId: 'PO1', date: '2026-09-14', putawayDate: '2026-09-17', lines: [{ line: 1, qty: 20 }] },
    ],
    salesOrders: [
      {
        id: 'SO1',
        customerId: 'C1',
        orderDate: '2026-09-02',
        committedDate: '2026-09-04',
        allocatedDate: '2026-09-02',
        pickedDate: '2026-09-03',
        shippedDate: '2026-09-03',
        deliveredDate: '2026-09-04',
        lines: [{ line: 1, productId: 'A', qty: 10, unitPrice: 15 }],
      },
      {
        id: 'SO2',
        customerId: 'C1',
        orderDate: '2026-09-05',
        committedDate: '2026-09-08',
        allocatedDate: null,
        pickedDate: null,
        shippedDate: null,
        deliveredDate: null,
        lines: [{ line: 1, productId: 'A', qty: 100, unitPrice: 15 }],
      },
      {
        id: 'SO3',
        customerId: 'C2',
        orderDate: '2026-09-22',
        committedDate: '2026-09-22',
        allocatedDate: '2026-09-22',
        pickedDate: '2026-09-22',
        shippedDate: '2026-09-22',
        deliveredDate: '2026-09-23',
        lines: [{ line: 1, productId: 'N', qty: 5, unitPrice: 9 }],
      },
    ],
    salesInvoices: [
      { id: 'SI1', salesOrderId: 'SO1', customerId: 'C1', date: '2026-09-03', net: 150, dueDate: '2026-10-03', paidDate: '2026-09-20' },
      { id: 'SI3', salesOrderId: 'SO3', customerId: 'C2', date: '2026-09-22', net: 45, dueDate: '2026-10-22', paidDate: null },
    ],
    purchaseInvoices: [
      {
        id: 'PI1',
        purchaseOrderId: 'PO1',
        goodsReceiptId: 'R1',
        supplierId: 'S1',
        date: '2026-09-16',
        net: 200,
        dueDate: '2026-10-16',
        paidDate: null,
      },
    ],
  };
}

const core = createCore(fixture());
const figure = (state: WorldState, id: FigureId): number => state.figures.find((f) => f.id === id)?.value ?? NaN;
const queue = (state: WorldState, id: string) => state.buildings.find((building) => building.id === id)?.queue ?? [];

describe('purchase orders', () => {
  it('flags an order late once its due date has passed', () => {
    expect(core.state('2026-09-10').purchaseOrders.find((po) => po.id === 'PO1')).toMatchObject({ late: false, status: 'in_transit' });
    expect(core.state('2026-09-13').purchaseOrders.find((po) => po.id === 'PO1')).toMatchObject({ late: true, daysLate: 3 });
  });

  it('rolls late orders up to the supplier and raises an alert', () => {
    const state = core.state('2026-09-13');
    expect(state.suppliers.find((s) => s.id === 'S1')).toMatchObject({ openPoCount: 1, latePoCount: 1, worstDaysLate: 3 });
    expect(state.alerts.find((alert) => alert.kind === 'po_late')?.ref).toEqual({ type: 'supplier', id: 'S1' });
  });

  it('flags an order the supplier has not confirmed', () => {
    expect(core.state('2026-09-07').purchaseOrders.find((po) => po.id === 'PO2')?.unacknowledged).toBe(false);
    expect(core.state('2026-09-08').purchaseOrders.find((po) => po.id === 'PO2')).toMatchObject({ unacknowledged: true, status: 'raised' });
  });

  it('treats an order long past its due date as stale, not late', () => {
    // PO2 was due on 20 September and never arrives.
    expect(core.state('2026-12-19').purchaseOrders.find((po) => po.id === 'PO2')).toMatchObject({ late: true, stale: false, daysLate: 90 });
    const state = core.state('2026-12-20');
    expect(state.purchaseOrders.find((po) => po.id === 'PO2')).toMatchObject({ late: false, stale: true, daysLate: 91 });
    expect(state.suppliers.find((s) => s.id === 'S2')).toMatchObject({ latePoCount: 0, stalePoCount: 1 });
    expect(state.alerts.some((alert) => alert.kind === 'po_stale')).toBe(true);
    expect(state.alerts.some((alert) => alert.kind === 'po_late' && alert.ref.id === 'S2')).toBe(false);
  });

  it('shows an order on the day it arrives, then drops it', () => {
    expect(core.state('2026-09-14').purchaseOrders.find((po) => po.id === 'PO1')).toMatchObject({
      arrivingToday: true,
      status: 'received',
      late: false,
    });
    expect(core.state('2026-09-15').purchaseOrders.find((po) => po.id === 'PO1')).toBeUndefined();
  });
});

describe('goods-in and the dock', () => {
  it('queues the unload on the day of arrival', () => {
    expect(queue(core.state('2026-09-14'), 'goodsIn').map((item) => item.kind)).toEqual(['unload']);
    expect(queue(core.state('2026-09-15'), 'goodsIn')).toEqual([]);
  });

  it('marks a delivery stale when it sits on the dock too long', () => {
    expect(core.state('2026-09-15').dock[0]).toMatchObject({ receiptId: 'R1', stale: false, daysOnDock: 1 });
    const state = core.state('2026-09-16');
    expect(state.dock[0]).toMatchObject({ stale: true, daysOnDock: 2 });
    expect(queue(state, 'warehouse').find((item) => item.kind === 'putaway')?.flag).toBe('late');
    expect(state.alerts.some((alert) => alert.kind === 'dock_stale')).toBe(true);
    expect(core.state('2026-09-17').dock).toEqual([]);
  });
});

describe('stock', () => {
  it('moves with receipts and shipments', () => {
    // 50 + 2 opening at cost 10 and 7, less 10 shipped: (40 x 10) + (2 x 7) + (5 x 100).
    expect(figure(core.state('2026-09-13'), 'stockValue')).toBe(914);
    // 20 received on the 14th.
    expect(figure(core.state('2026-09-14'), 'stockValue')).toBe(1114);
  });

  it('ages a category by days since last receipt', () => {
    const piles = core.state('2026-09-13').stockpiles;
    expect(piles.find((pile) => pile.categoryId === 'K2')).toMatchObject({ ageBand: 2, agedValue: 500 });
    expect(piles.find((pile) => pile.categoryId === 'K1')?.ageBand).toBe(0);
  });

  it('fogs a category holding negative stock and leaves it out of the value', () => {
    const before = core.state('2026-09-21');
    expect(before.fog).toEqual([]);
    const after = core.state('2026-09-22');
    expect(after.fog).toMatchObject([{ scope: 'category', id: 'K1' }]);
    expect(after.stockpiles.find((pile) => pile.categoryId === 'K1')?.untrusted).toBe(true);
    // Product N is at -3 and adds nothing: (60 x 10) + (5 x 100).
    expect(figure(after, 'stockValue')).toBe(1100);
  });
});

describe('sales orders', () => {
  it('never uses facts dated after the state date', () => {
    expect(core.state('2026-09-02').salesOrders.find((so) => so.id === 'SO1')?.status).toBe('allocated');
    expect(core.state('2026-09-03').salesOrders.find((so) => so.id === 'SO1')).toMatchObject({ status: 'shipped', deliveredDate: '2026-09-04' });
    expect(core.state('2026-09-04').salesOrders.find((so) => so.id === 'SO1')).toBeUndefined();
  });

  it('flags an order waiting for stock past its committed date', () => {
    expect(core.state('2026-09-08').salesOrders.find((so) => so.id === 'SO2')).toMatchObject({ status: 'back_ordered', late: false });
    const state = core.state('2026-09-10');
    expect(state.salesOrders.find((so) => so.id === 'SO2')).toMatchObject({ late: true, daysLate: 2 });
    expect(queue(state, 'sales').find((item) => item.kind === 'chase_stock')?.flag).toBe('late');
  });

  it('puts picking with the warehouse and loading with dispatch', () => {
    expect(queue(core.state('2026-09-02'), 'warehouse').map((item) => item.kind)).toEqual(['pick']);
    expect(queue(core.state('2026-09-03'), 'dispatch').map((item) => item.kind)).toEqual(['load']);
  });
});

describe('customers and money', () => {
  it('tracks debtors, cash and creditors', () => {
    const before = core.state('2026-09-19');
    expect(figure(before, 'debtors')).toBe(150);
    expect(figure(before, 'cash')).toBe(1000);
    expect(figure(before, 'creditors')).toBe(200);
    const after = core.state('2026-09-20');
    expect(figure(after, 'debtors')).toBe(0);
    expect(figure(after, 'cash')).toBe(1150);
    expect(after.paymentsIn).toEqual([{ invoiceId: 'SI1', partyId: 'C1', amount: 150 }]);
  });

  it('marks simulated figures', () => {
    const figures = core.state('2026-09-19').figures;
    expect(figures.find((f) => f.id === 'cash')?.simulated).toBe(true);
    expect(figures.find((f) => f.id === 'debtors')?.simulated).toBe(false);
  });

  it('flags customers over their limit and on stop', () => {
    expect(core.state('2026-09-05').customers.find((c) => c.id === 'C1')).toMatchObject({ balance: 150, overLimit: true });
    expect(core.state('2026-09-09').customers.find((c) => c.id === 'C2')?.onStop).toBe(false);
    expect(core.state('2026-09-10').customers.find((c) => c.id === 'C2')?.onStop).toBe(true);
  });

  it('sends bills to accounts on the day they arrive', () => {
    const state = core.state('2026-09-16');
    expect(state.billsIn).toEqual([{ invoiceId: 'PI1', partyId: 'S1', amount: 200 }]);
    expect(queue(state, 'accounts').map((item) => item.kind)).toEqual(['match_bill']);
  });
});

describe('traceability', () => {
  it('makes every figure equal the sum of its records, on every day', () => {
    for (let day = 1; day <= 30; day++) {
      const date = `2026-09-${String(day).padStart(2, '0')}`;
      const state = core.state(date);
      for (const id of FIGURE_IDS) {
        const records = core.figureRecords(id, date);
        const total = Math.round(records.rows.reduce((sum, row) => sum + row.amount, 0) * 100) / 100;
        expect(figure(state, id), `${id} on ${date}`).toBe(total);
        expect(records.figure.value).toBe(total);
      }
    }
  });

  it('gives a record card with its source and links', () => {
    const card = core.record({ type: 'purchaseOrder', id: 'PO1' }, '2026-09-13');
    expect(card?.status).toEqual({ text: 'Late by 3 days', flag: 'late' });
    expect(card?.source).toEqual([{ system: 'test', entity: 'purchaseOrders', id: 'PO1' }]);
    expect(card?.related[0]?.ref).toEqual({ type: 'supplier', id: 'S1' });
  });

  it('has a card for every record type, and none for records that do not exist yet', () => {
    const refs = [
      { type: 'supplier', id: 'S1' },
      { type: 'customer', id: 'C1' },
      { type: 'product', id: 'A' },
      { type: 'category', id: 'K1' },
      { type: 'purchaseOrder', id: 'PO1' },
      { type: 'goodsReceipt', id: 'R1' },
      { type: 'salesOrder', id: 'SO1' },
      { type: 'salesInvoice', id: 'SI1' },
      { type: 'purchaseInvoice', id: 'PI1' },
    ] as const;
    for (const ref of refs) expect(core.record(ref, '2026-09-30'), ref.type).not.toBeNull();
    expect(core.record({ type: 'goodsReceipt', id: 'R1' }, '2026-09-13')).toBeNull();
    expect(core.record({ type: 'purchaseOrder', id: 'NOPE' }, '2026-09-30')).toBeNull();
  });

  it('lists events in date order within a range', () => {
    const events = core.events('2026-09-01', '2026-09-03');
    expect(events.map((event) => event.type)).toEqual([
      'po_raised',
      'po_acknowledged',
      'so_allocated',
      'so_entered',
      'sales_invoiced',
      'so_picked',
      'so_shipped',
    ]);
  });
});

describe('master', () => {
  it('ranks customers by revenue and reports the range', () => {
    const master = core.master();
    expect(master.range).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(master.customers.find((c) => c.id === 'C1')?.rank).toBe(1);
    expect(master.customers.find((c) => c.id === 'C2')?.location).toEqual({ lat: 53.5, lon: -2.2 });
    expect(master.site).toBeNull();
    expect(core.clamp('2027-01-01')).toBe('2026-09-30');
  });
});
