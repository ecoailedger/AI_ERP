/** Record cards: one record, as it stood on a date, with where it came from and what it links to. */
import { daysBetween, UNKNOWN_DATE, type IsoDate, type RecordCard, type RecordRef, type RecordType } from '@ai-erp/domain';
import { money, plural } from './format';
import type { Model } from './model';
import { AGE_BAND_DAYS } from './rules';
import { isPaid, type Snapshot } from './snapshot';
import {
  enterSalesOrderMinutes,
  hoursAndMinutes,
  ordersEntered,
  raisePurchaseOrderMinutes,
  WORKDAY_HOURS,
  WORKDAY_MINUTES,
} from './workload';

const ENTITY: Record<RecordType, string> = {
  person: 'people',
  supplier: 'suppliers',
  customer: 'customers',
  product: 'products',
  category: 'categories',
  purchaseOrder: 'purchaseOrders',
  goodsReceipt: 'goodsReceipts',
  salesOrder: 'salesOrders',
  salesInvoice: 'salesInvoices',
  purchaseInvoice: 'purchaseInvoices',
};

const MAX_RELATED = 12;
type Status = RecordCard['status'];
type Related = RecordCard['related'];

const shown = (date: IsoDate | null, asOf: IsoDate): string => (date !== null && date <= asOf ? date : 'Not yet');

