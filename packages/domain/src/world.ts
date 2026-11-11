/**
 * World state: what the core tells a client about the business on one date.
 * This is the API contract. Every outcome here (late, aged, on stop) is decided by the core.
 */
import type { GeoPoint } from './dataset';
import type { IsoDate } from './dates';

export type RecordType =
  | 'supplier'
  | 'customer'
  | 'product'
  | 'category'
  | 'purchaseOrder'
  | 'goodsReceipt'
  | 'salesOrder'
  | 'salesInvoice'
  | 'purchaseInvoice';

export const RECORD_TYPES: readonly RecordType[] = [
  'supplier',
  'customer',
  'product',
  'category',
  'purchaseOrder',
  'goodsReceipt',
  'salesOrder',
  'salesInvoice',
  'purchaseInvoice',
];

export interface RecordRef {
  type: RecordType;
  id: string;
}

export type BuildingId = 'goodsIn' | 'warehouse' | 'sales' | 'accounts' | 'dispatch';
export const BUILDING_IDS: readonly BuildingId[] = ['goodsIn', 'warehouse', 'sales', 'accounts', 'dispatch'];

export type FigureId = 'stockValue' | 'debtors' | 'openSalesOrders' | 'openPurchaseOrders' | 'creditors' | 'cash';
export const FIGURE_IDS: readonly FigureId[] = [
  'stockValue',
  'debtors',
  'openSalesOrders',
  'openPurchaseOrders',
  'creditors',
  'cash',
];

/** One number on the resource bar. `value` always equals the sum of its records. */
export interface Figure {
  id: FigureId;
  label: string;
  value: number;
  /** Number of records behind the value. */
  count: number;
  /** True when the figure has no real source yet and comes from the sandbox. */
  simulated: boolean;
}

export interface SupplierState {
  id: string;
  name: string;
  openPoCount: number;
  latePoCount: number;
  /** Open orders so long overdue they were probably never closed. Not counted as late. */
  stalePoCount: number;
  openPoValue: number;
  worstDaysLate: number;
}

export interface CustomerState {
  id: string;
  name: string;
  /** Net invoiced over the trailing window. Drives village size. */
  revenue: number;
  /** Unpaid invoices. */
  balance: number;
  creditLimit: number;
  onStop: boolean;
  overLimit: boolean;
  openOrderCount: number;
}

export type PurchaseOrderStatus = 'raised' | 'in_transit' | 'partly_received' | 'received';

export interface PurchaseOrderState {
  id: string;
  supplierId: string;
  orderDate: IsoDate;
  dueDate: IsoDate;
  originalDueDate: IsoDate;
  status: PurchaseOrderStatus;
  /** Past its due date, and recently enough that it is still expected. */
  late: boolean;
  /** So long overdue it was probably never closed. Shown apart from late. */
  stale: boolean;
  /** Days past the due date, for late and stale orders alike. */
  daysLate: number;
  /** Raised a while ago and the supplier has not confirmed it. */
  unacknowledged: boolean;
  /** The source holds no due date for this order, so it cannot be placed on the road or called late. */
  dueUnknown: boolean;
  /** A delivery for this order was received on the state date. */
  arrivingToday: boolean;
  qtyOutstanding: number;
  /** Value still to arrive. */
  value: number;
  lineCount: number;
}

/** A delivery received and not yet put away. */
export interface DockPallet {
  receiptId: string;
  purchaseOrderId: string;
  supplierId: string;
  /** Category holding most of the delivery's value. */
  categoryId: string;
  receivedDate: IsoDate;
  daysOnDock: number;
  /** On the dock longer than it should be. */
  stale: boolean;
  qty: number;
  value: number;
}

export interface StockpileState {
  categoryId: string;
  name: string;
  qty: number;
  value: number;
  productCount: number;
  /** 0 fresh, 1 over 180 days, 2 over 365, 3 over 730. */
  ageBand: 0 | 1 | 2 | 3;
  /** Value of stock not received for over 180 days. */
  agedValue: number;
  /** Holds a row that cannot be right, e.g. negative stock. */
  untrusted: boolean;
}

export type SalesOrderStatus = 'back_ordered' | 'allocated' | 'picked' | 'shipped';

