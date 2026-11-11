/** Builds the world state for one date from a snapshot: entities, queues, exceptions, figures. */
import {
  addDays,
  daysBetween,
  FIGURE_IDS,
  type Alert,
  type BuildingState,
  type CustomerState,
  type DockPallet,
  type FogFlag,
  type MoneyMovement,
  type PersonState,
  type PurchaseOrderState,
  type QueueItem,
  type SalesOrderState,
  type StockpileState,
  type SupplierState,
  type WorldState,
} from '@ai-erp/domain';
import { figureRecords } from './figures';
import {
  enterSalesOrderMinutes,
  hoursAndMinutes,
  ordersEntered,
  raisePurchaseOrderMinutes,
  WORKDAY_HOURS,
  WORKDAY_MINUTES,
} from './workload';
import { money, moneyShort, plural, round2 } from './format';
import { must, type Model } from './model';
import {
  AGE_BAND_DAYS,
  AGED_VALUE_SHARE,
  DEBT_CHASE_DAYS,
  PO_LATE_SERIOUS_DAYS,
  REVENUE_WINDOW_DAYS,
  STALE_DAYS,
  UNTRUSTED_VALUE_SHARE,
} from './rules';
import { isPaid, type Snapshot } from './snapshot';

const MAX_ALERTS = 60;

function stockpiles(model: Model, snap: Snapshot): StockpileState[] {
  const piles = new Map<string, StockpileState & { aged: [number, number, number]; negativeValue: number }>();
  for (const category of model.ds.categories) {
    piles.set(category.id, {
      categoryId: category.id,
      name: category.name,
      qty: 0,
      value: 0,
      productCount: 0,
      ageBand: 0,
      agedValue: 0,
      untrusted: false,
      aged: [0, 0, 0],
      negativeValue: 0,
    });
  }
  for (const product of model.ds.products) {
    const qty = snap.stockQty.get(product.id) ?? 0;
    if (qty === 0) continue;
    const pile = must(piles, product.categoryId, 'category');
    if (qty < 0) {
      pile.negativeValue += -qty * product.unitCost;
      continue;
    }
    const value = qty * product.unitCost;
    const age = daysBetween(snap.lastReceipt.get(product.id) ?? snap.asOf, snap.asOf);
    pile.qty += qty;
    pile.value += value;
    pile.productCount += 1;
    AGE_BAND_DAYS.forEach((days, band) => {
      if (age > days) pile.aged[band as 0 | 1 | 2] += value;
    });
  }
  return [...piles.values()].map(({ aged, negativeValue, ...pile }) => {
    pile.untrusted = negativeValue > 0 && negativeValue >= pile.value * UNTRUSTED_VALUE_SHARE;
    let ageBand: StockpileState['ageBand'] = 0;
    if (pile.value > 0) {
      if (aged[2] / pile.value >= AGED_VALUE_SHARE) ageBand = 3;
      else if (aged[1] / pile.value >= AGED_VALUE_SHARE) ageBand = 2;
      else if (aged[0] / pile.value >= AGED_VALUE_SHARE) ageBand = 1;
    }
    return { ...pile, value: round2(pile.value), agedValue: round2(aged[0]), ageBand };
  });
}

