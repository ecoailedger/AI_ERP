/**
 * Resource bar figures. Each figure is built from its rows, so the number shown
 * always equals the sum of the records behind it (CONTEXT principle 4).
 */
import { daysBetween, UNKNOWN_DATE, type Figure, type FigureId, type FigureRecords } from '@ai-erp/domain';
import { money, round2 } from './format';
import { must, type Model } from './model';
import { isPaid, type Snapshot } from './snapshot';

const LABELS: Record<FigureId, string> = {
  stockValue: 'Stock value',
  debtors: 'Debtors',
  openSalesOrders: 'Open sales orders',
  openPurchaseOrders: 'Open purchase orders',
  creditors: 'Creditors',
  cash: 'Cash',
};

const STATUS_TEXT = {
  back_ordered: 'Not yet allocated',
  allocated: 'Allocated',
  picked: 'Picked',
  shipped: 'Shipped',
  raised: 'Not confirmed',
  in_transit: 'In transit',
  partly_received: 'Part received',
  received: 'Received',
} as const;

type Rows = FigureRecords['rows'];

function stockRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const rows: Rows = [];
  for (const product of model.ds.products) {
    const qty = snap.stockQty.get(product.id) ?? 0;
    if (qty === 0) continue;
    const category = must(model.category, product.categoryId, 'category');
    // Negative stock cannot be valued. It is listed at zero and flagged.
    const amount = qty > 0 ? round2(qty * product.unitCost) : 0;
    rows.push({
      ref: { type: 'product', id: product.id },
      cells: [product.id, product.description, category.name, String(qty), money(product.unitCost), qty > 0 ? money(amount) : 'Untrusted: negative'],
      amount,
    });
  }
  rows.sort((a, b) => b.amount - a.amount);
  return { columns: ['Product', 'Description', 'Category', 'Qty', 'Unit cost', 'Value'], rows };
}

function debtorRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const rows: Rows = snap.salesInvoices
    .filter((invoice) => !isPaid(invoice, snap.asOf))
    .map((invoice) => {
      const overdue = daysBetween(invoice.dueDate, snap.asOf);
      return {
        ref: { type: 'salesInvoice' as const, id: invoice.id },
        cells: [
          invoice.id,
          must(model.customer, invoice.customerId, 'customer').name,
          invoice.date,
          invoice.dueDate,
          overdue > 0 ? `${overdue} days overdue` : 'Not yet due',
          money(invoice.net),
        ],
        amount: round2(invoice.net),
      };
    });
  rows.sort((a, b) => (a.cells[3] as string).localeCompare(b.cells[3] as string));
  return { columns: ['Invoice', 'Customer', 'Date', 'Due', 'Status', 'Amount'], rows };
}

function openSalesOrderRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const rows: Rows = snap.salesOrders
    .filter((view) => view.status !== 'shipped')
    .map((view) => ({
      ref: { type: 'salesOrder' as const, id: view.order.id },
      cells: [
        view.order.id,
        must(model.customer, view.order.customerId, 'customer').name,
        view.order.orderDate,
        view.order.committedDate >= UNKNOWN_DATE ? 'Not held' : view.order.committedDate,
        view.late ? `${STATUS_TEXT[view.status]}, ${view.daysLate} days late` : STATUS_TEXT[view.status],
        money(view.value),
      ],
      amount: round2(view.value),
    }));
  rows.sort((a, b) => (a.cells[3] as string).localeCompare(b.cells[3] as string));
  return { columns: ['Order', 'Customer', 'Ordered', 'Committed', 'Status', 'Value'], rows };
}

function openPurchaseOrderRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const rows: Rows = snap.purchaseOrders
    .filter((view) => view.qtyOutstanding > 0)
    .map((view) => ({
      ref: { type: 'purchaseOrder' as const, id: view.order.id },
      cells: [
        view.order.id,
        must(model.supplier, view.order.supplierId, 'supplier').name,
        view.order.orderDate,
        view.dueDate,
        view.late ? `${STATUS_TEXT[view.status]}, ${view.daysLate} days late` : STATUS_TEXT[view.status],
        money(view.valueOutstanding),
      ],
      amount: round2(view.valueOutstanding),
    }));
  rows.sort((a, b) => (a.cells[3] as string).localeCompare(b.cells[3] as string));
  return { columns: ['Order', 'Supplier', 'Ordered', 'Due', 'Status', 'Outstanding'], rows };
}

function creditorRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const rows: Rows = snap.purchaseInvoices
    .filter((invoice) => !isPaid(invoice, snap.asOf))
    .map((invoice) => ({
      ref: { type: 'purchaseInvoice' as const, id: invoice.id },
      cells: [
        invoice.id,
        must(model.supplier, invoice.supplierId, 'supplier').name,
        invoice.date,
        invoice.dueDate,
        money(invoice.net),
      ],
      amount: round2(invoice.net),
    }));
  rows.sort((a, b) => (a.cells[3] as string).localeCompare(b.cells[3] as string));
  return { columns: ['Invoice', 'Supplier', 'Date', 'Due', 'Amount'], rows };
}

function cashRows(model: Model, snap: Snapshot): { columns: string[]; rows: Rows } {
  const movements: Rows = [];
  for (const invoice of snap.salesInvoices) {
    if (!isPaid(invoice, snap.asOf)) continue;
    movements.push({
      ref: { type: 'salesInvoice', id: invoice.id },
      cells: [invoice.paidDate ?? '', `Received from ${must(model.customer, invoice.customerId, 'customer').name}`, invoice.id, money(invoice.net)],
      amount: round2(invoice.net),
    });
  }
  for (const invoice of snap.purchaseInvoices) {
    if (!isPaid(invoice, snap.asOf)) continue;
    movements.push({
      ref: { type: 'purchaseInvoice', id: invoice.id },
      cells: [invoice.paidDate ?? '', `Paid to ${must(model.supplier, invoice.supplierId, 'supplier').name}`, invoice.id, money(-invoice.net)],
      amount: round2(-invoice.net),
    });
  }
  movements.sort((a, b) => (b.cells[0] as string).localeCompare(a.cells[0] as string));
  const opening = model.ds.meta.openingCash;
  return {
    columns: ['Date', 'Movement', 'Invoice', 'Amount'],
    rows: [{ ref: null, cells: ['', 'Opening balance', '', money(opening)], amount: round2(opening) }, ...movements],
  };
}

const BUILDERS: Record<FigureId, (model: Model, snap: Snapshot) => { columns: string[]; rows: Rows }> = {
  stockValue: stockRows,
  debtors: debtorRows,
  openSalesOrders: openSalesOrderRows,
  openPurchaseOrders: openPurchaseOrderRows,
  creditors: creditorRows,
  cash: cashRows,
};

export function figureRecords(model: Model, snap: Snapshot, id: FigureId): FigureRecords {
  const { columns, rows } = BUILDERS[id](model, snap);
  const figure: Figure = {
    id,
    label: LABELS[id],
    value: round2(rows.reduce((sum, row) => sum + row.amount, 0)),
    count: rows.filter((row) => row.ref !== null).length,
    simulated: model.ds.meta.simulated.includes(id),
  };
  return { figure, columns, rows };
}
