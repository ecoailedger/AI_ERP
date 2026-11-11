/** Lookup tables over a dataset, built once. */
import type {
  Customer,
  Person,
  PersonRole,
  Dataset,
  GoodsReceipt,
  Product,
  ProductCategory,
  PurchaseInvoice,
  PurchaseOrder,
  SalesInvoice,
  SalesOrder,
  Supplier,
} from '@ai-erp/domain';

export interface Model {
  ds: Dataset;
  person: Map<string, Person>;
  /** What each person does, judged over the whole dataset. */
  role: Map<string, PersonRole>;
  supplier: Map<string, Supplier>;
  customer: Map<string, Customer>;
  category: Map<string, ProductCategory>;
  product: Map<string, Product>;
  purchaseOrder: Map<string, PurchaseOrder>;
  goodsReceipt: Map<string, GoodsReceipt>;
  salesOrder: Map<string, SalesOrder>;
  salesInvoice: Map<string, SalesInvoice>;
  purchaseInvoice: Map<string, PurchaseInvoice>;
  receiptsByOrder: Map<string, GoodsReceipt[]>;
  purchaseInvoicesByOrder: Map<string, PurchaseInvoice[]>;
  salesInvoiceByOrder: Map<string, SalesInvoice>;
}

const byId = <T extends { id: string }>(items: T[]): Map<string, T> => new Map(items.map((item) => [item.id, item]));

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

export function buildModel(ds: Dataset): Model {
  const buyers = new Set(ds.purchaseOrders.flatMap((order) => order.raisedBy ?? []));
  const sellers = new Set(ds.salesOrders.flatMap((order) => order.enteredBy ?? []));
  const role = new Map<string, PersonRole>(
    ds.people.map((person) => [person.id, buyers.has(person.id) ? (sellers.has(person.id) ? 'both' : 'buyer') : 'sales']),
  );
  return {
    ds,
    person: byId(ds.people),
    role,
    supplier: byId(ds.suppliers),
    customer: byId(ds.customers),
    category: byId(ds.categories),
    product: byId(ds.products),
    purchaseOrder: byId(ds.purchaseOrders),
    goodsReceipt: byId(ds.goodsReceipts),
    salesOrder: byId(ds.salesOrders),
    salesInvoice: byId(ds.salesInvoices),
    purchaseInvoice: byId(ds.purchaseInvoices),
    receiptsByOrder: groupBy(ds.goodsReceipts, (receipt) => receipt.purchaseOrderId),
    purchaseInvoicesByOrder: groupBy(ds.purchaseInvoices, (invoice) => invoice.purchaseOrderId),
    salesInvoiceByOrder: new Map(ds.salesInvoices.map((invoice) => [invoice.salesOrderId, invoice])),
  };
}

/** Looks up a record that the dataset promises exists. A miss means the dataset is broken. */
export function must<T>(map: Map<string, T>, id: string, what: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`Dataset is inconsistent: ${what} ${id} is referenced but missing`);
  return value;
}