export interface SalesOrderState {
  id: string;
  customerId: string;
  orderDate: IsoDate;
  committedDate: IsoDate;
  status: SalesOrderStatus;
  /** Past its committed date and not yet shipped. */
  late: boolean;
  /** So long past its committed date it was probably never closed. Shown apart from late. */
  stale: boolean;
  daysLate: number;
  value: number;
  shippedDate: IsoDate | null;
  /** Expected arrival at the customer, known once shipped. */
  deliveredDate: IsoDate | null;
}

/** Money moving on the state date. */
export interface MoneyMovement {
  invoiceId: string;
  /** Customer for money in, supplier for a bill. */
  partyId: string;
  amount: number;
}

export type TaskKind =
  | 'unload'
  | 'putaway'
  | 'pick'
  | 'load'
  | 'enter_order'
  | 'chase_stock'
  | 'match_bill'
  | 'pay_bill'
  | 'chase_debt';

/** One piece of work sitting with a function. */
export interface QueueItem {
  kind: TaskKind;
  ref: RecordRef;
  /** What a worker on this job is doing, e.g. "Unloading PO100233". */
  label: string;
  detail: string;
  value: number;
  ageDays: number;
  flag: 'ok' | 'warn' | 'late';
  categoryId: string | null;
  partyId: string | null;
}

export interface BuildingState {
  id: BuildingId;
  label: string;
  queue: QueueItem[];
}

export type AlertKind =
  | 'po_late'
  | 'po_unacknowledged'
  | 'po_no_due_date'
  | 'po_stale'
  | 'so_stale'
  | 'dock_stale'
  | 'stock_aged'
  | 'stock_untrusted'
  | 'so_late'
  | 'customer_on_stop'
  | 'customer_over_limit';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: 'high' | 'medium';
  title: string;
  detail: string;
  ref: RecordRef;
}

/** Part of the map kept dark because its data is missing or cannot be trusted. */
export interface FogFlag {
  scope: 'category' | 'supplier' | 'customer';
  id: string;
  reason: string;
}

export interface WorldState {
  asOf: IsoDate;
  figures: Figure[];
  suppliers: SupplierState[];
  customers: CustomerState[];
  /** Open orders, plus any with a delivery received today. */
  purchaseOrders: PurchaseOrderState[];
  dock: DockPallet[];
  stockpiles: StockpileState[];
  /** Orders not yet delivered. */
  salesOrders: SalesOrderState[];
  paymentsIn: MoneyMovement[];
  billsIn: MoneyMovement[];
  buildings: BuildingState[];
  alerts: Alert[];
  fog: FogFlag[];
}

/** The parts of the world that do not change with the date. Layout is built from this. */
export interface WorldMaster {
  source: string;
  range: { start: IsoDate; end: IsoDate };
  /** `rank` 1 is the biggest supplier by value ordered. */
  suppliers: { id: string; name: string; rank: number }[];
  /** `rank` 1 is the biggest customer by revenue over the whole range. */
  customers: { id: string; name: string; rank: number; location: GeoPoint | null }[];
  /** Where the company site is, or null if unknown. */
  site: GeoPoint | null;
  categories: { id: string; name: string }[];
  /** The usual length of each function's queue. A queue well beyond it is a backlog. */
  typicalQueue: Record<BuildingId, number>;
  simulated: string[];
}

/** Where a record came from, so any figure can be traced. */
export interface SourceRef {
  system: string;
  entity: string;
  id: string;
}

export interface RecordCard {
  ref: RecordRef;
  title: string;
  subtitle: string;
  status: { text: string; flag: 'ok' | 'warn' | 'late' };
  fields: { label: string; value: string }[];
  lines: { columns: string[]; rows: string[][] } | null;
  related: { ref: RecordRef; label: string }[];
  source: SourceRef[];
}

export interface FigureRecords {
  figure: Figure;
  columns: string[];
  rows: { ref: RecordRef | null; cells: string[]; amount: number }[];
}

export type WorldEventType =
  | 'po_raised'
  | 'po_acknowledged'
  | 'goods_received'
  | 'put_away'
  | 'so_entered'
  | 'so_allocated'
  | 'so_picked'
  | 'so_shipped'
  | 'so_delivered'
  | 'sales_invoiced'
  | 'payment_received'
  | 'purchase_invoiced'
  | 'supplier_paid';

export interface WorldEvent {
  id: string;
  date: IsoDate;
  type: WorldEventType;
  ref: RecordRef;
  text: string;
}