export function buildState(model: Model, snap: Snapshot): WorldState {
  const { asOf } = snap;
  const supplierName = (id: string): string => must(model.supplier, id, 'supplier').name;
  const customerName = (id: string): string => must(model.customer, id, 'customer').name;

  // ---- Purchase orders and suppliers
  const purchaseOrders: PurchaseOrderState[] = [];
  const suppliers = new Map<string, SupplierState>(
    model.ds.suppliers.map((supplier) => [
      supplier.id,
      { id: supplier.id, name: supplier.name, openPoCount: 0, latePoCount: 0, stalePoCount: 0, openPoValue: 0, worstDaysLate: 0 },
    ]),
  );
  for (const view of snap.purchaseOrders) {
    const open = view.qtyOutstanding > 0;
    if (!open && !view.arrivingToday) continue;
    purchaseOrders.push({
      id: view.order.id,
      supplierId: view.order.supplierId,
      orderDate: view.order.orderDate,
      dueDate: view.dueDate,
      originalDueDate: view.originalDueDate,
      status: view.status,
      late: view.late,
      stale: view.stale,
      daysLate: view.daysLate,
      unacknowledged: view.unacknowledged,
      dueUnknown: view.dueUnknown,
      arrivingToday: view.arrivingToday,
      qtyOutstanding: view.qtyOutstanding,
      value: round2(view.valueOutstanding),
      lineCount: view.order.lines.length,
    });
    if (!open) continue;
    const supplier = must(suppliers, view.order.supplierId, 'supplier');
    supplier.openPoCount += 1;
    supplier.openPoValue = round2(supplier.openPoValue + view.valueOutstanding);
    if (view.late) {
      supplier.latePoCount += 1;
      supplier.worstDaysLate = Math.max(supplier.worstDaysLate, view.daysLate);
    }
    if (view.stale) supplier.stalePoCount += 1;
  }

  // ---- Dock
  const dock: DockPallet[] = snap.receipts
    .filter((view) => view.onDock)
    .map((view) => ({
      receiptId: view.receipt.id,
      purchaseOrderId: view.order.id,
      supplierId: view.order.supplierId,
      categoryId: view.categoryId,
      receivedDate: view.receipt.date,
      daysOnDock: view.daysOnDock,
      stale: view.stale,
      qty: view.qty,
      value: round2(view.value),
    }));

  // ---- Sales orders and customers
  const salesOrders: SalesOrderState[] = [];
  const customers = new Map<string, CustomerState>(
    model.ds.customers.map((customer) => [
      customer.id,
      {
        id: customer.id,
        name: customer.name,
        revenue: 0,
        balance: 0,
        creditLimit: customer.creditLimit,
        onStop: customer.onStopFrom !== null && customer.onStopFrom <= asOf,
        overLimit: false,
        openOrderCount: 0,
      },
    ]),
  );
  for (const view of snap.salesOrders) {
    const { order } = view;
    if (order.deliveredDate !== null && order.deliveredDate <= asOf) continue;
    salesOrders.push({
      id: order.id,
      customerId: order.customerId,
      orderDate: order.orderDate,
      committedDate: order.committedDate,
      status: view.status,
      late: view.late,
      stale: view.stale,
      daysLate: view.daysLate,
      value: round2(view.value),
      shippedDate: view.status === 'shipped' ? order.shippedDate : null,
      deliveredDate: view.status === 'shipped' ? order.deliveredDate : null,
    });
    if (view.status !== 'shipped') must(customers, order.customerId, 'customer').openOrderCount += 1;
  }

  const revenueFrom = addDays(asOf, -REVENUE_WINDOW_DAYS);
  const overdue = new Map<string, { count: number; amount: number; worst: number }>();
  const paymentsIn: MoneyMovement[] = [];
  for (const invoice of snap.salesInvoices) {
    const customer = must(customers, invoice.customerId, 'customer');
    if (invoice.date > revenueFrom) customer.revenue += invoice.net;
    if (invoice.paidDate === asOf) paymentsIn.push({ invoiceId: invoice.id, partyId: invoice.customerId, amount: invoice.net });
    if (isPaid(invoice, asOf)) continue;
    customer.balance += invoice.net;
    const daysOverdue = daysBetween(invoice.dueDate, asOf);
    if (daysOverdue > DEBT_CHASE_DAYS) {
      const entry = overdue.get(invoice.customerId) ?? { count: 0, amount: 0, worst: 0 };
      entry.count += 1;
      entry.amount += invoice.net;
      entry.worst = Math.max(entry.worst, daysOverdue);
      overdue.set(invoice.customerId, entry);
    }
  }
  for (const customer of customers.values()) {
    customer.revenue = round2(customer.revenue);
    customer.balance = round2(customer.balance);
    customer.overLimit = customer.balance > customer.creditLimit;
  }

  const billsIn: MoneyMovement[] = snap.purchaseInvoices
    .filter((invoice) => invoice.date === asOf)
    .map((invoice) => ({ invoiceId: invoice.id, partyId: invoice.supplierId, amount: invoice.net }));

  // ---- Work queues, one per function
  const goodsIn: QueueItem[] = [];
  const warehouse: QueueItem[] = [];
  for (const view of snap.receipts) {
    const { receipt, order } = view;
    if (receipt.date === asOf) {
      goodsIn.push({
        kind: 'unload',
        ref: { type: 'goodsReceipt', id: receipt.id },
        label: `Unloading ${order.id}`,
        detail: `${supplierName(order.supplierId)}, ${plural(view.qty, 'unit')}`,
        value: round2(view.value),
        ageDays: 0,
        flag: 'ok',
        categoryId: view.categoryId,
        partyId: order.supplierId,
      });
    }
    if (receipt.putawayDate === asOf || (view.onDock && receipt.date < asOf)) {
      warehouse.push({
        kind: 'putaway',
        ref: { type: 'goodsReceipt', id: receipt.id },
        label: `Putting away ${receipt.id}`,
        detail: view.stale ? `On the dock ${view.daysOnDock} days` : `From ${order.id}`,
        value: round2(view.value),
        ageDays: view.daysOnDock,
        flag: view.stale ? 'late' : 'ok',
        categoryId: view.categoryId,
        partyId: order.supplierId,
      });
    }
  }

  // ---- Desk work: who raised and entered what today, set against the working day.
  const people = new Map<string, PersonState>();
  /** Adds a job to a person's day. Returns the fields that tie the job to them. */
  const deskJob = (personId: string | null, minutes: number): Pick<QueueItem, 'personId' | 'minutes' | 'overtime'> => {
    const person = personId === null ? undefined : model.person.get(personId);
    if (!person) return {};
    let load = people.get(person.id);
    if (!load) {
      load = {
        id: person.id,
        name: person.name,
        role: model.role.get(person.id) ?? 'sales',
        jobs: 0,
        minutes: 0,
        capacityMinutes: WORKDAY_MINUTES,
        overCapacity: false,
        overtimeJobs: 0,
      };
      people.set(person.id, load);
    }
    load.jobs += 1;
    load.minutes += minutes;
    // A job is overtime if the day has already run out by the time it would be finished.
    const overtime = load.minutes > WORKDAY_MINUTES;
    if (overtime) {
      load.overCapacity = true;
      load.overtimeJobs += 1;
    }
    return { personId: person.id, minutes, overtime };
  };

  const purchasing: QueueItem[] = [];
  for (const view of snap.purchaseOrders) {
    const { order } = view;
    if (order.orderDate !== asOf) continue;
    const minutes = raisePurchaseOrderMinutes(order);
    purchasing.push({
      kind: 'raise_po',
      ref: { type: 'purchaseOrder', id: order.id },
      label: `Raising ${order.id}`,
      detail: `${supplierName(order.supplierId)}, ${plural(order.lines.length, 'line')}, ${minutes} min`,
      value: round2(order.lines.reduce((sum, line) => sum + line.qty * line.unitCost, 0)),
      ageDays: 0,
      flag: 'ok',
      categoryId: null,
      partyId: order.supplierId,
      ...deskJob(order.raisedBy, minutes),
    });
  }

  const entered = new Map(ordersEntered(snap.salesOrders, asOf).map((entry) => [entry.first.order.id, entry]));
  const sales: QueueItem[] = [];
  const dispatch: QueueItem[] = [];
  let staleSalesOrders = 0;
  let lateSalesOrders = 0;
  let worstLateOrder: { id: string; days: number } | null = null;
  for (const view of snap.salesOrders) {
    const { order } = view;
    const base = {
      ref: { type: 'salesOrder' as const, id: order.id },
      value: round2(view.value),
      ageDays: daysBetween(order.orderDate, asOf),
      flag: view.late ? ('late' as const) : ('ok' as const),
      categoryId: view.categoryId,
      partyId: order.customerId,
    };
    const customer = customerName(order.customerId);
    if (view.stale) staleSalesOrders += 1;
    if (view.late) {
      lateSalesOrders += 1;
      if (!worstLateOrder || view.daysLate > worstLateOrder.days) worstLateOrder = { id: order.id, days: view.daysLate };
    }
    const entry = entered.get(order.id);
    if (entry) {
      const minutes = enterSalesOrderMinutes(entry.lineCount);
      sales.push({
        ...base,
        kind: 'enter_order',
        label: `Entering ${order.sourceOrderId}`,
        detail: `${customer}, ${plural(entry.lineCount, 'line')}, ${minutes} min`,
        flag: 'ok',
        ...deskJob(order.enteredBy, minutes),
      });
    }
    // An order waiting for stock only becomes work for sales once its committed date has gone.
    if (view.status === 'back_ordered' && view.late) {
      sales.push({
        ...base,
        kind: 'chase_stock',
        label: `Chasing stock for ${order.id}`,
        detail: `${customer}, ${view.daysLate} days past committed date`,
        flag: 'late',
      });
    }
    if (view.status === 'allocated' || order.pickedDate === asOf) {
      warehouse.push({ ...base, kind: 'pick', label: `Picking ${order.id}`, detail: customer });
    }
    if (view.status === 'picked' || order.shippedDate === asOf) {
      dispatch.push({ ...base, kind: 'load', label: `Loading ${order.id}`, detail: customer });
    }
  }

  const accounts: QueueItem[] = [];
  for (const invoice of snap.purchaseInvoices) {
    const base = {
      ref: { type: 'purchaseInvoice' as const, id: invoice.id },
      detail: supplierName(invoice.supplierId),
      value: round2(invoice.net),
      ageDays: daysBetween(invoice.date, asOf),
      flag: 'ok' as const,
      categoryId: null,
      partyId: invoice.supplierId,
    };
    if (invoice.date === asOf) accounts.push({ ...base, kind: 'match_bill', label: `Matching bill ${invoice.id}` });
    if (invoice.paidDate === asOf) accounts.push({ ...base, kind: 'pay_bill', label: `Paying ${invoice.id}` });
  }
  for (const [customerId, entry] of overdue) {
    const customer = must(customers, customerId, 'customer');
    accounts.push({
      kind: 'chase_debt',
      ref: { type: 'customer', id: customerId },
      label: `Chasing ${customer.name}`,
      detail: `${plural(entry.count, 'invoice')} overdue, ${money(entry.amount)}`,
      value: round2(entry.amount),
      ageDays: entry.worst,
      flag: customer.onStop || entry.worst > 30 ? 'late' : 'warn',
      categoryId: null,
      partyId: customerId,
    });
  }

  const buildings: BuildingState[] = [
    { id: 'goodsIn', label: 'Goods-in', queue: goodsIn },
    { id: 'warehouse', label: 'Warehouse', queue: warehouse },
    { id: 'purchasing', label: 'Purchasing', queue: purchasing },
    { id: 'sales', label: 'Sales office', queue: sales },
    { id: 'accounts', label: 'Accounts', queue: accounts },
    { id: 'dispatch', label: 'Dispatch', queue: dispatch },
  ];

  // ---- Stock, alerts and fog
  const piles = stockpiles(model, snap);
  const alerts: (Alert & { weight: number })[] = [];
  const fog: FogFlag[] = [];

  for (const supplier of suppliers.values()) {
    if (supplier.latePoCount === 0) continue;
    alerts.push({
      id: `po_late:${supplier.id}`,
      kind: 'po_late',
      severity: supplier.worstDaysLate >= PO_LATE_SERIOUS_DAYS ? 'high' : 'medium',
      title: `${supplier.name} is late`,
      detail: `${plural(supplier.latePoCount, 'order')} overdue, worst ${plural(supplier.worstDaysLate, 'day')} late`,
      ref: { type: 'supplier', id: supplier.id },
      weight: supplier.latePoCount * 10 + supplier.worstDaysLate,
    });
  }
  for (const order of purchaseOrders) {
    if (!order.unacknowledged) continue;
    alerts.push({
      id: `po_unacknowledged:${order.id}`,
      kind: 'po_unacknowledged',
      severity: 'medium',
      title: `${order.id} not confirmed`,
      detail: `${supplierName(order.supplierId)} has not confirmed it, ${daysBetween(order.orderDate, asOf)} days after ordering`,
      ref: { type: 'purchaseOrder', id: order.id },
      weight: daysBetween(order.orderDate, asOf),
    });
  }
  const overloaded = [...people.values()].filter((person) => person.overCapacity).sort((a, b) => b.minutes - a.minutes);
  const busiest = overloaded[0];
  if (busiest) {
    alerts.push({
      id: 'person_over_capacity',
      kind: 'person_over_capacity',
      severity: 'medium',
      title: `${plural(overloaded.length, 'person', 'people')} with more than ${WORKDAY_HOURS} hours of work today`,
      detail: `${busiest.name} has the most: ${hoursAndMinutes(busiest.minutes)} for ${plural(busiest.jobs, 'order')}`,
      ref: { type: 'person', id: busiest.id },
      weight: 400,
    });
  }
  const stalePurchaseOrders = purchaseOrders.filter((order) => order.stale);
  if (stalePurchaseOrders.length > 0) {
    const oldest = stalePurchaseOrders.reduce((worst, order) => (order.daysLate > worst.daysLate ? order : worst));
    alerts.push({
      id: 'po_stale',
      kind: 'po_stale',
      severity: 'medium',
      title: `${plural(stalePurchaseOrders.length, 'purchase order')} over ${STALE_DAYS} days overdue`,
      detail: `Probably never closed, so not counted as late. Oldest is ${oldest.id}, ${oldest.daysLate} days`,
      ref: { type: 'purchaseOrder', id: oldest.id },
      weight: 500,
    });
  }
  if (staleSalesOrders > 0) {
    const oldest = salesOrders.filter((order) => order.stale).reduce((worst, order) => (order.daysLate > worst.daysLate ? order : worst));
    alerts.push({
      id: 'so_stale',
      kind: 'so_stale',
      severity: 'medium',
      title: `${plural(staleSalesOrders, 'sales order')} over ${STALE_DAYS} days past committed date`,
      detail: `Probably never closed, so not counted as late. Oldest is ${oldest.id}, ${oldest.daysLate} days`,
      ref: { type: 'salesOrder', id: oldest.id },
      weight: 499,
    });
  }
  const noDueDate = new Map<string, number>();
  for (const order of purchaseOrders) {
    if (order.dueUnknown) noDueDate.set(order.supplierId, (noDueDate.get(order.supplierId) ?? 0) + 1);
  }
  for (const [supplierId, count] of noDueDate) {
    const reason = `${plural(count, 'open order')} with no due date, so nobody can say when they will arrive`;
    fog.push({ scope: 'supplier', id: supplierId, reason });
    alerts.push({
      id: `po_no_due_date:${supplierId}`,
      kind: 'po_no_due_date',
      severity: 'medium',
      title: `${supplierName(supplierId)} has orders with no due date`,
      detail: reason,
      ref: { type: 'supplier', id: supplierId },
      weight: count / 10,
    });
  }
  for (const pallet of dock) {
    if (!pallet.stale) continue;
    alerts.push({
      id: `dock_stale:${pallet.receiptId}`,
      kind: 'dock_stale',
      severity: 'medium',
      title: `Delivery stuck on the dock`,
      detail: `${pallet.receiptId} from ${supplierName(pallet.supplierId)}, ${pallet.daysOnDock} days, ${moneyShort(pallet.value)}`,
      ref: { type: 'goodsReceipt', id: pallet.receiptId },
      weight: pallet.daysOnDock,
    });
  }
  for (const pile of piles) {
    if (pile.untrusted) {
      const reason = 'Products here show negative stock, so this figure cannot be trusted';
      fog.push({ scope: 'category', id: pile.categoryId, reason });
      alerts.push({
        id: `stock_untrusted:${pile.categoryId}`,
        kind: 'stock_untrusted',
        severity: 'high',
        title: `${pile.name} stock cannot be trusted`,
        detail: reason,
        ref: { type: 'category', id: pile.categoryId },
        weight: 1000,
      });
    }
    if (pile.ageBand >= 1) {
      alerts.push({
        id: `stock_aged:${pile.categoryId}`,
        kind: 'stock_aged',
        severity: 'medium',
        title: `${pile.name} stock is ageing`,
        detail: `${moneyShort(pile.agedValue)} not received for over ${AGE_BAND_DAYS[(pile.ageBand - 1) as 0 | 1 | 2]} days`,
        ref: { type: 'category', id: pile.categoryId },
        weight: pile.ageBand,
      });
    }
  }
  if (lateSalesOrders > 0 && worstLateOrder) {
    alerts.push({
      id: 'so_late',
      kind: 'so_late',
      severity: lateSalesOrders >= 20 ? 'high' : 'medium',
      title: `${plural(lateSalesOrders, 'sales order')} past committed date`,
      detail: `Worst is ${worstLateOrder.id}, ${plural(worstLateOrder.days, 'day')} late`,
      ref: { type: 'salesOrder', id: worstLateOrder.id },
      weight: lateSalesOrders,
    });
  }
  for (const customer of customers.values()) {
    if (customer.onStop) {
      alerts.push({
        id: `customer_on_stop:${customer.id}`,
        kind: 'customer_on_stop',
        severity: 'high',
        title: `${customer.name} is on stop`,
        detail: `Owes ${money(customer.balance)}`,
        ref: { type: 'customer', id: customer.id },
        weight: customer.balance / 1000,
      });
    } else if (customer.overLimit) {
      alerts.push({
        id: `customer_over_limit:${customer.id}`,
        kind: 'customer_over_limit',
        severity: 'medium',
        title: `${customer.name} is over its credit limit`,
        detail: `Owes ${money(customer.balance)} against a limit of ${money(customer.creditLimit)}`,
        ref: { type: 'customer', id: customer.id },
        weight: (customer.balance - customer.creditLimit) / 1000,
      });
    }
  }
  alerts.sort(
    (a, b) => Number(b.severity === 'high') - Number(a.severity === 'high') || b.weight - a.weight || a.id.localeCompare(b.id),
  );

  return {
    asOf,
    figures: FIGURE_IDS.map((id) => figureRecords(model, snap, id).figure),
    people: [...people.values()].sort((a, b) => b.minutes - a.minutes || a.id.localeCompare(b.id)),
    suppliers: [...suppliers.values()],
    customers: [...customers.values()],
    purchaseOrders,
    dock,
    stockpiles: piles,
    salesOrders,
    paymentsIn,
    billsIn,
    buildings,
    // The most pressing alerts only. Everything else is still on the map and in the table view.
    alerts: alerts.slice(0, MAX_ALERTS).map(({ id, kind, severity, title, detail, ref }): Alert => ({ id, kind, severity, title, detail, ref })),
    fog,
  };
}
