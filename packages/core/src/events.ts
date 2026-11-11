/** The event log: every dated fact in the dataset as one ordered list. Drives the replay. */
import type { IsoDate, RecordRef, WorldEvent, WorldEventType } from '@ai-erp/domain';
import { money } from './format';
import type { Model } from './model';

export function buildEvents(model: Model): WorldEvent[] {
  const { ds } = model;
  const events: WorldEvent[] = [];
  const add = (date: IsoDate | null, type: WorldEventType, ref: RecordRef, text: string): void => {
    if (date !== null) events.push({ id: `${type}:${ref.id}`, date, type, ref, text });
  };
  const supplier = (id: string): string => model.supplier.get(id)?.name ?? id;
  const customer = (id: string): string => model.customer.get(id)?.name ?? id;

  for (const order of ds.purchaseOrders) {
    const ref: RecordRef = { type: 'purchaseOrder', id: order.id };
    add(order.orderDate, 'po_raised', ref, `${order.id} raised with ${supplier(order.supplierId)}`);
    add(order.acknowledgedDate, 'po_acknowledged', ref, `${supplier(order.supplierId)} confirmed ${order.id}`);
  }
  for (const receipt of ds.goodsReceipts) {
    const ref: RecordRef = { type: 'goodsReceipt', id: receipt.id };
    add(receipt.date, 'goods_received', ref, `${receipt.id} received against ${receipt.purchaseOrderId}`);
    add(receipt.putawayDate, 'put_away', ref, `${receipt.id} put away`);
  }
  for (const order of ds.salesOrders) {
    const ref: RecordRef = { type: 'salesOrder', id: order.id };
    add(order.orderDate, 'so_entered', ref, `${order.id} entered for ${customer(order.customerId)}`);
    add(order.allocatedDate, 'so_allocated', ref, `Stock allocated to ${order.id}`);
    add(order.pickedDate, 'so_picked', ref, `${order.id} picked`);
    add(order.shippedDate, 'so_shipped', ref, `${order.id} shipped to ${customer(order.customerId)}`);
    add(order.deliveredDate, 'so_delivered', ref, `${order.id} delivered`);
  }
  for (const invoice of ds.salesInvoices) {
    const ref: RecordRef = { type: 'salesInvoice', id: invoice.id };
    add(invoice.date, 'sales_invoiced', ref, `${invoice.id} raised for ${money(invoice.net)}`);
    add(invoice.paidDate, 'payment_received', ref, `${customer(invoice.customerId)} paid ${invoice.id}, ${money(invoice.net)}`);
  }
  for (const invoice of ds.purchaseInvoices) {
    const ref: RecordRef = { type: 'purchaseInvoice', id: invoice.id };
    add(invoice.date, 'purchase_invoiced', ref, `Bill ${invoice.id} from ${supplier(invoice.supplierId)}, ${money(invoice.net)}`);
    add(invoice.paidDate, 'supplier_paid', ref, `Paid ${supplier(invoice.supplierId)} for ${invoice.id}`);
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return events;
}
