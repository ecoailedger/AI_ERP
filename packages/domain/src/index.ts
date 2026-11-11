/**
 * Canonical entity types shared by every layer.
 * Field names follow docs/DATA-MAPPING.md. Entities arrive in milestone 1.1.
 */

/** ISO calendar date, e.g. "2026-11-11". */
export type IsoDate = string;

/** Bumped when the canonical shape changes, so snapshots can be checked on load. */
export const DOMAIN_SCHEMA_VERSION = 1;

/** The entity kinds the world can draw. Kept in step with CONTEXT section 8. */
export const ENTITY_KINDS = [
  'supplier',
  'customer',
  'product',
  'productCategory',
  'location',
  'purchaseOrder',
  'goodsReceipt',
  'stockMovement',
  'stockCount',
  'salesOrder',
  'shipment',
  'purchaseInvoice',
  'salesInvoice',
  'payment',
  'ledgerEntry',
  'event',
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];