export function recordCard(model: Model, snap: Snapshot, ref: RecordRef): RecordCard | null {
  const { asOf } = snap;
  const base = (card: Omit<RecordCard, 'ref' | 'source'>): RecordCard => ({
    ...card,
    ref,
    related: card.related.slice(0, MAX_RELATED),
    source: [{ system: model.ds.meta.source, entity: ENTITY[ref.type], id: ref.id }],
  });

  switch (ref.type) {
    case 'purchaseOrder': {
      const view = snap.purchaseOrders.find((candidate) => candidate.order.id === ref.id);
      if (!view) return null;
      const { order } = view;
      const supplier = model.supplier.get(order.supplierId);
      let status: Status;
      if (view.late) status = { text: `Late by ${plural(view.daysLate, 'day')}`, flag: 'late' };
      else if (view.stale) status = { text: `${view.daysLate} days overdue: probably never closed`, flag: 'warn' };
      else if (view.dueUnknown) status = { text: 'No due date held', flag: 'warn' };
      else if (view.unacknowledged) status = { text: 'Supplier has not confirmed', flag: 'warn' };
      else if (view.status === 'received') status = { text: 'Received in full', flag: 'ok' };
      else if (view.status === 'partly_received') status = { text: 'Part received', flag: 'ok' };
      else if (view.status === 'in_transit') status = { text: 'On its way', flag: 'ok' };
      else status = { text: 'Raised, waiting for confirmation', flag: 'ok' };
      const receipts = (model.receiptsByOrder.get(order.id) ?? []).filter((receipt) => receipt.date <= asOf);
      const invoices = (model.purchaseInvoicesByOrder.get(order.id) ?? []).filter((invoice) => invoice.date <= asOf);
      return base({
        title: `Purchase order ${order.id}`,
        subtitle: supplier?.name ?? order.supplierId,
        status,
        fields: [
          { label: 'Ordered', value: order.orderDate },
          { label: 'Due', value: view.dueUnknown ? 'Not held' : view.dueDate },
          { label: 'Originally due', value: view.originalDueDate >= UNKNOWN_DATE ? 'Not held' : view.originalDueDate },
          { label: 'Confirmed by supplier', value: shown(order.acknowledgedDate, asOf) },
          { label: 'Still to arrive', value: `${plural(view.qtyOutstanding, 'unit')}, ${money(view.valueOutstanding)}` },
        ],
        lines: {
          columns: ['Line', 'Product', 'Ordered', 'Received', 'Unit cost'],
          rows: order.lines.map((line) => [
            String(line.line),
            model.product.get(line.productId)?.description ?? line.productId,
            String(line.qty),
            String(view.receivedByLine.get(line.line) ?? 0),
            money(line.unitCost),
          ]),
        },
        related: [
          { ref: { type: 'supplier', id: order.supplierId }, label: supplier?.name ?? order.supplierId },
          ...receipts.map((receipt): Related[number] => ({ ref: { type: 'goodsReceipt', id: receipt.id }, label: `Delivery ${receipt.id}` })),
          ...invoices.map((invoice): Related[number] => ({ ref: { type: 'purchaseInvoice', id: invoice.id }, label: `Bill ${invoice.id}` })),
        ],
      });
    }

    case 'goodsReceipt': {
      const view = snap.receipts.find((candidate) => candidate.receipt.id === ref.id);
      if (!view) return null;
      const { receipt, order } = view;
      return base({
        title: `Delivery ${receipt.id}`,
        subtitle: model.supplier.get(order.supplierId)?.name ?? order.supplierId,
        status: view.stale
          ? { text: `On the dock ${plural(view.daysOnDock, 'day')}`, flag: 'late' }
          : view.onDock
            ? { text: 'On the dock', flag: 'ok' }
            : { text: 'Put away', flag: 'ok' },
        fields: [
          { label: 'Received', value: receipt.date },
          { label: 'Put away', value: shown(receipt.putawayDate, asOf) },
          { label: 'Units', value: String(view.qty) },
          { label: 'Value', value: money(view.value) },
        ],
        lines: {
          columns: ['Line', 'Product', 'Received'],
          rows: receipt.lines.map((received) => {
            const line = order.lines.find((candidate) => candidate.line === received.line);
            return [String(received.line), (line && model.product.get(line.productId)?.description) ?? '', String(received.qty)];
          }),
        },
        related: [
          { ref: { type: 'purchaseOrder', id: order.id }, label: `Purchase order ${order.id}` },
          { ref: { type: 'category', id: view.categoryId }, label: model.category.get(view.categoryId)?.name ?? view.categoryId },
        ],
      });
    }

    case 'salesOrder': {
      const view = snap.salesOrders.find((candidate) => candidate.order.id === ref.id);
      if (!view) return null;
      const { order } = view;
      const customer = model.customer.get(order.customerId);
      const delivered = order.deliveredDate !== null && order.deliveredDate <= asOf;
      let status: Status;
      if (view.late) status = { text: `Past committed date by ${plural(view.daysLate, 'day')}`, flag: 'late' };
      else if (view.stale) status = { text: `${view.daysLate} days past committed date: probably never closed`, flag: 'warn' };
      else if (delivered) status = { text: 'Delivered', flag: 'ok' };
      else if (view.status === 'shipped') status = { text: 'On its way to the customer', flag: 'ok' };
      else if (view.status === 'picked') status = { text: 'Picked, waiting to ship', flag: 'ok' };
      else if (view.status === 'allocated') status = { text: 'Stock allocated, waiting to be picked', flag: 'ok' };
      else status = { text: 'Not yet allocated', flag: 'warn' };
      const invoice = model.salesInvoiceByOrder.get(order.id);
      return base({
        title: `Sales order ${order.id}`,
        subtitle: customer?.name ?? order.customerId,
        status,
        fields: [
          { label: 'Ordered', value: order.orderDate },
          { label: 'Committed', value: order.committedDate >= UNKNOWN_DATE ? 'Not held' : order.committedDate },
          { label: 'Allocated', value: shown(order.allocatedDate, asOf) },
          { label: 'Picked', value: shown(order.pickedDate, asOf) },
          { label: 'Shipped', value: shown(order.shippedDate, asOf) },
          { label: 'Value', value: money(view.value) },
        ],
        lines: {
          columns: ['Line', 'Product', 'Qty', 'Unit price'],
          rows: order.lines.map((line) => [
            String(line.line),
            model.product.get(line.productId)?.description ?? line.productId,
            String(line.qty),
            money(line.unitPrice),
          ]),
        },
        related: [
          { ref: { type: 'customer', id: order.customerId }, label: customer?.name ?? order.customerId },
          ...(invoice && invoice.date <= asOf
            ? [{ ref: { type: 'salesInvoice' as const, id: invoice.id }, label: `Invoice ${invoice.id}` }]
            : []),
        ],
      });
    }

    case 'salesInvoice': {
      const invoice = model.salesInvoice.get(ref.id);
      if (!invoice || invoice.date > asOf) return null;
      const paid = isPaid(invoice, asOf);
      const overdue = daysBetween(invoice.dueDate, asOf);
      return base({
        title: `Sales invoice ${invoice.id}`,
        subtitle: model.customer.get(invoice.customerId)?.name ?? invoice.customerId,
        status: paid
          ? { text: 'Paid', flag: 'ok' }
          : overdue > 0
            ? { text: `Overdue by ${plural(overdue, 'day')}`, flag: 'late' }
            : { text: 'Not yet due', flag: 'ok' },
        fields: [
          { label: 'Invoiced', value: invoice.date },
          { label: 'Due', value: invoice.dueDate },
          { label: 'Paid', value: shown(invoice.paidDate, asOf) },
          { label: 'Net amount', value: money(invoice.net) },
        ],
        lines: null,
        related: [
          { ref: { type: 'salesOrder', id: invoice.salesOrderId }, label: `Sales order ${invoice.salesOrderId}` },
          { ref: { type: 'customer', id: invoice.customerId }, label: model.customer.get(invoice.customerId)?.name ?? invoice.customerId },
        ],
      });
    }

    case 'purchaseInvoice': {
      const invoice = model.purchaseInvoice.get(ref.id);
      if (!invoice || invoice.date > asOf) return null;
      const paid = isPaid(invoice, asOf);
      return base({
        title: `Supplier bill ${invoice.id}`,
        subtitle: model.supplier.get(invoice.supplierId)?.name ?? invoice.supplierId,
        status: paid ? { text: 'Paid', flag: 'ok' } : { text: `Due ${invoice.dueDate}`, flag: 'ok' },
        fields: [
          { label: 'Received', value: invoice.date },
          { label: 'Due', value: invoice.dueDate },
          { label: 'Paid', value: shown(invoice.paidDate, asOf) },
          { label: 'Net amount', value: money(invoice.net) },
        ],
        lines: null,
        related: [
          { ref: { type: 'purchaseOrder', id: invoice.purchaseOrderId }, label: `Purchase order ${invoice.purchaseOrderId}` },
          { ref: { type: 'goodsReceipt', id: invoice.goodsReceiptId }, label: `Delivery ${invoice.goodsReceiptId}` },
          { ref: { type: 'supplier', id: invoice.supplierId }, label: model.supplier.get(invoice.supplierId)?.name ?? invoice.supplierId },
        ],
      });
    }

    case 'supplier': {
      const supplier = model.supplier.get(ref.id);
      if (!supplier) return null;
      const open = snap.purchaseOrders
        .filter((view) => view.order.supplierId === supplier.id && view.qtyOutstanding > 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const late = open.filter((view) => view.late);
      const worst = late.reduce((max, view) => Math.max(max, view.daysLate), 0);
      return base({
        title: supplier.name,
        subtitle: `Supplier ${supplier.id}`,
        status:
          late.length > 0
            ? { text: `${plural(late.length, 'order')} late, worst ${plural(worst, 'day')}`, flag: 'late' }
            : { text: 'Nothing late', flag: 'ok' },
        fields: [
          { label: 'Usual lead time', value: plural(supplier.leadTimeDays, 'day') },
          { label: 'Open orders', value: String(open.length) },
          { label: 'Value on order', value: money(open.reduce((sum, view) => sum + view.valueOutstanding, 0)) },
        ],
        lines: {
          columns: ['Order', 'Due', 'Status', 'Outstanding'],
          rows: open.map((view) => [
            view.order.id,
            view.dueDate,
            view.late ? `${view.daysLate} days late` : view.stale ? `Stale, ${view.daysLate} days overdue` : view.dueUnknown ? 'No due date' : view.status === 'raised' ? 'Not confirmed' : 'On its way',
            money(view.valueOutstanding),
          ]),
        },
        related: open.map((view) => ({
          ref: { type: 'purchaseOrder' as const, id: view.order.id },
          label: view.late ? `${view.order.id}, ${view.daysLate} days late` : view.stale ? `${view.order.id}, stale` : view.order.id,
        })),
      });
    }

    case 'customer': {
      const customer = model.customer.get(ref.id);
      if (!customer) return null;
      const unpaid = snap.salesInvoices
        .filter((invoice) => invoice.customerId === customer.id && !isPaid(invoice, asOf))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const balance = unpaid.reduce((sum, invoice) => sum + invoice.net, 0);
      const openOrders = snap.salesOrders.filter((view) => view.order.customerId === customer.id && view.status !== 'shipped');
      const onStop = customer.onStopFrom !== null && customer.onStopFrom <= asOf;
      return base({
        title: customer.name,
        subtitle: `Customer ${customer.id}`,
        status: onStop
          ? { text: `On stop since ${customer.onStopFrom}`, flag: 'late' }
          : balance > customer.creditLimit
            ? { text: 'Over credit limit', flag: 'warn' }
            : { text: 'Trading normally', flag: 'ok' },
        fields: [
          { label: 'Owes', value: money(balance) },
          { label: 'Credit limit', value: money(customer.creditLimit) },
          { label: 'Terms', value: plural(customer.termsDays, 'day') },
          { label: 'Open orders', value: String(openOrders.length) },
        ],
        lines: {
          columns: ['Invoice', 'Due', 'Status', 'Amount'],
          rows: unpaid.map((invoice) => {
            const overdue = daysBetween(invoice.dueDate, asOf);
            return [invoice.id, invoice.dueDate, overdue > 0 ? `${overdue} days overdue` : 'Not yet due', money(invoice.net)];
          }),
        },
        related: [
          ...openOrders.map((view): Related[number] => ({ ref: { type: 'salesOrder', id: view.order.id }, label: `Order ${view.order.id}` })),
          ...unpaid.map((invoice): Related[number] => ({ ref: { type: 'salesInvoice', id: invoice.id }, label: `Invoice ${invoice.id}` })),
        ],
      });
    }

    case 'category': {
      const category = model.category.get(ref.id);
      if (!category) return null;
      const rows = model.ds.products
        .filter((product) => product.categoryId === category.id)
        .map((product) => {
          const qty = snap.stockQty.get(product.id) ?? 0;
          const age = daysBetween(snap.lastReceipt.get(product.id) ?? asOf, asOf);
          return { product, qty, age, value: qty > 0 ? qty * product.unitCost : 0 };
        })
        .filter((row) => row.qty !== 0)
        .sort((a, b) => Number(a.qty > 0) - Number(b.qty > 0) || b.value - a.value);
      const value = rows.reduce((sum, row) => sum + row.value, 0);
      const aged = rows.filter((row) => row.qty > 0 && row.age > AGE_BAND_DAYS[0]).reduce((sum, row) => sum + row.value, 0);
      const negative = rows.filter((row) => row.qty < 0);
      return base({
        title: `${category.name} stock`,
        subtitle: `Category ${category.id}`,
        status:
          negative.length > 0
            ? { text: `${plural(negative.length, 'product')} with negative stock`, flag: 'late' }
            : aged > 0
              ? { text: `${money(aged)} over ${AGE_BAND_DAYS[0]} days old`, flag: 'warn' }
              : { text: 'Fresh', flag: 'ok' },
        fields: [
          { label: 'Stock value', value: money(value) },
          { label: 'Products in stock', value: String(rows.filter((row) => row.qty > 0).length) },
          { label: `Over ${AGE_BAND_DAYS[0]} days old`, value: money(aged) },
        ],
        lines: {
          columns: ['Product', 'Qty', 'Days since receipt', 'Value'],
          rows: rows
            .slice(0, 15)
            .map((row) => [row.product.description, String(row.qty), String(row.age), row.qty > 0 ? money(row.value) : 'Untrusted']),
        },
        related: rows.slice(0, MAX_RELATED).map((row) => ({ ref: { type: 'product' as const, id: row.product.id }, label: row.product.description })),
      });
    }

    case 'person': {
      const person = model.person.get(ref.id);
      if (!person) return null;
      const raised = snap.purchaseOrders.filter((view) => view.order.raisedBy === person.id && view.order.orderDate === asOf);
      const entered = ordersEntered(snap.salesOrders, asOf).filter((entry) => entry.first.order.enteredBy === person.id);
      const jobs = [
        ...raised.map((view) => ({
          ref: { type: 'purchaseOrder' as const, id: view.order.id },
          label: `Raised ${view.order.id}`,
          detail: model.supplier.get(view.order.supplierId)?.name ?? view.order.supplierId,
          minutes: raisePurchaseOrderMinutes(view.order),
        })),
        ...entered.map(({ first, lineCount }) => ({
          ref: { type: 'salesOrder' as const, id: first.order.id },
          label: `Entered ${first.order.sourceOrderId}`,
          detail: model.customer.get(first.order.customerId)?.name ?? first.order.customerId,
          minutes: enterSalesOrderMinutes(lineCount),
        })),
      ];
      const minutes = jobs.reduce((sum, job) => sum + job.minutes, 0);
      const role = model.role.get(person.id) ?? 'sales';
      return base({
        title: person.name,
        subtitle: role === 'buyer' ? 'Buyer' : role === 'sales' ? 'Sales' : 'Buyer and sales',
        status:
          minutes > WORKDAY_MINUTES
            ? { text: `${hoursAndMinutes(minutes - WORKDAY_MINUTES)} more than a ${WORKDAY_HOURS} hour day`, flag: 'late' }
            : jobs.length === 0
              ? { text: 'No orders today', flag: 'ok' }
              : { text: `Fits in a ${WORKDAY_HOURS} hour day`, flag: 'ok' },
        fields: [
          { label: 'Orders today', value: String(jobs.length) },
          { label: 'Time needed', value: hoursAndMinutes(minutes) },
          { label: 'Working day', value: `${WORKDAY_HOURS} hours` },
          { label: 'Share of the day', value: `${Math.round((minutes / WORKDAY_MINUTES) * 100)}%` },
        ],
        lines: {
          columns: ['Job', 'For', 'Minutes'],
          rows: jobs.slice(0, 60).map((job) => [job.label, job.detail, String(job.minutes)]),
        },
        related: jobs.map((job) => ({ ref: job.ref, label: job.label })),
      });
    }

    case 'product': {
      const product = model.product.get(ref.id);
      if (!product) return null;
      const qty = snap.stockQty.get(product.id) ?? 0;
      const age = daysBetween(snap.lastReceipt.get(product.id) ?? asOf, asOf);
      return base({
        title: product.description,
        subtitle: `Product ${product.id}`,
        status:
          qty < 0
            ? { text: 'Negative stock: cannot be trusted', flag: 'late' }
            : qty > 0 && age > AGE_BAND_DAYS[0]
              ? { text: `Not received for ${plural(age, 'day')}`, flag: 'warn' }
              : { text: qty > 0 ? 'In stock' : 'Out of stock', flag: 'ok' },
        fields: [
          { label: 'In stock', value: String(qty) },
          { label: 'Unit cost', value: money(product.unitCost) },
          { label: 'Sell price', value: money(product.sellPrice) },
          { label: 'Last received', value: snap.lastReceipt.get(product.id) ?? 'Never' },
        ],
        lines: null,
        related: [
          { ref: { type: 'category', id: product.categoryId }, label: model.category.get(product.categoryId)?.name ?? product.categoryId },
          { ref: { type: 'supplier', id: product.supplierId }, label: model.supplier.get(product.supplierId)?.name ?? product.supplierId },
        ],
      });
    }
  }
}
