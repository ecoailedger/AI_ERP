/**
 * Snapshot: the position of every document and stock row on one date.
 * It only uses facts dated on or before that date, so replaying history never peeks ahead.
 */
import {
  daysBetween,
  type GoodsReceipt,
  type IsoDate,
  type PurchaseInvoice,
  type PurchaseOrder,
  type PurchaseOrderStatus,
  type SalesInvoice,
  type SalesOrder,
  type SalesOrderStatus,
} from '@ai-erp/domain';
import { must, type Model } from './model';
import { DOCK_STALE_DAYS, UNACKNOWLEDGED_DAYS } from './rules';

export interface PurchaseOrderView {
  order: PurchaseOrder;
  receivedByLine: Map<number, number>;
  qtyOutstanding: number;
  valueOutstanding: number;
  dueDate: IsoDate;
  originalDueDate: IsoDate;
  status: PurchaseOrderStatus;
  late: boolean;
  daysLate: number;
  unacknowledged: boolean;
  arrivingToday: boolean;
}

export interface ReceiptView {
  receipt: GoodsReceipt;
  order: PurchaseOrder;
  qty: number;
  value: number;
  /** Category holding most of the delivery's value. */
  categoryId: string;
  onDock: boolean;
  daysOnDock: number;
  stale: boolean;
}

export interface SalesOrderView {
  order: SalesOrder;
  value: number;
  status: SalesOrderStatus;
  late: boolean;
  daysLate: number;
  /** Category holding most of the order's value. */
  categoryId: string;
}

export interface Snapshot {
  asOf: IsoDate;
  stockQty: Map<string, number>;
  lastReceipt: Map<string, IsoDate>;
  /** Every order raised on or before the date. */
  purchaseOrders: PurchaseOrderView[];
  /** Every delivery received on or before the date. */
  receipts: ReceiptView[];
  /** Every order entered on or before the date. */
  salesOrders: SalesOrderView[];
  salesInvoices: SalesInvoice[];
  purchaseInvoices: PurchaseInvoice[];
}

const reached = (date: IsoDate | null, asOf: IsoDate): date is IsoDate => date !== null && date <= asOf;

export function isPaid(invoice: { paidDate: IsoDate | null }, asOf: IsoDate): boolean {
  return reached(invoice.paidDate, asOf);
}

function viewPurchaseOrder(model: Model, order: PurchaseOrder, asOf: IsoDate): PurchaseOrderView {
  const receivedByLine = new Map<number, number>();
  let arrivingToday = false;
  for (const receipt of model.receiptsByOrder.get(order.id) ?? []) {
    if (receipt.date > asOf) continue;
    if (receipt.date === asOf) arrivingToday = true;
    for (const line of receipt.lines) receivedByLine.set(line.line, (receivedByLine.get(line.line) ?? 0) + line.qty);
  }

  let qtyOutstanding = 0;
  let valueOutstanding = 0;
  let earliestOpenDue: IsoDate | null = null;
  let latestDue = '';
  let originalDueDate = '';
  for (const line of order.lines) {
    const outstanding = Math.max(0, line.qty - (receivedByLine.get(line.line) ?? 0));
    qtyOutstanding += outstanding;
    valueOutstanding += outstanding * line.unitCost;
    if (outstanding > 0 && (earliestOpenDue === null || line.dueDate < earliestOpenDue)) earliestOpenDue = line.dueDate;
    if (line.dueDate > latestDue) latestDue = line.dueDate;
    if (line.originalDueDate > originalDueDate) originalDueDate = line.originalDueDate;
  }
  const dueDate = earliestOpenDue ?? latestDue;

  let status: PurchaseOrderStatus;
  if (qtyOutstanding === 0) status = 'received';
  else if (receivedByLine.size > 0) status = 'partly_received';
  else if (reached(order.acknowledgedDate, asOf)) status = 'in_transit';
  else status = 'raised';

  const late = qtyOutstanding > 0 && dueDate < asOf;
  return {
    order,
    receivedByLine,
    qtyOutstanding,
    valueOutstanding,
    dueDate,
    originalDueDate,
    status,
    late,
    daysLate: late ? daysBetween(dueDate, asOf) : 0,
    unacknowledged: status === 'raised' && daysBetween(order.orderDate, asOf) > UNACKNOWLEDGED_DAYS,
    arrivingToday,
  };
}

