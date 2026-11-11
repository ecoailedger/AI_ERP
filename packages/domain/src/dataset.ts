/**
 * Canonical dataset: the one shape every data source is mapped into.
 * Dummy data is generated in this shape; the Fabric adapter (Stage 2) maps the mirror to it.
 * Field meanings follow docs/DATA-MAPPING.md.
 */
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1);
const money = z.number();
const quantity = z.number();

/** A point on the earth. Only ever as precise as the source allows: often just a postcode area. */
export const GeoPointSchema = z.object({ lat: z.number(), lon: z.number() });

export const SupplierSchema = z.object({
  id,
  name: z.string(),
  /** Usual days from order to delivery. */
  leadTimeDays: z.number().int().positive(),
});

export const CustomerSchema = z.object({
  id,
  name: z.string(),
  creditLimit: money,
  termsDays: z.number().int().positive(),
  /** Date the account went on stop, or null if trading normally. */
  onStopFrom: isoDate.nullable(),
  /** Where the customer is, or null if the source does not say. */
  location: GeoPointSchema.nullable(),
});

export const ProductCategorySchema = z.object({ id, name: z.string() });

export const ProductSchema = z.object({
  id,
  description: z.string(),
  categoryId: id,
  supplierId: id,
  unitCost: money,
  sellPrice: money,
});

export const PurchaseOrderLineSchema = z.object({
  line: z.number().int().positive(),
  productId: id,
  qty: quantity,
  unitCost: money,
  dueDate: isoDate,
  originalDueDate: isoDate,
});

export const PurchaseOrderSchema = z.object({
  id,
  supplierId: id,
  orderDate: isoDate,
  /** Date the supplier confirmed the order, or null if never confirmed. */
  acknowledgedDate: isoDate.nullable(),
  lines: z.array(PurchaseOrderLineSchema).min(1),
});

export const GoodsReceiptSchema = z.object({
  id,
  purchaseOrderId: id,
  date: isoDate,
  /** Date the delivery left the dock for storage, or null if still on the dock. */
  putawayDate: isoDate.nullable(),
  lines: z.array(z.object({ line: z.number().int().positive(), qty: quantity })).min(1),
});

export const SalesOrderLineSchema = z.object({
  line: z.number().int().positive(),
  productId: id,
  qty: quantity,
  unitPrice: money,
});

export const SalesOrderSchema = z.object({
  id,
  customerId: id,
  orderDate: isoDate,
  /** Delivery date promised to the customer. */
  committedDate: isoDate,
  allocatedDate: isoDate.nullable(),
  pickedDate: isoDate.nullable(),
  shippedDate: isoDate.nullable(),
  deliveredDate: isoDate.nullable(),
  lines: z.array(SalesOrderLineSchema).min(1),
});

export const SalesInvoiceSchema = z.object({
  id,
  salesOrderId: id,
  customerId: id,
  date: isoDate,
  net: money,
  dueDate: isoDate,
  paidDate: isoDate.nullable(),
});

export const PurchaseInvoiceSchema = z.object({
  id,
  purchaseOrderId: id,
  goodsReceiptId: id,
  supplierId: id,
  date: isoDate,
  net: money,
  dueDate: isoDate,
  paidDate: isoDate.nullable(),
});

export const OpeningStockSchema = z.object({
  productId: id,
  qty: quantity,
  /** Last time this product was received before the dataset starts. Drives stock ageing. */
  lastReceiptDate: isoDate,
});

export const DatasetMetaSchema = z.object({
  schemaVersion: z.number().int(),
  /** Where the data came from: "dummy" or a named feed. */
  source: z.string(),
  seed: z.number().int().nullable(),
  /** First and last day the world can show. Records may be dated before startDate. */
  startDate: isoDate,
  endDate: isoDate,
  openingCash: money,
  /** Where the company site is. Customers are placed on the map relative to it. */
  site: GeoPointSchema.nullable(),
  /** Entities with no real source yet, simulated in the sandbox. */
  simulated: z.array(z.string()),
});

export const DatasetSchema = z.object({
  meta: DatasetMetaSchema,
  suppliers: z.array(SupplierSchema),
  customers: z.array(CustomerSchema),
  categories: z.array(ProductCategorySchema),
  products: z.array(ProductSchema),
  openingStock: z.array(OpeningStockSchema),
  purchaseOrders: z.array(PurchaseOrderSchema),
  goodsReceipts: z.array(GoodsReceiptSchema),
  salesOrders: z.array(SalesOrderSchema),
  salesInvoices: z.array(SalesInvoiceSchema),
  purchaseInvoices: z.array(PurchaseInvoiceSchema),
});

export type GeoPoint = z.infer<typeof GeoPointSchema>;
export type Supplier = z.infer<typeof SupplierSchema>;
export type Customer = z.infer<typeof CustomerSchema>;
export type ProductCategory = z.infer<typeof ProductCategorySchema>;
export type Product = z.infer<typeof ProductSchema>;
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;
export type SalesOrderLine = z.infer<typeof SalesOrderLineSchema>;
export type SalesOrder = z.infer<typeof SalesOrderSchema>;
export type SalesInvoice = z.infer<typeof SalesInvoiceSchema>;
export type PurchaseInvoice = z.infer<typeof PurchaseInvoiceSchema>;
export type OpeningStock = z.infer<typeof OpeningStockSchema>;
export type DatasetMeta = z.infer<typeof DatasetMetaSchema>;
export type Dataset = z.infer<typeof DatasetSchema>;

/** The files a dataset is stored as, one per entity. */
export const DATASET_FILES = [
  'meta',
  'suppliers',
  'customers',
  'categories',
  'products',
  'openingStock',
  'purchaseOrders',
  'goodsReceipts',
  'salesOrders',
  'salesInvoices',
  'purchaseInvoices',
] as const satisfies readonly (keyof Dataset)[];