/** The category carrying the most value across a set of product lines. */
function mainCategory(model: Model, lines: { productId: string; amount: number }[]): string {
  const totals = new Map<string, number>();
  for (const line of lines) {
    const categoryId = must(model.product, line.productId, 'product').categoryId;
    totals.set(categoryId, (totals.get(categoryId) ?? 0) + line.amount);
  }
  let best = '';
  let bestValue = -1;
  for (const [categoryId, value] of totals) {
    if (value > bestValue || (value === bestValue && categoryId < best)) {
      best = categoryId;
      bestValue = value;
    }
  }
  return best;
}

function viewSalesOrder(model: Model, order: SalesOrder, asOf: IsoDate): SalesOrderView {
  let status: SalesOrderStatus;
  if (reached(order.shippedDate, asOf)) status = 'shipped';
  else if (reached(order.pickedDate, asOf)) status = 'picked';
  else if (reached(order.allocatedDate, asOf)) status = 'allocated';
  else status = 'back_ordered';

  const late = status !== 'shipped' && order.committedDate < asOf;
  return {
    order,
    value: order.lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0),
    status,
    late,
    daysLate: late ? daysBetween(order.committedDate, asOf) : 0,
    categoryId: mainCategory(
      model,
      order.lines.map((line) => ({ productId: line.productId, amount: line.qty * line.unitPrice })),
    ),
  };
}

export function takeSnapshot(model: Model, asOf: IsoDate): Snapshot {
  const { ds } = model;
  const stockQty = new Map<string, number>();
  const lastReceipt = new Map<string, IsoDate>();
  for (const opening of ds.openingStock) {
    stockQty.set(opening.productId, opening.qty);
    lastReceipt.set(opening.productId, opening.lastReceiptDate);
  }

  const receipts: ReceiptView[] = [];
  for (const receipt of ds.goodsReceipts) {
    if (receipt.date > asOf) continue;
    const order = must(model.purchaseOrder, receipt.purchaseOrderId, 'purchase order');
    let qty = 0;
    let value = 0;
    const valueLines: { productId: string; amount: number }[] = [];
    for (const received of receipt.lines) {
      const line = order.lines.find((candidate) => candidate.line === received.line);
      if (!line) throw new Error(`Dataset is inconsistent: ${receipt.id} receives a missing line of ${order.id}`);
      stockQty.set(line.productId, (stockQty.get(line.productId) ?? 0) + received.qty);
      if ((lastReceipt.get(line.productId) ?? '') < receipt.date) lastReceipt.set(line.productId, receipt.date);
      qty += received.qty;
      value += received.qty * line.unitCost;
      valueLines.push({ productId: line.productId, amount: received.qty * line.unitCost });
    }
    const onDock = !reached(receipt.putawayDate, asOf);
    const daysOnDock = onDock ? daysBetween(receipt.date, asOf) : 0;
    receipts.push({
      receipt,
      order,
      qty,
      value,
      categoryId: mainCategory(model, valueLines),
      onDock,
      daysOnDock,
      stale: onDock && daysOnDock > DOCK_STALE_DAYS,
    });
  }

  const salesOrders: SalesOrderView[] = [];
  for (const order of ds.salesOrders) {
    if (order.orderDate > asOf) continue;
    const view = viewSalesOrder(model, order, asOf);
    if (view.status === 'shipped') {
      for (const line of order.lines) stockQty.set(line.productId, (stockQty.get(line.productId) ?? 0) - line.qty);
    }
    salesOrders.push(view);
  }

  return {
    asOf,
    stockQty,
    lastReceipt,
    purchaseOrders: ds.purchaseOrders
      .filter((order) => order.orderDate <= asOf)
      .map((order) => viewPurchaseOrder(model, order, asOf)),
    receipts,
    salesOrders,
    salesInvoices: ds.salesInvoices.filter((invoice) => invoice.date <= asOf),
    purchaseInvoices: ds.purchaseInvoices.filter((invoice) => invoice.date <= asOf),
  };
}
